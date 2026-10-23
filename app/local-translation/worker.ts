import { env, AutoTokenizer, AutoModelForSeq2SeqLM, type PreTrainedTokenizer, type PreTrainedModel, type Tensor } from "@huggingface/transformers";
import type { Stage, WorkerReply, WorkerRequest } from "./models";
import { assertCompleteGeneration, MAX_NEW_TOKENS, splitSentences, splitToTokenBudget } from "./chunks";

// This bundle is built for a dedicated browser worker, never the server.
const scope = globalThis as unknown as {
  location: Location;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerReply) => void;
};
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm!.wasmPaths = new URL("./", scope.location.href).href;
// No GPU or cross-origin isolation required. One thread keeps RAM and CPU
// pressure predictable on small devices; the UI remains on its own thread.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;

type Encoded = Record<string, unknown> & { input_ids: Tensor };
// Transformers.js 3.8.1 (pinned) builds NLLB inputs with this method: it puts
// the source language token first and returns the target language token id.
type NllbTokenizer = PreTrainedTokenizer & {
  _build_translation_inputs(
    text: string,
    options: { padding: boolean; truncation: boolean },
    kwargs: { src_lang: string; tgt_lang: string; forced_bos_token_id?: number },
  ): Encoded;
};

let loaded: { tokenizer: PreTrainedTokenizer; model: PreTrainedModel; stage: Stage } | undefined;
let busy = false;

function encoder(current: NonNullable<typeof loaded>) {
  const { tokenizer, stage } = current;
  if (stage.nllb) {
    const nllb = stage.nllb;
    return (value: string) => {
      const kwargs: { src_lang: string; tgt_lang: string; forced_bos_token_id?: number } = { src_lang: nllb.source, tgt_lang: nllb.target };
      const inputs = (tokenizer as unknown as NllbTokenizer)._build_translation_inputs(value, { padding: false, truncation: false }, kwargs);
      if (typeof kwargs.forced_bos_token_id !== "number") throw new Error("The model does not support this target language.");
      return { inputs, extra: { forced_bos_token_id: kwargs.forced_bos_token_id } };
    };
  }
  return (value: string) => ({
    inputs: tokenizer(stage.prefix + value, { truncation: false, padding: false }) as unknown as Encoded,
    extra: {},
  });
}

async function translate(text: string, id: number) {
  if (!loaded) throw new Error("The local model is not ready.");
  const current = loaded;
  const encode = encoder(current);
  const countTokens = (value: string) => encode(value).inputs.input_ids.size;
  const generate = async (chunk: string) => {
    const { inputs, extra } = encode(chunk);
    const tokens = await current.model.generate({
      ...inputs,
      ...extra,
      max_new_tokens: MAX_NEW_TOKENS,
      num_beams: 1,
      do_sample: false,
      return_dict_in_generate: false,
    }) as Tensor;
    try {
      assertCompleteGeneration(tokens.dims[1]);
      const result = current.tokenizer.batch_decode(tokens, { skip_special_tokens: true })[0]?.trim();
      if (!result) throw new Error("The model returned no translation for a text block.");
      return result;
    } finally {
      tokens.dispose();
    }
  };
  const parts = text.split(/(\r\n|\r|\n)/u);
  const output: string[] = [];

  for (const part of parts) {
    if (!part.trim()) {
      output.push(part);
      continue;
    }
    // One sentence per model call (see splitSentences); only a sentence that
    // is itself over the token budget is split further.
    const units = splitSentences(part).map((sentence) => {
      const core = sentence.trim();
      const start = sentence.indexOf(core);
      return {
        before: sentence.slice(0, start),
        chunks: core ? splitToTokenBudget(core, countTokens) : [],
        after: sentence.slice(start + core.length),
      };
    });
    const total = units.reduce((sum, unit) => sum + unit.chunks.length, 0);
    let done = 0;
    for (const unit of units) {
      const translated: string[] = [];
      for (const chunk of unit.chunks) {
        done += 1;
        scope.postMessage({ id, type: "progress", message: `Translating sentence ${done} of ${total} locally` });
        translated.push(await generate(chunk));
      }
      output.push(unit.before + translated.join(" ") + unit.after);
    }
  }
  return output.join("");
}

scope.onmessage = async ({ data }) => {
  if (busy) {
    scope.postMessage({ id: data.id, type: "error", message: "The local model is already processing a request." });
    return;
  }
  busy = true;
  try {
    if (data.type === "init") {
      if (loaded) throw new Error("A model is already loaded in this worker.");
      const { model } = data.stage;
      const progress_callback = (progress: import("@huggingface/transformers").ProgressInfo) => {
        let message = "Loading the translation model";
        if (progress.status === "progress") message = `Downloading model file: ${Math.round(progress.progress)}%`;
        scope.postMessage({ id: data.id, type: "progress", message });
      };
      const tokenizer = await AutoTokenizer.from_pretrained(model.id, { revision: model.revision, progress_callback });
      const loadedModel = await AutoModelForSeq2SeqLM.from_pretrained(model.id, {
        revision: model.revision,
        dtype: "q8",
        device: "wasm",
        progress_callback,
      });
      loaded = { tokenizer, model: loadedModel, stage: data.stage };
      scope.postMessage({ id: data.id, type: "ready" });
    } else {
      scope.postMessage({ id: data.id, type: "result", text: await translate(data.text, data.id) });
    }
  } catch (error) {
    scope.postMessage({ id: data.id, type: "error", message: error instanceof Error ? error.message : "Local model inference failed." });
  } finally {
    busy = false;
  }
};

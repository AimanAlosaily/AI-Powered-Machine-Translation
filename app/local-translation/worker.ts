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

let loaded: { tokenizer: PreTrainedTokenizer; model: PreTrainedModel; stage: Stage } | undefined;
let busy = false;

async function translate(text: string, id: number) {
  if (!loaded) throw new Error("The local model is not ready.");
  const current = loaded;
  // English → Arabic needs the ">>ara<<" target prefix on every input.
  const encode = (value: string) =>
    current.tokenizer(current.stage.prefix + value, { truncation: false, padding: false }) as unknown as Encoded;
  const countTokens = (value: string) => encode(value).input_ids.size;
  const generate = async (chunk: string) => {
    // generate() forwards generation settings as untyped kwargs.
    const options = {
      ...encode(chunk),
      max_new_tokens: MAX_NEW_TOKENS,
      num_beams: 1,
      do_sample: false,
      return_dict_in_generate: false,
    };
    const tokens = await current.model.generate(
      options as unknown as Parameters<PreTrainedModel["generate"]>[0],
    ) as Tensor;
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
      if (data.localModelPath) {
        // Desktop app: read the bundled files and never contact Hugging Face.
        // They are already on disk, so no browser cache copy is needed.
        env.allowLocalModels = true;
        env.allowRemoteModels = false;
        env.localModelPath = data.localModelPath;
        env.useBrowserCache = false;
      }
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

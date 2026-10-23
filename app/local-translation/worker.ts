import { env, AutoTokenizer, AutoModelForSeq2SeqLM, type PreTrainedTokenizer, type PreTrainedModel, type Tensor } from "@huggingface/transformers";
import { COMPACT_MODELS, type CompactPair, type WorkerReply, type WorkerRequest } from "./models";
import { assertCompleteGeneration, MAX_NEW_TOKENS, splitToTokenBudget } from "./chunks";

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

let translator: { tokenizer: PreTrainedTokenizer; model: PreTrainedModel } | undefined;
let activePair: CompactPair | undefined;
let busy = false;

async function translate(text: string, id: number) {
  if (!translator || !activePair) throw new Error("The local model is not ready.");
  const current = translator;
  const prefix = COMPACT_MODELS[activePair].prefix;
  const encode = (value: string) => current.tokenizer(prefix + value, { truncation: false, padding: false });
  const countTokens = (value: string) => encode(value).input_ids.size;
  const parts = text.split(/(\r\n|\r|\n)/u);
  const output: string[] = [];

  for (const part of parts) {
    if (!part.trim()) {
      output.push(part);
      continue;
    }
    const chunks = splitToTokenBudget(part, countTokens);
    const translated: string[] = [];
    for (let index = 0; index < chunks.length; index++) {
      scope.postMessage({ id, type: "progress", message: `Translating text block ${index + 1} of ${chunks.length} locally` });
      const tokens = await current.model.generate({
        ...encode(chunks[index]),
        max_new_tokens: MAX_NEW_TOKENS,
        num_beams: 1,
        do_sample: false,
        return_dict_in_generate: false,
      }) as Tensor;
      try {
        assertCompleteGeneration(tokens.dims[1]);
        const result = current.tokenizer.batch_decode(tokens, { skip_special_tokens: true })[0]?.trim();
        if (!result) throw new Error("The model returned no translation for a text block.");
        translated.push(result);
      } finally {
        tokens.dispose();
      }
    }
    output.push(translated.join(" "));
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
      if (translator) throw new Error("A model is already loaded in this worker.");
      const model = COMPACT_MODELS[data.pair];
      const progress_callback = (progress: import("@huggingface/transformers").ProgressInfo) => {
        let message = "Loading compact translation model";
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
      translator = { tokenizer, model: loadedModel };
      activePair = data.pair;
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

// Pin weights as well as the runtime so an upstream update cannot silently
// change downloads, memory use, or output. Only q8 graphs are requested.
export const COMPACT_MODELS = {
  "en-ar": {
    id: "Xenova/opus-mt-en-ar",
    revision: "034a684356c19021a187cda4d7f823298b913921",
    prefix: ">>ara<< ",
  },
  "ar-en": {
    id: "Xenova/opus-mt-ar-en",
    revision: "09c7556866400dcc53562ba8d7035119e7d9a2c1",
    prefix: "",
  },
} as const;

export type CompactPair = keyof typeof COMPACT_MODELS;
export const MODEL_CACHE = "transformers-cache";
export const MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
] as const;

export function compactPair(source: string, target: string): CompactPair | null {
  const pair = `${source}-${target}`;
  return Object.hasOwn(COMPACT_MODELS, pair) ? (pair as CompactPair) : null;
}

export function modelFileUrls(pair: CompactPair) {
  const model = COMPACT_MODELS[pair];
  return MODEL_FILES.map(
    (file) => `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`,
  );
}

export async function isModelCached(pair: CompactPair) {
  if (typeof caches === "undefined") return false;
  try {
    if (!(await caches.has(MODEL_CACHE))) return false;
    const cache = await caches.open(MODEL_CACHE);
    // Check real entries, not a localStorage flag that survives cache eviction.
    const entries = new Set((await cache.keys()).map((entry) => entry.url));
    return modelFileUrls(pair).every((url) => entries.has(url));
  } catch {
    // Private browsing/storage restrictions may prevent durable caching.
    return false;
  }
}

export type WorkerRequest =
  | { id: number; type: "init"; pair: CompactPair }
  | { id: number; type: "translate"; text: string };

export type WorkerReply =
  | { id: number; type: "ready" }
  | { id: number; type: "result"; text: string }
  | { id: number; type: "progress"; message: string }
  | { id: number; type: "error"; message: string };

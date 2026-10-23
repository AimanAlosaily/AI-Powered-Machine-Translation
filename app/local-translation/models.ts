// Verta translates Arabic ↔ English with two small open-weight models that run
// in this browser. Weights and runtime are pinned so an upstream update cannot
// silently change downloads, memory use, or output. Only q8 (8-bit) ONNX graphs
// are requested.

export type ModelSpec = {
  id: string;
  revision: string;
  /** Download size of the two q8 ONNX graphs in MB (tokenizer/config extra). */
  sizeMB: number;
};

/** One model run: a direction, its pinned model, and any required prefix. */
export type Stage = {
  model: ModelSpec;
  source: string;
  target: string;
  /** Multi-target Marian models need a ">>lang<< " prefix. */
  prefix: string;
};

// OPUS-MT (Helsinki-NLP, Apache-2.0) ONNX conversions by Xenova.
const ROUTES: Record<string, Stage> = {
  "en-ar": {
    model: { id: "Xenova/opus-mt-en-ar", revision: "034a684356c19021a187cda4d7f823298b913921", sizeMB: 111 },
    source: "en",
    target: "ar",
    prefix: ">>ara<< ",
  },
  "ar-en": {
    model: { id: "Xenova/opus-mt-ar-en", revision: "09c7556866400dcc53562ba8d7035119e7d9a2c1", sizeMB: 111 },
    source: "ar",
    target: "en",
    prefix: "",
  },
};

/**
 * Returns the model stage for a direction, [] for same-language text (no model
 * needed), and null for an unsupported pair.
 */
export function translationPlan(source: string, target: string): Stage[] | null {
  if (source === target) return [];
  const stage = ROUTES[`${source}-${target}`];
  return stage ? [stage] : null;
}

export function planSizeMB(plan: Stage[]) {
  return plan.reduce((sum, stage) => sum + stage.model.sizeMB, 0);
}

export const MODEL_CACHE = "transformers-cache";
export const MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_merged_quantized.onnx",
] as const;

export function modelFileUrls(model: ModelSpec) {
  return MODEL_FILES.map(
    (file) => `https://huggingface.co/${model.id}/resolve/${model.revision}/${file}`,
  );
}

export async function isModelCached(model: ModelSpec) {
  if (typeof caches === "undefined") return false;
  try {
    if (!(await caches.has(MODEL_CACHE))) return false;
    const cache = await caches.open(MODEL_CACHE);
    // Check real entries, not a localStorage flag that survives cache eviction.
    const entries = new Set((await cache.keys()).map((entry) => entry.url));
    return modelFileUrls(model).every((url) => entries.has(url));
  } catch {
    // Private browsing/storage restrictions may prevent durable caching.
    return false;
  }
}

export async function isPlanCached(plan: Stage[]) {
  const cached = await Promise.all(plan.map((stage) => isModelCached(stage.model)));
  return cached.every(Boolean);
}

export type WorkerRequest =
  | { id: number; type: "init"; stage: Stage }
  | { id: number; type: "translate"; text: string };

export type WorkerReply =
  | { id: number; type: "ready" }
  | { id: number; type: "result"; text: string }
  | { id: number; type: "progress"; message: string }
  | { id: number; type: "error"; message: string };

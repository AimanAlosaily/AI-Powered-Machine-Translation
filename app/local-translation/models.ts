// Every translation runs on open-weight models in this browser. Weights and
// runtime are pinned so an upstream update cannot silently change downloads,
// memory use, or output. Only q8 (8-bit) ONNX graphs are requested.

export type ModelFamily = "marian" | "nllb";

export type ModelSpec = {
  id: string;
  revision: string;
  family: ModelFamily;
  /** Download size of the two q8 ONNX graphs in MB (tokenizer/config extra). */
  sizeMB: number;
};

/** One model run. A plan has one stage, or two when pivoting through English. */
export type Stage = {
  model: ModelSpec;
  source: string;
  target: string;
  /** Marian multi-target models need a ">>lang<< " prefix. */
  prefix: string;
  /** NLLB language codes; absent for Marian. */
  nllb?: { source: string; target: string };
};

const opus = (pair: string, revision: string, sizeMB: number): ModelSpec => ({
  id: `Xenova/opus-mt-${pair}`,
  revision,
  family: "marian",
  sizeMB,
});

// OPUS-MT (Helsinki-NLP) bilingual models, about 100–130 MB each. Revisions
// and sizes were read from the Hugging Face API on 23 October 2026.
const OPUS = {
  "en-ar": opus("en-ar", "034a684356c19021a187cda4d7f823298b913921", 111),
  "en-fr": opus("en-fr", "28726206f80896b90035bd99cccd5cc1e151f916", 108),
  "en-es": opus("en-es", "4b002a4c7edd54a7ced58877258b87f7efd3f892", 113),
  "en-de": opus("en-de", "1ca130c44c4c5441ef16d48aae521a424ab644f7", 106),
  "en-it": opus("en-it", "075406e3c8c2c30634d4a1bd8f00c21d9e162011", 129),
  "en-zh": opus("en-zh", "046f55aec303cdee3e0318604406d4df20f1e8ea", 113),
  "en-hi": opus("en-hi", "7aad72006a1588a9c3485ed6203aed99eebbc872", 110),
  "en-ru": opus("en-ru", "e050376e960175e8ddc5cff85025dc8436cddd68", 111),
  "en-uk": opus("en-uk", "e6ca587292984b343fd829b6430ed55858496525", 110),
  "en-nl": opus("en-nl", "c3a0541231a7329b4492809fc2bd7ab7d2ceb0bc", 115),
  "en-sv": opus("en-sv", "33d522d806c041cdebecd549c558d22a2b9b4ea4", 104),
  "en-da": opus("en-da", "33862dc071a5cc43e821e60742553c501c587e77", 107),
  "en-fi": opus("en-fi", "4e5799273dbd7cce94c1e99cc9d3acb9f191b8eb", 113),
  "en-id": opus("en-id", "b3b41f654c2fb3286d007dee1da7b0f47fd27d82", 103),
  "en-vi": opus("en-vi", "30bcd461c0d7338ad106b36314d3eedc2d4e998c", 102),
  "en-cs": opus("en-cs", "ed163ca109a93297e2f055eb3397bd33230141ad", 111),
  "en-hu": opus("en-hu", "1b7df958c1bd8f094eff1ce76d536468923ed7e3", 111),
  "en-ro": opus("en-ro", "3d816891778276930df2a45cbfb70689b3fe8981", 108),
  "ar-en": opus("ar-en", "09c7556866400dcc53562ba8d7035119e7d9a2c1", 111),
  "fr-en": opus("fr-en", "6b166a182780e118c997879d0ad5be4b53671644", 108),
  "es-en": opus("es-en", "eadfd7c658a9d8929ac3b8e996b68a68e2c7d480", 113),
  "de-en": opus("de-en", "399dfd68706739fffd503f876093e455ae268a06", 106),
  "it-en": opus("it-en", "fd0b89b9c052adc1f2f64152f555aa17353728be", 129),
  "zh-en": opus("zh-en", "39d480d52a9ea3065a1f117adfe4dbc55de10e6f", 113),
  "ja-en": opus("ja-en", "1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16", 109),
  "ko-en": opus("ko-en", "d9fa1ac6008242100fecb4fff9b0a5917a1be81f", 113),
  "hi-en": opus("hi-en", "99853100ed9d932987a6816e8cf7b1b6742a6116", 109),
  "ru-en": opus("ru-en", "afe8c6c738ec81b6d033fd8f44f9678a639a7c67", 111),
  "uk-en": opus("uk-en", "b2ad6afa424aaeff8913ff350860b7a7b7c0a607", 110),
  "nl-en": opus("nl-en", "82c42d95d1508037cbe7172d85fd4e940a2f3584", 115),
  "pl-en": opus("pl-en", "aeaf0e003b045248c28a559a5ce6027b54ebdaba", 112),
  "sv-en": opus("sv-en", "63a40256869b6a2b29a84e47aa7f03524fa5f3a2", 104),
  "da-en": opus("da-en", "6496d5e47a016552357be8f06294096609256ac4", 107),
  "fi-en": opus("fi-en", "a623e4812687be788e3ab720c8a950ab64704793", 108),
  "id-en": opus("id-en", "c38ef36c843b71177da903442835c3c870975fd6", 103),
  "th-en": opus("th-en", "7f0406b972f742985cfbe3be8f61dead9f1bc0e3", 110),
  "vi-en": opus("vi-en", "541dfd72ec07e8f1563795e0224408ad8d729e80", 102),
  "cs-en": opus("cs-en", "c9f7336d1cf49ba5b7a412cba3b86999fa781716", 111),
  "hu-en": opus("hu-en", "c9e8a7617fb4cb4fca3785c5bb22cfe457cde00b", 111),
} as const satisfies Record<string, ModelSpec>;

// App language pair → OPUS model and required target prefix. Multi-target
// models list their tokens in tokenizer.json (checked for these three).
const DIRECT: Record<string, { model: ModelSpec; prefix: string }> = {
  ...Object.fromEntries(Object.entries(OPUS).map(([pair, model]) => [pair, { model, prefix: "" }])),
  "en-ar": { model: OPUS["en-ar"], prefix: ">>ara<< " },
  "en-zh": { model: OPUS["en-zh"], prefix: ">>cmn_Hans<< " },
  "en-zh-Hant": { model: OPUS["en-zh"], prefix: ">>cmn_Hant<< " },
  "en-vi": { model: OPUS["en-vi"], prefix: ">>vie<< " },
};

// NLLB-200 distilled 600M covers every app language. It is the fallback when
// no OPUS route exists: about 895 MB of weights and CC-BY-NC-4.0 licensed.
export const NLLB_MODEL: ModelSpec = {
  id: "Xenova/nllb-200-distilled-600M",
  revision: "261c31d1a5732c67cdd16d80e8d6088507c7ccea",
  family: "nllb",
  sizeMB: 895,
};

// Every code below is a special token in the pinned NLLB tokenizer.json.
export const NLLB_CODES: Record<string, string> = {
  ar: "arb_Arab", en: "eng_Latn", fr: "fra_Latn", es: "spa_Latn", de: "deu_Latn",
  it: "ita_Latn", pt: "por_Latn", zh: "zho_Hans", "zh-Hant": "zho_Hant",
  ja: "jpn_Jpan", ko: "kor_Hang", hi: "hin_Deva", tr: "tur_Latn", ru: "rus_Cyrl",
  uk: "ukr_Cyrl", nl: "nld_Latn", pl: "pol_Latn", sv: "swe_Latn", no: "nob_Latn",
  da: "dan_Latn", fi: "fin_Latn", el: "ell_Grek", iw: "heb_Hebr", id: "ind_Latn",
  th: "tha_Thai", vi: "vie_Latn", bg: "bul_Cyrl", bn: "ben_Beng", cs: "ces_Latn",
  hr: "hrv_Latn", hu: "hun_Latn", ro: "ron_Latn", sk: "slk_Latn", sl: "slv_Latn",
  ta: "tam_Taml", te: "tel_Telu",
};

function direct(source: string, target: string): Stage | null {
  const route = DIRECT[`${source}-${target}`];
  return route ? { model: route.model, source, target, prefix: route.prefix } : null;
}

/**
 * Chooses the lightest route: a direct OPUS model, then two OPUS models through
 * English (loaded one at a time), then NLLB. Returns [] for same-language text
 * and null when no model covers the pair.
 */
export function translationPlan(source: string, target: string): Stage[] | null {
  if (source === target) return [];
  const single = direct(source, target);
  if (single) return [single];
  if (source !== "en" && target !== "en") {
    const first = direct(source, "en");
    const second = direct("en", target);
    if (first && second) return [first, second];
  }
  const nllbSource = NLLB_CODES[source];
  const nllbTarget = NLLB_CODES[target];
  if (nllbSource && nllbTarget) {
    return [{ model: NLLB_MODEL, source, target, prefix: "", nllb: { source: nllbSource, target: nllbTarget } }];
  }
  return null;
}

export function planModels(plan: Stage[]) {
  return [...new Map(plan.map((stage) => [stage.model.id, stage.model])).values()];
}

export function planSizeMB(plan: Stage[]) {
  return planModels(plan).reduce((sum, model) => sum + model.sizeMB, 0);
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
  const cached = await Promise.all(planModels(plan).map(isModelCached));
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

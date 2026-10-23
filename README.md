# Verta

Verta is a private, installable translation workspace for documents and images.
Every language pair runs on **small open-weight translation models on your CPU**,
directly inside the browser. No API key, account, server inference, GPU, browser
translation API, or file upload is required.

## Local translation engine

Verta offers 35 languages. Each pair is routed to the lightest local option:

| Route | When | Download (8-bit weights) |
| --- | --- | --- |
| Direct OPUS-MT model | A small model exists for the pair, e.g. English ↔ Arabic, English → French, Japanese → English | about 100–130 MB per direction |
| Two OPUS-MT models through English | Both legs exist, e.g. French → German, Japanese → Arabic | about 210–260 MB; loaded one at a time |
| [NLLB-200 distilled 600M](https://huggingface.co/Xenova/nllb-200-distilled-600M) | No OPUS route, e.g. English → Japanese, Korean, Turkish, Portuguese, Hebrew, Tamil | about 895 MB, shared by all such pairs |

The 38 OPUS-MT models are [Xenova](https://huggingface.co/Xenova) ONNX conversions
of Helsinki-NLP models (36 Apache-2.0, 3 CC-BY-4.0: en→de, ru→en, zh→en).
**NLLB-200 is CC-BY-NC-4.0 (non-commercial).** Every model revision and
Transformers.js 3.8.1 are pinned in `app/local-translation/models.ts`, and a
unit test checks that every pair offered in the UI has a route.

The **6 GB total system RAM target** is supported by a conservative configuration:

- 8-bit model weights, CPU/WASM execution, and a single inference thread.
- One translation worker/model at a time, released after completion or cancel.
  An English pivot finishes the first model and frees it before loading the second.
- OCR/PDF extraction finishes before any translation model loads.
- One sentence at a time, at most 192 source tokens including the language
  prefix. These models are trained on sentence pairs and can drop sentences
  when given a multi-sentence block, so Verta never sends one.
- Greedy decoding (`num_beams: 1`) and a 384-token output limit.
- An output-limit error is shown instead of silently accepting truncated text.

Download size is not runtime RAM usage. Available RAM, browser overhead, document
size, and image OCR also matter. NLLB-200 needs noticeably more memory than the
OPUS-MT models. A 6 GB device is the design target, not a hard memory guarantee.
Close memory-heavy tabs and process large files separately.

These are sentence-level translation models, not general-purpose chat LLMs.
They can miss idioms, terminology, and context across sentences, and a pivot
through English can lose nuance. Multi-target OPUS models get a target prefix
(`>>ara<<`, `>>cmn_Hans<<`, `>>cmn_Hant<<`, `>>vie<<`). Preferred terminology uses
best-effort text replacement, not constrained decoding or document-wide reasoning.

## First use and offline use

1. Open Verta in a current browser with WebAssembly and Web Workers, over HTTPS
   or localhost. No browser translation feature or extension is needed.
2. Choose the source and target languages. The status line shows the route and
   the one-time download size for that pair.
3. The first translation in a direction downloads its model(s) from Hugging Face.
   Only model assets are fetched; source and translated text stay on the device.
4. After a successful translation, those models are cached. Keep site data and
   revisit the same app URL to reuse them offline. Prepare every direction you
   need while online.
5. Use each required file type online once too, so the app can cache its parser,
   export, and OCR assets. A cached translation model alone does not prepare an
   unused file parser or OCR language.

Browser storage eviction, private browsing, or clearing site data can remove
cached assets. The status checks actual model cache entries and does not rely
on a permanent “downloaded” flag. If a download was interrupted, connect and
retry.

## Supported files

- PDF, DOCX, PPTX, ODT, RTF, plain text, Markdown, and CSV
- PNG, JPG, JPEG, and WebP images with English or Arabic source text
- Word (`.docx`) and plain-text output

Legacy binary `.doc` and `.ppt` files are not supported in offline mode.
Document sections are reconstructed as text; complex source-page layout is
not preserved. Scanned PDFs need OCR outside the PDF text-extraction path.

## Run locally

Requirements: Node.js 22.13+ and pnpm 11+.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by the server. Build scripts bundle the translation
worker and copy its WASM runtime, PDF worker, and OCR assets into `public/offline`.
Weights are downloaded on demand, not bundled into the repository or site build.
The optional native `onnxruntime-node` install script is disabled because the
application uses the browser's WASM backend.

## Checks

```bash
pnpm run typecheck
pnpm run lint
pnpm test
NEXT_PUBLIC_STATIC_EXPORT=true pnpm run build:github
```

The `Verify Verta` GitHub Actions workflow runs these on every push, plus
`pnpm run test:browser`: the real pinned models in Chromium with the browser's
own `Translator` API removed. It covers English ↔ Arabic, a direct route
(English → French), an English pivot (French → German), and NLLB-200
(English → Japanese), an offline reload, long numbered input that fails if any
sentence is missing, and cancel-then-restart.

The unit suite covers sentence and token-budget splitting without source loss, output-limit
handling, worker cancellation and cleanup, one active model, cache eviction,
engine routing, same-language extraction, and offline error handling. Unit
worker doubles exercise the application contract; they do not measure model
quality. See [model validation](docs/compact-model-validation.md) for real-model
smoke tests and their limits.

## GitHub Pages

The included workflow publishes the static app whenever `main` is pushed.
GitHub Pages must use **GitHub Actions** as its publishing source. The worker
and WASM assets respect the repository subpath.

# Verta

Verta is a private, installable translation workspace for documents and images.
English ↔ Arabic uses **small open-weight OPUS-MT models on your CPU**, directly
inside the browser. No API key, account, server inference, GPU, or file upload is
required. Other language pairs retain the browser's built-in Translator API.

## Compact English–Arabic engine

| Direction | Model | Quantized encoder + decoder |
| --- | --- | --- |
| English → Arabic | [Xenova/opus-mt-en-ar](https://huggingface.co/Xenova/opus-mt-en-ar) | 110.85 MB |
| Arabic → English | [Xenova/opus-mt-ar-en](https://huggingface.co/Xenova/opus-mt-ar-en) | 110.88 MB |

These are ONNX conversions of Helsinki-NLP's Apache-2.0-licensed
[English → Arabic](https://huggingface.co/Helsinki-NLP/opus-mt-en-ar) and
[Arabic → English](https://huggingface.co/Helsinki-NLP/opus-mt-ar-en) models.
The app pins model revisions and Transformers.js 3.8.1. Tokenizer/config files
add a few MB per direction; the bundled WASM runtime is additional.

The **6 GB total system RAM target** is supported by a conservative configuration:

- 8-bit model weights, CPU/WASM execution, and a single inference thread.
- One translation worker/model at a time, released after completion or cancel.
- OCR/PDF extraction finishes before the compact model loads.
- One sentence at a time, at most 192 source tokens including the language
  prefix. These models are trained on sentence pairs and can drop sentences
  when given a multi-sentence block, so Verta never sends one.
- Greedy decoding (`num_beams: 1`) and a 384-token output limit.
- An output-limit error is shown instead of silently accepting truncated text.

Download size is not runtime RAM usage. Available RAM, browser overhead, document
size, and image OCR also matter. A 6 GB device is the design target, not a hard
memory guarantee. Close memory-heavy tabs and process large files separately.

These are sentence-level translation models, not general-purpose chat LLMs.
They can miss idioms, terminology, and context across chunks. English → Arabic
uses the `>>ara<<` target prefix. Preferred terminology uses best-effort text
replacement, not constrained model decoding or document-wide reasoning.

## First use and offline use

1. Open Verta in a current browser with WebAssembly and Web Workers, over HTTPS
   or localhost. English ↔ Arabic does **not** need Chrome's Translator API.
2. Choose English → Arabic or Arabic → English, upload a file, and translate.
3. The first use downloads that direction's model from Hugging Face. Only model
   assets are fetched; source and translated text stay on the device.
4. After a successful translation, that direction's model is cached. Keep site
   data and revisit the same app URL to reuse the model offline. Prepare both
   directions online if you need both offline.
5. Use each required file type online once too, so the app can cache its parser,
   export, and OCR assets. A cached translation model alone does not prepare an
   unused file parser or OCR language.

Browser storage eviction, private browsing, or clearing site data can remove
cached assets. The status checks actual model cache entries and does not rely
on a permanent “downloaded” flag. If a download was interrupted, connect and
retry. Supported desktop Chrome versions use their own language packs for
other language pairs; Verta explicitly reports when those are unavailable.

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
`pnpm run test:browser`: the real pinned models in Chromium, both directions,
an offline reload, long numbered input that fails if any sentence is missing,
and cancel-then-restart.

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

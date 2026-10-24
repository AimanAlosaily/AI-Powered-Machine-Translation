# Verta

Verta is a private, installable Arabic ↔ English translation workspace for
documents and images. Translation runs on **small open-weight models on your
CPU**, directly inside the browser. No API key, account, server inference, GPU,
browser translation feature, or file upload is required.

## Translation engine

| Direction | Model | 8-bit encoder + decoder |
| --- | --- | --- |
| English → Arabic | [Xenova/opus-mt-en-ar](https://huggingface.co/Xenova/opus-mt-en-ar) | 110.9 MB |
| Arabic → English | [Xenova/opus-mt-ar-en](https://huggingface.co/Xenova/opus-mt-ar-en) | 110.9 MB |

These are ONNX conversions of Helsinki-NLP's Apache-2.0-licensed
[English → Arabic](https://huggingface.co/Helsinki-NLP/opus-mt-en-ar) and
[Arabic → English](https://huggingface.co/Helsinki-NLP/opus-mt-ar-en) OPUS-MT
models. Model revisions and Transformers.js 3.8.1 are pinned in
`app/local-translation/models.ts`. Tokenizer/config files add a few MB per
direction; the bundled WASM runtime is additional.

The **6 GB total system RAM target** is supported by a conservative configuration:

- 8-bit model weights, CPU/WASM execution, and a single inference thread.
- One translation worker/model at a time, released after completion or cancel.
- OCR/PDF extraction finishes before the translation model loads.
- One sentence at a time, at most 192 source tokens including the language
  prefix. These models are trained on sentence pairs and can drop sentences
  when given a multi-sentence block, so Verta never sends one.
- Greedy decoding (`num_beams: 1`) and a 384-token output limit.
- An output-limit error is shown instead of silently accepting truncated text.

In CI (headless Chromium on Linux), the whole browser peaked at roughly 1 GB of
proportional memory (PSS) while translating, sampled every 250 ms. That is a
measurement on a CI machine, not a benchmark on a 6 GB device: available RAM,
the operating system, other tabs, document size, and image OCR all matter.
Close memory-heavy tabs and process large files separately.

These are sentence-level translation models, not general-purpose chat LLMs.
They can miss idioms, terminology, and context across sentences, and they
sometimes write small numbers as words. English → Arabic uses the `>>ara<<`
target prefix. Preferred terminology uses best-effort text replacement, not
constrained decoding or document-wide reasoning.

## First use and offline use

1. Open Verta in a current browser with WebAssembly and Web Workers, over HTTPS
   or localhost. No browser translation feature or extension is needed.
   Optionally install it as an app from the browser menu.
2. On the first visit the service worker saves every file of the app,
   including the PDF reader, image OCR (English and Arabic) and Word exporter,
   so all features work offline later, not only the ones already used.
3. While online, press **Save both · 222 MB** to download both translation
   models from Hugging Face. (Translating in a direction also downloads that
   direction's model.) Only model files are fetched; your documents and
   translations never leave the device.
4. When the panel says both directions are saved, Verta translates Arabic ↔
   English with no internet. Keep site data so the browser keeps the files.

Browser storage eviction, private browsing, or clearing site data can remove
saved files. The status checks the actual cached model files and does not rely
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
own `Translator` API removed. It covers both directions online, an offline
reload, the **Save both** button followed by a first-ever Arabic → English job
offline, long numbered input that fails if any sentence is missing, a `.docx`
upload and Word export while offline, and cancel-then-restart.

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

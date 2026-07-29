# Verta

Verta is a private, installable translation workspace for documents and
images. It uses the desktop browser's built-in translation model, so there is
no API key, account, usage bill, or file upload.

## How offline mode works

1. Open Verta in a compatible desktop browser.
2. Choose a source and target language.
3. The first translation downloads that browser-managed language pack.
4. After the pair is ready, the installed app can translate with the internet
   disconnected.

The application shell is cached by a service worker. PDF and document parsing,
English/Arabic image OCR, glossary handling, integrity checks, and downloads all
run locally.

## Supported files

- PDF, DOCX, PPTX, ODT, RTF, plain text, Markdown, and CSV
- PNG, JPG, JPEG, and WebP images with English or Arabic source text
- Word (`.docx`) and plain-text output

Legacy binary `.doc` and `.ppt` files are not supported in offline mode.

## Browser requirements

Offline translation requires a desktop browser that implements the
`Translator` API. Chrome supports it in stable releases from version 138. The
app detects unsupported browsers and unavailable language pairs before a file
is processed.

Translation packs and OCR assets need an internet connection the first time
they are used on a device. Once cached, they remain local and can be reused
offline.

## Privacy and quality tradeoff

Files and translated text never leave the browser. Removing the cloud model
also removes its advanced audience, tone, and semantic-review capabilities.
Verta preserves section order, applies user terminology, and compares numeric
item counts, but important legal, medical, financial, or safety-critical text
still needs professional review.

## Run locally

Requirements: Node.js 22+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

Open the local URL printed by the development server. The build scripts copy
the bundled PDF and OCR assets into the static app automatically.

## GitHub Pages

The included workflow publishes the static app whenever `main` is pushed.
GitHub Pages must use **GitHub Actions** as its publishing source.

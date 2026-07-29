# Verta

Verta is a local-first, context-aware AI translation workspace for documents
and images. It reads the complete file before translating so terminology, tone,
audience, names, numbers, and structure stay consistent.

## What it supports

- PDF, Word, PowerPoint, RTF, ODT, plain text, Markdown, and CSV
- PNG, JPG, JPEG, and WebP images
- 30+ target languages, including right-to-left Word output
- Audience/domain controls, tone controls, background context, and a glossary
- A quality report with terminology decisions and review flags
- Word (`.docx`) and plain-text downloads

## Run locally

Requirements: Node.js 22+ and pnpm 11+.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, add your own OpenAI API key in the app, choose a
file and target language, then translate.

The key is held only in the current browser tab. Files are sent directly from
the browser to the OpenAI Responses API and are not stored by Verta. The app
sets `store: false` on translation requests.

## GitHub Pages

The included workflow publishes the static app automatically whenever `main`
is pushed. In the repository settings, set **Pages → Source** to **GitHub
Actions** if it is not already selected.

## Translation approach

Verta uses GPT-5.6 through the Responses API. Its translation brief requires a
whole-file context pass before terminology is chosen, complete translation
without summarization, preservation of meaningful details, and a semantic
quality check before the result is returned.

Machine translation can still require professional review for legal, medical,
financial, or safety-critical material.

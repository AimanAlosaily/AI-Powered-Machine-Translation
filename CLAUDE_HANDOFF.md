# Verta compact local translation handoff

The user requested a very small open-weight translation component for a device with **6 GB total RAM**, then explicitly requested an immediate GitHub push so Claude can continue.

## Current implementation

- English ↔ Arabic automatically uses q8 OPUS-MT models via Transformers.js 3.8.1 in a dedicated Web Worker. Each direction has about 111 MB of ONNX weights plus tokenizer/config files.
- Exact model revisions are pinned in `app/local-translation/models.ts`.
- Other languages keep the existing browser Translator API.
- CPU/WASM, one thread, one worker/model at a time, 192-token input chunks, greedy decoding, 384-token output cap. The worker is terminated after completion or cancellation.
- OCR/PDF extraction completes before loading the compact model to avoid overlapping those memory allocations.
- English → Arabic uses the required `>>ara<<` prefix. Chunking uses the actual tokenizer and does not truncate source text. Output hitting the generation cap is rejected.
- Model cache readiness checks all six pinned files rather than a saved boolean.
- Worker/runtime are bundled by `scripts/prepare-offline-assets.mjs` into ignored `public/offline/`; no weights are checked into git.
- UI copy, status, cancellation race handling, README, tests, and lockfile have been updated.

## GitHub push blocker

The immediate push was attempted but did not reach GitHub: the GitHub integration returned HTTP 403 (`Resource not accessible by integration`) for the tree write, and Git CLI had no HTTPS credentials. The checkpoint is committed locally and exported as a ZIP with full source, a Git bundle, and a patch. Reauthorize repository write access, then push the checkpoint branch.

## Next action

Read `docs/compact-model-validation.md` first. Finish the real browser/offline regression test before merging or deploying. A first test successfully translated online but failed offline because the worker script was missing from the service-worker cache. A fix now explicitly precaches the worker and WASM files; its full end-to-end rerun remains unconfirmed. The new regression test initially timed out on an overly strict field-label selector; those selectors have been changed to `.field-grid select` and still need rerunning.

The source is committed locally on `feat/compact-local-translation`, based on the repository's original `main`. Do not assume these changes are merged or live.

Use `pnpm run test:browser` after building the static export with the repository base path. The test exercises both directions, offline reload, long input, and cancellation/restart. It optionally samples total Chromium RSS on Linux; do not describe that as a real 6 GB device benchmark.

Known tradeoffs: sentence-level models have limited document context; glossary handling is inherited best-effort replacement, not constrained decoding. Model downloads need internet on first use. Parser/OCR/export assets also need their first online use. No cloud AI key is necessary.

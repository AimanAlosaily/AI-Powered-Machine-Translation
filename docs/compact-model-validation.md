# Validation checkpoint — 23 October 2026

Implemented in branch `feat/compact-local-translation`.

## Passed

- 9 unit tests: source-preserving token splitting, output-cap rejection, pair routing, abort during loading, single resident worker, teardown, actual cache-entry checking, same-language extraction, and uncached/offline failure.
- TypeScript typecheck.
- ESLint after excluding generated offline assets and fixing existing effect state updates.
- Vinext production build and 2 server-rendering tests.
- Next.js static export with `/AI-Powered-Machine-Translation` as the base path.
- Real English → Arabic q8 inference in Node CPU mode: “The meeting is tomorrow at ten in the morning.” → “الاجتماع غداً في العاشرة صباحاً”. Node maxRSS was about 607 MiB; this is NOT a browser or 6 GB device benchmark.
- Real English → Arabic inference in headless Chromium through the built app produced the same translation. All 6 pinned model files were present in the browser's `transformers-cache`.

## Pending / regression found

The first browser offline reload test failed because the model files were cached but the translation worker script could be absent from the app cache. `public/sw.js` now explicitly precaches the translation worker and WASM runtime and uses `event.waitUntil` for cache writes. The complete browser regression test has been started but was not yet confirmed at this checkpoint.

Re-run both directions online, then reload offline and test both directions, long text, cancellation followed by another job, and browser memory use. The repeatable test is `tests/compact-model.browser.mjs`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
NEXT_PUBLIC_BASE_PATH=/AI-Powered-Machine-Translation NEXT_PUBLIC_STATIC_EXPORT=true pnpm run build:github
pnpm exec playwright install chromium
pnpm run test:browser
```

`test:browser` downloads both real models (about 228 MB plus runtime assets). `CHROMIUM_EXECUTABLE_PATH` can select an installed Chromium. `TEST_BASE_PATH` defaults to `/AI-Powered-Machine-Translation`. Optional `BROWSER_TEST_PROFILE` retains a test profile; otherwise the temporary profile is deleted. `TEST_IGNORE_HTTPS_ERRORS=true` exists only for test environments with a TLS-intercepting proxy and is not an application setting.

No translation-quality benchmark or full 6 GB hardware benchmark has been performed. OCR/export flows were preserved but have not been re-tested end to end with the new model.

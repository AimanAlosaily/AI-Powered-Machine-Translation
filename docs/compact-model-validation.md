# Validation — Arabic ↔ English on open-weight models

Branch `feat/compact-local-translation`, verified 23 October 2026 by the
`Verify Verta` GitHub Actions workflow (`.github/workflows/verify.yml`), which
runs on every push.

## What the workflow checks

**Lint, unit tests, builds, typecheck** — ESLint, 11 unit tests, the Vinext
production build with its server-rendering tests, the GitHub Pages static export
with the repository base path, and `tsc`.

The unit tests cover sentence and token-budget splitting without losing source
text, output-limit rejection, routing (only English → Arabic and Arabic →
English, to the pinned revisions), one resident worker, cancellation and
teardown, cache-entry checks and eviction, translating with no browser
`Translator` API, the **Save both** download, same-language extraction, and the
uncached-offline error. Worker doubles exercise the app's contract; they do
not measure translation quality.

**Real models in Chromium** (`pnpm run test:browser`) — serves the static
export, deletes `Translator` and `LanguageDetector` from the page before the
app loads, then:

1. English → Arabic online (downloads that model during the translation).
2. **Save both** downloads Arabic → English without translating.
3. Goes offline and reloads. The first-ever Arabic → English job runs offline.
4. Both directions again offline.
5. 40 numbered English sentences → Arabic and 30 numbered Arabic sentences →
   English; fails if any number is missing (number words accepted).
6. A generated `.docx` → Arabic, then **Download Word file**; checks the
   exported file contains Arabic. Still offline.
7. Starts a 400-sentence job, cancels it, then translates again.

## Results (run of commit `61c3531`)

| Input | Output |
| --- | --- |
| The meeting is tomorrow at ten in the morning. | الاجتماع غداً في العاشرة صباحاً |
| هذا البرنامج يترجم المستندات على جهازك دون إرسالها إلى الإنترنت. (offline, first Arabic → English job) | This program translates documents on your computer without sending them online. |
| Thank you for your help. (offline) | شكراً لمساعدتك |
| شكرا على مساعدتك. (offline) | Thanks for your help. |
| 40 numbered English sentences | all 40 numbers present |
| 30 numbered Arabic sentences | all 30 present ("Bill number one … seven, 8, 9 …") |
| report.docx: "Sales grew by 12 percent this quarter…" | المبيعات زادت بنسبة 12% هذا الربع … — exported as a Word file |

Browser memory, as the sum of proportional set size (PSS) over all Chromium
processes, sampled every 250 ms:

| Moment | Memory |
| --- | --- |
| App open, before any translation | 262 MB |
| One translation, peak | 1.0–1.2 GB |
| New job started right after cancelling one, brief peak | up to about 3 GB |
| 8 s after the last job | 959 MB |

Runs vary by a few hundred MB; earlier runs showed similar short-lived 2–3 GB
peaks when jobs ran back to back, falling back afterward. These are measurements
on a Linux CI machine, **not a benchmark on a 6 GB device**.

## Problems found and fixed during validation

- **Dropped sentences.** Feeding the model 192-token blocks returned 26 of 40
  sentences. Verta now translates one sentence per model call.
- **Offline gaps.** The Word exporter (and PDF/OCR code) loaded on demand, so it
  failed offline if never used online, silently. The build now lists every app
  file in `offline-manifest.json` for the service worker to save on the first
  visit, and a failed export shows an error.
- **Multilingual attempt, reverted.** Supporting 35 languages without the
  browser API needed NLLB-200 (600M) for many pairs; it peaked at 4.2–5.7 GB even
  with lean ONNX Runtime options, so it cannot meet the 6 GB target. The app is
  Arabic ↔ English only.

## Not verified

- A real device with 6 GB of RAM, or browsers other than Chromium.
- Translation quality beyond the samples above (no benchmark was run).
- PDF text extraction and image OCR end to end with the new model (their code
  paths are unchanged and are now saved for offline use).

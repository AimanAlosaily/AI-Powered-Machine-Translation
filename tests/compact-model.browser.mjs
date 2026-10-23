// Opt-in integration test: downloads real pinned models (about 228 MB total).
// Build the GitHub Pages export first; run with pnpm run test:browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve('out');
const prefix = process.env.TEST_BASE_PATH ?? '/AI-Powered-Machine-Translation';
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    assert.ok(pathname.startsWith(prefix + '/'));
    let file = resolve(root, '.' + pathname.slice(prefix.length));
    assert.ok(file === root || file.startsWith(root + sep));
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const profile = process.env.BROWSER_TEST_PROFILE ?? await mkdtemp(resolve(tmpdir(), 'verta-browser-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
  // Only for a test environment with an intercepting TLS proxy; never app settings.
  ignoreHTTPSErrors: process.env.TEST_IGNORE_HTTPS_ERRORS === 'true',
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
});
const page = context.pages()[0] ?? await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = `http://127.0.0.1:${server.address().port}${prefix}/`;
const samples = [];
// Memory: proportional set size (PSS) from /proc, so pages shared between
// Chromium processes are split rather than counted once per process. Peaks are
// tracked per translation and per process type (browser, renderer, utility…).
let overallPeakMiB = 0;
let peak = { totalMiB: 0, byType: {} };
let sampling = false;
const cdp = await context.browser().newBrowserCDPSession();
const memoryTimer = setInterval(async () => {
  if (sampling) return;
  sampling = true;
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    let totalKiB = 0;
    const byType = {};
    for (const { id, type } of processInfo) {
      try {
        const rollup = await readFile(`/proc/${id}/smaps_rollup`, 'utf8');
        const kib = Number(rollup.match(/^Pss:\s+(\d+)/m)?.[1] ?? 0);
        totalKiB += kib;
        byType[type] = (byType[type] ?? 0) + kib;
      } catch { /* The process may have exited between samples. */ }
    }
    const totalMiB = totalKiB / 1024;
    overallPeakMiB = Math.max(overallPeakMiB, totalMiB);
    if (totalMiB > peak.totalMiB) {
      peak = { totalMiB, byType: Object.fromEntries(Object.entries(byType).map(([key, value]) => [key, Math.round(value / 1024)])) };
    }
  } catch { /* PSS sampling is Linux-only and nonessential to the test. */ }
  finally { sampling = false; }
}, 250);

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function assertEveryNumber(output, count, label) {
  // Accept Arabic-Indic and Persian digits, and small numbers written as English
  // words ("Bill number one"), as well as Latin digits.
  const latin = output
    .replace(/[٠-٩۰-۹]/gu, (digit) => String((digit.codePointAt(0) & 0xf)))
    .replace(new RegExp(`\\b(${NUMBER_WORDS.join('|')})\\b`, 'giu'), (word) => String(NUMBER_WORDS.indexOf(word.toLowerCase())));
  const found = new Set((latin.match(/\d+/gu) ?? []).map(Number));
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !found.has(n));
  assert.deepEqual(missing, [], `${label}: sentences missing from the translation`);
}

async function translate(name, source, target, text, expectedScript) {
  await page.locator('.field-grid select').nth(0).selectOption(source);
  await page.locator('.field-grid select').nth(1).selectOption(target);
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  const started = Date.now();
  peak = { totalMiB: 0, byType: {} };
  await page.getByRole('button', { name: 'Translate on this device', exact: true }).click();
  await page.locator('.result-section, .error-banner').waitFor({ timeout: 300000 });
  if (await page.locator('.error-banner').count()) throw new Error(await page.locator('.error-banner').innerText());
  const output = await page.locator('.document-preview').innerText();
  assert.match(output, expectedScript);
  assert.ok(output.trim().length > 0);
  samples.push({ name, source, target, input: text, output, elapsedMs: Date.now() - started, peakPssMiB: Math.round(peak.totalMiB), peakPssByTypeMiB: peak.byType });
  console.log(JSON.stringify(samples.at(-1)));
}

try {
  // Remove any built-in browser translation API: Verta must not depend on it.
  await context.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'Translator');
    Reflect.deleteProperty(globalThis, 'LanguageDetector');
  });
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await translate('meeting.txt', 'English', 'Arabic', 'The meeting is tomorrow at ten in the morning.', /[\u0600-\u06ff]/u);
  await translate('arabic.txt', 'Arabic', 'English', 'هذا البرنامج يترجم المستندات على جهازك دون إرسالها إلى الإنترنت.', /[A-Za-z]/u);
  // The other routes: a direct small model, two small models through English,
  // and the NLLB-200 fallback. None of them may use a browser translator API.
  assert.equal(await page.evaluate(() => typeof globalThis.Translator), 'undefined');
  await translate('en-fr.txt', 'English', 'French', 'The meeting is tomorrow at ten in the morning.', /[A-Za-zÀ-ÿ]/u);
  assert.notEqual(samples.at(-1).output.trim(), samples.at(-1).input);
  await translate('fr-de.txt', 'French', 'German', 'Merci beaucoup pour votre aide.', /[A-Za-zÄÖÜäöüß]/u);
  assert.notEqual(samples.at(-1).output.trim(), samples.at(-1).input);
  await translate('en-ja.txt', 'English', 'Japanese', 'Thank you for your help.', /[぀-ヿ一-鿿]/u);
  // A fresh worker and a reloaded page must both work without network access.
  await context.setOffline(true);
  await page.reload();
  await translate('offline-en.txt', 'English', 'Arabic', 'Thank you for your help.', /[\u0600-\u06ff]/u);
  await translate('offline-ar.txt', 'Arabic', 'English', 'شكرا على مساعدتك.', /[A-Za-z]/u);
  await translate('offline-en-ja.txt', 'English', 'Japanese', 'The meeting is tomorrow.', /[぀-ヿ一-鿿]/u);
  await translate('offline-fr-de.txt', 'French', 'German', 'La réunion est demain.', /[A-Za-zÄÖÜäöüß]/u);
  // Numbered sentences prove completeness: an omitted sentence loses its number.
  // (A length check passed while 14 of 40 repeated sentences were dropped.)
  await translate('long.txt', 'English', 'Arabic', Array.from({ length: 40 }, (_, i) => `Invoice number ${i + 1} was paid on time.`).join(' '), /[\u0600-\u06ff]/u);
  assertEveryNumber(samples.at(-1).output, 40, 'English \u2192 Arabic long input');
  await translate('long-ar.txt', 'Arabic', 'English', Array.from({ length: 30 }, (_, i) => `\u062a\u0645 \u062f\u0641\u0639 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0631\u0642\u0645 ${i + 1} \u0641\u064a \u0627\u0644\u0648\u0642\u062a \u0627\u0644\u0645\u062d\u062f\u062f.`).join(' '), /[A-Za-z]/u);
  assertEveryNumber(samples.at(-1).output, 30, 'Arabic \u2192 English long input');
  // Start a real long job, cancel, and prove a new worker can run afterward.
  await page.locator('input[type=file]').setInputFiles({ name: 'cancel.txt', mimeType: 'text/plain', buffer: Buffer.from('Please translate this sentence. '.repeat(400)) });
  await page.getByRole('button', { name: 'Translate on this device', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await translate('after-cancel.txt', 'English', 'Arabic', 'Hello world.', /[\u0600-\u06ff]/u);
  assert.deepEqual(errors, []);
  await mkdir('work', { recursive: true });
  await page.screenshot({ path: 'work/compact-model-browser.png', fullPage: true });
  console.log(JSON.stringify({ passed: true, samples: samples.length, browser: context.browser().version(), peakBrowserPssMiB: Math.round(overallPeakMiB), note: 'Sum of Linux PSS over all Chromium processes, sampled every 250 ms; short spikes between samples can be missed. Not a 6 GB device benchmark or quality benchmark.' }));
} finally {
  clearInterval(memoryTimer);
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  if (!process.env.BROWSER_TEST_PROFILE) await rm(profile, { recursive: true, force: true });
}

// Opt-in integration test: downloads both pinned models (about 222 MB total).
// Build the GitHub Pages export first; run with pnpm run test:browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
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
let latestMiB = 0;
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
    latestMiB = totalMiB;
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

// Draws text on a white canvas in the page and returns it as a PNG, so image
// OCR can be tested with known words.
async function textImage(lines, { rtl = false } = {}) {
  const dataUrl = await page.evaluate(({ lines, rtl }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 80 + lines.length * 90;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111111';
    context.font = '48px Arial, "Segoe UI", "DejaVu Sans", "Noto Sans Arabic", sans-serif';
    context.direction = rtl ? 'rtl' : 'ltr';
    context.textAlign = rtl ? 'right' : 'left';
    lines.forEach((line, index) => context.fillText(line, rtl ? canvas.width - 60 : 60, 90 + index * 90));
    return canvas.toDataURL('image/png');
  }, { lines, rtl });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function translate(name, source, target, text, expectedScript, file) {
  await page.locator('.field-grid select').nth(0).selectOption(source);
  await page.locator('.field-grid select').nth(1).selectOption(target);
  await page.locator('input[type=file]').setInputFiles(file ? { name, ...file } : { name, mimeType: 'text/plain', buffer: Buffer.from(text) });
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
  return output;
}

try {
  // Remove any built-in browser translation API: Verta must not depend on it.
  await context.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'Translator');
    Reflect.deleteProperty(globalThis, 'LanguageDetector');
  });
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForTimeout(2000);
  const baselinePssMiB = Math.round(latestMiB);
  await translate('meeting.txt', 'English', 'Arabic', 'The meeting is tomorrow at ten in the morning.', /[\u0600-\u06ff]/u);
  // Translator was removed from the page above; Verta must not need it.
  assert.equal(await page.evaluate(() => typeof globalThis.Translator), 'undefined');
  // "Save both" must fetch Arabic → English without translating in that
  // direction, so the first Arabic → English job below runs offline.
  await page.getByRole('button', { name: /Save both/ }).click();
  await page.getByText('Both directions are saved', { exact: false }).waitFor({ timeout: 300000 });
  // A fresh worker and a reloaded page must both work without network access.
  await context.setOffline(true);
  await page.reload();
  await page.getByText('Both directions are saved', { exact: false }).waitFor({ timeout: 30000 });
  await translate('arabic.txt', 'Arabic', 'English', 'هذا البرنامج يترجم المستندات على جهازك دون إرسالها إلى الإنترنت.', /[A-Za-z]/u);
  await translate('offline-en.txt', 'English', 'Arabic', 'Thank you for your help.', /[\u0600-\u06ff]/u);
  await translate('offline-ar.txt', 'Arabic', 'English', 'شكرا على مساعدتك.', /[A-Za-z]/u);
  // Image OCR, offline: English → English returns the OCR text itself, so the
  // words can be checked; English → Arabic translates it.
  const notice = { mimeType: 'image/png', buffer: await textImage(['The meeting is tomorrow at ten.', 'Please bring the signed contract.']) };
  const ocrText = await translate('notice.png', 'English', 'English', '[image]', /meeting/iu, notice);
  assert.match(ocrText, /contract/iu, 'OCR missed the second line');
  await translate('notice-ar.png', 'English', 'Arabic', ocrText, /[\u0600-\u06ff]/u, notice);
  // Real photos from Wikimedia Commons (CC BY-SA 3.0): an Arabic information
  // sign at Ancient Acre (by Yuval Y) and an Irish occupiers' liability notice
  // (by Jnestorius). Each is read alone (same language) and translated. Skipped
  // with a note if Wikimedia cannot be reached; OCR quality is logged.
  const photos = [
    ['acre-sign.jpg', 'https://upload.wikimedia.org/wikipedia/commons/4/40/Ancient_Acre_Hill_sign_-_Arabic.jpg', 'Arabic', 'English', /[A-Za-z]/u],
    ['ireland-notice.jpg', 'https://upload.wikimedia.org/wikipedia/commons/1/12/Occupiers_Liability_Warning_Notice_Ireland.JPG', 'English', 'Arabic', /[\u0600-\u06ff]/u],
  ];
  for (const [name, photoUrl, source, target, script] of photos) {
    let buffer;
    try {
      const response = await fetch(photoUrl, { headers: { 'User-Agent': 'VertaCI/1.0 (https://github.com/AimanAlosaily/AI-Powered-Machine-Translation)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      buffer = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      console.log(JSON.stringify({ skipped: name, reason: String(error) }));
      continue;
    }
    const photo = { mimeType: 'image/jpeg', buffer };
    await translate(`${name} (OCR only)`, source, source, '[photo]', source === 'Arabic' ? /[\u0600-\u06ff]/u : /[A-Za-z]/u, photo);
    await translate(name, source, target, '[photo]', script, photo);
  }
  // Numbered sentences prove completeness: an omitted sentence loses its number.
  // (A length check passed while 14 of 40 repeated sentences were dropped.)
  await translate('long.txt', 'English', 'Arabic', Array.from({ length: 40 }, (_, i) => `Invoice number ${i + 1} was paid on time.`).join(' '), /[\u0600-\u06ff]/u);
  assertEveryNumber(samples.at(-1).output, 40, 'English \u2192 Arabic long input');
  await translate('long-ar.txt', 'Arabic', 'English', Array.from({ length: 30 }, (_, i) => `\u062a\u0645 \u062f\u0641\u0639 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0631\u0642\u0645 ${i + 1} \u0641\u064a \u0627\u0644\u0648\u0642\u062a \u0627\u0644\u0645\u062d\u062f\u062f.`).join(' '), /[A-Za-z]/u);
  assertEveryNumber(samples.at(-1).output, 30, 'Arabic \u2192 English long input');
  // A Word document in, a Word document out, still offline.
  const docx = zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p><w:p><w:r><w:t>Sales grew by 12 percent this quarter. The team will meet again next month.</w:t></w:r></w:p></w:body></w:document>'),
  });
  await page.locator('.field-grid select').nth(0).selectOption('English');
  await page.locator('.field-grid select').nth(1).selectOption('Arabic');
  await page.locator('input[type=file]').setInputFiles({ name: 'report.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from(docx) });
  await page.getByRole('button', { name: 'Translate on this device', exact: true }).click();
  await page.locator('.result-section, .error-banner').waitFor({ timeout: 300000 });
  if (await page.locator('.error-banner').count()) throw new Error(await page.locator('.error-banner').innerText());
  const docxPreview = await page.locator('.document-preview').innerText();
  assert.match(docxPreview, /[؀-ۿ]/u);
  assert.ok(docxPreview.includes('12') || docxPreview.includes('١٢'), 'DOCX translation lost the number 12');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Word file' }).click(),
  ]);
  const exported = unzipSync(new Uint8Array(await readFile(await download.path())));
  const exportedXml = strFromU8(exported['word/document.xml']);
  assert.match(exportedXml, /[؀-ۿ]/u, 'Exported Word file has no Arabic text');
  console.log(JSON.stringify({ name: 'report.docx', output: docxPreview, exportedFile: download.suggestedFilename(), exportedBytes: (await readFile(await download.path())).length }));
  // Start a real long job, cancel, and prove a new worker can run afterward.
  await page.locator('input[type=file]').setInputFiles({ name: 'cancel.txt', mimeType: 'text/plain', buffer: Buffer.from('Please translate this sentence. '.repeat(400)) });
  await page.getByRole('button', { name: 'Translate on this device', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await translate('after-cancel.txt', 'English', 'Arabic', 'Hello world.', /[\u0600-\u06ff]/u);
  assert.deepEqual(errors, []);
  // Memory a few seconds after the last job: shows whether finished workers'
  // memory is returned (lag) or kept (leak).
  await page.waitForTimeout(8000);
  const settledPssMiB = Math.round(latestMiB);
  await mkdir('work', { recursive: true });
  await page.screenshot({ path: 'work/compact-model-browser.png', fullPage: true });
  console.log(JSON.stringify({ passed: true, samples: samples.length, browser: context.browser().version(), peakBrowserPssMiB: Math.round(overallPeakMiB), baselinePssMiB, settledPssMiB, note: 'Sum of Linux PSS over all Chromium processes, sampled every 250 ms; short spikes between samples can be missed. Not a 6 GB device benchmark or quality benchmark.' }));
} finally {
  clearInterval(memoryTimer);
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  if (!process.env.BROWSER_TEST_PROFILE) await rm(profile, { recursive: true, force: true });
}

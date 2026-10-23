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
let sampledRssMiB = 0;
let sampling = false;
const cdp = await context.browser().newBrowserCDPSession();
const memoryTimer = setInterval(async () => {
  if (sampling) return;
  sampling = true;
  try {
    const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
    let totalKiB = 0;
    for (const { id } of processInfo) {
      try {
        const cmdline = await readFile(`/proc/${id}/cmdline`, 'utf8');
        if (!/chrome|chromium/i.test(cmdline)) continue;
        const status = await readFile(`/proc/${id}/status`, 'utf8');
        totalKiB += Number(status.match(/VmRSS:\s+(\d+)/)?.[1] ?? 0);
      } catch { /* The process may have exited between samples. */ }
    }
    sampledRssMiB = Math.max(sampledRssMiB, totalKiB / 1024);
  } catch { /* RSS sampling is Linux-only and nonessential to the test. */ }
  finally { sampling = false; }
}, 500);

async function translate(name, source, target, text, expectedScript) {
  await page.locator('.field-grid select').nth(0).selectOption(source);
  await page.locator('.field-grid select').nth(1).selectOption(target);
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
  const started = Date.now();
  await page.getByRole('button', { name: 'Translate on this device', exact: true }).click();
  await page.locator('.result-section, .error-banner').waitFor({ timeout: 300000 });
  if (await page.locator('.error-banner').count()) throw new Error(await page.locator('.error-banner').innerText());
  const output = await page.locator('.document-preview').innerText();
  assert.match(output, expectedScript);
  assert.ok(output.trim().length > 0);
  samples.push({ name, source, target, input: text, output, elapsedMs: Date.now() - started });
  console.log(JSON.stringify(samples.at(-1)));
}

try {
  await page.goto(url);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await translate('meeting.txt', 'English', 'Arabic', 'The meeting is tomorrow at ten in the morning.', /[\u0600-\u06ff]/u);
  await translate('arabic.txt', 'Arabic', 'English', 'هذا البرنامج يترجم المستندات على جهازك دون إرسالها إلى الإنترنت.', /[A-Za-z]/u);
  // A fresh worker and a reloaded page must both work without network access.
  await context.setOffline(true);
  await page.reload();
  await translate('offline-en.txt', 'English', 'Arabic', 'Thank you for your help.', /[\u0600-\u06ff]/u);
  await translate('offline-ar.txt', 'Arabic', 'English', 'شكرا على مساعدتك.', /[A-Za-z]/u);
  await translate('long.txt', 'English', 'Arabic', 'This application translates documents on your device. '.repeat(40), /[\u0600-\u06ff]/u);
  assert.ok(samples.at(-1).output.length > 400, 'Long input must not be reduced to a single short translation');
  // Start a real long job, cancel, and prove a new worker can run afterward.
  await page.locator('input[type=file]').setInputFiles({ name: 'cancel.txt', mimeType: 'text/plain', buffer: Buffer.from('Please translate this sentence. '.repeat(400)) });
  await page.getByRole('button', { name: 'Translate on this device', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await translate('after-cancel.txt', 'English', 'Arabic', 'Hello world.', /[\u0600-\u06ff]/u);
  assert.deepEqual(errors, []);
  await mkdir('work', { recursive: true });
  await page.screenshot({ path: 'work/compact-model-browser.png', fullPage: true });
  console.log(JSON.stringify({ passed: true, samples: samples.length, browser: context.browser().version(), sampledBrowserRssMiB: sampledRssMiB, note: 'Sum of Linux process RSS, sampled every 500ms; shared pages may be counted twice. Not a 6 GB device benchmark or quality benchmark.' }));
} finally {
  clearInterval(memoryTimer);
  await context.close();
  await new Promise((resolve) => server.close(resolve));
  if (!process.env.BROWSER_TEST_PROFILE) await rm(profile, { recursive: true, force: true });
}

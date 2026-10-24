// End-to-end test of the installed Windows app (run in CI after a silent
// install). Launches Verta.exe through Playwright's Electron driver and checks
// that both directions translate with the bundled models, that long input
// keeps every sentence, and that the app makes no request to any other host.
//
// Usage: VERTA_EXE="C:\...\Verta.exe" node tests/desktop.e2e.mjs
import assert from "node:assert/strict";
import { _electron as electron } from "playwright";

const executablePath = process.env.VERTA_EXE;
if (!executablePath) throw new Error("Set VERTA_EXE to the installed Verta.exe");

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function missingNumbers(output, count) {
  const latin = output
    .replace(/[٠-٩۰-۹]/gu, (digit) => String(digit.codePointAt(0) & 0xf))
    .replace(new RegExp(`\\b(${NUMBER_WORDS.join("|")})\\b`, "giu"), (word) => String(NUMBER_WORDS.indexOf(word.toLowerCase())));
  const found = new Set((latin.match(/\d+/gu) ?? []).map(Number));
  return Array.from({ length: count }, (_, i) => i + 1).filter((n) => !found.has(n));
}

const app = await electron.launch({ executablePath, timeout: 120000 });
const results = [];
try {
  const page = await app.firstWindow();
  const origin = new URL(page.url()).origin;
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, `unexpected app origin ${origin}`);
  const outside = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith(`${origin}/`) && !url.startsWith("blob:") && !url.startsWith("data:")) outside.push(url);
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.locator(".field-grid select").first().waitFor({ timeout: 60000 });
  await page.getByText("Built into this app", { exact: false }).waitFor({ timeout: 30000 });
  await page.getByText("Both models are built into the app", { exact: false }).waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole("button", { name: /Save both/ }).count(), 0, "desktop app must not offer a model download");

  async function translate(name, source, target, text, script) {
    await page.locator(".field-grid select").nth(0).selectOption(source);
    await page.locator(".field-grid select").nth(1).selectOption(target);
    await page.locator("input[type=file]").setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
    const started = Date.now();
    await page.getByRole("button", { name: "Translate on this device", exact: true }).click();
    await page.locator(".result-section, .error-banner").waitFor({ timeout: 300000 });
    if (await page.locator(".error-banner").count()) throw new Error(await page.locator(".error-banner").innerText());
    const output = await page.locator(".document-preview").innerText();
    assert.match(output, script);
    results.push({ name, source, target, output, elapsedMs: Date.now() - started });
    console.log(JSON.stringify(results.at(-1)));
    return output;
  }

  await translate("meeting.txt", "English", "Arabic", "The meeting is tomorrow at ten in the morning.", /[\u0600-\u06ff]/u);
  await translate("arabic.txt", "Arabic", "English", "هذا البرنامج يترجم المستندات على جهازك دون إرسالها إلى الإنترنت.", /[A-Za-z]/u);
  const long = await translate(
    "long.txt", "English", "Arabic",
    Array.from({ length: 20 }, (_, i) => `Invoice number ${i + 1} was paid on time.`).join(" "),
    /[\u0600-\u06ff]/u,
  );
  assert.deepEqual(missingNumbers(long, 20), [], "sentences missing from the long translation");

  assert.deepEqual(outside, [], "the desktop app contacted another host");
  assert.deepEqual(errors, []);
  const screenshot = "work/desktop-app.png";
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ passed: true, translations: results.length, origin, screenshot }));
} finally {
  await app.close();
}

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { splitToTokenBudget, splitSentences, assertCompleteGeneration, MAX_NEW_TOKENS } from "../app/local-translation/chunks";
import { compactPair, isModelCached, modelFileUrls } from "../app/local-translation/models";
import { createCompactTranslator } from "../app/local-translation/client";
import { getPairAvailability, translateFile } from "../app/translation";

test("token splitting retains all English, Arabic, whitespace, and Unicode input", () => {
  const samples = [
    "The meeting starts at 10:30. ".repeat(70),
    "مرحبا بالعالم. هذا نص طويل؟ ".repeat(70),
    "a".repeat(4000),
    "🛰️🚀".repeat(600),
    "Line one.\r\n\r\nLine two.\n".repeat(40),
  ];
  for (const sample of samples) {
    const count = (s: string) => Array.from(s).length + 3;
    const chunks = splitToTokenBudget(sample, count, 192);
    assert.equal(chunks.join(""), sample);
    assert.ok(chunks.every((chunk) => count(chunk) <= 192));
  }
});

test("sentence splitting keeps every character and separates English and Arabic sentences", () => {
  const english = Array.from({ length: 40 }, (_, i) => `Invoice ${i + 1} was paid.`).join(" ");
  const arabic = "مرحبا بالعالم. هل وصلت الفاتورة؟ نعم! شكرا.";
  const mixed = `He said "Stop." Then he left.   Done`;
  // Both the Intl.Segmenter path and the regex fallback must be lossless.
  for (const segmenter of [undefined, null] as const) {
    const pieces = (text: string) => splitSentences(text, segmenter);
    assert.equal(pieces(english).join(""), english);
    assert.equal(pieces(english).length, 40);
    assert.equal(pieces(arabic).join(""), arabic);
    assert.deepEqual(pieces(arabic).map((piece) => piece.trim()), ["مرحبا بالعالم.", "هل وصلت الفاتورة؟", "نعم!", "شكرا."]);
    assert.equal(pieces(mixed).join(""), mixed);
    assert.deepEqual(pieces(mixed).map((piece) => piece.trim()), [`He said "Stop."`, "Then he left.", "Done"]);
    assert.deepEqual(pieces("No sentence end"), ["No sentence end"]);
    assert.deepEqual(pieces(""), []);
  }
});

test("output cap is an error even when Marian would force an EOS token", () => {
  assert.doesNotThrow(() => assertCompleteGeneration(30));
  assert.throws(() => assertCompleteGeneration(MAX_NEW_TOKENS + 1), /output limit/);
  assert.throws(() => splitToTokenBudget("a", () => 500, 192), /exceeds/);
});

test("only the intended pairs select compact models", () => {
  assert.equal(compactPair("en", "ar"), "en-ar");
  assert.equal(compactPair("ar", "en"), "ar-en");
  assert.equal(compactPair("en", "fr"), null);
  assert.equal(compactPair("ar", "ar"), null);
  assert.ok(modelFileUrls("en-ar").every((url) => !url.includes("/main/")));
});

const originals = new Map<string, PropertyDescriptor | undefined>();
function setGlobal(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  static deferInit = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  terminated = false;
  messages: unknown[] = [];
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: { id: number; type: string; text?: string }) {
    this.messages.push(message);
    if (message.type === "init" && FakeWorker.deferInit) return;
    queueMicrotask(() => this.onmessage?.({ data: message.type === "init"
      ? { id: message.id, type: "ready" }
      : { id: message.id, type: "result", text: "مرحبا بالعالم." } }));
  }
  terminate() { this.terminated = true; }
}

test("abort during download terminates the worker and permits a fresh job", async () => {
  setGlobal("Worker", FakeWorker);
  FakeWorker.deferInit = true;
  const controller = new AbortController();
  const pending = createCompactTranslator("en-ar", controller.signal, () => {});
  const first = FakeWorker.instances.at(-1)!;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(first.terminated, true);
  FakeWorker.deferInit = false;
  const translator = await createCompactTranslator("ar-en", new AbortController().signal, () => {});
  translator.destroy();
});

test("only one model can be resident; teardown terminates the worker", async () => {
  setGlobal("Worker", FakeWorker);
  const controller = new AbortController();
  const translator = await createCompactTranslator("en-ar", controller.signal, () => {});
  try {
    await assert.rejects(createCompactTranslator("ar-en", controller.signal, () => {}), /already running/);
    assert.equal(await translator.translate("Hello world."), "مرحبا بالعالم.");
  } finally {
    translator.destroy();
  }
  assert.equal(FakeWorker.instances.at(-1)!.terminated, true);
});

test("cache readiness requires every pinned file and detects eviction", async () => {
  let urls = modelFileUrls("en-ar");
  setGlobal("caches", {
    has: async () => true,
    open: async () => ({ keys: async () => urls.map((url) => new Request(url)) }),
  });
  assert.equal(await isModelCached("en-ar"), true);
  urls = urls.slice(0, -1);
  assert.equal(await isModelCached("en-ar"), false);
  setGlobal("caches", { has: async () => { throw new Error("Storage denied"); } });
  assert.equal(await isModelCached("en-ar"), false);
});

test("English-Arabic works without Chrome Translator; other pairs remain explicit", async () => {
  setGlobal("Worker", FakeWorker);
  setGlobal("Translator", undefined);
  setGlobal("caches", undefined);
  assert.equal(await getPairAvailability("en", "ar"), "downloadable");
  assert.equal(await getPairAvailability("en", "fr"), "unsupported");
  setGlobal("navigator", { onLine: true });
  const result = await translateFile({
    file: new File(["Hello world."], "hello.txt"),
    options: { sourceCode: "en", sourceLanguage: "English", targetCode: "ar", targetLanguage: "Arabic", glossary: "" },
    signal: new AbortController().signal,
    onProgress() {},
  });
  assert.equal(result.sections[0].content, "مرحبا بالعالم.");
  assert.match(result.qualitySummary, /OPUS-MT/);
  assert.equal(FakeWorker.instances.at(-1)!.terminated, true);
});

test("same-language extraction never requires or creates an AI model", async () => {
  setGlobal("Translator", undefined);
  const count = FakeWorker.instances.length;
  const result = await translateFile({
    file: new File(["Keep this source text."], "source.txt"),
    options: { sourceCode: "en", sourceLanguage: "English", targetCode: "en", targetLanguage: "English", glossary: "" },
    signal: new AbortController().signal,
    onProgress() {},
  });
  assert.equal(result.sections[0].content, "Keep this source text.");
  assert.equal(FakeWorker.instances.length, count);
  assert.match(result.qualitySummary, /without translation/);
});

test("uncached offline model fails clearly before starting a download", async () => {
  setGlobal("navigator", { onLine: false });
  setGlobal("caches", undefined);
  const count = FakeWorker.instances.length;
  await assert.rejects(translateFile({
    file: new File(["Hello world."], "hello.txt"),
    options: { sourceCode: "en", sourceLanguage: "English", targetCode: "ar", targetLanguage: "Arabic", glossary: "" },
    signal: new AbortController().signal,
    onProgress() {},
  }), /not fully cached/);
  assert.equal(FakeWorker.instances.length, count);
});

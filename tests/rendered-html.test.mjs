import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the keyless offline Verta product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Verta — Private offline translation<\/title>/i);
  assert.match(html, /Private translation, built in/);
  assert.match(html, /Meaning in\./);
  assert.match(html, /Nothing out\./);
  assert.match(html, /Translate on this device/);
  assert.match(html, /No keys · no uploads/);
  assert.doesNotMatch(html, /OpenAI API key|api\.openai\.com/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("includes the offline app shell and removes starter metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<TranslatorApp \/>/);
  assert.match(layout, /Verta — Private offline translation/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("public/og.png", projectRoot));
  await access(new URL("public/manifest.webmanifest", projectRoot));
  await access(new URL("public/sw.js", projectRoot));
  await access(new URL("public/icon-192.png", projectRoot));
  await access(new URL("public/icon-512.png", projectRoot));
});

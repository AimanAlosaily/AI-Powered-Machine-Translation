const CACHE_NAME = "verta-offline-v4";
const APP_ROOT = new URL("./", self.registration.scope).href;
const CORE_ASSETS = [
  new URL("manifest.webmanifest", APP_ROOT).href,
  new URL("icon-192.png", APP_ROOT).href,
  new URL("icon-512.png", APP_ROOT).href,
  // A worker can start before the page is controlled on the first visit.
  // Precache the engine explicitly instead of relying on intercepted requests.
  new URL("offline/translation-worker.js", APP_ROOT).href,
  new URL("offline/ort-wasm-simd-threaded.jsep.mjs", APP_ROOT).href,
  new URL("offline/ort-wasm-simd-threaded.jsep.wasm", APP_ROOT).href,
];

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const page = await fetch(APP_ROOT, { cache: "reload" });
  await cache.put(APP_ROOT, page.clone());

  const html = await page.text();
  const discovered = Array.from(
    html.matchAll(/(?:src|href)="([^"]+)"/g),
    (match) => new URL(match[1], APP_ROOT).href,
  ).filter((url) => new URL(url).origin === self.location.origin);

  // The static export ships offline-manifest.json listing every app file,
  // including code loaded on demand (Word export, PDF reading, OCR). Saving
  // all of it now means every feature works offline, not just the ones that
  // happened to be used while online. Dev builds have no manifest.
  let listed = [];
  try {
    const manifest = await fetch(new URL("offline-manifest.json", APP_ROOT), { cache: "reload" });
    if (manifest.ok) {
      listed = (await manifest.json()).files.map((file) => new URL(file, APP_ROOT).href);
    }
  } catch {
    // Offline or no manifest: fall back to the assets discovered above.
  }

  await Promise.allSettled(
    [...new Set([...CORE_ASSETS, ...discovered, ...listed])].map(async (url) => {
      const response = await fetch(url, { cache: "reload" });
      if (response.ok) await cache.put(url, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith("verta-offline-") && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          event.waitUntil(caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(APP_ROOT, copy)));
          return response;
        })
        .catch(async () => (await caches.match(APP_ROOT)) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy)));
          }
          return response;
        }),
    ),
  );
});

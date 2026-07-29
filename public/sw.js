const CACHE_NAME = "verta-offline-v2";
const APP_ROOT = new URL("./", self.registration.scope).href;
const CORE_ASSETS = [
  new URL("manifest.webmanifest", APP_ROOT).href,
  new URL("icon-192.png", APP_ROOT).href,
  new URL("icon-512.png", APP_ROOT).href,
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

  await Promise.allSettled(
    [...new Set([...CORE_ASSETS, ...discovered])].map(async (url) => {
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
          void caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(APP_ROOT, copy));
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
            void caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

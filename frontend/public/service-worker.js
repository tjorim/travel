const CACHE = "travel-admin-shell-v5";
// Hashed build output (`/admin/assets/*`) the app has fetched, kept so a view opened once still loads offline. A
// chunk the owner never opened is not here and cannot load offline; the app says so instead of failing silently.
// Hashed names never change content, so the cache is not versioned with the shell: a release adds new files and the
// oldest ones are dropped past the limit.
const ASSETS = "travel-admin-assets-v1";
const ASSET_LIMIT = 200;
const SHELL = [
  "/admin/",
  "/admin/manifest.webmanifest",
  "/admin/icon.svg",
  "/admin/appearance.js",
  "/admin/locale.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("travel-admin-shell-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

async function cachedAsset(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  // Only a complete, successful response is kept; a 404 for a retired chunk must stay an error. A full or failing
  // cache must never fail the request itself.
  if (response.ok && response.status === 200) {
    try {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(
        keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT)).map((key) => cache.delete(key)),
      );
    } catch {
      /* Served from the network this time. */
    }
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/admin/assets/")
  ) {
    event.respondWith(cachedAsset(event.request));
    return;
  }
  if (["/admin/appearance.js", "/admin/locale.js"].includes(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(
        async () => (await caches.match(event.request)) || Response.error(),
      ),
    );
    return;
  }
  if (event.request.mode !== "navigate" || !url.pathname.startsWith("/admin/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.headers.get("Content-Type")?.includes("text/html")) {
          event.waitUntil(
            caches.open(CACHE).then((cache) => cache.put("/admin/", response.clone())),
          );
        }
        return response;
      })
      .catch(async () => (await caches.match("/admin/")) || Response.error()),
  );
});

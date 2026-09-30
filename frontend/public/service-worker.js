const CACHE = "travel-admin-shell-v3";
const SHELL = ["/admin/", "/admin/manifest.webmanifest", "/admin/icon.svg", "/admin/appearance.js"];

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
          keys.filter((key) => key.startsWith("travel-admin-shell-") && key !== CACHE).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname === "/admin/appearance.js") {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.match("/admin/appearance.js")) || Response.error()),
    );
    return;
  }
  if (event.request.mode !== "navigate" || !new URL(event.request.url).pathname.startsWith("/admin/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.headers.get("Content-Type")?.includes("text/html")) {
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put("/admin/", response.clone())));
        }
        return response;
      })
      .catch(async () => (await caches.match("/admin/")) || Response.error()),
  );
});

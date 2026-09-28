const CACHE = "travel-admin-shell-v2";
const SHELL = ["/admin/", "/admin/manifest.webmanifest", "/admin/icon.svg"];

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

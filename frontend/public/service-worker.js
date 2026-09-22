const CACHE = "travel-admin-shell-v1";
const SHELL = ["/admin/", "/admin/manifest.webmanifest", "/admin/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("travel-admin-shell-") && key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !new URL(event.request.url).pathname.startsWith("/admin/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

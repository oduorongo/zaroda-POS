// ZARODA Team app - service worker. It makes the team pages installable and keeps the app's own files for a quick start;
// it never caches API calls (earnings, shops and passwords always come fresh from the server).
const CACHE = "zaroda-team-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/team", "/team/login", "/team.webmanifest"])).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("zaroda-team-") && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const isAsset = url.pathname.startsWith("/_next/static/") || /^\/team-icon-|^\/team\.webmanifest$/.test(url.pathname);
  if (isAsset) {
    event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
      return res;
    })));
    return;
  }
  if (event.request.mode === "navigate" && url.pathname.startsWith("/team")) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((hit) => hit || caches.match("/team"))));
  }
});

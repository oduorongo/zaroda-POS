// ZARODA POS Terminal - service worker.
//
// Deliberately simple: this only caches the app shell (the Next.js static
// assets) so the terminal's UI itself loads with no connectivity. It never
// caches API responses - those go through IndexedDB (lib/db.ts) and the
// sync engine (lib/sync.ts) instead, which is a correctness-aware cache
// (idempotent, ledger-based) rather than a browser HTTP cache that has no
// idea a sale must never be silently duplicated or served stale.

const CACHE_NAME = "zaroda-pos-shell-v1";
const APP_SHELL = ["/", "/setup", "/login", "/pos", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // A route failing to precache (e.g. first deploy, no server reachable
      // yet) shouldn't block install - the fetch handler below still falls
      // back to network for anything not yet cached.
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch API calls - see file header. Let them hit the network (or
  // fail) exactly as the app's own fetch() calls expect.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});

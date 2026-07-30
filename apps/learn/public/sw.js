/**
 * Service worker: make Arpeggio Learn work with no connection at all.
 *
 * Strategy:
 *  - navigations and unversioned app code   network first, cache fallback
 *  - everything else (hashed chunks, the
 *    Basic Pitch model, icons)              cache first, then network + store
 *
 * The split matters. `app.js` and `styles.css` carry no content hash, so a
 * cache-first rule would pin the installed app to whatever shipped first and
 * every later release would be invisible. The hashed chunks and the 900 KB
 * model never change under a given URL, so serving those from cache is free
 * speed — and it is what makes a microphone session work offline afterwards.
 */
const CACHE = "arpeggio-learn-v2";

/** Same-origin paths that must never be served stale. */
const ALWAYS_FRESH = /\/(index\.html|app\.js|styles\.css|manifest\.webmanifest)$|\/$/;

/** Relative so the same worker serves from a domain root or a Pages sub-path. */
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one 404 (e.g. a renamed chunk) would leave the app
      // uncached, so failures are tolerated and filled in on first use instead.
      .then((cache) => Promise.allSettled(CORE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  const isNavigation = request.mode === "navigate";
  if (isNavigation || ALWAYS_FRESH.test(new URL(request.url).pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => {
            if (hit) return hit;
            // Offline deep link: any in-app route is the same single page. Only
            // navigations may fall back to the shell — answering a missing
            // script with HTML would break the page instead of failing loudly.
            return isNavigation ? caches.match("./index.html") : Response.error();
          }),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

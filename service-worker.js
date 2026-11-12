/* Naruto Filler Guide — service worker.
 * Cache-first for the app shell. Bump CACHE_VERSION whenever any file changes
 * so returning visitors get the "Update available" banner.
 */
const CACHE_VERSION = "v1.0.0";
const CACHE_NAME = "naruto-filler-" + CACHE_VERSION;

// Relative to this file's location, so it works at a GitHub Pages subpath.
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data/episodes.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache: "reload" bypasses the HTTP cache so a new version never precaches stale files
      cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })))
    )
  );
  // No skipWaiting() here: a new version waits until the user taps the update banner.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("naruto-filler-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let the browser handle external links

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache first (ignore ?query so e.g. "./?source=pwa" still hits the cache)
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const res = await fetch(req);
        if (res.ok && res.type === "basic") cache.put(req, res.clone());
        return res;
      } catch (err) {
        // Offline and not cached: fall back to the app shell for page navigations
        if (req.mode === "navigate") {
          const shell = await cache.match("./index.html");
          if (shell) return shell;
        }
        throw err;
      }
    })
  );
});

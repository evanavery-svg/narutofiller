/* Naruto Filler Guide — service worker.
 *
 * Network-first: whenever there's a connection, every open of the site or app loads
 * the newest files. Each fresh copy is saved, so the app still works offline. If the
 * network is slow, the saved copy is used after a few seconds (the fresh one still
 * downloads in the background for next time).
 *
 * A new version of this file takes over immediately (no "update available" step).
 * Bump CACHE_VERSION only when the PRECACHE list changes.
 */
const CACHE_VERSION = "v2.2.0";
const CACHE_NAME = "naruto-filler-" + CACHE_VERSION;
const NETWORK_TIMEOUT_MS = 3500;

// Relative to this file's location, so it works at a GitHub Pages subpath.
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data/episodes.js",
  "./firebase-config.js",
  "./sync.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

// Text files compared when the app asks "has anything changed?" (on returning to the app)
const CHECKED = [
  "./index.html",
  "./styles.css",
  "./app.js",
  "./sync.js",
  "./data/episodes.js",
  "./firebase-config.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // cache: "reload" skips the browser's HTTP cache so we never save stale files
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()) // take over right away
  );
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

function timeout(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetches a same-origin URL past the HTTP cache (revalidates with the server) and saves it. */
async function fetchAndSave(cache, url) {
  const res = await fetch(url, { cache: "no-cache", credentials: "same-origin" });
  if (res.ok && res.type === "basic") {
    await cache.put(url, res.clone());
    // "./" and "./index.html" are the same page: keep both saved copies identical
    const twin = url.endsWith("/") ? url + "index.html" : url.endsWith("/index.html") ? url.slice(0, -10) : null;
    if (twin) await cache.put(twin, res.clone());
  }
  return res;
}

async function networkFirst(event) {
  const request = event.request;
  const url = new URL(request.url);
  url.search = ""; // "./?source=pwa" and "./" are the same file
  url.hash = "";
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url.href);

  const fresh = fetchAndSave(cache, url.href).then((res) => (!res.ok && cached ? cached : res));
  event.waitUntil(fresh.catch(() => {})); // let the download finish even if we answered from cache

  try {
    if (!cached) return await fresh;
    return await Promise.race([fresh, timeout(NETWORK_TIMEOUT_MS).then(() => cached)]);
  } catch (err) {
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match(new URL("./index.html", self.registration.scope).href);
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Only handle this site's own files. Firebase (SDK and database traffic) goes
  // straight to the network; the app keeps working offline without it.
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});

/** Compares the saved copies of the main files with the server's. Replies { changed }. */
async function checkForChanges() {
  const cache = await caches.open(CACHE_NAME);
  let changed = false;
  await Promise.all(CHECKED.map(async (path) => {
    const url = new URL(path, self.registration.scope).href;
    try {
      const old = await cache.match(url);
      const oldText = old ? await old.text() : null;
      const res = await fetchAndSave(cache, url);
      if (!res.ok) return;
      const newText = await res.clone().text();
      if (oldText !== null && newText !== oldText) changed = true;
    } catch (e) { /* offline: nothing to compare */ }
  }));
  return changed;
}

self.addEventListener("message", (event) => {
  // Pages from older versions show an "Update available" banner whose tap sends SKIP_WAITING.
  // This worker is already active, so just reload that page onto the new version.
  if (event.data && event.data.type === "SKIP_WAITING" && event.source && event.source.navigate) {
    event.waitUntil(event.source.navigate(event.source.url).catch(() => {}));
    return;
  }
  if (event.data && event.data.type === "CHECK_UPDATES" && event.ports[0]) {
    event.waitUntil(checkForChanges().then((changed) => event.ports[0].postMessage({ changed })));
  }
});

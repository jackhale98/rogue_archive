/*
 * Rogue Archive service worker (hand-written, no build step).
 *
 * - Navigations: network first, falling back to the cached app shell.
 * - Hashed build assets and immutable game runtime files: cache first.
 * - Runtime manifests: network first, so new game builds are picked up.
 * - Everything else under our scope: stale-while-revalidate.
 *
 * It only manages Cache Storage. It never touches IndexedDB, where saved
 * games live, so cache cleanup can never delete a save.
 */
const SHELL_CACHE = 'ra-shell-v1';
const RUNTIME_CACHE = 'ra-runtime-v1';
const KEEP = new Set([SHELL_CACHE, RUNTIME_CACHE]);
const SCOPE = new URL(self.registration.scope);
const SHELL_URL = SCOPE.href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([SHELL_URL, `${SHELL_URL}manifest.webmanifest`]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith('ra-') && !KEEP.has(key)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function relativePath(url) {
  return url.pathname.slice(SCOPE.pathname.length);
}

// runtime/<game>/<16-hex build id>/<file>
const IMMUTABLE_RUNTIME = /^runtime\/[a-z0-9-]+\/[0-9a-f]{16}\//;
const RUNTIME_MANIFEST = /^runtime\/([a-z0-9-]+)\/runtime-manifest\.json$/;

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, onFresh) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (onFresh) await onFresh(response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) void cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

/** When a game's manifest changes, drop cached files from its older builds. */
async function pruneOldRuntime(gameId, response) {
  try {
    const manifest = await response.json();
    const keepPrefix = new URL(`runtime/${gameId}/${manifest.buildId}/`, SCOPE).href;
    const gamePrefix = new URL(`runtime/${gameId}/`, SCOPE).href;
    const cache = await caches.open(RUNTIME_CACHE);
    for (const request of await cache.keys()) {
      if (
        request.url.startsWith(gamePrefix) &&
        !request.url.startsWith(keepPrefix) &&
        !request.url.endsWith('runtime-manifest.json')
      ) {
        await cache.delete(request);
      }
    }
  } catch {
    // A malformed manifest is handled by the page; never fail the fetch here.
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  const path = relativePath(url);
  // Runtime files first: a game's runtime can include pages loaded in a frame
  // (e.g. an upstream web client), and those navigations are runtime files,
  // not app routes.
  if (IMMUTABLE_RUNTIME.test(path)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(new Request(SHELL_URL), SHELL_CACHE).catch(() => caches.match(SHELL_URL)));
    return;
  }
  const manifestMatch = RUNTIME_MANIFEST.exec(path);
  if (manifestMatch) {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE, (response) => pruneOldRuntime(manifestMatch[1], response)),
    );
    return;
  }
  if (path.startsWith('assets/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  event.respondWith(staleWhileRevalidate(request));
});

/* global self, caches, fetch, URL */
// Conbert's service worker: makes the app installable (share menu on phones)
// and keeps the app and its converters for offline use.
//
// - The build writes /offline-manifest.json: every file with a content hash.
// - Files from that list are served from the cache once they were loaded
//   (or prepared for offline in the settings). The cache key contains the
//   hash, so an update only downloads what really changed.
// - Pages (navigation) always come from the network first; without network
//   the cached index.html takes over.
// - Everything else (the API, uploads, range requests) goes straight to the
//   network and is never stored.
'use strict';

const FILES = 'conbert-files-v1';
const META = 'conbert-meta-v1';
const MANIFEST_URL = '/offline-manifest.json';

/** { version, files: Map<url, { hash, size }> } or null when there's no build manifest (dev). */
let manifest = null;

function keyFor(url, hash) {
  return `${url}?__conbert=${hash}`;
}

function toManifest(data) {
  if (!data || !Array.isArray(data.files)) return null;
  return {
    version: String(data.version),
    files: new Map(data.files.map((f) => [f.url, { hash: f.hash, size: f.size }])),
  };
}

async function loadStoredManifest() {
  if (manifest) return manifest;
  const stored = await (await caches.open(META)).match(MANIFEST_URL);
  manifest = stored ? toManifest(await stored.json()) : null;
  return manifest;
}

/** Fetches the newest manifest; drops cached files that are no longer part of the build. */
async function refreshManifest() {
  const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!res.ok) return loadStoredManifest();
  const data = await res.clone().json();
  const next = toManifest(data);
  if (!next) return loadStoredManifest();
  const changed = !manifest || manifest.version !== next.version;
  manifest = next;
  if (changed) {
    await (await caches.open(META)).put(MANIFEST_URL, res);
    await prune();
  }
  return manifest;
}

async function prune() {
  if (!manifest) return;
  const wanted = new Set([...manifest.files].map(([url, f]) => keyFor(url, f.hash)));
  const cache = await caches.open(FILES);
  for (const request of await cache.keys()) {
    const u = new URL(request.url);
    if (!wanted.has(u.pathname + u.search)) await cache.delete(request);
  }
}

/** Serves a build file from the cache; loads and stores it on the first use. */
async function cachedFile(request, url, entry) {
  const cache = await caches.open(FILES);
  const key = keyFor(url, entry.hash);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200 && res.type === 'basic') {
    await cache.put(key, res.clone()).catch(() => undefined);
  }
  return res;
}

async function cachedIndex() {
  const m = await loadStoredManifest();
  const entry = m?.files.get('/index.html');
  if (!entry) return null;
  return (await caches.open(FILES)).match(keyFor('/index.html', entry.hash));
}

async function navigation(event) {
  try {
    // Load the newest manifest together with the page, so the page and the
    // files it asks for afterwards always belong to the same build.
    const [res] = await Promise.all([fetch(event.request), refreshManifest().catch(() => null)]);
    // Keep the page shell for offline use (in the background).
    event.waitUntil(storeIndex());
    return res;
  } catch (error) {
    const index = await cachedIndex();
    if (index) return index;
    throw error;
  }
}

async function storeIndex() {
  const m = await loadStoredManifest();
  const entry = m?.files.get('/index.html');
  if (!entry) return;
  const cache = await caches.open(FILES);
  if (await cache.match(keyFor('/index.html', entry.hash))) return;
  const res = await fetch('/index.html', { cache: 'no-store' });
  if (res.ok) await cache.put(keyFor('/index.html', entry.hash), res);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    refreshManifest()
      .then(storeIndex)
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigation(event));
    return;
  }
  event.respondWith(
    loadStoredManifest().then((m) => {
      const entry = m?.files.get(url.pathname);
      return entry && !url.search ? cachedFile(request, url.pathname, entry) : fetch(request);
    }),
  );
});

/** How much of the build is stored: { files, cachedFiles, bytes, cachedBytes, version }. */
async function status() {
  const m = await refreshManifest().catch(() => loadStoredManifest());
  if (!m) return { available: false };
  const cache = await caches.open(FILES);
  const keys = new Set(
    (await cache.keys()).map((r) => {
      const u = new URL(r.url);
      return u.pathname + u.search;
    }),
  );
  let cachedFiles = 0;
  let cachedBytes = 0;
  let bytes = 0;
  for (const [url, f] of m.files) {
    bytes += f.size;
    if (keys.has(keyFor(url, f.hash))) {
      cachedFiles += 1;
      cachedBytes += f.size;
    }
  }
  return {
    available: true,
    version: m.version,
    files: m.files.size,
    cachedFiles,
    bytes,
    cachedBytes,
  };
}

/** Downloads every file of the build that isn't stored yet, reporting progress. */
async function prepare(reply) {
  const m = await refreshManifest();
  if (!m) return reply({ type: 'conbert-offline-error', error: 'no-manifest' });
  const cache = await caches.open(FILES);
  const before = await status();
  let doneBytes = before.cachedBytes;
  for (const [url, f] of m.files) {
    const key = keyFor(url, f.hash);
    if (await cache.match(key)) continue;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    await cache.put(key, res);
    doneBytes += f.size;
    reply({ type: 'conbert-offline-progress', doneBytes, bytes: before.bytes });
  }
  reply({ type: 'conbert-offline-done', status: await status() });
}

self.addEventListener('message', (event) => {
  const data = event.data;
  const port = event.ports && event.ports[0];
  if (!port || !data || typeof data.type !== 'string') return;
  const reply = (message) => port.postMessage(message);
  if (data.type === 'conbert-offline-status') {
    event.waitUntil(
      status()
        .then((s) => reply({ type: 'conbert-offline-status', status: s }))
        .catch((e) => reply({ type: 'conbert-offline-error', error: String(e) })),
    );
  } else if (data.type === 'conbert-offline-prepare') {
    event.waitUntil(
      prepare(reply).catch((e) => reply({ type: 'conbert-offline-error', error: String(e) })),
    );
  } else if (data.type === 'conbert-offline-clear') {
    event.waitUntil(
      caches
        .delete(FILES)
        .then(() => status())
        .then((s) => reply({ type: 'conbert-offline-status', status: s }))
        .catch((e) => reply({ type: 'conbert-offline-error', error: String(e) })),
    );
  }
});

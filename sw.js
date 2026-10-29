// MoveApp service worker (SPEC §12). Bump VERSION only when a shell file changes.
const VERSION = 'v1';
const SHELL = `moveapp-shell-${VERSION}`;
const CONTENT = 'moveapp-content';
const LIBRARY_TIMEOUT_MS = 3000;

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/tokens.css',
  'styles/app.css',
  'app/main.js',
  'app/content.js',
  'app/dom.js',
  'app/player.js',
  'app/store.js',
  'app/timeline.js',
  'app/screens/library.js',
  'app/screens/preview.js',
  'app/screens/session.js',
  'app/screens/pause.js',
  'app/screens/end.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/mood-energize-192.png',
  'icons/mood-energize-512.png',
  'icons/mood-wind-down-192.png',
  'icons/mood-wind-down-512.png',
  'content/exercises.json',
  'content/breath-patterns.json',
  'content/moods.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('moveapp-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const scopePath = new URL(self.registration.scope).pathname;
const rel = (url) => url.pathname.slice(scopePath.length);

async function shellFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreSearch: true });
  return hit || fetch(request);
}

async function contentFirst(request) {
  const cache = await caches.open(CONTENT);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.status === 200) await cache.put(request, res.clone());
  return res;
}

async function libraryNetworkFirst(request) {
  const cache = await caches.open(CONTENT);
  try {
    const res = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), LIBRARY_TIMEOUT_MS)),
    ]);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(scopePath)) return;
  const path = rel(url);
  if (path === 'content/library.json') event.respondWith(libraryNetworkFirst(request));
  else if (path.startsWith('audio/') || path.startsWith('content/routines/')) event.respondWith(contentFirst(request));
  else event.respondWith(shellFirst(request));
});

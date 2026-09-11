// Panda Royale Scorekeeper — offline app shell.
//
// Pass-and-play is 100% client-side (no fetches beyond the shell), so caching
// index.html + its static assets makes the whole app installable and usable
// with no signal — the real game-night scenario this exists for. Online
// multiplayer and every /api/* call always go straight to the network and
// are never cached, so live scores never go stale behind a cache.
//
// Bump CACHE when the shell assets change; the old cache is dropped on the
// next activate.
const CACHE = 'pr-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/lib/score.js',
  '/lib/rules.js',
  '/vendor/qrcode.js',
  '/site.webmanifest',
  '/favicon.svg',
  '/favicon-32.png',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always live — never cache game state

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((resp) => {
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      // Cache-first when we already have it (instant + works offline);
      // otherwise wait on the network, falling back to cache on failure.
      return cached || network;
    })
  );
});

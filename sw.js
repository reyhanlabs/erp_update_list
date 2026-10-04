/* Zahir ERP Update Manager — Service Worker
 * CACHE_NAME is stamped from src/config.js (APP_VERSION) by scripts/build-static.mjs.
 * Do NOT edit the version here by hand.
 */
const CACHE_NAME = 'erp-update-__APP_VERSION__';
const PRECACHE = [
  '/',
  '/index.html',
  '/share.html',
  '/manifest.json',
  '/icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function putInCache(req, res) {
  const clone = res.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never touch API calls or Firebase/Google traffic
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('firestore') ||
      url.hostname.includes('gstatic')) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // App code + styles: network-first so a deploy is visible on next load,
  // cache only as offline fallback.
  const isAppCode = sameOrigin && (
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.json') ||
    url.pathname.startsWith('/share')
  );

  if (isAppCode) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) putInCache(req, res);
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((c) => {
            if (c) return c;
            if (req.mode === 'navigate') return caches.match('/index.html');
            return Response.error();
          })
        )
    );
    return;
  }

  // Static assets (icons, fonts): cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && sameOrigin) putInCache(req, res);
        return res;
      });
    })
  );
});

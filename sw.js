/* Zahir ERP Update Manager — Service Worker */
const CACHE_NAME = 'erp-update-v4.13.0';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API / Firebase — always network
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('firestore')) {
    return;
  }

  // App shell: network first, fallback to cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        const clone = res.clone();
        if (res.ok && url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});

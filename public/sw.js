/* Zahir ERP Update Manager — Service Worker */
/* Bump CACHE_NAME on every release so clients drop stale shells */
const CACHE_NAME = 'erp-update-v4.30.0';
const PRECACHE = [
  '/',
  '/index.html',
  '/css/style.css',
  '/manifest.json',
  '/icon.png',
  '/src/main.js',
  '/src/config.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(PRECACHE.map((url) =>
          cache.add(url).catch(() => {})
        ))
      )
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

  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('googleapis') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('firestore') ||
      url.hostname.includes('gstatic')) {
    return;
  }

  const isShell = url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.endsWith('.js');

  if (isShell) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      });
    })
  );
});

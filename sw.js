const CACHE = 'drozhevoe-v1';
const ASSETS = [
  './',
  './index.html',
  './app.jsx',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // CDNs will be cached as opaque responses on first use
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(cache => cache.put(req, clone)).catch(()=>{});
      return resp;
    }).catch(() => cached))
  );
});

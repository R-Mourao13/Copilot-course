/* Service worker — network-first so new deploys ALWAYS reach the player,
 * with an offline fallback to the last cached copy. */
const CACHE = 'bolt-ranger-v18';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'game.js',
  'core.js',
  'manifest.json',
  'icon.svg',
  'vendor/three.module.js',
];

self.addEventListener('install', (e) => {
  // Pre-cache, then immediately take over so the newest SW controls the page.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Network-first: fetch fresh, update cache, fall back to cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match('index.html')))
  );
});

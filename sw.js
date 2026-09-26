/* FishHunter service worker — app shell offline, network-first for data. */
const VERSION = 'fh-v25.3.0';
const SHELL = [
  './', 'app.html', 'index.html', 'privacy.html', 'css/app.css', 'css/lp.css', 'js/lp.js', 'ops.html', 'css/ops.css', 'js/operator.js', 'manifest.webmanifest', 'icons/icon.svg',
  'js/diagnostics.js', 'js/config.js', 'js/community.js', 'js/spots.js', 'js/astro.js', 'js/weather.js', 'js/feed.js',
  'js/catchlog.js', 'js/engine.js', 'js/insight.js', 'js/motion.js', 'js/ui.js', 'js/scene.js', 'js/map.js', 'js/picks-worker.js', 'js/share.js', 'js/prefs.js', 'js/app.js', 'js/ptr.js',
  'assets/angler.webp', 'assets/angler-fish.webp'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Live data (weather, marine, snapshot): always network; the app keeps its own cache.
  if (/open-meteo\.com$/.test(url.hostname) || url.pathname.endsWith('.json')) return;
  // Map tiles / CDN: stale-while-revalidate into a bounded runtime cache.
  if (url.origin !== location.origin) {
    if (!/cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org|cdnjs\.cloudflare\.com/.test(url.hostname)) return;
    e.respondWith(caches.open(VERSION + '-rt').then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // App shell: network-first so deploys land immediately, cache fallback offline.
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return r;
  }).catch(() => caches.match(req).then((r) => r || caches.match('app.html'))));
});

// Hors ligne : l'app et la base sont mises en cache ; les tuiles de carte vues sont gardées (2000 max).
const APP = 'mes-invaders-app-v3';
const TILES = 'mes-invaders-tiles-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'shots.js', 'data/invaders.json', 'manifest.webmanifest',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/leaflet.markercluster.js', 'vendor/MarkerCluster.css',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(async c => {
      try {
        const r = await fetch(e.request);
        if (r.ok) { c.put(e.request, r.clone()); if (Math.random() < .05) trim(c, 2000); }
        return r;
      } catch (err) {
        return (await c.match(e.request)) || Response.error();
      }
    }));
    return;
  }
  if (url.origin === location.origin) {
    // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const cp = r.clone(); caches.open(APP).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  }
});

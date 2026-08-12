/**
 * Service Worker — die App muss auf einem Feld ohne Empfang starten.
 *
 * Alles wird beim ersten Besuch in den Cache gelegt und danach zuerst von dort bedient.
 * Die Rechnung läuft ohnehin lokal, es gibt keine Server-Abhängigkeit.
 */

const CACHE = 'eclipse-v3';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/astro.js',
  './js/eclipse.js',
  './js/meter.js',
  './js/chart.js',
  './js/store.js',
  './js/sky.js',
  './js/compass.js',
  './js/photo.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) {
        // Im Hintergrund auffrischen, damit ein Update beim nächsten Start da ist
        fetch(event.request)
          .then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
          })
          .catch(() => {});
        return hit;
      }
      return fetch(event.request).catch(() => caches.match('./index.html'));
    })
  );
});

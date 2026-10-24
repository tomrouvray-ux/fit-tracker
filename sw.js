// Offline support: cache the app shell, always go to the network for APIs.
const CACHE = 'fittrack-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'data/exercises.json',
  'js/app.js', 'js/store.js', 'js/ui.js', 'js/exercises.js', 'js/train.js', 'js/food.js', 'js/off.js',
  'js/ai.js', 'js/garmin.js', 'js/fileimport.js', 'js/today.js', 'js/progress.js', 'js/settings.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // Network first so updates arrive, cache as fallback for offline.
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  } else if (url.hostname === 'raw.githubusercontent.com') {
    // Exercise images: cache first.
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    })));
  }
});

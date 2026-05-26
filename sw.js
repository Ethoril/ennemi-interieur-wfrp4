const CACHE_NAME = 'wfrp-cache-v1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/layout.js',
  './favicon.svg'
  // Ne pas cacher tout le dossier tiles/ ou Firebase
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Ignorer les requêtes non-GET et les appels Firebase/Google
  if (event.request.method !== 'GET' || 
      event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('identitytoolkit.googleapis.com') ||
      event.request.url.includes('securetoken.googleapis.com') ||
      event.request.url.includes('docs.google.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // Stratégie Stale-While-Revalidate modifiée pour les pages HTML: Network First
      if (event.request.headers.get('accept').includes('text/html')) {
        return fetch(event.request).then(response => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return response;
        }).catch(() => cachedResponse);
      }
      
      // Cache First pour les assets (CSS, JS, images)
      return cachedResponse || fetch(event.request).then(response => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
        return response;
      });
    })
  );
});

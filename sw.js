const CACHE_NAME = 'wfrp-cache-v9';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './css/hero3d.css',
  './js/main.js',
  './js/layout.js',
  './js/hero3d/index.js',
  './js/hero3d/scene.js',
  './js/hero3d/scroll-timeline.js',
  './js/hero3d/starfield.js',
  './js/hero3d/comet.js',
  './js/hero3d/morrslieb.js',
  './js/hero3d/skyline.js',
  './js/hero3d/textures.js',
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

  const url = new URL(event.request.url);
  const acceptHeader = event.request.headers.get('accept');
  const isSameOrigin = event.request.url.startsWith(self.location.origin);

  // Détection des fichiers de code locaux (HTML, CSS, JS) qui changent à chaque mise à jour
  const isCodeAsset = isSameOrigin && (
    event.request.mode === 'navigate' ||
    (acceptHeader && acceptHeader.includes('text/html')) ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  );

  if (isCodeAsset) {
    // Stratégie Network First avec contournement du cache HTTP du navigateur pour garantir la fraîcheur
    event.respondWith(
      fetch(new Request(event.request, { cache: 'no-cache' }))
        .then(response => {
          if (response.ok || response.status === 0) {
            const resClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Stratégie Stale-While-Revalidate pour les autres ressources (images, CDNs, etc.)
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request)
          .then(response => {
            if (response.ok || response.status === 0) {
              const resClone = response.clone();
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
            }
            return response;
          })
          .catch(() => {}); // Ignorer les erreurs réseau pour le fetch en tâche de fond

        return cachedResponse || fetchPromise;
      })
    );
  }
});

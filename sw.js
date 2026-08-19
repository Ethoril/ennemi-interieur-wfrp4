// sw.js, en tête. Doit rester identique à APP_VERSION de js/layout.js :
// la CI le vérifie (.github/workflows/validate.yml).
const APP_VERSION = 'v2.15.0';
const CACHE_NAME  = 'wfrp-cache-' + APP_VERSION;

const ASSETS_LOCAUX = [
  './',
  './index.html',
  './groupe.html',
  './videos.html',
  './tableau.html',
  './regles.html',
  './cartes.html',
  './carte.html',
  './pnjs.html',
  './enquetes.html',
  './doodle.html',
  './fiche.html',
  './offline.html',
  './css/base.css',
  './css/components.css',
  './css/theme-parchment.css',
  './css/hero3d.css',
  './css/fiche.css',
  './css/doodle.css',
  './js/auth.js',
  './js/calendar.js',
  './js/doodle.js',
  './js/enquetes.js',
  './js/fiche-cloud.js',
  './js/fiche.js',
  './js/firebase-init.js',
  './js/layout.js',
  './js/main.js',
  './js/maps.js',
  './js/pnjs.js',
  './js/protected-images.js',
  './js/protected-image-scope.js',
  './js/storage-reference.js',
  './js/protected-upload.js',
  './js/protected-upload-id.js',
  './js/protected-upload-journal.js',
  './js/protected-upload-recovery.js',
  './js/sheets.js',
  './js/ui-confirm.js',
  './js/utils.js',
  './js/hero3d/comet.js',
  './js/hero3d/index.js',
  './js/hero3d/morrslieb.js',
  './js/hero3d/scene.js',
  './js/hero3d/scroll-timeline.js',
  './js/hero3d/skyline.js',
  './js/hero3d/starfield.js',
  './js/hero3d/textures.js',
  './js/data/careers.json',
  './js/data/skills.json',
  './img/Bhelgi.webp',
  './img/Caelel.webp',
  './img/Elysia.webp',
  './img/Hellaya.webp',
  './img/Wren.webp',
  './img/thumb-empire.webp',
  './img/thumb-vieux-monde.webp',
  './favicon.svg',
  './manifest.json'
  // Ne pas cacher tout le dossier tiles/ ou Firebase
];

const ASSETS_CDN = [
  'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/d3@7/+esm',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.esm.js',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.min.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Ressources locales : l'échec doit faire échouer l'installation.
    await cache.addAll(ASSETS_LOCAUX);
    // CDN : une panne ne doit pas empêcher l'installation du worker.
    await Promise.allSettled(ASSETS_CDN.map(u => cache.add(u)));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(async key => {
      if (key !== CACHE_NAME) return caches.delete(key);
      // Une version antérieure a pu mettre en cache une URL Storage durable.
      // Le worker mis à jour purge aussi son cache courant, même sans bump.
      const cache = await caches.open(key);
      const requests = await cache.keys();
      await Promise.all(requests
        .filter(request => isStorageBlobRequest(request.url))
        .map(request => cache.delete(request)));
      return true;
    }));
    await self.clients.claim();
  })());
});

// Les blobs Storage ne doivent jamais entrer dans Cache Storage.
function isStorageBlobRequest(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'storage.googleapis.com'
      || hostname === 'firebasestorage.googleapis.com'
      || hostname.endsWith('.firebasestorage.app');
  } catch { return false; }
}

self.addEventListener('fetch', event => {

  // Ignorer les requêtes non-GET et les appels Firebase/Google
  if (event.request.method !== 'GET' || 
      isStorageBlobRequest(event.request.url) ||
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
        .catch(async () => {
          const enCache = await caches.match(event.request);
          if (enCache) return enCache;
          if (event.request.mode === 'navigate') {
            // Les URL a parametres (fiche.html?char=, carte.html?map=) ne
            // correspondent pas a la page pre-cachee : ignorer la query string
            // avant de conclure a l'absence de cache.
            const coque = await caches.match(event.request, { ignoreSearch: true });
            if (coque) return coque;
            return (await caches.match('./offline.html'))
              || new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
          }
          return new Response('', { status: 504, statusText: 'Hors ligne' });
        })
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

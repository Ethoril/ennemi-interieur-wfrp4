// sw.js, en tête. Doit rester identique à APP_VERSION de js/layout.js :
// la CI le vérifie (.github/workflows/validate.yml).
const APP_VERSION = 'v2.20.0';
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
  './js/app-check.js',
  './js/bureau-data.js',
  './js/bureau-view-lifecycle.js',
  './js/calendar.js',
  './js/data/firebase-clients.js',
  './js/data/firebase-errors.js',
  './js/data/firebase-normalizers.js',
  './js/data/images-repository.js',
  './js/data/indices-repository.js',
  './js/data/pnjs-repository.js',
  './js/data/relations-repository.js',
  './js/data/repository-utils.js',
  './js/doodle.js',
  './js/enquetes.js',
  './js/firebase-config.js',
  './js/fiche-cloud.js',
  './js/fiche.js',
  './js/firebase-init.js',
  './js/layout.js',
  './js/load-generation.js',
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
  './js/image-lifecycle.js',
  './js/pnj-integrity.js',
  './js/private-notes.js',
  './js/sheets.js',
  './js/ui-confirm.js',
  './js/utils.js',
  './js/visibility.js',
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
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './app/index.html',
  './css/mobile-app.css',
  './js/mobile/admin-route-controller.js',
  './js/mobile/app.js',
  './js/mobile/drafts-store.js',
  './js/mobile/enquete-admin-list-model.js',
  './js/mobile/enquete-detail-model.js',
  './js/mobile/enquete-list-model.js',
  './js/mobile/enquetes-drafts-store.js',
  './js/mobile/lifecycle.js',
  './js/mobile/mj-composition.js',
  './js/mobile/mj-runtime.js',
  './js/mobile/pnj-detail-model.js',
  './js/mobile/pnj-list-model.js',
  './js/mobile/public-composition.js',
  './js/mobile/public-runtime.js',
  './js/mobile/router.js',
  './js/mobile/session.js',
  './js/mobile/store.js',
  './js/mobile/ui.js',
  './js/mobile/pwa.js',
  './js/mobile/pwa-banner.js',
  './js/mobile/components/filter-sheet.js',
  './js/mobile/components/indice-image.js',
  './js/mobile/components/pnj-picker.js',
  './js/mobile/components/pnj-relations-editor.js',
  './js/mobile/components/portrait-editor.js',
  './js/mobile/components/portrait.js',
  './js/mobile/views/enquete-detail.js',
  './js/mobile/views/enquete-edit.js',
  './js/mobile/views/enquetes-list.js',
  './js/mobile/views/enquetes-mj-list.js',
  './js/mobile/views/pnj-detail.js',
  './js/mobile/views/pnj-edit.js',
  './js/mobile/views/pnjs-list.js',
  // Ne pas cacher tout le dossier tiles/ ou les données Firebase.
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
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(async key => {
      if (key !== CACHE_NAME) return caches.delete(key);
      // Une version antérieure a pu mettre en cache une URL protégée ou opaque.
      // Le worker mis à jour purge aussi son cache courant, même sans bump.
      const cache = await caches.open(key);
      const requests = await cache.keys();
      await Promise.all(requests.map(async request => {
        const response = await cache.match(request);
        if (isProtectedNetworkRequest(request.url) || isStorageBlobRequest(request.url) || response?.type === 'opaque') {
          return cache.delete(request);
        }
        return false;
      }));
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

function isProtectedNetworkRequest(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    const hostname = url.hostname.toLowerCase();
    return hostname === 'firestore.googleapis.com'
      || hostname === 'identitytoolkit.googleapis.com'
      || hostname === 'securetoken.googleapis.com'
      || hostname === 'firebaseappcheck.googleapis.com'
      || hostname === 'firebasestorage.googleapis.com'
      || hostname === 'storage.googleapis.com'
      || hostname.endsWith('.firebasestorage.app')
      || hostname.endsWith('.firebaseio.com')
      || hostname.endsWith('.firebasedatabase.app')
      || hostname.endsWith('.cloudfunctions.net')
      || (hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))
      || (hostname === 'www.google.com' && url.pathname.startsWith('/recaptcha/'))
      || hostname === 'recaptcha.google.com'
      || hostname === 'docs.google.com';
  } catch { return true; }
}

function isCacheableResponse(response, value) {
  return response?.ok === true
    && response.type !== 'opaque'
    && !isProtectedNetworkRequest(value);
}

self.addEventListener('fetch', event => {

  // Les données Firebase, Auth, Storage, App Check et les blobs restent hors Cache Storage.
  if (event.request.method !== 'GET'
      || isStorageBlobRequest(event.request.url)
      || isProtectedNetworkRequest(event.request.url)) {
    return;
  }

  const url = new URL(event.request.url);
  const acceptHeader = event.request.headers.get('accept');
  const isSameOrigin = url.origin === self.location.origin;

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
          if (isCacheableResponse(response, event.request.url)) {
            const resClone = response.clone();
            return caches.open(CACHE_NAME)
              .then(cache => cache.put(event.request, resClone))
              .catch(() => {})
              .then(() => response);
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
            const coque = url.pathname.endsWith('/app/')
              ? await caches.match(new URL('./app/index.html', self.location.href).href)
              : await caches.match(event.request, { ignoreSearch: true });
            if (coque) return coque;
            return (await caches.match('./offline.html'))
              || new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
          }
          return new Response('', { status: 504, statusText: 'Hors ligne' });
        })
    );
  } else {
    // Stratégie Stale-While-Revalidate pour les autres ressources (images, CDNs, etc.)
    const updatePromise = fetch(event.request)
      .then(async response => {
        if (isCacheableResponse(response, event.request.url)) {
          try {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
          } catch { /* Le réseau reste utilisable si le cache est plein. */ }
        }
        return response;
      })
      .catch(() => new Response('', { status: 504, statusText: 'Hors ligne' }));
    event.waitUntil(updatePromise.catch(() => {}));
    event.respondWith(
      caches.match(event.request)
        .catch(() => null)
        .then(cachedResponse => cachedResponse || updatePromise)
    );
  }
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'GET_VERSION' && event.ports?.[0]) {
    event.ports[0].postMessage({ version: APP_VERSION, cacheName: CACHE_NAME });
  }
});

# L2-12 — Service worker : hors-ligne et version liée

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constats d'audit** | N8, N5 |
| **Estimation** | 1 h 30 |
| **Fichiers** | `sw.js`, `offline.html` (nouveau), `.github/workflows/validate.yml` |
| **Dépend de** | `L2-05` — la liste de pré-cache cite `css/style.css`, que `L2-05` supprime. À traiter après, sinon le pré-cache échoue en bloc. |

---

## Pourquoi

**Le repli hors-ligne ne replie sur rien.** `sw.js` (~l. 76) :

```js
.catch(() => caches.match(event.request))
```

Si la ressource n'est pas en cache, `caches.match` résout à `undefined`, et
`respondWith(undefined)` produit l'erreur réseau brute du navigateur. Il n'y a pas de page
hors-ligne.

**Le pré-cache ne couvre que l'accueil.** `ASSETS_TO_CACHE` liste `index.html`, ses feuilles et
les modules de la scène 3D. Les dix autres pages, les deux bases de données JSON (`careers.json`,
`skills.json`) et les portraits ne sont mis en cache qu'opportunément, à la première visite.

**Les librairies CDN ne sont pas pré-cachées** (constat N5). Décision retenue : garder le CDN,
mais pré-cacher les trois URL épinglées, pour qu'une panne de jsDelivr après la première visite
ne rende plus la page PNJs inutilisable.

**La version du cache est indépendante d'`APP_VERSION`.** Deux constantes à tenir synchronisées
à la main, dans deux fichiers, sans aucun contrôle — c'est exactement ce qui a produit le retard
du CHANGELOG (constat N1).

---

## À faire

### 1. `offline.html`

Une page minimale, **sans aucune dépendance externe** : ni feuille de style liée, ni police
distante, ni module. Les styles en ligne sont ici l'exception justifiée — la page doit
fonctionner quand rien d'autre n'est disponible.

Elle doit indiquer que la connexion est indisponible, que les pages déjà consultées restent
accessibles, et proposer un bouton de rechargement. Reprendre les couleurs du thème sombre en
valeurs littérales (`#07070d`, `#c9a84c`, `#e7e1d5`).

### 2. Réécrire la liste de pré-cache

À établir **après** `L2-05`, en repartant des `<link>` et `<script>` réellement présents dans les
pages. Doivent y figurer :

- les onze pages HTML, plus `./` et `offline.html` ;
- les feuilles de style **réellement présentes** au moment du brief : `base.css`,
  `components.css`, `theme-parchment.css`, `hero3d.css`, `fiche.css`. Pas `doodle.css` :
  `L2-04` n'est pas encore fait, le fichier n'existe pas. Ne pas l'anticiper — une URL en 404
  suffit à faire échouer l'installation ;
- tous les modules de `js/` et `js/hero3d/` ;
- `js/data/careers.json` et `js/data/skills.json` ;
- les cinq portraits WebP et les deux vignettes de cartes — **uniquement les `.webp`**, les PNG
  ayant été supprimés par `L2-06` ; plus `favicon.svg` et `manifest.json` ;
- les trois URL CDN épinglées : Three.js, d3, Cropper (et sa feuille CSS).

**Ne pas** y mettre les tuiles de cartes (2 618 fichiers), ni les URL Firebase, ni
`docs.google.com` — le gestionnaire de `fetch` les exclut déjà explicitement.

Attention : `cache.addAll()` est **atomique**. Une seule URL en échec fait échouer toute
l'installation du service worker, silencieusement. Deux conséquences :

- vérifier chaque chemin de la liste après `L2-05` et `L2-06` ;
- pré-cacher les trois URL CDN **séparément**, dans un second `cache.addAll()` dont l'échec est
  toléré :

```js
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
```

### 3. Servir `offline.html` en dernier recours

Dans la branche `isCodeAsset` du gestionnaire de `fetch` :

```js
.catch(async () => {
    const enCache = await caches.match(event.request);
    if (enCache) return enCache;
    // Navigation sans rien en cache : page hors-ligne plutôt que
    // l'erreur reseau brute du navigateur.
    if (event.request.mode === 'navigate') {
        return (await caches.match('./offline.html'))
            || new Response('Hors ligne', { status: 503, statusText: 'Hors ligne' });
    }
    return new Response('', { status: 504, statusText: 'Hors ligne' });
});
```

Le `new Response` de secours évite de retomber sur `respondWith(undefined)` si même
`offline.html` manque.

### 4. Lier la version du cache

Un service worker ne peut pas importer un module du site — la cohérence se garantit donc au
contrôle, pas au partage de code.

```js
// sw.js, en tête. Doit rester identique à APP_VERSION de js/layout.js :
// la CI le vérifie (.github/workflows/validate.yml).
const APP_VERSION = 'v2.14.1';          // valeur du jour, à reprendre de js/layout.js
const CACHE_NAME  = 'wfrp-cache-' + APP_VERSION;
```

Puis une étape dans `.github/workflows/validate.yml` :

```yaml
  version-coherence:
    name: Coherence version / cache / CHANGELOG
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Verifier APP_VERSION, CACHE_NAME et CHANGELOG
        run: |
          node -e "
          const fs = require('node:fs');
          const rd = f => fs.readFileSync(f, 'utf8');
          const a = rd('js/layout.js').match(/APP_VERSION = '(.+?)'/)?.[1];
          const b = rd('sw.js').match(/APP_VERSION = '(.+?)'/)?.[1];
          if (!a || !b) { console.error('APP_VERSION introuvable'); process.exit(1); }
          if (a !== b) { console.error('layout.js ' + a + ' != sw.js ' + b); process.exit(1); }
          if (!rd('CHANGELOG.md').includes('[' + a.slice(1) + ']')) {
            console.error('CHANGELOG.md sans entree pour ' + a); process.exit(1);
          }
          console.log('Version coherente : ' + a);
          "
```

Ce contrôle automatise la convention que le projet s'était fixée sans pouvoir la faire
respecter : plus aucune version ne peut partir sans son entrée de CHANGELOG ni sans purge du
cache. Depuis le 10 août, six versions ont été publiées à la main en deux jours — le risque
d'oubli est actif, pas théorique.

Deux remarques sur le changement de nom du cache :

- il passe de `wfrp-cache-v12` à `wfrp-cache-v2.14.1`. Le gestionnaire `activate` supprime déjà
  tout cache dont le nom diffère de `CACHE_NAME`, donc l'ancien est purgé automatiquement.
  Aucune action, mais ne pas s'en inquiéter en voyant deux caches un instant ;
- `L2-14` ajoutera un `package.json` avec `"type": "module"`. Vérifier alors que le `node -e`
  de ce contrôle, qui utilise `require()`, fonctionne toujours — sinon le convertir en ESM ou
  le déplacer dans un fichier `.cjs`. **`L2-12` doit passer avant `L2-14`** pour que ce contrôle
  existe au moment où on l'éprouve.

---

## Ne pas faire

- **Ne pas changer la stratégie de cache.** *Network First* sur les fichiers de code et
  *Stale-While-Revalidate* sur le reste ont été mis en place en 2.11.1 pour résoudre un problème
  de cache persistant. Elles sont correctes, ne pas y toucher.
- **Ne pas pré-cacher les tuiles de cartes.** 2 618 fichiers, 18 Mo : le commentaire présent
  dans `sw.js` le dit déjà, il reste valable.
- **Ne pas utiliser Workbox** ni aucune librairie de service worker.
- **Ne pas retirer `{ updateViaCache: 'none' }`** de l'enregistrement dans `js/main.js`.
- **Ne pas copier les librairies dans le dépôt.** L'option a été évaluée et écartée : le CDN est
  conservé, seul le pré-cache est ajouté.

---

## Vérification

Tous les essais se font avec l'onglet Application des outils de développement (section Service
Workers et Cache Storage), après un **Unregister** et un rechargement complet.

- [ ] Après première visite de l'accueil : le cache contient toutes les entrées de la liste,
      **aucune** manquante. Une installation qui échoue est silencieuse — vérifier explicitement
      que le service worker est bien passé en état `activated`.
- [ ] Mode hors-ligne, puis navigation vers une page **jamais visitée** : `offline.html`
      s'affiche, avec son bouton de rechargement fonctionnel.
- [ ] Mode hors-ligne, navigation vers une page déjà visitée : la page s'affiche depuis le cache.
- [ ] Visiter `pnjs.html` une fois, puis bloquer `cdn.jsdelivr.net` (onglet Réseau → Block
      request domain) et recharger : le graphe d3 se charge toujours et la modale de recadrage
      s'ouvre.
- [ ] Même essai pour Three.js sur l'accueil.
- [ ] Simuler une panne CDN **à la première visite** (domaine bloqué, cache vidé) :
      l'installation du service worker doit **réussir** malgré tout (c'est ce que
      `Promise.allSettled` garantit), même si la page PNJs ne fonctionne pas.
- [ ] Modifier `APP_VERSION` dans `js/layout.js` **seulement** : la CI échoue avec un message
      explicite.
- [ ] Retirer l'entrée correspondante du CHANGELOG : la CI échoue.
- [ ] Les trois valeurs cohérentes : la CI passe.
- [ ] Après un déploiement, un onglet ouvert sur l'ancienne version reçoit bien la nouvelle au
      rechargement (le numéro de version dans la barre de navigation le confirme).
- [ ] L'ancien cache (`wfrp-cache-v8`) est bien supprimé à l'activation du nouveau.
- [ ] La fiche fonctionne toujours hors ligne pour la lecture (les données JSON étant
      pré-cachées), et l'écriture Firestore échoue proprement avec le statut « ⚠ Erreur ».

---

## Message de commit

```
fix(pwa): page hors-ligne, pre-cache elargi et version liee (N8, N5)

Le repli hors-ligne renvoyait undefined quand rien n'etait en cache,
ce qui produisait l'erreur reseau brute du navigateur. Le pre-cache ne
couvrait que l'accueil, et la version du cache etait independante
d'APP_VERSION, sans aucun controle.

- offline.html, sans dependance externe, servie en dernier recours
- pre-cache des 11 pages, des feuilles, des modules, des JSON et des
  portraits ; CDN pre-caches separement en Promise.allSettled pour
  qu'une panne n'empeche pas l'installation du worker
- CACHE_NAME derive d'APP_VERSION, coherence verifiee en CI avec
  l'entree de CHANGELOG correspondante
```

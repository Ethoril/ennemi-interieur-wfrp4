# M6-02 — Service worker, mise à jour et aide d’installation

## Contrat livré

Le seul service worker reste [`../../sw.js`](../../sw.js), à la racine du dépôt. Le bureau continue
de l’enregistrer avec son scope racine et `/app/` enregistre le même fichier via `../sw.js` avec le
même scope. Aucun `app/sw.js` ni second manifeste/service worker n’est créé.

Le précache local inclut `app/index.html`, la feuille mobile, les modules de la coque et leurs
imports locaux nécessaires, les icônes M6-01 et les ressources bureau existantes. Le contrôle
`tools/m6-02-service-worker.test.mjs` vérifie l’existence de chaque entrée et la fermeture du graphe
d’imports mobile. À l’activation, le worker inspecte aussi les réponses déjà présentes dans son
cache courant et supprime toute entrée protégée ou opaque héritée, même sans changement de nom de
cache.

## Données exclues

Le worker ne répond pas aux requêtes non-GET, `blob:`/`data:` ou aux hôtes Firestore, Auth, Secure
Token, App Check, Storage, Realtime Database, Cloud Functions, Firebase CDN d’exécution et documents Google. Il refuse aussi
les réponses opaques avant tout `cache.put`. Les données publiques restent dans le cache IndexedDB
du client public ; les données MJ et les médias protégés ne transitent pas par Cache Storage.

Les navigations et modules locaux utilisent network-first avec repli vers le précache. Une navigation
`/app/` hors ligne sert `app/index.html`; le routeur interprète ensuite le hash. Les ressources
statiques et CDN non protégées peuvent suivre la stratégie cache existante.

## Mise à jour contrôlée

L’installation n’appelle plus `skipWaiting()` automatiquement. Un worker en attente est signalé
comme mise à jour disponible. Depuis Réglages, l’utilisateur peut rechercher puis appliquer la mise
à jour ; l’action passe d’abord par `router.canLeaveCurrent()`, donc une saisie sale ou un brouillon
en cours différé reste intact. Seule l’action confirmée envoie `SKIP_WAITING`. Le premier
`controllerchange` provoqué par cette action recharge la page au plus une fois.

Réglages expose la version d’interface, la version du worker (via `GET_VERSION`) et les actions de
recherche/application. Les échecs de diagnostic restent des états locaux sans détails techniques.

## Installation facultative

`beforeinstallprompt` est capturé sans imposer l’installation et propose un petit bandeau DOM
accessible après le premier écran utilisé, avec une action non intrusive et un bouton « Plus tard ».
Un rejet est mémorisé temporairement. Sur iOS, l’aide indique « Partager → Sur l’écran d’accueil » ;
elle est masquée en mode standalone. L’application reste utilisable sans installation.

## Validation et limites

Validations automatisées exécutées : `npm run test:m6-02`, `npm run lint`, `npm run check` et
`git diff --check`. Aucun appareil Android/iOS, profil navigateur de production, inspection réelle
de Cache Storage ou déploiement n’a été exécuté dans ce lot ; ces recettes restent à faire lors de
la recette M6-03. `APP_VERSION`, `CACHE_NAME` et `CHANGELOG.md` ne sont pas modifiés.

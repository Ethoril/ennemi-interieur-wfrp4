# F-02 — Socle : route, données, en-tête, onglets, menu ⋯, fixture QA

> Lire d'abord [`README.md`](README.md), le cahier des charges §§ 3–4 et les sections 1 à 4 et 7 à 9
> de [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md).

| | |
|---|---|
| Objectif | Ouvrir une fiche dans l'application mobile, avec ses quatre onglets vides mais navigables |
| Fichiers | `js/mobile/router.js`, `js/mobile/app.js`, `app/index.html`, `sw.js`, nouveaux : `js/mobile/fiche-runtime.js`, `js/mobile/fiche-catalogue.js`, `js/fiche/derived.js`, `js/mobile/fiche-model.js`, `js/mobile/views/fiche-detail.js`, `css/mobile-fiche.css`, `tools/fixtures/fiche-mobile-qa.{html,js}`, tests `tools/fiche-mobile-*.test.mjs` |
| Dépend de | F-01 |

## À faire

### 1. Route

- `ROUTE_NAMES.FICHE = 'fiche-detail'`. `parseRoute` : `#/fiches/<id>` et `#/fiches/<id>/<onglet>`
  avec `onglet ∈ principal | aptitudes | carriere | journal` (défaut `principal` ; onglet inconnu →
  `UNKNOWN`). Retour `Object.freeze({ name: FICHE, id, tab })`. `#/fiches` reste `FICHES`.
- `routeToHash` : `#/fiches/<id>` pour `principal`, `#/fiches/<id>/<onglet>` sinon.
  `documentTitleForRoute` : « Fiche — L'Ennemi Intérieur » (sans identifiant). `back()` depuis FICHE
  → `#/fiches`.
- **L'onglet n'entre pas dans `routeKey`** : changer d'onglet ne remonte pas la vue (pas de
  réabonnement Firestore). Les onglets sont de vrais liens `<a href="#/fiches/<id>/<onglet>">` ; la
  vue écoute `hashchange` sur `windowRef` (désabonnement à `unmount`), relit l'onglet avec
  `parseRoute`, rend le panneau, met `aria-current="page"` et annonce « Onglet <nom> ». Le bouton
  précédent du téléphone revient donc à l'onglet précédent.

### 2. Coque (`js/mobile/app.js`, `app/index.html`)

- `onOpenFiche(id)` → `router.navigate({ name: ROUTE_NAMES.FICHE, id })` au lieu de quitter
  l'application.
- `sectionForRoute` / `sectionHash` : FICHE appartient à la section `fiches`.
- Sur FICHE : bouton retour visible ; `.m-bottom-nav` masquée (`hidden`) et rétablie ailleurs ;
  bouton d'en-tête ⋯ visible, il appelle `view.openMenu?.(trigger)` (sur RÉGLAGES il garde son rôle
  actuel) ; titre d'en-tête = nom du personnage dès qu'il est connu (la vue reçoit un callback
  `setTitle(texte)` ; « Fiche » en attendant).
- `app/index.html` charge `../css/mobile-fiche.css` et `../css/career-viewer.css` (après
  `mobile-app.css`). CSP inchangée (la carte confirme qu'elle suffit).
- Respecter les contraintes du test m3-01 (pas de `firebase` ni d'URL dans `app.js`/`router.js`).

### 3. Données

- `js/mobile/fiche-runtime.js` (chargé par `import()` depuis `app.js`, comme
  `contribution-runtime.js`) : crée le dépôt avec `createFicheRepository` sur l'app Firebase par
  défaut (`js/firebase-init.js`), mêmes imports SDK et mêmes callables que `js/fiche-cloud.js`
  (`executeFicheCommand`, `migrateFiche`), sans importer `fiche-cloud.js` ni `fiche.js`.
- `js/mobile/fiche-catalogue.js` : charge `careers.json`, `skills.json`, `fiche-catalog.json`,
  `referentiel-public.json`, `talents-sheet-snapshot.json` par
  `new URL('../data/…', import.meta.url)` (chemins robustes depuis `/app/`), construit
  `createPublishedCatalogueEngine`, puis le reconstruit à chaque catalogue vivant reçu de
  `repository.subscribePublicCatalogue` (repli statique si `null`). Expose le moteur courant et un
  abonnement aux changements.
- La vue crée un `createFicheController` par montage (dépôt, `createFicheDraftStore` sur
  `localStorage`, `isOnline` branché sur `navigator.onLine`) et appelle
  `setSession({ uid, charId, role })` d'après `getContributionClient().watch(...)` : `role = 'mj'`
  si `capabilities.role === 'mj'`, sinon `'joueur'`. Si `charId` n'est pas dans
  `capabilities.characterIds` : écran « Fiche indisponible » avec retour à « Mes fiches ».
  Non connecté : même invitation à se connecter que `fiche-access.js`.
- État réseau : écouter `online`/`offline` ; à `online`, relancer `controller.submitPatch()` s'il y a
  un brouillon (comme le bureau).
- Phases du contrôleur : `loading` → squelette ; `error`/`missing`/`tombstone` → carte d'état
  (`renderState` de `ui.js`) ; `legacy-readonly` → message « Fiche à migrer par le MJ depuis le
  bureau », lecture seule.

### 4. Modèle pur

- `js/fiche/derived.js` (client seulement, **non** synchronisé vers `functions/`) : `caracTotal`,
  `caracBonus`, `blessuresMax` (formule et cas Halfelin / « Dur à cuire » de `updateBlessuresMax`),
  `mouvement` (table `MOUVEMENT` de `fiche.js`), `xpBalance` → `{ gagne, depense, libre }` (même
  règle que `recalc`). Reproduire fidèlement le bureau ; un test compare chaque fonction sur des
  fiches témoins (dont halfelin et « Dur à cuire » ×2).
- `js/mobile/fiche-model.js` : `ficheIdentity(data, engine)` → `{ nom, carriere, titreRang, rang,
  statut }` via `findCareerByName`, `activeCareerRank`, `getActiveVariantForRang` ; les fonctions des
  briefs suivants y seront ajoutées.

### 5. Vue `js/mobile/views/fiche-detail.js`

Contrat de vue habituel (`mount({signal})`, `unmount`, `focusTarget`, `routeAnnouncement`) plus
`openMenu(trigger)`. Structure, d'après la maquette `Main.dc.html` :

- bandeau d'identité sous l'en-tête : « Carrière · Titre · Rang N » et pastille « N XP libres »
  (lien vers l'onglet Journal) ;
- zone du panneau courant : pour l'instant un titre et « Bientôt disponible » par onglet ;
- barre d'onglets fixée en bas (`nav.m-fiche-tabs`, `aria-label="Sections de la fiche"`, 4 liens
  icône + libellé : Principal, Aptitudes, Carrière, Journal ; icônes SVG en ligne, sans emoji) ;
- menu ⋯ : `<dialog>` piloté par `createDialogController`, avec « Exporter la fiche » et « Importer
  une fiche » (désactivés jusqu'à F-07, importer visible pour le MJ seulement) et le lien « Ancienne
  fiche » vers `../fiche.html?char=<id>&return=mobile`.

Injection pour les tests et la fixture : `createFicheDetailView({ container, documentRef, windowRef,
route, getClient, loadRuntime, loadCatalogue, setTitle, announce, navigate })` — `loadRuntime` rend
`{ repository }`, `loadCatalogue` rend le service de catalogue.

### 6. Styles `css/mobile-fiche.css`

Préfixe `m-fiche-`. Variables de `base.css` uniquement (aucune couleur en dur) ; texte de base
`1.0625rem` ; cibles ≥ 44 px ; barre d'onglets comme `.m-bottom-nav` (fixe, zone sûre basse) ;
`padding-bottom` du contenu pour ne pas passer sous la barre ; colonne centrée sur
`--m-content-width`.

### 7. Fixture QA locale

`tools/fixtures/fiche-mobile-qa.html` + `.js`, sur le modèle de `fiche-qa.*` (garde localhost) :
monte `createFicheDetailView` dans une coque minimale (mêmes CSS que `app/index.html`, en-tête avec
titre, retour et ⋯), avec un faux client (`watch` → joueur ou MJ, `characterIds: ['test']`), un faux
dépôt qui applique les commandes avec `createPublishedCatalogueEngine` (comme le serveur) et un
catalogue local. Boutons QA : joueur, MJ, hors ligne, achat refusé, réinitialiser. Données témoin
réalistes et fictives : une carrière en cours (Agitateur rang 1), des avances en caractéristiques et
compétences, un talent, une spécialité, un journal XP de plusieurs lignes.

### 8. Précache et tests

- Ajouter à `ASSETS_LOCAUX` de `sw.js` : chaque nouveau module importé par le mobile et
  `css/mobile-fiche.css`. `tools/m7-01-release.test.mjs` doit rester vert.
- Tests `tools/fiche-mobile-route.test.mjs` (parseRoute/routeToHash/back), `fiche-mobile-derived`
  (derived.js), `fiche-mobile-view` (faux DOM : chargement, fiche indisponible, changement
  d'onglet sur `hashchange`, `aria-current`, menu sans import pour un joueur).

## Recette

- [ ] Depuis « Mes fiches », ouvrir une fiche ouvre `#/fiches/<id>` dans l'application.
- [ ] Onglets, bouton précédent, rechargement et lien profond `#/fiches/<id>/carriere` cohérents.
- [ ] Barre de l'application masquée sur la fiche, rétablie au retour.
- [ ] Fixture QA utilisable à 390 px.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): open character sheets inside the mobile app`

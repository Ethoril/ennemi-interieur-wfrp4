# Carte technique — fiche mobile (état au commit a328bba, v2.31.1)

Aucun fichier modifié. Les chemins sont relatifs à la racine du dépôt. HEAD = a328bba, version v2.31.1. Non suivis par git : `docs/FICHE-MOBILE.md`, `.claude/design-fiche-mobile/` (maquettes) et `.claude/launch.json`.

## Points de vigilance (à lire d'abord)

1. **Le domaine fiche n'est pas pur.** Total de caractéristique, bonus, Blessures max, Mouvement, soldes XP, aperçu de coût caracs/compétences/talents, `isXInCareer`, noms affichés : tout vit dans `js/fiche.js` (2924 lignes). Ce fichier est couplé au DOM, à `window.*` et à des `fetch('js/data/...')` relatifs. **Il ne faut pas l'importer depuis le mobile** : les chemins relatifs casseraient depuis `/app/`, et il a des effets de bord au chargement. Il faut extraire un module pur (ex. `js/fiche/derived.js`) et le tester.
   - `js/fiche-cloud.js` (le câblage bureau) n'est pas non plus réutilisable : il importe `fiche.js` et agit sur le DOM au chargement.
2. **Synchronisation du domaine.** `tools/sync-fiche-domain.mjs` (appelé par `npm run check` et `functions/package.json test`) copie vers `functions/src/domain/…` : `js/fiche/{commands,career-model,basic-skills,skill-names,xp,published-catalogue-engine}.js`, `js/fiche-schema.js`, `js/catalogue/{skill-resolver,talent-resolver}.js`, plus les JSON `careers`, `skills`, `fiche-catalog`, `referentiel-public`, `talents-sheet-snapshot`. Si un de ces fichiers change, il faut lancer `node tools/sync-fiche-domain.mjs` (sans `--check`) et committer les copies. Un nouveau module client-only (ex. `js/fiche/derived.js`) n'est pas dans la liste, ce qui est correct.
3. **Contraintes de tests sur le shell** (`tools/m3-01-mobile-shell.test.mjs`, l.140-170) :
   - `app.js` et `router.js` ne doivent contenir ni `firebase` ni `https?://` (même en commentaire).
   - `views/fiche-access.js` non plus, et il doit contenir `getCampaignCapabilities` (dans un commentaire il y est aujourd'hui).
   - `app.js` doit contenir `ROUTE_NAMES.FICHES`, `container.scrollTop`, `Thème parchemin activé` et `actionLabel: 'Retour'`, et ne doit pas utiliser `windowRef.scrollY/scrollTo`.
   - `app/index.html` : `script-src 'self'`, `style-src 'self'`, `m-bottom-nav`, `href="#/fiches" data-route="fiches"`.
   - `views/pnj-detail.js` sans `innerHTML`.
   - Les modules Firebase doivent donc rester derrière un import dynamique (modèle `js/mobile/contribution-runtime.js`).
4. **CSP `style-src 'self'`** : pas d'attribut `style=""` ni de `setAttribute('style')`. L'API CSSOM (`el.style.setProperty('--x', …)`, `el.style.width = …`) reste permise. Les PNJ font déjà cela avec `--rc`. Pas de `<style>` inline.
5. **Fonctions Firebase de la fiche.** `executeFicheCommand` et `migrateFiche` sont en `onCall({ enforceAppCheck: true })` (`functions/src/index.js:39,46`, région europe-west1). La CSP mobile autorise déjà `europe-west1-campagne-wrpg.cloudfunctions.net`, `firestore.googleapis.com`, `firebaseappcheck.googleapis.com` et `content-firebaseappcheck…`. Les connexions Firestore (snapshot fiche, `referentiels/public`) passent par `firestore.googleapis.com`, déjà autorisé : **pas de changement de CSP nécessaire**. `docs.google.com` (fallback Sheets des talents) n'est PAS dans `connect-src` : il serait bloqué. Voir §4.

---

## 1. Coque mobile

### `app/index.html` (74 lignes)
- `<html lang="fr" data-theme="dark">`. `meta app-version` (l.7, actuellement `v2.31.1`) est testée par m3-04/m5-03/m7-01.
- CSP en `<meta http-equiv>` (l.8). Contenu actuel :
  - `default-src 'self'; base-uri 'none'; object-src 'none'`
  - `script-src 'self' gstatic apis.google recaptcha`
  - `style-src 'self'`; `img-src 'self' data: blob:`
  - `frame-src campagne-wrpg.firebaseapp.com + recaptcha`
  - `connect-src 'self' firestore firebasestorage identitytoolkit securetoken europe-west1-campagne-wrpg.cloudfunctions.net firebaseappcheck content-firebaseappcheck recaptcha`
- Feuilles chargées : `../css/fonts.css`, `base.css`, `theme-parchment.css`, `mobile-app.css`. Une seule balise `<script type="module" src="../js/mobile/app.js">`.
- **`css/mobile-fiche.css` doit être ajouté ici.** Pour la visionneuse de carrière, ajouter aussi `../css/career-viewer.css` (déjà précachée, 96 lignes, variables avec fallback, déjà un `@media (max-width:600px)` en bottom-sheet).
- Corps :
  - `a.m-skip-link` → `#m-main`.
  - `div.m-app#m-app` contient :
    - `header.m-header` avec `button#m-back.m-back-button[hidden]` (‹), `.m-header-copy` (`p.m-eyebrow`, `h1#m-title[tabindex=-1]`) et `button#m-header-action[hidden]` (⋯, ouvre aujourd'hui le dialog Réglages).
    - `section#m-pwa-banner`, `div#m-status[role=status]`, `div#m-route-status.visually-hidden[role=status]` (annonces routeur).
    - `main#m-main.m-main[tabindex=-1]`, qui est **le conteneur qui défile** (le `body` est en `overflow:hidden`).
    - `nav.m-bottom-nav[aria-label="Navigation principale"]` avec 4 liens `a[href="#/pnjs|#/enquetes|#/fiches|#/reglages"][data-route]`, `.m-nav-icon` + libellé.
  - `dialog#m-dialog.m-dialog` (Réglages, `#m-dialog-close`, `#m-theme-toggle`, `#m-dialog-ok`).

### `js/mobile/app.js` (490 lignes)
- Imports : `createAppLifecycle` (lifecycle.js), `createRouter, documentTitleForRoute, parseRoute, ROUTE_NAMES` (router.js), sessions publique et MJ, `ui.js`, toutes les vues, `contribution-runtime.js`, stores de brouillons, `pwa*.js`.
- `boot(documentRef, windowRef)` (l.~190-480) :
  - Sélectionne `#m-main`, `#m-status`, `#m-route-status`, `#m-title`, `#m-back`, `#m-header-action`, `#m-dialog`, etc.
  - Crée `session` (store public), `mjSession` (app Firebase nommée `mobile-mj`), `draftStore`, `enqueteDraftStore`.
  - Construit `const views = { [ROUTE_NAMES.X]: route => createXView({...}) }`.
    - Le contrat est `mountRoute: route => (views[route.name] || views[ROUTE_NAMES.UNKNOWN])(route)`.
    - La vue `FICHES` est à ~l.320 : `createFicheAccessView({ container, documentRef, getClient: getContributionClient, signIn: signInContribution, onOpenFiche, announce })`.
    - **`onOpenFiche`** fait `windowRef.location.assign('../fiche.html?char=' + encodeURIComponent(id) + '&return=mobile')`. À remplacer par `router.navigate({ name: ROUTE_NAMES.FICHE, id })`.
  - `router = createRouter({ windowRef, mountRoute, announce, setScrollY: v => container.scrollTop = v, getScrollY, onRoute })`.
- **`onRoute(route, view)`** (l.~390-415) fait tout le décor :
  - `sectionForRoute(route)` (l.~45) : `enquete*` → enquetes, `REGLAGES`, `FICHES`, sinon `'pnjs'` par défaut. **Un nouveau nom de route fiche retomberait sur `'pnjs'`** : il faut l'ajouter. `sectionHash` (l.~52) est à compléter aussi.
  - `documentRef.title = documentTitleForRoute(route)`.
  - `title.textContent` selon la section.
  - `(view?.focusTarget?.() || title).focus({preventScroll:true})`.
  - `back.hidden = !(PNJ|PNJ_NEW|PNJ_EDIT|ENQUETE*|UNKNOWN)` : à étendre pour la route fiche.
  - `headerAction.hidden = route.name !== REGLAGES` : le ⋯ de la fiche (export/import/Ancienne fiche) devra l'étendre, ou la vue fiche aura son propre en-tête.
  - Boucle `.m-bottom-nav a[data-route]` → `aria-current`.
  - Persiste `lastSection` (`store.getState().preferences.lastSection`, préférences nettoyées par `sanitizePreferences`, `store.js:86`, valeurs `['pnjs','enquetes','fiches','reglages']`).
- `back` → `router.back()`. `createDialogController` sert le dialog Réglages (`#m-dialog`).
- `mjSession.subscribe` + `createAdminRouteController` (`admin-route-controller.js`) refont le rendu uniquement pour PNJ/ENQUETE*. Aucun effet sur les fiches.
- `stop()` appelle `logoutContributionAccount()`.
- Au démarrage : `createAppLifecycle({windowRef, startApp: () => boot(document, window)})` (`lifecycle.js` : mount, `pagehide` → `stop()`, `pageshow` persisted → remount).

### `js/mobile/router.js` (229 lignes)
- `ROUTE_NAMES` (l.3) : `PNJS 'pnjs-list'`, `PNJ 'pnj-detail'`, `PNJ_NEW`, `PNJ_EDIT`, `ENQUETES 'enquetes-list'`, `ENQUETE`, `ENQUETE_NEW`, `ENQUETE_EDIT`, `FICHES 'fiches'`, `REGLAGES`, `UNKNOWN`.
- `ROUTE_ID = /^[A-Za-z0-9_-]{1,150}$/` ; `decodeSegment` (l.17).
- **`parseRoute(hash)`** (l.27) : retire `#`, refuse `?`, découpe en segments ; **UNKNOWN si > 3 segments** ou segment vide.
  - Ligne actuelle : `if (section === 'fiches' && segments.length === 1) return {name: FICHES}` (l.57). `#/fiches/<id>` donne donc aujourd'hui UNKNOWN.
  - Les 3 segments sont déjà tolérés par la garde générale, donc `#/fiches/<id>/<tab>` est possible sans toucher la limite.
  - Pour ajouter la route : nouvelle entrée (ex. `FICHE: 'fiche-detail'`) et dans `parseRoute` `fiches` avec 2 ou 3 segments, `decodeSegment(segments[1])`, tab validé contre `['principal','aptitudes','carriere','journal']` (défaut `principal`). Retourner `Object.freeze({ name: FICHE, id, tab })`.
  - Ajouter le cas dans `documentTitleForRoute` (l.66) avec un titre générique sans identifiant, `routeToHash` (l.82 ; ex. `#/fiches/<id>` ou `#/fiches/<id>/<tab>`), et `back()` (l.207, qui retombe sinon sur `#/pnjs` : ajouter fiche → FICHES).
- **`routeKey(route)`** (l.61) = `name:id`. `render()` fait `return currentRoute` si la clé est identique (et sans `force`). Donc **un changement d'onglet seul (même id) ne remonte pas la vue et ne notifie personne**. Deux options :
  - (a) inclure le tab dans la clé : la vue est remontée à chaque onglet, donc abonnement Firestore recréé, ce qui est lourd.
  - (b) garder le tab hors de la clé et que la vue écoute elle-même `hashchange` (`windowRef.addEventListener`, désabonnement dans `unmount`) en relisant `parseRoute(location.hash).tab`.
  - Dans les deux cas, `onRoute` n'est pas rappelé en (b) : le titre d'en-tête et l'annonce de changement d'onglet incombent à la vue.
  - Les onglets se mettent à jour avec `history.pushState` ou `replaceState` plus un `render` forcé, ou via `router.navigate({name, id, tab})`. `navigate` compare `routeToHash` à `location.hash`, appelle `pushState`, puis `render(hash)`.
- Défilement : sauvegardé par `routeKey`, mais restauré uniquement pour PNJS et ENQUETES. Les autres routes repartent à 0 (l.168) : à étendre si les onglets doivent conserver leur position.
- `session.js` `safeRouteHash` (l.~40) : liste blanche des hash restaurables après retour de connexion Google (redirect). `#/fiches` n'y figure déjà pas. À étendre seulement si on veut un retour direct sur `#/fiches/<id>`.

### Contrat de vue
Une fabrique `createXView({container, ...deps})` renvoie `Object.freeze({ mount({signal}), unmount(), focusTarget?(), routeAnnouncement?(), beforeLeave?() })`.
- `router.render` : `currentController.abort()` → `unmount()` de l'ancienne vue → `mountRoute` → `view.mount({signal})`. Si `mount` renvoie une promesse et que le token a changé, il fait `unmount`.
- Les `unmount` sont dédoublonnés par un `WeakSet`.
- `beforeLeave()` retournant `false` bloque la navigation (garde de brouillon, utilisé par les formulaires).
- Après le montage : `onRoute?.(route, view)`, puis `announce(view?.routeAnnouncement?.() || 'Écran chargé.')` dans `#m-route-status`.
- Modèle à imiter : `js/mobile/views/fiche-access.js` (159 lignes).
  - Le garde `mounted`, `connectionGeneration`, `abortSignal.addEventListener('abort', unmount, {once:true})`, `focusTarget()` renvoyant le `h2`.
  - L'abonnement se fait via `client.watch(listener, onError)`.
  - Rendu par `createElement`/`textContent` uniquement.
- Aide dans `js/mobile/ui.js` (386 lignes) :
  - `announce(element, message)`.
  - `renderState(container, {state, title, message, actionLabel, onAction})` (cartes loading/error/empty ; `role=alert` pour error).
  - `focusableElements(root)`.
  - **`createDialogController({dialog, documentRef})`** → `{show(trigger), close, isOpen}` : `showModal()`, piège de focus Tab/Maj+Tab, Échap, verrou `body.m-scroll-locked`, retour du focus à l'élément déclencheur.
  - `publicStatusKind/Message`.

### Barre basse
- Elle est **statique** dans `app/index.html` (l.44-57), `position: fixed; bottom:0` (`css/mobile-app.css:745-770`, `grid-template-columns: repeat(4, 1fr)`, `--m-nav-height: 4.25rem`).
- À ≥ 45rem elle est centrée sur `--m-content-width`.
- Il n'existe aucun mécanisme de masquage par route. Le plus simple est de cibler `.m-bottom-nav` depuis `onRoute` (`nav.hidden = route.name === FICHE`). `[hidden]{display:none!important}` est déjà défini (`css/mobile-app.css:15`).
- Il faut aussi réduire le `padding-bottom` de `.m-main` (`calc(var(--space-xl) + var(--m-nav-height) + var(--m-safe-bottom))`, l.142) pour la fiche, et `.m-form-actions{bottom: calc(var(--m-nav-height)+…)}` (l.727) est propre aux formulaires.
- Alternative : la vue fiche rend sa propre barre à 4 onglets à l'intérieur de `container` en `position: fixed` (comme `.m-bottom-nav`), ou une classe `m-app--fiche` posée sur `#m-app` par `onRoute`.
- Un `body` classe + `.m-app` en grille (`grid-template-rows: auto auto auto 1fr auto`) : la nav étant `fixed`, elle ne prend pas de rangée.

### Feuilles basses / dialogues existants
- Deux modèles en production :
  1. **`<dialog>` natif** : `js/mobile/components/filter-sheet.js` (306 lignes, `createFilterSheet({documentRef, dimensions, title, onApply})` → `{mount(parent), open({nextFacets, filters, trigger}), update, close, destroy, isOpen}`, construit sur `createDialogController`).
     - Classes `.m-dialog.m-filter-sheet` (`css/mobile-app.css:775-794` : `width:min(calc(100% - 2*space-md), 30rem)`, `margin:auto var(--space-md) var(--space-md)`, bordure or, `::backdrop var(--bg-overlay)` ; `.m-filter-sheet{max-height:min(80dvh,40rem)}`).
     - Fermeture : bouton ×, clic sur le fond (`event.target === dialog`), événement `cancel` → `preventDefault + close`.
     - Test : `tools/m3-03-filter-sheet.test.mjs` (FakeElement maison avec `.open`, `showModal`).
  2. **Overlay `div[role=dialog][aria-modal]`** : `pnj-relations-editor.js` (l.169-214, classes `.m-relation-sheet` + `.m-relation-sheet-panel`, `css:~800`) et `pnj-picker.js` (l.130, `.m-pnj-picker-sheet`).
     - Piège de focus fait main (keydown Échap/Tab), verrou de défilement par `body.className += 'm-scroll-locked'`, retour du focus (`lastFocus`).
     - Le panneau `.m-relation-sheet-panel` est déjà un bottom-sheet (`align-items:flex-end`, `border-radius` haut, `max-height:min(90dvh,48rem)`).
- **Il n'existe pas de composant « bottom sheet » réutilisable avec glisser-vers-le-bas.** La spec le demande (focus piégé, Échap, glisser vers le bas) : un nouveau composant `js/mobile/components/bottom-sheet.js` est à écrire. Il peut s'appuyer sur `createDialogController` (focus trap, Échap, retour de focus déjà gérés) et ajouter `pointerdown/move/up` sur la poignée, avec `transform` via CSSOM et `prefers-reduced-motion`.
- `.m-scroll-locked .m-main { overflow:hidden; touch-action:none }` (l.794) est testé par m3-01.

---

## 2. Accès authentifié et capacités

- **`js/mobile/contribution-runtime.js`** (17 lignes) : `getContributionClient()` fait `import('../contributions/firebase-client.js').then(m => m.contributionClient)`. Idem `signInContribution()` et `logoutContributionAccount()`.
- **`js/contributions/firebase-client.js`** (9 lignes) : importe `auth, functions` de `js/firebase-init.js` (app Firebase **par défaut** `[DEFAULT]`) et appelle `createContributionClient({auth, functions, sdk:{onAuthStateChanged, httpsCallable}})`. `signInContribution = loginWithGoogle` (`js/auth.js:31`), `signOutContribution = logout` (`js/auth.js:40`).
- **`js/firebase-init.js`** :
  - `app`, `appCheck` (ReCaptchaEnterpriseProvider, `isTokenAutoRefreshEnabled`, activé seulement si `location.hostname === 'ethoril.github.io'` via `js/app-check.js` `shouldInitializeAppCheck`).
  - `auth`, `db` (`getFirestore`), `storage`, `functions = getFunctions(app, FIREBASE_FUNCTIONS_REGION)`.
- **`js/contributions/client-core.js`** `createContributionClient` (l.7-43) :
  - Génère un appelant pour chaque nom de `CONTRIBUTION_HANDLERS` (dont `getCampaignCapabilities`, `httpsCallable(functions, name)`).
  - `watch(listener, onError)` : `onAuthStateChanged` → si pas d'utilisateur, émet `{user:null, capabilities:{role:'public', contribution:false, characterIds:[]}}`. Sinon appelle `getCampaignCapabilities()` et émet `{user, capabilities:{role: 'mj'|'joueur'|'public', contribution, characterIds: string[]}}` (gelés).
  - `currentUser()`.
- **Serveur** (`functions/src/contributions/service.mjs:464`) : MJ → `[...CAMPAIGN_CHAR_IDS, 'test']`. Joueur → ses `characterIds` d'après `campagne/acces` (comparaison par email). Sinon `[]`.
- **`fiche-access.js`** : `getClient()` doit renvoyer un objet avec `watch`. Il lit `value.capabilities.role` et `characterIds` (filtrés par `CHARACTER_LABELS`, `test` MJ seulement). `onOpenFiche(id)` est appelé au clic de `button.m-fiche-open[data-char-id]`.
- **Le rôle pour le contrôleur fiche** (`'mj'|'joueur'`) se déduit de `capabilities.role`. Le bureau l'obtient de `isAdmin` (`watchAuth`, `js/auth.js:11`, `user.email === ADMIN_EMAIL && emailVerified`). Le serveur recalcule toujours le rôle.
- La session MJ `mobile-mj` (`js/mobile/mj-runtime.js`) est une **autre** app Firebase (auth/Firestore séparés). La fiche utilise l'app par défaut, comme `fiche-access`.

---

## 3. Couche d'accès aux données fiche

### `js/fiche-repository.js` (66 lignes)
`createFicheRepository({db, doc, onSnapshot, callCommand, callMigration, collection, query, orderBy, limit, setDoc, deleteDoc, serverTimestamp})`. `charId` doit respecter `/^[A-Za-z0-9_-]{1,64}$/`. Retourne :
- `subscribe(charId, onValue({exists, envelope}), onError)` → unsubscribe.
- `subscribePublicCatalogue(onValue(catalogue|null), onError)` (document `referentiels/public`, champ `catalogue`).
- `execute(command)` → `callCommand(command).data`, soit le reçu `{operationId, charId, revision, result?}`.
- `migrate`, `subscribeHistory(charId, …)` (30 dernières, `orderBy revision desc`), `subscribePresence`, `heartbeatPresence`, `removePresence`.

Câblage bureau (`js/fiche-cloud.js:25-38`) :
`createFicheRepository({ db, doc, onSnapshot, collection, query, orderBy, limit, setDoc, deleteDoc, serverTimestamp, callCommand: httpsCallable(functions,'executeFicheCommand'), callMigration: httpsCallable(functions,'migrateFiche') })`. `db`/`functions` viennent de `firebase-init.js`. Les fonctions SDK sont importées de `https://www.gstatic.com/firebasejs/10.12.0/…` (firestore, functions). Le mobile doit faire de même derrière un module d'exécution lazy (ex. `js/mobile/fiche-runtime.js`, **à ajouter au précache**).

### `js/fiche-controller.js` (552 lignes)
`createFicheController({ repository, draftStore, canEditPath = defaultEditablePath, migrateDocument, makeOperationId = crypto.randomUUID, isOnline = () => navigator.onLine !== false, onChange = () => {}, receiptTimeoutMs = 8000 })`.

API (objet gelé, l.~520) :
- `getState()`.
- `setSession({uid, charId, role})` → fonction de fermeture. Rôle normalisé : tout sauf `'mj'` devient `'joueur'`. Souscrit à `repository.subscribe`. `setSession(null)` → phase `signed-out`.
- `close()`.
- `stagePatch(changes)` / `submitPatch()` / `retryPendingPatch()`.
- `executeOnlineCommand(type, payload)` / `retryPendingCommand()`.
- `resolveConflict(path, 'server'|'local')`.
- `getDraftPaths()`.
- `listOtherDraftSessions` / `restoreDraftSession`.
- Brouillons de correction MJ et `migrateLegacy(confirmCharId)`.

**État émis par `onChange(state)`** (gelé) : `phase`, `uid`, `charId`, `role`, `data` (copie avec brouillon superposé), `envelope`, `revision`, `conflicts: [{path, base, local, server}]`, `hasDraft`, `pendingPatchOperationId`, `pendingOperationId`, `draftPersistenceUnavailable`, `error`.

Phases : `signed-out`, `loading`, `ready`, `saving`, `awaiting-snapshot`, `command-pending`, `missing`, `tombstone`, `legacy-readonly`, `error` (avec `error: 'permission-denied'|'read-failed'`).

**Chemins patch autorisés** (`defaultEditablePath`, l.55) : simples `nom, race, blessuresAct, resilience, determination, chance, destin, corruption, possessions, optVisible.section-sorts, optVisible.section-prieres` ; `<root>.<id>.note` pour `careers|skillsAdvanced|talentsAcq|talentsAvail|sorts|prieres` ; `basicSpecs.<clé>` ; `chosenVariants.<careerId>.<1-5>`. Un patch de possessions passe donc par `stagePatch({possessions: '…'})` puis `submitPatch()` (`{status:'saved'|'awaiting-snapshot'|'blocked'|'retry-required'|'empty'|…}`). Il est bloqué avec `reason: 'offline'` si hors ligne et `'conflict'` si des conflits existent.

**Exécution d'une commande** : `await controller.executeOnlineCommand(type, payload)`.
- Précondition : phase `ready` (ou import MJ sur `missing`/`tombstone`), sinon `throw new Error('Fiche non modifiable')`. Hors ligne : `throw new Error('Une connexion est requise pour cette commande')`.
- Les types `gain|correct|import|reset` sont réservés au MJ (`PRIVATE_COMMANDS`).
- Construit `{charId, operationId, baseRevision, type, payload}`. Passe en `command-pending`. Appelle `repository.execute`. Attend le snapshot de révision ≥ `receipt.revision` (timeout 8 s).
- Retourne `{status:'confirmed', receipt}` ou `{status:'awaiting-snapshot', receipt}`, `{status:'retry-required', operationId}` (une commande déjà en attente), ou `{status:'stale'}`.
- En cas d'erreur, remet la phase et **relance l'erreur** (`error.code`, `error.details.kind`, `error.details.expectedCost/currentCost/balance/cost`). Une erreur « incertaine » (`unavailable|deadline-exceeded|internal|unknown`) conserve la commande pour `retryPendingCommand()`, **sans double débit** : `operationId` est inchangé et le serveur rejoue le reçu.
- La reprise « sans double débit » est donc déjà gérée par le contrôleur. Le mobile doit seulement exposer « Réessayer » quand `state.pendingOperationId` est présent.

Hors ligne : le contrôleur n'a pas d'événement réseau. `isOnline` est lu à l'appel. Le mobile doit fournir son propre état (`navigator.onLine` + événements `online`/`offline`) pour désactiver les boutons d'achat (« Achat possible une fois en ligne »). Sur `online`, le bureau relance `controller.submitPatch()` si brouillon (`fiche-cloud.js:249`).

**Conflits** : seuls les patchs (champs simples) peuvent entrer en conflit (3-way merge par chemin, `state.conflicts`). Pour résoudre : `controller.resolveConflict(path, 'server'|'local')`. Les commandes d'achat ne passent pas par là : conflit serveur = `error.code 'aborted'` (`details.kind 'conflict'`) ou `price-changed`.

### `js/fiche-client-bridge.js` (88 lignes)
Pont du `fiche.js` bureau : `createFichePatchAdapter(controller, {onStatus})`, `configureFicheClientBridge`, `cloudSave`, `stageFicheDraft`. **Inutile pour le mobile** : le mobile appelle directement `controller.stagePatch/submitPatch` (seul `diffAllowedPaths` est interne à ce module).

### `js/fiche-draft-store.js` (200 lignes)
`createFicheDraftStore({storage = localStorage, now, makeSessionId})` : `load/loadSession/listOtherSessions/save/remove` et variantes `Correction`. Clés `wfrp4:fiche-draft:v2:<uid>:<charId>:<session>`. Limites : 256 Ko par brouillon, 2 Mo par portée, 100 enregistrements. À instancier une fois côté mobile avec `window.localStorage`.

### `js/fiche-session-view.js` (250 lignes)
Rendu desktop de la barre de session (phase, retry, conflits, migration MJ…) dans `#fiche-auth-bar` via `document.createElement` global. **Pas réutilisable en mobile** (même si `PHASE_LABELS` peut inspirer les messages).

### `js/fiche.js` côté bureau (références de câblage)
- `executeFicheCommand(type, payload)` l.812 : `globalThis.ficheController.executeOnlineCommand` + messages de statut. En cas d'erreur, `kind = error.details.kind || error.code`.
- `validateXpPurchase` l.835-916 : construit le payload (voir ci-dessous).
- `ficheLoadCloud(data, isCurrent)` l.2385, `clearFicheView` l.2428, `setFicheRole(role, {allowImport})` l.2750.
- `exportData()` l.2113, `exportToFile` l.2144, `importFromFile` l.2167.
- Rôles : `'mj'|'joueur'|'readonly'`. Dans `fiche-cloud.js:76`, `phase` ∈ `legacy-readonly|tombstone|missing` ⇒ `readonly`.

### Payloads des achats (`js/fiche/commands.js:456`, `purchase`)
Enveloppe : `executeOnlineCommand('purchase', payload)`. Clés autorisées : `['kind','name','targetId','count','expectedCost','catalogVersion','careerId','rankMode','targetRank','currentRankDone']`. **`catalogVersion` obligatoire** et doit égaler le `catalogVersion` du moteur serveur (`skills:<catalogue.catalogVersion>|rules:<fiche-catalog.catalogVersion>`), sinon `failed-precondition` + `details.kind:'catalog-version-unsupported'`. `count` doit être entier 1..100. `expectedCost` doit égaler le coût recalculé, sinon `price-changed` (`details.expectedCost/currentCost`). XP insuffisants → `insufficient-xp` (`details.balance/cost`).
- **Caractéristique** : `{kind:'carac', name:'cc'|'ct'|'f'|'e'|'i'|'ag'|'dex'|'int'|'fm'|'soc', count, expectedCost, catalogVersion}` (tarif `xpBandCost(CARAC_XP_BANDS, carac[name].adv, count, isCaracInCareer)`).
- **Compétence** : `{kind:'skill', name:<nom complet>, targetId?, count, expectedCost, catalogVersion}`. `targetId` est :
  - la clé physique `BASIC_SKILLS.nom` (ex. `'Esquive'`, `'Corps à corps (Base)'`) pour une compétence de base ;
  - `skillsAdvanced[].id` pour une ligne avancée existante ;
  - absent pour une nouvelle spécialité (le serveur crée la ligne avec carac du groupe).
  - Le bureau envoie `name` via `getXfSkillFullNom()` et refuse si plusieurs lignes avancées correspondent sans `targetId`.
  - `resolvedSkillTarget` (l.232-283) fait la résolution : on peut passer le nom primaire ou un alias, le serveur résout.
- **Talent** : `{kind:'talent', name, count:1, expectedCost, catalogVersion}`. Coût `talentXpCost(inCareer)` : 100 en carrière, 200 hors carrière. Écrit `talentsAcq` `{id, nom, note: inCareer ? '' : 'hors carrière'}`.
- **Sort** : `{kind:'sort', name, count:1, expectedCost, catalogVersion}` (le sort doit exister dans `fiche-catalog.json` `spells`, 287 entrées). Coût `spellXpCost(spell, knownSpells)`.
- **Miracle** : `{kind:'miracle', name, count:1, expectedCost, catalogVersion}` (`miracles`, 15 entrées). Coût `miracleXpCost(prieres)`.
- **Rang** : `{kind:'rank', rankMode:'advanceRank', targetRank: rang+1, count:1, expectedCost: careerRankXpCost(completion.complete), catalogVersion}`.
- **Changement de carrière** : `{kind:'rank', rankMode:'changeCareer', careerId: <careers.json id>, targetRank, count:1, expectedCost, catalogVersion}`.
  - Même `careerRankXpCost` (100 si le rang actuel est achevé, 200 sinon).
  - Le serveur vérifie `prereq` (`{career, minRang}` ; satisfait par la carrière active ou une entrée d'`data.careers` de rang suffisant), sinon `career-prerequisite`.
  - La carrière actuelle est archivée dans `data.careers` (`{id, nom, rang, note:''}`).
  - Il refuse la même carrière au même rang.
- **Annulation** : `executeOnlineCommand('cancel', {purchaseId})`. Un joueur ne peut annuler que **son dernier achat** non annulé (`original.actorUid === uid`, `rows.findLast`) et si les effets sont toujours cohérents.
- `gain`, `correct`, `import`, `reset` sont MJ seulement (`payload.reason` ≥ 3 caractères). `purchase` reste autorisé au joueur.

Forme d'une entrée `xpLog` : gain `{id, kind:'gain', raison, montant, origin?, operationId?}` ; achat `{id, kind:'purchase', origin:'command', purchaseId, type:'Caractéristique|Compétence|Talent|Sort|Miracle|Carrière', achat:label, cout, applied:true, targetNom, avances, effects, cancelledByOperationId?, prevCareer?, completion?}` ; entrées historiques sans `kind` (`type, achat, cout, note`) ; `kind:'cancel'` (sans `cout`). Le solde = Σ `montant` des `kind:'gain'` − Σ `cout` des autres (fonction `xpBalance` non exportée dans commands.js l.187). Rendu bureau : `renderXpLog` l.2023.

### Fixture QA
`tools/fixtures/fiche-qa.js` (223 lignes) + `fiche-qa.html`, `fiche-import-qa.json`. Protégée par `localHosts` (localhost uniquement).
- Le dépôt factice `repository = { subscribe(_charId, next) → next({exists, envelope}), execute(command) }` :
  - **patch** : mise à jour de chemin par chemin ;
  - **reset/import** ;
  - **autres commandes** : `commandEngine.applyCommand(data, command, {uid:'fixture-user', role})` puis incrémentation de `revision` et notification de tous les `listeners` ;
  - déduplication par `operations.get(operationId)` (reçu rejoué), `delayNextResponse`/`releaseResponse` pour retarder la réponse.
- Le moteur est `createFicheCommandEngine({careers, skills, spells:{spells, miracles}, catalogVersion: ruleCatalog.catalogVersion})` sans résolveurs publiés (il faudrait `createPublishedCatalogueEngine({catalogue, careers, skills, spells: ruleCatalog, talentSheetSnapshot})` pour imiter le serveur, et envoyer `engine.catalogVersion`).
- Contrôleur : `createFicheController({repository, draftStore: createFicheDraftStore({storage: localStorage}), isOnline: () => online, makeOperationId: () => 'qa-'+uuid, onChange})`, `controller.setSession({uid:'fixture-user', charId:'test', role})`.
- Données témoin `testData()` : carac 30/0, `xpLog` avec un gain de 120.
- `fiche-qa.html` charge `js/fiche.js` (bureau) ; une fixture mobile serait un `tools/fixtures/fiche-mobile-qa.html` + `.js` à créer sur ce modèle.

---

## 4. Calculs de domaine à réutiliser

### Formes de données (`exportData()` fiche.js:2113)
`nom, race, carriere (nom de carrière ou de titre), rang (chaîne), blessuresAct, resilience, determination, chance, destin, corruption, possessions, carac:{cc|ct|f|e|i|ag|dex|int|fm|soc: {base, adv}}, skillsBasic:{<BASIC_SKILLS.nom>: adv}, skillsAdvanced:[{id, nom, carac, adv, note?}], careers:[{id, nom, rang, note}], talentsAcq:[{id, nom, note}], talentsAvail:[{id, nom, note}], sorts:[…], prieres:[…], xpLog, customSpecs, basicSpecs:{<groupe>: <spécialité>}, customTalents, chosenVariants:{<careerId>:{<rang>:<titre>}}, careerOverrides, optVisible:{'section-sorts', 'section-prieres'}`. Les valeurs de ressources (destin, chance, résilience, détermination) sont des **chaînes** numériques.

### Calculs actuellement dans `fiche.js` (à extraire dans un module pur)
- `getCaracTotal(c)` l.954 = `base + adv` ; `getBonus(c)` l.955 = `Math.floor(total/10)`.
- `countTalent(nom)` l.960 : nombre de lignes `talentsAcq` au nom identique (insensible casse et accents, `stripAccents` de `js/utils.js`).
- **`updateBlessuresMax`** l.966 : `bf + 2*be + bfm + countTalent('Dur à cuire') * be`, avec `bf = 0` si race `halfelin|halfling`, sinon bonus F ; `be` bonus E ; `bfm` bonus FM.
- **Mouvement** : constante locale `MOUVEMENT` (l.33) `{humain:4, 'elfe-sylvain':5, 'haut-elfe':5, halfelin:4, ogre:6, elfe:5, halfling:4, nain:3}`, défaut 4 (`recalc` l.979). Valeurs de `#race` : `humain, elfe-sylvain, haut-elfe, halfelin, nain, ogre` (`fiche.html:68-75`).
- **Corruption** : champ brut `data.corruption`.
- XP dans `recalc` l.973-: gagné = Σ `montant` des `kind==='gain'`, dépensé = Σ `cout` des autres, libre = gagné − dépensé.
- Coûts : `xpBandCost(bands, currentAdv, count, inCareer)` (`js/fiche/xp.js:5`, tarif doublé hors carrière), `CARAC_XP_BANDS`, `SKILL_XP_BANDS`, `talentXpCost(inCareer)` (100/200), `careerRankXpCost(done)` (100/200), `spellXpCost`, `miracleXpCost`. `computeXfCost` l.725 est la logique d'aperçu côté DOM : à reproduire en pur (caracs, compétences, talent, rang, sort, miracle).
- Aperçu à envoyer en `expectedCost` : doit être identique au serveur ; source de vérité = `commands.js`. Une alternative sûre est de calculer l'aperçu en appelant `engine.applyCommand(structuredClone(data), {type:'purchase', operationId:'preview', payload:{…, expectedCost: cost}}, {uid, role})` : mais le prix doit déjà être connu (sinon `price-changed` dont `details.currentCost` donne justement le coût, utilisable comme aperçu).

### Moteur et catalogue
- **`createPublishedCatalogueEngine({catalogue, careers, skills, spells, talentSheetSnapshot, rankCompletionPolicy='automatic'})`** (`js/fiche/published-catalogue-engine.js`, 88 lignes) retourne `{applyCommand, validatePatch, catalogVersion, skillResolver, talentResolver, resolveSkill(v), resolveTalent(v), evaluateCareerCompletion(data, career, rank)}`.
  - Entrées : `catalogue` = `js/catalogue/referentiel-public.json` (`{catalogVersion, publishedAt, sources, skills:{version, entries[296], aliases}, talents:{version, entries, aliases, templates, localDescriptions, descriptionSnapshotVersion}}`) ou la version vivante du document Firestore `referentiels/public` ; `careers` = `js/data/careers.json` (132 carrières, 298 Ko) ; `skills` = `js/data/skills.json` (292) ; `spells` = **l'objet entier** `js/data/fiche-catalog.json` (`{catalogVersion, fetchedAt, sources, spells[287], miracles[15]}`, 196 Ko) ; `talentSheetSnapshot` = `js/catalogue/talents-sheet-snapshot.json` (39 Ko).
  - Le bureau les charge par `fetch('js/data/…')` (`loadRuleCatalog`, l.55). Mobile : `fetch('../js/data/…')`. **Tous ces fichiers sont déjà précachés dans `sw.js`.**
  - **Catalogue vivant** : le bureau écoute `repository.subscribePublicCatalogue` et appelle `setPublishedFicheCatalogue(catalogue)` (fiche.js:87), qui reconstruit le moteur. Le serveur utilise `referentiels/public` de Firestore (sinon son `initialCatalogue`). **Le mobile doit faire de même** pour que `catalogVersion` envoyé corresponde au serveur après publication d'un référentiel ; le JSON statique n'est qu'un repli.
- `evaluateCareerCompletion(data, career, rank)` renvoie : `{complete, threshold (=5×rang), missingCaracs:[{name, advances, required}], qualifiedSkills:[{name, advances}], skillsRequired: 8, missingSkills (max(0, 8−n)), hasTalent, currentRankTalents:[…], selections}`. **La règle d'achèvement** (`requirementForPath`, `commands.js:330`) : toutes les carac de carrière (cumul des rangs 1..rang) avec `adv ≥ 5×rang`, ≥ 8 compétences de carrière à `adv ≥ 5×rang`, et au moins un talent acquis parmi ceux du rang courant. Les trois jauges de la spec se déduisent directement de ces champs (caracs : `getCareerCaracs.size − missingCaracs.length` sur `size` ; compétences : `qualifiedSkills.length` sur 8 ; talent : `hasTalent`).
- `career-model.js` (exports, `js/fiche/career-model.js`) : `findCareerByName(careers, name)` (nom de carrière ou titre de rang), `activeCareerRank(career, requested)`, `maxCareerRank`, `getRangVariants`, `getActiveVariantForRang`, `getVariantsToConsider`, `getEffectiveCaracs/Skills/Talents(career, rang, variant, overrides)`, `getCareerSkillSets(career, rang, chosenVariants, careerOverrides, skillResolver)` → `{exact:Set(lowercase), openBases:Set}`, `getCareerTalentSets(…, talentResolver)`, `getCareerCaracs(career, rang, chosen, overrides)` (Set, cumulatif sur les rangs), `isSkillInCareer`, `isTalentInCareer`, `isCaracInCareer`.
  - Les rangs ont des **variantes** (`career.rangs[]` avec le même `rang`, `titre`, `statut`, `caracs`, `skills`, `talents`) : le titre/statut du rang courant s'obtient avec `getActiveVariantForRang(career, rang, data.chosenVariants) || getRangVariants(career, rang)[0]`.
- Compétences de base : `js/fiche/basic-skills.js` : `BASIC_SKILLS` (25 lignes `{nom, carac}`), `getCaracForGroup`, `basicSkillNom(name, basicSpecs)` (ajoute la spécialité choisie), `basicRowFor(fullName, basicSpecs)`.

### Noms affichés des compétences (v2.30-2.31)
- Principe : **jamais le libellé stocké**, mais le nom principal du référentiel publié. Les formes reliées (alias) pointent vers l'entrée principale ; `resolve(label)` suit l'alias.
- API :
  - `engine.skillResolver.resolve(label)` (`js/catalogue/skill-resolver.js:106` `createSkillResolver`) retourne `{status:'resolved'|'ambiguous'|'unknown', entry, alias?, candidates?}` ; `entry.nom` est le **nom principal** (il suit les alias jusqu'à la cible, `asTargetId` l.34).
  - `resolveOwnedSkill(label)` : pareil + statut `'custom-specialization'` pour une spécialité libre `Groupe (Spé)` non listée.
  - `resolveCareerSlot(label)` : pour les emplacements de carrière (`(au choix)`, alternatives « A ou B »).
  - `resolver.primaryEntries` : les entrées non redirigées par un alias (v2.31 : « variantes reliées masquées »).
  - `js/catalogue/skill-forms.js` : `publishedSkillRows(resolver)` = `primaryEntries` + `group`/`spec` (liste des compétences sélectionnables) ; **`primarySkillLabel(resolver, label, careerSlot=false)`** (l.101) = entrée trouvée → `entry.nom` ; alternatives → `A ou B` ; slot ouvert → `Base (au choix)` ; sinon le libellé d'origine.
- **Ce que la fiche doit appeler pour afficher le nom principal d'une compétence stockée** : `primarySkillLabel(engine.skillResolver, storedName)`.
  - Le bureau fait `canonicalSkillNom(sk.nom)` (fiche.js:~245, `resolve(label)` → `entry.nom`, sinon `legacyCanonicalSkillNom`) pour les lignes avancées (renderAdvancedSkills l.1137) et pour chaque ligne de base (`buildBasicSkills` l.1035 : `canonicalSkillNom(sk.nom)`).
  - Les puces de carrière utilisent `primarySkillLabel(resolver, item, true)` (`renderCareerChips` l.1428, `getCareerAllSkills` l.1301).
  - **Compétences de base** : `skillsBasic` est indexé par la clé physique `BASIC_SKILLS.nom`. La ligne à afficher se filtre comme `buildBasicSkills` l.1040-1049 (ne garder que la ligne canonique par `entry.id`, exclure `!match.entry.basic`). Le nom affiché = `canonicalSkillNom(sk.nom)` ; la spécialité est `basicSpecs[sk.nom]` (`basicSkillNom`).
  - Dédoublonnage : plusieurs lignes avancées peuvent désormais pointer la même entrée principale (formes reliées) ; le bureau ne fusionne pas. Le mobile devra décider (sommer ou garder des lignes séparées, avec `targetId` par ligne pour l'achat).
- Recherche insensible aux accents : `stripAccents` dans `js/utils.js` ; le résolveur a aussi `suggest()` (Levenshtein, `suggestionKey` sans accents).
- Total d'une compétence = `getCaracTotal(carac) + adv` (carac de la ligne de base : `BASIC_SKILLS[].carac` ; avancée : `skillsAdvanced[].carac`). Compétence « de carrière » : `isSkillInCareer(career, rang, nom, chosenVariants, careerOverrides, skillResolver)`.

### Talents
- Description (`showTalentModal` fiche.js:1233) : **d'abord** `engine.resolveTalent(nom)` (`js/catalogue/talent-resolver.js`), retournant `{status:'resolved'|'ambiguous'|…, entry, displayedName, description, descriptionSource:'site'|'sheet', descriptionStatus:'available'|'source-unavailable'|'empty-local'|'empty-reference'|…}`. Il utilise les descriptions locales (`localDescriptions`) puis le snapshot Sheets (`talents-sheet-snapshot.json`), **sans réseau**.
- `fetchTalentData()` (l.1200, URL `docs.google.com/spreadsheets/…/gviz/tq?tqx=out:csv&sheet=Talents`) n'est qu'un dernier repli quand `_talentSheetSnapshot` est absent. Il est **bloqué par la CSP mobile** (et `docs.google.com` est dans `isProtectedNetworkRequest` du SW). Ne pas le porter : afficher « Aucune description publiée » dans ce cas.
- Les modales bureau utilisent `innerHTML` + `esc()` : le mobile utilisera `textContent` (descriptions multi-lignes : séparer sur `\n`).

### Sorts et miracles
- `js/data/fiche-catalog.json` : `spells[]` `{nom, type, cn, portee, duree, desc, …}` ; `miracles[]` `{nom, portee, cible, duree, effet, …}`. Lignes possédées : `data.sorts` / `data.prieres` (`{id, nom, …, note}`). « Sorts » n'apparaît que si `sorts.length || prieres.length`.

### Visionneuse de carrière (`js/fiche/career-viewer.js`)
`createCareerViewer({container, getContext, onTalent})` → `{update, destroy}` ; `getContext()` renvoie `{careers, careerName, rank, chosenVariants, careerOverrides, skillResolver, resolveSkill, resolveTalent, uid?}`.
- Construit lui-même (via `document.createElement` global) un `section.career-viewer` avec un bouton **« Voir la carrière complète »** qui ouvre un `<dialog class="career-viewer-modal">` (`showModal()`, `renderCareerModal` l.252, bouton `Fermer`, liste de toutes les carrières).
- Plein écran sur mobile : le CSS `career-viewer.css:92-95` le rend en bottom-sheet (`max-height:92dvh`, `width: calc(100% - .4rem)`). Un plein écran réel demande un override dans `css/mobile-fiche.css` (`.m-app .career-viewer-modal { inset:0; width:100%; max-height:none; height:100dvh; border-radius:0 }`).
- Il manque un moyen d'ouvrir directement la modale : l'état `modalOpen` est interne, déclenché seulement par le clic sur `.career-viewer-open`. Pour un lien « Toutes les carrières » : monter le viewer dans un hôte caché et appeler `.click()` sur `button[data-testid="open-modal"]`, ou ajouter une option `openModal: true` à `createCareerViewer` (modification de `js/fiche/career-viewer.js` : non synchronisé vers functions, mais testé par `tools/fiche-career-viewer.test.mjs`).
- Il utilise la police et les variables `--bg-card`, `--text-primary` (avec fallbacks parchemin) : OK dans les deux thèmes.

### Flux de changement de carrière sur le bureau
`buildXfRangPicker` (fiche.js:563) : `select#xf-rang-mode` (`next` = rang suivant avec titre, ou `new`), `input#xf-new-career` (datalist `career-names-list`), `input#xf-new-rang` (1..5). `validateXpPurchase` (l.884-915) : mode `new` → `findCareerByName(window.WFRP_CAREERS, careerName)`, `rankMode='changeCareer'`, `careerId = targetCareer.id`, `targetRank = +new-rang`. Complétion calculée sur la **carrière actuelle** (`evaluateCareerCompletion(exportData(), currentCareer, getActiveRang())`) → `expectedCost = careerRankXpCost(completion.complete)`. Les prérequis (`career.prereq {career, minRang}`) ne sont vérifiés **que par le serveur** (le bureau n'avertit que dans le panneau de référence, l.1520). Un sélecteur mobile devrait filtrer lui-même avec la même règle que `commands.js:560-570`.

---

## 5. Export / import JSON
Pas de module réutilisable : tout est dans `js/fiche.js`.
- **`exportToFile()`** l.2144 : charge `{_format:'wfrp4-fiche', _version:1, _app, _charId, _exportedAt, ...exportData()}`, `Blob` + `URL.createObjectURL` + `<a download="fiche-<id>-<AAAA-MM-JJ>.json">`. Dépend de `document.querySelector('.nav-version')` pour `_app` et de `_charParam`. Bouton `#btn-export-fiche` (autorisé au joueur).
- **`importFromFile(file)`** l.2167 : valide `_format === 'wfrp4-fiche'`, **réservé MJ** (`_activeFicheRole === 'mj'` ou `allowImport` pour `missing`/`tombstone`), motif obligatoire via `confirmTextAction` (`js/ui-confirm.js`), filtre sur `exportKeys` (26 clés, copie de `EXPORT_KEYS` de commands.js l.20), `migrateFicheDocument({schemaVersion:1, revision:1, data}, {charId})` (`js/fiche-schema.js:131`) → `executeFicheCommand('import', {reason, data})`.
- **Point d'attention produit** : la spec place « import JSON » dans le menu ⋯, mais le serveur réserve `import` au MJ. Un joueur ne peut donc pas importer ; seul l'export lui est utile. À préciser dans le brief (masquer l'import pour `role !== 'mj'`).
- Pour un module partagé : extraire `buildFicheExport(data, {charId, appVersion})` et `parseFicheImport(text)` dans `js/fiche/export-import.js` (pur), testable ; `fiche.js` peut ensuite les utiliser, mais toucher à `fiche.js` doit rester minimal (« aucune modification visible du bureau »). `tools/fiche-import-dialog.test.mjs` existe pour la boîte de dialogue d'import.

---

## 6. Serveur : verrouillage nom/race

`functions/src/fiche/service.mjs` (fichier complet vu) :
- `PATCH_FIELDS` l.12 : `Set(['nom','race','blessuresAct','resilience','determination','chance','destin','corruption','possessions','optVisible.section-sorts','optVisible.section-prieres'])`.
- `validateCommand(command)` l.77-92 appelle `validatePatchPayload(payload)` (l.104-135) **sans rôle** (aucun argument user). Le rôle n'est connu qu'ensuite : dans `executeFicheCommand` l.~300, `const role = ensureAuthorized(user, command, snapshotData(accessSnapshot))` (l.205-217 : MJ pour `isAdmin` = email administrateur vérifié ; `'joueur'` si l'email est dans `campagne/acces[charId]` ; `permission-denied` sinon ; `test` réservé MJ), puis `validatePrivilegedPayload(command)`.
- **Où poser le refus** : juste après `ensureAuthorized` (l.303) et `validatePrivilegedPayload`, avant l'exécution du patch :
  ```js
  if (command.type === 'patch' && role !== 'mj'
      && Object.keys(command.payload.changes).some(path => path === 'nom' || path === 'race')) {
      fail('champ réservé au MJ', 'permission-denied', { kind: 'field-forbidden', path });
  }
  ```
  Le format d'erreur existant pour un champ non autorisé est `fail('champ non autorisé', 'permission-denied', { kind: 'field-forbidden', path })` (l.122). Le rôle doit être connu : ne pas le mettre dans `validatePatchPayload`. Ne pas déplacer `validatePatchPayload`, qui est appelé avant l'accès Firestore.
  - L'ordre actuel : validation du format → lecture accès/fiche/opération/catalogue en transaction → `ensureAuthorized` → `validatePrivilegedPayload` → reçu antérieur (rejoué avant tout) → ... → patch. Le refus devrait précéder le reçu antérieur pour qu'un reçu ne rouvre pas de droit : placer juste après `validatePrivilegedPayload`.
- **Tests existants à adapter** (`functions/test/fiche-service.test.mjs`) : `PLAYER` patche `nom`/`race` à plusieurs endroits et **ces tests casseront** après verrouillage : l.139-140 (test des champs simples fusionnés, nom + race en `PLAYER`), l.251-258 (conflit sur `nom`, `same-a`/`same-b`), l.267-276, l.283 (`request` utilisé pour visiteurs et comptes non autorisés : sans effet car refusés avant, mais vérifier), l.292 (`charId:'test'`, refus `permission-denied` attendu : inchangé), l.300 (`Nom changé` par `PLAYER`), l.375 (patch `nom` sur fiche legacy : `migration-needed` attendu, doit rester avant ou après le nouveau refus selon l'ordre ; le refus joueur serait levé avant). Les tests devront utiliser `MJ` pour ces cas, ou un autre champ (`possessions`).
- Patterns de test : `node:test` + `assert/strict` ; `createStore(seed)` (faux Firestore en mémoire avec `db.doc(...).collection(...)`, `runTransaction`) ; `deps(store, applyCommand)` (`{db, applyCommand, timestamp}`) ; `seed()` = `{'campagne/acces': {bhelgi:['player@example.test']}, 'fiches/bhelgi': INITIAL}` ; `command(type, payload, overrides)` = `{charId:'bhelgi', operationId:'operation-1', baseRevision:0, type, payload}` ; `PLAYER` / `MJ` / `ANONYMOUS` requêtes ; `rejectCode(promise, code, kind)`. Nouveaux tests : « joueur refusé sur nom », « joueur refusé sur race », « joueur accepté sur possessions », « MJ accepté sur nom et race », « patch mixte joueur (nom + possessions) refusé en bloc sans écriture ».
- Exécution : `npm --prefix functions test` (= `sync-fiche-domain --check` + `node --test test/*.test.mjs`).
- **Bureau** : `setFicheRole(role, {allowImport})` (fiche.js:2750). Pour le joueur, la liste d'activation (l.2775-2784) inclut `#nom, #race` : il faut les **retirer** de cette liste (le premier `controls.forEach(c => c.disabled = true)` les verrouille déjà). Les rôles `mj` (tout est restauré à l'état de base) et `readonly` ne changent pas. L'unique exception visible au bureau.
- Contrôleur client : `defaultEditablePath` autorise toujours `nom`/`race` (ce n'est pas une règle de rôle) ; le verrouillage est serveur. Si l'on veut aussi refuser côté client pour le joueur, c'est un `canEditPath` injecté ; sinon un `stagePatch` joueur serait seulement refusé par le serveur (`permission-denied`, le brouillon local resterait). Pour le bureau, le champ désactivé suffit.
- `fiche-client-bridge.js` `PATCH_SIMPLE` contient `nom`/`race` : un joueur n'en génère plus de changement si le champ est désactivé.

---

## 7. Styles et tokens

- **`css/mobile-app.css`** (839 lignes) : préfixe `m-`. Variables locales dans `:root` (l.3-10) : `--m-header-height:4.5rem`, `--m-nav-height:4.25rem`, `--m-content-width:42rem`, `--m-touch-target:2.75rem`, `--m-safe-top/right/bottom/left: env(safe-area-inset-*)`. Autres tokens depuis `css/base.css` : `--bg-darkest/dark/card/card-hover/surface/overlay`, `--gold`, `--gold-bright`, `--gold-dim`, `--blood`, `--blood-bright`, `--text-primary/secondary/muted/heading`, `--border-subtle/gold/strong`, `--gold-wash`, `--text-on-status`, `--font-heading` (Cinzel), `--font-body` (Crimson Text), `--space-xs..3xl` (0,25 → 4 rem), `--radius-sm|md|lg` (4/8/12 px), `--shadow-sm|md|lg|glow`. `[hidden]{display:none!important}`.
- Composants communs réutilisables : `.m-button`, `.m-button-primary`, `.m-icon-button`, `.m-screen` (grille avec gap, `h2`, `p`), `.m-state-card`, `.m-chip` (puces `aria-pressed`), `.m-search-input`, `.m-dialog*`, `.m-form-field`, `.visually-hidden`, `.m-skip-link`.
- Classes de tailles : texte 17 px de la spec = base `rem`. La base `html` de `base.css` n'est pas à 17 px : prévoir `.m-fiche { font-size: 1.0625rem }` dans `mobile-fiche.css`.
- Parchemin : `app.js` `applyTheme(documentRef, theme, toggle)` (l.~62) pose `documentElement.dataset.theme = 'parchment'|'dark'`. Le thème est une préférence (`session.setPreferences({theme})`, stockée en localStorage via le store), bascule dans le dialog Réglages (`#m-theme-toggle`). `css/theme-parchment.css` redéfinit les variables sous `[data-theme="parchment"]` (l.6-90 : `--gold-wash`, `--text-on-status: #fff`, etc.) et contient des règles `[data-theme="parchment"] …` globales. `mobile-app.css:742-751` montre les surcharges parchemin propres au mobile (contrastes 4,5:1 : `--gold` sur `--bg-darkest` ne fait que 3,8:1 : utiliser `--text-secondary` pour du petit texte, `--text-on-status` sur fond or foncé).
- Polices : `css/fonts.css` : `@font-face` auto-hébergées (`fonts/cinzel-latin.woff2` variable 400-900, `crimson-text-latin-{400,600,400-italic}.woff2`), `font-display: swap`, `unicode-range` latin. Aucun lien vers Google Fonts dans `app/index.html` (la CSP les interdit).
- Animations : seul garde-fou existant `@media (prefers-reduced-motion: reduce){ *,*::before,*::after { scroll-behavior:auto!important; transition-duration:.01ms!important; animation-duration:.01ms!important } }` (l.829) : il neutralise déjà les transitions/animations de la fiche.
- Tablette/paysage : `.m-main{width:min(100%, var(--m-content-width))}` ; `@media (min-width:45rem)` (l.833).

---

## 8. Service worker

- `sw.js` : `const APP_VERSION = 'v2.31.1'` (l.3, doit égaler `js/layout.js:3` ; test et CI), `CACHE_NAME = 'wfrp-cache-' + APP_VERSION`.
- `ASSETS_LOCAUX` (l.6-~190) : tableau de chaînes `'./chemin'`. `cache.addAll(ASSETS_LOCAUX)` **échoue l'installation si un fichier manque** (404), donc tout fichier listé doit exister.
- Déjà précachés et utiles à la fiche : `./js/fiche-{client-bridge,controller,draft-store,repository,schema,session-view}.js`, `./js/fiche/{career-model,basic-skills,skill-names,xp,published-catalogue-engine,career-viewer,commands}.js`, `./js/data/{careers,skills,fiche-catalog}.json`, `./js/catalogue/{referentiel-public.json,talents-sheet-snapshot.json,skill-resolver.js,skill-forms.js,talent-resolver.js,…}`, `./css/career-viewer.css`, `./js/firebase-init.js`, `./js/auth.js`, `./js/app-check.js`, `./js/firebase-config.js`, `./js/utils.js`, `./js/contributions/*`, `./css/mobile-app.css`, tous les `js/mobile/**` actuels (l.~150-179), `./app/index.html`, fonts.
- **À ajouter pour la fiche mobile** : `./css/mobile-fiche.css`, chaque nouveau module sous `js/mobile/**` (vues, composants, runtime) et tout nouveau module `js/fiche/*.js` (ex. `derived.js`, `export-import.js`, importé par le mobile). `./js/ui-confirm.js` est déjà présent si utilisé.
- Fetch handler : code local (`.html/.css/.js`) en network-first avec repli cache. Le reste en stale-while-revalidate. `isProtectedNetworkRequest` exclut Firestore, Auth, App Check, Cloud Functions, gstatic firebasejs, recaptcha et `docs.google.com`.
- Tests qui énumèrent des fichiers :
  - `tools/m7-01-release.test.mjs:59` « précache fermé » : parcourt le graphe d'imports de `js/mobile/app.js` (regex `from '…'`, `import('…')` relatifs `./`/`../`) et exige `assets.has('./' + imported)` pour chaque module, plus `node --check` de chacun. **Un import dynamique local manquant dans le précache fait échouer ce test.** Les imports d'URL absolues (gstatic) ne sont pas suivis.
  - `tools/m6-02-service-worker.test.mjs` (`swAssets()` extrait le bloc `ASSETS_LOCAUX`), `tools/m1-05-release-coherence.test.mjs`, `tools/m2-05-release.test.mjs`, `tools/m4-05-brouillons.test.mjs:83` (version = `app-version` meta = `sw.js`), `tools/sw-storage-cache.test.mjs`.
  - Les tests de version codent la version **en dur** : `tools/m3-04-release.test.mjs:52` (`'v2.31.1'` + `## [2.31.1] - 2026-10-05`), `tools/m5-03-release.test.mjs:44,47`, `tools/m7-01-release.test.mjs` (layout, sw, `app-version`, CHANGELOG), `tools/m6-03-release.test.mjs`. À chaque montée de version il faut modifier ces fichiers (commit 28b4d2d l'a fait pour 2.29.3).
- Tests qui casseraient en ajoutant des routes/fichiers : le test m7-01 « routes mobiles → titre » ne couvre pas les fiches (aucun ajout obligatoire, mais utile d'ajouter `['#/fiches/caelel', …]`). m3-01 `parseRoute('#/fiches') → {name: FICHES}` doit rester vrai (inchangé).

---

## 9. Conventions de test mobiles

- **Pas de jsdom/happy-dom** (`devDependencies` : rules-unit-testing, eslint, firebase, firebase-admin, firebase-tools). Chaque fichier de test définit son **`FakeElement`/`Node` maison** : `m3-04-detail.test.mjs:80`, `m3-03-filter-sheet.test.mjs:5`, `m3-03-view-lifecycle.test.mjs:5`, `l4-02-mobile-pnj.test.mjs:19`, `m3-01-mobile-shell.test.mjs:171`.
  - Contenu typique : `ownerDocument, tagName, children, parentNode, attributes (Map), listeners (Map), dataset, className, textContent, href, type, value, checked, disabled, open`, avec `setAttribute/getAttribute/hasAttribute`, `append`, `replaceChildren`, `removeChild`, `remove`, `addEventListener/removeEventListener`, `dispatch(type)`, `focus`, un `querySelectorAll` minimal (`.classe` ou nom de balise, pas de sélecteur complexe), fragments (`createDocumentFragment`).
  - `fakeDocument()` = `{ createElement: tag => new FakeElement(documentRef, tag), activeElement: null }`.
  - Conséquence : les vues doivent n'utiliser que `createElement`, `textContent`, `append`, `replaceChildren`, `setAttribute`, `dataset`, `className`, `addEventListener` et des sélecteurs simples (`.classe`, balise). **`classList`, `closest`, `innerHTML`, `matches`, sélecteurs composés ne sont pas dans les faux.** Il vaut mieux écrire les modèles (tri, filtres, aperçu de coût, choix des compétences de Principal) en **fonctions pures** testées sans DOM (comme `pnj-detail-model.js` + `m3-04-detail.test.mjs`), et une couche de vue testée sur un faux DOM minimal. Les critères d'acceptation 8 de la spec visent précisément ces modèles.
  - Stores faux : `makeStore(initial)` avec `subscribe/emit/listenerCount/restart` (m3-04). Faux client : `{ watch(listener) { …; return () => {}; } }`.
- **`package.json` `check`** : liste explicite de fichiers de test pour la partie mobile (`node --test … tools/m3-01-mobile-shell.test.mjs … tools/pnj-link-curves.test.mjs`). Seuls les motifs `tools/fiche-*.test.mjs tools/catalogue-*.test.mjs tools/j2-contribution-client.test.mjs tools/contributions-editor.test.mjs` sont des globs : **un test nommé `tools/fiche-mobile-*.test.mjs` serait exécuté automatiquement** (et par le job CI `fiche-domain`, `validate.yml`) sans toucher `package.json`. Un test nommé `tools/m8-*.test.mjs` doit être ajouté à la ligne `check` de `package.json`.
- CI (`.github/workflows/validate.yml`) : `npm run check` n'y est PAS lancé en entier. Jobs : smoke-test, json-lint, version-coherence (APP_VERSION layout=sw + entrée CHANGELOG), syntaxe (`node --check js/*.js js/hero3d/*.js sw.js tools/*.mjs tools/lib/*.mjs` : **ne couvre pas `js/mobile/**`, `js/fiche/**`**), fiche-domain (sync check + `node --test tools/fiche-*.test.mjs tools/catalogue-*…` + `npm --prefix functions test`), lint (`npm run lint`), j2-emulators. Les tests `m*.test.mjs` ne tournent donc en CI que via `npm run check`/localement. Un test dans `tools/fiche-*.test.mjs` entre dans le job CI.
- ESLint : `eslint.config.mjs` (`js/**/*.js` module navigateur, `sw.js` worker, `tools/**/*.mjs` node avec globals restreints : `process, console, require, fetch`). `npm run lint` doit passer.

---

## 10. Déploiement et versions

- **Site** : `deploy.ps1` fait `git add -A`, commit (message en paramètre), `git push origin master`. GitHub Pages publie `https://ethoril.github.io/ennemi-interieur-wfrp4/` depuis `master` à la racine (~1 min). Aucun build. Il n'y a pas de recette : push = production. (Note : `deploy.ps1` fait `git add -A`, il embarquerait aussi les fichiers non suivis `.claude/…` si on le lance tel quel.)
- **Fonctions** : `firebase.json` déclare `functions.source = "functions"` avec `predeploy: npm --prefix "$RESOURCE_DIR" test`, ainsi que `firestore` (rules, indexes) et `storage`. Un push sur `master` **ne déploie pas** les fonctions : il faut `firebase deploy --only functions` (qui lance le test en predeploy ; `firebase-tools ^15` est en devDependency). Même chose pour `firestore.rules`/`storage.rules` (`--only firestore:rules`). Aucun workflow GitHub de déploiement (un seul : `validate.yml`).
  - **Conséquence** : le verrouillage `nom`/`race` est serveur, donc dépend de `firebase deploy --only functions`. Tant que ce n'est pas déployé, un joueur peut encore patcher via un client modifié, alors que le bureau (GitHub Pages) désactive déjà ses champs. Les fonctions copient le domaine (`functions/src/domain/…`) : si `js/fiche/*.js` est modifié, il faut resynchroniser **et** redéployer les fonctions pour que serveur et client restent cohérents (`catalogVersion` dépend de `careers/skills/fiche-catalog.json`).
- **Version** :
  - `js/layout.js:3` `const APP_VERSION = 'v2.31.1'` (affiché dans `.nav-version`) ; `sw.js:3` identique (CI + `m1-05`).
  - `app/index.html:7` `<meta name="app-version" content="v2.31.1">` (m5-03, m4-05, m7-01).
  - `CHANGELOG.md` : entrée `## [2.31.1] - 2026-10-05` en tête (format Keep-a-Changelog, rubriques `### Référentiels`, `### Corrigé`…), vérifiée par la CI via `rd('CHANGELOG.md').includes('[' + version.slice(1) + ']')`.
  - Convention de commit : `feat(mobile): … vX.Y.Z` ; une montée de version touche : `CHANGELOG.md`, `app/index.html`, `js/layout.js`, `sw.js` + les tests à version codée en dur (`tools/m3-04-release.test.mjs`, `m5-03`, `m6-03`, `m7-01`), cf. commit 28b4d2d.
  - La fiche mobile est un « lot unique » : nouvelle version mineure (ex. v2.32.0), avec le verrouillage serveur dans le même lot.

## Fichiers clés (chemins absolus)
- `app\index.html`
- `js\mobile\{app,router,ui,lifecycle,session,contribution-runtime}.js`
- `js\mobile\views\fiche-access.js`
- `js\mobile\components\filter-sheet.js`
- `js\fiche-{controller,repository,draft-store,cloud,schema}.js`
- `js\fiche\{commands,xp,career-model,basic-skills,skill-names,published-catalogue-engine,career-viewer}.js`
- `js\catalogue\{skill-resolver,skill-forms,talent-resolver}.js`
- `js\fiche.js` (bureau, non importable)
- `functions\src\fiche\service.mjs`
- `functions\test\fiche-service.test.mjs`
- `tools\fixtures\fiche-qa.js`
- `tools\sync-fiche-domain.mjs`
- `sw.js`
- `css\mobile-app.css`
- `package.json`
- `.github\workflows\validate.yml`
- `firebase.json`
- `deploy.ps1`
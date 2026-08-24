# M2-05 — contrat de la couche de données commune

Ce document clôt la frontière entre les pages bureau/mobile et Firebase. Les
fabriques de `js/data/` ne connaissent ni le DOM, ni `window`, ni un singleton
Firebase implicite : elles reçoivent un SDK, un client et, pour les écritures
d'images, un service injecté. Les Maps internes de `firebase-clients.js` sont
des registres privés de cycle de vie (par SDK/app), pas une instance Firebase
partagée exposée aux pages.

## Règles communes

Les trois dépôts de données (PNJs, relations, indices) exposent des valeurs
normalisées et jamais les snapshots Firebase bruts. Les objets comportent `id`
issu du document, `issues` pour les anomalies de forme et des timestamps
comparables (`{seconds,nanoseconds}` ou la valeur injectée par le SDK lors
d'une écriture). Les abonnements appellent
`onData(valeur, metadata)` avec `metadata.fromCache` et
`metadata.hasPendingWrites`, dédupliquent données + métadonnées et renvoient
une fonction `unsubscribe` idempotente. Les abonnements passés par la
composition bureau utilisent `client.listen`, qui les rattache au cycle de vie
du handle : même si un appelant oublie son unsubscribe, `client.close()` détache
les listeners et invalide leurs callbacks tardifs. L'unsubscribe explicite
reste recommandé pour fermer immédiatement un panneau ou un abonnement
ponctuel. Aucun callback ne doit être utilisé après désabonnement ou fermeture
du client. Le dépôt Images suit un contrat distinct, décrit plus bas : il
retourne des descripteurs d'URL objet et des états de cycle de vie, jamais des
documents Firestore ni des URLs durables non canonisées.

Les erreurs sont des `FirebaseClientError` normalisées (`permission`,
`offline`, `not-found`, `conflict`, `validation`, `unknown`). Le détail
technique reste dans `cause`/`technicalCode` pour les tests et les logs
contrôlés ; il n'est jamais destiné à l'interface.

## PNJs — `createPublicPnjRepository` / `createMjPnjRepository`

La lecture publique porte `visibleJoueurs == true` et filtre encore les
documents masqués ou marqués `suppressionEnCours`. Chaque PNJ expose les
champs publics normalisés, `imagePath` owner-scoped ou `null`, et une URL
legacy canonique sans query/token ni userinfo. Une référence legacy invalide
reste `null` et est signalée par `legacyImageInvalid`.

| rôle | API | contrat |
|---|---|---|
| public | `subscribeVisible(onData,onError)` | liste PNJs visibles, tri ordre/nom Unicode/id |
| public | `subscribeOne(id,onData,onError)` | un PNJ visible ou `null`, requête contrainte par id |
| MJ | `subscribeAll(onData,onError)` | liste complète normalisée |
| MJ | `subscribePrivate(id,onData,onError)` | notes privées séparées, `null` si absent |
| MJ | `create(public, private, {id})` | batch PNJ + `pnjs_prives`, timestamps serveur |
| MJ | `update(id, patchPublic, patchPrivate, expectedUpdatedAt)` | patch partiel transactionnel, conflit strict ; le masquage révoque les relations par sous-lots sûrs |
| MJ | `remove(id)` | verrou global, marqueur, cascade bornée, suppression privé+public, nettoyage image reprenable |
| MJ | `resumeRemoval(id)` | reprise depuis le verrou Firestore, sans journal local obligatoire |
| MJ | `inspectRemovalLock()` | inspection administrative read-only du verrou global |

La suppression retourne un état structuré (`firestoreDone`,
`imageCleanupPending`, `lockRetained`, `imagePaths`, `skippedImagePaths`). Un
échec ne doit jamais être présenté comme un succès complet.

## Relations — `createPublicRelationsRepository` / `createMjRelationsRepository`

Les relations normalisées contiennent `source`, `cible`, `type`, `label`,
`color`, `style`, `visibleJoueurs`, timestamps et `reciprocalId` seulement si
un miroir inverse unique est strictement égal sur tous les champs métier.
Une relation inverse partielle reste simple.

| rôle | API | contrat |
|---|---|---|
| public | `subscribeVisible(onData,onError,{visiblePnjIds})` | requête visible puis filtrage des deux endpoints |
| public/MJ | `setVisiblePnjIds(ids)` | réémet les abonnements publics concernés |
| public/MJ | `findForPnj(id,relations)` | filtre pur local |
| MJ | `subscribeAll(onData,onError)` | toutes les relations |
| MJ | `create(data,bidirectional)` | endpoints existants/non marqués, auto-relation et doublon refusés, paire atomique |
| MJ | `update(id,patch,expectedUpdatedAt,{pair,reciprocalId})` | rekey transactionnel, miroir prouvé obligatoire pour une paire |
| MJ | `remove(id,{pair,reciprocalId})` | suppression simple ou paire vérifiée transactionnellement |

Toute mutation respecte le verrou PNJ global et les règles de visibilité.

## Indices — `createPublicIndicesRepository` / `createMjIndicesRepository`

Les indices sont normalisés avec `titre`, `description`, `decouvert`,
`pnjsLies` dédupliqués/triés, `dateDecouverte`, `ordre`, timestamps et un
descripteur image `{path, legacy, invalid, reason}`. La lecture publique
impose `decouvert == true`; `subscribeLinked` impose aussi
`array-contains` sur le PNJ lié.

| rôle | API | contrat |
|---|---|---|
| public | `subscribeDiscovered(onData,onError)` | indices découverts, tri ordre/date/titre/id |
| public | `subscribeOne(id,onData,onError)` | indice découvert ou `null` |
| public | `subscribeLinked(pnjId,onData,onError)` | indices publics liés au PNJ |
| MJ | `subscribeAll(onData,onError)` | tous les indices |
| MJ | `subscribeOne` / `subscribeLinked` | variantes MJ sans filtre de découverte |
| MJ | `create(data,{id,imageFile})` | upload validé puis transaction Firestore ; compensation non-référente en cas d'incertitude |
| MJ | `update(id,patch,expectedUpdatedAt,{imageFile})` | conflit strict, remplacement d'image durable |
| MJ | `remove(id)` | Firestore d'abord, image protégée ensuite, état de reprise |
| MJ | `addLinkedPnj` / `removeLinkedPnj` | transaction/arrayUnion/arrayRemove concurrency-safe |
| MJ | `resumeRemoval(id)` | reprise depuis le verrou image Firestore |

Les erreurs d'index `failed-precondition` gardent `technicalCode:
'firestore-index-required'` sans exposer le détail brut.

## Images — `createPublicImagesRepository` / `createMjImagesRepository`

Le public expose uniquement `loadObjectUrl`, `revokeAll` et `close`. Les URLs
objet sont en mémoire, partagées par chemin, comptées par handle et révoquées
au dernier `release`. Aucune Cache Storage ni URL durable n'est créée.

Le MJ ajoute :

- `uploadPortrait(ownerId,file)` et `uploadClueImage(ownerId,file)` : Blob
  raster validé, taille/MIME bornés, callable injectée et réponse owner-scoped ;
- `replace(oldPath,{kind,ownerId},file,{commit})` : journal avant commit,
  commit Firestore, nettoyage ancien par non-référence, reprise en cas de
  panne ou commit incertain ;
- `remove(path,{kind,ownerId})` et `cleanupImage(path,options)` : validation
  stricte du propriétaire puis cleanup non-référent ;
- `recover()` : reprise du journal/verrou serveur ;
- `ackUpload(path)` : acquittement explicite après résolution du cycle.

Les chemins legacy/externe sont conservés et signalés, jamais supprimés
automatiquement. `close`/`revokeAll` sont idempotents.

## Frontière bureau et recette

`pnjs.js` et `enquetes.js` importent seulement leurs primitives de présentation,
`createBureauData` et les utilitaires de génération. Ils ne construisent plus
de requête Firestore, de référence Storage ou de mutation Firebase. La
composition ferme les dépôts, les listeners, les handles d'URL objet et les
états privés sur changement d'identité/pagehide ; `pageshow` réinitialise une
session propre.

Automatisé localement : lint, smoke test, tests unitaires des normaliseurs,
tests d'intégration public/MJ des trois dépôts métier et du dépôt Images, tests de règles et cohérence
du Service Worker. Non exécuté dans ce lot : recette réelle multi-fenêtres,
perte réseau, bfcache, deux thèmes et largeur 375 px nécessitant un navigateur
connecté et des données Firebase ; aucun accès à Firebase production n'est
autorisé par M2-05. La preuve émulateur des lots M1 reste une recette séparée
des tests de clôture M2.

## Preuves locales du 25 août 2026

- `npm run lint` : succès sans avertissement ;
- `npm run check` : 199 tests réussis, aucun test ignoré ;
- tests M2-05 ciblés : 3/3 ;
- runners émulateur M1-01, M1-02 et M1-03 : code de sortie 0 ;
- runner émulateur M1-04 : 2/2, aucun test ignoré.

Tous les runners ont utilisé leurs projets `demo-*` et leurs gardes
anti-production. Les journaux techniques générés par les émulateurs ont été
retirés du dossier de travail après validation.

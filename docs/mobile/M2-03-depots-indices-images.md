# M2-03 — dépôts indices et images

## Dépôts et rôles

`js/data/indices-repository.js` reçoit `{ sdk, client, imageService }` et ne connaît ni DOM,
Auth implicite ni singleton Firebase. Le dépôt public expose uniquement les lectures
`subscribeDiscovered`, `subscribeOne` et `subscribeLinked`. Les requêtes publiques portent
toujours `decouvert == true`; le filtre lié ajoute `array-contains` sur `pnjsLies`. Une erreur
Firestore `failed-precondition` est conservée sous le code technique
`firestore-index-required`, tandis que son message UI reste générique.

Le dépôt MJ ajoute les abonnements secrets et les mutations. Les listes sont normalisées,
dédupliquées et triées par `ordre` valide, date de découverte décroissante, titre Unicode
déterministe puis identifiant. Les émissions incluent `fromCache`/`hasPendingWrites`, dédupliquent
les données identiques sans masquer les changements de métadonnées, et les désabonnements sont
idempotents.

Les sorties ne transportent jamais `imageUrl`/`imagePath` bruts : elles exposent un descripteur
`image` moderne, legacy ou invalide. Lorsqu’une mutation rencontre une URL legacy, elle la remonte
dans `skippedLegacyImageUrl` et ne tente jamais de supprimer le média externe.

Les mutations valident les allowlists, bornes et identifiants, normalisent `pnjsLies` (unique,
trié, maximum 100), utilisent les timestamps serveur et vérifient `expectedUpdatedAt` dans une
transaction. L’ajout d’un PNJ exige un endpoint existant et non marqué ; le retrait n’exige pas
que l’ancien endpoint soit encore disponible. Le verrou global M1 bloque les mutations ordinaires
pendant une suppression.

## Cycle image

`js/data/images-repository.js` reçoit le SDK Storage, un uploader callable, un journal et un
service de cleanup. Aucun fallback vers `firebase-init.js`, `uploadBytes`, `getDownloadURL` ou
Storage Cache n’est utilisé. L’uploader est appelé avec un fichier et un contexte strict `{ kind,
ownerId, contentType }` ; ces valeurs sont recalculées par le dépôt et aucune option UI n’est
transmise à la callable. Sa réponse doit être un chemin déterministe appartenant au bon propriétaire.

Les propriétaires sont limités à 100 caractères et les chemins sont exactement
`portraits/{owner}/{file}` ou `indices/{owner}/{file}`. Les types raster et limites sont centralisés
(portraits 2 MiB, indices 5 MiB). Le journal est obligatoire : un échec de journalisation tente
immédiatement la compensation ; si celle-ci échoue, l’état indique le fichier à reprendre.

`loadObjectUrl` utilise `getBlob` puis `URL.createObjectURL` injecté. Les appels concurrents
partagent seulement une promesse et une URL en mémoire. Chaque handle possède un `release`
idempotent ; `revokeAll`/`close` traite aussi l’abandon pendant le chargement et révoque au dernier
consommateur. Les URL legacy restent descripteurs marqués `legacy` et ne deviennent jamais des
URL durables. Un `imagePath` moderne invalide est fail-closed, même si un `imageUrl` legacy existe.

Création : réserver l’identifiant, valider, téléverser, journaliser, committer Firestore, acquitter
le journal. Une panne Firestore compense le nouveau fichier ou retourne un état de reprise.
Remplacement : le commit callback est obligatoire ; le nouveau fichier est téléversé avant le
commit, l’ancien est journalisé avant celui-ci, puis nettoyé uniquement par le service de
non-référence après succès. Une panne de cleanup conserve un état `cleanupPending` et les deux
entrées restent reprenables ; le nouveau journal n’est acquitté qu’après la résolution de l’ancien.
Suppression :
Firestore est committé avant le cleanup Storage ; une panne laisse un état structuré et le service
de reprise injecté reste la source de vérité. Les chemins legacy, externes ou mal propriétaires ne
sont jamais supprimés automatiquement et sont signalés.

Pour les indices, la transaction crée un verrou durable
`integrity_locks/images/indices/{id}` avec le chemin owner-scoped avant de supprimer/modifier la
référence. Le service `cleanupImage` doit supprimer le Storage puis acquitter ce verrou ; s’il
échoue, `resumeRemoval` ou le service de reprise reprend depuis Firestore, même sans journal local.

Le callable Functions doit être injecté et lié à la même application nommée que l’Auth/App Check
MJ. Ce lot ne crée aucun fallback vers l’application Firebase par défaut ; l’adaptateur Functions
nommé/App Check sera branché avant l’interface mobile MJ.

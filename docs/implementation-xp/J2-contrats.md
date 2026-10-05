# J2 — contrats backend des contributions publiques

Ce document fixe la frontière entre les callables Functions J2 et l’interface. Les
handlers sont préparés dans `functions/src/contributions/handler.mjs`; leur
déclaration Firebase et leur option App Check restent à raccorder dans
`functions/src/index.js` après revue. Aucun accès à `pnjs_prives` n’est utilisé.

## Identité et capacités

Tous les callables d’écriture exigent un utilisateur Firebase authentifié avec une
adresse vérifiée. Le rôle MJ est déterminé côté serveur par l’adresse canonique
`ethoril@gmail.com`. Un joueur est contributeur si son adresse, déjà mise en
minuscules côté requête, figure exactement dans au moins une liste de
`campagne/acces`. Les adresses enregistrées ne sont jamais renvoyées.

`getCampaignCapabilities()` répond `{ role, contribution, characterIds }`.
`getContentEditContext({ kind, id })` répond seulement les champs publics
autorisés, `revision`, `managed`, `canEdit` et `canDelete`. Les joueurs reçoivent
`not-found` pour une ressource cachée, supprimée ou dont un endpoint PNJ est
caché; le MJ peut ouvrir aussi les formulaires cachés et ne reçoit que les
champs publics allowlistés (jamais `pnjs_prives`). Pour une enquête, les joueurs
reçoivent seulement les PNJ actuellement publics dans `pnjsLies`. Les références
héritées vers des PNJ cachés restent préservées côté serveur lors d’une
modification de texte ou de liens visibles.

## Création et édition

`mutatePublicContent` prend l’enveloppe suivante :

```json
{
  "kind": "pnj | indice | relation",
  "action": "create | update",
  "id": "identifiant facultatif à la création, obligatoire en mise à jour",
  "operationId": "identifiant stable de rejeu",
  "baseRevision": 0,
  "changes": {},
  "baseValues": {}
}
```

Les identifiants de PNJ et d’indice sont fournis par le client; les identifiants de
relation peuvent être dérivés côté serveur. Les champs sont allowlistés et bornés
par type. Les données contrôlées par le serveur (`visibleJoueurs`, `decouvert`,
propriétaire, révision et horodatages) ne sont jamais acceptées depuis le client.
Une création de joueur devient publique uniquement après validation complète.
Les limites principales reprennent les règles actuelles : nom PNJ et titre
d’indice 200 caractères, description PNJ 20 000, description d’indice 30 000,
20 groupes de 200 caractères, 100 liens d’enquête, et 2 Mio par portrait / 5 Mio
par image d’indice.

`mutateMjContent` est la voie versionnée réservée au MJ pour les contenus gérés,
y compris les dossiers cachés. Elle exige la révision courante exacte et les
`baseValues` des champs changés; elle n’effectue aucune fusion silencieuse.
Seuls les champs publics allowlistés et les drapeaux `visibleJoueurs`/`decouvert`
sont acceptés. Les notes privées suivent leur dépôt MJ séparé. Les formulaires
administrateur routent les PNJ et indices gérés vers cette commande; la règle
Firestore bloque désormais l’ancien write client MJ dès que le document porte
des métadonnées privées.

Masquer un PNJ désactive dans la même transaction ses relations publiques
incidentes et retire l’identifiant des indices découverts. Les révisions et
historiques des dépendances sont mises à jour; une liste tronquée ou trop grande
fait échouer l’ensemble avant la première écriture. Les anciens liens d’indices
sont conservés dans les métadonnées privées et ne sont rétablis à la publication
que si l’indice est resté découvert et sa révision/liste inchangées. Republier
un PNJ révèle ses relations cachées seulement quand l’autre endpoint est public.
L’association d’une image MJ consomme la réservation vérifiée dans la même
transaction que la mutation du contenu.

La mise à jour applique une fusion à trois voies par champ à partir de
`baseValues`. Une modification concurrente du même champ renvoie `aborted` avec
`details.kind="conflict"` et les noms de champs publics en conflit. Les liens
d’enquête sont traités comme un tableau atomique. Toute nouvelle référence doit
viser un PNJ public; les anciennes références cachées sont gardées en place et
ne figurent ni dans la réponse ni dans l’historique visible.

Les relations réciproques sont persistées comme deux documents liés par les
métadonnées privées `reciprocalId`. Leur création, leur mise à jour et leur mise
en corbeille sont atomiques. Une mise à jour de paire exige les deux révisions et
refuse une paire devenue non réciproque. Les erreurs ne renvoient jamais le
document complet.

Les commandes disposent d’un reçu privé `content_operations/{operationId}` avec
empreinte canonique serveur. L’identité et l’accès sont revérifiés avant de
répondre à un rejeu. Réutiliser un identifiant avec un autre contenu renvoie
`already-exists`.

## Historique

`getContentHistory({ kind, id, limit, cursor })` est réservé aux contributeurs;
les joueurs doivent encore avoir accès au contenu public, le MJ peut consulter
l’historique d’un contenu caché. La page contient au plus 50 entrées,
avec révision, delta allowlisté, horodatage, rôle et acteur réduit à `self` ou
`other`. Les liens vers les PNJ cachés sont filtrés dans les deltas `before` et
`after`; ni UID ni adresse d’acteur ne sont rendus.

## Corbeille, restauration et purge

`trashPublicContent({ kind, id, operationId, baseRevision })` retire le document
public et inscrit simultanément ses métadonnées tombstone, son reçu, son
historique et un instantané public allowlisté dans `content_trash/{kind}_{id}`.
Les joueurs ne peuvent supprimer que les contenus dont les métadonnées nomment
leur UID comme propriétaire. Un propriétaire absent ou inconnu reste `null` et
ne devient jamais propriétaire par cette opération.

La suppression d’un PNJ inclut les relations publiques incidentes et retire son
identifiant des enquêtes découvertes. Les références historiques cachées des
enquêtes restent intactes. La suppression d’une relation inclut son inverse
seulement si les deux documents sont des réciproques exacts. Les instantanés de
dépendances sont allowlistés et conservés dans le document protégé de corbeille.
Une écriture qui voit `integrity_locks/pnj-deletion` refuse la mutation avant
toute écriture.

`restorePublicContent` ne remplace jamais un document existant. Elle restaure la
racine seulement si la révision tombstone correspond. Elle rétablit chaque
dépendance uniquement si son document et sa révision sont encore ceux attendus;
les relations dont un endpoint est devenu caché ou absent sont ignorées. Une
enquête n’est restaurée que si sa liste de liens est toujours exactement celle
laissée par la suppression. La réponse distingue `restoredDependencies` et
`skippedDependencies`.

La transaction Firestore est plafonnée à 480 écritures. Le chemin complet
restauration compris permet donc au plus 237 dépendances (5 écritures racine et
2 par dépendance); la limite de taille du snapshot est 700 Kio. Au-delà, la
commande échoue `failed-precondition` avant la première écriture. La corbeille
ne démarre jamais une cascade partielle. Un futur traitement reprenable devra
introduire un état de suppression privé, un curseur par lot et un protocole de
reprise avant d’augmenter ce seuil.

Après une restauration, une nouvelle mise en corbeille archive la version
précédente dans `content_trash_archive`; les archives sont conservées jusqu’au
purge. `setTrashVisibility` est MJ seulement et permet de retirer au propriétaire
le droit de restaurer. `purgePublicContent` est MJ seulement. Sa première
transaction efface les données et dépendances de la corbeille ainsi que les
archives, marque les métadonnées `purged`, crée l’événement `purge` et écrit un
reçu et un audit privé `content_purge_audit/{operationId}`. La purge Firestore
reste acquise même si le nettoyage Storage échoue ensuite. Si le nombre
d’archives ou de réservations d’image dépasse le budget de 480 écritures, la
transaction refuse avant toute écriture.

Après le commit Firestore, le service considère au plus 100 chemins d’image
strictement gérés par contenu; il examine au plus 10 objets Storage par appel.
Chaque chemin doit avoir une réservation `consumed` (que la transaction passe à
`purging`) et ne doit apparaître dans aucune fiche active, corbeille, archive ou
autre réservation. L’inventaire des collections de référence est plafonné à 500
documents par collection : si une collection dépasse cette limite, aucun objet
de ce lot n’est supprimé. Un lien partagé, une URL héritée, une réservation
absente ou tout état impossible à prouver conserve l’image. Les éléments hors
limite sont comptés dans l’audit sans être supprimés. Une suppression Storage
réussie, une image déjà absente, une référence conservée et une erreur Storage
ont des statuts distincts, sans exposer de chemin ni d’erreur technique au
client.

Les nettoyages relançables restent dans l’audit privé avec un indicateur
`resumeAvailable`. Le callable MJ `listPendingPurgeCleanups` ne renvoie que le
nom humain, le type, la révision de corbeille et les compteurs agrégés; il ne
renvoie ni chemins Storage, ni UID, ni métadonnées de réservation. La corbeille
affiche ces tâches dans « Nettoyages à reprendre ». Une reprise rejoue le même
`operationId` et le même reçu de purge, sans confirmation ni nouvelle purge.
Les lots sont réclamés par un bail privé de 30 secondes; un ancien résultat
Storage ne peut pas écraser l’état terminal d’une reprise plus récente. Les
entrées historiques `deleting` sans bail restent récupérables.

Si `cleanup.status` vaut `pending`, le MJ peut réutiliser le même reçu de purge
depuis le bouton **Reprendre le nettoyage des images**. Le service relit l’audit
et traite le lot suivant ou réessaie les chemins en échec/référencés; les
suppression Storage et l’écriture d’état sont idempotentes. L’interface indique
les quantités supprimées, en attente ou conservées par prudence. Une entrée
`retained` n’autorise aucune suppression: le MJ peut demander une nouvelle
vérification si les références ont changé. Les chemins non vérifiés et les
candidats au-delà des limites restent conservés pour un audit serveur manuel.

`listContentTrash({ limit, cursor })` renvoie uniquement des résumés
`{ kind, id, revision, summary, createdAt, canRestore }`, jamais les snapshots.
Le MJ voit toutes les entrées; la requête joueur filtre à la source sur l’UID
propriétaire **et** `ownerCanRestore == true`, avant pagination et avant de lire le
résumé. Une entrée rendue privée par le MJ n’apparaît donc pas au joueur.

## Images

`uploadContributionImage` réutilise `uploadProtectedImage` et ses contrôles de
signature, MIME, taille, digest, cache et absence de jeton Storage. Le hook
`authorizeUpload` est fourni uniquement par le serveur; en son absence, le
comportement historique MJ seulement reste appliqué. Le callable J2 réserve
transactionnellement le chemin, l’UID, le type, la taille et le digest avant
l’écriture Storage, puis marque la réservation `uploaded` après vérification
Storage. La commande joueur ou MJ revérifie cette réservation dans sa transaction
et la consomme; le chemin ne peut donc être associé sans les droits actuels sur le
contenu et sa révision. L’accès au callable doit conserver `enforceAppCheck: true`.

## Règles et catalogue public

Les fiches V2 sont lisibles uniquement par les cinq comptes autorisés vérifiés
ou le MJ. Le document fiche, ses opérations, historiques et sauvegardes
migration sont inscriptibles uniquement par les callables; les sauvegardes restent
MJ-seules. La présence éventuelle sous `fiches/{charId}/presence/{sessionId}` ne
contient que UID, nom affiché, rôle validé par identité et date serveur.

Le seul document catalogue directement lisible par le client est
`referentiels/public`. Le service construit ce snapshot avec `publicCatalogue()`;
les drafts, reçus et historiques restent interdits aux clients, y compris MJ
directement. Aucun inventaire de fiche ni valeur d’avances de personnage n’est
publié dans le snapshot référentiel.

## Index Firestore requis pour le raccordement

La corbeille utilise `state == "trashed"`, `ownerUid == uid`,
`ownerCanRestore == true` pour les joueurs et `orderBy(createdAt desc)`; ajouter
l’index composite correspondant si Firestore le demande. L’archive utilise une égalité simple sur `rootKey`. Les requêtes de
cascade utilisent les champs simples `relations.source`, `relations.cible` et
`indices.pnjsLies`.

## Fichiers et limites actuelles

- Service métier : `functions/src/contributions/service.mjs`.
- Adaptateurs callable : `functions/src/contributions/handler.mjs`.
- Test transactionnel synthétique : `functions/test/contributions-service.test.mjs`.
- Test réel des règles sur émulateur de démonstration :
  `tools/j2-contribution-rules-emulator.mjs` et
  `tools/j2-contribution-rules.test.mjs`.
- Hook upload partagé et tests de garde : `functions/src/core.mjs`,
  `functions/test/core.test.mjs`.

Les handlers sont exposés dans `index.js` avec App Check activé. Les règles et
index Firestore déployés et tout test contre Firebase réel restent à valider
avant déploiement. Les tests de cette tranche utilisent une transaction
Firestore simulée et un Storage local factice.

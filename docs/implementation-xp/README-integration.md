# Intégration du moteur fiche côté Functions

Le client envoie maintenant une enveloppe de commande à `executeFicheCommand` :
`{ charId, operationId, baseRevision, type, payload }`. Le callable exige App Check.
Le service contrôle l'identité, le rôle, la révision, la répétition d'opération et
les droits dans Firestore avant d'appeler le moteur métier pur. L'horodatage des
réceptions et de l'historique vient de `FieldValue.serverTimestamp()`.

`js/fiche/commands.js` et ses dépendances sont les sources du moteur serveur.
`js/fiche-schema.js` fournit la normalisation V1→V2. Le catalogue public des
carrières, compétences, sorts et miracles est copié dans `functions/src/data/`.
Les fichiers sous `functions/src/domain/fiche/` et `functions/src/data/` sont
générés par `node tools/sync-fiche-domain.mjs`; ne les éditez pas directement.
Le contrôle `--check` échoue dès qu'une copie est en retard. Il s'exécute dans
`npm run check`, dans la CI et avant le déploiement Functions.

## Catalogue de sorts et miracles

[`js/data/fiche-catalog.json`](../../js/data/fiche-catalog.json) est un snapshot
de lecture publique des onglets **Magie** et **Miracles** de la feuille
[d'aide de jeu](https://docs.google.com/spreadsheets/d/1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs).
Il ne contient aucun texte privé de talent ou de fiche. `catalogVersion` est le
SHA-256 canonique de `{ careers, skills, spells, miracles }`; les achats magiques
portent cette version et le moteur refuse les noms absents ou ambigus. Elle suit
ainsi aussi les changements de coûts et d'appartenance dans les catalogues locaux.
Le référentiel publié versionne également les alias de compétences et talents,
les entrées et descriptions de talents ainsi que les modèles de description. Tout
nouveau paramètre qui change le prix, l'appartenance ou la validation doit aussi
être inclus dans l'empreinte publiée.
Les derniers exports de ce snapshot ont été récupérés le 4 octobre 2026. Pour
actualiser les deux onglets publics, lancer `node tools/refresh-fiche-catalog.mjs`,
puis `node tools/sync-fiche-domain.mjs` et les tests. Le script n'affiche que les
compteurs et l'empreinte, pas les descriptions de règles. Ne mettez jamais de
données de personnage dans ce catalogue.

## Migration V2

`migrateFiche` est un callable App Check réservé au compte MJ vérifié. Il exige
`charId`, `confirmCharId` (qui doit répéter le même identifiant) et
`expectedSourceFingerprint`. La transaction recalcule l'empreinte, refuse les
sources modifiées ou les anomalies bloquantes, crée une copie de l'enveloppe
source dans `fiches/{charId}/migration_backups/{sha256}` et inscrit un marqueur
dans `history` avant de publier la nouvelle enveloppe V2. La révision existante
est conservée. Une répétition portant l'empreinte du marqueur déjà publié répond
`already-migrated` sans créer une seconde sauvegarde.

Les sauvegardes sont placées dans une sous-collection, jamais renvoyées par le
callable. Les règles actuelles autorisent leur lecture au compte MJ vérifié
uniquement; les joueurs n'y ont pas accès et aucun client ne peut les écrire.

### Sauvegarde opérateur et préflight

Avant la migration, l'opérateur utilise `tools/fiche-prod-backup.mjs` sous
Windows avec le compte Firebase CLI MJ déjà authentifié. Le script vérifie que
le compte CLI, l'identité Google vérifiée, le compte Firebase Auth vérifié, les
règles et le callable correspondent au MJ configuré. Il est limité au projet
`campagne-wrpg` et aux cinq IDs `bhelgi`, `caelel`, `elysia`, `hellaya` et
`wren`; aucune autre fiche n'est lue. Il sauvegarde chaque document fiche et
toutes ses sous-collections récursivement dans une archive AES-256-GCM dont la
clé est protégée par DPAPI `CurrentUser`. L'archive reste hors dépôt, chiffrée
pour le profil Windows qui l'a créée. Le déchiffrement et les empreintes de
chaque fiche et sous-document sont contrôlés immédiatement, puis par les
commandes `verify` et `preflight`.

Depuis la racine du dépôt, dans PowerShell :

```powershell
$backupDir = Join-Path $env:LOCALAPPDATA 'Warhammer\fiche-migrations\preflight-20261005'
node tools/fiche-prod-backup.mjs backup --project=campagne-wrpg --confirm-ids=bhelgi,caelel,elysia,hellaya,wren --out-dir=$backupDir
$archive = (Get-ChildItem -LiteralPath $backupDir -Filter '*.dpapi.json' | Select-Object -First 1).FullName
node tools/fiche-prod-backup.mjs verify --project=campagne-wrpg --backup=$archive
node tools/fiche-prod-backup.mjs preflight --project=campagne-wrpg --backup=$archive
```

Le préflight applique uniquement `migrateFicheDocument` en mémoire. Il rapporte
les révisions, empreintes, nombres de lignes, compteurs numériques, anomalies,
totaux XP préservés et blockers sans imprimer les valeurs de fiche, les noms de
lignes, les e-mails ou les jetons. Les chaînes numériques, valeurs négatives
et achats legacy non attribués sont des avertissements distincts; aucune valeur
métier n'est corrigée automatiquement. Il n'existe aucun mode `apply` dans cet
outil : la migration s'effectue ensuite depuis la fiche publiée, avec la vraie
session Firebase Auth et App Check.

Les entrées historiques de gain avec `kind: "gain"` et `montant`, ainsi que les
anciens achats typés (`type` + `cout`) et les kinds de dépense connus, sont
comptabilisés sans être réécrits. Un gain initial sans coût est une entrée
normale uniquement lorsqu'il porte sa forme de gain reconnue. Le préflight
demande une revue pour tout autre code d'anomalie, entrée XP inconnue, blocker
ou écart de totaux. Les seuls avertissements historiques dispensés de revue
sont un achat déjà appliqué sans liaison d'annulation et une valeur XP stockée
en chaîne, à condition que la simulation confirme la préservation stricte des
totaux et de la forme des données.

Les commandes `reset` et `import` sauvegardent aussi transactionnellement
l'enveloppe V2 immédiatement précédente dans
`fiches/{charId}/command_backups/{operationId}` avant d'écrire le nouvel état.
L'événement privé `history` conserve le chemin de sauvegarde. Les sauvegardes
restent réservées à une procédure MJ contrôlée; elles ne sont jamais chargées
par le navigateur joueur ni incluses dans les réponses des commandes. Pour
revenir à un état antérieur, le MJ doit lire la sauvegarde via un outil serveur
autorisé, vérifier le personnage et la révision courante, puis appliquer le
contenu comme une nouvelle commande `import` avec motif explicite. La taille
source est limitée à 900 KiB afin que backup, historique et fiche restent sous
les limites Firestore. L'initialisation d'une fiche absente n'a pas d'état
antérieur à sauvegarder.

### Restauration opérateur d'une sauvegarde `reset` / `import`

Il n'existe pas de callable de lecture/restauration des sauvegardes. N'utilisez
jamais le SDK client, le picker joueur ou une écriture directe de document pour
cette opération. Un opérateur MJ autorisé doit, via un outil Admin serveur
restreint et audité, lire l'événement privé d'historique et le document exact
indiqué par `backupPath`. Vérifier que `charId` correspond à la demande, que le
type sauvegardé est `reset` ou `import`, que `sourceEnvelope.schemaVersion` vaut
2 et que `sourceRevision` correspond à `sourceEnvelope.revision`. Contrôler le
contenu sauvegardé côté serveur sans le copier dans un rapport ou un journal.

Lire ensuite la fiche courante et utiliser sa révision exacte comme
`baseRevision`. Après confirmation explicite du personnage et saisie d'un
nouveau motif, restaurer en émettant une commande normale vers
`executeFicheCommand` avec une nouvelle `operationId`, `type: "import"` et
`payload: { reason, data: sourceEnvelope.data }`. Ne réutilisez pas l'identifiant
de l'opération sauvegardée : cette commande doit créer son propre reçu,
historique et, si une fiche existe, une nouvelle sauvegarde avant remplacement.
N'effectuez la procédure qu'en ligne; vérifiez que le reçu et le snapshot
confirment la révision suivante et que l'événement d'historique conserve le
motif. Si une précondition, une validation ou un accès Admin échoue, arrêtez la
restauration et gardez l'enveloppe courante intacte. Cette procédure décrit le
contrat de récupération; aucun outil de restauration Admin n'est livré dans ce
lot et aucune sauvegarde de production n'a été lue ou modifiée.

## Vérification locale

- Les brouillons locaux sont plafonnés à 256 KiB chacun, 200 changements par
  brouillon, 128 KiB pour un brouillon de correction MJ et 2 MiB / 100 entrées
  au total par UID et personnage. En cas de refus/quota, la saisie reste en
  mémoire de l’onglet et l’interface l’indique explicitement; l’envoi en ligne
  reste disponible.
- Les corrections MJ sont isolées par UID, personnage, version de schéma et
  session d’onglet. Après rechargement, elles exigent une action explicite de
  restauration, sont comparées à leur base enregistrée et ne sont jamais
  envoyées automatiquement.
- `npm run check` vérifie le sync, la migration hors ligne, le moteur et les tests
  de Functions en plus des contrôles existants.
- `npm --prefix functions test` vérifie la cohérence des sources copiées et lance
  tout `functions/test/*.test.mjs`.
- `node tools/sync-fiche-domain.mjs --check` vérifie sans écrire les fichiers
  générés.
- `node --test tools/fiche-cloud.test.mjs tools/m3-01-mobile-shell.test.mjs`
  couvre les réponses tardives de reset/import, les phases verrouillées après
  déconnexion, les quotas et récupérations de brouillon ainsi que le sélecteur
  mobile d'accès par capacités.
- `node --test tools/fiche-import-dialog.test.mjs` vérifie que l’import demande
  son motif dans la modale et n’utilise pas de prompt navigateur.
- `node --test functions/test/fiche-service.test.mjs functions/test/fiche-migration.test.mjs`
  couvre les sauvegardes privées `reset`/`import`, la limite 900 KiB,
  l'idempotence de migration et le refus d'empreinte périmée.
- `node --test tools/fiche-migrate.test.mjs` vérifie que les Timestamp Web et
  Admin ont la même empreinte canonique et que le timestamp métier est préservé
  par la migration locale.

## Activation

La séquence de déploiement Functions → index Firestore → règles → client,
l’activation de l’accès Bhelgi, les sauvegardes par migration et les procédures
de retour arrière sont décrites dans
[`activation-finale.md`](activation-finale.md). Ce runbook est une procédure
future : sa présence ne signifie pas qu’un déploiement ou une migration de
production a eu lieu.

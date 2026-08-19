# Schéma M1-01 — visibilité PNJs et notes privées

Version de transition, 19 août 2026. Ce contrat accompagne la migration M1-01 et ne modifie pas
les règles Firestore ; le durcissement des accès est livré par M1-02.

## Collections et visibilité

### `pnjs/{pnjId}`

| Champ | Type | Défaut de migration | Visibilité | Normalisation |
|---|---|---|---|---|
| `nom` | chaîne | aucun | publique si le PNJ est visible | conserver le texte, échapper au rendu |
| `statut`, `vivant`, `lieu`, `groupe` | chaînes | `''` côté formulaire | publique si le PNJ est visible | aucune conversion implicite |
| `description` | chaîne | `''` côté formulaire | publique si le PNJ est visible | c'est le texte public ; il ne devient jamais une note |
| `imageUrl` | chaîne legacy | `''` côté formulaire | selon la visibilité du PNJ | lecture transitoire, remplacée plus tard par `imagePath` |
| `visibleJoueurs` | booléen | `true` si absent | contrôle la lecture joueur | une valeur non booléenne est signalée, jamais écrasée |
| `createdAt` | `Timestamp` | timestamp de migration si absent | métadonnée publique | un timestamp présent atypique est signalé, jamais écrasé |
| `updatedAt` | `Timestamp` | timestamp de migration si absent | métadonnée publique | écrit avec `serverTimestamp()` par les clients futurs |
| `ordre` | nombre facultatif | absent | publique si le PNJ est visible | aucune création automatique |

Le payload public est une liste blanche : aucun champ inconnu, aucune clé de note et aucune
propriété issue du document privé ne doit être recopié dans un rendu ou une écriture publique.
Pendant la transition, un lecteur visiteur traite un `visibleJoueurs` absent comme `true`. Cette
tolérance disparaît lorsque M1-02 est déployé.

### `pnjs_prives/{pnjId}`

| Champ | Type | Défaut | Visibilité | Normalisation |
|---|---|---|---|---|
| `notes` | chaîne | document absent jusqu'à la première note | MJ uniquement | conserver exactement le texte ; jamais de log de sa valeur |
| `updatedAt` | `Timestamp` | ajouté à la copie si absent | MJ uniquement | écrit avec `serverTimestamp()` pour les modifications futures |

Le document privé porte le même identifiant que le PNJ. Un document privé sans PNJ correspondant
est un orphelin : M1-01 le signale et ne le supprime pas.

Les seuls champs publics reconnus comme legacy privé sont exactement `notes`, `notesMJ`,
`notesPrivees` et `privateNotes`, à la racine du document PNJ. Les champs inconnus ne sont pas
copiés. Si plusieurs clés legacy existent avec des valeurs différentes, la copie et le nettoyage
sont bloqués pour décision manuelle. Une valeur legacy qui n'est pas une chaîne est également un
conflit : elle n'est jamais copiée ni supprimée.

### `relations/{relationId}`

Les champs actuels `source`, `cible`, `type`, `label`, `color` et `style` restent publics. La
migration ajoute `visibleJoueurs: true` si absent, ainsi que `createdAt` et `updatedAt` si absents.
Une relation n'est publique pour un visiteur que si son propre drapeau est vrai **et** si ses deux
extrémités sont des PNJs visibles. Une relation vers un PNJ masqué ne révèle jamais son identifiant
ou le PNJ dans l'interface. Le MJ peut consulter les relations masquées et les références cassées.

### `indices/{indiceId}`

M1-01 ne migre pas les indices. Leur visibilité existante repose sur `decouvert`; `createdAt` et
`updatedAt` seront ajoutés par les écritures futures de la couche commune.

## Timestamps et écritures

La migration remplit seulement les champs absents et utilise un timestamp de l'opération. Elle ne
remplace jamais un timestamp présent, même ancien, sous forme de chaîne, nombre ou objet non reconnu.
Les écritures des clients après M1-01 doivent utiliser `serverTimestamp()` pour `createdAt` à la
création et `updatedAt` à chaque modification. Les valeurs sont comparées sans coercion de type.

## Phases de migration

1. `prepare` parcourt `pnjs` et `relations`, ajoute les valeurs manquantes et produit des signaux
   pour les types atypiques.
2. `copy-private` lit uniquement les quatre clés legacy explicites, crée ou complète
   `pnjs_prives/{id}`, conserve une note privée existante et signale les conflits.
3. `cleanup` exécute une transaction. La clé legacy est supprimée uniquement si la copie privée
   existe, si la comparaison est exactement égale et si le document public n'a pas changé entre la
   lecture et la transaction. Les conflits, absences et orphelins restent intacts.

Chaque phase est idempotente, traite au plus 400 documents par lot et peut reprendre avec un état
hors dépôt contenant seulement des curseurs et des comptes. Les sorties indiquent `vus`,
`modifiés`, `inchangés`, `erreurs`, conflits et signaux avec des identifiants uniquement : aucune
valeur de note n'est affichée ni écrite dans un journal.

Le `--dry-run` reste sans écriture et sans fichier d'état, mais se connecte en lecture à la cible
explicitement donnée afin de compter les documents réels et d'énumérer les identifiants candidats.
Une cible de production exige la confirmation exacte même en dry-run ; le manifeste M0 complet n'est
exigé que pour une exécution qui écrit. Les écritures PNJ public et note privée du bureau sont
engagées par un seul batch : un refus du document privé annule aussi la modification publique.

## Lecture bureau transitoire

Le MJ lit d'abord `pnjs_prives/{id}.notes`, puis les clés legacy explicites si le document privé est
absent ou inaccessible. Toute nouvelle note est écrite uniquement dans `pnjs_prives`. Le visiteur
ne conserve et ne rend jamais un PNJ/relation masqué ni une clé legacy ; Enquêtes filtre aussi les
PNJs masqués avant de créer ses liens.

Les accès client à `pnjs_prives` ne fonctionneront qu'après le déploiement des règles M1-02. Avant
ce jalon, l'interface doit signaler une erreur de lecture ou d'enregistrement : elle ne doit jamais
annoncer silencieusement qu'une note a été sauvegardée.

## Retour arrière M0

Avant toute exécution réelle, produire une sauvegarde M0-01 complète Firestore + Storage hors dépôt.
Pour la production, le script exige le chemin absolu de son `manifest.json`, la confirmation exacte
`--confirm-production=campagne-wrpg`, et vérifie que le manifeste complet correspond à la fois au
projet `campagne-wrpg` et au bucket `campagne-wrpg.firebasestorage.app`.

Le retour arrière se fait dans un projet de test ou via la restauration M0-01, après arrêt des
clients compatibles. Ne pas supprimer manuellement les documents privés orphelins dans cette phase.
La restauration additive M0 rétablit les collections et objets présents dans le backup ; toute
suppression du legacy déjà effectuée doit donc être restaurée depuis cette sauvegarde complète,
jamais reconstruite depuis une description publique.

## Contrôles

Les contrôles locaux sont `npm run lint`, `npm run check` et `npm run test:m1-01`. Le test
Emulator Suite, qui refuse toute cible de production et exige les deux émulateurs avant toute
initialisation Admin, se lance avec :

```text
npm run test:m1-01-emulator
```

Le runner démarre lui-même `firebase emulators:exec` avec une configuration temporaire et refuse
toujours le projet de production. Java 21 (Temurin) est requis par ce contrôle Emulator Suite.

Trace de validation locale — 2026-08-19 : `npm run lint`, `npm run check` et
`npm run test:m1-01-emulator` réussis avec Java 21 (Temurin).

Simulation production en lecture seule — 2026-08-19 : `prepare` voit 6 documents et 6 candidats
(3 PNJs, 3 relations), sans signal ni conflit. `copy-private` et `cleanup` voient chacun 3 PNJs,
0 candidat et 3 documents inchangés. Aucune écriture n'a été effectuée.

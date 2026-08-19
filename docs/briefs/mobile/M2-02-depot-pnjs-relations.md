# M2-02 — Dépôt partagé PNJs et relations

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M2-01.

| | |
|---|---|
| Lot | M2 — Couche de données commune |
| Objectif | Centraliser lectures temps réel et mutations PNJs/relations pour bureau et mobile |
| Estimation | 2 jours |
| Fichiers | `js/data/pnjs-repository.js`, `js/data/relations-repository.js`, tests |
| Dépend de | M2-01 |

## Contrat général

Les dépôts reçoivent leurs dépendances Firebase par paramètre, ne connaissent ni le DOM ni les
toasts, et retournent des données normalisées. Chaque abonnement retourne immédiatement une fonction
`unsubscribe`. Les mutations valident leurs entrées et utilisent des timestamps serveur.

## API PNJs attendue

Définir une fabrique ou classe légère exposant au minimum :

- `subscribeVisible(onData, onError)` pour le client public ;
- `subscribeAll(onData, onError)` pour le MJ ;
- `subscribeOne(id, onData, onError)` avec la requête adaptée au rôle ;
- `subscribePrivate(id, ...)` réservé au dépôt construit avec le client MJ ;
- `create(publicData, privateData)` ;
- `update(id, patchPublic, patchPrivate, expectedUpdatedAt?)` ;
- `remove(id)` avec le nettoyage d'intégrité défini en M1-04.

Un dépôt public ne doit pas exposer les méthodes privées par simple convention. Le choix de requête
est explicite ; il n'est pas déterminé par un booléen fourni par l'appelant non fiable.

## API relations attendue

Prévoir :

- abonnement public aux relations visibles ;
- abonnement MJ à toutes les relations ;
- création simple ou bidirectionnelle atomique ;
- modification d'une relation ;
- suppression simple ou de la paire liée lorsque l'utilisateur le demande ;
- recherche des relations entrantes/sortantes d'un PNJ à partir de l'état chargé.

Pour une paire bidirectionnelle, ajouter un identifiant de groupe stable si nécessaire afin que le
mobile puisse expliquer et supprimer les deux sens sans heuristique fragile.

## Règles de validation

- Identifiants source/cible non vides et distincts.
- Type/libellé borné, normalisé et non composé uniquement d'espaces.
- Couleur limitée au format ou à la palette supportés ; jamais injectée telle quelle dans du HTML.
- Visibilité booléenne explicite.
- Le client public exclut une relation dont une extrémité n'existe pas dans son jeu de PNJs visible,
  même si un document mal configuré était lisible.
- Une mise à jour n'envoie que les champs autorisés et n'efface pas implicitement les autres.

## Gestion du temps réel

Les callbacks fournissent une liste complète ordonnée de manière déterministe et une métadonnée
`fromCache`/`hasPendingWrites` utile au mobile. Dédupliquer les émissions strictement identiques si
cela évite un rendu coûteux, sans masquer les changements de statut de synchronisation.

Documenter l'ordre stable : `ordre` s'il est présent, puis nom normalisé, puis identifiant. Pour les
relations, type puis identifiant. L'ordre ne doit pas varier entre navigateur et Node.

## Tests

Avec des doubles ou l'émulateur, couvrir :

1. requêtes public/MJ distinctes ;
2. normalisation d'un ancien document ;
3. abonnement et désabonnement ;
4. propagation d'une erreur normalisée ;
5. paire bidirectionnelle tout ou rien ;
6. création avec timestamps serveur ;
7. suppression en cascade et reprise d'un nettoyage Storage ;
8. relation publique pointant vers un PNJ masqué.

## Ne pas faire

- Ne pas déplacer de rendu HTML dans le dépôt.
- Ne pas conserver un tableau global partagé entre pages.
- Ne pas importer `auth` pour décider localement des droits.
- Ne pas modifier la version applicative avant M2-05.

## Critères d'acceptation

Un test ou une petite page de démonstration peut utiliser ces dépôts avec un client public ou MJ sans
connaître les chemins Firestore. Toutes les mutations critiques conservent les garanties de M1.

## Commit

`refactor(data): partager les depots pnjs et relations (M2-02)`

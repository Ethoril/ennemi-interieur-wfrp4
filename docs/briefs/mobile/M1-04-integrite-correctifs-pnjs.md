# M1-04 — Atomicité, cascades, courses et filtres PNJs

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M1-03.

| | |
|---|---|
| Lot | M1 — Sécurité et intégrité |
| Objectif | Corriger les défauts actuels avant de partager la logique avec l'application mobile |
| Estimation | 1,5 jour |
| Fichiers | `js/pnjs.js`, `js/enquetes.js`, tests ou smoke tests ciblés |
| Dépend de | M1-03 |

## Anomalies connues

1. Une relation bidirectionnelle est créée par deux écritures successives ; la seconde peut échouer.
2. Supprimer un PNJ retire ses relations mais laisse son identifiant dans `indices.pnjsLies`.
3. Le remplacement/suppression d'images peut laisser des fichiers Storage orphelins.
4. `openPanel()` attend les indices liés ; une réponse ancienne peut repeindre un autre PNJ.
5. Après rechargement des données, un filtre actif peut rester appliqué alors que sa valeur a disparu.

## À faire

### 1. Rendre les relations atomiques

Créer les deux sens d'une relation bidirectionnelle dans un unique `writeBatch`. Utiliser des
références de documents générées avant le commit, valider source/cible et empêcher une relation d'un
PNJ vers lui-même si l'interface ne la supporte pas. Aucune des deux relations ne doit subsister si le
lot échoue.

### 2. Compléter la suppression d'un PNJ

Avant confirmation, calculer et annoncer l'impact : relations, indices liés, note privée et portrait.
Après confirmation MJ :

1. retirer l'identifiant de chaque tableau `indices.pnjsLies` ;
2. supprimer les relations entrantes et sortantes ;
3. supprimer le document privé ;
4. supprimer le PNJ dans le même lot Firestore lorsque les limites le permettent ;
5. nettoyer le portrait Storage seulement après réussite Firestore ;
6. signaler tout nettoyage Storage à reprendre.

Si plus de 500 opérations sont possibles, prévoir des lots contrôlés et un état de reprise. Ne jamais
laisser croire que la suppression est terminée si une étape a échoué.

### 3. Gérer le cycle de vie des fichiers

Lors d'un remplacement, conserver l'ancien chemin jusqu'à réussite du document Firestore. Supprimer
ensuite l'ancien objet si et seulement s'il n'est plus référencé. Ajouter un contrôle administratif
qui liste les fichiers sans référence, sans suppression automatique.

### 4. Annuler les réponses asynchrones obsolètes

Ajouter un compteur de génération ou un `AbortController` autour de `openPanel()`. Après chaque `await`,
vérifier que le PNJ demandé est toujours celui affiché et que le panneau est encore ouvert. Révoquer
également l'URL objet précédente. Reproduire le cas en ouvrant rapidement deux PNJs aux latences
différentes.

### 5. Réconcilier les filtres

À chaque mise à jour de données : recalculer les options, conserver une valeur encore valide, remettre
à « Tous » une valeur disparue, actualiser le badge/nombre de filtres et relancer le rendu. Le contrôle
visible et l'état interne doivent toujours correspondre.

## Vérifications ciblées

- [ ] Une écriture refusée au milieu de la création bidirectionnelle ne laisse aucun demi-lien.
- [ ] Supprimer un PNJ retire toutes ses références des indices.
- [ ] Une panne Storage laisse un message et une opération récupérable, pas un faux succès.
- [ ] L'ouverture rapide A puis B ne rend jamais les indices de A dans B.
- [ ] Un filtre devenu invalide est visible comme réinitialisé.
- [ ] Les deux thèmes et une largeur de 375 px restent utilisables.
- [ ] Aucune nouvelle concaténation HTML n'insère de donnée sans `esc()`.

## Critères d'acceptation

Les cinq défauts sont couverts par un test automatisé quand possible et une recette manuelle précise.
Les données restent cohérentes en cas de panne simulée et l'interface ne signale pas un succès partiel.

## Commit

`fix(pnjs): garantir l'integrite des relations et suppressions (M1-04)`

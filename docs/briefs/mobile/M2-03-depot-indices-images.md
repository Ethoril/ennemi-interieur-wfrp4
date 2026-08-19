# M2-03 — Dépôt partagé indices et images

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M1-03 et M2-01.

| | |
|---|---|
| Lot | M2 — Couche de données commune |
| Objectif | Mutualiser les Enquêtes et l'accès sûr aux médias protégés |
| Estimation | 1,5 jour |
| Fichiers | `js/data/indices-repository.js`, `js/data/images-repository.js`, tests |
| Dépend de | M2-01 |

## API indices attendue

Le dépôt doit proposer :

- abonnement aux indices découverts pour le client public ;
- abonnement à tous les indices pour le MJ ;
- lecture ou filtrage des indices liés à un PNJ ;
- création, modification et suppression MJ ;
- ajout/retrait de PNJs liés sans écraser une modification concurrente ;
- ordre stable par `ordre`, date ou titre selon le contrat documenté.

Les requêtes publiques incluent toujours `where('decouvert', '==', true)`. Une liste liée utilise
également `array-contains` et l'index prévu en M1-02. Les erreurs d'index manquant deviennent une erreur
technique identifiable, pas une absence de résultat.

## API images attendue

Créer un service injecté avec :

- `loadObjectUrl(path)` qui retourne l'URL locale et une fonction de révocation ;
- `uploadPortrait(pnjId, file, options)` ;
- `uploadClueImage(indiceId, file, options)` ;
- `replace(oldPath, newOwner, file)` avec compensation en cas d'échec ;
- `remove(path)` MJ seulement ;
- validation centralisée du type, de la taille et du dossier propriétaire.

Le service ne conserve pas de cache persistant de blobs. Il peut réutiliser une promesse pendant la
durée d'une vue, mais doit libérer l'URL quand le dernier consommateur se désabonne.

## Écritures cohérentes

La création avec image suit cet ordre : réserver l'identifiant Firestore, téléverser sous le bon
dossier, écrire le document, puis compenser le fichier si l'écriture échoue. La modification charge
d'abord la nouvelle image, met à jour la référence, puis supprime l'ancienne. La suppression d'un
indice retire le document puis le fichier et signale une reprise si Storage échoue.

Pour `pnjsLies`, utiliser une transaction ou `arrayUnion`/`arrayRemove` lorsque cela préserve le contrat
de conflit. Normaliser, dédupliquer et trier les identifiants avant une écriture complète.

## Compatibilité de migration

Lire `imagePath` en priorité. Si seul `imageUrl` existe pendant la période M1, retourner un descripteur
marqué `legacy` afin que l'UI l'affiche sans propager cette URL ailleurs. Toute sauvegarde ultérieure
convertit vers le chemin moderne lorsque le fichier a bien été migré.

## Tests

- [ ] Visiteur : uniquement indices découverts et images autorisées.
- [ ] MJ : indices secrets, création, modification, suppression.
- [ ] Filtre `array-contains` combiné à `decouvert` conforme aux index.
- [ ] Deux modifications de `pnjsLies` ne perdent pas silencieusement une référence.
- [ ] Échec Firestore après upload : nouveau fichier nettoyé ou reprise consignée.
- [ ] Remplacement : ancien fichier conservé jusqu'à réussite de la nouvelle référence.
- [ ] Chaque URL objet créée peut être révoquée et l'est dans les tests.

## Ne pas faire

- Ne pas exposer `getDownloadURL()` comme contrat durable de l'application.
- Ne pas rendre un blob secret disponible au service worker.
- Ne pas dépendre de la structure DOM des pages Enquêtes ou PNJs.

## Critères d'acceptation

Les deux futures interfaces consomment la même logique d'indices et d'images, et une panne partielle ne
produit ni fausse réussite ni perte silencieuse du média précédent.

## Commit

`refactor(data): partager les depots indices et images (M2-03)`

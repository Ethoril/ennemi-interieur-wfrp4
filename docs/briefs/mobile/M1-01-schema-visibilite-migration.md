# M1-01 — Schéma de visibilité, notes privées et migration

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M0-01.

| | |
|---|---|
| Lot | M1 — Sécurité et intégrité |
| Objectif | Rendre explicite ce qui est visible des joueurs et isoler les notes du MJ |
| Estimation | 1,5 jour |
| Fichiers | `tools/migrations/`, documentation du schéma, code PNJs transitoire |
| Dépend de | M0-01 |

## Décision de modèle

Les documents publics restent dans les collections existantes afin de conserver une sauvegarde
commune et des identifiants stables. Le modèle cible est :

- `pnjs/{pnjId}` : contenu potentiellement public, avec `visibleJoueurs` ;
- `pnjs_prives/{pnjId}` : notes exclusivement MJ, même identifiant que le PNJ ;
- `relations/{relationId}` : relation publique uniquement si `visibleJoueurs` est vrai ;
- `indices/{indiceId}` : visibilité existante via `decouvert`, complétée par des horodatages ;
- `createdAt` et `updatedAt` : timestamps serveur sur les écritures futures ;
- `ordre` : nombre facultatif utilisé seulement si un tri éditorial est nécessaire.

Un document existant sans `visibleJoueurs` doit être migré vers `true` avant que les règles ne
l'exigent. Pendant cette fenêtre seulement, les lecteurs restent compatibles avec l'ancien format.

## À faire

### 1. Documenter le contrat de données

Définir pour chaque champ son type, sa valeur par défaut, son caractère public/privé et sa stratégie
de normalisation. Préciser que les champs inconnus ne sont pas automatiquement copiés dans
`pnjs_prives`. Identifier explicitement le champ actuel contenant les notes MJ.

### 2. Écrire une migration idempotente

Créer un script administratif qui :

1. refuse de s'exécuter sans projet cible explicite et confirmation hors production ;
2. propose `--dry-run` par défaut et affiche uniquement des comptes/identifiants ;
3. ajoute `visibleJoueurs: true` aux PNJs et relations où le champ manque ;
4. copie les notes privées vers `pnjs_prives/{id}` puis retire le champ public dans une phase séparée ;
5. ajoute les timestamps manquants sans écraser ceux qui existent ;
6. utilise des lots sous les limites Firestore et peut reprendre après interruption ;
7. produit un bilan `vus / modifiés / inchangés / erreurs`.

La suppression du champ privé du document public ne peut se faire qu'après vérification que la copie
existe. Prévoir un mode de retour arrière basé sur la sauvegarde M0-01.

### 3. Assurer la compatibilité transitoire

Tant que M1-02 n'est pas livré :

- l'interface MJ lit d'abord `pnjs_prives/{id}`, puis l'ancien champ s'il existe ;
- toute nouvelle modification écrit la note dans le document privé ;
- les vues joueur ne rendent jamais l'ancien champ privé, même si les règles le laissent encore lire ;
- `visibleJoueurs` absent est interprété comme `true` uniquement durant la migration.

### 4. Vérifier avant nettoyage

Comparer les nombres avec l'inventaire M0-01. Échantillonner des PNJs avec/sans notes, relations et
accents. Confirmer qu'aucune note n'a été tronquée et qu'un deuxième passage ne modifie rien.

## Cas particuliers

- PNJ supprimé mais document privé restant : signaler comme orphelin, ne pas le supprimer ici.
- Relation vers un PNJ masqué : elle ne doit pas permettre de découvrir ce PNJ dans l'UI joueur.
- Valeur `visibleJoueurs` non booléenne : signaler et laisser inchangée pour décision manuelle.
- Timestamp ancien ou non reconnu : ne pas remplacer silencieusement.

## Vérifications

- [ ] Le dry-run sur la sauvegarde de test annonce les bons changements.
- [ ] Le premier passage migre tous les documents valides.
- [ ] Le second passage annonce zéro modification.
- [ ] Les notes n'apparaissent dans aucun rendu ni journal visiteur.
- [ ] Un document masqué reste visible et éditable pour le MJ.
- [ ] Le dépôt ne contient ni export ni donnée réelle.

## Critères d'acceptation

Tous les documents existants ont une visibilité explicite, les notes privées sont physiquement
séparées et les pages actuelles continuent de fonctionner avant le durcissement des règles.

## Commit

`feat(data): migrer la visibilite et les notes privees (M1-01)`

# M5-02 — Administration mobile des indices et illustrations

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M4-05 et M5-01.

| | |
|---|---|
| Lot | M5 — Enquêtes mobile |
| Objectif | Créer, éditer, publier et supprimer un indice depuis le téléphone |
| Estimation | 2 jours |
| Fichiers | vues/formulaire Enquêtes MJ, sélecteur PNJs, composant image réutilisé |
| Dépend de | M4-05, M5-01 |

## Routes et visibilité

Ajouter `#/enquetes/nouveau` et `#/enquetes/{id}/modifier`, protégées par la session MJ. En mode MJ,
la liste offre un filtre clair « Tous / Découverts / Secrets » et marque chaque statut par texte et
icône. Un joueur ne reçoit jamais le compte total incluant les secrets.

## Formulaire cible

Champs : titre obligatoire, description obligatoire, statut découvert/secret, ordre facultatif,
illustration et PNJs liés. Reprendre les limites et normalisations du dépôt. Les libellés doivent
expliquer que passer à « Découvert » publie immédiatement le texte, l'image et les liens autorisés.

## À faire

### 1. Charger et valider

Charger l'indice via le client MJ en mémoire, garder son `updatedAt` et gérer absent/refusé/supprimé.
Valider titre, description, booléen, ordre et tableau d'identifiants. Ne jamais insérer la description
avec `innerHTML`. Bloquer double soumission et préserver la saisie en cas d'erreur.

### 2. Sélectionner les PNJs liés

Réutiliser une feuille basse avec recherche et cases accessibles plutôt que la grande grille bureau.
Afficher statut public/masqué de chaque PNJ. Dédupliquer les identifiants. Une sélection masquée reste
valable pour le MJ mais n'apparaît pas sur la fiche joueur tant que le PNJ est masqué.

### 3. Gérer l'illustration

Réutiliser le pipeline de M4-03 avec proportions adaptées aux indices. Téléverser sous
`indices/{indiceId}/...`, stocker `imagePath`, préserver l'ancienne image jusqu'à réussite et révoquer
les aperçus locaux. Le statut `decouvert` pilote l'autorisation Storage sans rendre l'URL publique.

### 4. Sauvegarder et publier

Utiliser le contrôle `updatedAt` de M4-05. Si l'enregistrement fait passer secret → découvert, demander
une confirmation récapitulant titre, image et nombre de liens visibles. L'opération Firestore doit
être confirmée avant d'annoncer la publication ; les clients joueurs la recevront en temps réel.

Le passage découvert → secret ne demande pas une confirmation aussi lourde, mais explique que l'indice
disparaîtra des appareils joueurs dès synchronisation. Tester aussi l'accès direct à l'image.

### 5. Brouillons et suppression

Appliquer la même politique : champs publics en brouillon local clairement non synchronisé, aucun blob
persistant. Ici la description deviendra publique mais reste un contenu de campagne ; permettre au MJ
d'effacer les brouillons. Avant suppression, annoncer image et liens concernés, puis nettoyer fichier
et document via le dépôt avec reprise signalée en cas de panne Storage.

## Recette

- [ ] Création secret puis publication visible sur un second téléphone.
- [ ] Dépublication retire texte et image côté joueur.
- [ ] Sélecteur PNJs recherchable, dédupliqué et utilisable clavier ouvert.
- [ ] Illustration prise/choisie, compressée, remplacée et supprimée proprement.
- [ ] Deux MJ concurrents déclenchent le conflit `updatedAt`.
- [ ] Hors ligne : sauvegarde interdite clairement, brouillon conservé sans blob.
- [ ] Suppression ne laisse ni référence trompeuse ni fichier non signalé.
- [ ] Déconnexion depuis l'éditeur efface toute donnée MJ en mémoire.
- [ ] Deux thèmes, iPhone/Android, rotation et zoom texte.

## Critères d'acceptation

Le téléphone couvre toutes les tâches Enquêtes courantes du MJ, avec publication explicite, protection
des secrets et le même niveau de fiabilité que l'édition PNJs.

## Commit

`feat(mobile): ajouter l'administration des enquetes (M5-02)`

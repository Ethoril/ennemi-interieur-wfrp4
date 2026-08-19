# M5-01 — Liste et fiche Enquêtes pour les joueurs

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M3-04 et M2-03.

| | |
|---|---|
| Lot | M5 — Enquêtes mobile |
| Objectif | Transformer les indices découverts en carnet d'enquête mobile consultable |
| Estimation | 1,5 jour |
| Fichiers | vues `enquetes-list` et `enquete-detail`, routeur, styles mobiles |
| Dépend de | M3-04 |

## Expérience cible

L'onglet Enquêtes est un carnet, pas une copie miniature de la grille bureau. Le joueur retrouve un
indice découvert par son titre, son texte ou un PNJ lié, puis ouvre une fiche lisible avec illustration
et liens croisés. Les indices secrets ne sont ni comptés ni suggérés.

## À faire

### 1. Remplacer les écrans préparatoires

Implémenter `#/enquetes` et `#/enquetes/{id}` dans le routeur. Ajouter Enquêtes comme destination active
de la navigation basse avec `aria-current`. Conserver l'état liste/recherche et le défilement au retour
d'une fiche, comme pour les PNJs.

### 2. Concevoir la liste

Chaque carte montre titre, extrait court, miniature facultative et PNJs publics liés. Utiliser l'ordre
éditorial `ordre` s'il existe, puis date/titre selon le contrat du dépôt. Les images sont chargées
paresseusement via le service protégé, avec dimensions réservées et placeholder.

Ajouter une recherche insensible à la casse/aux accents sur titre, description publique et noms des
PNJs visibles liés. Si le volume ou le schéma le justifie, ajouter un filtre PNJ dans une feuille basse,
avec le même modèle accessible que M3-03. Ne jamais proposer le nom d'un PNJ masqué.

### 3. Concevoir la fiche

Afficher titre, illustration, description et section « Personnages liés ». Chaque PNJ public ouvre sa
fiche mobile. Le contenu textuel long garde une largeur/hauteur de ligne confortable, respecte les
paragraphes et n'interprète pas de HTML Firestore.

Un identifiant absent, secret ou retiré produit le même écran générique « Indice indisponible » afin de
ne pas confirmer l'existence d'un secret. Après dépublication temps réel, retirer immédiatement son
contenu et révoquer l'URL objet.

### 4. Gérer cache et réseau

Les documents découverts suivent le cache public M3-02. L'illustration protégée n'est pas mise en cache
par l'application ni par le service worker ; hors ligne, la fiche textuelle reste lisible et montre un
placeholder d'image. Afficher la fraîcheur de façon cohérente avec PNJs.

### 5. Soigner les états

Distinguer aucun indice découvert, aucun résultat de recherche, chargement, cache et erreur. Une erreur
d'image n'efface pas le texte. Une mise à jour distante préserve la lecture autant que possible et ne
ramène pas systématiquement en haut.

## Recette

- [ ] Seulement les indices `decouvert == true` apparaissent en visiteur.
- [ ] Recherche titre/texte/PNJ avec accents correcte.
- [ ] Lien indice → PNJ → retour restaure les deux contextes.
- [ ] PNJ masqué absent des cartes et fiches.
- [ ] URL directe d'un indice secret ne confirme rien et échoue côté règles.
- [ ] Dépublication en temps réel ferme la fiche et révoque l'image.
- [ ] Hors ligne après première visite : texte public lisible, image non persistée.
- [ ] États vides, 320–430 px, deux thèmes, clavier et zoom 200 %.

## Critères d'acceptation

Le joueur dispose d'un carnet d'indices rapide, connecté aux PNJs et strictement limité aux découvertes
publiées dans la sauvegarde Firestore commune.

## Commit

`feat(mobile): ajouter les enquetes pour les joueurs (M5-01)`

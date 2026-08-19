# M0-01 — Baseline, sauvegardes et jeu de test

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md).

| | |
|---|---|
| Lot | M0 — Préparation |
| Objectif | Obtenir un point de départ mesurable et récupérable avant toute migration |
| Estimation | 1 jour |
| Fichiers du dépôt | `docs/`, `tools/`, éventuellement `package.json` et `.gitignore` |
| Dépend de | — |

## Pourquoi

Les prochains lots changent les règles d'accès, la forme des documents et le rangement des images.
Une erreur de migration pourrait rendre un contenu invisible ou orphelin. Il faut donc connaître
l'état exact de la production et pouvoir le restaurer sans ajouter de données privées au dépôt.

## Résultat attendu

- un export daté de Firestore et Storage, conservé hors du dépôt public ;
- un inventaire agrégé des collections, champs et fichiers existants ;
- un petit jeu de données de test anonymisé et reproductible ;
- une recette de référence des onglets PNJs et Enquêtes sur bureau et téléphone ;
- des commandes documentées pour refaire ces contrôles avant chaque migration.

## À faire

### 1. Figer la référence

1. Noter le commit et la version actuellement déployés.
2. Exécuter `npm run lint`, `npm run check` et le smoke test existant.
3. Tester `pnjs.html` et `enquetes.html` en visiteur puis en MJ, dans les deux thèmes.
4. Relever les erreurs console, requêtes refusées et problèmes déjà présents sans les corriger ici.

### 2. Sauvegarder hors dépôt

1. Exporter les collections `pnjs`, `relations` et `indices` avec leurs identifiants.
2. Exporter les objets Storage sous `portraits/` et `indices/` avec leurs métadonnées.
3. Calculer un manifeste de contrôle : nombre de documents, nombre de fichiers et taille totale.
4. Vérifier qu'une restauration dans un projet Firebase de test est possible.
5. Inscrire dans la documentation où se trouve la sauvegarde, sans identifiant personnel ni secret.

### 3. Produire l'inventaire

Ajouter un document technique qui décrit, pour chaque collection : champs rencontrés, types,
champs absents, références cassées et valeurs atypiques. N'y copier ni notes privées ni URL à jeton.
Le rapport doit aussi recenser les portraits et images d'indices sans document propriétaire.

### 4. Créer le jeu de test

Prévoir au minimum :

- 4 PNJs visibles, 1 futur PNJ masqué et 1 PNJ sans portrait ;
- une relation simple, une paire bidirectionnelle et une référence cassée volontaire ;
- 2 indices découverts, 1 indice secret et 1 indice lié à plusieurs PNJs ;
- une image publique et une image qui devra être protégée ;
- des noms et textes contenant accents, apostrophes et caractères HTML à échapper.

Le jeu de test doit être fictif. Si un script d'injection est ajouté, il exige explicitement
l'émulateur ou un identifiant de projet de test et refuse le projet de production par défaut.

### 5. Définir la recette de référence

Documenter les gestes de contrôle : connexion/déconnexion, recherche, filtres, ouverture d'une fiche,
création/modification/suppression MJ, ajout d'une relation, consultation d'un indice découvert et
tentative d'accès visiteur à un indice secret.

## Ne pas faire

- Ne modifier ni les règles Firebase ni les données de production.
- Ne versionner aucun export, jeton de téléchargement, courriel de joueur ou contenu privé.
- Ne tenter aucune correction fonctionnelle dans ce brief.

## Vérifications

- [ ] Les contrôles existants passent ou leurs échecs antérieurs sont consignés.
- [ ] Le manifeste de sauvegarde concorde avec la console Firebase.
- [ ] Une restauration de test a été effectuée, pas seulement supposée.
- [ ] Le jeu fictif couvre les cas public, privé, orphelin et bidirectionnel.
- [ ] `git status` ne montre aucun export ni fichier sensible.

## Critères d'acceptation

Le développeur suivant peut comparer avant/après, rejouer un environnement de test et restaurer les
données sans demander d'information implicite. Aucune donnée réelle n'a rejoint Git.

## Commit

`docs(mobile): etablir la baseline et les sauvegardes (M0-01)`

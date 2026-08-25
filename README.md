# Warhammer — Campagne de l'Ennemi Intérieur

Site compagnon pour la campagne WFRP4 "L'Ennemi Intérieur".

## Contenu

- **Fiche de Personnage** : Fiche interactive en ligne sauvegardée sur le cloud (Firebase Firestore/Auth) pour la gestion et le suivi des fiches des joueurs.
- **PNJs** : Graphe interactif de relations (D3.js) et base de données éditable des personnages non-joueurs de la campagne.
- **Cartes** : Visionneuse haute résolution (Leaflet.js) pour explorer les cartes de l'Empire et du Vieux Monde.
- **Règles** : Aides de jeu, résumés de règles de combat, de corruption, de magie, de peur et tables de critiques.
- **Aides de Jeux** : Base de données des armes, armures, sorts, miracles et coûts en XP, synchronisée en temps réel depuis Google Sheets.
- **Vidéos** : Galerie de vidéos YouTube sur le lore et l'univers.

## Application mobile

La route [`/app/`](app/) propose une interface mobile dédiée aux PNJs et aux Enquêtes. Elle peut
être utilisée dans le navigateur ou installée ; l’installation reste facultative et la première
synchronisation nécessite une connexion internet. Le site bureau et l’application partagent les
mêmes documents Firestore et les mêmes images protégées.

- le client joueur conserve uniquement les données publiques dans son cache hors ligne ;
- le client MJ utilise une session et un cache mémoire séparés, purgés à la déconnexion ;
- le manifeste est unique, son identité reste `./index.html` et son démarrage installé cible
  `./app/index.html` ;
- le Service Worker racine couvre le bureau et `/app/` sans mettre en cache Firebase, Auth,
  App Check, Storage ou les images protégées.

### Faire évoluer PNJs ou Enquêtes

1. Faire évoluer d’abord les normaliseurs et dépôts communs de `js/data/`, puis leurs tests.
2. Adapter les vues bureau et mobile sans dupliquer les règles métier ni accéder directement à
   Firebase depuis une vue.
3. Ajouter ou retirer tout module local dans le précache `sw.js` et dans les tests de graphe.
4. Vérifier les rôles joueur/MJ, les règles Firestore/Storage, les conflits et le cycle des images.
5. Aligner `APP_VERSION`, le cache du Service Worker, la méta mobile et le CHANGELOG.
6. Tester bureau, navigateur mobile, PWA installée, hors ligne public, déconnexion MJ et rollback.

Les migrations de données restent additives et sauvegardées hors dépôt. Aucune donnée privée,
URL protégée, note MJ ou jeton ne doit entrer dans le cache, les logs ou Git.

## Hébergement

Ce site est hébergé via [GitHub Pages](https://pages.github.com/).

## Configuration

1. Créer le repo sur GitHub
2. Activer GitHub Pages (branche `master`, dossier `/`)
3. Le site sera accessible à `https://<username>.github.io/ennemi-interieur-wfrp4/`

## Documentation

- [Plan d'action — Application mobile PWA PNJs & Enquêtes](docs/PLAN-PWA-MOBILE.md)
- [Briefs d'implémentation — découpage, ordre et dépendances](docs/briefs/mobile/README.md)


# M6-03 — Validation installée iOS/Android et clôture PWA

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et les briefs M6-01 à M6-02.

| | |
|---|---|
| Lot | M6 — Installation PWA |
| Objectif | Valider la qualité installable avant le déploiement progressif |
| Estimation | 1,5 jour |
| Fichiers | rapport de recette, `CHANGELOG.md`, `js/layout.js`, `sw.js`, correctifs ciblés |
| Dépend de | M6-02 |

## Environnements requis

Tester au minimum un Android Chrome récent sur appareil physique et ajouter un contrôle navigateur
bureau pour le cycle service worker. Utiliser une URL HTTPS de prévisualisation qui reproduit le
sous-chemin de GitHub Pages. La recette iPhone ci-dessous est temporairement différée : consigner ce
statut et ne pas déclarer iOS validé avant son exécution réelle. À ce stade le manifeste public conserve
encore son ancien `start_url` ; la bascule finale est testée sur l'environnement de prévisualisation
puis activée en M7-02.

## Scénarios Android

1. Première visite, installation via le prompt, vérification nom/icône/standalone.
2. Lancement à froid en ligne puis hors ligne.
3. Navigation PNJs et Enquêtes, route directe et bouton précédent.
4. Connexion MJ par redirection depuis l'application installée.
5. Création/modification avec photo, rotation et clavier.
6. Publication temps réel vers un second appareil.
7. Déploiement d'une version de test, bannière de mise à jour et activation volontaire.
8. Réseau coupé pendant un formulaire : brouillon/statut conformes.

## Scénarios iOS

1. Aide d'ajout à l'écran d'accueil et icône correcte.
2. Lancement standalone sans barre parasite ni contenu sous la zone sûre.
3. Retour à l'app après redirection Auth ; session et route restaurées.
4. Choix/appareil photo, orientation et mémoire lors du recadrage.
5. Clavier sur champs bas, rotation et retour historique.
6. Consultation publique hors ligne après première synchronisation.
7. Fermeture complète/réouverture : aucun contenu privé persistant.
8. Comportement de mise à jour documenté malgré les particularités du service worker iOS.

## Audits complémentaires

- Audit manifeste/service worker/installabilité sans erreur bloquante.
- Accessibilité : focus, noms, zoom 200 %, contraste, mouvement réduit.
- Performance : démarrage réseau mobile bridé, poids initial, images et absence de longues tâches.
- Sécurité : caches inspectés, règles rejouées, déconnexion et lien direct secret.
- Maintenance : liste de précache automatisée et procédure de changement de version comprise.

Corriger dans ce brief uniquement les défauts indispensables à la clôture ; reporter les améliorations
non bloquantes avec sévérité, reproduction et appareil.

## Livrer le lot

Incrémenter `APP_VERSION`, aligner `sw.js` et compléter `CHANGELOG.md`. Conserver le `start_url` public
historique et l'absence de promotion publique jusqu'à M7. Archiver le rapport sans captures contenant
des données privées.

## Checklist de sortie

- [ ] Matrice Android entièrement consignée ; matrice iOS exécutée ou explicitement marquée différée.
- [ ] Installation, standalone, Auth, offline et mise à jour validés.
- [ ] Aucune donnée privée persistante après fermeture/déconnexion.
- [ ] Performance et accessibilité sans blocage majeur.
- [ ] Pages bureau non régressées.
- [ ] Prévisualisation du futur `start_url` mobile validée.
- [ ] Tests automatiques verts, version/cache/changelog alignés.

## Critères d'acceptation

La PWA est techniquement prête à être déployée sans annonce. Les seules opérations différées sont la
bascule publique du point de démarrage et les liens de découverte, prévues en M7.

## Commit

`chore(release): valider et cloturer la pwa mobile (M6-03)`

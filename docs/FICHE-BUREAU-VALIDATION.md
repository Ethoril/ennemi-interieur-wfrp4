# Fiche bureau — validation v2.33.0

## Livraison

Branche `codex/fiche-bureau`, worktree isolé. La livraison remplace `fiche.html` ;
`fiche-ancienne.html` conserve la page précédente et ses modules historiques.
Le cadrage est dans `FICHE-BUREAU.md`. Publication GitHub Pages non effectuée.

## Architecture réalisée

- `js/fiche-bureau/app.js` : rendu, sélection, inspecteur, clavier et actions MJ.
- `js/fiche-bureau/model.js` : fusion des listes, puces, disponibilité des achats et brouillons de corrections.
- `js/fiche-bureau/session.js` : raccord aux contrôleur, dépôt et brouillons existants ; authentification et catalogue publié vivant.
- `css/fiche-bureau.css` : trois colonnes, rail collant, journal aligné et repli sous 1100 px.
- Les modèles mobiles purs et les barèmes existants sont importés sans modification.
- Les commandes purchase/correct/gain/cancel/patch/import existantes sont utilisées ; aucune commande serveur ajoutée.

## Contrôles

- `npm run check` : **951 tests réussis** (86 Functions, 269 fiche/catalogue/contributions, 596 autres), contrôle de synchronisation du domaine, smoke et fixture mobile réussis.
- `npm run lint` et `git diff --check` réussis.
- Tests de fiche mobile exécutés sans modification.
- Comparaison des objets Git : `fiche-ancienne.html` identique à `fiche.html` au début du chantier.
- CSP de la nouvelle page identique à celle de l’ancienne.
- Page ancienne, nouveaux fichiers et graphe des imports locaux présents au précache.
- Diff vide dans `app/`, `js/mobile/`, styles/tests mobiles protégés, `functions/`, domaine partagé, catalogue, données et règles Firebase.

## Recette Edge automatisée

`tools/fiche-bureau-browser.mjs` utilise Playwright fourni par le poste, une fiche
**synthétique** et un transport local. Les achats, corrections et annulations sont
évalués par le moteur de commandes existant ; les patches sont simulés par ce transport.
Le contrôleur et les brouillons sont les modules réels. Aucun document Firebase n’est écrit.

Vérifiés :

- achats de caractéristique, compétence, talent, sort, miracle et rang ;
- talent « au choix » : désactivation avant choix, achat du nom composé après choix ;
- ouverture depuis une puce, aperçu et mise à jour sans rechargement ;
- refus serveur simulé, réessai, commandes par identifiant d’opération ;
- désactivation hors ligne, lecture seule et commandes MJ absentes en joueur ;
- correction d’identité, gain, annulation, dépense libre et sauvegarde automatique des notes en MJ ;
- recherche « resistance alc », fermeture par Échap et retour du focus ;
- 1280 px : journal aux mêmes abscisses que gauche et centre (24 à 876 px), rail collant ;
- 320 px : une colonne et aucun débordement horizontal ;
- thèmes sombre et parchemin : captures inspectées ; contrastes calculés des textes visibles après la transition de thème, minimum **5,97:1** et **6,69:1** ;
- aucune exception JavaScript lors de cette recette.

Pour rejouer : lancer `node tools/dev-server.mjs` avec `PORT=8011`, renseigner
`BUREAU_PLAYWRIGHT_MODULE` avec le chemin absolu du module Playwright du poste,
`BUREAU_QA_OUTPUT` avec un dossier de captures extérieur au dépôt, puis exécuter
`node tools/fiche-bureau-browser.mjs`. `BUREAU_QA_URL` permet de choisir une autre URL locale.

## Limites de preuve

Les parcours de recette ne constituent pas une validation du transport Firebase en production,
ni un achat effectué avec un vrai compte joueur. Une vérification authentifiée sur la fiche
`?char=test` reste à faire après publication. Aucun essai avec un lecteur d’écran réel n’a été
réalisé ; les libellés, boutons, annonces et parcours clavier ont été contrôlés dans la recette.
Les scripts layout/main et le transport cloud sont remplacés dans la recette synthétique ;
les modules historiques de l’ancienne fiche restent inchangés, sans nouvelle recette Firebase.
La coque mobile conserve sa version v2.32.4 : le brief interdit de modifier `app/index.html`.
Les tests de livraison ont été adaptés à cette livraison bureau seule.

Sous Windows, le test de chemins de sauvegarde utilise le répertoire temporaire sous sa forme
longue : `TEMP` et `TMP` sont fixés à `LOCALAPPDATA/Temp` pendant `npm run check`, afin d’éviter
la différence entre le chemin court 8.3 du poste et le chemin final résolu. Aucun test de
sauvegarde n’a été modifié pour contourner cette comparaison.

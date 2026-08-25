# M6-03 — Rapport de recette PWA et clôture locale

Date de préparation : 25 août 2026. Version corrective préparée : `v2.21.1`.

## Décision de livraison

Le code et la coque PWA sont prêts pour une validation progressive sans annonce publique. Le
manifeste conserve volontairement son `start_url` historique `./index.html` ; `/app/` reste absent
des pages bureau, des liens de découverte et de la promotion publique jusqu’au lot M7.

Après autorisation spécifique, le candidat caché `aa9f0d2` (`v2.20.0`) a été poussé sur `master`
le 25 août 2026, puis la clôture cachée `06abb16` (`v2.21.0`) a été publiée pour tester une vraie
mise à jour. Ces déploiements rendent `/app/` directement testable sous HTTPS, sans lien public et
sans changer le point de démarrage historique. Aucun déploiement ni test Firebase de production
n’a été effectué.

## Preuves locales déjà obtenues

Ces observations ont été réalisées dans un navigateur local avant le bump M6-03, avec le worker
observé en `v2.20.0` :

- activation volontaire d’une mise à jour et rechargement unique après `controllerchange` ;
- console du navigateur sans erreur pendant le parcours vérifié ;
- arrêt du serveur local sur le port `8123`, puis relance de `/app/` depuis la coque servie par le
  Service Worker, sans serveur applicatif ;
- navigation de la coque et retour historique conservés pendant ce cycle.

Le bandeau visible est réservé à la mise à jour ; les aides d’installation restent regroupées dans
Réglages et ne réapparaissent pas après l’activation d’une version.

Ces preuves ne constituent pas une inspection réelle de Cache Storage et ne remplacent pas une
recette sur appareil physique.

Après publication du candidat caché, une vérification navigateur sur
`https://ethoril.github.io/ennemi-interieur-wfrp4/app/` a confirmé :

- chargement de la coque et des données publiques en `v2.20.0`, sans erreur console ;
- maintien de `id` et `start_url` à `./index.html`, avec le scope historique `./` ;
- absence de lien ou d’annonce `/app/` dans la page publique racine.

Cette vérification HTTPS sur navigateur bureau ne remplace pas la matrice Android physique.

Après publication de `v2.21.0`, une session navigateur ayant chargé `v2.20.0` a confirmé le cycle
de mise à jour réel : recherche manuelle, bandeau « Mise à jour disponible », activation volontaire,
un seul rechargement, puis diagnostics « Version v2.21.0 » et « Worker v2.21.0 ». Le déploiement
GitHub Pages correspondant s’est terminé avec succès.

Le 25 août 2026, l’utilisateur a également confirmé que le candidat caché s’ouvre et fonctionne
sur son appareil Android. Cette confirmation valide l’accès HTTPS et le fonctionnement général de
la coque sur appareil réel ; elle ne suffit pas encore à valider séparément l’installation, le
lancement hors ligne, l’Auth MJ, la photo, la mise à jour et les contrôles d’accessibilité.

La recette Android de `v2.21.0` a ensuite révélé deux défauts : le bouton du bandeau n’activait pas
la mise à jour dans la situation observée alors que l’action équivalente de Réglages fonctionnait,
et le bandeau restait visible après activation. Le correctif `v2.21.1` réconcilie le worker avant
l’action, réserve le bandeau aux seules mises à jour, conserve les aides d’installation dans
Réglages et protège les continuations asynchrones après démontage. Sa revalidation Android reste à
faire avant de clore la matrice.

## Contrôles automatisés

Le test `tools/m6-03-release.test.mjs` vérifie l’alignement version/méta/Service Worker/CHANGELOG,
la conservation du `start_url`, l’absence d’annonce publique de `/app/`, l’existence de la coque,
du bandeau PWA et de la documentation de limites, ainsi que la syntaxe des modules critiques.

Les gates exécutés localement sont `npm run lint`, `npm run test:m6-03`, `npm run test:m6-02`,
`npm run check` et `git diff --check`. Le check complet rejoue également les régressions bureau,
mobile, sécurité et règles déjà présentes dans le dépôt.

## Matrice Android — à exécuter sur appareil physique

| Scénario | Appareil / version | Résultat | Preuve / anomalie |
|---|---|---|---|
| Installation Chrome, nom, icône, standalone | À renseigner | **À faire** | À renseigner |
| Lancement à froid en ligne puis hors ligne | À renseigner | **À faire** | À renseigner |
| PNJs, Enquêtes, route directe, retour | À renseigner | **À faire** | À renseigner |
| Connexion MJ par redirection | À renseigner | **À faire** | À renseigner |
| Création/modification, photo, rotation, clavier | À renseigner | **À faire** | À renseigner |
| Publication temps réel vers un second appareil | À renseigner | **À faire** | À renseigner |
| Bannière et activation volontaire d’une mise à jour | À renseigner | **À faire** | À renseigner |
| Réseau coupé pendant un formulaire et reprise | À renseigner | **À faire** | À renseigner |
| Zoom 200 %, thèmes, largeur 375 px | À renseigner | **À faire** | À renseigner |

Android physique n’est donc pas déclaré validé dans ce rapport.

## Matrice iOS — explicitement différée

La recette iPhone/iPad est **non validée et différée** : ajout à l’écran d’accueil, mode autonome,
zone sûre, Auth, clavier, photo, rotation, hors ligne, fermeture/réouverture et particularités de
mise à jour devront être rejoués sur appareil réel dans un lot ultérieur.

## Audits à compléter avant activation publique

- **Accessibilité** : focus, noms accessibles, zoom 200 %, contraste et mouvement réduit sur
  appareil réel ; les contrôles statiques et tests DOM restent verts localement.
- **Performance** : démarrage réseau mobile bridé, poids initial, images et longues tâches sur
  appareil réel ; aucune mesure physique n’est revendiquée ici.
- **Sécurité** : inspection réelle de Cache Storage, déconnexion et lien direct secret sur les
  environnements de recette ; les exclusions et guards sont couvertes par les tests locaux.
- **Prévisualisation du futur démarrage mobile** : conserver `./index.html` jusqu’à M7, puis valider
  le changement de `start_url` hors production avant activation.

## Checklist de sortie

- [x] Version corrective, cache, méta et CHANGELOG alignés en `v2.21.1`.
- [x] `start_url` historique conservé et aucune annonce publique de `/app/`.
- [x] Contrôles automatisés locaux verts.
- [x] Preuves navigateur locales consignées sans données privées.
- [ ] Matrice Android physique complète.
- [ ] Inspection réelle Cache Storage.
- [ ] Matrice iOS : différée explicitement.
- [x] Autorisation spécifique puis publication du candidat caché `aa9f0d2` sur `master`.
- [x] Publication cachée de `v2.21.0` et cycle de mise à jour validé sur navigateur bureau.
- [ ] Cycle de mise à jour confirmé sur l’appareil Android de recette.

# M3-04 — clôture de la consultation PNJs mobile

Date de clôture préparée : 25 août 2026. Version statique préparée : `v2.18.0`.

## Périmètre livré

Le parcours joueur M3 est disponible depuis `app/index.html` : liste PNJs, recherche et filtres,
fiche directe `#/pnjs/{id}`, relations publiques et indices découverts liés. Les données sont
résolues depuis le store public partagé ; une fiche absente ou masquée reste indiscernable pour le
visiteur. Les vues libèrent leurs abonnements et leurs ressources à chaque changement de route.

La coque reste volontairement autonome et non annoncée par le site bureau. M3-04 aligne
`APP_VERSION` dans `js/layout.js`, le cache du Service Worker et le changelog, mais n'ajoute pas
`/app/` ou ses modules au précache et n'enregistre pas de worker depuis l'application. L'installation
et le précache complets relèvent de M6-02 ; l'annonce publique relève de M7.

## Contrôles automatisés

Le test `tools/m3-04-release.test.mjs` vérifie :

- la cohérence `v2.18.0` / `wfrp-cache-v2.18.0` / entrée datée du changelog ;
- l'existence du point d'entrée et de la feuille de style mobile ;
- la fermeture du graphe d'imports locaux depuis `app/index.html` et la syntaxe de chaque module atteint ;
- l'absence de précache mobile, d'annonce `/app/`, de manifeste ou de `start_url` ciblant l'application.

Ces contrôles sont complétés par les tests fonctionnels M3-01 à M3-04 et par le lint. Aucun accès à
Firebase de production ni déploiement n'est effectué par cette clôture.

## Recette restante

- [ ] Android physique : liste, détail direct et par relation, retour avec recherche/filtres/scroll,
  cache déjà rempli puis second lancement hors connexion, 320/375/430 px, paysage, clavier et zoom 200 %.
- [ ] Vérifier sur appareil la console vide, les deux thèmes et l'absence de fuite de données MJ.
- [ ] iOS : recette différée, aucun appareil disponible dans ce lot.
- [ ] M6-02 : installation PWA, précache de la coque et mise à jour du Service Worker.

La clôture automatisée ne vaut donc pas validation Android ou iOS : ces deux niveaux restent
explicitement séparés de la livraison statique M3.

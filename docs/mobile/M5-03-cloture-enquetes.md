# M5-03 — Clôture des Enquêtes mobiles

Date de clôture préparée : 25 août 2026. Version statique préparée : `v2.20.0`.

## Périmètre livré

Le parcours joueur fournit le carnet `#/enquetes`, la recherche publique, la fiche directe et les
liens vers les PNJs visibles. Les indices absents, secrets ou dépubliés restent indiscernables pour
un joueur ; le texte public peut rester lisible depuis le cache tandis que les illustrations
protégées ne sont jamais mises en cache par l’application ou le Service Worker.

Le parcours MJ couvre la liste Tous / Découverts / Secrets, la création, l’édition, la publication,
la dépublication et la suppression. Les liens masqués restent éditables côté MJ mais ne sont jamais
projetés au joueur. Les brouillons, conflits `updatedAt`, uploads 4:3, remplacements, retraits,
nettoyages incertains et reprises sont bornés par génération, identité, session et état réseau.

## Contrôles automatisés exécutés

Le test `tools/m5-03-release.test.mjs` vérifie la cohérence version/cache/méta, l’existence et la
fermeture du graphe d’imports M5, la syntaxe des modules, la CSP mobile et l’absence de précache,
manifeste ou annonce publique de `/app/`. Les tests M5-01/M5-02, M2-03, M3-04, M4-05 et la suite
complète sont exécutés par `npm run check`, avec ESLint et `git diff --check`.

Les quatre runners de règles M1-01 à M1-04 ont aussi été rejoués contre les émulateurs Firebase
locaux avec un code de sortie nul ; M1-04 affiche explicitement 2 tests réussis sur 2, sans test
ignoré. Les trois premiers runners ne publient pas leur détail en cas de succès, donc aucun comptage
plus précis n’est revendiqué pour eux.

Aucun accès Firebase de production, test de règles en production, déploiement ou recette physique
n’est revendiqué ici. Les fixtures, doubles et émulateurs sont locaux et ne contiennent aucune donnée
réelle.

## Recette restante, explicitement non validée

- [ ] Android réel : parcours joueur et MJ, publication temps réel entre deux appareils, réseau
  bridé/hors ligne, reprise après suspension, rotation, 320–430 px, clavier, zoom 200 % et deux thèmes.
- [ ] Vérifier sur appareil la console vide, les URL directes d’indices secrets, les caches locaux et
  la purge après déconnexion.
- [ ] iOS : recette explicitement différée ; clavier, retour système, suspension, stockage local et
  cycle photo seront vérifiés dans un lot ultérieur.
- [ ] M6 : installation PWA, précache de la coque, stratégie de mise à jour et validation appareil.
- [ ] M7 : annonce publique et déploiement progressif.

La clôture M5 valide le code et les contrôles automatisés exécutés localement ; elle ne transforme
pas cette checklist physique en recette effectuée.

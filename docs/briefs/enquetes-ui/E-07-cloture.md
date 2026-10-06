# E-07 — Clôture : thème clair, accessibilité, version, livraison

> Lire d'abord [`README.md`](README.md). Aucun nouveau comportement : on finit, on vérifie, on livre.

| | |
|---|---|
| Objectif | Livrer la refonte en **v2.35.0** sans régression |
| Fichiers | `css/enquetes-workspace.css`, `css/theme-parchment.css` (si besoin), `sw.js`, `js/layout.js`, `CHANGELOG.md`, `docs/enquetes-implementation.md`, tests de version |
| Dépend de | E-01 à E-06 |

## À faire

1. **Thème parchemin** (`[data-theme="parchment"]`, bureau et mobile) : redéfinir les jetons
   `--enq-*` sur ce sélecteur. Le fond devenant clair, les fiches de pièce ne peuvent plus être
   « parchemin sur sombre » : fond `#fbf5e6`, filet `rgba(42,33,22,.25)`, ombre plus courte ; la
   visionneuse reste sombre (lecture de l'image). Cachet, pastilles d'état et épingles inchangés.
   Vérifier le contraste 4,5:1 de chaque texte (secondaire et discret compris) dans les deux thèmes.
2. **Mouvement réduit** : `@media (prefers-reduced-motion: reduce)` → rotations à 0, aucun
   soulèvement au survol, aucune transition de feuille basse / menu.
3. **Accessibilité** — lancer l'agent de relecture d'accessibilité du dépôt sur
   `enquetes.html`, `app/index.html` et les modules touchés, puis corriger : ordre de tabulation
   rail → dossier → carnet ; onglets et sélecteur d'espace au clavier ; menus ⋯ (Échap, focus
   rendu) ; épingles annoncées ; `aria-current` sur la carte et l'onglet actifs ; aucune
   information portée par la seule couleur (état, rôle « Suspect », relations) ; cibles ≥ 44 px
   sur mobile ; zoom texte 200 % sans perte.
4. **Nettoyage** : supprimer de `css/enquetes-workspace.css` les règles devenues mortes (anciens
   `.enq-links`, `.enq-results{max-height}` mobile, etc.) et de `js/enquetes-workspace.js` les
   fonctions de rendu remplacées. `npm run lint` sans avertissement nouveau.
5. **Version** : `APP_VERSION = 'v2.35.0'` dans `sw.js` **et** `js/layout.js` (doivent rester
   identiques), `ASSETS_LOCAUX` complet (tous les nouveaux modules d'E-01 à E-06), tests de
   cohérence de version (`tools/m1-05-release-coherence.test.mjs`, `tools/m7-0*-release.test.mjs`)
   mis à jour si leur attente de version est en dur.
6. **Documentation** : entrée `CHANGELOG.md` v2.35.0 (refonte de l'interface Enquêtes : dossier
   en trois colonnes, pièces numérotées, visionneuse à épingles, écrans mobiles séparés, note
   rapide ; aucun changement de données) ; section « Interface » ajoutée à
   `docs/enquetes-implementation.md` (modules, jetons, disposition `desktop` / `mobile`).
7. **Captures de recette** depuis la fixture, déposées à côté des maquettes sous le nom
   `docs/briefs/enquetes-ui/recette/<écran>.png` (mêmes six écrans), pour comparaison.

## Recette finale

- [ ] Six écrans conformes aux maquettes, en thème sombre et en thème parchemin.
- [ ] Parcours MJ : créer un dossier, verser une pièce avec image, l'annoter, ordonner les pièces,
      publier, rendre secret, exporter, corbeille, restaurer.
- [ ] Parcours joueur : lecture seule des dossiers, note rapide, partage d'une copie, export de
      son carnet.
- [ ] Hors connexion (mobile) : lecture en cache, note gardée puis envoyée.
- [ ] `npm run check`, `npm run lint`, `npm run test:enquetes` verts ; CI verte sur la branche.

## Livraison

Fusion de `feat/enquetes-ui` dans `master` puis push **uniquement sur demande explicite** du
propriétaire du dépôt (le push sur `master` est la mise en production). Pas de redéploiement des
fonctions Firebase : aucune n'est modifiée par ce lot.

## Commit

`chore(release): enquetes interface v2.35.0`

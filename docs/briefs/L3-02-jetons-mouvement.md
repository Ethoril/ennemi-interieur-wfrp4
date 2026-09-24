# L3-02 — Jetons de mouvement et respect du mouvement réduit

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 3 — apparence et fluidité |
| **Constat** | D2 |
| **Estimation** | 1 h |
| **Fichiers** | `css/base.css`, `css/fiche.css`, `css/doodle.css` |
| **Dépend de** | — (**avant** `L3-03`, `L3-04`, `L3-05`) |

---

## Pourquoi

Les transitions du site utilisent `ease`, la courbe par défaut du navigateur, qui donne un
mouvement mou. Les jetons `--transition-*` (`css/base.css:76`) mêlent durée et courbe, ce qui
empêche de choisir l'une sans l'autre. Plusieurs règles animent `all` (`.nav-links a`,
`.card`, `css/base.css:334`, `:505`), ce qui anime aussi des propriétés coûteuses et imprévues.
Enfin, seuls `components.css`, `hero3d.css` et `mobile-app.css` respectent
`prefers-reduced-motion` : `base.css`, qui porte presque toutes les animations, l'ignore.

Ce brief pose le socle que les briefs `L3-03` à `L3-05` utilisent.

## À faire

1. **Ajouter deux courbes** dans le `:root` de `css/base.css`, à côté des `--transition-*` :
   `--ease-out: cubic-bezier(0.22, 1, 0.36, 1)` (sortie franche, pour ce qui apparaît) et
   `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)` (pour ce qui se déplace). Redéfinir les
   trois `--transition-*` existants avec `--ease-out` à la place de `ease`, durées inchangées.
   Aucune redéclaration dans `theme-parchment.css` : ce ne sont pas des couleurs.
2. **Remplacer `transition: all`** dans les trois fichiers par la liste explicite des
   propriétés qui changent réellement au survol ou à l'état actif (`color`, `background-color`,
   `border-color`, `transform`, `box-shadow`, `opacity`). Lire chaque règle `:hover` associée
   pour dresser la liste ; ne pas deviner.
3. **Bloc mouvement réduit** à la fin de `css/base.css`, sur le modèle de
   `css/components.css:156` : sous `@media (prefers-reduced-motion: reduce)`, ramener
   `animation-duration` et `transition-duration` à `0.01ms`, `animation-iteration-count` à `1`,
   et `scroll-behavior` à `auto`, sur `*, *::before, *::after`.

## Ce qu'il ne faut PAS faire

- Changer les durées : ce brief change la courbe, pas le rythme.
- Toucher `js/hero3d/` : la scène gère déjà le mouvement réduit (`js/hero3d/index.js:11`).
- Ajouter une bibliothèque d'animation.

## Vérification

- [ ] Console du navigateur vide (aucune erreur, aucune violation de CSP).
- [ ] Les deux thèmes (sombre + parchemin) s'affichent correctement.
- [ ] Rendu mobile 375 px, menu burger fonctionnel.
- [ ] Service worker : cache vidé avant de conclure.
- [ ] `grep -n "transition: all" css/` ne renvoie plus rien.
- [ ] Avec « Réduire les animations » activé dans l'OS (ou émulé dans les DevTools, onglet
      Rendering), survols, menu burger et cartes changent d'état sans animation.

## Commit

    refactor(css): courbes de mouvement et respect du mouvement réduit (D2)

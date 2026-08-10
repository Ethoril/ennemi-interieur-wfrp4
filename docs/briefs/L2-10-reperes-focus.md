# L2-10 — Repères de page et indicateur de focus

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | N3 (seconde moitié) |
| **Estimation** | 45 min |
| **Fichiers** | les 11 pages HTML, `css/base.css`, `css/fiche.css` |
| **Dépend de** | — |

---

## Pourquoi

**Aucun repère `<main>` sur les onze pages.** Un utilisateur de lecteur d'écran ne peut pas
sauter directement au contenu : il doit traverser la barre de navigation, qui compte neuf
entrées, sur chaque page.

**Aucun lien d'évitement.** Même problème au clavier : neuf tabulations avant d'atteindre le
contenu, à chaque changement de page.

**L'indicateur de focus est supprimé sans être remplacé correctement.** `outline: none` apparaît
à sept endroits dans `css/base.css` et `css/fiche.css`, compensé seulement par un changement de
couleur de bordure — un signal trop faible, et inexistant sur les éléments qui n'ont pas de
bordure.

---

## À faire

### 1. Repère principal sur les onze pages

Le conteneur `<div class="page-container">` enveloppe déjà exactement le contenu voulu sur
toutes les pages. Il suffit de changer la balise :

```html
<!-- avant -->
<div class="page-container">
<!-- après -->
<main class="page-container">
```

Sans oublier la balise de fermeture. La classe est conservée, donc aucun impact CSS.

Cas particulier : `carte.html` a une structure différente (bouton de retour, bouton de règle,
titre et panneau de mesure **hors** de `.page-container`, qui ne contient que
`#map-container`). Y placer `<main>` autour du conteneur de carte, et laisser les contrôles à
l'extérieur — ils relèvent de la barre d'outils, pas du contenu.

### 2. Lien d'évitement

En première position dans `<body>`, sur les onze pages, avant `<nav class="navbar">` :

```html
<a class="skip-link" href="#contenu">Aller au contenu</a>
```

Et donner l'`id` correspondant au repère principal :

```html
<main class="page-container" id="contenu">
```

Styles dans `css/base.css` — visible uniquement au focus, avec les jetons du projet :

```css
/* Lien d'évitement : hors écran jusqu'à réception du focus clavier.
   La navigation compte neuf entrées, ce lien évite de les traverser
   à chaque page. */
.skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: 1000;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-card);
    color: var(--gold);
    border: 1px solid var(--border-gold);
    border-radius: var(--radius-sm);
    font-family: var(--font-heading);
    text-decoration: none;
}
.skip-link:focus {
    left: var(--space-sm);
    top: var(--space-sm);
}
```

**Ne pas** utiliser `display: none` ni `visibility: hidden` : le lien deviendrait inatteignable
au clavier, ce qui annule son intérêt. La technique du positionnement hors écran est la bonne.

Vérifier que la valeur de `z-index` passe au-dessus de la barre de navigation (qui est en
`position: fixed` — relever sa valeur dans `base.css` et ajuster si nécessaire).

### 3. Indicateur de focus global

Ajouter dans `css/base.css`, après les règles de base :

```css
/* Indicateur de focus unique pour tout le site. Les champs remplaçaient
   le contour natif par un simple changement de couleur de bordure, signal
   trop faible et absent des éléments sans bordure. :focus-visible ne
   déclenche l'indicateur qu'à la navigation clavier, jamais au clic. */
:focus-visible {
    outline: 2px solid var(--gold);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
}
```

Les sept `outline: none` existants sont écrits sur `:focus`, pas sur `:focus-visible`. Il faut
donc s'assurer que la nouvelle règle **gagne** : soit en les retirant (préférable — ils
deviennent inutiles), soit en les restreignant à `:focus:not(:focus-visible)`.

Retirer est plus propre. Les emplacements concernés : `.sheet-search:focus`,
`.pnj-search-wrapper input:focus`, `.rel-add-form select:focus` / `input:focus`,
`.form-col input:focus` / `select:focus` / `textarea:focus` dans `css/base.css` ; et
`.fiche-field input:focus` / `select:focus`, `.carac-input:focus`, `.derived-stat input:focus`,
`.sk-adv:focus` dans `css/fiche.css`.

**Conserver** les changements de couleur de bordure qui accompagnent ces règles : ils sont un
retour visuel utile, y compris au clic. On ne retire que la ligne `outline: none`.

Vérifier ensuite qu'aucun contour ne dépasse d'un conteneur à `overflow: hidden` — cas
classique dans les cellules de tableau. `outline-offset: 2px` peut devoir descendre à `1px` sur
les champs de caractéristiques, qui sont serrés.

### 4. Vérifier la cohérence sur fond clair

`var(--gold)` vaut `#c9a84c` en thème sombre et `#7a5c10` en parchemin. Les deux doivent rester
visibles sur leur fond respectif : contrôler notamment le focus sur les cartes de navigation de
l'accueil et sur les boutons dorés, où le contour risque de se confondre avec la bordure.

---

## Ne pas faire

- **Ne pas ajouter d'autres repères ARIA** (`role="banner"`, `role="contentinfo"`,
  `role="navigation"`). `<nav>`, `<main>` et `<footer>` les portent déjà implicitement ; les
  redoubler est du bruit.
- **Ne pas mettre plusieurs `<main>` par page.** Un seul, et il ne doit pas être imbriqué dans
  `<nav>` ou `<footer>`.
- **Ne pas remplacer `:focus-visible` par `:focus`.** Le contour apparaîtrait à chaque clic de
  souris, ce qui a précisément conduit à écrire les `outline: none` d'origine.
- **Ne pas oublier une page.** Onze : `index`, `groupe`, `videos`, `tableau`, `regles`,
  `cartes`, `carte`, `pnjs`, `enquetes`, `doodle`, `fiche`.

---

## Vérification

- [ ] `grep -c '<main' *.html` renvoie 1 pour les onze pages.
- [ ] `grep -c 'skip-link' *.html` renvoie 1 pour les onze pages.
- [ ] Sur chaque page : première tabulation → le lien d'évitement apparaît, lisible, au-dessus
      de la barre de navigation. Entrée → le focus passe au contenu.
- [ ] Le lien d'évitement est **invisible** hors focus, dans les deux thèmes, et ne décale rien.
- [ ] Navigation clavier complète de la fiche : le focus est visible **partout** — champs de
      caractéristiques, avances de compétences, sélecteurs, boutons `×`, chips de talents,
      lignes fantômes, boutons du panneau de carrière.
- [ ] Un clic à la souris dans un champ **n'affiche pas** le contour (c'est le rôle de
      `:focus-visible`), mais la bordure change bien de couleur comme avant.
- [ ] Aucun contour tronqué par un `overflow: hidden` : vérifier les cellules du tableau de
      caractéristiques et les chips de talents.
- [ ] Contraste du contour vérifié dans les deux thèmes, notamment sur les cartes de l'accueil
      et les boutons dorés.
- [ ] Modales (vidéo, talent, PNJ, recadrage, votes) : le focus reste visible et le piège de
      focus de la modale vidéo fonctionne toujours.
- [ ] `carte.html` : le bouton de retour, le bouton de règle et le panneau de mesure restent
      accessibles au clavier, en dehors du `<main>`.
- [ ] Aucune régression visuelle dans les onze pages, deux thèmes.

---

## Message de commit

```
a11y: reperes de page, lien d'evitement et indicateur de focus (N3)

Aucune page n'avait de <main> ni de lien d'evitement : la navigation
a neuf entrees devait etre traversee a chaque page. Le contour de focus
etait par ailleurs supprime a sept endroits sans remplacement suffisant.

- page-container devient <main id="contenu"> sur les 11 pages
- lien d'evitement positionne hors ecran, visible au focus
- regle :focus-visible globale, suppression des outline:none devenus
  inutiles (les changements de bordure sont conserves)
```

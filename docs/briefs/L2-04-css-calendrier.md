# L2-04 — Sortir la mise en forme du Calendrier du JavaScript

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md)**, en particulier la section 5.

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | I4 |
| **Estimation** | 3 h |
| **Fichiers** | `css/doodle.css` (nouveau), `js/doodle.js`, `doodle.html`, `css/base.css`, `css/theme-parchment.css` |
| **Dépend de** | `L1-01` doit être terminé (même fichier, éviter les conflits) |

---

## Pourquoi

**Le thème Parchemin est illisible sur la page Calendrier.** `js/doodle.js` et `doodle.html`
codent en dur des fonds sombres — `background: rgba(0,0,0,0.3)` sur les champs de saisie,
`rgba(0,0,0,0.2)` sur le panneau MJ — tout en gardant `color: var(--text-primary)`. En thème
Parchemin, `--text-primary` vaut `#2a1008`, un brun très foncé : du texte sombre sur un fond
assombri.

La cause est structurelle : **56 attributs `style="…"` dans `js/doodle.js`** et une trentaine
de plus dans `doodle.html`. C'est la seule page du site dont la mise en forme n'est pas dans une
feuille de style.

---

## À faire

### 1. Créer `css/doodle.css` et le lier

```html
<!-- doodle.html, dans le <head>, après la feuille principale -->
<link rel="stylesheet" href="css/doodle.css">
```

Ce fichier est propre à cette page, comme `css/fiche.css` l'est pour la fiche. Ne pas l'ajouter
aux autres pages.

### 2. Introduire le jeton manquant

Deux teintes d'or sont codées en dur et ne suivent pas le thème : la ligne des totaux
(`rgba(201,168,76,0.05)`) et la bannière de clôture (`rgba(201,168,76,0.1)`). Créer un jeton
dans les deux thèmes :

```css
/* css/base.css, dans :root */
--gold-wash: rgba(201, 168, 76, 0.07);

/* css/theme-parchment.css, dans [data-theme="parchment"] */
--gold-wash: rgba(122, 92, 16, 0.10);
```

Vérifier qu'aucun jeton existant ne fait déjà l'affaire avant d'en créer un.

### 3. Table de correspondance

Chaque littéral trouvé dans `js/doodle.js` ou `doodle.html` se remplace par un jeton :

| Littéral actuel | Jeton |
|---|---|
| `background: rgba(0,0,0,0.3)` (champs) | `var(--bg-surface)` |
| `background: rgba(0,0,0,0.2)` (panneau MJ) | `var(--bg-card)` |
| `background: rgba(0,0,0,0.15)` (ligne de vote) | `var(--bg-card)` |
| `background: rgba(201,168,76,0.05)` / `0.1` | `var(--gold-wash)` |
| `color: #2ecc71` (disponible) | `var(--statut-allie)` |
| `color: #e74c3c` (indisponible, erreurs) | `var(--statut-ennemi)` |
| `color: #c94c4c` (suppression, erreur de chargement) | `var(--blood-bright)` |
| `border: … var(--border-subtle)` etc. | inchangé, déjà des jetons |

Les espacements en dur (`padding: 12px`, `gap: 10px`, `margin-bottom: 2rem`) passent aux jetons
`--space-*` quand une valeur proche existe, sinon restent en valeur littérale dans le CSS —
c'est acceptable dans une feuille de style, ce qui ne l'était pas dans un attribut `style=`.

### 4. Nommer les classes par ce qu'elles sont

Pas par leur apparence. Nomenclature proposée, à compléter selon les besoins :

```
.doodle-admin-panel          .doodle-admin-section      .doodle-admin-actions
.doodle-input                .doodle-hint
.doodle-table                .doodle-table-head
.doodle-cell                 .doodle-cell-player        .doodle-cell-total
.doodle-vote-yes             .doodle-vote-no
.doodle-player-row           .doodle-player-actions     .doodle-btn-icon
.doodle-voter-row            .doodle-checkbox-wrap
.doodle-card                 .doodle-card-date          .doodle-btn-votes
.doodle-voter-form           .doodle-vote-error
.doodle-closed-banner        .doodle-empty              .doodle-loader
.doodle-modal-close          .doodle-modal-filters
```

Certaines classes existent déjà dans `css/base.css` (`.doodle-card`, `.doodle-voter-item`,
`.doodle-voter-avatar`, `.doodle-voter-badge-yes`, `.doodle-voter-badge-no`,
`.custom-checkbox-container`). **Les réutiliser plutôt que d'en créer des doublons**, et
décider au cas par cas si la règle existante doit migrer vers `doodle.css` ou rester dans
`base.css`. Préférer la migration quand la règle ne sert qu'à cette page.

### 5. Traiter les trois états de la page

Chacun a ses styles propres et se vérifie séparément :

- **sondage actif**, en format horizontal puis vertical ;
- **sondage clôturé** (bannière visible, cases à cocher absentes, boutons de suppression MJ
  toujours présents) ;
- **aucun sondage** (`#doodle-empty`), plus le panneau MJ en mode création.

### 6. Attention aux styles dépendants de la structure du tableau

Le format horizontal fixe des largeurs de colonnes en ligne
(`min-width: 180px; width: 180px` sur la colonne Joueurs, `min-width: 120px` sur les colonnes de
dates) et s'appuie sur une barre de défilement horizontale dorée introduite en 2.11.2. Ces
règles sont fonctionnelles, pas décoratives : les reporter fidèlement dans le CSS, et vérifier
le comportement avec 8 dates et 6 joueurs, sur écran étroit.

---

## Ne pas faire

- **Ne rien changer à l'apparence en thème sombre.** C'est un déplacement, pas une refonte
  visuelle. Comparer avant / après par captures d'écran.
- **Ne pas toucher à la logique** : tri des joueurs (David en premier), calcul des totaux,
  restauration des cases cochées au re-rendu, bascule entre les deux formats, contenu du
  courriel. Uniquement la présentation.
- **Ne pas réintroduire de couleur littérale** dans le nouveau CSS. Si un jeton manque, en créer
  un dans les deux thèmes.
- **Ne pas supprimer les attributs `style=` de `doodle.html` sans reporter leur effet.**
  Plusieurs portent de la mise en page (flex, gap, largeurs) et pas seulement des couleurs.

---

## Vérification

- [ ] **Thème Parchemin, sondage actif** : champs de saisie, panneau MJ, cartes de dates,
      boutons de votes, modale de détail, bannière de clôture — tout est lisible, aucun texte
      sombre sur fond sombre. C'est l'objectif du brief.
- [ ] **Thème sombre** : comparer aux captures d'avant modification, format horizontal et
      format vertical. Aucune différence visible attendue.
- [ ] Les trois états (actif, clôturé, vide) dans les deux thèmes, plus le panneau MJ en mode
      création et en mode gestion.
- [ ] Bascule entre les deux formats : le pseudo saisi est conservé, les cases cochées sont
      restaurées.
- [ ] Format horizontal avec 8 dates et 6 joueurs sur écran 1280 px puis 375 px : la barre de
      défilement horizontale fonctionne, les colonnes gardent leurs largeurs, les libellés de
      dates ne dépassent pas 2 lignes.
- [ ] Modale de détail des votes : les trois filtres (Tous / Oui / Non), les boutons crayon et
      poubelle, la fermeture par clic extérieur.
- [ ] Plus **aucun** attribut `style=` dans `js/doodle.js` (`grep -c 'style="' js/doodle.js`
      doit renvoyer 0).
- [ ] Plus aucune couleur littérale dans `js/doodle.js`.
- [ ] Console vide, aucune règle CSS non appliquée signalée dans l'inspecteur.

---

## Message de commit

```
refactor(doodle): sortir la mise en forme du JavaScript (I4)

56 attributs style= dans doodle.js et une trentaine dans doodle.html
codaient en dur des fonds sombres avec un texte en var(--text-primary),
ce qui rendait la page illisible en theme parchemin.

- css/doodle.css, liee dans doodle.html seulement
- jeton --gold-wash decline dans les deux themes
- litteraux de couleur remplaces par les jetons existants
- classes nommees par role, reutilisation des classes deja dans base.css
```

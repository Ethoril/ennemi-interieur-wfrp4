# L2-08 — Trois correctifs ciblés

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constats d'audit** | M4, M5, M7 (partiel) |
| **Estimation** | 1 h |
| **Fichiers** | `js/hero3d/scroll-timeline.js`, `js/sheets.js`, `fiche.html` |
| **Dépend de** | — |

---

## Pourquoi

Trois corrections indépendantes, petites, sans rapport entre elles. Regroupées dans un seul
brief pour éviter trois allers-retours, mais **les trois doivent être faites** — c'est le risque
de ce format, ne pas s'arrêter à la première.

Elles peuvent faire l'objet de trois commits distincts si c'est plus clair.

---

## Tâche 1 — M4 : réagencement forcé à chaque défilement

### Le problème

`js/hero3d/scroll-timeline.js`, fonction `onScroll()` (~l. 72) : elle est appelée à **chaque**
événement de défilement (passif, mais non limité) et appelle `getOffsetTop()` — donc
`getBoundingClientRect()` — sur jusqu'à dix éléments. Chaque appel force un calcul de mise en
page synchrone, en parallèle de la boucle de rendu Three.js.

### La correction

Mesurer les positions **une fois**, dans `calculateAnchors()`, qui est déjà rappelée par le
`ResizeObserver` sur `document.body` et par l'événement `resize`. `onScroll()` ne lit alors plus
que `window.scrollY`.

```js
let maxScroll = 0;

function calculateAnchors() {
    anchors = [
        { el: document.getElementById('hero'),         chapter: 0 },
        { el: document.getElementById('next-session'), chapter: 1 },
        { el: document.querySelector('.card-grid'),    chapter: 2 },
        { el: document.querySelector('.ornament'),     chapter: 3 },
        { el: document.getElementById('site-footer'),  chapter: 4 },
    ].map(a => ({ ...a, top: getOffsetTop(a.el) }));   // mesuré ici, une fois
    maxScroll = document.body.scrollHeight - window.innerHeight;
}
```

Dans `onScroll()`, remplacer les appels `getOffsetTop(a1.el)` / `getOffsetTop(a2.el)` par
`a1.top` / `a2.top`, et l'expression `document.body.scrollHeight - wh` par `maxScroll`.

### Attention

Le `ResizeObserver` observe `document.body` précisément parce que la hauteur de la page change
après le chargement : le widget du calendrier impérial apparaît de façon asynchrone (`display`
passé de `none` à `''` par `js/calendar.js`), et la date de prochaine session s'insère après un
`fetch`. Si les ancres ne sont plus recalculées à ce moment-là, la timeline se désynchronise.
**Ne pas retirer le `ResizeObserver`.**

---

## Tâche 2 — M5 : la recherche masque les en-têtes de tableau

### Le problème

`js/sheets.js`, fonction `filterCards()` (~l. 199) :

```js
const cards = container.querySelectorAll('.sheet-card, .sheet-definition, .sheet-table-wrapper tr');
```

Le sélecteur `.sheet-table-wrapper tr` capture aussi la ligne de `<thead>`. Dès qu'on tape dans
le champ de recherche de l'onglet « Coûts XP », les libellés de colonnes disparaissent avec les
lignes qui ne concordent pas.

### La correction

```js
const cards = container.querySelectorAll('.sheet-card, .sheet-definition, .sheet-table-wrapper tbody tr');
```

`renderTable()` génère bien un `<tbody>` explicite, la correction est donc suffisante.

---

## Tâche 3 — M7 partiel : espèce Nain et rang 5

### Le problème

Deux limitations dans `fiche.html` :

- Le sélecteur `#race` ne propose pas de Nain, alors que la table `MOUVEMENT` de `js/fiche.js`
  contient déjà `nain: 3`. Un personnage nain ne peut pas déclarer son espèce.
- Le champ `#rang` est borné à `max="4"`, alors que `getActiveRang()` gère le rang 5 de la
  carrière `Mage (HE)` (`Math.max(4, ...career.rangs.map(r => r.rang))`).

### La correction

Dans le sélecteur `#race` (~l. 58-64), ajouter l'option en respectant l'écriture inclusive des
options existantes (`Humain.e`, `Elfe Sylvain.e`, `Haut.e Elfe`, `Halfelin.ne`) :

```html
<option value="nain">Nain.e</option>
```

La placer entre `Halfelin.ne` et `Ogre`. La valeur `nain` doit correspondre **exactement** à la
clé de `MOUVEMENT`.

Et pour le rang (~l. 73) :

```html
<input type="number" id="rang" min="1" max="5" value="1">
```

### Explicitement hors périmètre

Deux points de M7 ont été **écartés sur décision** et ne doivent pas être touchés :

- `MOUVEMENT.halfelin` reste à `4`.
- La formule de `blessures-max` reste `getBonus('f') + 2 * getBonus('e') + getBonus('fm')` pour
  toutes les espèces, sans cas particulier Halfelin ou Ogre.

---

## Ne pas faire

- **Ne pas ajouter de limitation (`throttle`, `debounce`) sur `onScroll`.** L'événement est déjà
  passif et le calcul devient trivial une fois les positions mémorisées ; ajouter un délai
  introduirait une latence visible sur le mouvement de caméra.
- **Ne pas toucher aux courbes de caméra** (`curve`, `lookAtCurve`) ni au lissage exponentiel de
  `updateCamera()`.
- **Ne pas retirer `window.__HERO3D_PROGRESS`** dans ce brief : c'est l'objet de `L2-13`.
- **Ne pas ajouter d'autres espèces** que Nain (pas de Gnome, pas d'espèce des suppléments) :
  `MOUVEMENT` n'a pas leur valeur et ce n'est pas demandé.

---

## Vérification

### M4

- [ ] Profileur de performances pendant un défilement de l'accueil : plus de recalcul de mise en
      page (`Layout` / `Recalculate Style`) déclenché depuis le gestionnaire de `scroll`.
- [ ] La scène 3D suit toujours les cinq chapitres du haut vers le bas et retour.
- [ ] Redimensionner la fenêtre en cours de défilement : la timeline reste synchronisée.
- [ ] **Recharger l'accueil et attendre l'apparition du widget de calendrier impérial et de la
      date de prochaine session** : la timeline doit se réajuster (c'est le cas que le
      `ResizeObserver` couvre).
- [ ] Basculer en parchemin puis revenir en sombre : la scène reprend correctement.
- [ ] Sur écran étroit (< 768 px) la scène reste désactivée, sans erreur en console.

### M5

- [ ] Onglet « Coûts XP », taper `caract` : les lignes filtrent et **les en-têtes de colonnes
      restent visibles**.
- [ ] Taper une chaîne sans résultat : les en-têtes restent visibles, le tableau est vide.
- [ ] Vider le champ : tout revient.
- [ ] Onglets « Mots Clés » (définitions) et « Magie » (cartes) : la recherche fonctionne
      toujours.

### M7

- [ ] Sélectionner `Nain.e` sur une fiche : le Mouvement affiche **3**.
- [ ] Recharger la page : l'espèce et le Mouvement sont conservés.
- [ ] Le champ Rang accepte la valeur 5, au clavier **et** avec les flèches du champ numérique.
- [ ] Avec la carrière `Mage (HE)` et le rang 5 : le panneau de référence affiche bien les cinq
      rangs cumulés.
- [ ] Avec une carrière ordinaire et le rang 5 saisi : `getActiveRang()` ramène à 4, le panneau
      reste cohérent (comportement existant, à confirmer non régressé).

---

## Messages de commit

Trois commits séparés, ou un seul si préféré.

```
perf(hero3d): mesurer les ancres de defilement une seule fois (M4)

onScroll appelait getBoundingClientRect sur dix elements a chaque
evenement, forcant un recalcul de mise en page synchrone en parallele
de la boucle de rendu. Les positions sont desormais mesurees dans
calculateAnchors, deja rappelee par le ResizeObserver et par resize.
```

```
fix(sheets): ne plus masquer les en-tetes de tableau a la recherche (M5)

Le selecteur de filterCards capturait la ligne de thead.
```

```
feat(fiche): espece Nain et rang maximum porte a 5 (M7)

- option Nain.e dans le selecteur d'espece (MOUVEMENT.nain existait deja)
- #rang passe de max=4 a max=5 pour le rang 5 de Mage (HE), que
  getActiveRang gerait deja
```

# L3-05 — Apparitions au défilement, modales et menu animés

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 3 — apparence et fluidité |
| **Constat** | D5 |
| **Estimation** | 2 h |
| **Fichiers** | `css/base.css`, `css/components.css` |
| **Dépend de** | `L3-02` avant celui-ci |

---

## Pourquoi

Le contenu des pages (grilles de cartes, portraits du Groupe, cartes du Vieux Monde) est posé
d'un bloc : rien ne guide l'œil. La modale de confirmation (`.ui-confirm`,
`css/components.css:89`) apparaît et disparaît sans transition, alors que c'est un
`<dialog>` natif, qu'on sait maintenant animer en CSS pur. Le menu burger glisse via `right`
(`css/base.css:1492`), propriété qui force un recalcul de mise en page à chaque image.

## À faire

1. **Apparition au défilement**, en CSS seul, dans `css/base.css` :
   sous `@supports (animation-timeline: view())` **et** `@media (prefers-reduced-motion: no-preference)`,
   donner aux `.card`, `.map-card` et aux cartes de personnage du Groupe une animation
   d'entrée (fondu + `translateY(16px)` vers `0`) pilotée par `animation-timeline: view()`
   et `animation-range: entry 0% entry 40%`. Les navigateurs sans support affichent le contenu
   directement. Vérifier les sélecteurs réels des cartes du Groupe dans `groupe.html` avant
   d'écrire la règle.
2. **Modale de confirmation** (`css/components.css:89-104`) : animer l'ouverture et la
   fermeture de `.ui-confirm` et de son `::backdrop` avec `@starting-style` pour l'état
   d'entrée, `transition-behavior: allow-discrete` sur `display` et `overlay`, et une montée
   `scale(0.96)` → `1` + fondu, 200 ms, `var(--ease-out)`. Aucun changement dans
   `js/ui-confirm.js`.
3. **Menu burger** : remplacer l'animation de `right` par `transform: translateX(100%)` →
   `translateX(0)`, `right: 0` fixe. Même rendu, animé par le compositeur.
4. **Survol des cartes** : l'effet existant (`.card:hover`, `css/base.css:522`) est bon ;
   seulement vérifier qu'il n'anime plus que `transform`, `box-shadow`, `border-color` et
   `background-color` après `L3-02`.

## Ce qu'il ne faut PAS faire

- Utiliser `IntersectionObserver` ou une bibliothèque (AOS, GSAP) : le CSS couvre le besoin.
- Masquer le contenu (`opacity: 0`) en dehors du bloc `@supports` : sans support, il
  resterait invisible.
- Animer les éléments de la fiche de personnage (`fiche.html`) : c'est un outil de saisie, le
  mouvement y gêne plus qu'il n'aide.
- Casser le piège de focus ou la touche Échap de la modale.

## Vérification

- [ ] Console du navigateur vide (aucune erreur, aucune violation de CSP).
- [ ] Les deux thèmes (sombre + parchemin) s'affichent correctement.
- [ ] Rendu mobile 375 px, menu burger fonctionnel, animation fluide à l'ouverture et à la
      fermeture.
- [ ] Service worker : cache vidé avant de conclure.
- [ ] Firefox : tout le contenu est visible, sans animation au défilement.
- [ ] Modale (supprimer un PNJ en MJ) : s'ouvre et se ferme en fondu ; Échap et le focus
      fonctionnent toujours.
- [ ] Mouvement réduit : aucune animation ; tout est visible.
- [ ] Faire relire par l'agent `a11y-reviewer`.

## Commit

    feat(ui): apparitions au défilement, modale et menu animés (D5)

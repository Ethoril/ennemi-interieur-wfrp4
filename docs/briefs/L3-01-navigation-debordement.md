# L3-01 — Barre de navigation qui déborde sur ordinateur

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 3 — apparence et fluidité |
| **Constat** | D1 — visible sur toutes les pages |
| **Estimation** | 45 min |
| **Fichiers** | `css/base.css` |
| **Dépend de** | — |

---

## Pourquoi

À 1440 px de large, le dernier lien de la barre, « Calendrier », est coupé au bord droit
(« CALENDRI… ») sur les onze pages. `NAV_ITEMS` (`js/layout.js:5`) compte désormais dix entrées
depuis l'ajout de « Version mobile », mais le menu burger ne s'active qu'en dessous de 768 px
(`css/base.css:1474`). Entre les deux, rien ne gère le manque de place. Sur un écran portable
de 1280 à 1366 px, deux liens au moins disparaissent.

## À faire

1. **Mesurer d'abord.** Sur `index.html`, à 1440 puis 1280 px, relever dans la console
   `document.querySelector('.nav-inner, .navbar').scrollWidth` et la largeur réelle de
   `#nav-links`. Noter la largeur minimale qui tient les dix liens sans débordement.
2. **Resserrer sans rien casser** dans `.nav-links a` (`css/base.css:322`) : ramener
   `letter-spacing` de `0.08em` à `0.05em` et le padding horizontal de `10px` à `8px`. Ces
   deux réglages suffisent souvent à regagner la largeur d'un lien.
3. **Faire basculer le burger plus tôt.** Si la mesure de l'étape 1 reste au-dessus de 1280 px,
   déplacer le seul bloc « Mobile burger » (`.nav-burger`, `.nav-links`, `.nav-links.open`,
   `.nav-links a`) dans une requête `@media (max-width: 1200px)` distincte. **Ne pas** déplacer
   le reste de la requête `max-width: 768px` (hero, grilles, `--nav-height`) : ces règles
   concernent le téléphone, pas la navigation.

## Ce qu'il ne faut PAS faire

- Retirer ou renommer une entrée de `NAV_ITEMS` : c'est une décision de contenu, pas de CSS.
- Mettre `overflow-x: auto` sur la barre : un défilement horizontal caché n'est pas une
  navigation.
- Baisser `font-size` sous `0.8rem` : le contraste et la lisibilité de Cinzel en capitales
  s'effondrent.

## Vérification

- [ ] Console du navigateur vide (aucune erreur, aucune violation de CSP).
- [ ] Les deux thèmes (sombre + parchemin) s'affichent correctement.
- [ ] Rendu mobile 375 px, menu burger fonctionnel.
- [ ] Service worker : cache vidé avant de conclure.
- [ ] Aucun lien coupé à 1920, 1440, 1366 et 1280 px ; le burger apparaît à la bonne largeur.
- [ ] Le lien actif garde son soulignement doré.

## Commit

    fix(nav): empêcher le débordement de la barre sur ordinateur (D1)

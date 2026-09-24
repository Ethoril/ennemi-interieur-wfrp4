# L3-03 — Transitions animées entre les pages

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 3 — apparence et fluidité |
| **Constat** | D3 |
| **Estimation** | 1 h 30 |
| **Fichiers** | `css/base.css` |
| **Dépend de** | `L3-02` avant celui-ci |

---

## Pourquoi

Le site est multi-pages : chaque clic dans la barre provoque un écran blanc bref puis un
réaffichage complet, y compris de la barre qui ne change pas. C'est ce qui donne l'impression
d'un site « qui clignote » plutôt que d'une application.

Les View Transitions entre documents règlent ça en CSS pur, sans JavaScript ni dépendance :
le navigateur capture l'ancienne page, charge la nouvelle, et anime le passage. Chrome, Edge
et Safari 18.2+ les gèrent ; Firefox navigue normalement, sans animation. C'est une
amélioration progressive, sans code de repli à écrire.

## À faire

Tout se passe en fin de `css/base.css`, feuille chargée par toutes les pages.

1. **Activer la transition** : `@view-transition { navigation: auto; }`. Ne s'applique qu'aux
   navigations de même origine, ce qui exclut d'office les liens externes.
2. **Figer la barre** : donner `view-transition-name: site-nav` à `.navbar`. Elle ne fait
   plus partie du fondu et reste immobile pendant que le contenu change.
3. **Faire glisser le titre** : `view-transition-name: page-title` sur le titre principal
   de page. Vérifier d'abord son sélecteur réel (le `<h1>` du bandeau de chaque page, dans le
   HTML) : **un nom ne doit exister qu'une fois par page**, sinon la transition est annulée.
4. **Régler le fondu** du reste de la page via `::view-transition-old(root)` et
   `::view-transition-new(root)` : sortie en fondu + léger recul (`translateY(-8px)`), entrée
   en fondu + léger avancement, 250 ms, courbe `var(--ease-out)` de `L3-02`.
5. **Mouvement réduit** : sous `prefers-reduced-motion: reduce`, désactiver
   (`@view-transition { navigation: none; }`).

## Points d'attention

- **La scène 3D** de l'accueil (`<canvas>` de `js/hero3d/`) : la capture d'un canvas WebGL
  peut produire une image figée ou noire pendant 250 ms. Tester la navigation *depuis* et
  *vers* `index.html`. Si l'effet est laid, exclure le conteneur de la scène avec
  `view-transition-name: none` n'aide pas (il reste dans `root`) : lui donner plutôt son
  propre nom et une animation `none`.
- **`carte.html`** (visionneuse plein écran, structure à part) : vérifier que l'entrée et la
  sortie restent propres.
- **Service worker** : les pages servies depuis le cache doivent se comporter pareil. Tester en
  ligne, puis hors ligne.

## Ce qu'il ne faut PAS faire

- Ajouter du JavaScript (`document.startViewTransition`, `pageswap`, `pagereveal`) : le CSS
  suffit pour ce besoin.
- Nommer des éléments de liste (cartes, portraits) pour les faire « voler » d'une page à
  l'autre : séduisant, mais chaque nom doit être unique et correspondre des deux côtés. Hors
  périmètre de ce brief.
- Dépasser 300 ms : au-delà, la navigation paraît plus lente qu'avant.

## Vérification

- [ ] Console du navigateur vide (aucune erreur, aucune violation de CSP).
- [ ] Les deux thèmes (sombre + parchemin) s'affichent correctement, y compris pendant la
      transition (pas de flash de l'autre thème).
- [ ] Rendu mobile 375 px, menu burger fonctionnel.
- [ ] Service worker : cache vidé avant de conclure ; test aussi hors ligne.
- [ ] La barre ne bouge pas quand on passe d'une page à l'autre ; le titre glisse.
- [ ] Firefox : navigation normale, sans erreur.
- [ ] Mouvement réduit activé : aucune animation.

## Commit

    feat(ui): transitions animées entre les pages (D3)

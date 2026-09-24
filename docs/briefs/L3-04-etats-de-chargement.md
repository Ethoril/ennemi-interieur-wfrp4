# L3-04 — États de chargement et champs de recherche

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 3 — apparence et fluidité |
| **Constat** | D4 |
| **Estimation** | 2 h |
| **Fichiers** | `pnjs.html`, `enquetes.html`, `doodle.html`, `tableau.html`, `js/pnjs.js`, `js/enquetes.js`, `css/base.css`, `css/doodle.css` |
| **Dépend de** | `L3-02` avant celui-ci |

---

## Pourquoi

Pendant le chargement Firestore, les pages PNJs, Enquêtes, Calendrier et Aides de Jeux
montrent un simple texte (« Chargement des personnages... », `pnjs.html:95` ;
« Chargement du grimoire d'enquêtes... », `enquetes.html:67` et `js/enquetes.js:144` ;
« Chargement du sondage... », `doodle.html:87` ; `tableau.html:68`). Sur PNJs, c'est un
spinner perdu au milieu d'un grand cadre vide. Quand les données arrivent, le contenu
apparaît d'un coup et la page saute.

Par ailleurs, les champs `#pnj-search` et `#clue-search` s'affichent dans la police système :
`.pnj-search-wrapper input` (`css/base.css:1591`) ne reprend pas `font-family`. C'est le seul
texte du site qui n'est pas en Crimson Text.

## À faire

1. **Police des champs** : ajouter `font-family: inherit` à `.pnj-search-wrapper input`.
   Vérifier au passage `.sheet-search` (`css/base.css:773`) et appliquer la même correction si
   besoin.
2. **Squelettes** : créer dans `css/base.css` une classe `.skeleton` (bloc aux coins
   `var(--radius-md)`, fond `var(--bg-surface)`, reflet animé qui balaie de gauche à droite en
   dégradé vers `var(--bg-card)`, 1,4 s en boucle). Ajouter deux variantes de forme :
   `.skeleton-line` (hauteur d'une ligne de texte) et `.skeleton-card` (hauteur d'une carte
   de la page concernée). Couleurs **uniquement** par jetons (§5), pour que le thème parchemin
   suive tout seul.
3. **Remplacer le texte de chargement** par quelques squelettes de la forme du contenu attendu :
   lignes de tableau pour PNJs en mode tableau et Aides de Jeux, cartes d'indices pour
   Enquêtes, lignes de vote pour le Calendrier. Garder le texte existant en
   `class="visually-hidden"` (ou l'équivalent déjà présent depuis `L2-09`) dans une zone
   `role="status"`, pour que les lecteurs d'écran l'annoncent toujours.
   Dans `js/pnjs.js:1389` et `js/enquetes.js:144`, le JS réécrit ce texte : adapter pour qu'il
   vise le texte masqué, pas les squelettes.
4. **Apparition du contenu** : le conteneur qui reçoit les données prend une animation
   d'entrée courte (fondu + `translateY(6px)` vers `0`, 200 ms, `var(--ease-out)`), jouée une
   seule fois au premier rendu.

## Ce qu'il ne faut PAS faire

- Construire les squelettes avec des chaînes HTML contenant des données : ils sont statiques,
  mais tout HTML dynamique à côté reste soumis à `esc()` (§3).
- Animer `width` ou `background-position` sur de nombreux éléments : animer un pseudo-élément
  en `transform`, moins coûteux.
- Toucher le graphe (`vis-network`) de la page PNJs : son propre chargement reste tel quel.

## Vérification

- [ ] Console du navigateur vide (aucune erreur, aucune violation de CSP).
- [ ] Les deux thèmes (sombre + parchemin) s'affichent correctement, squelettes compris.
- [ ] Rendu mobile 375 px, menu burger fonctionnel.
- [ ] Service worker : cache vidé avant de conclure.
- [ ] Réseau ralenti (DevTools, « Slow 4G ») : squelettes visibles, puis remplacés sans saut
      de mise en page.
- [ ] Lecteur d'écran (NVDA) : « Chargement… » est toujours annoncé.
- [ ] Mouvement réduit : le reflet ne bouge plus.
- [ ] Les champs de recherche sont en Crimson Text.

## Commit

    feat(ui): squelettes de chargement et police des champs de recherche (D4)

# F-03 — Onglet Principal

> Lire d'abord [`README.md`](README.md), le cahier des charges § 5.1 et la maquette `Main.dc.html`
> (sans les blessures : elles sont hors périmètre).

| | |
|---|---|
| Objectif | Écran de consultation par défaut, tenant sans défilement à 390 × 844 |
| Fichiers | `js/mobile/fiche-model.js`, `js/mobile/views/fiche-detail.js` (ou un module de panneau dédié, ex. `js/mobile/views/fiche-principal.js`), `css/mobile-fiche.css`, `sw.js` si nouveau module, tests |
| Dépend de | F-02 |

## À faire

1. **Destin et Chance, Résilience et Détermination** — deux cartes côte à côte. Valeur maximale
   en texte (« Destin 2 »), valeur courante en jetons pleins/vides (Chance sur Destin, Détermination
   sur Résilience). **Lecture seule** : jetons non interactifs (`<span>`), groupe libellé pour les
   lecteurs d'écran (« Chance : 1 sur 2 »). Valeurs absentes ou non numériques → 0.
2. **Caractéristiques** — grille 5 × 2, ordre CC CT F E I Ag Dex Int FM Soc. Chaque case est un
   `<button>` : abréviation, total, « B<bonus> ». Caractéristique de la carrière actuelle
   (`isCaracInCareer` / `getCareerCaracs` avec `chosenVariants` et `careerOverrides`) : cadre doré
   **et** libellé accessible « …, de carrière » ; une légende courte sous la grille l'explique. Le
   bouton appelle `onOpenCarac(key)` — branché sur le volet en F-04 (en attendant : rien).
3. **Stats dérivées** — une ligne discrète sous la grille : « Mouvement 4 · Blessures max 11 ·
   Corruption 0 » (`js/fiche/derived.js`).
4. **Compétences les plus hautes** — 4 lignes (5 si la place le permet) : nom principal
   (`primarySkillLabel`), abréviation de la caractéristique, total. Sélection par une fonction pure
   `topSkills(data, engine, n)` dans `fiche-model.js` : toutes les compétences de base et avancées,
   total = total de la caractéristique + avances, tri par total décroissant puis nom
   (`localeCompare('fr')`), égalité stable ; les compétences sans avance n'entrent que s'il manque des
   lignes. Lien « Toutes » vers l'onglet Aptitudes.
5. Mise à jour en direct : toute nouvelle donnée du contrôleur re-rend le panneau sans perdre le
   focus de l'élément actif (re-rendu ciblé, ou restauration du focus par clé).

## Tests

`tools/fiche-mobile-principal.test.mjs` : `topSkills` (tri, égalités, nom principal d'une forme
reliée, spécialité de base, compétence avancée), caractéristiques de carrière, jetons en lecture
seule, valeurs manquantes.

## Recette

- [ ] Fixture QA à 390 × 844 : tout l'onglet visible sans défilement.
- [ ] Noms de compétences = noms principaux du référentiel.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): add the character sheet overview tab`

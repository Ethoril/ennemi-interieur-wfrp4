# F-05 — Onglet Aptitudes

> Lire d'abord [`README.md`](README.md) (point 3 sur les référentiels), le cahier des charges § 5.2,
> la maquette `Competences.dc.html` et la section 4 de [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md)
> (« Noms affichés des compétences », « Talents », « Sorts et miracles »).

| | |
|---|---|
| Objectif | Compétences, talents, sorts et miracles en listes denses, recherchables, avec volets |
| Fichiers | `js/mobile/fiche-model.js` (ou `js/mobile/fiche-aptitudes-model.js`), panneau Aptitudes, `css/mobile-fiche.css`, `sw.js` si nouveau module, tests |
| Dépend de | F-04 |

## À faire

### 1. Modèle pur

`skillRows(data, engine)` → lignes `{ key, nom, caracKey, caracAbbr, caracTotal, adv, total,
inCareer, basic, targetId, group, spec }` :

- compétences de base : une ligne par `BASIC_SKILLS`, filtrée comme `buildBasicSkills` du bureau
  (ligne canonique par `entry.id`, spécialité via `basicSpecs`) ;
- compétences avancées : une ligne par `skillsAdvanced[]` ; deux lignes qui pointent la même entrée
  principale **restent séparées** (chacune son `targetId`), comme sur le bureau ;
- nom affiché : `primarySkillLabel(engine.skillResolver, nomStocké)` ; de carrière :
  `isSkillInCareer(...)` avec le résolveur.

`filterSkills(rows, { query, career, trained, carac })` et `sortSkills(rows)` :

- recherche insensible à la casse et aux accents (`stripAccents`), **chaque mot** doit apparaître
  (« resistance alc » trouve « Résistance à l'alcool ») ;
- filtres combinables : Carrière, Entraînées (adv > 0), une caractéristique (puces CC…Soc, choix
  unique, re-toucher désélectionne) ;
- tri : entraînées d'abord, puis les autres ; alphabétique `localeCompare('fr')` dans chaque groupe.

`talentRows(data, engine)` → acquis (nom affiché via `engine.resolveTalent(nom).displayedName` sinon
le nom, nombre de prises) puis disponibles dans la carrière courante non acquis (coût
`talentXpCost(true)`).

### 2. Panneau

- Bascule `Compétences · Talents · Sorts` (boutons `aria-pressed`) ; « Sorts » seulement si
  `sorts.length || prieres.length`. La bascule est mémorisée tant que la vue est montée.
- Compétences : champ de recherche (`type="search"`, libellé), puces de filtres, deux groupes
  titrés « Entraînées · N » et « Non entraînées · N », lignes de 50 px (nom, « Soc 41 · +5 »,
  total) ; point doré **et** libellé accessible pour une compétence de carrière ; message « Aucune
  compétence ne correspond » avec bouton « Effacer les filtres ».
- Toucher une compétence ouvre le volet d'achat (F-04). Pour une compétence à spécialités :
  - compétence de base à spécialité (`basicSpecs`) : champ « Spécialité » dans le volet, enregistré
    par `controller.stagePatch({ 'basicSpecs.<clé>': valeur })` puis `submitPatch()` ;
  - compétence avancée groupée : bouton « Ajouter une spécialité » qui propose les entrées du groupe
    (`publishedSkillRows(engine.skillResolver)`, avec saisie libre) puis ouvre l'achat d'une
    nouvelle ligne (payload sans `targetId`).
- Talents : liste ; toucher un talent ouvre un volet : nom, nombre de prises, description
  (`engine.resolveTalent` ; texte multi-lignes coupé sur `\n`, rendu en paragraphes ; si absente :
  « Aucune description publiée »), achat (F-04). Pas de requête vers Google Sheets.
- Sorts et miracles : consultation (nom, type/domaine, NI, portée, durée, résumé) dans un volet.
  L'apprentissage d'un nouveau sort reste sur le bureau.

### 3. État conservé

Requête, filtres et bascule survivent aux mises à jour des données et aux changements d'onglet
(tant que la vue est montée) ; le focus du champ de recherche n'est pas perdu pendant la saisie.

## Tests

`tools/fiche-mobile-aptitudes.test.mjs` : lignes de base et avancées, formes reliées → nom
principal, lignes doublons conservées, recherche multi-mots sans accents, filtres combinés, tri,
talents acquis et disponibles, onglet Sorts conditionnel.

## Recette

- [ ] « resistance alc » trouve « Résistance à l'alcool ».
- [ ] Achat d'une nouvelle spécialité (ex. Langue) et d'une avance de compétence de base.
- [ ] Description d'un talent sans réseau.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): add searchable skills, talents and spells tab`

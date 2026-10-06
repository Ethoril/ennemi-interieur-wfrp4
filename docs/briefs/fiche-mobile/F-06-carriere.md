# F-06 — Onglet Carrière

> Lire d'abord [`README.md`](README.md), le cahier des charges § 5.3, la maquette `Carriere.dc.html`
> et la section 4 de [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md) (`evaluateCareerCompletion`,
> visionneuse, flux de changement de carrière, payloads `rank`).

| | |
|---|---|
| Objectif | Suivre l'achèvement du rang, acheter le rang suivant, changer de carrière |
| Fichiers | modèle (`js/mobile/fiche-model.js` ou `fiche-career-model.js`), panneau Carrière, `js/fiche/career-viewer.js` (option d'ouverture directe), `css/mobile-fiche.css`, `sw.js`, tests |
| Dépend de | F-04 |

## À faire

1. **Carte du rang** — carrière, titre du rang (variante choisie), statut, rang.
2. **Trois jauges** depuis `engine.evaluateCareerCompletion(data, career, rang)` :
   caractéristiques à `5 × rang` (n / total, avec « Soc +3 sur 5 » pour les manquantes) ;
   compétences de carrière à `5 × rang` (n / 8, liste de ce qui manque avec les avances actuelles,
   noms principaux) ; talent du rang (0 ou 1 / 1, nom du talent acquis). Barre décorative
   (`aria-hidden`), valeur en texte. Rang 5 atteint : « Rang maximal ».
3. **Rang suivant** — bouton « Passer au rang N+1 — C XP » avec
   `C = careerRankXpCost(completion.complete)` ; une ligne explique « 100 XP une fois le rang achevé,
   200 XP sinon ». Achat par le volet de F-04 (confirmation par le seul bouton, mêmes règles hors
   ligne / XP insuffisante / erreurs / reprise). Payload
   `{ kind: 'rank', rankMode: 'advanceRank', targetRank, count: 1, expectedCost, catalogVersion }`.
4. **Aperçu du rang suivant** — `<details>` replié : titre, statut, caractéristiques, compétences
   (noms principaux, `primarySkillLabel(resolver, item, true)`), talents.
5. **Changer de carrière** — bouton qui ouvre un volet : recherche dans les carrières
   (`careers.json`, insensible aux accents), rang d'entrée (1 à 5), prérequis affichés et vérifiés
   avec la même règle que le serveur (`commands.js`, `career.prereq`) : une carrière inaccessible
   est listée mais désactivée avec la raison. Coût `careerRankXpCost(completion.complete)` sur la
   carrière actuelle. Payload `{ kind: 'rank', rankMode: 'changeCareer', careerId, targetRank,
   count: 1, expectedCost, catalogVersion }`.
6. **Toutes les carrières** — lien qui ouvre la visionneuse existante en plein écran. Ajouter à
   `createCareerViewer` une méthode `openModal()` (ou une option) **sans changer son comportement
   bureau** ; `tools/fiche-career-viewer.test.mjs` doit rester vert et couvrir la nouvelle entrée.
   Surcharge plein écran dans `css/mobile-fiche.css` uniquement (`.m-app .career-viewer-modal`).
7. **Historique** — `data.careers` (nom principal, rang) puis la carrière en cours marquée « en
   cours ».

## Tests

`tools/fiche-mobile-carriere.test.mjs` : jauges depuis des fiches témoins (rang achevé, incomplet,
rang 5), coût du rang, filtrage des prérequis identique au serveur (comparer avec
`engine.applyCommand` sur un cas accepté et un cas refusé), payloads.

## Recette

- [ ] Fixture QA : achat du rang 2 et changement de carrière ; journal et en-tête mis à jour.
- [ ] Visionneuse en plein écran, fermeture au clavier, focus rendu.
- [ ] Bureau : visionneuse de carrière inchangée.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): add career progress and rank purchases`

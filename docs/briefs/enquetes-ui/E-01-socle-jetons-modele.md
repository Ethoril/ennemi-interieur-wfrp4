# E-01 — Socle : jetons, hiérarchie des boutons, menu ⋯, modèle de vue

> Lire d'abord [`README.md`](README.md) (§ 2 à 4). Aucune mise en page nouvelle ici : on prépare
> les briques que E-02 à E-06 assemblent. L'écran doit rester utilisable tel quel à la fin du brief.

| | |
|---|---|
| Objectif | Poser les jetons CSS, les variantes de bouton, un menu d'actions accessible et le modèle de vue pur |
| Fichiers | `css/enquetes-workspace.css`, `js/enquetes-workspace.js`, **nouveaux** `js/enquetes-view-model.js`, `js/enquetes-menu.js`, `tools/enquetes-ui-model.test.mjs`, `tools/fixtures/enquetes-qa.js`, `package.json`, `sw.js` |
| Dépend de | — |

## À faire

1. **CSS lisible** — reformater `css/enquetes-workspace.css` sur plusieurs lignes (une règle par
   bloc, commentaires de section). C'est le seul reformatage autorisé du lot : il le rend
   maintenable. Ne changer aucun rendu dans ce même commit… sauf les points 2 et 3.
2. **Jetons** — déclarer sur `.enq-workspace` les variables du § 3 du README et remplacer les
   couleurs en dur existantes (`#946d37`, `#ad8649`, `rgba(145,112,65,.35)`…) par ces jetons.
3. **Variantes de bouton** — ajouter `enq-button--primary`, `--quiet`, `--danger` et
   `enq-icon-button`. Dans `enquetes-workspace.js`, étendre l'aide `button(label, action)` par un
   troisième argument optionnel `variant` (`'primary' | 'quiet' | 'danger'`) qui ajoute la classe,
   sans changer les appels existants. Appliquer dès maintenant : « Enregistrer » de l'éditeur et
   « Nouvelle … » en `primary` ; « Retirer le lien », « Mettre en corbeille », « Purger
   définitivement » en `danger`.
4. **Menu d'actions** — `js/enquetes-menu.js` exporte `createActionMenu({ documentRef, label,
   items })` → `{ element, close }`. `items = [{ label, action, variant?, hidden? }]`. Bouton
   `enq-icon-button` « ⋯ » (`aria-label` = `label`, `aria-haspopup="menu"`, `aria-expanded`),
   liste `role="menu"` d'éléments `role="menuitem"`. Clavier : Entrée/Espace ouvre et place le
   focus sur le premier élément, flèches haut/bas, Échap ferme et rend le focus au bouton, clic
   extérieur ferme. Pas de `<style>` injecté ; positionnement en CSS (`position:absolute` sous le
   bouton, aligné à droite). Les erreurs d'`action` passent par le `showError` existant
   (l'appelant enveloppe).
5. **Modèle de vue** — `js/enquetes-view-model.js`, fonctions pures (aucun accès DOM, aucune
   mutation des entrées) :
   - `buildLinksIndex(records)` → `Map<id, Set<id>>` (extraire la logique de `mount`) ;
   - `countSpaces(records)` → `{ enquetes, documents, notes }` (enquêtes non archivées) ;
   - `countStates(records)` → `{ Ouverte, 'En pause', Résolue, archive }` ;
   - `dossierSummary(enquete, records, pnjs, index)` → `{ pieces, pnjs, notes, lastSession }` ;
   - `dossierPieces(enquete, records, index)` → `[{ record, numero, relations: [{ nature,
     autreNumero }] }]` : ordre `enquete.ordre` puis les autres pièces liées (même règle que
     `renderRelated`), relations limitées aux pièces du dossier ;
   - `dossierPnjs(enquete, records, pnjs)` → `[{ pnj, role, lien }]` ;
   - `dossierTimeline(enquete, records)` → événements triés par `ordre` ;
   - `linkedNotes(target, records, index)` et `isUnclassified(note, records)` ;
   - `pieceContext(documentId, enquete, records, index)` → `{ numero, total, precedent, suivant }`
     ou `null`.
   Brancher `renderRelated` et le calcul de `linksIndex` sur ces fonctions (comportement identique).
6. **Fixture enrichie** — remplacer les données de `tools/fixtures/enquetes-qa.js` par celles des
   maquettes (3 enquêtes ouverte / en pause / résolue + 1 secrète MJ, 4 documents dont une
   contribution personnelle, 2 notes dont une non classée, 2 PNJ avec rôles « Suspect » et
   « Destinataire présumé », 1 relation « Appuie », 2 événements). Ajouter `?role=joueur`
   (défaut `mj`) pour voir les deux profils. Ajouter `css/base.css`, `css/components.css` et les
   polices dans `enquetes-qa.html` pour que la recette soit fidèle.
7. `package.json` : ajouter `tools/enquetes-ui-*.test.mjs` à `check` et `test:enquetes`.
   `sw.js` : ajouter les deux nouveaux modules à `ASSETS_LOCAUX`.

## Tests

`tools/enquetes-ui-model.test.mjs` : chaque fonction du modèle sur la fixture (numérotation avec
ordre partiel, pièce liée hors ordre, relation hors dossier ignorée, note non classée, dernier
événement, compteurs avec archives et zone `mj` filtrée côté joueur). Menu : ouverture, Échap,
focus rendu, sur le faux DOM de `tools/enquetes-workspace.test.mjs` (réutiliser sa classe
`Element` en l'étendant si besoin, sans casser les tests existants).

## Recette

- [ ] Fixture : l'écran fonctionne comme avant ; boutons principal / danger distincts.
- [ ] `npm run check`, `npm run lint`, `npm run test:enquetes` verts.

## Commit

`refactor(enquetes): add design tokens, button variants, action menu and view model`

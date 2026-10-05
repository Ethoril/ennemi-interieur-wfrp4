# F-04 — Feuille basse et achat d'avances

> Lire d'abord [`README.md`](README.md), le cahier des charges § 5.5, la maquette `Achat.dc.html`
> (rendu de `Competences.dc.html` avec la feuille ouverte) et la section 3 de
> [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md) (payloads `purchase`, erreurs, reprise).

| | |
|---|---|
| Objectif | Acheter des avances de caractéristique et de compétence, et un talent, depuis un volet |
| Fichiers | nouveaux `js/mobile/components/bottom-sheet.js`, `js/mobile/fiche-purchase.js` ; `js/mobile/views/fiche-detail.js` (ou panneaux), `css/mobile-fiche.css`, `sw.js`, tests |
| Dépend de | F-03 |

## À faire

### 1. Composant `bottom-sheet.js`

Réutilisable par F-05 et F-06. Construit sur `<dialog>` + `createDialogController` (`ui.js`) :
focus piégé, Échap, clic sur le fond, retour du focus au déclencheur. Poignée en haut ; glisser vers
le bas (pointer events sur la poignée et l'en-tête, transformation par CSSOM) au-delà d'un seuil
ferme le volet. Ouverture/fermeture glissées, neutralisées par `prefers-reduced-motion`. API
`createBottomSheet({ documentRef, labelledBy })` → `{ open({ trigger, render }), update(render),
close(), isOpen(), destroy() }`. Hauteur max `min(90dvh, 40rem)`, contenu défilant.

### 2. Calcul pur `js/mobile/fiche-purchase.js`

Sans DOM, testé :

- `purchaseTarget(data, engine, { kind: 'carac' | 'skill' | 'talent', ... })` → description
  affichable : nom principal, nature (de base / avancée / de carrière), caractéristique et sa
  valeur, avances actuelles, total, `inCareer`, `targetId` à envoyer (clé `BASIC_SKILLS.nom` pour
  une compétence de base, `skillsAdvanced[].id` pour une ligne avancée — voir la carte).
- `purchasePreview(target, count, balance)` → `{ cost, newTotal, after, affordable }` avec
  `xpBandCost(CARAC_XP_BANDS|SKILL_XP_BANDS, adv, count, inCareer)` et `talentXpCost(inCareer)`.
- `purchasePayload(target, count, engine)` → payload `purchase` exact (`kind`, `name`, `targetId`
  si utile, `count`, `expectedCost`, `catalogVersion: engine.catalogVersion`).
- `purchaseErrorMessage(error)` → texte en français pour `insufficient-xp`, `price-changed`
  (« Le coût a changé : N XP. Vérifiez et réessayez. »), `catalog-version-unsupported`, `aborted`
  / conflit, `permission-denied`, réseau, inconnu.

Un test vérifie, pour plusieurs cibles (caractéristique de carrière ou non, compétence de base,
compétence avancée, forme reliée, talent en ou hors carrière), que le coût prévu égale celui que
`engine.applyCommand` accepte sans `price-changed`.

### 3. Volet

- Titre, nature, total en grand ; calcul en clair « Sociabilité 41 + 5 avances = 46 ».
- Sélecteur − / + du nombre d'avances (1 à 10 ; talent : pas de sélecteur), annoncé
  (`role="status"`) ; trois valeurs : nouveau total, coût, XP restante.
- Mention « Tarif carrière » ou « Hors carrière : coût doublé ».
- Bouton unique « Acheter pour N XP » : désactivé si XP insuffisante (raison affichée) ou hors
  ligne (« Achat possible une fois en ligne »). Pendant l'envoi : désactivé, libellé « Achat en
  cours… ». Succès : volet fermé, annonce « Charme : +2 avances achetées », focus rendu au
  déclencheur. Échec : message d'erreur dans le volet, valeurs inchangées.
- Si `state.pendingOperationId` (réponse incertaine) : bouton « Réessayer » qui appelle
  `controller.retryPendingCommand()` — pas de nouvel achat (pas de double débit).
- Le rôle `mj` peut acheter comme un joueur ; aucune commande `gain`/`correct` dans le volet.

### 4. Branchements

- Onglet Principal : toucher une caractéristique ouvre son volet.
- Le volet de compétence et celui de talent sont appelés depuis Aptitudes (F-05) : exposer les
  fonctions d'ouverture.

## Tests

`tools/fiche-mobile-purchase.test.mjs` (calculs, payloads, accord avec le moteur, messages) ;
`tools/fiche-mobile-sheet.test.mjs` (faux DOM : ouverture, Échap, retour du focus, bouton désactivé
hors ligne).

## Recette

- [ ] Fixture QA : achat de 2 avances de Charme, d'1 avance de CT et d'un talent : le journal et les
      totaux se mettent à jour, le coût débité est celui affiché.
- [ ] Hors ligne : achat impossible, raison visible.
- [ ] « Achat refusé » (fixture) : message clair, rien de débité.
- [ ] Clavier : Tab reste dans le volet, Échap ferme, focus rendu.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): buy characteristic and skill advances from a bottom sheet`

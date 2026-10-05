# F-07 — Onglet Journal, possessions et export

> Lire d'abord [`README.md`](README.md), le cahier des charges §§ 5.4 et 6, la maquette
> `Journal.dc.html` et les sections 3 et 5 de [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md).

| | |
|---|---|
| Objectif | Consulter l'XP, éditer possessions et notes, exporter la fiche |
| Fichiers | modèle (`js/mobile/fiche-model.js`), panneau Journal, nouveau `js/fiche/export-import.js` (pur), menu ⋯ de `fiche-detail.js`, `css/mobile-fiche.css`, `sw.js`, tests |
| Dépend de | F-02 |

## À faire

1. **Bascule** `Expérience · Possessions et notes` (boutons `aria-pressed`).
2. **Expérience** — trois chiffres : gagnée, dépensée, libre (`xpBalance`). Historique
   antéchronologique avec `xpLogRows(data, engine)` (modèle pur) : libellé (achat : `achat` ou
   `targetNom` avec noms principaux pour les compétences ; gain : `raison`), nature (Gain, Achat ·
   type, Annulation, Correction MJ), montant signé (+ pour un gain). Entrées annulées visiblement
   barrées **et** suffixées « (annulé) ». Entrées historiques sans `kind` prises en charge. Pas
   d'ajout de gain, pas de correction (MJ, bureau).
3. **Annuler le dernier achat** — si le joueur a un dernier achat annulable (même règle que le
   serveur : son dernier achat non annulé), bouton discret « Annuler cet achat » sur cette ligne,
   avec confirmation dans un volet, puis `executeOnlineCommand('cancel', { purchaseId })`. Mêmes
   règles hors ligne et d'erreur qu'en F-04.
4. **Possessions et notes** — `<textarea>` libellé, enregistrement par `controller.stagePatch({
   possessions })` puis `submitPatch()` après une pause de saisie (≈ 800 ms) et à la perte du focus.
   Indicateur d'état : « Enregistré », « Modification en attente de connexion », « Conflit » ; en
   cas de conflit, choix « Garder ma version » / « Prendre celle du serveur »
   (`resolveConflict('possessions', 'local'|'server')`). Le brouillon local du contrôleur protège la
   saisie hors ligne.
5. **Export / import** — extraire de `js/fiche.js` vers `js/fiche/export-import.js` (pur, **non**
   synchronisé vers `functions/`) : `buildFicheExport(data, { charId, appVersion, exportedAt })` et
   `parseFicheImport(text)` (validation `_format`, filtrage des clés `EXPORT_KEYS`). **Ne pas
   modifier `js/fiche.js`** : le bureau garde son code ; un test vérifie que les deux produisent le
   même objet sur une fiche témoin. Menu ⋯ :
   - « Exporter la fiche » (tous les rôles) : `Blob` JSON + lien de téléchargement
     `fiche-<id>-<AAAA-MM-JJ>.json`.
   - « Importer une fiche » : **MJ seulement** (le serveur réserve `import` au MJ) ; fichier choisi,
     motif obligatoire (≥ 3 caractères) dans un volet, `migrateFicheDocument` puis
     `executeOnlineCommand('import', { reason, data })`.

## Tests

`tools/fiche-mobile-journal.test.mjs` : soldes, ordre, libellés et natures (dont entrées
historiques et annulations), dernier achat annulable, export identique au bureau, import refusé
pour un format invalide.

## Recette

- [ ] Fixture QA : solde exact après plusieurs achats et une annulation.
- [ ] Possessions saisies hors ligne puis envoyées au retour du réseau.
- [ ] Export lisible par l'import du bureau.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): add the experience journal, notes and export`

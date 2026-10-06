# F-01 — Nom et race réservés au MJ

> Lire d'abord [`README.md`](README.md) et la section 6 de [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md).

| | |
|---|---|
| Objectif | Seul le MJ modifie `nom` et `race` d'une fiche, partout |
| Fichiers | `functions/src/fiche/service.mjs`, `functions/test/fiche-service.test.mjs`, `js/fiche.js` (`setFicheRole` uniquement) |
| Dépend de | — |

## Pourquoi

Décision projet (cahier des charges § 6) : les valeurs de base du personnage sont réservées au MJ.
La base des caractéristiques l'est déjà (commande `correct`). `nom` et `race` sont encore modifiables
par un joueur via la commande `patch` (`PATCH_FIELDS`). C'est la seule modification visible admise
sur le bureau.

## À faire

1. **Serveur** — dans `executeFicheCommand` de `functions/src/fiche/service.mjs`, juste après
   `ensureAuthorized(...)` et `validatePrivilegedPayload(...)`, **avant** le rejeu d'un reçu
   antérieur : si `command.type === 'patch'`, que le rôle n'est pas `mj` et qu'un chemin de
   `command.payload.changes` vaut `nom` ou `race`, échouer avec
   `fail('champ réservé au MJ', 'permission-denied', { kind: 'field-forbidden', path })`.
   Le patch est refusé en bloc : aucune écriture partielle. Ne pas toucher à `validatePatchPayload`
   (appelé avant de connaître le rôle) ni à `PATCH_FIELDS` (le MJ continue de patcher ces champs).
2. **Tests serveur** — adapter les tests existants où `PLAYER` patche `nom`/`race` (la carte en
   liste les lignes) : utiliser `MJ`, ou un autre champ (`possessions`, `destin`) quand le test vise
   la fusion ou les conflits. Ajouter : joueur refusé sur `nom` ; joueur refusé sur `race` ; patch
   joueur mixte `nom` + `possessions` refusé sans écriture ; MJ accepté sur `nom` et `race` ; joueur
   accepté sur `possessions`.
3. **Bureau** — dans `setFicheRole` (`js/fiche.js`), pour le rôle `joueur`, retirer `#nom` et
   `#race` de la liste des contrôles réactivés : ils restent désactivés. Aucun autre changement de
   `js/fiche.js`. Les rôles `mj` et `readonly` sont inchangés.
4. Pas de changement de version ni de `CHANGELOG` (F-08).

## Recette

- [ ] `npm --prefix functions test` vert, nouveaux cas compris.
- [ ] `npm run check` et `npm run lint` verts.
- [ ] Fixture `tools/fixtures/fiche-qa.html` : « Simuler joueur » → Nom et Race désactivés ;
      « Simuler MJ » → modifiables.

## Commit

`feat(fiche): reserve name and race edits to the GM`

# F-08 — Clôture et livraison v2.32.0

> Lire d'abord [`README.md`](README.md), le cahier des charges §§ 7 à 10 et la section 10 de
> [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md).

| | |
|---|---|
| Objectif | Finitions transverses et préparation de la version livrée |
| Fichiers | `css/mobile-fiche.css`, vues fiche, `js/layout.js`, `sw.js`, `app/index.html`, `CHANGELOG.md`, tests à version codée en dur, `docs/FICHE-MOBILE.md` |
| Dépend de | F-01 à F-07 |

## À faire

1. **Thème parchemin** — vérifier chaque écran et volet en `data-theme="parchment"` ; contrastes
   ≥ 4,5:1 (texte) et 3:1 (bordures porteuses d'information, jetons, cadre de carrière) dans les
   deux thèmes. Corriger dans `css/mobile-fiche.css` uniquement (surcharges `[data-theme="parchment"]`
   comme `mobile-app.css`).
2. **Accessibilité** — passe complète : titres hiérarchisés par onglet, libellés des boutons
   icône, annonces (onglet, achat, erreur), focus visible, ordre de tabulation, volets modaux,
   zoom texte 200 % sans perte, 320 px sans défilement horizontal.
3. **Animations** — volets glissants et transition d'onglet sobre (fondu court) ; tout neutralisé
   par `prefers-reduced-motion`.
4. **Tablette / paysage** — colonne centrée `--m-content-width`, barre d'onglets alignée.
5. **Version** — `v2.32.0` dans `js/layout.js`, `sw.js`, `<meta name="app-version">` de
   `app/index.html` et les tests à version codée en dur (`tools/m3-04-release.test.mjs`,
   `m5-03`, `m6-03`, `m7-01` — voir le commit 28b4d2d pour le geste exact). Vérifier que
   `ASSETS_LOCAUX` contient chaque nouveau fichier.
6. **CHANGELOG** — entrée `## [2.32.0] - <date>` dans le style des entrées existantes (phrases
   orientées joueur) : fiche mobile dans l'application (onglets, achats, carrière, journal), nom et
   race réservés au MJ, lien « Ancienne fiche » conservé temporairement.
7. **Cahier des charges** — cocher dans `docs/FICHE-MOBILE.md` ce qui est livré ; noter les écarts.

## Recette complète (critères d'acceptation du cahier des charges § 10)

- [ ] Principal sans défilement à 390 px.
- [ ] Bureau inchangé à 1280 px, hormis nom/race désactivés en session joueur.
- [ ] Achats compétence, caractéristique, talent, rang : bon débit, journal à jour ; hors ligne
      désactivés.
- [ ] Joueur : ni gain, ni correction, ni modification nom/race/base ; refus serveur testé.
- [ ] Recherche « resistance alc ».
- [ ] Deux thèmes, clavier, lecteur d'écran.
- [ ] Retour, rechargement, lien profond.
- [ ] `npm run check`, `npm run lint`, `npm --prefix functions test` verts.

## Commit

`feat(mobile): deliver the mobile character sheet v2.32.0`

# E-04 — Pièce ouverte : visionneuse et annotations

> Lire d'abord [`README.md`](README.md) et la maquette `maquettes/02-bureau-piece`. Ce brief
> concerne le détail d'un **document** (`type === 'documents'`) ; les notes gardent un rendu
> simple (titre, texte, liens, actions en menu ⋯).

| | |
|---|---|
| Objectif | Séparer clairement l'objet (fichier, épingles) et sa fiche (texte, annotations, liens) |
| Fichiers | `js/enquetes-workspace.js` (ou nouveau `js/enquetes-piece-view.js`), `css/enquetes-workspace.css`, `sw.js` si nouveau fichier, tests |
| Dépend de | E-03 |

## À faire

1. **Contexte de dossier** — mémoriser dans la vue l'enquête depuis laquelle la pièce a été
   ouverte (`contextDossier`, effacé en changeant d'espace). Si présent : fil d'Ariane
   « ‹ Titre du dossier / Pièce n° 1 sur 3 » et boutons précédente / suivante (`pieceContext`),
   `aria-label` « Pièce précédente » / « Pièce suivante ». Sans contexte : pas de numéro, retour à
   la liste des pièces.
2. **Disposition** — sur bureau, la pièce occupe dossier + carnet (le carnet se replie en bouton
   « Mon carnet » dans le fil d'Ariane, qui le rouvre en panneau latéral). Deux colonnes
   `minmax(0,1.25fr) minmax(0,1fr)` : à gauche la **visionneuse** (fond très sombre à hachures
   discrètes), à droite la **fiche** sur fond `--enq-paper`. Sous 1100 px : l'une sous l'autre.
3. **Visionneuse** :
   - barre : bouton bascule « Mode annotation » (`aria-pressed`), aide courte à côté quand actif,
     puis « Agrandir » et « Télécharger » (lien `download` existant) ;
   - image centrée, ombre ; **le clic ne crée une annotation qu'en mode annotation** (aujourd'hui
     tout clic en crée une : c'est le changement de comportement voulu). Hors mode, clic = agrandir ;
   - **épingles numérotées** : disque 30 px or, bordure claire, numéro = rang de l'annotation
     sur ce fichier (tri stable : ordre de `records`). Annotation privée : épingle gris-bleu.
     Zone (`width`/`height`) : rectangle translucide + épingle dans son coin. Chaque épingle est un
     `<button>` `aria-label="Annotation n : texte"` ; clic → met en évidence la ligne
     correspondante dans la fiche (et inversement au survol/focus de la ligne). Positionnement par
     CSSOM comme aujourd'hui (`marker.style.left/top`) ;
   - PDF : `<iframe>` actuel dans la visionneuse ; texte/markdown : `textView` sur fond papier ;
   - **bande des fichiers** sous l'image : vignettes (fichier courant entouré d'or), case « + »
     pour ajouter (l'`<input type=file>` actuel, masqué derrière ce bouton), légende
     « nom · version n · k fichiers sur 10 », lien « Remplacer ce fichier ». Mêmes contrôles de
     droits et limite de 10 qu'aujourd'hui.
4. **Fiche** (fond parchemin, encre `--enq-ink`) :
   - ligne haute « PIÈCE N° 1 · LETTRE » (ou « LETTRE » sans contexte) + pastille d'audience
     « Pièce reçue · visible du groupe » / « Contribution · personnel » ;
   - titre Cinzel 30 px ; `description` et `provenance` en italique ; `texte` en `textView`
     (titres, listes, citation avec filet `--enq-wax`) ;
   - **Annotations** : liste numérotée alignée sur les épingles, mention Commune / Privée,
     actions Modifier / Supprimer / Partager une copie dans un menu ⋯ par ligne ;
     « Voir la version annotée » conservé quand le fichier d'une annotation n'est pas affiché ;
   - **Liée à** : puces des enquêtes (pastille d'état), PNJ (avec rôle) et relations
     (« Appuyée par la pièce n° 2 » en vert, « Contredite par … » en ambre), puce « + Relier » ;
   - pied : action principale sombre « Noter dans mon carnet » (note liée à la pièce),
     « Modifier » (si `canEdit`), menu ⋯ : Publier dans le groupe / Rendre secret / Masquer chez
     son auteur (selon droits actuels), Partager une copie (note), Exporter, Voir l'historique,
     Mettre en corbeille (`danger`).
5. **Agrandir** : la `<dialog>` actuelle, plein écran sombre, avec les épingles en surimpression
   et fermeture « Fermer » + Échap ; le focus revient au bouton.

## Tests

Clic sur l'image hors mode annotation n'ouvre pas l'éditeur ; en mode annotation il l'ouvre avec
`x`/`y` normalisés ; numérotation des épingles stable ; précédente/suivante suivent `pieceContext`
et disparaissent sans contexte ; toutes les actions de visibilité de l'ancien détail restent dans
le menu selon les mêmes conditions (`canEdit`, `isGm`, zone).

## Recette

- [ ] Fixture : comparer avec `maquettes/02-bureau-piece.png` (image + 2 annotations).
- [ ] Ajouter, remplacer un fichier ; annoter ; agrandir ; navigation pièce 1 → 2 → 3.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(enquetes): evidence viewer with numbered pins and parchment sheet`

# E-03 — Bureau : le dossier ouvert

> Lire d'abord [`README.md`](README.md) et la maquette `maquettes/01-bureau-dossier` (colonne
> centrale). C'est le brief qui porte l'élément signature : fiches de parchemin et cachet de cire.

| | |
|---|---|
| Objectif | Remplacer le détail d'une enquête (`renderDetail` pour `type === 'enquetes'`, `renderRelated`, `renderTimeline`, `renderLinks`) par la vue dossier |
| Fichiers | `js/enquetes-workspace.js` (ou nouveau `js/enquetes-dossier-view.js` appelé par lui), `css/enquetes-workspace.css`, `sw.js` si nouveau fichier, tests |
| Dépend de | E-02 |

## À faire

1. **En-tête du dossier** (grille `76px 1fr`) :
   - **Cachet de cire** : disque 76 px, dégradé radial `--enq-wax`, liseré pointillé intérieur,
     rotation −8°, libellé de l'état en capitales (« OUVERTE », « EN PAUSE », « RÉSOLUE »).
     Teinte : cire rouge pour Ouverte, gris-bleu désaturé pour En pause, vert sombre pour Résolue.
     `role="img"` + `aria-label="État : …"`. Archivé : mention « Archivée » à côté de l'eyebrow.
   - Eyebrow : « Dossier d'enquête · visible du groupe » / « · secret MJ » / « · personnel ».
   - Titre `<h3>` actuel conservé (le focus de `revealDetail` le vise) mais stylé en grand
     (Cinzel 34 px). Ne pas le transformer en `<h1>` (le `<h1>` est celui de la page).
   - **Épigraphe** : `question` en italique 21 px entre « », couleur parchemin clair ;
     `description` en dessous, plus discrète, si présente.
   - Étiquettes `#secte` en petites puces.
   - **Barre d'actions** (ligne sous le titre) : bascule `role="tablist"` « Dossier · Tableau des
     liens » ; action principale `primary` « Ajouter une pièce » (ouvre l'éditeur de document lié,
     comme « Ajouter un document au dossier ») ; menu ⋯ (`createActionMenu`) avec, selon les
     droits actuels : Modifier, Relier un objet, Ajouter une relation, Ordonner les pièces (MJ),
     Publier / Rendre secret (MJ), Exporter, Voir l'historique, Mettre en corbeille (`danger`).
     Aucune de ces actions ne disparaît ; « Ajouter une note » part dans la colonne carnet.
2. **Pièces du dossier** (`dossierPieces`) — intitulé de section en capitales or + mention
   « ordre fixé par le MJ » si `ordre` non vide. Grille `repeat(auto-fill, minmax(200px,1fr))`.
   Chaque **fiche** est un `<button>` (ou lien) `enq-slip` qui ouvre la pièce (`openObject`) :
   - fond `--enq-paper`, texte `--enq-ink`, ombre portée, rotation alternée −0,6° / +0,5° / −0,3°
     (classe selon l'index ; 0° sous `prefers-reduced-motion`), soulèvement de 2 px au survol ;
   - ligne haute : « PIÈCE N° n » (Cinzel 11 px, `--enq-wax`, `white-space:nowrap`) à gauche,
     catégorie en capitales à droite ;
   - titre (Cinzel 18 px) ; extrait de `description` ou `texte` (2-3 lignes, `line-clamp`) ;
   - si le premier fichier est une image : vignette (via `client.objectUrl`, libérée dans
     `release()` comme les autres poignées) ; sinon rien ;
   - pied : « 1 fichier · 2 annotations », « Contribution · auteur » si `origine === 'contribution'`,
     badge vert « Appuie la pièce n° 1 » / ambre « Contredit … » / neutre « Complète … » /
     « Renvoie à … » pour chaque relation interne ;
   - badges « Secret MJ » / « Personnel » si la zone diffère de celle du dossier.
   Dernière case : bouton en pointillés « Verser une pièce » (même action que l'action principale).
   Glisser-déposer un fichier dessus : **hors périmètre** (le libellé « ou glisser un fichier ici »
   de la maquette n'est à afficher que si on l'implémente ; sinon l'omettre).
3. **Personnages** (`dossierPnjs`) — cartes horizontales : médaillon d'initiales (ou portrait si
   une URL publique simple est déjà disponible dans `state.pnjs`, sinon initiales), nom, rôle
   (`--enq-suspect` pour « Suspect », sinon secondaire). Clic → `onOpenPnj`. Bouton secondaire
   « Relier un personnage » (ouvre `openLinkEditor` filtré sur les PNJ). « Retirer le lien » va dans
   un petit menu ⋯ de la carte si `canEdit(lien)`.
4. **Chronologie** (`dossierTimeline`) — `<ol>` avec trait vertical or et pastilles (pleine pour
   le dernier événement, creuse sinon) ; surtitre en capitales « REPÈRE · SESSION », titre, texte
   (`textView`). Mention « privé » pour les événements `user:`. Modifier / Retirer dans un menu ⋯
   par événement. Bouton « Ajouter un événement ».
   Personnages et chronologie côte à côte (`minmax(0,1fr) minmax(0,1.3fr)`) sous les pièces ;
   l'un sous l'autre sous 1100 px.
5. **Fin des doublons** : la section « Liens » générique n'est plus affichée pour une enquête
   (pièces → section Pièces, PNJ → Personnages, notes → carnet). Les liens vers d'autres
   enquêtes, s'il y en a, s'affichent en une ligne « Dossiers liés : … ». « Relations entre
   pièces » disparaît comme section : les relations sont les badges des fiches (l'édition passe
   par le menu ⋯ → Ajouter une relation, et par la pièce en E-04).
6. **Tableau des liens** — la bascule affiche le graphe existant (`showGraph`) à la place des
   sections, en pleine largeur, hauteur 560 px, sans bouton « Afficher le graphe ». Nœuds colorés
   par type (pièce = parchemin, PNJ = or, note = gris-bleu), étiquettes lisibles sur fond sombre.
   « Enregistrer ma disposition » reste, en bouton secondaire au-dessus du graphe. Retour à
   « Dossier » arrête la simulation (`graph.stop()`).
7. **Conclusion** (dossier résolu) : encadré « Conclusion » en tête des sections, texte en
   `textView`.

## Tests

Modèle déjà couvert en E-01 ; ajouter des tests de vue : une fiche par pièce avec le bon numéro,
le menu ⋯ ne propose que les actions autorisées (joueur vs MJ, zone `user:`), aucune section
« Liens » sur une enquête, la bascule Tableau appelle puis arrête le graphe, les vignettes sont
libérées au changement de dossier (compter les `release`).

## Recette

- [ ] Fixture MJ et joueur : comparer avec `maquettes/01-bureau-dossier.png`.
- [ ] Toutes les actions de l'ancien détail sont atteignables (cocher la liste du point 1).
- [ ] `prefers-reduced-motion` : fiches droites, aucun soulèvement animé.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(enquetes): dossier view with evidence slips, cast and timeline`

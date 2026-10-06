# E-02 — Bureau : trois colonnes et colonne des dossiers

> Lire d'abord [`README.md`](README.md) et la maquette `maquettes/01-bureau-dossier` (colonne de
> gauche et structure générale). Le contenu du dossier (colonne centrale) est traité en E-03 : ici
> il garde son rendu actuel, simplement placé dans la nouvelle colonne.

| | |
|---|---|
| Objectif | Structure en trois colonnes, colonne de navigation efficace, en-tête de page compact |
| Fichiers | `js/enquetes-workspace.js`, `css/enquetes-workspace.css`, `enquetes.html`, `js/enquetes-workspace-bureau.js`, tests |
| Dépend de | E-01 |

## À faire

1. **Option de disposition** — `createEnqueteWorkspaceView({ …, layout = 'desktop' })`, valeurs
   `'desktop' | 'mobile'`, posée en classe `enq-workspace--desktop` / `--mobile` sur la racine.
   Le bureau passe `'desktop'` explicitement ; `js/mobile/app.js` n'est pas modifié avant E-05
   (il reçoit la valeur par défaut : vérifier en recette que le mobile reste utilisable, le
   rendu empilé actuel étant acceptable jusqu'à E-05 grâce aux points de rupture ci-dessous).
2. **En-tête de page** — `enquetes.html` : garder le `<h1>` (repère de page) mais en version
   compacte (classe `page-header--compact` définie dans `css/enquetes-workspace.css` : titre
   ~1.6 rem, pas d'ornement, marge réduite ; le sous-titre passe en `visually-hidden`). Supprimer
   le `<h2>Documents et enquêtes</h2>` de la barre d'outils du composant (titre en double).
3. **Grille** — `.enq-panes` devient `rail | dossier | carnet` :
   `grid-template-columns: 316px minmax(0,1fr) 320px` à partir de 1280 px ; de 900 à 1279 px le
   carnet passe sous le dossier ; sous 900 px, une colonne. La colonne carnet est un `<aside>`
   (`aria-labelledby` sur son titre « Mon carnet »), remplie en E-06 ; d'ici là elle affiche les
   notes liées à l'objet ouvert (`linkedNotes`) en lecture et le bouton « Nouvelle note ».
4. **Colonne de gauche (rail)**, de haut en bas :
   - **Sélecteur d'espace** à la place des quatre boutons de la barre : contrôle segmenté
     `role="tablist"` « Dossiers N · Pièces N · Carnet N » (`countSpaces`). Corbeille sortie du
     sélecteur (voir pied du rail). Garder la confirmation « Conserver le brouillon… » existante.
   - **Recherche** : champ avec icône loupe (SVG inline, `aria-hidden`), libellé visible pour les
     lecteurs d'écran (`visually-hidden`), placeholder « Pièce, PNJ, note… ». Raccourci `/` qui
     place le focus dans le champ, sauf si le focus est déjà dans un champ de saisie. Conserver la
     restauration du focus et de la sélection existante dans `renderList`.
   - **Filtres en puces** (`button` + `aria-pressed`) à la place de la liste déroulante d'état :
     espace Dossiers → Ouvertes / En pause / Résolues / Archivées avec compteurs (`countStates`) et
     pastille de couleur d'état ; espace Pièces → Pièces reçues / Contributions / Personnel /
     Secret MJ (MJ seulement) + catégories en liste déroulante ; Carnet → Toutes / Non classées.
     Une seule puce active à la fois ; recliquer la désactive. Le sélecteur « Limiter à … » reste,
     en liste déroulante discrète sous les puces.
   - **Cartes** (`<ul>` de liens-boutons) — dossier : pastille d'état + titre (Cinzel) + ligne méta
     « 3 pièces · 2 PNJ · màj session 13 » (`dossierSummary`) ; pièce : catégorie, titre, origine ;
     note : titre ou premières lignes. Carte sélectionnée : fond `--enq-raised` relevé et contour
     `--enq-accent`, `aria-current="true"`. Badges « Secret MJ » / « Personnel » conservés.
     Pendant une recherche, l'extrait de texte actuel reste affiché sous le titre.
   - **Pied du rail** (lien discrets `enq-button--quiet`) : « Reprendre le brouillon : … »
     (existant), « Corbeille », « Exporter cet espace », « Déconnexion ». La note de
     confidentialité du carnet part dans la colonne carnet (E-06 la garde en pied).
5. **Corbeille** — reste un espace à part entière (ouvert depuis le pied du rail) avec le rendu
   actuel ; un lien « Retour aux dossiers » en tête.
6. **Session non connectée / inactive / maintenance / ancien** : messages actuels conservés, placés
   dans la colonne centrale.

## Tests

Étendre `tools/enquetes-workspace.test.mjs` (ou `tools/enquetes-ui-rail.test.mjs`) : le sélecteur
change d'espace, une puce filtre puis se désactive, la carte sélectionnée porte `aria-current`,
la corbeille reste accessible, les tests existants (entrées joueur en lecture seule, brouillon
retrouvable, corbeille asynchrone) restent verts.

## Recette

- [ ] Fixture à 1440, 1100 et 800 px : trois, deux puis une colonne, sans défilement horizontal.
- [ ] `/` place le focus dans la recherche ; Tab parcourt rail → dossier → carnet.
- [ ] Mobile (`app/#/enquetes`) toujours utilisable.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(enquetes): three-column desktop layout and dossier rail`

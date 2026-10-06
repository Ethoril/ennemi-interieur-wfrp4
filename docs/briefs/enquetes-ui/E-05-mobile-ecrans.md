# E-05 — Mobile : écrans séparés liste / dossier / pièce

> Lire d'abord [`README.md`](README.md) et les maquettes `03-mobile-liste`, `04-mobile-dossier`,
> `05-mobile-piece`. On réutilise les briques d'E-02 à E-04 ; ce brief en fait une disposition
> d'écran unique par route, dans la coque mobile existante (en-tête + navigation basse).

| | |
|---|---|
| Objectif | Un écran = une chose : la liste, ou le dossier, ou la pièce |
| Fichiers | `js/mobile/app.js` (branchement et bouton d'en-tête), `js/enquetes-workspace.js` (+ vues E-03/E-04), `css/enquetes-workspace.css`, tests `m3-01`/`m7-01` à garder verts, nouveau test |
| Dépend de | E-04 |

## À faire

1. **Branchement** — `js/mobile/app.js` l. 387-389 : passer `layout: 'mobile'` à
   `createEnqueteWorkspaceView`. Rien d'autre ne change dans la coque, sauf le point 5.
2. **Route `#/enquetes` (liste)** — la vue `mobile` sans `id` n'affiche **que le rail** d'E-02 :
   sélecteur Dossiers / Pièces / Carnet (hauteur 40 px), puces d'état en une ligne défilante
   horizontalement (`overflow-x:auto`, sans barre visible, dernière puce partiellement visible
   pour signaler le défilement), cartes pleine largeur (12 px de rayon, 16 px de marge). La carte
   d'un dossier ouvert montre en plus la question en italique et une **pile de 3 mini-fiches**
   parchemin décoratives (`aria-hidden`) devant « 3 pièces · 2 PNJ · 1 note ».
   La recherche est repliée derrière l'icône loupe d'en-tête de liste (champ déplié au toucher,
   focus automatique, croix pour fermer et vider). Ouvrir une carte = `onOpen(id)` (navigation
   vers `#/enquetes/<id>`), jamais d'affichage en dessous de la liste.
   Mémoriser l'espace et le filtre actifs **en mémoire de module** (pas de stockage) pour les
   retrouver au retour arrière. Supprimer `max-height:48vh` des résultats en mobile.
3. **Route `#/enquetes/<id>` d'une enquête (dossier)** — pas de rail. En haut, un bandeau :
   cachet 52 px + titre (Cinzel 22 px) + épigraphe. Puis **onglets** collants sous le bandeau,
   `role="tablist"` : « Pièces n · PNJ n · Chronologie · Mes notes n » (défilement horizontal si
   le texte est agrandi). Contenu de l'onglet :
   - Pièces : fiches parchemin d'E-03 en **liste pleine largeur** (grille `1fr auto` : texte à
     gauche, vignette 52 px à droite), rotation ±0,4° ; bouton pointillé « Verser une pièce ou une
     photo » (l'`<input type=file>` accepte déjà les images : ajouter `capture` n'est pas demandé) ;
   - PNJ et Chronologie : composants d'E-03 en une colonne ;
   - Mes notes : notes liées + note non classée suggérée, comme la colonne carnet.
   Onglet actif mémorisé par dossier (mémoire de module). « Tableau des liens » est une entrée du
   menu d'actions qui ouvre le graphe en plein écran (`<dialog>`, fermeture « Fermer »).
4. **Route `#/enquetes/<id>` d'un document (pièce)** — visionneuse en haut (hauteur 380 px, fond
   sombre, image contenue), boutons ronds 44 px en surimpression : plein écran à droite ; le
   retour est celui de l'en-tête de la coque (ne pas en ajouter un second). Libellé
   « PIÈCE 1 / 3 » si contexte de dossier. Puis la **fiche parchemin** d'E-04 qui chevauche la
   visionneuse de 18 px (coins supérieurs arrondis 18 px, petite poignée décorative `aria-hidden`).
   **Pas de geste de glissement** : c'est un simple contenu défilant. Barre d'actions en pied de
   fiche : « Noter » (principal, ouvre la note rapide d'E-06 liée à la pièce), « Annoter » (active
   le mode annotation d'E-04 et fait remonter la vue sur l'image), menu ⋯. Ignorer le texte
   « Appui long sur l'image » de la maquette : le mode annotation passe par le bouton.
5. **Menu d'actions dans l'en-tête de la coque** — sur `ENQUETE`, afficher `#m-header-action`
   (comme pour `FICHE`, `app.js` l. 412-413) et l'aiguiller vers `currentView.openMenu(anchor)`
   (même mécanisme que la fiche, l. 440-442). La vue expose `openMenu(anchor)` qui ouvre le menu
   d'actions du dossier ou de la pièce courante. Libellé `aria-label` « Actions du dossier » /
   « Actions de la pièce ». En vue `mobile`, le bouton ⋯ interne n'est pas rendu.
6. **Éditeurs** (`ENQUETE_NEW`, `ENQUETE_EDIT`, et tout `openEditor`) : plein écran dans la
   colonne, boutons « Enregistrer » (principal) et « Fermer en conservant le brouillon » collés en
   bas (`position:sticky; bottom:0`), champs à 16 px minimum (évite le zoom iOS).
7. `revealDetail` : en `mobile`, ne plus faire `scrollIntoView` (l'écran est déjà le détail) ;
   remettre le défilement en haut à l'ouverture d'un objet.

## Tests

Nouveau `tools/enquetes-ui-mobile.test.mjs` : sans `id`, aucun conteneur de détail rendu ; avec un
`id` d'enquête, aucun rail, quatre onglets, flèches gauche/droite changent d'onglet ; avec un `id`
de document, la fiche et la barre d'actions sont rendues ; `openMenu` existe et ouvre le menu.
`tools/m3-01-mobile-shell.test.mjs` et `tools/m7-01-release.test.mjs` restent verts (pas de chaîne
`firebase` ni d'URL `https://` ajoutée à `app.js`).

## Recette

- [ ] Fixture dans une fenêtre de 375 px, puis l'app réelle sur téléphone : liste → dossier →
      pièce → retour → retour retrouve l'espace et le filtre.
- [ ] Comparer avec `03-`, `04-` et `05-*.png`.
- [ ] Texte agrandi à 200 % : onglets et puces défilent, rien n'est coupé.
- [ ] `npm run check`, `npm run lint` verts.

## Commit

`feat(mobile): split enquetes into list, dossier and evidence screens`

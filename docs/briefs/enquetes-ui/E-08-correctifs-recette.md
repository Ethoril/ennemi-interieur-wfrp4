# E-08 — Correctifs de recette avant mise en production

> Issu de la relecture de `feat/enquetes-ui` (commits 1493a16 → d955857). Les tests, le lint, la
> sécurité et la conformité fonctionnelle sont bons ; ces défauts ont été trouvés à la lecture et en
> recette visuelle. Numéros de ligne : `js/enquetes-workspace.js` à d955857, sauf mention.
> Même cadre que les autres briefs ([`README.md`](README.md), `00-CONVENTIONS.md`).
> **Pas de changement de version** : on reste en v2.35.0 (non publiée).

## A. Bloquants (à corriger tous)

1. **Mobile : retour en haut à chaque rendu.** `syncMobileScreen()` (l. 69) fait
   `container.scrollTop = 0` à chaque `render()`, donc à chaque `onChange` (y compris les
   changements de métadonnées cache/serveur et l'auto-sauvegarde des notes toutes les 700 ms).
   → Ne remettre en haut **que** lorsque l'objet affiché change (comparer l'id rendu au précédent),
   jamais sur un simple re-rendu.
2. **Bureau (et onglet « Mes notes » mobile) : la note rapide perd le focus.** `render()` reconstruit
   tout le carnet (l. 85, 137-138), la `<textarea>` est recréée. → Ne pas reconstruire le bloc de
   saisie quand le contexte n'a pas changé : le créer une fois par contexte et ne re-rendre que la
   liste des notes. À défaut, sauvegarder puis restaurer focus et `selectionStart/End` comme le fait
   déjà `renderList` pour la recherche. Le raccourci `/` ne doit jamais se déclencher depuis une
   `<textarea>` (vérifier aussi `isContentEditable`).
3. **Note rapide liée à une note → échec en boucle.** `quickTargets()` (l. 98-100, 128) relie à
   `current()` quel que soit son type ; le service refuse `notes:notes`
   (`functions/src/enquetes/service.mjs:79`). → Cibles admises : enquêtes, documents, PNJ
   uniquement (même table que `compatible` de `openLinkEditor`). Ouverte depuis une note, la note
   rapide prend comme cibles les objets **liés à cette note** (pré-cochés), jamais la note
   elle-même. Même filtre pour « Relier à ce dossier » des notes non classées (l. 146) : ne pas
   l'afficher si l'objet courant est une note.
4. **Contraste des boutons secondaires sur parchemin.** Sur la fiche de pièce (bureau et mobile),
   « Modifier », « Annoter » et le ⋯ héritent du fond sombre d'`enq-button` avec une encre sombre :
   illisibles (capture `recette/05-mobile-piece.png`). → `.enq-piece-sheet .enq-button`,
   `.enq-piece-sheet .enq-icon-button` : fond transparent, texte `--enq-ink`, bordure
   `rgba(42,33,22,.35)`, survol `rgba(42,33,22,.08)`. Vérifier 4,5:1 dans les deux thèmes.
5. **Mobile pièce : le bouton flottant recouvre la barre d'actions** (⋯ et dernière annotation).
   → Sur l'écran pièce mobile, ajouter en bas de la fiche un espace égal à la hauteur du bouton
   flottant + 16 px, ou masquer le bouton flottant quand la barre « Noter » (qui fait la même
   chose) est visible.
6. **Accessibilité — épingle privée par la seule couleur.** `css/enquetes-workspace.css:486`,
   l. 363 : ajouter l'audience au `aria-label` (« Annotation 2 (privée) : … ») et un indice non
   coloré sur `.enq-marker--private` (bordure en pointillés).
7. **Accessibilité — hiérarchie des titres h1 → h3.** Le `h2` de la barre a été supprimé (E-02)
   sans remonter les titres internes. → Décaler toute la chaîne d'un niveau (h3→h2, h4→h3,
   h5→h4 ; `textView` : `'h'+(n+1)`), et adapter `revealDetail`/`restoreFocus` qui cherchent
   `detail.querySelector('h3')` (l. 52, 55). Adapter les tests qui ciblent `H3`.
8. **Accessibilité — région live trop large.** Retirer `aria-live="polite"` de
   `#enquete-workspace` dans `enquetes.html:29` (les `role="status"` internes suffisent).
9. **Accessibilité — bouton d'en-tête mobile.** `js/mobile/app.js` (`onRoute`, l. 412-413) : sur
   ENQUETE et FICHE poser `aria-haspopup="menu"` et `aria-expanded="false"` ; sur les autres
   routes, `removeAttribute` des deux (aujourd'hui ils restent après la première ouverture, y
   compris sur Réglages qui ouvre un dialogue).

## B. À corriger dans le même lot (fonctionnels)

10. **Conclusion** : l'afficher dès qu'elle existe (pas seulement si « Résolue »), **en tête** des
    sections (E-03 §7), et dans le dossier mobile (absente de `renderMobileDossier`, l. 312-324).
11. **Recherche mobile fantôme** : si `search` est restauré non vide, rouvrir le champ
    (`mobileSearchOpen = true`) ; afficher sinon un rappel « Filtré : « … » · Effacer ».
12. **Vignettes** : mettre en cache par dossier le résultat de `client.read('files', id)` (ne
    relire que si `document.files` change) et demander la miniature :
    `client.objectUrl(f, { thumbnail: true })` (déjà pris en charge par `js/enquetes-runtime.js`
    l. 109-115, repli automatique sur l'image si pas de miniature), au lieu de l'image pleine
    taille (l. 333-339, 264).
13. **Stockage local indisponible** (l. 122) : si `saveDraft` échoue, afficher l'avertissement
    « Brouillon local indisponible » mais **envoyer quand même** en ligne, comme l'ancien éditeur.
14. **Menu ⋯ — flèche bas** (`js/enquetes-menu.js:47-56`) : l'ouverture par flèche bas saute le
    premier élément (l'événement remonte au conteneur). → `event.stopPropagation()` après
    l'ouverture, ou un seul gestionnaire. Ajouter le cas au test du menu.
15. **Agrandir** (l. 371) : la `<dialog>` de zoom ne doit pas être fermée par un re-rendu ; la
    sortir de `handles` et ne libérer son URL qu'à sa fermeture (ou au démontage).
16. **Historique** (l. 293) : écouteur `close` qui retire la `<dialog>` et rend le focus au bouton
    d'origine ; titre visible « Historique » relié par `aria-labelledby`.

## C. Peut attendre (ne pas traiter sauf trivial)

Brouillons rapides tous nommés « Sans titre » (préfixer par le contexte : « Note sur … ») ;
accumulation du tableau `menus` et des menus d'en-tête masqués dans `root` (l. 143, 287, 541) ;
numéros d'annotation qui repartent à 1 par fichier ; « Voir la version annotée » qui vide la
bande des fichiers ; espace non activé sans « Déconnexion » ; doublons `aria-label` /
`aria-labelledby` (feuille de note l. 151, onglets l. 322) ; `aria-expanded` sur la loupe mobile ;
`aria-current="false"` superflu sur les onglets ; portraits PNJ https bloqués par la CSP mobile
(ne pas élargir `img-src` sans la limiter à Storage).

## Tests

Ajouter : pas de remise à zéro du défilement sur un `emit()` sans changement d'objet ; focus et
sélection conservés dans la note rapide après un `emit()` ; aucune cible de type `notes` dans
`quickTargets` ; flèche bas du menu sur le premier élément ; zoom toujours ouvert après un
`emit()` ; conclusion rendue sur un dossier « Ouverte » qui en a une.

## Recette

- [ ] Fixture mobile (`?layout=mobile`) : lire une pièce longue, déclencher un changement
      (enregistrer une note dans un autre onglet) → la position de lecture ne bouge pas.
- [ ] Bureau : taper dans la note rapide pendant un `emit()` → le curseur reste en place.
- [ ] Ouvrir une note puis « Noter » → enregistrement sans erreur.
- [ ] Captures `recette/02-*` et `05-*` refaites : boutons lisibles, bouton flottant dégagé.
- [ ] `npm run check`, `npm run lint`, `npm run test:enquetes` verts.

## Commit

`fix(enquetes): recette fixes before v2.35.0 release`

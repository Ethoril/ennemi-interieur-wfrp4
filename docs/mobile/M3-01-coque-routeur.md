# M3-01 — coque et routeur mobile

La première coque de `/app/` est une page HTML autonome, chargée par modules ES
natifs. Elle ne modifie pas le manifeste, le Service Worker ou la navigation du
site public et ne contacte pas Firebase : les données seront branchées par
M3-02.

## Découpage

- `app/index.html` fournit le document hôte, la CSP minimale, le point de
  montage, la zone `aria-live`, la navigation basse et le dialogue réglages.
- `css/mobile-app.css` contient uniquement des classes préfixées `m-`, les
  safe areas, les cibles tactiles de 44 px, le mode paysage et le mouvement
  réduit. Les couleurs passent par les jetons du design system.
- `js/mobile/router.js` parse et génère les hashes, conserve l'historique,
  monte/démonte une vue, restaure le scroll de la liste et protège les
  transitions asynchrones par génération.
- `js/mobile/session.js` est une session neutre de coque. Il n'importe aucune
  primitive d'authentification ; l'adaptateur Firebase viendra dans un lot
  ultérieur.
- `js/mobile/ui.js` centralise les états, annonces, focus trap, fermeture
  Escape, restauration du focus et verrouillage du scroll du dialogue.
- `js/mobile/views/` contient les placeholders PNJs liste/fiche. Les routes
  Enquêtes et Réglages utilisent pour l'instant un écran d'attente explicite.

## Routes

`#/pnjs`, `#/pnjs/{id}`, `#/enquetes`, `#/enquetes/{id}` et `#/reglages` sont
supportées. Les identifiants sont limités à `[A-Za-z0-9_-]{1,150}` après
décodage URI ; les séquences malformées, les slash décodés, `..`, les requêtes
et les caractères hors contrat deviennent l'écran inconnu sans être réinjectés
dans le DOM.

Chaque vue expose `mount({ signal })` et `unmount()`. Le routeur annule le
`AbortSignal` avant le démontage, invalide une vue dont le montage asynchrone
termine après une navigation et détache les listeners à `stop()`. Toute future
lecture asynchrone de vue doit vérifier `signal.aborted` avant de toucher au
DOM, d'ajouter un listener ou de conserver une Blob/URL objet ; le signal ne
remplace pas le nettoyage idempotent de `unmount()`.

## Vérification

Automatisé localement : `npm run lint`, `node --test
tools/m3-01-mobile-shell.test.mjs` et `npm run check`. La recette navigateur
(320/375/430 px, clavier, lecteur d'écran, thèmes et orientation) reste à faire
sur l'émulateur Android disponible ; aucune recette iPhone ni publication n'est
nécessaire pour ce sous-lot.

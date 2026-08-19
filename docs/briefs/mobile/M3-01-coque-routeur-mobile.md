# M3-01 — Coque `/app/`, routeur et design mobile

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M2-05.

| | |
|---|---|
| Lot | M3 — PNJs mobile joueur |
| Objectif | Créer une interface mobile dédiée, indépendante de la mise en page bureau |
| Estimation | 2 jours |
| Fichiers | `app/index.html`, `css/mobile-app.css`, `js/mobile/app.js`, `js/mobile/router.js`, vues |
| Dépend de | M2-05 |

## Principe

`/app/` est une application mobile de la même base de code et de la même origine, pas une feuille CSS
qui comprime le site bureau. Elle réutilise les tokens, utilitaires sûrs et dépôts de données, mais
possède navigation, hiérarchie d'information et composants conçus pour le pouce.

## Arborescence initiale

Créer au minimum :

```text
app/index.html
css/mobile-app.css
js/mobile/app.js
js/mobile/router.js
js/mobile/session.js
js/mobile/ui.js
js/mobile/views/pnjs-list.js
js/mobile/views/pnj-detail.js
```

Les fichiers Enquêtes et administration seront ajoutés par leurs lots. Les noms peuvent évoluer si
la séparation reste claire et documentée. Aucun fichier ne dépend d'un bundler.

## À faire

### 1. Construire le document hôte

- Définir langue, viewport avec `viewport-fit=cover`, thème et CSP cohérente avec les imports réels.
- Réutiliser `css/base.css` pour les tokens, puis charger seulement la feuille mobile dédiée.
- Ajouter un point de montage, une zone d'annonces et une navigation basse sémantique.
- Prévoir un squelette immédiat sans flash de la navigation bureau.
- Rester utilisable comme page web classique avant le travail PWA du lot M6.

### 2. Écrire un routeur hash minimal

Supporter dès maintenant :

- `#/pnjs` ;
- `#/pnjs/{id}` ;
- `#/enquetes` et `#/enquetes/{id}` comme écrans « bientôt disponible » ;
- `#/reglages` ;
- une route inconnue avec action de retour.

Le hash est retenu pour GitHub Pages : recharger une fiche ne doit pas produire de 404. Décoder et
valider l'identifiant avant usage, conserver l'historique du navigateur et restaurer si possible la
position de liste au retour. Chaque vue expose `mount()` et `unmount()` pour libérer ses ressources.

### 3. Définir les fondations UI

- Barre supérieure compacte : titre, retour contextuel et actions de vue.
- Navigation basse : PNJs, Enquêtes, Réglages ; tenir compte de `safe-area-inset-bottom`.
- Cibles tactiles de 44 px minimum et espacement évitant les activations accidentelles.
- Feuilles basses et dialogues natifs au projet, avec verrouillage du fond et retour du focus.
- États partagés : chargement, vide, erreur, hors ligne, synchronisation.
- Classes préfixées (`m-` ou équivalent) afin de ne pas polluer les pages bureau.

### 4. Accessibilité et ergonomie

Utiliser des titres hiérarchiques, libellés explicites, focus visible, `aria-current` dans la navigation
et zone `aria-live` pour les changements importants. Respecter `prefers-reduced-motion`. La navigation
et les dialogues doivent rester opérables au clavier, même si la cible première est tactile.

### 5. Préparer les thèmes

Exploiter les variables des deux thèmes existants et ajouter uniquement des tokens sémantiques
nécessaires au mobile. Tester le contraste des textes secondaires, badges et états désactivés. Ne pas
injecter de couleur littérale depuis JavaScript.

## Ne pas faire

- Ne pas copier la navigation ou le graphe D3 de `pnjs.html` dans la coque.
- Ne pas ajouter de framework, Web Components obligatoires ou système de build.
- Ne pas modifier encore `manifest.json` ni annoncer `/app/` dans le site public.
- Ne pas connecter de données réelles avant M3-02.

## Recette

- [ ] Chaque route se charge directement et via précédent/suivant.
- [ ] Une route invalide ne casse pas l'application.
- [ ] `unmount()` est appelé à chaque changement de vue.
- [ ] Navigation utilisable à 320, 375 et 430 px, portrait et paysage.
- [ ] Aucun contenu n'est masqué par encoche, barre d'accueil ou clavier virtuel.
- [ ] Clavier, lecteur d'écran de base, deux thèmes et mouvement réduit contrôlés.
- [ ] Console et validation HTML/CSS propres.

## Critères d'acceptation

`/app/` fournit une coque mobile autonome, navigable par URL et historique, dont chaque vue peut être
montée puis nettoyée sans dépendre de la mise en page des pages bureau.

## Commit

`feat(mobile): creer la coque et le routeur dedies (M3-01)`

# M3-03 — Liste, recherche et filtres PNJs

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M3-02.

| | |
|---|---|
| Lot | M3 — PNJs mobile joueur |
| Objectif | Permettre de retrouver rapidement un personnage en situation de jeu |
| Estimation | 1,5 jour |
| Fichiers | `js/mobile/views/pnjs-list.js`, composants mobiles, `css/mobile-app.css` |
| Dépend de | M3-02 |

## Expérience cible

L'écran d'accueil PNJs privilégie la reconnaissance et la vitesse : recherche immédiatement visible,
cartes compactes, informations secondaires limitées et filtres dans une feuille basse. Le graphe de la
page bureau n'est pas transposé sur téléphone.

## À faire

### 1. Concevoir la liste

Chaque carte comporte au maximum : portrait ou initiales, nom, rôle/profession utile, groupe ou lieu
principal et quelques badges réellement discriminants. Toute la carte ouvre `#/pnjs/{id}` mais les
actions imbriquées restent accessibles. Les images sont paresseuses, dimensionnées et remplacées par
un placeholder stable en cas d'erreur.

Utiliser une liste sémantique et un rendu par fragments. Pour le volume actuel, éviter la virtualisation
complexe ; mesurer avant d'en introduire une. Conserver la position de défilement au retour d'une fiche.

### 2. Ajouter la recherche

- Champ de type recherche avec effacement tactile.
- Recherche insensible à la casse et aux signes diacritiques.
- Correspondance au minimum sur nom, surnom, rôle, lieu et groupes publics documentés.
- Délai court ou calcul léger pour ne pas rerendre à chaque frappe inutilement.
- Mise en évidence facultative, uniquement si elle reste sûre et accessible.

Une recherche vide restaure immédiatement la liste et son ordre stable.

### 3. Ajouter les filtres

Ouvrir une feuille basse avec les dimensions réellement disponibles dans le schéma : groupe, statut,
lieu ou catégorie. Les choix sont calculés depuis les PNJs visibles. Prévoir :

- compte des filtres actifs sur le bouton ;
- application explicite et action « Tout effacer » ;
- valeurs invalidées après mise à jour retirées de l'état comme en M1-04 ;
- focus piégé dans la feuille et rendu au bouton à la fermeture ;
- URL non surchargée de filtres, sauf décision documentée de partage de recherche.

### 4. Définir tri et résultats

Ordre par `ordre`, puis nom normalisé, puis identifiant. Indiquer le nombre de résultats. Distinguer
« Aucun PNJ publié » de « Aucun résultat pour ces critères » et proposer l'action appropriée. Une mise
à jour temps réel ne doit pas ramener brutalement en haut de liste.

### 5. Soigner les états de réseau

Afficher les données en cache sans squelette permanent, avec l'indicateur de M3-02. Pendant une mise à
jour silencieuse, ne pas désactiver la liste. Si le portrait protégé n'est pas disponible hors ligne,
montrer le placeholder sans transformer la fiche entière en erreur.

## Sécurité et accessibilité

Tout texte Firestore passe par `esc()` ou `textContent`. Les libellés d'image ne révèlent pas de note
privée. Les cartes ont un nom accessible, les badges ne reposent pas seulement sur la couleur et la
zone de recherche possède un libellé persistant pour lecteur d'écran.

## Recette

- [ ] Recherche accents/casse/apostrophes correcte.
- [ ] Combinaison de plusieurs filtres et effacement complet corrects.
- [ ] Mise à jour distante réconcilie une option disparue.
- [ ] Retour d'une fiche restaure recherche, filtres et défilement.
- [ ] 0, 1, 50 et plusieurs centaines d'éléments restent utilisables.
- [ ] Portrait absent/refusé/hors ligne a un placeholder sans saut de page.
- [ ] Navigation clavier et lecteur d'écran de base validés.
- [ ] 320 à 430 px, paysage et deux thèmes validés.

## Critères d'acceptation

Un joueur peut retrouver un PNJ courant en quelques secondes, d'une main, sans connaître les groupes
du graphe bureau et sans voir un contenu masqué.

## Commit

`feat(mobile): ajouter la liste et les filtres pnjs (M3-03)`

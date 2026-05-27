# Feature: Doodle - Planification de parties

Ce plan décrit l'implémentation de la fonctionnalité de sondage (doodle) permettant de planifier les prochaines sessions de jeu.

## User Review Required

> [!IMPORTANT]
> **Règles de sécurité Firebase (Firestore Rules)**
> L'application va écrire dans une nouvelle collection `doodle` (document `current`). 
> - Si les joueurs ne se connectent pas (pas de compte Google requis pour eux), les règles Firestore doivent autoriser la lecture et l'écriture publique (ou au moins non-authentifiée) sur le chemin `doodle/current`.
> - Avez-vous besoin que je vous fournisse les règles Firestore à mettre à jour dans votre console Firebase, ou les joueurs doivent-ils se connecter avec leur compte Google pour voter ?

## Open Questions

> [!WARNING]
> 1. **Modification des votes** : Est-ce que les joueurs doivent pouvoir modifier leur vote après l'avoir soumis ? Si oui, le plus simple est d'écraser la ligne si le nom saisi existe déjà. Êtes-vous d'accord avec ce comportement ?
> 2. **Format des dates** : Le MDJ (David) pourra-t-il simplement entrer du texte libre pour les dates (ex: "Samedi 12", "Dimanche 13", "Mardi 15 soir"), séparé par des virgules, pour créer le sondage ?

## Proposed Changes

### Composants HTML & Navigation

#### [MODIFY] [layout.js](file:///f:/Outil%20WRPGv4/ennemi-interieur-wfrp4/js/layout.js)
- Ajouter l'entrée `doodle.html` (nommée "Calendrier" ou "Doodle") dans la constante `NAV_ITEMS` pour qu'elle apparaisse dans la barre de navigation.

#### [NEW] [doodle.html](file:///f:/Outil%20WRPGv4/ennemi-interieur-wfrp4/doodle.html)
- Création de la page principale pour le sondage.
- Structure standard (Nav, Footer, Hero) en accord avec le reste du site.
- Conteneur pour l'interface d'administration (visible uniquement par le MDJ).
- Conteneur pour le tableau de sondage.

### Logique Javascript

#### [NEW] [doodle.js](file:///f:/Outil%20WRPGv4/ennemi-interieur-wfrp4/js/doodle.js)
- **Authentification** : Utiliser `onAuthStateChanged` pour vérifier si l'utilisateur est connecté et s'il s'agit de `ethoril@gmail.com`.
- **Mode Admin** :
  - Afficher un champ de saisie pour créer un nouveau sondage avec les dates souhaitées.
  - Lors de la création, écraser le document `doodle/current` dans Firestore avec la liste des dates, et une première réponse automatique pour "David" (toutes les dates cochées).
- **Mode Joueur (Sondage)** :
  - Écouter en temps réel (`onSnapshot`) les modifications de `doodle/current`.
  - Générer un tableau HTML :
    - En-tête : Les dates.
    - Lignes : Les réponses des joueurs (avec des icônes ✔️ ou ❌).
    - Dernière ligne (formulaire) : Un champ texte pour le nom du joueur, des cases à cocher (`<input type="checkbox">`) pour chaque date, et un bouton "Valider".
  - Lors du clic sur "Valider", ajouter (ou mettre à jour) la réponse du joueur dans la liste des réponses stockées dans Firestore.

### CSS

#### [MODIFY] [style.css](file:///f:/Outil%20WRPGv4/ennemi-interieur-wfrp4/css/style.css)
- (Optionnel) Ajouter des styles spécifiques pour le tableau de sondage afin qu'il s'intègre parfaitement au thème actuel (parchemin/sombre) s'ils ne sont pas déjà couverts par les styles de base des tableaux.

## Verification Plan

### Manual Verification
1. Me connecter en tant que MDJ (`ethoril@gmail.com`) et vérifier l'apparition du panneau d'administration.
2. Créer un sondage avec 3 dates (ex: "10 Juin, 12 Juin, 15 Juin").
3. Vérifier que la ligne de "David" est automatiquement ajoutée avec les 3 dates cochées.
4. Me déconnecter (ou ouvrir en navigation privée), saisir un nom de joueur (ex: "Bhelgi"), cocher 2 dates et valider.
5. Constater que la ligne de Bhelgi apparaît instantanément dans le tableau.

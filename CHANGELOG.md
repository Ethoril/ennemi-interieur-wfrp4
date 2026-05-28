## [2.11.5] - 2026-05-28

### Corrections
- **Fiche (Réinitialisation)** : Correction d'un bug où la réinitialisation cloud d'une fiche ne nettoyait pas le cache local, causant sa résurrection au rechargement de la page.
- **Fiche (Multi-personnages)** : Isolation du localStorage par personnage (clé dynamique incluant l'ID du personnage) pour éviter les conflits d'écrasement local lorsque plusieurs personnages sont ouverts sur le même navigateur.

## [2.11.4] - 2026-05-27

### Planification & Calendrier
- **Notification par email (MDJ)** : Écriture automatique dans la collection `mail` lors de la validation d'un vote joueur pour déclencher l'envoi d'une alerte au MDJ via l'extension Firebase Trigger Email.

## [2.11.3] - 2026-05-27

### Planification & Calendrier
- **Modification directe par les joueurs** : Ajout d'une icône crayon ✏️ cliquable par tous les joueurs à côté de leur nom pour pré-remplir le formulaire de vote avec leurs disponibilités actuelles.
- **Alerte de confirmation de modification** : Demande de confirmation `"Tu t'apprêtes à modifier les disponibilités de xxx, est-ce bien toi ?"` en cas de soumission avec un pseudo déjà existant (insensible à la casse, évite les doublons et les écrasements accidentels).

## [2.11.2] - 2026-05-27

### Planification & Calendrier
- **Refonte de l'interface MDJ (Doodle)** : Séparation claire entre l'interface de création de nouveau sondage et les contrôles de gestion du sondage actif pour éviter les confusions d'affichage.
- **Contrôles de sondage actif** : Ajout de boutons d'administration pour modifier les dates du sondage en cours, clôturer ou réouvrir les votes (avec bannière de statut dynamique et verrouillage des inputs), et supprimer le sondage actif.
- **Suppression de réponses individuelles** : Ajout d'icônes poubelles cliquables par le MDJ directement dans le tableau à côté de chaque joueur pour nettoyer ou corriger des votes.
- **Améliorations de style et lisibilité** : Élargissement de la colonne "Joueurs" à 180px, fixation d'une largeur minimale de 120px sur les colonnes de dates pour éviter les retours à la ligne intempestifs (maximum 2 lignes), et intégration d'une barre de défilement horizontale dorée visible en permanence.

## [2.11.1] - 2026-05-27

### PWA & Cache
- **Résolution des problèmes de cache persistants** : Refonte de la stratégie de fetch du Service Worker. Utilisation de la stratégie *Network First* combinée avec l'option `{ cache: 'no-cache' }` pour toutes les ressources locales de code (HTML, CSS, JS), empêchant le cache HTTP du navigateur de renvoyer des pages obsolètes.
- **Stale-While-Revalidate** : Remplacement de la stratégie *Cache First* par *Stale-While-Revalidate* pour les assets non-code (images locales, polices de caractères, CDNs), permettant leur mise à jour silencieuse en tâche de fond.
- **Enregistrement optimisé** : Enregistrement du Service Worker avec l'option `{ updateViaCache: 'none' }` dans `js/main.js` pour forcer le navigateur à vérifier les mises à jour de `sw.js` directement sur le réseau.
- **Incrémentation du cache** : Passage du cache en version `wfrp-cache-v2` pour purger automatiquement les fichiers obsolètes stockés dans le cache des navigateurs clients.

## [2.11.0] - 2026-05-27

### Planification & Calendrier
- **Sondage Doodle (Planification de sessions)** : Ajout d'une nouvelle page "Calendrier" permettant de créer des sondages de dates pour planifier les parties.
- **Vote public en temps réel** : Les joueurs peuvent indiquer leurs disponibilités de manière anonyme et en temps réel grâce à une écoute Firestore active, sans connexion Google obligatoire.
- **Panneau Admin MDJ** : Possibilité pour le MDJ (David) de lancer un nouveau sondage (saisie de dates libre séparée par des virgules) et de supprimer le sondage actif depuis son interface d'administration sécurisée.
- **Intégration et UX** : Nouvelle entrée "Calendrier" dans la barre de navigation, tableau des votes synchronisé en temps réel avec indicateur de totaux de présence et design parchemin/sombre avec styles d'interactions or.

## [2.10.0] - 2026-05-27

### Personnages
- **Fiches de Personnages Individuelles** : Les joueurs disposent désormais de leur propre fiche accessible depuis "Le Groupe", sauvegardée indépendamment sur Firebase.
- **Sécurité et Authentification** : Séparation des sauvegardes dans le cloud (Firebase Firestore) selon le nom du personnage. Accès sécurisé côté client pour le Maître de Jeu, et base préparée pour autoriser les emails des joueurs individuellement.
- **Fiche de Test** : Maintien de l'icône Parchemin dans "Le Groupe", redirigeant désormais vers la page de test `fiche.html?char=test`.

## [2.9.0] - 2026-05-26

### Améliorations Techniques & UX
- **PWA** : Ajout d'un manifeste et d'un Service Worker pour permettre l'installation de l'application et le cache hors-ligne.
- **Modules JS** : Uniformisation du JavaScript avec l'utilisation de modules ES6 (<script type="module">).
- **CSS** : Découpage du fichier monolithique style.css en fichiers séparés (ase.css, layout.css, components.css, pnjs.css) pour une meilleure maintenabilité.
- **PNJs (Graphe D3)** : Accentuation de l'effet de focus (assombrissement plus fort des nœuds non connectés au clic).
- **Animations & UX** : Ajout de micro-animations (survol des cartes, ouverture de modales en popIn).
- **Responsive** : Ajustements des conteneurs du graphe D3 et des cartes Leaflet pour une meilleure manipulation sur mobile.
## [2.8.2] - 2026-05-26

### ThÃ¨me Parchemin (Clair) & AccessibilitÃ©
- **PNJs (Graphe)** : Correction du contraste des nÅ“uds. Le fond des cadres (`.node-card`) n'est plus noir mais s'adapte au thÃ¨me (blanc chaud `#faf4e8` sur parchemin) afin de rendre les noms en brun foncÃ© parfaitement lisibles.
- **PNJs (Portrait placeholders)** : Le fond des cercles placeholders de portrait s'adapte dÃ©sormais au thÃ¨me (`var(--bg-surface)`) pour contraster avec les initiales.
- **PNJs (Badges et chips)** : Refonte des teintes de statut (alliÃ©, ennemi, neutre, vivant, dÃ©cÃ©dÃ©, inconnu) et de relations (mentor, rival, etc.) pour utiliser des variables CSS adaptÃ©es Ã  fort contraste (ratio > 4.5:1 WCAG AA) sur le thÃ¨me parchemin.
- **PNJs (LuminositÃ© dynamique)** : La fonction `stringToColor` adapte automatiquement la luminositÃ© des teintes calculÃ©es pour les relations personnalisÃ©es en fonction du thÃ¨me actif.
- **PNJs (Texture)** : Application de la texture grain fin au conteneur du graphe `#pnj-graph` pour l'unifier visuellement avec le reste du site.
- **Indices & Fiches** : AmÃ©lioration du contraste des boutons danger, des chips d'indices (Page EnquÃªtes) et des badges de statut cloud (Page Fiche).

## [2.8.1] - 2026-05-26

### Corrections & Audit technique
- **Fiche (Race condition)** : RÃ©solution d'une faille de chargement concurrent entre le cache local (localStorage) et Firestore. L'initialisation attend dÃ©sormais le chargement complet des bases de donnÃ©es JSON (`careers.json` et `skills.json`) et Ã©vite d'exÃ©cuter le rendu local si les donnÃ©es cloud ont dÃ©jÃ  pris le dessus, ce qui provoquait une duplication des listes de compÃ©tences/talents/XP et la corruption de la fiche.
- **PNJs (Marqueurs SVG)** : Correction de la gÃ©nÃ©ration des IDs des marqueurs de flÃ¨ches SVG. Les couleurs de relation en HSL (gÃ©nÃ©rÃ©es dynamiquement) contenaient des parenthÃ¨ses et virgules invalides qui cassaient les liens D3. Les identifiants sont dÃ©sormais nettoyÃ©s et purement alphanumÃ©riques.
- **PNJs (Vue Tableau)** : RafraÃ®chissement automatique et immÃ©diat des boutons d'Ã©dition administrative sur la vue tableau lors d'une connexion ou dÃ©connexion.
- **EnquÃªtes (Race condition)** : Ajout d'une sÃ©curitÃ© par ID de chargement unique dans `enquetes.js` pour Ã©liminer tout conflit d'exÃ©cution en parallÃ¨le des requÃªtes Firestore (par exemple, lors d'un login ultra-rapide).
- **Groupe** : Suppression du sous-titre de test temporaire sous le bouton "Fiche HTML".

## [2.8.0] - 2026-05-26

### SÃ©curitÃ© (CSP) â€” Authentification Firebase
- **Fix Firebase Auth** : rÃ©solution de l'erreur `Firebase: Error (auth/internal-error)` lors de la connexion Google en autorisant les scripts `'unsafe-inline'` et les connexions/frames vers les domaines nÃ©cessaires (`https://*.firebaseapp.com`, `https://apis.google.com`, `https://accounts.google.com`, `https://www.google.com`) dans les directives `script-src`, `connect-src` et `frame-src` de la politique de sÃ©curitÃ© du contenu (CSP) de toutes les pages.
- **SÃ©curisation du Carnet d'EnquÃªtes** : ajout de la balise meta CSP sur la page `enquetes.html` avec les mÃªmes rÃ¨gles de sÃ©curitÃ© adaptÃ©es.

### Carnet d'EnquÃªtes
- **Nouvelle page d'enquÃªtes** (`enquetes.html` / `js/enquetes.js`) : interface interactive pour le suivi des indices dÃ©couverts durant la campagne.
- **Mode Administration** : bouton d'accÃ¨s admin Google avec formulaires d'ajout/Ã©dition d'indices (titre, description, illustration facultative par image, statut de dÃ©couverte, liaison dynamique avec la liste des PNJs).
- **Filtrage et recherche** : recherche d'indices par mots-clÃ©s et filtres rapides (tous / dÃ©couverts / secrets pour l'administrateur).

### Calendrier ImpÃ©rial
- **Widget sur l'accueil** : intÃ©gration d'un widget de calendrier impÃ©rial interactif sur la page d'accueil (gÃ©rant les mois, phases de lunes et Ã©vÃ©nements spÃ©ciaux de la campagne).

### Technique & DonnÃ©es
- **DonnÃ©es compÃ©tences (JSON)** : transition de `skills.js` vers un format structurÃ© `skills.json` avec validation par l'intÃ©gration continue. Ajout de compÃ©tences et spÃ©cialitÃ©s manquantes.
- **Factorisation** : centralisation des parseurs CSV et utilitaires de texte dans `js/utils.js`.
- **PNJs** : correction d'un bug de rÃ©initialisation de couleur de la lÃ©gende dans le graphe PNJ lors des changements de snapshot de couleur.

---

## [2.7.0] - 2026-05-21

### Fiche â€” Multi-utilisateur & Centralisation Firebase
- **Fiches multi-utilisateurs** : suppression des restrictions d'adresse email codÃ©es en dur cÃ´tÃ© client. Tout utilisateur connectÃ© via Google dispose dÃ©sormais de sa propre fiche sauvegardÃ©e dans son espace cloud Firestore (`fiches/{uid}`).
- **Centralisation technique** : regroupement de l'initialisation de Firebase et du chargement des services dans un module unique `js/firebase-init.js` partagÃ©.
- **Robustesse DOM (PNJ)** : sÃ©curisation du ciblage du message de chargement/erreur sur `#pnj-loading` pour Ã©viter les crashs si le squelette HTML est modifiÃ©.

---

## [2.6.0] - 2026-05-20

### Fiche â€” Personnalisation par-fiche d'une carriÃ¨re
- **Mode Ã©dition par rang** : bouton **âœŽ Personnaliser** dans le header de chaque rang du panneau de rÃ©fÃ©rence. Active des contrÃ´les d'Ã©dition sans toucher Ã  la base de donnÃ©es globale â€” utile quand le MJ accorde une modification spÃ©cifique Ã  un joueur (Ã©changer une compÃ©tence de carriÃ¨re contre une autre, p. ex.)
- **Retirer une compÃ©tence/talent** : en mode Ã©dition, un `Ã—` apparaÃ®t sur chaque chip pour la retirer. Les chips retirÃ©es s'affichent barrÃ©es en Ã©dition (avec un `â†º` pour restaurer), et sont masquÃ©es en mode normal
- **Ajouter une compÃ©tence/talent custom** : champ avec autocomplÃ©tion (datalist) en bas de chaque liste â€” les ajouts s'affichent avec un â˜… vert et participent Ã  la dÃ©tection Â« dans la carriÃ¨re Â» pour les achats XP
- **Badge âœŽ modifiÃ©** dans le header des rangs personnalisÃ©s, en mode normal â€” repÃ¨re visuel pour ne pas oublier qu'on a divergÃ© du livre
- **Persistance** : les overrides sont stockÃ©s dans `state.careerOverrides[careerId][rang]` (sync cloud + localStorage). IndÃ©pendants par fiche : changer la carriÃ¨re courante ou rÃ©importer la base globale les laisse intacts
- Comportement intÃ©grÃ© aux helpers existants : `isSkillInCareer`, `isTalentInCareer`, `getCareerAllSkills`, highlighting, ghost rows â€” tous tiennent compte des overrides

---

## [2.5.0] - 2026-05-20

### Fiche â€” Base de donnÃ©es complÃ¨te des carriÃ¨res
- **132 carriÃ¨res** importÃ©es depuis le Google Sheet (Livre de base, Dwarf Player Guide, High Elf Player Guide, Deft Steps, Up in Arms, Winds of Magic, Archives 1-3, Middenheim) en remplacement des 3 carriÃ¨res mock initiales â€” couverture exhaustive du panneau de rÃ©fÃ©rence carriÃ¨re, autocomplÃ©tion et dÃ©tection Â« dans la carriÃ¨re Â»
- **Script d'import** (`tools/import-careers.mjs`) qui fetche le sheet, normalise les apostrophes typographiques, regroupe les variantes et rÃ©gÃ©nÃ¨re `js/data/careers.js` â€” relancer aprÃ¨s chaque modification du sheet pour synchroniser
- **Variantes de rang** : certains rangs ont plusieurs versions (ex: rang 2 d'Artisan a la version Â« Artisan Â» classique et Â« FaÃ§onneur de Pierre Â» du Dwarf PG). Le panneau de rÃ©fÃ©rence affiche un sÃ©lecteur de variante quand plusieurs sont disponibles ; le choix est persistÃ© dans `chosenVariants` et utilisÃ© pour la dÃ©tection Â« dans la carriÃ¨re Â» et le highlighting
- **Sous-carriÃ¨res avec prÃ©requis** : les 3 sous-carriÃ¨res de Mage (HE) (PrÃªtre-Forgeron de Vaul, Tisseur de TempÃªtes, MaÃ®tre du Savoir de Hoeth) affichent un bandeau Â« PrÃ©requis : Mage (HE) â€” rang 2 minimum Â» informatif (non bloquant â€” la rÃ¨gle de jeu se fait Ã  l'oral)
- **Comportement gÃ©nÃ©reux par dÃ©faut** : tant qu'une variante n'a pas Ã©tÃ© explicitement choisie, toutes les variantes du rang sont considÃ©rÃ©es comme Â« dans la carriÃ¨re Â» pour Ã©viter les faux nÃ©gatifs pendant les achats XP

### CompÃ©tences & spÃ©cialisations ajoutÃ©es
- Nouvelles compÃ©tences : `Augure`, `PsychomÃ©trie` (Winds of Magic)
- Nouvelles spÃ©cialisations : `Voile (Skycraft)`, `Conduite (Skycutter)`, `Soins aux animaux (Roc)` (Dwarf / High Elf Player Guides)

### Technique
- Bug prÃ©-existant corrigÃ© : `});` orphelin dans `bindAll()` qui fermait la fonction prÃ©maturÃ©ment ; les listeners `btn-add-sort` / `btn-add-priere` / `btn-add-xp(-gain)` / toggles de sections optionnelles sont maintenant bien dans le scope de la fonction
- Le rang max d'une carriÃ¨re est dÃ©sormais lu dynamiquement (Mage HE va jusqu'Ã  5, les autres restent Ã  4)

---

## [2.4.3] - 2026-05-06

### PNJs â€” Ã‰tiquette unique sur lien bidirectionnel
- **Label unique** : un lien bidirectionnel (Aâ†’B + Bâ†’A) chevauchant naturellement, seule l'Ã©tiquette du premier sens est affichÃ©e â€” plus de doublon de texte au milieu de la courbe

---

## [2.4.2] - 2026-05-06

### PNJs â€” DirectionnalitÃ© des liens
- **FlÃ¨ches sur les liens** : chaque lien porte un embout flÃ¨che (marqueur SVG) colorÃ© de la mÃªme teinte que le lien, pointant vers le personnage cible
- **Liens partant/arrivant sur les bordures des cartes** : les chemins bezier sont tronquÃ©s aux bordures des cartouches (calcul de l'intersection tangente/rectangle) â€” plus de traits qui commencent ou finissent au centre d'une carte
- **Bidirectionnel** : nouvelle case Ã  cocher dans le formulaire de crÃ©ation â€” si cochÃ©e, deux records Firestore sont crÃ©Ã©s (Aâ†’B et Bâ†’A) ; les deux liens reÃ§oivent chacun une flÃ¨che et s'Ã©cartent naturellement grÃ¢ce aux courbes anti-chevauchement

---

## [2.4.1] - 2026-05-06

### PNJs â€” Liens (suite)
- **Palette 16 couleurs** : le sÃ©lecteur de couleur du lien est remplacÃ© par une palette de 16 teintes douces â€” swatches cliquables avec indicateur d'Ã©tat actif
- **Liens parallÃ¨les non chevauchants** : deux liens entre les mÃªmes personnages courbent dans des directions opposÃ©es (courbes de BÃ©zier avec Ã©chelle alternÃ©e Ã—1/âˆ’1/Ã—2/âˆ’2â€¦)
- **Ã‰dition de relation** : en mode admin, un bouton âœ� apparaÃ®t sur chaque relation du panneau latÃ©ral pour modifier type, label, couleur et style sans recrÃ©er la relation

---

## [2.4.0] - 2026-05-06

### PNJs â€” Vue graphe refonte (carte mentale)
- **Cartouches** : les nÅ“uds circulaires sont remplacÃ©s par des cartes rectangulaires affichant portrait, nom et statut Â· lieu
- **Barre accent** : une barre colorÃ©e Ã  gauche de chaque carte reflÃ¨te le colorBy actif (statut, lieu ou groupe)
- **Liens en courbes** : les liens droits sont remplacÃ©s par des courbes de BÃ©zier quadratiques
- **Labels sur les liens** : le type ou label de la relation est affichÃ© directement sur le lien (textPath SVG)
- **Ã‰pinglage aprÃ¨s dÃ©placement** : glisser une carte la fixe en place (comportement carte mentale) ; au chargement initial, le layout s'auto-stabilise puis se fige
- **Trait plus Ã©pais** : stroke-width des liens passÃ© Ã  3.5px (Ã©tait 2px)

### PNJs â€” Personnalisation des liens
- **Couleur custom** : color picker dans le formulaire "Ajouter une relation" â€” la couleur est stockÃ©e dans Firestore et appliquÃ©e dans le graphe et les chips du panneau dÃ©tail
- **Style continu / pointillÃ©** : toggle â”�â”� / â•Œâ•Œ pour choisir le style du trait au moment de la crÃ©ation
- CompatibilitÃ© ascendante : les relations existantes sans couleur ni style continuent d'utiliser les couleurs par type (alliÃ©, ennemi, familleâ€¦)

---

## [2.3.0] - 2026-05-06

### Fiche â€” Journal XP repensÃ©
- **Gains XP journalisÃ©s** : nouveau bouton "+ Gain XP" â€” raison + montant â€” les gains s'affichent en vert dans le journal
- **XP Total calculÃ© automatiquement** : la somme des entrÃ©es de gain remplace le champ manuel
- **XP Disponible = Total gagnÃ© âˆ’ Total dÃ©pensÃ©**, tous deux issus du journal
- **Migration automatique** : les anciennes fiches avec un `xpTotal` manuel sont converties en entrÃ©e "XP initial (migrÃ©)" au premier chargement
- Raccourcis clavier dans le formulaire de gain (EntrÃ©e pour passer au champ suivant / valider)

---

## [2.2.1] - 2026-05-01

### Fix
- **Perte de donnÃ©es corrigÃ©e** : synchronisation cloud/local basÃ©e sur les timestamps â€” si les donnÃ©es locales sont plus rÃ©centes que le cloud (ex: modification dans la fenÃªtre de debounce de 2s), elles sont conservÃ©es et poussÃ©es vers le cloud plutÃ´t qu'Ã©crasÃ©es
- `save()` enregistre dÃ©sormais `_savedAt: Date.now()` dans le localStorage pour comparaison
- `ficheLoadCloud` reÃ§oit le timestamp Firestore (`updatedAt`) et prÃ©fÃ¨re la source la plus fraÃ®che

---

## [2.2.0] - 2026-04-30

### Fiche â€” Section Talents refonte
- **Talents acquis en chips cliquables** : chaque talent s'affiche comme un badge cliquable qui ouvre directement la modale de description â€” plus d'entrÃ©e texte ni de colonne Notes
- **Badge hors carriÃ¨re** : un marqueur `!` orange signale les talents acquis hors carriÃ¨re (info prÃ©servÃ©e dans le state)
- **Ajout manuel** : le bouton "+ Ajouter manuellement" insÃ¨re un champ de saisie inline ; dÃ¨s que le nom est confirmÃ©, il devient un chip cliquable
- **Section "Talents achetables" supprimÃ©e** : redondante avec le panneau de rÃ©fÃ©rence carriÃ¨re et le journal XP

---

# Changelog

Toutes les modifications notables du site sont documentÃ©es dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [2.1.2] - 2026-04-30

### Fiche de Personnage â€” Talents "au choix"
- **SÃ©lecteur de spÃ©cialisation pour les talents** : quand on saisit le nom de base d'un talent qui existe en version "au choix" dans une carriÃ¨re (ex: "MaÃ®tre artisan"), un sÃ©lecteur de spÃ©cialisation apparaÃ®t automatiquement avec les variantes connues + "Autre (personnalisÃ©)â€¦"
- **Persistance `customTalents`** : une spÃ©cialisation de talent saisie manuellement est mÃ©morisÃ©e et rÃ©apparaÃ®t dans le sÃ©lecteur aux prochains achats (sauvegardÃ©e dans le cloud)
- **DÃ©tection carriÃ¨re** : `isTalentInCareer("MaÃ®tre artisan (Forgeron)")` reconnaÃ®t le talent comme dans la carriÃ¨re si celle-ci possÃ¨de "MaÃ®tre artisan (au choix)"

---

## [2.1.1] - 2026-04-30

### Fiche de Personnage â€” CarriÃ¨res
- **Surbrillance des compÃ©tences avancÃ©es achetÃ©es** : les compÃ©tences avancÃ©es dÃ©jÃ  achetÃ©es qui font partie de la carriÃ¨re active sont maintenant surlignÃ©es comme les compÃ©tences de base
- **Panneau carriÃ¨re cumulatif** : Ã  partir du rang 2, le panneau de rÃ©fÃ©rence affiche tous les rangs acquis (rang 1, rang 2â€¦) avec leurs compÃ©tences et talents respectifs, plus le rang en cours â€” chaque rang passÃ© est marquÃ© "âœ“ acquis"

---

## [2.1.0] - 2026-04-30

### Fiche de Personnage â€” CarriÃ¨res & CompÃ©tences
- **SpÃ©cialisations personnalisÃ©es persistantes** : une spÃ©cialisation saisie manuellement dans le journal XP est mÃ©morisÃ©e dans `customSpecs` et rÃ©apparaÃ®t dans le dropdown lors des prochains achats (sauvegardÃ©e dans le cloud)
- **Slots "au choix"** : les entrÃ©es carriÃ¨re de type `MÃ©tier (au choix)` ou `Savoir (RÃ©gion)` sont dÃ©tectÃ©es automatiquement ; un tel slot est considÃ©rÃ© rempli dÃ¨s qu'une compÃ©tence du mÃªme groupe de base est achetÃ©e â€” plus besoin de les saisir deux fois
- **Ghost rows cliquables** : cliquer sur une compÃ©tence carriÃ¨re grisÃ©e (non achetÃ©e) ouvre directement le formulaire XP prÃ©-rempli avec le bon groupe et la spÃ©cialisation ; les slots ouverts s'affichent en ambre avec une `â˜…`
- **Fix correspondance carriÃ¨re** : `isSkillInCareer()` utilise dÃ©sormais le match exact par dÃ©faut ; le match par groupe de base ne s'applique qu'aux slots ouverts (Ã©vitait de faux positifs entre, p.ex., Corps Ã  corps Base et Corps Ã  corps Flambard)
- **Talents "au choix"** : un talent de carriÃ¨re de type `Savoir-vivre (au choix)` reconnaÃ®t tout talent du mÃªme groupe comme Ã©tant dans la carriÃ¨re

---

## [2.0.0] - 2026-04-30

### Sauvegarde cloud â€” Fiche de Personnage
- **Firebase Auth** : bouton "Connexion Google" dans l'en-tÃªte de la fiche ; seul `ethoril@gmail.com` est autorisÃ© pour l'instant
- **Firestore** : la fiche est sauvegardÃ©e dans `fiches/{uid}` avec debounce 2 s aprÃ¨s chaque modification ; rechargement automatique au login
- **Fallback localStorage** : si non connectÃ©, la fiche continue de se sauvegarder localement ; la connexion charge le cloud par-dessus
- **Fix bug** : les avances des compÃ©tences de base ne se restoraient pas aprÃ¨s rechargement de page (`buildBasicSkills` s'exÃ©cutait avant `load`) â€” corrigÃ© en inversant l'ordre d'init

### Technique
- `exportData()` / `resetState()` / `applyData()` extraits de `save()` / `load()` pour permettre le rechargement propre depuis le cloud
- `js/fiche-cloud.js` : nouveau module ES isolÃ© pour toute la logique Firebase de la fiche

> **RÃ¨gle Firestore Ã  ajouter manuellement** dans la console Firebase :
> ```
> match /fiches/{userId} {
>   allow read, write: if request.auth != null && request.auth.uid == userId;
> }
> ```

---

## [1.9.3] - 2026-04-29

### Fiche â€” CarriÃ¨re & Talents
- **Highlighting** : les colonnes de caractÃ©ristiques liÃ©es Ã  la carriÃ¨re et les lignes de compÃ©tences de base concernÃ©es sont mis en Ã©vidence par une couleur de fond
- **CompÃ©tences avancÃ©es fantÃ´me** : les compÃ©tences avancÃ©es de la carriÃ¨re (rangs 1 au rang actuel) non encore achetÃ©es apparaissent en grisÃ© dans la section avancÃ©es â€” non Ã©ditables tant qu'elles ne sont pas achetÃ©es via le journal XP
- **Modale talent** : cliquer sur un talent dans le panneau de carriÃ¨re ouvre une modale avec sa description complÃ¨te (chargÃ©e depuis le mÃªme Google Sheet que l'aide de jeu)
- **Races corrigÃ©es** : Humain.e / Elfe Sylvain.e / Haut.e Elfe / Halfelin.ne / Ogre

---

## [1.9.2] - 2026-04-29

### Fiche â€” CarriÃ¨re
- **AutocomplÃ©tion** : le champ "CarriÃ¨re actuelle" propose les carriÃ¨res connues de la base de donnÃ©es
- **Panneau rÃ©fÃ©rence carriÃ¨re** : quand une carriÃ¨re reconnue est saisie, un panneau s'affiche avec les caractÃ©ristiques, compÃ©tences et talents disponibles pour le rang sÃ©lectionnÃ©

---

## [1.9.1] - 2026-04-29

### Correctif
- **Hotfix `window.WFRP_SKILLS`** : `const` en balise `<script>` ne s'attache pas Ã  `window` â€” ajout de `window.WFRP_SKILLS`, `window.WFRP_SKILL_GROUPS_WITH_SPECS` et `window.WFRP_CAREERS` Ã  la fin des fichiers de donnÃ©es pour que toutes les fonctions de `fiche.js` (autocomplete, dropdown groupe/spÃ©c, dÃ©tection carriÃ¨re) fonctionnent correctement

---

## [1.9.0] - 2026-04-29

### DonnÃ©es & compÃ©tences
- **`skills.js` complet** : 158 entrÃ©es (44 de base + 114 avancÃ©es) issues du sheet officiel â€” chaque spÃ©cialisation est une entrÃ©e distincte avec `group`, `spec`, `nom`, `carac`, `basic`
- **`BASIC_SKILLS` corrigÃ©** : 25 compÃ©tences conformes au sheet (suppression des erreurs d'Ã©dition, ajout Chevaucher/Divertissement/Orientation/Ramer/etc., Corps Ã  corps affichÃ© comme "Corps Ã  corps (Base)")

### Journal XP â€” sÃ©lecteur Ã  deux niveaux
- **Groupe â†’ SpÃ©cialisation** : le formulaire d'achat propose d'abord le groupe de compÃ©tence, puis un dropdown des spÃ©cialisations connues issues de la DB
- **Option "Autre (personnalisÃ©)â€¦"** : permet de crÃ©er une nouvelle spÃ©cialisation non listÃ©e
- CoÃ»t distinguÃ© : compÃ©tences de base 5/10/15â€¦ XP, avancÃ©es 10/15/20â€¦ XP
- DÃ©tection "dans la carriÃ¨re" mise Ã  jour pour le nouveau sÃ©lecteur

### CompÃ©tences avancÃ©es â€” autocomplete
- Le champ de nom de compÃ©tence avancÃ©e supporte maintenant `<datalist>` avec les 158 compÃ©tences de la DB
- La caractÃ©ristique est **auto-remplie** quand un nom reconnu est sÃ©lectionnÃ©

---

## [1.8.0] - 2026-04-28

### AjoutÃ© â€” SystÃ¨me d'avancement XP (fiche de personnage)
- **Base de donnÃ©es compÃ©tences** (`js/data/skills.js`) : 31 compÃ©tences de base + 27 avancÃ©es avec carac associÃ©e et flag spÃ©cialisation
- **Base de donnÃ©es carriÃ¨res** (`js/data/careers.js`) : 3 carriÃ¨res initiales (Agitateur, Artisan, Bourgeois) avec 4 rangs chacune â€” compÃ©tences et talents par rang
- **Calme & Ragot** ajoutÃ©s aux compÃ©tences de base du tableau de fiche
- **Formulaire d'achat XP transactionnel** : sÃ©lection guidÃ©e (type â†’ cible â†’ avances) avec calcul automatique du coÃ»t selon les rÃ¨gles WFRP4 (tranches 25/30/40/50/70/90 pour les caracs, 5/10/15/20/25/30 pour les compÃ©tences â€” Ã—2 hors carriÃ¨re)
- **DÃ©tection automatique "dans la carriÃ¨re"** : la case est prÃ©-cochÃ©e si la compÃ©tence/carac/talent figure dans la carriÃ¨re active au rang actuel
- **Application immÃ©diate sur la fiche** : valider un achat met Ã  jour la carac, la compÃ©tence ou le talent directement
- **Annulation avec revert** : supprimer une entrÃ©e appliquÃ©e (badge âœ“) revient en arriÃ¨re sur la fiche

---

## [1.7.1] - 2026-04-29

### AmÃ©liorÃ© â€” Fiche de personnage
- **Fortune â†’ Chance** (renommage)
- **Historique des carriÃ¨res** : tableau d'anciennes carriÃ¨res (nom, rang atteint, notes)
- **Sorts** : section optionnelle (masquÃ©e par dÃ©faut) avec nom, vent de magie, CN, portÃ©e, durÃ©e, rÃ©sumÃ©
- **PriÃ¨res & Miracles** : section optionnelle avec type (BÃ©nÃ©diction / Miracle) et rÃ©sumÃ©
- **Journal XP** : tableau de dÃ©penses avec type, achat, coÃ»t â€” XP dÃ©pensÃ© auto-calculÃ© depuis le journal
- **Talents** : tableaux "Acquis" et "Achetables" Ã©ditables (ajout/suppression dynamique)

---

## [1.7.0] - 2026-04-29

### AjoutÃ©
- **Fiche de personnage HTML** (`fiche.html`) : premiÃ¨re version interactive
  - 10 caractÃ©ristiques avec base / avances / total auto-calculÃ©
  - Stats dÃ©rivÃ©es : Mouvement (selon race), Blessures max (FB + 2Ã—EB + FMB), trackers Ã©ditables
  - 29 compÃ©tences de base avec valeur de caractÃ©ristique et total auto-calculÃ©s
  - CompÃ©tences avancÃ©es ajoutables dynamiquement
  - Sections Talents et Possessions
  - Sauvegarde automatique en localStorage
- **Le Groupe** : 6Ã¨me carte "Fiche HTML" pointant vers `fiche.html`

---

## [1.6.12] - 2026-04-28

### SupprimÃ©
- **Footer** : retrait de l'attribution Vecteezy (SVG texture non utilisÃ©)

---

## [1.6.11] - 2026-04-28

### AjoutÃ©
- **VidÃ©os** : 3 nouveaux Ã©pisodes â€” Middenheim : La CitÃ© du Loup Blanc (7), Les Vents de Magie (8), Les Voisins de l'Empire (9)

---

## [1.6.10] - 2026-04-28

### CorrigÃ©
- **Le Groupe** : suppression du `max-width: 1100px` codÃ© en dur sur `.character-grid` â€” la grille utilise dÃ©sormais toute la largeur du conteneur (1600 px)

---

## [1.6.9] - 2026-04-28

### ModifiÃ©
- **Mise en page** : largeur maximale Ã©tendue de 1200 px Ã  1600 px â€” meilleure utilisation de l'espace sur les Ã©crans larges, mobile inchangÃ©

---

## [1.6.8] - 2026-04-28

### ModifiÃ©
- **ThÃ¨me parchemin â€” fond** : suppression du SVG Vecteezy, remplacement par un dÃ©gradÃ© CSS en trois teintes (#E9DDC3 â†’ #E7DAC1 â†’ #E2D7BB)

---

## [1.6.7] - 2026-04-28

### AmÃ©liorÃ©
- **ThÃ¨me parchemin â€” texture rÃ©elle** : remplacement de la texture CSS gÃ©nÃ©rÃ©e par un SVG Vecteezy (photo parchemin IA embarquÃ©e en base64) â€” `cover` + `fixed` pour remplir l'Ã©cran
- **Attribution** : lien Vecteezy ajoutÃ© dans le footer, affichÃ© uniquement en thÃ¨me parchemin

---

## [1.6.6] - 2026-04-28

### CorrigÃ©
- **Navbar desktop** : `white-space: nowrap` + `flex-shrink: 0` sur le brand et les liens â€” "LE GROUPE" et "AIDES DE JEUX" ne se replient plus sur deux lignes
- **Navbar desktop** : padding horizontal des liens rÃ©duit (16 px â†’ 10 px) pour laisser plus de place
- **Accueil** : `card-grid` minmax 300 px â†’ 260 px â€” les 4 cartes tiennent sur une ligne dans un conteneur 1200 px

---

## [1.6.5] - 2026-04-28

### AmÃ©liorÃ©
- **ThÃ¨me parchemin â€” texture** : fond de page avec fibres horizontales et surfaces (cartes, panneaux, modals) avec grain fin, gÃ©nÃ©rÃ©s en CSS pur via filtre SVG `feTurbulence` (aucun fichier image supplÃ©mentaire)

---

## [1.6.4] - 2026-04-28

### AjoutÃ©
- **ThÃ¨me parchemin** : deuxiÃ¨me thÃ¨me visuel clair (tons papier vieilli, bordeaux foncÃ©) activable via un bouton â˜€ï¸�/ðŸŒ™ dans la navbar â€” persistÃ© en localStorage sur toutes les pages

---

## [1.6.3] - 2026-04-28

### AmÃ©liorÃ©
- **Graphe PNJs** : les nÅ“uds affichent dÃ©sormais le portrait du personnage clipÃ© en cercle, avec un anneau colorÃ© indiquant le statut (ou la dimension active). Fallback sur le cercle colorÃ© pour les PNJs sans portrait. Anneau pointillÃ© conservÃ© pour les dÃ©cÃ©dÃ©s.

---

## [1.6.2] - 2026-04-28

### AjoutÃ©
- **Cadrage portrait** : sÃ©lecteur de rognage carrÃ© (Cropper.js) affichÃ© au moment de l'upload â€” permet de choisir la zone Ã  conserver avant sauvegarde

---

## [1.6.1] - 2026-04-28

### CorrigÃ©
- **Portraits PNJs** : remplacement d'Uploadcare (clÃ© invalide, images en 404) par Firebase Storage (`europe-west9`) â€” upload et affichage des portraits fonctionnels

---

## [1.6.0] - 2026-04-28

### Technique
- **Ã‰tat centralisÃ©** : les 12 variables globales de `pnjs.js` regroupÃ©es dans un objet `state` â€” dÃ©bogage et lisibilitÃ© amÃ©liorÃ©s
- **Fusion loadData/reloadData** : une seule fonction `loadData({ init })` remplace les deux â€” moins de duplication, gestion d'erreur unifiÃ©e
- **DÃ©lÃ©gation d'Ã©vÃ©nements** : le panneau de dÃ©tail PNJ utilise un unique listener sur le conteneur statique au lieu de rebinder 6-8 handlers Ã  chaque ouverture
- **Module utils.js** : `esc`, `cap`, `stripAccents` extraits dans un module partagÃ© â€” suppression des doublons entre `pnjs.js` et `sheets.js`
- **Recherche insensible aux accents (PNJs)** : "elysia" trouve dÃ©sormais "Ã‰lysia" dans le graphe et le tableau

---

## [1.5.0] - 2026-04-27

### AjoutÃ©
- **PNJs Ã©ditable** : les donnÃ©es sont dÃ©sormais stockÃ©es dans Firestore (Firebase) au lieu de Google Sheets
- **Authentification Google** : bouton "Admin" en toolbar â€” connexion via Google OAuth (email autorisÃ© uniquement)
- **CrÃ©ation / modification de PNJ** : modal complet avec nom, statut, vivant, lieu, groupe social, description, portrait (upload Uploadcare)
- **Suppression de PNJ** : cascade sur toutes les relations du personnage (batch Firestore)
- **Ajout de relation** : formulaire inline dans le panneau de dÃ©tail (cible, type, label)
- **Suppression de relation** : bouton Ã— sur chaque chip de relation (mode admin)
- **Upload portrait** : hÃ©bergement via Uploadcare (serveurs europÃ©ens, GDPR), URL CDN WebP 500 px stockÃ©e dans Firestore
- **Ã‰tat vide** : message affichÃ© si Firestore ne contient aucun PNJ
- Bouton âœ� dans le panneau de dÃ©tail et la vue tableau (admin uniquement)

### Technique
- `js/pnjs.js` converti en module ES (`type="module"`) â€” D3 importÃ© via jsDelivr ESM, Firebase v10.12.0 via gstatic CDN
- Suppression du tag `<script src="d3.v7.min.js">` dans `pnjs.html` (import gÃ©rÃ© dans le module)
- Champs Firestore en minuscules : `nom, statut, vivant, lieu, groupe, description, imageUrl`

---

## [1.4.2] - 2026-04-27

### CorrigÃ©
- **PNJs** : ajout de `main.js` manquant sur `pnjs.html` (toolbar et header invisibles Ã  cause du `fade-in` non dÃ©clenchÃ©)
- **PNJs** : direction des relations affichÃ©e dans le panneau de dÃ©tail (`â†’` si le PNJ courant est source, `â†�` s'il est cible)

---

## [1.4.1] - 2026-04-27

### AmÃ©liorÃ© (PNJs)
- **Toggle Graphe / Tableau** : bascule entre le rÃ©seau interactif et un tableau triÃ© par clic sur les en-tÃªtes
- **Couleur par** : boutons Statut / Lieu / Groupe recolorent les nÅ“uds et animent un clustering spatial par force D3
- Recherche textuelle active dans les deux vues (graphe et tableau)
- Filtres actifs appliquÃ©s au tableau
- Compteur de rÃ©sultats en vue tableau
- Descriptions tronquÃ©es dans le tableau avec texte complet au survol

---

## [1.4.0] - 2026-04-27

### AjoutÃ©
- **Page PNJs** : rÃ©seau interactif force-directed (D3.js) des personnages non-joueurs de la campagne
- DonnÃ©es pilotÃ©es par deux onglets Google Sheets (`pnjs` et `relations`)
- Filtres dynamiques par Statut, Vivant, Lieu et Groupe Social
- Recherche textuelle par nom et description
- Panneau de dÃ©tail latÃ©ral avec portrait, badges, description et relations cliquables
- Navigation entre fiches PNJs via les chips de relations
- NÅ“uds Ã  opacitÃ© rÃ©duite pour les PNJs dÃ©cÃ©dÃ©s (cercle en pointillÃ©s) ou au statut inconnu
- LÃ©gende intÃ©grÃ©e dans le graphe

---

## [1.3.1] - 2026-04-27

### AjoutÃ©
- **Favicon** : icÃ´ne âšœ SVG (fleur de lys dorÃ©e sur fond sombre) affichÃ©e dans l'onglet du navigateur sur toutes les pages

---

## [1.3.0] - 2026-04-27

### AjoutÃ©
- **Page "Cartes"** : nouvelle page avec visionneuse interactive (Leaflet.js) pour deux cartes haute rÃ©solution
- **Carte de l'Empire** : 14 400Ã—14 400 px, 1 365 tuiles WebP sur 6 niveaux de zoom
- **Carte du Vieux Monde** : 32 000Ã—28 050 px, 1 253 tuiles WebP sur 6 niveaux de zoom
- Lien "Cartes" ajoutÃ© Ã  la navigation sur toutes les pages

---

## [1.2.5] - 2026-04-27

### CorrigÃ©
- **Aides de Jeux** : l'onglet "CoÃ»ts XP" localise dÃ©sormais ses colonnes par nom de header â€” rÃ©sistant aux rÃ©organisations du Google Sheet
- **RÃ¨gles** : fermeture d'un accordÃ©on aprÃ¨s ouverture d'une table de critique s'anime correctement (transition fluide au lieu d'un saut)

---

## [1.2.4] - 2026-04-27

### CorrigÃ©
- **Aides de Jeux** : Ã©chappement HTML sur toutes les valeurs injectÃ©es depuis Google Sheets â€” une cellule contenant `<` ou `>` ne peut plus briser la mise en page
- **Accueil** : suppression du texte "(soonâ„¢ pour Ã§a)"

---

## [1.2.3] - 2026-04-27

### AmÃ©liorÃ©
- **Accueil** : date de la prochaine session lue dynamiquement depuis Google Sheets (onglet "date prochaine session", cellule B1) â€” plus besoin de modifier le code pour la mettre Ã  jour

---

## [1.2.2] - 2026-04-27

### AmÃ©liorÃ©
- **Le Groupe** : portraits convertis en WebP (-96% de poids, 18 MB â†’ 774 KB) avec fallback PNG pour les navigateurs anciens
- **Le Groupe** : attribut `loading="lazy"` ajoutÃ© sur tous les portraits

---

## [1.2.1] - 2026-04-27

### ModifiÃ©
- **Technique** : navbar et footer centralisÃ©s dans `js/layout.js` (source unique pour la version, les liens de navigation et le contenu du footer)

---

## [1.2.0] - 2026-03-29

### AjoutÃ©
- **Le Groupe** : les vignettes de personnages sont dÃ©sormais cliquables et ouvrent la fiche de perso Google Sheets correspondante (nouvel onglet)

---

## [1.1.1] - 2026-02-28

### AjoutÃ©
- **Aides de Jeux** : 2 nouveaux onglets â€” Armures (ðŸ›¡ï¸�) et Talents (ðŸŽ­)

---

## [1.1.0] - 2026-02-27

### AjoutÃ©
- **Page "Le Groupe"** : nouvelle page avec les portraits des 5 personnages (Bhelgi, Caelel, Elysia, Hellaya, Wren) en vignettes circulaires
- Lien "Le Groupe" ajoutÃ© Ã  la navigation sur toutes les pages

---

## [1.0.0] - 2026-02-27

### AmÃ©liorÃ©
- **Accueil mobile** : espaces rÃ©duits pour voir les cartouches sans scroller
- **Aides de Jeux** : bouton "Ouvrir dans Google Sheets (idÃ©al sur PC)" dÃ©placÃ© au-dessus des onglets
- **Magie** : fond des cartouches de sort teintÃ© selon le Vent de Magie (Aqshy=rouge, Azyr=bleu, Chamon=or, Ghur=ambre, Ghyran=vert, Hysh=blanc, Shyish=violet, Ulgu=gris)

---

## [0.11.0] - 2026-02-27

### AjoutÃ©
- **Tables de Mutations** dans la section Corruption : Physiques (55 entrÃ©es), Sous-tableau TÃªte Bestiale (10 animaux), Mentales (34 entrÃ©es)
- Colonnes par Dieu du Chaos (Universel, Khorne, Nurgle, Slaanesh, Tzeentch)
- Notes de visibilitÃ© (Â¹ cachable, Â² dÃ©marche, Â³ incachable)

---

## [0.10.0] - 2026-02-27

### AjoutÃ©
- **Tables des Incantations Imparfaites** : 2 tables collapsibles (Mineures + Majeures, 20 entrÃ©es chacune) dans la section Magie

### ModifiÃ©
- Section "Blessures & Coups Critiques" renommÃ©e â†’ "SantÃ©, Critiques et Survie"

---

## [0.9.0] - 2026-02-27

### AjoutÃ©
- **Tables des Coups Critiques** : 4 tables collapsibles (TÃªte, Bras, Corps, Jambe) dans la section Combat
- Section renommÃ©e "Localisation des dÃ©gÃ¢ts & Tables Critiques"
- Chaque table avec 20 entrÃ©es (D100, Nom, Effet)

---

## [0.8.0] - 2026-02-27

### CorrigÃ©
- Onglet CoÃ»ts XP : sÃ©paration en 2 tableaux distincts + correction coÃ»t "+1 Talent" manquant
- Recherche insensible aux accents (ex: "regeneration" â†’ "rÃ©gÃ©nÃ©ration")
- Gestion des CSV corrompus par le format de cellules Google Sheets
- Onglets en wrap (multi-lignes) sur mobile, plus de scroll horizontal

---

## [0.7.0] - 2026-02-27

### AjoutÃ©
- **Aides de Jeux dynamique** : remplacement de l'iframe Google Sheets par un affichage custom
- 6 onglets cliquables (CoÃ»ts XP, Magie, Miracles, Armes CÃ C, Armes Ã  Distance, Mots ClÃ©s)
- DonnÃ©es chargÃ©es en temps rÃ©el depuis Google Sheets (API CSV)
- Cartes responsives pour chaque sort, arme, miracle
- Barre de recherche avec filtrage instantanÃ©
- Bouton "Ouvrir dans Google Sheets"
- Spinner de chargement

---

## [0.6.0] - 2026-02-26

### ModifiÃ©
- Passage complet au tutoiement sur toutes les pages (accueil, vidÃ©os, rÃ¨gles, aides de jeux)
- Correction d'encodage UTF-8 sur tous les fichiers HTML

---

## [0.5.0] - 2026-02-26

### ModifiÃ©
- Titre hero : "Ennemi IntÃ©rieur" (simplifiÃ©)
- Texte d'accueil : ton informel, tutoiement, mention feuille de perso (soonâ„¢)
- Hero rÃ©duit en hauteur pour rapprocher les cartes
- Carte VidÃ©os : tutoiement + "..."
- Carte RÃ¨gles renommÃ©e â†’ "RÃ¨gles du Jeu"

---

## [0.4.0] - 2026-02-26

### ModifiÃ©
- Onglet "Tableau" renommÃ© en "Aides de Jeux" (navbar + page d'accueil)
- Titre et description de la page mis Ã  jour
- Google Sheet Ã©largi Ã  95% de la largeur de la page

---

## [0.3.0] - 2026-02-26

### AjoutÃ©
- Badge de version affichÃ© dans la navbar (en haut Ã  droite) sur toutes les pages
- Style `.nav-version` dans le design system

---

## [1.0.0] - 2026-02-26

### CorrigÃ©
- Miniatures YouTube : utilisation de `hqdefault.jpg` (toujours disponible) au lieu de `maxresdefault.jpg`

### AjoutÃ©
- Script de dÃ©ploiement `deploy.ps1`

---

## [0.1.0] - 2026-02-26

### AjoutÃ©
- **Page d'accueil** : hero section + 3 cartes de navigation
- **Page VidÃ©os** : galerie de 6 vidÃ©os YouTube avec modal lightbox
- **Page Tableau** : intÃ©gration Google Sheets en lecture seule
- **Page RÃ¨gles** : 5 sections en accordÃ©on (Combat, Critiques, Magie, Peur, Corruption)
- **Design system** : thÃ¨me dark fantasy (Cinzel + Crimson Text, palette or/bordeaux/noir)
- **Anti-indexation** : `robots.txt` + meta `noindex, nofollow` sur chaque page
- **Navigation** : navbar responsive avec burger menu mobile
- **Animations** : scroll reveal, hover effects, transitions fluides


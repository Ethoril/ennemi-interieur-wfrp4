## [2.2.1] - 2026-05-01

### Fix
- **Perte de données corrigée** : synchronisation cloud/local basée sur les timestamps — si les données locales sont plus récentes que le cloud (ex: modification dans la fenêtre de debounce de 2s), elles sont conservées et poussées vers le cloud plutôt qu'écrasées
- `save()` enregistre désormais `_savedAt: Date.now()` dans le localStorage pour comparaison
- `ficheLoadCloud` reçoit le timestamp Firestore (`updatedAt`) et préfère la source la plus fraîche

---

## [2.2.0] - 2026-04-30

### Fiche — Section Talents refonte
- **Talents acquis en chips cliquables** : chaque talent s'affiche comme un badge cliquable qui ouvre directement la modale de description — plus d'entrée texte ni de colonne Notes
- **Badge hors carrière** : un marqueur `!` orange signale les talents acquis hors carrière (info préservée dans le state)
- **Ajout manuel** : le bouton "+ Ajouter manuellement" insère un champ de saisie inline ; dès que le nom est confirmé, il devient un chip cliquable
- **Section "Talents achetables" supprimée** : redondante avec le panneau de référence carrière et le journal XP

---

# Changelog

Toutes les modifications notables du site sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [2.1.2] - 2026-04-30

### Fiche de Personnage — Talents "au choix"
- **Sélecteur de spécialisation pour les talents** : quand on saisit le nom de base d'un talent qui existe en version "au choix" dans une carrière (ex: "Maître artisan"), un sélecteur de spécialisation apparaît automatiquement avec les variantes connues + "Autre (personnalisé)…"
- **Persistance `customTalents`** : une spécialisation de talent saisie manuellement est mémorisée et réapparaît dans le sélecteur aux prochains achats (sauvegardée dans le cloud)
- **Détection carrière** : `isTalentInCareer("Maître artisan (Forgeron)")` reconnaît le talent comme dans la carrière si celle-ci possède "Maître artisan (au choix)"

---

## [2.1.1] - 2026-04-30

### Fiche de Personnage — Carrières
- **Surbrillance des compétences avancées achetées** : les compétences avancées déjà achetées qui font partie de la carrière active sont maintenant surlignées comme les compétences de base
- **Panneau carrière cumulatif** : à partir du rang 2, le panneau de référence affiche tous les rangs acquis (rang 1, rang 2…) avec leurs compétences et talents respectifs, plus le rang en cours — chaque rang passé est marqué "✓ acquis"

---

## [2.1.0] - 2026-04-30

### Fiche de Personnage — Carrières & Compétences
- **Spécialisations personnalisées persistantes** : une spécialisation saisie manuellement dans le journal XP est mémorisée dans `customSpecs` et réapparaît dans le dropdown lors des prochains achats (sauvegardée dans le cloud)
- **Slots "au choix"** : les entrées carrière de type `Métier (au choix)` ou `Savoir (Région)` sont détectées automatiquement ; un tel slot est considéré rempli dès qu'une compétence du même groupe de base est achetée — plus besoin de les saisir deux fois
- **Ghost rows cliquables** : cliquer sur une compétence carrière grisée (non achetée) ouvre directement le formulaire XP pré-rempli avec le bon groupe et la spécialisation ; les slots ouverts s'affichent en ambre avec une `★`
- **Fix correspondance carrière** : `isSkillInCareer()` utilise désormais le match exact par défaut ; le match par groupe de base ne s'applique qu'aux slots ouverts (évitait de faux positifs entre, p.ex., Corps à corps Base et Corps à corps Flambard)
- **Talents "au choix"** : un talent de carrière de type `Savoir-vivre (au choix)` reconnaît tout talent du même groupe comme étant dans la carrière

---

## [2.0.0] - 2026-04-30

### Sauvegarde cloud — Fiche de Personnage
- **Firebase Auth** : bouton "Connexion Google" dans l'en-tête de la fiche ; seul `ethoril@gmail.com` est autorisé pour l'instant
- **Firestore** : la fiche est sauvegardée dans `fiches/{uid}` avec debounce 2 s après chaque modification ; rechargement automatique au login
- **Fallback localStorage** : si non connecté, la fiche continue de se sauvegarder localement ; la connexion charge le cloud par-dessus
- **Fix bug** : les avances des compétences de base ne se restoraient pas après rechargement de page (`buildBasicSkills` s'exécutait avant `load`) — corrigé en inversant l'ordre d'init

### Technique
- `exportData()` / `resetState()` / `applyData()` extraits de `save()` / `load()` pour permettre le rechargement propre depuis le cloud
- `js/fiche-cloud.js` : nouveau module ES isolé pour toute la logique Firebase de la fiche

> **Règle Firestore à ajouter manuellement** dans la console Firebase :
> ```
> match /fiches/{userId} {
>   allow read, write: if request.auth != null && request.auth.uid == userId;
> }
> ```

---

## [1.9.3] - 2026-04-29

### Fiche — Carrière & Talents
- **Highlighting** : les colonnes de caractéristiques liées à la carrière et les lignes de compétences de base concernées sont mis en évidence par une couleur de fond
- **Compétences avancées fantôme** : les compétences avancées de la carrière (rangs 1 au rang actuel) non encore achetées apparaissent en grisé dans la section avancées — non éditables tant qu'elles ne sont pas achetées via le journal XP
- **Modale talent** : cliquer sur un talent dans le panneau de carrière ouvre une modale avec sa description complète (chargée depuis le même Google Sheet que l'aide de jeu)
- **Races corrigées** : Humain.e / Elfe Sylvain.e / Haut.e Elfe / Halfelin.ne / Ogre

---

## [1.9.2] - 2026-04-29

### Fiche — Carrière
- **Autocomplétion** : le champ "Carrière actuelle" propose les carrières connues de la base de données
- **Panneau référence carrière** : quand une carrière reconnue est saisie, un panneau s'affiche avec les caractéristiques, compétences et talents disponibles pour le rang sélectionné

---

## [1.9.1] - 2026-04-29

### Correctif
- **Hotfix `window.WFRP_SKILLS`** : `const` en balise `<script>` ne s'attache pas à `window` — ajout de `window.WFRP_SKILLS`, `window.WFRP_SKILL_GROUPS_WITH_SPECS` et `window.WFRP_CAREERS` à la fin des fichiers de données pour que toutes les fonctions de `fiche.js` (autocomplete, dropdown groupe/spéc, détection carrière) fonctionnent correctement

---

## [1.9.0] - 2026-04-29

### Données & compétences
- **`skills.js` complet** : 158 entrées (44 de base + 114 avancées) issues du sheet officiel — chaque spécialisation est une entrée distincte avec `group`, `spec`, `nom`, `carac`, `basic`
- **`BASIC_SKILLS` corrigé** : 25 compétences conformes au sheet (suppression des erreurs d'édition, ajout Chevaucher/Divertissement/Orientation/Ramer/etc., Corps à corps affiché comme "Corps à corps (Base)")

### Journal XP — sélecteur à deux niveaux
- **Groupe → Spécialisation** : le formulaire d'achat propose d'abord le groupe de compétence, puis un dropdown des spécialisations connues issues de la DB
- **Option "Autre (personnalisé)…"** : permet de créer une nouvelle spécialisation non listée
- Coût distingué : compétences de base 5/10/15… XP, avancées 10/15/20… XP
- Détection "dans la carrière" mise à jour pour le nouveau sélecteur

### Compétences avancées — autocomplete
- Le champ de nom de compétence avancée supporte maintenant `<datalist>` avec les 158 compétences de la DB
- La caractéristique est **auto-remplie** quand un nom reconnu est sélectionné

---

## [1.8.0] - 2026-04-28

### Ajouté — Système d'avancement XP (fiche de personnage)
- **Base de données compétences** (`js/data/skills.js`) : 31 compétences de base + 27 avancées avec carac associée et flag spécialisation
- **Base de données carrières** (`js/data/careers.js`) : 3 carrières initiales (Agitateur, Artisan, Bourgeois) avec 4 rangs chacune — compétences et talents par rang
- **Calme & Ragot** ajoutés aux compétences de base du tableau de fiche
- **Formulaire d'achat XP transactionnel** : sélection guidée (type → cible → avances) avec calcul automatique du coût selon les règles WFRP4 (tranches 25/30/40/50/70/90 pour les caracs, 5/10/15/20/25/30 pour les compétences — ×2 hors carrière)
- **Détection automatique "dans la carrière"** : la case est pré-cochée si la compétence/carac/talent figure dans la carrière active au rang actuel
- **Application immédiate sur la fiche** : valider un achat met à jour la carac, la compétence ou le talent directement
- **Annulation avec revert** : supprimer une entrée appliquée (badge ✓) revient en arrière sur la fiche

---

## [1.7.1] - 2026-04-29

### Amélioré — Fiche de personnage
- **Fortune → Chance** (renommage)
- **Historique des carrières** : tableau d'anciennes carrières (nom, rang atteint, notes)
- **Sorts** : section optionnelle (masquée par défaut) avec nom, vent de magie, CN, portée, durée, résumé
- **Prières & Miracles** : section optionnelle avec type (Bénédiction / Miracle) et résumé
- **Journal XP** : tableau de dépenses avec type, achat, coût — XP dépensé auto-calculé depuis le journal
- **Talents** : tableaux "Acquis" et "Achetables" éditables (ajout/suppression dynamique)

---

## [1.7.0] - 2026-04-29

### Ajouté
- **Fiche de personnage HTML** (`fiche.html`) : première version interactive
  - 10 caractéristiques avec base / avances / total auto-calculé
  - Stats dérivées : Mouvement (selon race), Blessures max (FB + 2×EB + FMB), trackers éditables
  - 29 compétences de base avec valeur de caractéristique et total auto-calculés
  - Compétences avancées ajoutables dynamiquement
  - Sections Talents et Possessions
  - Sauvegarde automatique en localStorage
- **Le Groupe** : 6ème carte "Fiche HTML" pointant vers `fiche.html`

---

## [1.6.12] - 2026-04-28

### Supprimé
- **Footer** : retrait de l'attribution Vecteezy (SVG texture non utilisé)

---

## [1.6.11] - 2026-04-28

### Ajouté
- **Vidéos** : 3 nouveaux épisodes — Middenheim : La Cité du Loup Blanc (7), Les Vents de Magie (8), Les Voisins de l'Empire (9)

---

## [1.6.10] - 2026-04-28

### Corrigé
- **Le Groupe** : suppression du `max-width: 1100px` codé en dur sur `.character-grid` — la grille utilise désormais toute la largeur du conteneur (1600 px)

---

## [1.6.9] - 2026-04-28

### Modifié
- **Mise en page** : largeur maximale étendue de 1200 px à 1600 px — meilleure utilisation de l'espace sur les écrans larges, mobile inchangé

---

## [1.6.8] - 2026-04-28

### Modifié
- **Thème parchemin — fond** : suppression du SVG Vecteezy, remplacement par un dégradé CSS en trois teintes (#E9DDC3 → #E7DAC1 → #E2D7BB)

---

## [1.6.7] - 2026-04-28

### Amélioré
- **Thème parchemin — texture réelle** : remplacement de la texture CSS générée par un SVG Vecteezy (photo parchemin IA embarquée en base64) — `cover` + `fixed` pour remplir l'écran
- **Attribution** : lien Vecteezy ajouté dans le footer, affiché uniquement en thème parchemin

---

## [1.6.6] - 2026-04-28

### Corrigé
- **Navbar desktop** : `white-space: nowrap` + `flex-shrink: 0` sur le brand et les liens — "LE GROUPE" et "AIDES DE JEUX" ne se replient plus sur deux lignes
- **Navbar desktop** : padding horizontal des liens réduit (16 px → 10 px) pour laisser plus de place
- **Accueil** : `card-grid` minmax 300 px → 260 px — les 4 cartes tiennent sur une ligne dans un conteneur 1200 px

---

## [1.6.5] - 2026-04-28

### Amélioré
- **Thème parchemin — texture** : fond de page avec fibres horizontales et surfaces (cartes, panneaux, modals) avec grain fin, générés en CSS pur via filtre SVG `feTurbulence` (aucun fichier image supplémentaire)

---

## [1.6.4] - 2026-04-28

### Ajouté
- **Thème parchemin** : deuxième thème visuel clair (tons papier vieilli, bordeaux foncé) activable via un bouton ☀️/🌙 dans la navbar — persisté en localStorage sur toutes les pages

---

## [1.6.3] - 2026-04-28

### Amélioré
- **Graphe PNJs** : les nœuds affichent désormais le portrait du personnage clipé en cercle, avec un anneau coloré indiquant le statut (ou la dimension active). Fallback sur le cercle coloré pour les PNJs sans portrait. Anneau pointillé conservé pour les décédés.

---

## [1.6.2] - 2026-04-28

### Ajouté
- **Cadrage portrait** : sélecteur de rognage carré (Cropper.js) affiché au moment de l'upload — permet de choisir la zone à conserver avant sauvegarde

---

## [1.6.1] - 2026-04-28

### Corrigé
- **Portraits PNJs** : remplacement d'Uploadcare (clé invalide, images en 404) par Firebase Storage (`europe-west9`) — upload et affichage des portraits fonctionnels

---

## [1.6.0] - 2026-04-28

### Technique
- **État centralisé** : les 12 variables globales de `pnjs.js` regroupées dans un objet `state` — débogage et lisibilité améliorés
- **Fusion loadData/reloadData** : une seule fonction `loadData({ init })` remplace les deux — moins de duplication, gestion d'erreur unifiée
- **Délégation d'événements** : le panneau de détail PNJ utilise un unique listener sur le conteneur statique au lieu de rebinder 6-8 handlers à chaque ouverture
- **Module utils.js** : `esc`, `cap`, `stripAccents` extraits dans un module partagé — suppression des doublons entre `pnjs.js` et `sheets.js`
- **Recherche insensible aux accents (PNJs)** : "elysia" trouve désormais "Élysia" dans le graphe et le tableau

---

## [1.5.0] - 2026-04-27

### Ajouté
- **PNJs éditable** : les données sont désormais stockées dans Firestore (Firebase) au lieu de Google Sheets
- **Authentification Google** : bouton "Admin" en toolbar — connexion via Google OAuth (email autorisé uniquement)
- **Création / modification de PNJ** : modal complet avec nom, statut, vivant, lieu, groupe social, description, portrait (upload Uploadcare)
- **Suppression de PNJ** : cascade sur toutes les relations du personnage (batch Firestore)
- **Ajout de relation** : formulaire inline dans le panneau de détail (cible, type, label)
- **Suppression de relation** : bouton × sur chaque chip de relation (mode admin)
- **Upload portrait** : hébergement via Uploadcare (serveurs européens, GDPR), URL CDN WebP 500 px stockée dans Firestore
- **État vide** : message affiché si Firestore ne contient aucun PNJ
- Bouton ✏ dans le panneau de détail et la vue tableau (admin uniquement)

### Technique
- `js/pnjs.js` converti en module ES (`type="module"`) — D3 importé via jsDelivr ESM, Firebase v10.12.0 via gstatic CDN
- Suppression du tag `<script src="d3.v7.min.js">` dans `pnjs.html` (import géré dans le module)
- Champs Firestore en minuscules : `nom, statut, vivant, lieu, groupe, description, imageUrl`

---

## [1.4.2] - 2026-04-27

### Corrigé
- **PNJs** : ajout de `main.js` manquant sur `pnjs.html` (toolbar et header invisibles à cause du `fade-in` non déclenché)
- **PNJs** : direction des relations affichée dans le panneau de détail (`→` si le PNJ courant est source, `←` s'il est cible)

---

## [1.4.1] - 2026-04-27

### Amélioré (PNJs)
- **Toggle Graphe / Tableau** : bascule entre le réseau interactif et un tableau trié par clic sur les en-têtes
- **Couleur par** : boutons Statut / Lieu / Groupe recolorent les nœuds et animent un clustering spatial par force D3
- Recherche textuelle active dans les deux vues (graphe et tableau)
- Filtres actifs appliqués au tableau
- Compteur de résultats en vue tableau
- Descriptions tronquées dans le tableau avec texte complet au survol

---

## [1.4.0] - 2026-04-27

### Ajouté
- **Page PNJs** : réseau interactif force-directed (D3.js) des personnages non-joueurs de la campagne
- Données pilotées par deux onglets Google Sheets (`pnjs` et `relations`)
- Filtres dynamiques par Statut, Vivant, Lieu et Groupe Social
- Recherche textuelle par nom et description
- Panneau de détail latéral avec portrait, badges, description et relations cliquables
- Navigation entre fiches PNJs via les chips de relations
- Nœuds à opacité réduite pour les PNJs décédés (cercle en pointillés) ou au statut inconnu
- Légende intégrée dans le graphe

---

## [1.3.1] - 2026-04-27

### Ajouté
- **Favicon** : icône ⚜ SVG (fleur de lys dorée sur fond sombre) affichée dans l'onglet du navigateur sur toutes les pages

---

## [1.3.0] - 2026-04-27

### Ajouté
- **Page "Cartes"** : nouvelle page avec visionneuse interactive (Leaflet.js) pour deux cartes haute résolution
- **Carte de l'Empire** : 14 400×14 400 px, 1 365 tuiles WebP sur 6 niveaux de zoom
- **Carte du Vieux Monde** : 32 000×28 050 px, 1 253 tuiles WebP sur 6 niveaux de zoom
- Lien "Cartes" ajouté à la navigation sur toutes les pages

---

## [1.2.5] - 2026-04-27

### Corrigé
- **Aides de Jeux** : l'onglet "Coûts XP" localise désormais ses colonnes par nom de header — résistant aux réorganisations du Google Sheet
- **Règles** : fermeture d'un accordéon après ouverture d'une table de critique s'anime correctement (transition fluide au lieu d'un saut)

---

## [1.2.4] - 2026-04-27

### Corrigé
- **Aides de Jeux** : échappement HTML sur toutes les valeurs injectées depuis Google Sheets — une cellule contenant `<` ou `>` ne peut plus briser la mise en page
- **Accueil** : suppression du texte "(soon™ pour ça)"

---

## [1.2.3] - 2026-04-27

### Amélioré
- **Accueil** : date de la prochaine session lue dynamiquement depuis Google Sheets (onglet "date prochaine session", cellule B1) — plus besoin de modifier le code pour la mettre à jour

---

## [1.2.2] - 2026-04-27

### Amélioré
- **Le Groupe** : portraits convertis en WebP (-96% de poids, 18 MB → 774 KB) avec fallback PNG pour les navigateurs anciens
- **Le Groupe** : attribut `loading="lazy"` ajouté sur tous les portraits

---

## [1.2.1] - 2026-04-27

### Modifié
- **Technique** : navbar et footer centralisés dans `js/layout.js` (source unique pour la version, les liens de navigation et le contenu du footer)

---

## [1.2.0] - 2026-03-29

### Ajouté
- **Le Groupe** : les vignettes de personnages sont désormais cliquables et ouvrent la fiche de perso Google Sheets correspondante (nouvel onglet)

---

## [1.1.1] - 2026-02-28

### Ajouté
- **Aides de Jeux** : 2 nouveaux onglets — Armures (🛡️) et Talents (🎭)

---

## [1.1.0] - 2026-02-27

### Ajouté
- **Page "Le Groupe"** : nouvelle page avec les portraits des 5 personnages (Bhelgi, Caelel, Elysia, Hellaya, Wren) en vignettes circulaires
- Lien "Le Groupe" ajouté à la navigation sur toutes les pages

---

## [1.0.0] - 2026-02-27

### Amélioré
- **Accueil mobile** : espaces réduits pour voir les cartouches sans scroller
- **Aides de Jeux** : bouton "Ouvrir dans Google Sheets (idéal sur PC)" déplacé au-dessus des onglets
- **Magie** : fond des cartouches de sort teinté selon le Vent de Magie (Aqshy=rouge, Azyr=bleu, Chamon=or, Ghur=ambre, Ghyran=vert, Hysh=blanc, Shyish=violet, Ulgu=gris)

---

## [0.11.0] - 2026-02-27

### Ajouté
- **Tables de Mutations** dans la section Corruption : Physiques (55 entrées), Sous-tableau Tête Bestiale (10 animaux), Mentales (34 entrées)
- Colonnes par Dieu du Chaos (Universel, Khorne, Nurgle, Slaanesh, Tzeentch)
- Notes de visibilité (¹ cachable, ² démarche, ³ incachable)

---

## [0.10.0] - 2026-02-27

### Ajouté
- **Tables des Incantations Imparfaites** : 2 tables collapsibles (Mineures + Majeures, 20 entrées chacune) dans la section Magie

### Modifié
- Section "Blessures & Coups Critiques" renommée → "Santé, Critiques et Survie"

---

## [0.9.0] - 2026-02-27

### Ajouté
- **Tables des Coups Critiques** : 4 tables collapsibles (Tête, Bras, Corps, Jambe) dans la section Combat
- Section renommée "Localisation des dégâts & Tables Critiques"
- Chaque table avec 20 entrées (D100, Nom, Effet)

---

## [0.8.0] - 2026-02-27

### Corrigé
- Onglet Coûts XP : séparation en 2 tableaux distincts + correction coût "+1 Talent" manquant
- Recherche insensible aux accents (ex: "regeneration" → "régénération")
- Gestion des CSV corrompus par le format de cellules Google Sheets
- Onglets en wrap (multi-lignes) sur mobile, plus de scroll horizontal

---

## [0.7.0] - 2026-02-27

### Ajouté
- **Aides de Jeux dynamique** : remplacement de l'iframe Google Sheets par un affichage custom
- 6 onglets cliquables (Coûts XP, Magie, Miracles, Armes CàC, Armes à Distance, Mots Clés)
- Données chargées en temps réel depuis Google Sheets (API CSV)
- Cartes responsives pour chaque sort, arme, miracle
- Barre de recherche avec filtrage instantané
- Bouton "Ouvrir dans Google Sheets"
- Spinner de chargement

---

## [0.6.0] - 2026-02-26

### Modifié
- Passage complet au tutoiement sur toutes les pages (accueil, vidéos, règles, aides de jeux)
- Correction d'encodage UTF-8 sur tous les fichiers HTML

---

## [0.5.0] - 2026-02-26

### Modifié
- Titre hero : "Ennemi Intérieur" (simplifié)
- Texte d'accueil : ton informel, tutoiement, mention feuille de perso (soon™)
- Hero réduit en hauteur pour rapprocher les cartes
- Carte Vidéos : tutoiement + "..."
- Carte Règles renommée → "Règles du Jeu"

---

## [0.4.0] - 2026-02-26

### Modifié
- Onglet "Tableau" renommé en "Aides de Jeux" (navbar + page d'accueil)
- Titre et description de la page mis à jour
- Google Sheet élargi à 95% de la largeur de la page

---

## [0.3.0] - 2026-02-26

### Ajouté
- Badge de version affiché dans la navbar (en haut à droite) sur toutes les pages
- Style `.nav-version` dans le design system

---

## [1.0.0] - 2026-02-26

### Corrigé
- Miniatures YouTube : utilisation de `hqdefault.jpg` (toujours disponible) au lieu de `maxresdefault.jpg`

### Ajouté
- Script de déploiement `deploy.ps1`

---

## [0.1.0] - 2026-02-26

### Ajouté
- **Page d'accueil** : hero section + 3 cartes de navigation
- **Page Vidéos** : galerie de 6 vidéos YouTube avec modal lightbox
- **Page Tableau** : intégration Google Sheets en lecture seule
- **Page Règles** : 5 sections en accordéon (Combat, Critiques, Magie, Peur, Corruption)
- **Design system** : thème dark fantasy (Cinzel + Crimson Text, palette or/bordeaux/noir)
- **Anti-indexation** : `robots.txt` + meta `noindex, nofollow` sur chaque page
- **Navigation** : navbar responsive avec burger menu mobile
- **Animations** : scroll reveal, hover effects, transitions fluides

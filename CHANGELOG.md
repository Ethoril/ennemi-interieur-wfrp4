# Changelog

Toutes les modifications notables du site sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [0.2.0] - 2026-02-27

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

## [0.2.0] - 2026-02-26

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

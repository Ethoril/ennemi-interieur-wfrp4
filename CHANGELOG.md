# Changelog

Toutes les modifications notables du site sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

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

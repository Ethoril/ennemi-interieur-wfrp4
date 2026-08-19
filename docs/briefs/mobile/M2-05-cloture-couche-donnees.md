# M2-05 — Clôture de la couche de données commune

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et les briefs M2-01 à M2-04.

| | |
|---|---|
| Lot | M2 — Couche de données commune |
| Objectif | Stabiliser les contrats partagés avant que le mobile en dépende |
| Estimation | 0,5 jour |
| Fichiers | `CHANGELOG.md`, `js/layout.js`, `sw.js`, documentation des dépôts |
| Dépend de | M2-04 |

## À faire

### 1. Auditer les frontières

Vérifier que les dépôts n'importent aucun élément DOM et que les vues PNJs/Enquêtes ne construisent
plus elles-mêmes de requête Firestore ou de chemin Storage. Documenter chaque API publique, son rôle,
ses données normalisées, ses erreurs et l'obligation de désabonnement.

### 2. Tester le partage réel

Créer un test minimal qui instancie chaque dépôt avec un double public puis MJ. Vérifier les requêtes,
la séparation des notes, les timestamps, conflits futurs, métadonnées de cache et libération des
ressources. Les tests de règles M1 restent verts.

### 3. Rejouer la recette bureau

Sur PNJs et Enquêtes : visiteur, non-MJ, MJ, deux fenêtres, perte/reprise réseau, données modifiées à
distance, suppression du document courant et déconnexion pendant un affichage privé. Contrôler deux
thèmes, 375 px, console et absence de fuite après déconnexion.

### 4. Livrer le lot

Incrémenter `APP_VERSION` dans `js/layout.js`, aligner `sw.js`, mettre à jour `CHANGELOG.md`, puis
exécuter lint, check, smoke tests et tests Firebase. Vérifier que la nouvelle liste de modules partagés
est bien couverte par la stratégie de cache actuelle ou toujours accessible en ligne après déploiement.

## Checklist de sortie

- [ ] Contrats des quatre dépôts documentés.
- [ ] Aucun singleton caché dans la couche `js/data/`.
- [ ] Aucun accès direct résiduel aux collections ciblées dans les deux vues.
- [ ] Abonnements et URLs objet libérés dans tous les parcours.
- [ ] Tests unitaires, intégration et règles verts.
- [ ] Recette bureau et temps réel validée.
- [ ] Version, cache et changelog cohérents.

## Critères d'acceptation

Une vue entièrement nouvelle peut utiliser les dépôts avec seulement un client Firebase injecté et
des callbacks, sans recopier de règle métier ni connaître les détails du stockage.

## Commit

`chore(release): cloturer la couche de donnees partagee (M2-05)`

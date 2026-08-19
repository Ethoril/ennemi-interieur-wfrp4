# M5-03 — Clôture des Enquêtes mobiles

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et les briefs M5-01 à M5-02.

| | |
|---|---|
| Lot | M5 — Enquêtes mobile |
| Objectif | Livrer et documenter les parcours joueur et MJ avant l'installation PWA |
| Estimation | 0,5 jour |
| Fichiers | `CHANGELOG.md`, `js/layout.js`, `sw.js`, documentation |
| Dépend de | M5-02 |

## À faire

### 1. Rejouer le parcours croisé

Depuis un téléphone joueur : rechercher un PNJ, ouvrir un indice lié, naviguer vers un autre PNJ et
revenir aux Enquêtes sans perdre les états de liste. Depuis un second téléphone MJ : créer un indice
secret, le lier, l'illustrer, le publier, le modifier, le dépublier puis le supprimer. Observer chaque
transition en temps réel côté joueur.

### 2. Revalider la confidentialité

Tester document et image par URL directe pour visiteur, non-MJ et MJ. Inspecter Cache Storage,
IndexedDB, localStorage et DOM après déconnexion : aucun indice secret, blob protégé ou note privée ne
doit persister. Rejouer les tests de règles Firestore et Storage.

### 3. Vérifier la cohérence bureau/mobile

Une modification créée sur mobile apparaît correctement sur `enquetes.html` et inversement. Comparer
tri, statut, PNJs liés et cycle de vie des images. Aucun des deux clients ne doit écraser un champ qu'il
ne connaît pas.

### 4. Livrer le lot

Incrémenter `APP_VERSION`, aligner le cache `sw.js`, compléter `CHANGELOG.md`, exécuter lint, check,
smoke tests et tests Firebase. Ajouter les modules Enquêtes mobiles aux contrôles d'existence, tout en
gardant `/app/` absent du manifeste et de la navigation publique jusqu'au lot final.

## Checklist de sortie

- [ ] Parcours joueur complet, y compris hors ligne textuel.
- [ ] Parcours MJ complet, conflits et brouillons compris.
- [ ] Confidentialité documents/images/caches validée.
- [ ] Liens PNJs ↔ Enquêtes cohérents dans les deux sens.
- [ ] Compatibilité bureau/mobile et temps réel validée.
- [ ] Tests sur iPhone et Android consignés.
- [ ] Version, cache et changelog cohérents.

## Critères d'acceptation

Les deux onglets fonctionnels ciblés sont entièrement utilisables sur mobile comme joueur ou MJ. Le
travail restant concerne l'identité installable, les mises à jour et la mise en production progressive.

## Commit

`chore(release): livrer les enquetes mobiles (M5-03)`

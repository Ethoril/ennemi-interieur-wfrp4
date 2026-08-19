# M7-02 — Activation publique, documentation et retour arrière

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M7-01.

| | |
|---|---|
| Lot | M7 — Mise en production |
| Objectif | Faire de l'interface mobile le démarrage de la PWA existante et la rendre découvrable |
| Estimation | 1 jour |
| Fichiers | `manifest.json`, navigation/liens, aide, `README.md`, `CHANGELOG.md`, versions |
| Dépend de | M7-01 validé sans blocage |

## Décision d'activation

Ne commencer qu'après validation explicite du candidat M7-01. L'activation change la découverte et le
point de démarrage, pas l'identité installée : le champ `id` introduit en M6-01 reste inchangé.

## À faire

### 1. Basculer le manifeste

Changer `start_url` vers `./app/index.html` tout en conservant `id` et `scope` validés. Vérifier la
résolution sous le sous-chemin GitHub Pages. Une installation existante doit recevoir la mise à jour et
lancer ensuite l'interface mobile, sans créer une deuxième icône ni perdre son service worker.

Les pages bureau restent accessibles par leurs URLs et ne redirigent pas automatiquement selon la
largeur d'écran. Le joueur garde le choix entre expérience mobile et site complet.

### 2. Rendre l'application découvrable

Ajouter des liens sobres depuis les endroits pertinents : documentation/accueil et pages PNJs/Enquêtes.
Sur mobile, proposer « Ouvrir la version mobile » ; sur bureau, ne pas masquer les pages existantes.
Ajouter l'aide d'installation et préciser qu'elle est facultative, que les données sont communes et
que la première synchronisation nécessite internet.

Ne jamais afficher le bouton d'administration aux joueurs avant le contrôle Auth. Aucun lien public
ne contient d'identifiant secret.

### 3. Documenter la maintenance

Compléter le README ou une documentation dédiée avec :

- architecture bureau/mobile et dépôts communs ;
- clients public persistant et MJ mémoire ;
- routes, manifeste unique et service worker racine ;
- ajout d'un champ ou d'une vue dans les deux interfaces ;
- ajout/retrait d'un fichier du précache ;
- migrations Firestore/Storage et tests de règles ;
- procédure de version, recette appareils, déploiement et rollback ;
- règle stricte : aucune donnée privée dans cache, logs ou dépôt.

Ajouter une checklist courte « faire évoluer PNJs/Enquêtes » pour éviter qu'une future fonctionnalité
ne soit implémentée deux fois avec des contrats divergents.

### 4. Livrer la version finale

Incrémenter `APP_VERSION` dans `js/layout.js`, aligner `sw.js` et compléter `CHANGELOG.md` avec :
consultation joueur, édition MJ, mode hors ligne public, installation, limites hors ligne et sécurité.
Exécuter l'ensemble des contrôles puis déployer selon le flux validé M7-01.

### 5. Surveiller après activation

Dans les minutes/heures suivant le déploiement :

1. ouvrir l'ancienne installation et accepter la mise à jour ;
2. vérifier qu'elle lance `/app/` sans doublon ;
3. faire une nouvelle installation Android et, si l'appareil est disponible, iOS ;
4. effectuer une lecture joueur et une petite modification MJ réversible ;
5. contrôler erreurs de permission, Auth, Storage et fichiers 404 ;
6. vérifier que les pages bureau restent fonctionnelles.

Consigner l'heure, la version et le résultat, sans données de campagne privées.

### 6. Déclencher le rollback si nécessaire

En cas de fuite ou perte de données : arrêter l'usage, rétablir le commit/règles compatibles et suivre
le plan de restauration. Pour un défaut uniquement mobile : retirer les liens publics et remettre
`start_url` sur `./index.html` en conservant le même `id`, puis publier une nouvelle version de worker.
Ne restaurer aucune sauvegarde Firestore pour un simple problème d'interface.

## Checklist finale

- [ ] `id` inchangé et `start_url` mobile correctement résolu.
- [ ] Ancienne installation mise à jour sans doublon.
- [ ] Nouvelle installation Android réussie ; validation iOS exécutée ou documentée comme différée.
- [ ] Liens de découverte ajoutés sans redirection forcée.
- [ ] Données bureau/mobile confirmées communes en temps réel.
- [ ] Documentation architecture/maintenance/déploiement complète.
- [ ] Tests complets verts et recette post-déploiement exécutée.
- [ ] Version, worker et changelog cohérents.
- [ ] Procédure de rollback immédiatement accessible.

## Critères d'acceptation

Les joueurs disposent d'une PWA mobile installable pour PNJs et Enquêtes, le MJ peut tout éditer, les
données restent communes dans Firestore et la maintenance future repose sur une couche de données
unique plutôt que deux implémentations métier divergentes.

## Commit

`chore(release): activer et livrer la pwa mobile (M7-02)`

# M1-05 — Clôture du socle de sécurité

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et les briefs M1-01 à M1-04.

| | |
|---|---|
| Lot | M1 — Sécurité et intégrité |
| Objectif | Valider, documenter et livrer le modèle sécurisé avant le refactor |
| Estimation | 0,5 jour |
| Fichiers | `CHANGELOG.md`, `js/layout.js`, `sw.js`, documentation de migration |
| Dépend de | M1-01, M1-02, M1-03, M1-04 |

Le journal d’exécution production est conservé dans
[`../../mobile/M1-05-cloture-production.md`](../../mobile/M1-05-cloture-production.md).

## Préconditions

Ne commencer que lorsque les migrations ont été exécutées et contrôlées, les index sont prêts et les
tests de règles Firestore/Storage passent. Aucun « à finir plus tard » relatif à une fuite de contenu
privé n'est acceptable pour clôturer ce lot.

## À faire

### 1. Rejouer la matrice complète

- Visiteur : uniquement PNJs/relations visibles et indices découverts, images comprises.
- Compte connecté non-MJ : mêmes droits qu'un visiteur.
- MJ vérifié : lecture et édition de tous les contenus, notes privées comprises.
- Passage MJ vers déconnecté : aucune donnée privée ne reste affichée ni récupérable dans un cache.
- Suppression/relation : aucune référence ou image orpheline non signalée.

Tester les lectures directes par identifiant en plus de l'interface. Vérifier la console et les logs de
l'émulateur. Refaire la recette M0-01 dans les deux thèmes à 375 px et sur bureau.

### 2. Finaliser la migration

Conserver les sources anciennes tant que la période de retour arrière décidée n'est pas terminée.
Documenter précisément : date, projet, nombres avant/après, anomalies manuelles, emplacement externe
de la sauvegarde, délai de suppression des anciens fichiers et procédure de restauration.

### 3. Livrer le lot

Ce brief est le seul du lot à :

1. incrémenter `APP_VERSION` dans `js/layout.js` ;
2. aligner la version et le nom de cache dans `sw.js` ;
3. ajouter une entrée utilisateur dans `CHANGELOG.md` ;
4. vérifier que le cache ne sert pas d'anciens scripts incompatibles avec les nouvelles règles.

### 4. Contrôles de dépôt

Exécuter les commandes standard du projet, les tests de règles et le smoke test. Vérifier les liens de
documentation et `git diff --check`. Relire le diff pour exclure export, adresse de joueur, contenu de
notes, URL signée ou fichier média issu de la production.

## Recette de sortie

- [ ] Matrice Firestore verte.
- [ ] Matrice Storage verte.
- [ ] Deuxième exécution des migrations sans changement.
- [ ] PNJs et Enquêtes bureau fonctionnels visiteur et MJ.
- [ ] Correctifs M1-04 vérifiés sous latence et échec simulés.
- [ ] Version, service worker et changelog cohérents.
- [ ] Procédure de retour arrière relue et exploitable.
- [ ] Aucun secret ou export dans Git.

## Critères d'acceptation

Le lot M2 peut se baser sur un contrat de données stable et protégé. La version déployée fonctionne
avec les données migrées, et l'ancienne version peut être restaurée selon une procédure documentée.

## Commit

`chore(release): cloturer le socle de securite mobile (M1-05)`

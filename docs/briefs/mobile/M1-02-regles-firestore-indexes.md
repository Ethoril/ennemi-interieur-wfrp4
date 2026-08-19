# M1-02 — Règles Firestore, requêtes et index versionnés

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M1-01.

| | |
|---|---|
| Lot | M1 — Sécurité et intégrité |
| Objectif | Faire respecter le modèle public/privé par Firestore, indépendamment de l'interface |
| Estimation | 1,5 jour |
| Fichiers | `firestore.rules`, `firestore.indexes.json`, `firebase.json`, tests de règles |
| Dépend de | M1-01 exécuté et contrôlé |

## Résultat attendu

Un visiteur peut requêter seulement les PNJs et relations explicitement publics, et les indices
découverts. Le MJ vérifié conserve tous les droits utiles. Les notes privées sont inaccessibles sans
authentification MJ. Les requêtes autorisées ont leurs index déclarés dans le dépôt.

## À faire

### 1. Durcir les lectures

Adapter `firestore.rules` avec ces intentions :

- `pnjs/{id}` : lecture MJ ou `resource.data.visibleJoueurs == true` ;
- `relations/{id}` : lecture MJ ou `resource.data.visibleJoueurs == true` ;
- `pnjs_prives/{id}` : lecture et écriture MJ seulement ;
- `indices/{id}` : conserver lecture MJ ou `decouvert == true` ;
- toutes les écritures de ces collections : MJ seulement.

Conserver la vérification de courriel validé dans `isGM()`. Les règles doivent aussi contraindre les
champs structurants des créations et mises à jour : booléens de visibilité, tailles raisonnables des
chaînes, identifiants de relations non vides et champs autorisés. Ne pas bloquer une suppression MJ.

### 2. Aligner toutes les requêtes publiques

Une règle Firestore ne filtre pas le résultat : toute requête visiteur doit prouver qu'elle ne peut
retourner que des documents autorisés. Ajouter donc les contraintes `where` de visibilité dans les
lectures publiques de `js/pnjs.js` et `js/enquetes.js`. La branche MJ peut charger l'ensemble.

Traiter la transition d'état d'authentification : annuler les abonnements/lectures issus de l'ancien
mode avant de relancer les requêtes du nouveau mode. Une erreur `permission-denied` devient un état
compréhensible, jamais un écran vide silencieux.

### 3. Versionner les index

Créer `firestore.indexes.json`, le référencer dans `firebase.json` et déclarer les index réellement
requis, notamment pour les combinaisons de visibilité, découverte, liens `pnjsLies`, ordre et dates.
Ne pas ajouter des index spéculatifs. Documenter la commande de déploiement et l'ordre : index prêts,
puis règles.

### 4. Tester avec l'émulateur

Ajouter des tests de règles en dépendances de développement seulement. Couvrir au minimum cette
matrice :

| Acteur | PNJ public | PNJ masqué | Notes privées | Indice découvert | Indice secret | Écriture |
|---|---:|---:|---:|---:|---:|---:|
| Visiteur | oui | non | non | oui | non | non |
| Connecté non-MJ | oui | non | non | oui | non | non |
| MJ vérifié | oui | oui | oui | oui | oui | oui |

Tester aussi les requêtes en liste, les lectures directes par identifiant, les valeurs de champs
invalides et le refus d'un courriel MJ non vérifié.

### 5. Plan de déploiement

1. Vérifier que M1-01 n'a laissé aucun champ absent.
2. Déployer les index et attendre leur état prêt.
3. Déployer les règles dans une fenêtre surveillée.
4. Tester visiteur et MJ sur la production.
5. Restaurer les règles précédentes immédiatement en cas de blocage, sans annuler la migration.

## Ne pas faire

- Ne considérer ni un filtre UI ni l'obscurité d'un identifiant comme une protection.
- Ne stocker aucune règle d'autorisation uniquement côté JavaScript.
- Ne modifier les règles Storage dans ce brief.

## Vérifications

- [ ] Tous les tests de matrice passent dans l'émulateur.
- [ ] Une requête visiteur sans filtre de visibilité est refusée.
- [ ] Une lecture directe d'un document masqué est refusée.
- [ ] Le MJ lit et modifie tous les cas du jeu de test.
- [ ] `firebase.json` référence règles et index versionnés.
- [ ] Les deux pages affichent une erreur utile si une permission est refusée.

## Critères d'acceptation

Les règles font respecter toute la matrice de droits sans dépendre de l'interface, les requêtes
publiques autorisées fonctionnent avec des index versionnés et le déploiement peut être rejoué.

## Commit

`security(firestore): appliquer la visibilite et versionner les index (M1-02)`

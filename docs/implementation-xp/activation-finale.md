# Activation finale — fiches, référentiels et contributions

## État du document

Ce runbook décrit une future activation de la version `v2.29.0`. Il ne signifie pas qu’un déploiement, une migration ou une modification des données de campagne a eu lieu : ces opérations restent à exécuter séparément après validation. Le dépôt est publié directement depuis `master` sur GitHub Pages ; il n’existe pas de recette hébergée.

## Préparation et sauvegardes

1. Partir d’un état de travail propre et noter le commit candidat, la version `v2.29.0` et l’empreinte du catalogue publié. Vérifier les changements de `layout.js`, du Service Worker, des métadonnées HTML et du `CHANGELOG.md`.
2. Exécuter `npm ci`, `npm run check`, `npm run lint` et `git diff --check`. Pour Functions, `npm --prefix functions test` doit aussi réussir. Ne pas continuer avec une copie serveur générée différente de sa source.
3. Avant toute migration ou publication, conserver une sauvegarde Firestore chiffrée, hors du dépôt et à accès restreint. Vérifier qu’elle est complète et restaurable dans un projet de test. Ne pas placer d’export ou de fiche de personnage dans Git, un ticket ou une capture.
4. Les callables créent également des copies protégées et atomiques : `fiches/{charId}/migration_backups/{fingerprint}` pour le passage V1→V2 et `fiches/{charId}/catalogue_backups/{operationId}` avant chaque fusion du référentiel. Les commandes de fiche gardent leurs propres copies sous `command_backups`. Ces sous-collections sont réservées au MJ et ne remplacent pas la sauvegarde externe préalable.

## Accès de Bhelgi

Si l’adresse Google du joueur change, le MJ remplace l’ancienne adresse dans la console Firebase du projet de campagne, document `campagne/acces`, champ `bhelgi` écrit exactement en minuscules. La valeur est un tableau d’adresses Google normalisées en minuscules : retirer l’adresse remplacée et conserver les autres accès qui doivent rester autorisés. Saisir directement dans la console, jamais dans le dépôt, un message, un rapport de test ou une capture. Le navigateur ne lit pas `campagne/acces` : les règles Firestore et les callables vérifient l’accès côté serveur. Après l’écriture, vérifier le nouveau compte autorisé, et le refus de l’ancien compte et d’un compte non autorisé, sans afficher ni copier les adresses.

## Ordre d’activation

L’activation est séquencée pour que l’interface n’appelle jamais une fonction absente et que les règles n’imposent pas des index encore en construction.

1. **Functions** — déployer d’abord les callables de commande, migration, référentiel et contributions depuis la version candidate. Contrôler que les exports attendus sont présents, que App Check est actif et que les journaux n’exposent ni fiche ni adresse.
2. **Index Firestore** — déployer `firestore.indexes.json`, puis attendre que chaque index requis soit `Ready`. Ne pas avancer sur un index en construction ou en erreur.
3. **Règles Firestore** — déployer `firestore.rules` après les index. Vérifier dans l’émulateur la matrice visiteur/joueur/MJ, l’accès aux enveloppes et aux historiques privés, ainsi que le refus des anciennes écritures complètes depuis le client.
4. **Client statique** — seulement après les trois étapes précédentes, publier le commit candidat sur `master`. Vérifier l’achèvement du workflow Pages, puis tester la version affichée, le worker et le chargement des modules.
5. **Données existantes** — avant la première écriture, prévisualiser les cinq fiches et leurs révisions. Migrer une fiche à la fois avec l’identifiant confirmé et l’empreinte de source attendue. Pour une fusion du référentiel, examiner l’aperçu à jour, résoudre chaque collision explicitement, saisir un motif et publier dans la transaction qui contrôle les cinq révisions. Ne jamais recalculer ni réécrire les coûts XP historiques.

Commandes indicatives, à lancer uniquement pendant une activation autorisée et depuis la racine du dépôt :

```powershell
firebase deploy --only functions --project campagne-wrpg
firebase deploy --only firestore:indexes --project campagne-wrpg
firebase deploy --only firestore:rules --project campagne-wrpg
```

Le client est publié par le processus GitHub Pages du dépôt, pas par une commande Firebase. Le déploiement de la dernière étape sur `master` doit être autorisé séparément.

## Contrôles après activation

- Utiliser d’abord la fiche de test, puis un seul personnage autorisé à la fois.
- Vérifier que le joueur peut lire et envoyer une commande, mais ne peut ni lire `campagne/acces`, ni lire l’historique ou les sauvegardes privées d’un autre.
- Confirmer un achat, relancer son opération avec le même identifiant et vérifier qu’il n’y a ni double débit ni second événement.
- Tester l’annulation du dernier achat éligible et confirmer l’événement de compensation. Tester aussi une modification concurrente, qui doit être bloquée pour arbitrage plutôt que fusionnée silencieusement.
- Côté MJ, vérifier une correction avec motif, un aperçu de migration, une collision sans décision refusée, puis une fusion arbitrée avec sauvegarde.
- Contrôler le site bureau, la page Référentiels, la fiche mobile installée et l’état hors ligne. Les brouillons hors ligne ne doivent jamais rejouer un achat.
- Garder les preuves minimales (version, commit, résultat, heure et appareils) sans nom de joueur, email, valeur de fiche, identifiant privé ni capture de données.

## Retour arrière

Un rollback restaure un service compatible ; il ne réinjecte pas automatiquement un état de fiche ancien.

- **Client seul** : publier un correctif de rollback avec une nouvelle version de cache. Ne pas restaurer le Service Worker seul : layout, métadonnées et `CHANGELOG.md` doivent rester cohérents.
- **Functions** : revenir à une version serveur connue compatible avec le schéma et le client encore publiés. Si aucune version n’est compatible, suspendre les commandes concernées plutôt que rouvrir les écritures directes.
- **Règles/index** : restaurer seulement un jeu de règles compatible avec le schéma courant, et conserver les index nécessaires. Ne jamais revenir à une règle qui autorise le remplacement complet d’une fiche par un client.
- **Migration ou fusion** : ne pas restaurer une enveloppe sauvegardée par écrasement. Comparer la sauvegarde et l’état actuel, préserver les changements postérieurs, puis corriger par une commande versionnée et historisée. Les barrières de migration et journaux ne se suppriment pas pour faciliter un rollback.

Toute restauration de données est une opération distincte, précédée d’une comparaison des révisions et d’une validation MJ. Documenter le périmètre et la raison sans copier de données de campagne dans le dépôt.

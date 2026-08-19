# Briefs — Application mobile PWA PNJs & Enquêtes

Ces briefs déclinent le [`PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) en unités de travail
ordonnées. Chacun doit produire un commit autonome.

> **Lire avant toute intervention :** [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md).
> Les contraintes existantes gagnent en cas de contradiction : modules ES natifs, aucun framework,
> aucun bundler, aucune dépendance npm à l'exécution, UTF-8 sans BOM et LF.

## Principes d'exécution

1. Traiter les briefs dans l'ordre du tableau, sauf dépendance explicitement plus souple.
2. Ne jamais déployer une règle qui exige un champ avant la migration des documents.
3. Ne jamais mélanger migration de données, activation publique et suppression de compatibilité.
4. Effectuer tout export de données hors du dépôt public.
5. Un brief fonctionnel ne change ni version ni cache ; seul le brief de clôture du lot le fait.
6. Le site bureau reste fonctionnel à chaque commit.
7. `/app/` reste non annoncé jusqu'au lot M7.
8. La recette physique iPhone est différée par décision projet : Android reste le jalon appareil
   actuel. Conserver les scénarios iOS ouverts et ne jamais déclarer ce support validé avant leur
   exécution réelle.

## Ordre des lots

| Brief | Objet | Dépend de | Estim. |
|---|---|---|---:|
| [M0-01](M0-01-baseline-sauvegardes.md) | Baseline, sauvegardes et jeu de test | — | 1 j |
| [M1-01](M1-01-schema-visibilite-migration.md) | Schéma de visibilité, notes privées et migration | M0-01 | 1,5 j |
| [M1-02](M1-02-regles-firestore-indexes.md) | Règles Firestore, requêtes et index versionnés | M1-01 | 1,5 j |
| [M1-03](M1-03-stockage-images-protege.md) | Images protégées et migration Storage | M1-02 | 2 j |
| [M1-04](M1-04-integrite-correctifs-pnjs.md) | Atomicité, cascades, courses et filtres PNJs | M1-03 | 1,5 j |
| [M1-05](M1-05-cloture-securite.md) | Recette et livraison du socle de sécurité | M1-01 à M1-04 | 0,5 j |
| [M2-01](M2-01-clients-firebase-normalisation.md) | Clients Firebase injectables, normalisation et erreurs | M1-05 | 1,5 j |
| [M2-02](M2-02-depot-pnjs-relations.md) | Dépôt partagé PNJs et relations | M2-01 | 2 j |
| [M2-03](M2-03-depot-indices-images.md) | Dépôt partagé indices et images | M2-01 | 1,5 j |
| [M2-04](M2-04-refactor-bureau-temps-reel.md) | Refactor des deux pages bureau et temps réel | M2-02, M2-03 | 2,5 j |
| [M2-05](M2-05-cloture-couche-donnees.md) | Recette et livraison de la couche commune | M2-04 | 0,5 j |
| [M3-01](M3-01-coque-routeur-mobile.md) | Coque `/app/`, routeur et design mobile | M2-05 | 2 j |
| [M3-02](M3-02-etat-public-cache.md) | État public, cache persistant et synchronisation | M3-01 | 1,5 j |
| [M3-03](M3-03-liste-pnjs-mobile.md) | Liste, recherche et filtres PNJs | M3-02 | 1,5 j |
| [M3-04](M3-04-detail-pnj-cloture-joueur.md) | Fiche PNJ, liens croisés et clôture joueur | M3-03 | 1,5 j |
| [M4-01](M4-01-authentification-mj-mobile.md) | Authentification et session MJ mobile | M3-04 | 1,5 j |
| [M4-02](M4-02-formulaire-pnj-mobile.md) | Création, modification et suppression de PNJ | M4-01 | 2 j |
| [M4-03](M4-03-portraits-mobiles.md) | Appareil photo, recadrage et cycle de vie portrait | M4-02 | 1,5 j |
| [M4-04](M4-04-relations-mobiles.md) | Éditeur mobile de relations | M4-02 | 1,5 j |
| [M4-05](M4-05-brouillons-conflits-cloture.md) | Brouillons, conflits, statuts et clôture édition PNJ | M4-03, M4-04 | 2 j |
| [M5-01](M5-01-enquetes-joueur-mobile.md) | Liste et fiche Enquêtes pour les joueurs | M3-04 | 1,5 j |
| [M5-02](M5-02-enquetes-mj-mobile.md) | Administration mobile des indices et illustrations | M4-05, M5-01 | 2 j |
| [M5-03](M5-03-cloture-enquetes.md) | Recette et livraison des Enquêtes mobiles | M5-02 | 0,5 j |
| [M6-01](M6-01-identite-manifeste-icones.md) | Identité PWA stable, manifeste et icônes | M3-01 | 1,5 j |
| [M6-02](M6-02-service-worker-installation.md) | Service worker, mise à jour et aides d'installation | M5-03, M6-01 | 2 j |
| [M6-03](M6-03-validation-pwa-cloture.md) | Validation installée iOS/Android et clôture PWA | M6-02 | 1,5 j |
| [M7-01](M7-01-recette-deploiement-progressif.md) | Recette globale et déploiement non annoncé | M6-03 | 2 j |
| [M7-02](M7-02-activation-livraison-finale.md) | Activation publique, documentation et retour arrière | M7-01 | 1 j |

Total indicatif : **43 jours** avec marges de recette incluses. Les lots restent livrables
séparément ; la PWA n'est annoncée qu'en M7-02, après validation de M7-01.

## Jalons utilisables

- **Après M1 :** données et fichiers protégés, corrections d'intégrité livrées.
- **Après M2 :** bureau en temps réel sur une couche Firestore partagée.
- **Après M3 :** consultation PNJs mobile utilisable sans installation.
- **Après M4 :** administration PNJs complète sur téléphone.
- **Après M5 :** consultation et administration Enquêtes complètes.
- **Après M6 :** PWA installable et validée sur appareils physiques.
- **Après M7 :** application publiquement annoncée et documentée.

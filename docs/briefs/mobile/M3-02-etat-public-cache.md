# M3-02 — État public, cache persistant et synchronisation

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M2-01 et M3-01.

| | |
|---|---|
| Lot | M3 — PNJs mobile joueur |
| Objectif | Alimenter l'application avec les données publiques et expliquer honnêtement leur fraîcheur |
| Estimation | 1,5 jour |
| Fichiers | `js/mobile/session.js`, `js/mobile/store.js`, `js/mobile/ui.js`, tests |
| Dépend de | M3-01 |

## Modèle d'état

Créer un store léger en JavaScript natif, alimenté par le client Firebase public persistant. L'état
minimal contient :

- PNJs visibles, relations visibles et indices découverts normalisés ;
- statut initial `loading / ready / empty / error` par ressource ;
- provenance `server / cache` et présence d'écritures en attente ;
- connectivité navigateur et dernier instant confirmé par le serveur ;
- filtres/recherche de session, séparés des données ;
- génération de session et fonctions de désabonnement.

Les vues s'abonnent au store, jamais directement à Firestore. Le store ne contient aucune donnée MJ.

## À faire

### 1. Initialiser le client public

Activer la persistance locale avant la première requête. Gérer explicitement les cas : quota refusé,
navigation privée, plusieurs onglets ou API indisponible. Le repli mémoire doit permettre de continuer
en ligne avec un message discret dans Réglages.

### 2. Orchestrer les abonnements

Démarrer une seule instance des abonnements publics des dépôts. Mettre à jour les ressources sans
muter les tableaux déjà publiés. Sur arrêt de l'application, désabonner toutes les sources. Une erreur
d'une collection ne doit pas effacer les autres données valides.

### 3. Définir les états hors ligne

- Premier lancement sans réseau et sans cache : écran explicatif avec bouton Réessayer.
- Cache disponible : contenu consultable avec badge « Données enregistrées ».
- Retour réseau : synchronisation automatique et annonce non intrusive.
- Contenu retiré côté serveur : il disparaît après synchronisation, sans rester épinglé par l'UI.
- Erreur de permission : message distinct d'une panne réseau et lien de rechargement.

Le texte « à jour » n'est affiché qu'après un snapshot serveur. `navigator.onLine` seul ne constitue
pas une preuve de synchronisation.

### 4. Garder les préférences appropriées

Le thème, la dernière section et les filtres non sensibles peuvent être conservés localement. Versionner
la clé de préférences et ignorer proprement un JSON invalide. Ne jamais stocker de document complet,
note, jeton Auth ou URL de blob dans `localStorage`.

### 5. Instrumenter sans données personnelles

En mode développement, permettre d'inspecter le statut des trois abonnements et le repli de cache.
Les journaux ne contiennent que codes d'erreur, nombres et identifiants techniques nécessaires ; pas le
texte des notes ni une URL signée.

## Tests

- [ ] Premier lancement en ligne charge puis marque le snapshot serveur.
- [ ] Second lancement hors ligne affiche les PNJs publics mis en cache.
- [ ] Premier lancement hors ligne explique qu'une connexion initiale est requise.
- [ ] Refus de persistance bascule en mémoire sans écran cassé.
- [ ] Une collection en erreur laisse les autres utilisables.
- [ ] Une dépublication distante retire le document après reconnexion.
- [ ] Trois montages/démontages ne multiplient pas les listeners.
- [ ] Aucun contenu MJ ou blob n'apparaît dans les stockages persistants inspectables.

## Critères d'acceptation

Toutes les futures vues joueur obtiennent un état public unique, stable et observable. L'utilisateur
comprend s'il consulte une donnée serveur, une copie locale ou aucune donnée disponible.

## Commit

`feat(mobile): gerer l'etat public et le cache hors ligne (M3-02)`

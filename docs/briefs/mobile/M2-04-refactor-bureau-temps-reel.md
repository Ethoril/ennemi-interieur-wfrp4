# M2-04 — Refactor des pages bureau et temps réel

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M2-02 et M2-03.

| | |
|---|---|
| Lot | M2 — Couche de données commune |
| Objectif | Faire de PNJs et Enquêtes bureau les premiers consommateurs de la couche partagée |
| Estimation | 2,5 jours |
| Fichiers | `js/pnjs.js`, `js/enquetes.js`, `js/auth.js`, pages HTML si imports nécessaires |
| Dépend de | M2-02, M2-03 |

## Stratégie

Procéder page par page, sans refonte visuelle. Le comportement observable doit rester identique, à
l'exception du rafraîchissement en temps réel et des corrections déjà validées. Éviter un « grand
basculement » impossible à diagnostiquer : lectures, puis mutations, puis médias.

## À faire — PNJs

1. Remplacer les `getDocs` directs par les abonnements du dépôt adapté au rôle.
2. Conserver l'état courant de recherche, filtres, sélection et zoom lors d'une émission temps réel.
3. Différencier chargement initial, mise à jour, cache et erreur sans vider brutalement le graphe.
4. Passer création, édition, suppression et relations par les dépôts.
5. Charger notes privées et images uniquement lorsque la fiche MJ concernée en a besoin.
6. Nettoyer abonnements, gestionnaires et URLs objet à la fermeture ou au changement de rôle.
7. Maintenir le garde de génération de `openPanel()` pour qu'une réponse ancienne ne gagne jamais.

## À faire — Enquêtes

1. Utiliser l'abonnement public `decouvert == true` ou l'abonnement MJ complet.
2. Recevoir les PNJs visibles depuis le dépôt PNJs pour les liens affichés au joueur.
3. Utiliser le dépôt d'indices pour le CRUD et le service images pour les illustrations.
4. Préserver sélection, formulaire ouvert et position de lecture quand une mise à jour distante arrive.
5. Si le document édité disparaît, fermer proprement l'éditeur avec un message explicite.

## Changements d'authentification

Sur tout changement d'état Auth :

1. invalider une génération globale ;
2. désabonner toutes les lectures du rôle précédent ;
3. effacer notes privées, formulaires et blobs MJ de la mémoire/du DOM ;
4. construire les dépôts du nouveau rôle ;
5. réabonner puis rendre l'interface.

Le bouton ou les privilèges locaux ne suffisent jamais à autoriser une écriture. Un refus serveur doit
être affiché clairement et ne pas laisser l'état optimiste comme s'il était sauvegardé.

## Préserver les contrats UI

- Tous les contenus dynamiques passent par `esc()` ou une construction DOM sûre.
- Les couleurs utilisent les tokens/palettes existants.
- Les confirmations utilisent le composant partagé, pas `confirm()`.
- Les raccourcis, focus, thèmes et état vide existants sont re-testés.
- Aucun import Firebase direct de données ne subsiste dans `pnjs.js` ou `enquetes.js`, sauf types ou
  primitives strictement justifiés et documentés.

## Tests et recette

Ouvrir deux fenêtres, dont une en MJ. Une création, modification de visibilité, découverte d'indice,
relation et suppression doit apparaître dans l'autre sans rechargement. Vérifier qu'un passage au
secret retire immédiatement le contenu de la fenêtre visiteur et que l'URL d'image devient inutilisable.

Simuler hors connexion puis reconnexion. Le bureau peut rester sur cache mémoire ; il doit montrer
l'état réel et ne pas transformer une écriture échouée en succès.

- [ ] PNJs visiteur/MJ : lecture et CRUD conformes.
- [ ] Enquêtes visiteur/MJ : lecture et CRUD conformes.
- [ ] Mise à jour distante sans perte de filtre ou mauvais panneau.
- [ ] Déconnexion sans reste de donnée privée dans le DOM.
- [ ] Aucun listener doublé après plusieurs connexions/déconnexions.
- [ ] Console propre, deux thèmes, largeur 375 px et bureau.

## Critères d'acceptation

Les pages bureau n'accèdent plus directement aux collections concernées et servent de preuve que la
couche commune couvre tous les usages avant la construction mobile.

## Commit

`refactor(ui): migrer pnjs et enquetes vers les depots temps reel (M2-04)`

# M4-02 — Création, modification et suppression de PNJ

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M4-01.

| | |
|---|---|
| Lot | M4 — Administration PNJs mobile |
| Objectif | Couvrir le cycle de vie complet d'un PNJ depuis le téléphone |
| Estimation | 2 jours |
| Fichiers | vue formulaire PNJ, composants de champs, styles, dépôt si validation manquante |
| Dépend de | M4-01 |

## Routes et actions

- `#/pnjs/nouveau` : création MJ ;
- `#/pnjs/{id}/modifier` : édition MJ ;
- action Modifier depuis une fiche privée/administrative ;
- action Supprimer dans la zone dangereuse du formulaire.

Toute route vérifie la session avant de charger les données privées. La fiche joueur reste séparée et
ne reçoit pas les notes MJ par erreur de propriété d'objet.

## Contenu du formulaire

Reprendre les champs métier existants : nom obligatoire, statut, vivant, lieu, groupe, description
publique, visibilité joueurs. Ajouter une section clairement intitulée « Notes privées MJ » alimentée
par `pnjs_prives/{id}`. Le portrait est présenté ici, mais son flux complet relève de M4-03.

Utiliser des contrôles natifs adaptés au téléphone, labels permanents, aide courte et type de clavier
pertinent. Ne pas cacher les champs dans des accordéons excessifs ; regrouper « Public », « Privé » et
« Publication » si le formulaire devient long.

## À faire

### 1. Charger et initialiser

Pour une création, construire explicitement les valeurs par défaut. Pour une édition, charger public
et privé via le client MJ, conserver le `updatedAt` initial et distinguer document absent, supprimé et
permission refusée. Bloquer la sauvegarde tant que l'initialisation n'est pas terminée.

### 2. Valider

- normaliser les espaces sans altérer les paragraphes ;
- imposer un nom non vide et les limites du contrat Firestore ;
- valider les booléens et valeurs d'énumération ;
- empêcher une chaîne `undefined` ou un tableau mal formé ;
- associer chaque erreur au champ et résumer en haut du formulaire ;
- déplacer le focus vers la première erreur après soumission.

La validation client aide le MJ, mais les règles et le dépôt revalident les données.

### 3. Sauvegarder

Au toucher de « Enregistrer » : désactiver la double soumission, afficher une progression locale,
envoyer uniquement les champs attendus puis attendre la confirmation serveur. Sur succès, remplacer
l'historique par la fiche du PNJ et annoncer la sauvegarde. Sur échec, garder le formulaire et les
modifications, réactiver l'action et afficher une erreur classée.

La description publique et les notes privées sont écrites dans leurs documents respectifs par le
dépôt. Ne jamais recopier les notes dans l'objet public pour simplifier le rendu.

### 4. Gérer la visibilité

Présenter l'interrupteur avec une conséquence explicite : PNJ, portrait et relations compatibles
deviennent consultables ou disparaissent pour les joueurs. En publication, prévenir si des relations
visibles pointent vers un contenu masqué. En dépublication, la mise à jour temps réel doit retirer le
PNJ des clients publics.

### 5. Supprimer avec impact

Réutiliser la suppression en cascade M1-04. Avant confirmation, afficher nom et compte des relations,
indices liés, portrait et notes concernés. Exiger une confirmation dédiée, empêcher le double clic et
ne quitter la fiche qu'après résultat réel. Si le nettoyage Storage reste à reprendre, le signaler au
MJ sans remettre le PNJ comme présent.

## Ergonomie mobile

Barre d'action collante au-dessus de la zone sûre, sans masquer le dernier champ. Lors de l'ouverture
du clavier, le champ actif et ses erreurs restent visibles. Les boutons Annuler/Retour préviennent en
cas de modification non enregistrée ; le traitement détaillé des brouillons arrive en M4-05.

## Recette

- [ ] Création minimale puis complète.
- [ ] Édition séparée des champs publics et notes privées.
- [ ] Erreurs de validation accessibles et valeurs conservées.
- [ ] Double toucher ne crée pas deux PNJs.
- [ ] Publication/dépublication reflétée sur un second téléphone visiteur.
- [ ] Suppression annonce puis nettoie tout l'impact.
- [ ] Échec réseau/permission garde le formulaire sans faux succès.
- [ ] Clavier iOS/Android, portrait/paysage, zoom texte et deux thèmes.

## Critères d'acceptation

Le MJ peut créer, modifier, publier, dépublier et supprimer un PNJ sans ordinateur ; notes privées et
données publiques restent séparées et aucune erreur ne produit un succès ou une perte silencieuse.

## Commit

`feat(mobile): ajouter le formulaire complet des pnjs (M4-02)`

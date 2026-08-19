# M3-04 — Fiche PNJ, liens croisés et clôture joueur

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et les briefs M3-01 à M3-03.

| | |
|---|---|
| Lot | M3 — PNJs mobile joueur |
| Objectif | Livrer un parcours joueur PNJs complet et navigable hors connexion |
| Estimation | 1,5 jour |
| Fichiers | `js/mobile/views/pnj-detail.js`, styles, `CHANGELOG.md`, versions applicatives |
| Dépend de | M3-03 |

## Contenu de la fiche

La route `#/pnjs/{id}` présente une hiérarchie verticale adaptée au téléphone :

1. nom, portrait et informations d'identification publiques ;
2. description publique et statut connu ;
3. relations visibles, regroupées ou triées clairement ;
4. indices découverts liés à ce PNJ ;
5. métadonnée discrète de fraîcheur/cache.

N'afficher ni champ vide inutile ni information MJ. Les sections longues peuvent être repliables si
leur état et leur accessibilité restent explicites.

## À faire

### 1. Charger sans fuite

Résoudre le PNJ depuis le store public. Filtrer les relations dont l'autre extrémité n'est pas visible
et les indices déjà autorisés. Charger le portrait protégé via le service images et révoquer l'URL au
démontage. Si une donnée liée arrive plus tard, mettre à jour uniquement sa section.

### 2. Gérer les routes et suppressions distantes

- Identifiant inconnu ou masqué : écran « PNJ indisponible », sans confirmer son existence.
- PNJ retiré pendant l'affichage : fermer les données et proposer le retour à la liste.
- Retour : restaurer précisément recherche, filtres et défilement.
- Touche précédent : respecter l'historique au lieu de forcer la liste systématiquement.

### 3. Créer les liens croisés

Une relation ouvre la fiche publique de l'autre PNJ. Un indice ouvre pour l'instant
`#/enquetes/{id}` ; la route affiche un état préparatoire jusqu'à M5-01. Prévenir les boucles de focus
et donner un libellé complet à chaque lien, pas seulement une icône ou une couleur.

### 4. Finaliser l'expérience joueur

Ajouter les états squelette, image absente, sections vides, cache et hors ligne. Vérifier la longueur
des descriptions, très petits écrans, zoom texte à 200 %, copier/coller et liens externes éventuels.
Le contenu principal doit rester lisible sans portrait.

### 5. Clôturer le lot M3

Ce brief de clôture incrémente `APP_VERSION` dans `js/layout.js`, aligne `sw.js` et documente le nouveau
parcours dans `CHANGELOG.md`, sans encore ajouter `/app/` au manifeste ni aux liens publics. Ajouter les
nouveaux modules aux contrôles de syntaxe et vérifier leur disponibilité après déploiement statique.

## Recette complète

- [ ] PNJ public accessible depuis liste, URL directe et relation.
- [ ] PNJ masqué/absent indiscernable pour un visiteur.
- [ ] Relation vers contenu masqué non affichée.
- [ ] Seulement les indices découverts apparaissent.
- [ ] Ouvertures rapides de plusieurs fiches sans réponse asynchrone croisée.
- [ ] Retour liste avec état et défilement restaurés.
- [ ] Second lancement hors ligne avec données publiques déjà chargées.
- [ ] Aucun blob, note ou document MJ dans les stockages persistants.
- [ ] Deux thèmes, 320/375/430 px, paysage, clavier et zoom 200 %.
- [ ] Lint, check, smoke tests et tests de règles verts.
- [ ] Version, cache et changelog cohérents.

## Critères d'acceptation

La consultation mobile des PNJs est utilisable comme produit autonome depuis son URL, tout en lisant
la même sauvegarde Firestore que le bureau. Elle reste volontairement non annoncée jusqu'à M7.

## Commit

`chore(release): livrer la consultation pnjs mobile (M3-04)`

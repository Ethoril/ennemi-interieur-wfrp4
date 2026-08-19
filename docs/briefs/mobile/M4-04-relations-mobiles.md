# M4-04 — Éditeur mobile de relations

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M2-02 et M4-02.

| | |
|---|---|
| Lot | M4 — Administration PNJs mobile |
| Objectif | Administrer les liens d'un PNJ sans reproduire le graphe de bureau |
| Estimation | 1,5 jour |
| Fichiers | vue/feuille Relations mobile, composants de sélection, styles |
| Dépend de | M4-02 |

## Expérience cible

La fiche MJ présente une liste lisible des relations entrantes et sortantes. Une feuille basse permet
d'ajouter ou modifier un lien : cible recherchable, sens, type, libellé, style, couleur de palette,
visibilité joueurs et option bidirectionnelle. Le graphe reste réservé au bureau.

## À faire

### 1. Lister les relations

Regrouper ou marquer clairement « vers » et « depuis ». Chaque ligne montre le PNJ lié, le libellé et
les attributs utiles sans dépendre seulement de la couleur ou du trait. Prévoir les relations orphelines
comme anomalies MJ réparables, jamais comme lien cassé pour le joueur.

### 2. Sélectionner une cible

Ouvrir une feuille avec recherche instantanée sur tous les PNJs visibles au MJ, en excluant le PNJ
courant. Conserver le contexte si le clavier masque la liste. Afficher le statut de visibilité de la
cible et prévenir si une relation publique ne sera pas montrable parce que l'autre PNJ est masqué.

### 3. Créer

Valider type et cible, proposer un libellé par défaut et n'autoriser que les styles/couleurs supportés.
L'option bidirectionnelle appelle la mutation atomique M2-02. Afficher une seule progression et un seul
résultat ; en cas d'échec, aucune moitié ne doit rester.

### 4. Modifier

Permettre de changer métadonnées et visibilité. Si la relation appartient à une paire, demander si le
changement concerne ce sens ou les deux ; utiliser l'identifiant de groupe, pas une recherche par
libellé. Une cible/sens n'est pas modifié silencieusement comme un simple champ : recréer atomiquement
si le modèle l'exige.

### 5. Supprimer

Confirmer avec le nom de la cible et indiquer si un seul sens ou la paire sera supprimé. Attendre le
résultat serveur avant de fermer. Une relation supprimée à distance pendant l'édition produit un état
« déjà supprimée » sans tentative de résurrection implicite.

## Temps réel et conflits

Si une relation change pendant que la feuille est intacte, actualiser. Si le MJ a déjà modifié un champ,
signaler la nouvelle version et laisser choisir recharger ou continuer ; le contrôle final de conflit
est complété en M4-05. Les listes publiques doivent réagir immédiatement à la visibilité.

## Recette

- [ ] Relations entrantes/sortantes compréhensibles sans couleur.
- [ ] Recherche de cible avec accents et clavier ouvert.
- [ ] Création simple et bidirectionnelle atomique.
- [ ] Modification d'un sens ou de la paire explicite.
- [ ] Relation publique vers PNJ masqué non exposée au joueur.
- [ ] Suppression concurrente gérée sans erreur trompeuse.
- [ ] Échec réseau conserve la saisie et n'affiche pas de faux succès.
- [ ] Feuille accessible, focus restauré et cibles tactiles de 44 px.

## Critères d'acceptation

Toutes les opérations de relations possibles sur bureau sont disponibles sur téléphone avec un modèle
mental de liste, et les écritures bidirectionnelles restent atomiques.

## Commit

`feat(mobile): ajouter l'editeur de relations pnjs (M4-04)`

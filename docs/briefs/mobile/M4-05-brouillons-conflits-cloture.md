# M4-05 — Brouillons, conflits, statuts et clôture édition PNJ

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) et les briefs M4-01 à M4-04.

| | |
|---|---|
| Lot | M4 — Administration PNJs mobile |
| Objectif | Rendre l'édition fiable sous réseau mobile instable et livrer le parcours MJ complet |
| Estimation | 2 jours |
| Fichiers | store/formulaires mobiles, dépôts, styles, `CHANGELOG.md`, versions |
| Dépend de | M4-03, M4-04 |

## Politique hors ligne

La consultation publique reste disponible depuis le cache. Les écritures MJ, images et transactions
exigent une connexion dans ce premier lot. L'interface peut conserver un brouillon public local, mais
ne doit jamais faire croire qu'il est synchronisé.

Pour respecter la séparation de sécurité :

- champs publics du formulaire : brouillon versionné dans IndexedDB/localStorage, sans blob ;
- notes privées : mémoire de la session seulement, effacée à la déconnexion/fermeture ;
- photo en attente : mémoire tant que la vue est ouverte, jamais cache applicatif persistant ;
- route, identifiant et date du brouillon ne révèlent aucun texte privé.

## À faire

### 1. Gérer les brouillons

Après une saisie, sauvegarder les champs publics avec un délai court sous une clé versionnée et liée à
l'identifiant. À la réouverture, proposer restaurer ou ignorer en indiquant la date. Supprimer le
brouillon après confirmation serveur ou abandon explicite. Migrer/ignorer proprement un ancien format.

Pour une création, utiliser un identifiant local non confondu avec un document Firestore. Limiter le
nombre et l'âge des brouillons, avec une action « Effacer les brouillons » dans Réglages.

### 2. Détecter les conflits

Conserver `updatedAt` chargé. Lors d'une sauvegarde, une transaction compare la version serveur :

- identique : appliquer les champs et un nouveau timestamp serveur ;
- différente : ne rien écraser et renvoyer une erreur `conflict` ;
- document supprimé : proposer de revenir, jamais recréer silencieusement.

L'écran de conflit montre les champs modifiés de manière synthétique et propose : recharger la version
serveur, copier le texte local, ou forcer après une seconde confirmation MJ. Une fusion champ par champ
n'est ajoutée que si elle peut être testée ; sinon privilégier ces choix explicites.

### 3. Rendre les statuts visibles

Définir un vocabulaire unique : « Brouillon local », « Enregistrement… », « Enregistré », « Hors
ligne », « Conflit », « Échec — réessayer ». Chaque statut associe texte et icône, possède une annonce
accessible et n'utilise pas la couleur seule. Une fermeture pendant l'enregistrement demande d'attendre
ou d'annuler si possible.

### 4. Empêcher les pertes accidentelles

Intercepter navigation interne, retour et fermeture de vue lorsqu'un formulaire est sale. Expliquer
ce qui est conservé : champs publics oui, notes/photo non. Après déconnexion forcée, effacer le privé
mais conserver éventuellement le brouillon public avec consentement explicite.

### 5. Clôturer M4

Rejouer l'administration complète sur appareils et avec réseau bridé. Incrémenter `APP_VERSION`, aligner
`sw.js` et ajouter l'entrée `CHANGELOG.md`. `/app/` reste non annoncé. Vérifier que les nouvelles routes
ne sont jamais accessibles en visiteur et qu'un ancien cache ne sert pas une vue sans le contrôle Auth.

## Matrice de recette

- [ ] Création/édition en ligne avec confirmation serveur.
- [ ] Passage hors ligne avant sauvegarde : brouillon public conservé, privé en mémoire seulement.
- [ ] Rechargement : proposition de brouillon sans notes privées ni photo.
- [ ] Deux téléphones éditent le même PNJ : second envoi bloqué en conflit.
- [ ] Recharger, copier et forcer fonctionnent selon leur libellé.
- [ ] Document supprimé à distance non recréé.
- [ ] Retour/fermeture/déconnexion ne perdent rien sans avertissement.
- [ ] Session MJ nettoyée et Firestore privé absent des caches disque.
- [ ] Portraits et relations inclus dans la recette bout en bout.
- [ ] iPhone/Android, clavier, rotation, deux thèmes et réseau lent.
- [ ] Lint, check, smoke tests, règles et version/cache/changelog verts.

## Critères d'acceptation

Le MJ peut administrer les PNJs de manière quotidienne sur téléphone. Toute donnée non confirmée est
identifiable, les conflits empêchent l'écrasement silencieux et aucune donnée privée n'est persistée.

## Commit

`chore(release): livrer l'administration pnjs mobile (M4-05)`

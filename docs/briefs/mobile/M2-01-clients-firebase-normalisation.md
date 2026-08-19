# M2-01 — Clients Firebase injectables, normalisation et erreurs

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M1-05.

| | |
|---|---|
| Lot | M2 — Couche de données commune |
| Objectif | Séparer l'accès Firebase du DOM et préparer deux niveaux de cache sûrs sur mobile |
| Estimation | 1,5 jour |
| Fichiers | `js/firebase-config.js`, `js/firebase-init.js`, `js/data/`, tests unitaires |
| Dépend de | M1-05 |

## Architecture cible

Le site bureau conserve son client Firebase par défaut. La future application mobile utilise deux
applications Firebase nommées et ne mélange jamais leurs données :

- **client public** : aucune authentification, cache Firestore persistant pour les données publiques ;
- **client MJ** : Firebase Auth et Firestore en mémoire seulement pour les données privées/masquées.

Cette séparation évite qu'une déconnexion laisse des notes MJ ou des documents secrets dans le cache
persistant du navigateur. Elle ne remplace pas les règles serveur.

## À faire

### 1. Extraire la configuration

Créer `js/firebase-config.js` qui exporte la configuration non secrète du projet et l'identifiant MJ
déjà utilisé. `js/firebase-init.js` continue d'exposer `app`, `auth`, `db` et `storage` afin de ne pas
casser les pages existantes. N'initialiser une application nommée qu'une fois et détecter les doubles
imports durant le développement.

### 2. Fournir des fabriques de clients

Créer des fonctions explicites, sans effet DOM :

- client bureau compatible avec le comportement actuel ;
- client public mobile avec persistance locale et stratégie multi-onglet documentée ;
- client MJ mobile avec Auth, Firestore mémoire et Storage ;
- fermeture/nettoyage des listeners lors d'un changement de session ou d'un test.

Si la persistance n'est pas disponible (navigation privée, quota, navigateur non compatible), revenir
au cache mémoire et signaler cet état à l'UI. Le client public ne doit jamais appeler une méthode de
connexion.

### 3. Définir les normaliseurs purs

Ajouter des fonctions qui transforment un snapshot brut en objet applicatif stable. Elles doivent :

- toujours inclure `id` sans permettre aux données de l'écraser ;
- appliquer des valeurs par défaut typées aux tableaux, booléens et chaînes ;
- conserver `createdAt`/`updatedAt` sous une forme comparable ;
- ignorer ou signaler les références invalides ;
- ne jamais fabriquer une visibilité publique permissive après la migration M1 ;
- produire des objets faciles à tester sans Firebase réel.

Prévoir des normaliseurs séparés pour PNJ public, PNJ privé, relation et indice.

### 4. Uniformiser les erreurs

Créer un petit adaptateur d'erreur : `permission`, `offline`, `not-found`, `conflict`, `validation`,
`unknown`. Conserver l'erreur d'origine en cause technique sans afficher son message brut au joueur.
Les vues pourront ainsi proposer « réessayer », « se reconnecter » ou « conflit » de façon cohérente.

### 5. Tester sans navigateur

Tester les normaliseurs, les valeurs absentes, timestamps, identifiants falsifiés et le classement des
erreurs. Injecter des doubles de `db`, `auth` et `storage` : aucun dépôt futur ne doit importer un
singleton Firebase caché. Les dépendances de test restent de développement.

## Ne pas faire

- Ne pas migrer les pages bureau vers les dépôts dans ce brief.
- Ne pas activer de cache persistant pour le client MJ.
- Ne pas ajouter un framework d'état ou un bundler.
- Ne pas présenter la configuration Firebase publique comme un secret ; la sécurité reste dans les règles.

## Vérifications

- [ ] Les exports historiques de `js/firebase-init.js` restent compatibles.
- [ ] Deux initialisations mobiles ne créent pas deux instances de même nom.
- [ ] Le mode public fonctionne sans Auth.
- [ ] Le mode MJ utilise exclusivement une base en mémoire.
- [ ] Un refus de persistance produit un repli contrôlé.
- [ ] Les tests purs s'exécutent avec les commandes standard du dépôt.

## Critères d'acceptation

Le bureau conserve ses exports actuels, tandis qu'une nouvelle vue peut recevoir un client public ou
MJ explicite, des objets normalisés et des erreurs stables sans importer de singleton caché.

## Commit

`refactor(firebase): introduire des clients injectables et normalises (M2-01)`

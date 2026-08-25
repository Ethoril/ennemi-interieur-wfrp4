# M4-01 — Authentification et session MJ mobile

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M2-01 et M3-04.

| | |
|---|---|
| Lot | M4 — Administration PNJs mobile |
| Objectif | Ouvrir un mode MJ sûr et fiable, y compris depuis une PWA installée |
| Estimation | 1,5 jour |
| Fichiers | `js/mobile/session.js`, vue Réglages, composants d'état Auth, CSP si nécessaire |
| Dépend de | M3-04 |

## Principe de session

Le mode joueur continue d'utiliser le client public non authentifié et persistant. Après connexion MJ,
l'application ajoute le client Firebase nommé MJ, dont Firestore reste en mémoire. Les vues privées
lisent uniquement ce client. Déconnexion signifie destruction des abonnements, données et blobs MJ,
pas seulement disparition des boutons.

## À faire

### 1. Choisir le flux adapté au mobile

Utiliser Google Auth via redirection comme flux principal, plus fiable dans une application installée.
Traiter `getRedirectResult()` au démarrage avant de rendre l'état définitif. Le popup peut rester un
repli sur navigateur bureau si testé, sans être le seul chemin. Préserver la route initiale dans un
paramètre local non sensible et y revenir après succès.

Vérifier les domaines autorisés Firebase et les CSP nécessaires sur l'URL GitHub Pages réelle. Ne pas
ajouter de secret OAuth dans le dépôt.

### 2. Modéliser les états

La session expose au minimum : `checking`, `visitor`, `authenticated-non-gm`, `gm`, `signing-in`,
`signing-out`, `error`. Pendant `checking`, ne jamais afficher brièvement les actions MJ. Un compte
Google non autorisé reçoit un message clair et une action de déconnexion ; il garde seulement le mode
joueur.

L'autorité finale reste dans les règles. Le contrôle local de courriel sert uniquement à l'interface.

### 3. Basculer les sources de données

À l'entrée en mode MJ : monter les dépôts MJ en mémoire et abonner les vues administratives. Le store
public peut continuer d'alimenter les parcours joueur. À la sortie :

1. incrémenter la génération de session ;
2. fermer tous les listeners MJ ;
3. révoquer toutes les URLs objet privées ;
4. vider formulaires, notes, erreurs et caches en mémoire ;
5. fermer les routes d'édition vers leur fiche publique ou la liste ;
6. appeler la déconnexion Firebase puis confirmer l'état visiteur.

### 4. Construire l'écran Réglages

Afficher statut de connexion, compte courant de façon minimale, bouton connexion/déconnexion, état du
cache public et version. Ne jamais persister ni journaliser le courriel. Une erreur réseau ou popup
bloqué doit proposer une reprise compréhensible.

### 5. Protéger les routes

Les routes `.../modifier` et toutes les actions d'écriture exigent l'état `gm`. En accès direct avant
fin du contrôle Auth, afficher un chargement. Si l'accès est finalement refusé, remplacer l'historique
par une route sûre et annoncer la raison ; ne pas laisser le contenu privé dans le DOM.

## Scénarios de test

- [ ] Connexion par redirection depuis navigateur mobile.
- [ ] Retour de redirection vers la route initiale.
- [ ] Connexion depuis l'icône installée une fois M6 disponible.
- [ ] Annulation ou erreur du fournisseur sans boucle.
- [ ] Compte Google non-MJ : aucune donnée/action privée.
- [ ] Déconnexion pendant une fiche privée : nettoyage complet.
- [ ] Rechargement d'une route d'édition : contrôle avant rendu.
- [ ] Plusieurs connexions/déconnexions : aucun listener doublé.
- [ ] Firestore MJ n'active jamais la persistance disque.

## Critères d'acceptation

Le MJ peut entrer et sortir du mode administration sur téléphone sans fuite de données privées. Le
parcours joueur reste disponible si Auth échoue ou si le compte n'est pas autorisé.

## Commit

`feat(mobile): ajouter l'authentification mj par redirection (M4-01)`

## Notes d'implémentation

Sur GitHub Pages, le retour Google peut revenir sans utilisateur lorsque le navigateur bloque le
stockage tiers utilisé par le resolver Firebase. La session le détecte avec un marqueur local non
sensible et affiche une reprise explicite. Le popup n'est jamais ouvert automatiquement : il est
proposé au second geste de l'utilisateur, depuis Réglages.

La CSP autorise uniquement l'iframe Auth de `campagne-wrpg.firebaseapp.com` et les endpoints Firebase
nécessaires. La liste des domaines Firebase autorisés et la recette d'une PWA Android restent à
valider sur l'environnement réel ; ce brief n'ajoute aucune configuration de production.

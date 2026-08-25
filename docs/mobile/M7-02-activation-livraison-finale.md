# M7-02 — Activation publique et livraison finale

Date de préparation : 25 août 2026.

## État de livraison

- Version mobile publiée : `4e695f2` / `v2.22.1` (activation `f1d0fdc` / `v2.22.0`).
- Constat Android : l’installation réussit, mais l’icône lance le site bureau parce que le
  manifeste publié conserve encore `start_url: ./index.html`.
- Contrôle Android : l’installation existante ouvre bien l’interface mobile après activation.
- Correctif local non publié : `v2.22.2`, reprise de synchronisation publique en mémoire et par
  transport compatible après une erreur persistante ; aucune donnée Firebase n’est modifiée.
- `id` reste exactement `./index.html` (identité Chrome déjà publiée), `scope` reste `./` et
  `start_url` devient `./app/index.html`.
- iOS reste **non validé — aucun appareil disponible**.

## Compatibilité des installations

Les nouvelles installations utilisent directement `/app/index.html`. Pour une installation
Android déjà créée avec l’ancien point de démarrage, `js/pwa-entry.js` redirige uniquement l’entrée
racine lancée en mode `standalone`. Un onglet navigateur ordinaire, une page bureau explicite ou
une URL PNJs/Enquêtes bureau ne sont jamais redirigés selon la largeur d’écran.

La stabilité du champ `id` évite de déclarer une deuxième application. Le contrôle physique a
confirmé que l’icône existante reçoit la mise à jour, ouvre `/app/` et ne crée pas de doublon.

## Découverte et données communes

La navigation bureau et la carte d’accueil proposent désormais « Version mobile » / « Application
mobile ». L’installation reste facultative ; la première synchronisation exige internet. Bureau et
mobile utilisent les mêmes dépôts, documents Firestore et objets Storage protégés. Les données
publiques peuvent être conservées hors ligne ; Auth, notes MJ, données secrètes et images protégées
restent hors Cache Storage et du stockage local.

La maintenance et la checklist « Faire évoluer PNJs ou Enquêtes » sont centralisées dans le README.

## Validation avant publication

- résolution du manifeste sous `https://ethoril.github.io/ennemi-interieur-wfrp4/` ;
- identité `id` historique inchangée et démarrage sous le même scope ;
- redirection de compatibilité testée pour racine standalone, racine navigateur et page bureau ;
- manifeste unique, Service Worker racine unique et graphe de précache fermé ;
- liens publics sans identifiant de campagne ;
- version, cache, méta et CHANGELOG alignés ;
- lint, tests ciblés, suite complète et contrôle du diff à exécuter avant commit.

## Recette après publication

1. Dans l’installation existante, appliquer `v2.22.2`, utiliser « Réessayer » et confirmer le
   retour à « Synchronisé avec le serveur » sans perdre les données déjà reçues.
2. Confirmer l’ouverture de `/app/`, l’absence de deuxième icône et le fonctionnement du retour.
3. Depuis Chrome sans installation, ouvrir le lien public mobile puis réaliser une nouvelle
   installation et confirmer le même démarrage.
4. Vérifier une lecture joueur, la session MJ déjà autorisée, PNJs, Enquêtes et les pages bureau.
5. Contrôler version interface/worker, console et Cache Storage sans donnée protégée.

La matrice Android étendue reste distincte de ces contrôles. La recette iOS demeure différée.

## Retour arrière

Pour un défaut uniquement mobile : retirer les liens vers `app/`, remettre
`start_url: ./index.html` en conservant exactement le même `id`, publier une nouvelle version du
worker et vérifier l’ancien démarrage. La redirection standalone doit être retirée dans le même lot.

Ce rollback d’interface ne restaure ni Firestore ni Storage et ne touche pas aux deux portraits
orphelins connus. Une restauration de sauvegarde n’est envisagée qu’après une corruption de données
confirmée et une autorisation séparée.

## Checklist

- [x] `id` inchangé, `scope` inchangé et `start_url` mobile résolu sous le sous-chemin.
- [x] Compatibilité de l’ancienne entrée standalone couverte localement.
- [x] Liens de découverte ajoutés sans redirection d’un onglet bureau.
- [x] Documentation de maintenance et rollback ajoutée.
- [x] Publication de `v2.22.0` autorisée et workflows verts.
- [x] Installation Android existante mise à jour et relancée sur `/app/` sans seconde application.
- [x] Publication du correctif visuel `4e695f2` / `v2.22.1`.
- [ ] Publication et contrôle Android du correctif réseau `v2.22.2`.
- [ ] Nouvelle installation Android vérifiée.
- [ ] iOS : différé, non validé.

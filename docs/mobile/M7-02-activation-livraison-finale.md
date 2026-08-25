# M7-02 — Activation publique et livraison finale

Date de préparation : 25 août 2026.

## État de livraison

- Version cachée publiée au début du lot : `3386741` / `v2.21.8`.
- Constat Android : l’installation réussit, mais l’icône lance le site bureau parce que le
  manifeste publié conserve encore `start_url: ./index.html`.
- Candidat local non publié : `v2.22.0`, activation du démarrage mobile sans changement d’identité.
- `id` reste exactement `./index.html` (identité Chrome déjà publiée), `scope` reste `./` et
  `start_url` devient `./app/index.html`.
- iOS reste **non validé — aucun appareil disponible**.

## Compatibilité des installations

Les nouvelles installations utilisent directement `/app/index.html`. Pour une installation
Android déjà créée avec l’ancien point de démarrage, `js/pwa-entry.js` redirige uniquement l’entrée
racine lancée en mode `standalone`. Un onglet navigateur ordinaire, une page bureau explicite ou
une URL PNJs/Enquêtes bureau ne sont jamais redirigés selon la largeur d’écran.

La stabilité du champ `id` évite de déclarer une deuxième application. Après publication, le test
physique doit confirmer que l’icône existante reçoit la mise à jour, ouvre `/app/` et ne crée pas de
doublon. Cette preuve n’est pas revendiquée avant son exécution réelle.

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

1. Dans l’installation existante, appliquer `v2.22.0` puis fermer et relancer depuis l’icône.
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
- [ ] Publication de `v2.22.0` autorisée et workflows verts.
- [ ] Installation Android existante mise à jour sans doublon et relancée sur `/app/`.
- [ ] Nouvelle installation Android vérifiée.
- [ ] iOS : différé, non validé.

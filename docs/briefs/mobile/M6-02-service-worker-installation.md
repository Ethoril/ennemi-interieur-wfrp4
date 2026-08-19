# M6-02 — Service worker, mise à jour et aides d'installation

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M5-03 et M6-01.

| | |
|---|---|
| Lot | M6 — Installation PWA |
| Objectif | Rendre `/app/` fiable hors ligne et guider l'installation sans cacher les mises à jour |
| Estimation | 2 jours |
| Fichiers | `sw.js`, enregistrement SW, composants installation/mise à jour, contrôles CI |
| Dépend de | M5-03, M6-01 |

## Un seul service worker

Conserver le worker racine actuel afin qu'il couvre site bureau et `/app/`. Ajouter les ressources de
la coque mobile au précache. Aucun second worker ni scope concurrent ne doit être créé.

## À faire

### 1. Auditer et compléter le précache

Lister explicitement `app/index.html`, feuille mobile, routeur, store, session, composants, vues et
dépôts communs nécessaires à un démarrage hors ligne. Ajouter un test CI qui échoue si un chemin de
précache n'existe pas ou si un module importé indispensable est oublié. Les ressources Firebase CDN
nécessaires au démarrage doivent avoir une stratégie documentée, sans ajouter de bundler.

Le précache concerne la coque, pas les données. Firestore gère le cache public et le client MJ reste en
mémoire.

### 2. Exclure strictement les données protégées

Le worker actuel met en cache les réponses non-code et doit être durci. Contourner totalement Cache
Storage pour : Firestore, Auth, Secure Token, Firebase Storage et toute URL de blob/objet protégée.
Comparer les hôtes/chemins via `URL`, pas une recherche de chaîne fragile. Ne jamais mettre en cache une
réponse opaque provenant des domaines Storage.

Vérifier avec un indice secret en session MJ, puis inspecter Cache Storage après déconnexion.

### 3. Choisir les stratégies

- Navigation/code local : network-first avec repli coque/cache.
- Ressources statiques immuables locales : cache-first ou stale-while-revalidate versionné.
- Firebase et médias protégés : réseau/SDK uniquement, aucun cache SW.
- Navigation `/app/` hors ligne : servir `app/index.html`, puis laisser le routeur interpréter le hash.
- Ressource absente : réponse explicite, jamais `undefined` silencieux.

Éviter qu'une panne d'un CDN non essentiel fasse échouer toute l'installation du worker.

### 4. Rendre la mise à jour contrôlée

Remplacer l'activation immédiate systématique par un flux : détecter un worker en attente, afficher
« Mise à jour disponible », laisser l'utilisateur déclencher `SKIP_WAITING`, puis recharger une seule
fois après `controllerchange`. Ne pas interrompre un formulaire sale ; différer la proposition ou
prévenir ce qui sera conservé.

Nettoyer les anciens caches seulement à l'activation du nouveau worker. Prévoir un bouton diagnostic
dans Réglages : version interface, version worker et action rechercher une mise à jour.

### 5. Guider l'installation

Sur navigateurs compatibles, conserver `beforeinstallprompt` et afficher une action non intrusive après
un usage minimal. Sur iOS, proposer des instructions visuelles « Partager → Sur l'écran d'accueil ».
Masquer l'aide si l'application est déjà en `standalone`, si l'utilisateur l'a écartée récemment ou si
le contexte n'est pas installable. L'application reste pleinement utilisable sans installation.

## Tests

- [ ] Chaque fichier de précache existe et est servi avec le bon type.
- [ ] Démarrage `/app/` hors ligne après une première visite.
- [ ] Les données publiques cachées s'affichent avec leur statut.
- [ ] Aucune requête Firebase/Storage ni image privée dans Cache Storage.
- [ ] Nouvelle version : bannière, activation volontaire, un seul rechargement.
- [ ] Formulaire sale non perdu par une mise à jour automatique.
- [ ] Installation Android proposée puis lancement standalone.
- [ ] Aide iOS correcte et masquée en standalone.
- [ ] Pages bureau existantes restent couvertes par le même worker.

## Critères d'acceptation

La coque mobile démarre hors ligne après une première visite, les mises à jour restent contrôlées par
l'utilisateur et aucun contenu Firebase protégé ne transite par Cache Storage.

## Commit

`feat(pwa): integrer la coque mobile et les mises a jour controlees (M6-02)`

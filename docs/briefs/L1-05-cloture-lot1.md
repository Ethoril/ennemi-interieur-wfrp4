# L1-05 — Clôture du lot 1 : CHANGELOG, version, livraison

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md)**, en particulier la section 6.

|  |  |
|---|---|
| **Lot** | 1 — sécurité (v2.13.2) |
| **Constat d'audit** | N1 |
| **Estimation** | 45 min |
| **Fichiers** | `CHANGELOG.md`, `js/layout.js`, `sw.js` |
| **Dépend de** | `L1-01`, `L1-02`, `L1-03`, `L1-04` — tous terminés et vérifiés |

---

## Pourquoi

Deux choses à la fois.

D'abord, **le CHANGELOG a deux versions de retard** : `APP_VERSION` vaut `v2.13.1` mais le
fichier s'arrête à `2.12.0`. L'accueil immersif Three.js et son correctif de défilement ne sont
pas documentés, alors que le projet s'est fixé la règle de tenir ce fichier à chaque
modification. Il faut rattraper avant d'ajouter l'entrée du lot.

Ensuite, **la version doit être bumpée** pour que les visiteurs reçoivent réellement les
correctifs de sécurité : sans changement de `CACHE_NAME`, le service worker continue de servir
l'ancien JavaScript depuis son cache.

---

## À faire

### 1. Rattraper les deux entrées manquantes

À reconstituer depuis les commits `526b749` (« feat: accueil immersif Three.js - La Comete a
deux queues (v2.13.0) ») et `dc748bd` (« fix: espace de scroll supplementaire avant la vue
finale (v2.13.1) »), et depuis les fichiers `js/hero3d/` et `css/hero3d.css`.

Suivre exactement le format des entrées existantes : titre de niveau 2 avec version et date,
puis des rubriques de niveau 3, puis des puces dont le début est en gras.

```markdown
## [2.13.1] - 2026-06-03

### Accueil
- **Espace de défilement supplémentaire** : ajout de hauteur avant la vue finale pour que les
  cartes de navigation soient sorties de l'écran quand la caméra plonge sur la skyline.

## [2.13.0] - 2026-06-03

### Accueil — « La Comète à deux queues »
- **Scène 3D au chargement** : … (starfield, comète, Morrslieb, skyline, timeline de scroll
  en 5 chapitres pilotée par des ancres de la page)
- **Conditionnement de la scène** : … (WebGL, prefers-reduced-motion, largeur < 768 px,
  thème parchemin, support des import maps ; pause à l'onglet caché ; DPR plafonné)
- **Thème sombre par défaut** : … (réinitialisation unique des préférences stockées via le
  drapeau `themeResetV213`)

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v7`.
```

Compléter les points de suspension en lisant les fichiers concernés. Rester factuel : ce
CHANGELOG est lu par le MJ, pas par un développeur.

### 2. Ajouter l'entrée du lot 1

En tête du fichier, au-dessus de `[2.13.1]`. Retirer la section `## [Non publié]` qui décrit
les briefs et la remplacer par cette entrée.

```markdown
## [2.13.2] - AAAA-MM-JJ

### Sécurité
- **Injection HTML sur le Calendrier (critique)** : les pseudos des votants et les libellés de
  dates sont désormais échappés avant affichage. Le vote étant anonyme, n'importe quel visiteur
  pouvait faire exécuter du script chez les autres, dont le Maître de Jeu. Le pseudo est
  également borné en longueur.
- **Injection HTML sur les fiches de personnages** : échappement des libellés d'achat XP, noms
  de sorts, notes de carrières, spécialisations personnalisées et talents ajoutés à la main.
  Une fiche de joueur pouvait atteindre la session du Maître de Jeu.
- **Règles Firebase versionnées** : `firestore.rules` et `storage.rules` entrent dans le dépôt.
  Les indices non découverts ne sont plus lisibles hors Maître de Jeu, la collection `mail` ne
  peut plus servir de relais, et un visiteur anonyme ne peut plus modifier que sa réponse au
  sondage.
- **Validation du personnage demandé** : le paramètre `char` de la fiche est vérifié contre la
  liste des personnages connus.

### Personnages
- **Accès des joueurs à leur fiche** : la table des autorisations passe dans Firestore
  (`campagne/acces`). Chaque joueur accède désormais à sa fiche avec son compte Google —
  la fonctionnalité annoncée en 2.10.0 ne fonctionnait en réalité que pour le Maître de Jeu.
  Ajouter ou retirer un joueur ne demande plus de mise en ligne.

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v8`.
```

Remplacer `AAAA-MM-JJ` par la date réelle de livraison.

### 3. Bumper les deux constantes

```js
// js/layout.js, l. 1
const APP_VERSION = 'v2.13.2';
```

```js
// sw.js, l. 1
const CACHE_NAME = 'wfrp-cache-v8';
```

Les deux sont indépendantes aujourd'hui, d'où le risque d'en oublier une. Le brief `L2-12`
ajoute un contrôle CI qui rendra cette synchronisation automatique.

### 4. Relire avant de pousser

Le lot 1 ne touche pas au CSS, donc le risque visuel est faible. Trois vérifications suffisent,
mais elles sont indispensables : ce lot contient les règles Firebase, et une règle trop stricte
casse le site pour tout le monde.

---

## Ne pas faire

- **Ne pas lancer `deploy.ps1` avant d'avoir déroulé la checklist.** Le script pousse
  directement sur `master`, donc en production, sans confirmation.
- **Ne pas déployer le code sans avoir déployé les règles Firebase**, ni l'inverse. `L1-03`
  (client) et `L1-04` (règles) forment une paire : le code lit `campagne/acces`, la règle
  l'exige. Déployer l'un sans l'autre casse l'accès aux fiches.
- **Ne pas inventer de contenu pour les entrées 2.13.0 et 2.13.1.** Si un détail est incertain,
  rester général plutôt qu'affirmer quelque chose de faux.

---

## Vérification

- [ ] `CHANGELOG.md` contient les entrées `2.13.0`, `2.13.1` et `2.13.2`, dans cet ordre
      décroissant, au format des entrées existantes.
- [ ] La section `## [Non publié]` a disparu.
- [ ] `APP_VERSION` vaut `v2.13.2` et le numéro apparaît bien dans la barre de navigation de
      toutes les pages.
- [ ] `CACHE_NAME` vaut `wfrp-cache-v8`.
- [ ] Le document `campagne/acces` existe en Firestore et contient les adresses réelles.
- [ ] Les règles Firebase sont déployées et la checklist de `L1-04` est intégralement cochée.
- [ ] Sur une machine ayant visité l'ancienne version : un rechargement sert bien le nouveau
      JavaScript (vérifier le numéro de version dans la barre de navigation).
- [ ] Parcours complet en compte joueur : ouvrir sa fiche, modifier une caractéristique,
      recharger, la valeur est là.
- [ ] Parcours complet en compte MJ : les six fiches, un PNJ, un indice, le calendrier
      impérial, le sondage.
- [ ] Parcours déconnecté : accueil, groupe, vidéos, aides de jeux, règles, cartes, PNJs,
      enquêtes, calendrier.

---

## Message de commit

```
release: v2.13.2 - lot de securite et acces des fiches

- CHANGELOG : rattrapage des entrees 2.13.0 et 2.13.1 manquantes
- CHANGELOG : entree 2.13.2 (B1, I1, B2, B3)
- APP_VERSION v2.13.2, cache wfrp-cache-v8
```

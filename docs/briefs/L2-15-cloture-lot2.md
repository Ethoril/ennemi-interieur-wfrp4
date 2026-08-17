# L2-15 — Clôture du lot 2 : CHANGELOG, version, livraison

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md)**, en particulier la section 6.

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | N1 |
| **Estimation** | 45 min |
| **Fichiers** | `CHANGELOG.md`, `js/layout.js`, `sw.js` |
| **Dépend de** | les quatorze briefs `L2-01` à `L2-14`, terminés et vérifiés |

---

## Pourquoi

Le lot 2 touche au CSS de **toutes** les pages (`L2-05`, `L2-10`), aux images, au service worker
et au chemin de sauvegarde de la fiche. C'est le lot qui peut casser quelque chose de visible.

Cette clôture n'est pas une formalité : c'est la dernière relecture avant que 28 heures de
modifications partent en production d'un seul `git push`.

---

## À faire

### 1. Rédiger l'entrée de CHANGELOG

En tête du fichier, au format des entrées existantes, groupée par rubrique. Squelette à
compléter selon ce qui a réellement été livré — retirer les rubriques dont aucun brief n'a été
traité.

```markdown
## [2.14.0] - AAAA-MM-JJ

### Fiche de personnage
- **Export et import JSON** : deux boutons permettent de télécharger une sauvegarde complète de
  la fiche et de la restaurer. À conserver hors du navigateur : c'est le seul filet en cas de
  fausse manœuvre.
- **Sauvegardes cloud fiabilisées** : les modifications faites juste avant la fermeture de
  l'onglet ne sont plus perdues, et deux modifications rapprochées ne s'écrasent plus.
- **Espèce Nain** ajoutée au sélecteur, et **rang maximum porté à 5** pour la carrière Mage (HE).

### Calendrier
- **Thème Parchemin réparé** : la page était illisible en thème clair, les champs de saisie et
  le panneau du Maître de Jeu gardant un fond sombre. La mise en forme est sortie du
  JavaScript vers une feuille de style.

### Aides de Jeux
- **Recherche** : les en-têtes de colonnes ne disparaissent plus quand on filtre.

### Accueil
- **Défilement plus fluide** : la scène 3D ne force plus un recalcul de mise en page à chaque
  événement de défilement.

### Accessibilité
- **Libellés de formulaire** associés à leur champ sur la fiche, les PNJs et les enquêtes : les
  champs sont désormais annoncés correctement par un lecteur d'écran.
- **Lien « Aller au contenu »** sur toutes les pages, et repère de contenu principal.
- **Indicateur de focus** visible et homogène pour la navigation au clavier.
- **Annonce des changements d'état** : l'indicateur de sauvegarde et les erreurs de vote sont
  signalés aux technologies d'assistance.

### Confort
- **Confirmations dans le thème** : les sept suppressions irréversibles passent par une modale
  du site au lieu d'un dialogue du navigateur, avec le nom de l'élément concerné et un défaut
  sur « Annuler ».

### Performance
- **Chargement des styles** : la chaîne de trois `@import` est supprimée, les feuilles et la
  police se chargent en parallèle.
- **Images** : 31 Mo supprimés — un fond décoratif de 14 Mo jamais utilisé et les cinq images
  de repli PNG, devenues inutiles.

### Sécurité
- **Politique de sécurité du contenu resserrée** : `unsafe-inline` retiré des dix pages qui n'en
  avaient pas besoin, origines autorisées réduites à celles réellement utilisées par chaque page.

### PWA & Cache
- **Page hors-ligne** : une page d'attente s'affiche à la place de l'erreur du navigateur.
- **Pré-cache élargi** : les onze pages, les données de carrières et de compétences et les
  librairies externes sont mises en cache dès la première visite. Une panne de CDN ne rend plus
  la page PNJs inutilisable.
- **Incrémentation du cache** : passage en `wfrp-cache-v2.14.0`.

### Outillage
- **Contrôles automatiques** : la syntaxe du JavaScript est vérifiée à chaque poussée, et la
  cohérence entre le numéro de version, la version du cache et l'entrée de CHANGELOG est
  désormais imposée par l'intégration continue.
- **Nettoyage** : correction de l'encodage de l'historique, suppression du code mort et des
  vestiges de développement.
```

Rester dans le registre des entrées existantes : ce fichier est lu par le MJ, pas par un
développeur. Décrire l'effet visible, pas l'implémentation.

Retirer la section `## [Non publié]` si elle est encore présente.

### 2. Bumper les deux constantes

```js
// js/layout.js, l. 1
const APP_VERSION = 'v2.14.0';
```

```js
// sw.js, l. 1
const APP_VERSION = 'v2.14.0';           // vérifié par la CI
const CACHE_NAME  = 'wfrp-cache-' + APP_VERSION;
```

Le contrôle CI ajouté par `L2-12` vérifie que les deux correspondent **et** que le CHANGELOG a
son entrée. Si la CI échoue, c'est qu'un des trois a été oublié — c'est exactement son rôle.

### 3. Relecture complète

Le lot a touché aux styles de toutes les pages. Dérouler la checklist ci-dessous en entier, sur
poste **et** sur mobile, dans les **deux** thèmes.

---

## Ne pas faire

- **Ne pas lancer `deploy.ps1` avant d'avoir déroulé la checklist.** Le script pousse
  directement sur `master`, donc en production, sans confirmation.
- **Ne pas livrer un lot partiel sans adapter l'entrée de CHANGELOG.** Si trois briefs ont été
  reportés, retirer les rubriques correspondantes plutôt que d'annoncer ce qui n'existe pas.
- **Ne pas passer en `v3.0.0`.** Aucune rupture pour l'utilisateur : `v2.14.0` est correct.
- **Ne pas cumuler la livraison avec un nouveau chantier.** Ce commit ne contient que le
  CHANGELOG et les deux constantes.

---

## Vérification

### Les onze pages, deux thèmes, poste et mobile

- [ ] `index.html` — scène 3D, calendrier impérial, date de prochaine session, quatre cartes
- [ ] `groupe.html` — les cinq portraits et la fiche de test
- [ ] `videos.html` — vignettes et lecture dans la modale
- [ ] `tableau.html` — les huit onglets, la recherche, les en-têtes qui restent visibles
- [ ] `regles.html` — les accordéons et les sous-tableaux de critiques
- [ ] `cartes.html` — les deux vignettes
- [ ] `carte.html` — les deux cartes, le zoom, l'outil de mesure
- [ ] `pnjs.html` — graphe, filtres, coloration, vue tableau, panneau de détail, édition MJ
- [ ] `enquetes.html` — liste, recherche, filtres MJ, création et modification d'indice
- [ ] `doodle.html` — les deux formats, le vote, la modale, le panneau MJ
- [ ] `fiche.html` — parcours complet, cf. ci-dessous

### Parcours complet de la fiche

- [ ] Connexion en compte **joueur** : sa fiche s'ouvre, une modification se sauvegarde, un
      rechargement la retrouve.
- [ ] Achat XP appliqué puis annulé : la caractéristique revient à sa valeur.
- [ ] Export, réinitialisation, réimport : l'état est identique.
- [ ] Panneau de carrière : variante de rang, personnalisation d'un rang, lignes fantômes.

### Bascule et régression

- [ ] Bascule de thème sur les onze pages, **sans flash** de style.
- [ ] Depuis une machine ayant visité la v2.13.2 : un rechargement sert bien la v2.14.0
      (numéro visible dans la barre de navigation).
- [ ] Mode hors-ligne : la page hors-ligne s'affiche pour une page jamais visitée.
- [ ] Console vide sur les onze pages — aucune erreur, aucune violation de CSP, aucune 404.
- [ ] La CI est verte sur les quatre tâches (smoke-test, json-lint, syntaxe, lint) plus la
      cohérence de version.

### Documentation

- [ ] `CHANGELOG.md` a son entrée `2.14.0`, la section `Non publié` a disparu, et les rubriques
      correspondent à ce qui a réellement été livré.
- [ ] Les briefs de `docs/briefs/` traités sont marqués comme faits, ou le dossier est archivé
      dans `docs/archives/` si le chantier est clos.

---

## Message de commit

```
release: v2.14.0 - fiabilite, poids, theme parchemin, accessibilite

- CHANGELOG : entree 2.14.0
- APP_VERSION v2.14.0, cache derive de la version
```

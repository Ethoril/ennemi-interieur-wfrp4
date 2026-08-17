# Briefs de correction — audit de la v2.13.1

Briefs issus de l'audit technique du 10 août 2026, répartis en deux lots.
Chacun est autonome : un objectif, les fichiers concernés, le détail des modifications et une
checklist de vérification.

## Mode d'emploi

1. **Lire [`00-CONVENTIONS.md`](00-CONVENTIONS.md).** Contraintes d'architecture, interdits,
   style, règle d'échappement, discipline de version. Ce document prévaut sur tout brief.
2. Prendre un brief, dans l'ordre du lot.
3. Le traiter en un commit, avec le message fourni en fin de brief.
4. Cocher toute la checklist de vérification avant de passer au suivant.

Les briefs ne recopient pas le code existant : ils donnent le fichier, la fonction et la ligne.
Le dépôt est la source de vérité.

## Lot 1 — sécurité et déblocage (v2.13.2)

Se livre seul et en premier. Ne touche pas à l'apparence du site, ce qui limite le risque de
régression visuelle.

| Brief | Objet | Constat | Estim. |
|---|---|---|---|
| [L1-01](L1-01-echappement-doodle.md) | Échapper les rendus du Calendrier | B1 — critique | 1 h 30 |
| [L1-02](L1-02-echappement-fiche.md) | Échapper les rendus de la fiche | I1 | 1 h 30 |
| [L1-03](L1-03-acces-fiches.md) | Ouvrir les fiches aux joueurs | B2 — critique | 1 h 30 |
| [L1-04](L1-04-regles-firebase.md) | Versionner et durcir les règles Firebase | B3 — critique | 3 h |
| [L1-05](L1-05-cloture-lot1.md) | CHANGELOG, version, livraison | N1 | 45 min |

## Lot 2 — fiabilité, poids, thème, accessibilité (v2.14.0)

Briefs indépendants sauf mention contraire. Deux contraintes d'ordre : `L2-05` avant `L2-12`,
et `L2-01` avant `L2-02`.

| Brief | Objet | Constat | Estim. |
|---|---|---|---|
| ~~[L2-01](L2-01-sauvegarde-cloud.md)~~ | ~~Fiabiliser la sauvegarde cloud~~ — **livré en v2.13.4** | I2 | — |
| ~~[L2-02](L2-02-export-import-fiche.md)~~ | ~~Export et import JSON de la fiche~~ — **livré en v2.14.0** | I3 | — |
| [L2-04](L2-04-css-calendrier.md) | Sortir la mise en forme du Calendrier du JS — **traité et validé** | I4 | — |
| ~~[L2-05](L2-05-depliage-css.md)~~ | ~~Déplier la chaîne de chargement CSS~~ — **livré en v2.14.1** | M1 | — |
| ~~[L2-06](L2-06-allegement-images.md)~~ | ~~Supprimer 31 Mo d'images~~ — **livré en v2.14.0** | M2 | — |
| ~~[L2-07](L2-07-csp.md)~~ | ~~Resserrer la CSP~~ — **livré en v2.14.1** | M3 | — |
| [L2-08](L2-08-correctifs-cibles.md) | Trois correctifs ciblés | M4, M5, M7 | 1 h |
| [L2-09](L2-09-libelles-annonces.md) | Libellés de formulaire et annonces | N3 | 1 h |
| [L2-10](L2-10-reperes-focus.md) | Repères de page et indicateur de focus | N3 | 45 min |
| [L2-11](L2-11-modale-confirmation.md) | Modale de confirmation | N4 | 2 h |
| [L2-12](L2-12-service-worker.md) | Service worker : hors-ligne et version liée — **relu, en attente de livraison** | N5, N8 | — |
| [L2-13](L2-13-hygiene.md) | Encodage, code mort, fichiers obsolètes — **traité, en attente de livraison** | N2, N6 | — |
| [L2-14](L2-14-ci-lint.md) | Contrôles de syntaxe et ESLint en CI — **relu, en attente de livraison** | N7 | — |
| ~~[L2-16](L2-16-calendrier-date-reelle.md)~~ | ~~Calendrier impérial calé sur la date du jour~~ — **livré en v2.13.3** | hors audit | — |
| [L2-15](L2-15-cloture-lot2.md) | CHANGELOG, version, livraison | N1 | 45 min |

### Déjà livrés — ne pas reprendre

- **`L2-01`**, en v2.13.4. Traité en hotfix le 17 août 2026 après une perte de données en
  production, et **dépassé** : le brief ne couvrait que la file d'attente et le vidage avant
  fermeture. Le vrai coupable était l'arbitrage local/cloud, qui comparait deux horloges et
  faisait qu'ouvrir une fiche la marquait comme modifiée — une simple consultation pouvait donc
  reverser un cache périmé par-dessus les modifications d'autrui. Corrigé par un drapeau
  `_dirty` et une garde `withoutSaving()`. Lire le commit `fe6d622` plutôt que le brief.
- **`L2-16`**, en v2.13.3, avec les briefs `L1-03` et `L1-04`.
- **`L2-02`** et **`L2-06`**, en v2.14.0.
- **`L2-05`** et **`L2-07`**, en v2.14.1. `L2-05` a dû réparer `sw.js` au passage : sa liste
  de pré-cache citait `css/style.css`, supprimé par ce même brief, ce qui faisait échouer
  l'installation du service worker en silence (`cache.addAll()` est atomique).

### Relus, sur branche, pas encore livrés

- **`L2-12`** et **`L2-14`**, sur `lot-2-outillage` (`e4d401f`, `f96fddb`, plus `3105cfa` qui solde
  la relecture). Vérifié hors navigateur : les 50 ressources locales et les 6 URL CDN du pré-cache
  répondent 200, `npm run lint` sort 0 erreur et 0 avertissement sur 27 fichiers, `node --check`
  passe sur 26, et le contrôle de cohérence de version fonctionne malgré le `"type": "module"`
  ajouté par `L2-14`. **Checklist navigateur validée par le MJ** le 17 août 2026. Une scorie est
  reportée dans `L2-15` étape 3 : `offline.html` n'a pas de `<link rel="icon">` et sa CSP bloque
  la requête implicite vers `/favicon.ico`.
- **`L2-13`**, sur `lot-2-outillage` (`738fefc`, `3c40280`). L'encodage du CHANGELOG est rétabli :
  891 séquences par aller-retour cp1252, plus 7 irrécupérables reconstituées d'après le glyphe
  réellement présent dans le source (`━` de `js/pnjs.js:697`, `✏`, `←`, le sélecteur de variante
  emoji) — les octets `0x81`, `0x8F` et `0x90` n'existant pas en cp1252, le convertisseur les
  avait remplacés par `U+FFFD`. Vérifié : le fichier privé de ses caractères non-ASCII est
  identique à l'original, donc aucun mot n'a bougé. Les sept points de code mort sont faits.
  **Validé au navigateur par le MJ** le 17 août 2026 : les huit onglets des Aides de Jeux (la
  branche `firstRowCorrupted` de `js/sheets.js` a été retouchée) et `index.html?hero3dDebug=1`.
  À noter pour plus tard : aucun des huit onglets ne déclenche cette branche aujourd'hui, les
  huit feuilles ayant un en-tête simple. Elle ne sert donc à rien en l'état.
- **`L2-04`**, sur `lot-2-outillage` (`306b208`). Les 99 attributs `style=` de `js/doodle.js` et
  `doodle.html` sont partis dans `css/doodle.css`, 78 classes nommées par rôle, zéro couleur
  littérale restante. `--statut-allie`, `--statut-ennemi` et `--statut-neutre` n'existaient que
  dans `theme-parchment.css` : ils sont désormais aussi dans le `:root` de `base.css`, avec les
  valeurs de repli sur lesquelles `js/pnjs.js` retombait déjà, donc sans effet visuel.
  Sa table de correspondance change volontairement l'apparence en thème sombre — fond des champs,
  du panneau MJ, de la ligne de vote, et les trois teintes de vote — ce que ses « ne pas faire »
  interdisent par ailleurs. **Ces écarts ont été validés à l'écran par le MJ** le 17 août 2026 ;
  leur détail est dans le message de `306b208`.

Il reste donc **5 briefs** à traiter au lot 2 : `L2-08` à `L2-11`, `L2-15`.

## Hors périmètre

Écartés sur décision, à ne pas traiter :

- **M6** — barème XP tronqué au-delà de 30 avances (`CARAC_XP_BANDS` et `SKILL_XP_BANDS`
  plafonnent à 90 et 30 XP). Sans effet sur une campagne rang 1 à 4.
- **M8** — absence de tableau d'armes et de suivi des points d'armure sur la fiche.
- **M7 partiel** — le Mouvement du Halfelin reste à 4 et la formule de Blessures reste
  générique pour toutes les espèces. Seuls l'ajout de l'espèce Nain et le passage du rang
  maximum à 5 sont demandés (brief `L2-08`).
- **N4 partiel** — seules les 7 actions destructives passent en modale ; les 6 `alert()`
  d'erreur restent en place.
- **L2-03, feuille d'impression de la fiche** — supprimé le 17 août 2026 : le groupe ne joue pas
  sur fiche papier. Le volet export et import JSON du constat I3 reste, lui, au programme
  (`L2-02`).

## Ce que la règle des données personnelles ne couvre pas

La convention [§8](00-CONVENTIONS.md) interdit le nom civil de quiconque dans ce dépôt public.
**Les prénoms des votants du Calendrier n'entrent pas dans cette interdiction** : ils sont le
principe même de la fonctionnalité — on vote sous son prénom, et celui du MJ est réservé pour que
sa ligne soit créée d'office et triée en premier. Tranché par le MJ le 17 août 2026 après un
signalement à tort pendant `L2-13`.

Sont donc normaux, et à ne pas « corriger » : la clé de la map `responses` écrite par
`js/doodle.js`, le nom réservé, le tri, le modèle d'e-mail, et les prénoms cités en exemple dans
les checklists des briefs et le CHANGELOG.

Ce que §8 visait reste entier : **adresses électroniques de joueurs, jetons, clés privées**, et le
nom civil de personnes qui ne se sont pas exposées elles-mêmes.

## Une décision reste ouverte

Elle se pose dans le brief `L1-04` et **ne doit pas être tranchée sans validation** :

Le pseudo d'un votant du Calendrier est une *clé* de la map `responses`. Le langage de règles
Firestore ne sait pas extraire une clé pour en tester la longueur ou le contenu, il n'y a pas
de boucle. La validation du pseudo ne peut donc être que côté client tant que la structure de
données reste une map.

`L1-04` implémente la solution retenue par défaut — validation côté client, règles limitant le
nombre de votants et de clés modifiées par écriture. L'alternative (passer `responses` en
tableau d'objets `[{ nom, votes }]`, ce qui rend le pseudo validable côté serveur au prix
d'une migration et de la réécriture de trois fonctions) est documentée dans le brief mais
**n'est pas à mettre en œuvre** sans accord préalable.

# Briefs de correction — audit de la v2.13.1

Vingt briefs issus de l'audit technique du 10 août 2026, répartis en deux lots.
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
| [L2-02](L2-02-export-import-fiche.md) | Export et import JSON de la fiche | I3 | 1 h 30 |
| [L2-03](L2-03-feuille-impression.md) | Feuille d'impression de la fiche | I3 | 1 h |
| [L2-04](L2-04-css-calendrier.md) | Sortir la mise en forme du Calendrier du JS | I4 | 3 h |
| [L2-05](L2-05-depliage-css.md) | Déplier la chaîne de chargement CSS | M1 | 1 h |
| [L2-06](L2-06-allegement-images.md) | Supprimer 31 Mo d'images | M2 | 30 min |
| [L2-07](L2-07-csp.md) | Resserrer la CSP | M3 | 1 h |
| [L2-08](L2-08-correctifs-cibles.md) | Trois correctifs ciblés | M4, M5, M7 | 1 h |
| [L2-09](L2-09-libelles-annonces.md) | Libellés de formulaire et annonces | N3 | 1 h |
| [L2-10](L2-10-reperes-focus.md) | Repères de page et indicateur de focus | N3 | 45 min |
| [L2-11](L2-11-modale-confirmation.md) | Modale de confirmation | N4 | 2 h |
| [L2-12](L2-12-service-worker.md) | Service worker : hors-ligne et version liée | N5, N8 | 1 h 30 |
| [L2-13](L2-13-hygiene.md) | Encodage, code mort, fichiers obsolètes | N2, N6 | 1 h |
| [L2-14](L2-14-ci-lint.md) | Contrôles de syntaxe et ESLint en CI | N7 | 1 h 30 |
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

Il reste donc **14 briefs** au lot 2 : `L2-02` à `L2-15`.

`L2-16` ne vient pas de l'audit : c'est une demande du 11 août 2026, ajoutée après coup. Elle
répare au passage un défaut que l'audit avait manqué — le calendrier de l'accueil affichait la
même date depuis sa mise en ligne. Numérotée après `L2-14` pour ne pas renuméroter les briefs
existants, mais à traiter **avant** `L2-15`, qui clôture le lot.

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

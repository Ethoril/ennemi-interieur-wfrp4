# Fiche de personnage bureau — cahier des charges

> Rédigé le 6 octobre 2026 à partir des arbitrages sur la maquette (canevas « Fiche bureau —
> propositions », planche `Main.dc.html`, fournie à part). Les contraintes de
> [`briefs/00-CONVENTIONS.md`](briefs/00-CONVENTIONS.md) s'appliquent et priment.
> La fiche mobile ([`FICHE-MOBILE.md`](FICHE-MOBILE.md)) sert de **référence de comportement**,
> pas de terrain de travail : voir § 2.

## 1. Objet

Refondre `fiche.html` en largeur bureau. Aujourd'hui : 11 sections empilées, et tout achat
d'XP passe par un formulaire générique au bas du Journal (« + Dépense XP » → type → cible →
avances → valider). Pour un joueur, le reste de la fiche est grisé.

Objectif : **acheter là où on regarde**. Un clic sur une caractéristique, une compétence, un
talent ou un élément manquant d'une jauge de carrière ouvre son détail et son achat dans un
**inspecteur** en colonne de droite, la fiche restant visible et se mettant à jour à côté.

Public : les joueurs (consultation, achats, suivi en séance) et le MJ (corrections).

## 2. Périmètre — ce qu'il ne faut PAS toucher

**La version mobile est hors périmètre. Aucune modification, même « de passage ».**

Fichiers interdits en écriture (lecture et `import` autorisés, voir § 3) :

- `app/` (dont `app/index.html`) ;
- `js/mobile/` en entier (vues, modèles, `router.js`, `fiche-*.js`) ;
- `css/mobile-app.css`, `css/mobile-fiche.css` ;
- `tools/fiche-mobile-*.test.mjs`, `tools/mobile-*` ;
- `docs/FICHE-MOBILE.md`.

Autres limites :

- **Serveur** : aucune modification de `functions/`. Les commandes existantes (`purchase`,
  `correct`, `gain`, `cancel`, `patch`) suffisent ; si un besoin semble l'exiger, s'arrêter et
  le signaler.
- **Domaine partagé** `js/fiche/*.js`, `js/fiche-schema.js`, `js/catalogue/*` : partagés avec
  le mobile **et** recopiés côté serveur par `tools/sync-fiche-domain.mjs`. Ne pas les modifier.
  Si c'est indispensable : ajout seulement (nouvelle fonction exportée, aucune signature ni
  comportement existant changé), `node tools/sync-fiche-domain.mjs` relancé, et le signaler.
- **Règles Firestore/Storage**, `firebase.json` : inchangés.
- **Données** : `js/data/careers.json`, `skills.json`, `fiche-catalog.json` inchangés.
- **Pas d'achat en lot** (panier) : écarté.
- **Pas d'équipement structuré** : seul un emplacement réservé (§ 5.6).

Contrôle de livraison (doit être vide) :

```bash
git diff --stat master -- app js/mobile css/mobile-app.css css/mobile-fiche.css docs/FICHE-MOBILE.md functions
```

## 3. Architecture

- **Réutiliser, ne pas recalculer.** Les règles existent déjà :
  - `js/fiche/xp.js` (barèmes, `xpBandCost`, `talentXpCost`, `careerRankXpCost`, sorts/miracles),
    `career-model.js`, `skill-names.js`, `basic-skills.js`, `derived.js`,
    `published-catalogue-engine.js`, `commands.js` (`evaluateCareerCompletion`) ;
  - session, synchronisation, brouillons : `fiche-controller.js`, `fiche-client-bridge.js`,
    `fiche-draft-store.js`, `fiche-cloud.js`.
- **Modèles mobiles purs : import autorisé, modification interdite.** `js/mobile/fiche-model.js`,
  `fiche-aptitudes-model.js`, `fiche-career-model.js`, `fiche-purchase.js` sont sans DOM et
  couvrent exactement les besoins du bureau : `skillRows`, `filterSkills`, `sortSkills`,
  `talentRows`, `talentChoices`, `careerProgress`, `purchaseTarget`, `purchasePreview`,
  `purchasePayload`, `purchaseErrorMessage`, `cancelErrorMessage`, `resourceChange`,
  `xpLogRows`… Les importer tels quels. Si l'un ne convient pas, écrire une fonction propre
  au bureau à côté, **ne pas modifier l'original**.
- **Achats** : uniquement via les commandes serveur existantes, avec le même payload que
  le mobile (`purchasePayload`) ou que l'actuel `validateXpPurchase` (`js/fiche.js`) : calcul,
  débit, reprise sans double débit restent côté serveur. Côté client : aperçu seulement.
- **Ancienne fiche conservée** pendant quelques versions (§ 9). L'ancienne page doit continuer
  de fonctionner sans changement de comportement.
- **Étape 0 obligatoire** : avant d'écrire du code, proposer un court plan d'architecture
  (fichiers créés, fichiers modifiés, façon de garder l'ancienne page fonctionnelle) et le
  faire valider. Piste recommandée : nouvelle page `fiche.html` avec ses modules dans
  `js/fiche-bureau/` et ses styles dans `css/fiche-bureau.css` ; l'ancienne page copiée en
  `fiche-ancienne.html`, qui continue de charger `js/fiche.js` et `css/fiche.css` inchangés.
- **Sécurité** : rendu par `textContent` / nœuds DOM, ou `esc()` pour tout HTML construit.
  CSP de `fiche.html` inchangée sauf besoin démontré.

## 4. Mise en page (≥ 1100 px)

Une grille unique, largeur max 1376 px :

```
┌──────────────────────── En-tête (pleine largeur) ────────────────────────┐
├─ Gauche 300 px ─┬────────── Centre (fluide) ──────────┬─ Droite 360 px ──┤
│ Caractéristiques│ Compétences                          │ Inspecteur       │
│ État            │ Talents                              │  ou              │
│ Possessions     │ Sorts et miracles                    │ Carrière en cours│
│                 │ Équipement (réservé)                 │ Derniers mouvem. │
├─────────────────┴──────────────────────────────────────┤ (collante)       │
│ Journal d'expérience (gauche + centre)                 │                  │
└────────────────────────────────────────────────────────┴──────────────────┘
```

- La colonne de droite reste visible au défilement (`position: sticky`, défilement interne
  si plus haute que l'écran).
- Le journal s'étend exactement sous les colonnes gauche et centre : ses bords s'alignent sur
  elles (défaut corrigé de la première maquette).
- **Sous 1100 px** : une seule colonne, dans l'ordre gauche, centre, droite, journal ; la
  colonne de droite n'est plus collante. Aucun défilement horizontal à 320 px.

## 5. Contenu

### 5.1 En-tête

- Portrait (existant), nom, « Race · Carrière — Titre du rang · Rang n · Statut ».
- **Destin** et **Résilience** en titres, avec **Chance** et **Détermination** en points
  (un point par unité, plein = disponible). Clic sur un point = dépenser / récupérer, sans
  confirmation (usage en séance). Destin et Résilience : modification avec confirmation et
  plafonnement de Chance / Détermination, mêmes règles que le mobile (`resourceChange`).
- Pastille **XP libres** (grand) + « Gagnés n · Dépensés n » ; lien vers le journal.
- Menu ⋯ : export JSON, import JSON (MJ seulement, comme aujourd'hui).
- MJ : bouton « Corriger l'identité » (nom, race) ouvrant l'inspecteur (§ 6).

### 5.2 Caractéristiques (colonne gauche)

- Grille 5 × 2 de boutons : abréviation, total ; **dizaines en or** (« 34 » → « 3 » doré).
- Caractéristique de carrière : cadre doré, doublé dans le nom accessible
  (« Capacité de Tir 34, bonus 3, de carrière. Détail »).
- Clic → inspecteur (§ 5.8).

### 5.3 État (colonne gauche)

- Blessures actuelles avec − / + et jauge ; Mouvement, Blessures max, Corruption.
- Mêmes champs et mêmes clés qu'aujourd'hui (`blessures-act`, `corruption`…), patch joueur
  autorisé comme aujourd'hui.

### 5.4 Possessions et notes (colonne gauche)

Texte libre, enregistrement automatique comme aujourd'hui.

### 5.5 Compétences (centre)

- **Liste unique fusionnée** (base et avancées) : groupe « Entraînées · n » puis
  « Non entraînées · n », alphabétique dans chaque groupe, sur **deux colonnes** remplies
  colonne par colonne. Lignes de 36 px.
- Ligne = un seul bouton : point doré (carrière), nom (référentiel publié, jamais le libellé
  brut), abréviation de caractéristique, avances (« +5 » ou « — »), total (doré si
  entraînée), « + » visible au survol et au focus.
- Recherche sans accents ni casse, chaque mot (« resistance alc » trouve « Résistance à
  l'alcool ») ; filtres Toutes / Carrière / Entraînées. Réutiliser `filterSkills`/`sortSkills`.
- Compétences avancées de carrière non acquises : listées en « Non entraînées » (elles
  remplacent les lignes fantômes actuelles).
- « + Apprendre une compétence avancée » : recherche dans les compétences publiées, choix de
  spécialité si groupe, puis inspecteur — même logique que le mobile.

### 5.6 Talents, sorts, équipement (centre)

- **Talents** : « Acquis » (cartes : nom, de carrière / hors carrière, ×prises) puis « À prendre
  dans la carrière » (cartes en pointillés, coût affiché). « + Talent hors carrière » ouvre une
  recherche. Talent « au choix » / « A ou B » : puces de spécialité dans l'inspecteur, comme le
  mobile (`talentChoices`).
- **Sorts et miracles** : remplace les sections optionnelles. Liste des sorts / prières
  possédés (clic = consultation) ; « + Apprendre un sort » / « + Apprendre un miracle » ouvrent
  la recherche dans `fiche-catalog.json` puis l'inspecteur. Les boutons d'activation
  `optVisible` disparaissent ; la section s'affiche toujours, avec « Aucun pour l'instant ».
- **Équipement** : cadre en pointillés, texte « emplacement réservé », aucune donnée.

### 5.7 Colonne droite — Carrière en cours (sans sélection)

- Carrière, titre du rang, rang, statut.
- **Trois jauges** (`careerProgress`) : caractéristiques à 5 × rang, compétences à 5 × rang,
  un talent du rang. Sous chaque jauge, les éléments manquants en **puces cliquables**
  (« Int 3/5 + ») qui ouvrent directement leur achat dans l'inspecteur.
- Bouton « Rang n+1 · Titre — 100/200 XP » → inspecteur de rang.
- **Historique des carrières** : `<details>` replié sous les jauges ; MJ : « + Ancienne carrière ».
- Liens « Toutes les carrières » (visionneuse existante `career-viewer.js`) et « Changer de
  carrière » (même commande et mêmes règles qu'aujourd'hui).
- « Derniers mouvements » : 3 dernières entrées du journal + lien « Journal complet ».

### 5.8 Inspecteur (colonne droite, avec sélection)

Remplace la carte Carrière tant qu'un élément est sélectionné. Équivalent bureau du volet
d'achat mobile (FICHE-MOBILE § 5.5) :

- Nature (« Compétence de base · de carrière »), titre, bouton Fermer (44 px). Échap ferme ;
  le focus revient à l'élément d'origine. Ce n'est **pas** une modale : le reste de la fiche
  reste utilisable ; un autre clic remplace la sélection.
- Calcul en clair : « Sociabilité 41 + 5 avances = 46 ».
- Description (talents, sorts) : référentiel local prioritaire, puis base Sheets, comme aujourd'hui.
- Sélecteur − / + du nombre d'avances (1 à 10) ; aperçu : nouveau total (et bonus pour une
  caractéristique), coût selon `xp.js` (doublé hors carrière), XP restante (rouge si négative).
- **Un seul bouton** « Acheter pour N XP » / « Reprendre pour N XP » (talent déjà acquis), sans
  confirmation. Désactivé avec sa raison : XP insuffisante (« Il manque 80 XP. »), hors
  connexion (« Achat possible une fois en ligne. »), lecture seule.
- Résultat annoncé dans une région `role="status"` en haut de la colonne ; refus serveur :
  message explicite (`purchaseErrorMessage`), valeurs inchangées, bouton « Réessayer ».
- Rang suivant : coût 100 XP si les trois jauges sont pleines, 200 sinon, avec le nombre
  d'éléments manquants.

### 5.9 Journal d'expérience (bas, gauche + centre)

- Résumé « Gagnés · dépensés · libres ». Tableau Libellé / Nature / XP, antéchronologique ;
  montants alignés à droite en chiffres tabulaires.
- MJ : « + Gain d'XP » (commande `gain`) et « Annuler » sur les achats annulables (commande
  `cancel`, comme aujourd'hui). Joueur : aucun de ces contrôles.
- Le formulaire générique « + Dépense XP » disparaît. La « Dépense libre » du MJ reste
  disponible depuis le journal (commande `correct`, `kind: 'xp'`).

## 6. Rôle MJ

- Dans l'inspecteur d'une caractéristique, compétence ou talent : bascule **Acheter / Corriger**.
  « Corriger » : base et avances (caractéristique), avances (compétence), nombre de prises
  (talent ; 0 = retirer). Aucune XP débitée. Passe par le mécanisme de corrections existant
  (lot de corrections, commande `correct`, panneau MJ conservé pour les corrections groupées).
- « Corriger l'identité » : nom et race, réservés au MJ (déjà imposé par le serveur).
- Joueur : aucun contrôle de correction, de gain ou d'annulation visible.
- Lecture seule : tout consultable, aucun bouton d'action actif.

## 7. Apparence

- Thèmes **sombre et parchemin** : variables de `css/base.css` et `css/theme-parchment.css`,
  aucune couleur en dur.
- Polices Cinzel (titres, nombres) et Crimson Text (texte). Texte de base 17 px, en `rem`.
- Cartes : fond `--bg-card`, bordure `--border-gold`, rayon 14 px ; titres de section en
  capitales espacées, couleur or.
- Animations sobres, désactivées par `prefers-reduced-motion`.
- La maquette `Main.dc.html` fait foi pour les proportions ; ses couleurs sont indicatives
  (utiliser les jetons du site).

## 8. Accessibilité

Niveau des briefs L2-09 à L2-11 : vrais boutons et liens, une seule tabulation par ligne de
compétence, libellés explicites, focus visible, contraste ≥ 4,5:1 dans les deux thèmes,
information jamais portée par la seule couleur (carrière = cadre doré **et** texte accessible),
annonces des achats et des erreurs, navigation complète au clavier.

## 9. Livraison

- **Un lot**, version **v2.33.0** : `APP_VERSION` (`js/layout.js`, `sw.js`) et `CHANGELOG.md`
  sur le commit de livraison seulement ; nouveaux fichiers ajoutés au précache de `sw.js`.
- **Ancienne fiche** : accessible par un lien discret « Ancienne fiche » (menu ⋯) pendant
  quelques versions, puis retirée. Le lien « Ancienne fiche » du **mobile** pointe vers
  `fiche.html` et ouvrira donc la nouvelle fiche : c'est voulu, ne pas le modifier.
- Le paramètre `?char=…&return=mobile` et le lien « Retour à l'application mobile » de
  `fiche.html` doivent continuer de fonctionner.

## 10. Critères d'acceptation

1. Le contrôle du § 2 (`git diff --stat` sur les fichiers mobiles et `functions/`) est vide.
2. `npm run check` et `npm run lint` passent ; les tests `tools/fiche-mobile-*.test.mjs` passent
   **sans modification**.
3. En joueur, en ligne : achat d'une avance de caractéristique, de compétence, d'un talent
   (dont un talent « au choix »), d'un sort et d'un rang depuis l'inspecteur ; bon montant
   débité ; entrée au journal ; fiche mise à jour sans rechargement.
4. Un élément manquant d'une jauge ouvre son achat en un clic.
5. Hors connexion : boutons d'achat désactivés avec leur raison.
6. Joueur : aucun contrôle de correction, de gain d'XP ni d'annulation ; MJ : correction,
   gain et annulation fonctionnent.
7. Recherche : « resistance alc » trouve « Résistance à l'alcool ».
8. À 1280 px, la colonne droite reste visible au défilement ; le journal est aligné sur les
   colonnes gauche et centre. À 320 px : une colonne, pas de défilement horizontal.
9. Les deux thèmes passent les contrastes ; navigation complète au clavier et au lecteur d'écran.
10. L'ancienne fiche fonctionne comme avant.
11. Nouveaux tests de comportement (dans de nouveaux fichiers `tools/fiche-bureau-*.test.mjs`)
    pour la logique propre au bureau : sélection et contenu de l'inspecteur, puces manquantes
    des jauges, désactivation hors ligne / XP insuffisante, contrôles masqués selon le rôle.

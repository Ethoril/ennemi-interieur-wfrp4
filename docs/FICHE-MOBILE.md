# Fiche de personnage mobile — cahier des charges

> Rédigé le 5 octobre 2026 à partir des arbitrages du questionnaire et des maquettes
> (canevas « Fiche mobile — propositions »). Les contraintes de
> [`briefs/00-CONVENTIONS.md`](briefs/00-CONVENTIONS.md) s'appliquent et priment.

## 1. Objet

Remplacer l'affichage actuel de la fiche sur téléphone — `fiche.html` resserrée en CSS,
11 écrans de défilement — par un écran conçu pour le mobile, intégré à l'application mobile.

**Usage visé : entre les séances.** La fiche mobile sert à **consulter** le personnage et à
**gérer ses évolutions** (achats d'XP, rangs, carrière). Elle ne sert pas au suivi en séance :
pas de suivi des blessures ni de dépense de points en direct.

**Public : les joueurs**, chacun sur sa fiche. Le MJ garde le bureau pour les corrections.

## 2. Hors périmètre

- **Le bureau.** Aucun changement visible sur `fiche.html` en largeur bureau, à une exception
  près : nom et race verrouillés pour les joueurs (§ 6).
- Suivi en séance : blessures, états, Avantage, lancer de d100.
- Armes et armures. **À anticiper** : chantier futur ; la mise en page de l'écran Principal
  et la structure des onglets doivent pouvoir accueillir une section « Équipement » sans refonte.
- Possessions structurées (encombrement) : elles restent un texte libre.
- Ajout de gains d'XP par le joueur : réservé au MJ (déjà imposé par le serveur, commande `gain`).

## 3. Architecture

- **Emplacement** : une route de l'application mobile, `#/fiches/<id>`, à côté de la route
  `#/fiches` existante (`js/mobile/router.js`). Le sélecteur `fiche-access.js` ouvre cette
  route au lieu de naviguer vers `../fiche.html?char=…&return=mobile`.
- **Coque** : quand la fiche est ouverte, ses quatre onglets **remplacent** la barre basse de
  l'application. Une flèche de retour en haut à gauche ramène à `#/fiches`.
- **Réutilisation, pas de réécriture** : le domaine fiche existe déjà et doit être partagé —
  `js/fiche/commands.js`, `xp.js`, `career-model.js`, `skill-names.js`, `basic-skills.js`,
  `published-catalogue-engine.js`, ainsi que `fiche-controller.js`, `fiche-client-bridge.js`
  et `fiche-draft-store.js` pour la session, la synchronisation et les brouillons. Les vues
  mobiles ne recalculent aucune règle elles-mêmes.
- **Achats** : uniquement par les commandes serveur existantes (calcul, débit, reprise sans
  double débit). Aucun calcul de coût côté client autre que l'aperçu.
- **Styles** : classes `m-` dans un fichier dédié (par exemple `css/mobile-fiche.css`), chargé
  par `app/index.html` seulement. `css/fiche.css` n'est pas modifié.
- **Sécurité** : rendu par `textContent` / nœuds DOM, ou `esc()` pour tout HTML construit.
  CSP de `app/index.html` à compléter si un appel nouveau l'exige (callables fiche).

## 4. Structure et navigation

- **En-tête** (fixe) : nom du personnage ; carrière · titre du rang · rang ; pastille
  « XP libres » qui ouvre le Journal. Menu ⋯ : export JSON, import JSON, « Ancienne fiche ».
- **Onglets en bas** (fixes, 4) : **Principal · Aptitudes · Carrière · Journal**.
  Libellés texte + icône, cible tactile ≥ 44 px, `aria-current="page"` sur l'onglet actif.
- L'onglet ouvert par défaut est **Principal**. L'onglet courant est reflété dans l'URL
  (`#/fiches/<id>/aptitudes`…) pour que le retour arrière et le rechargement fonctionnent.
- **Volets** (feuilles basses) : détail et achat d'un élément. Vraie boîte de dialogue :
  focus piégé, Échap et glisser vers le bas ferment, le focus revient à l'élément d'origine.

## 5. Écrans

### 5.1 Principal

Consultation, sans saisie.

- **Destin et Chance**, **Résilience et Détermination** : jetons pleins ou vides **en lecture
  seule** ; leur modification reste sur le bureau.
- **Caractéristiques** : grille 5 × 2 ; chaque case montre l'abréviation, le total et le
  bonus. Les caractéristiques de la carrière actuelle ont un cadre doré, doublé d'un libellé
  pour les lecteurs d'écran. Toucher une case ouvre son **volet** (§ 5.5).
- **Stats dérivées** : une ligne discrète sous la grille, « Mouvement 4 · Blessures max 11 ·
  Corruption 0 », pour vérifier l'effet d'un achat (Endurance, talent).
- **Compétences** : les plus hautes, automatiquement (4 à 5 lignes : nom, caractéristique,
  total), avec un lien « Toutes » vers Aptitudes.

### 5.2 Aptitudes

- Bascule **Compétences · Talents · Sorts** ; « Sorts » (sorts et miracles) n'apparaît que si
  le personnage en possède.
- **Compétences** : liste dense (lignes de 50 px). Ordre : entraînées d'abord, puis les
  autres ; alphabétique dans chaque groupe. Chaque ligne : nom, caractéristique et avances,
  total ; un point doré signale une compétence de carrière.
- **Outils** : champ de recherche (insensible aux accents et à la casse) ; filtres
  « Carrière », « Entraînées » et par caractéristique, combinables.
- **Noms affichés** : ceux du référentiel publié (nom principal, variantes liées masquées,
  v2.30–2.31), via le même résolveur que le bureau (`published-catalogue-engine.js`), jamais
  le libellé brut enregistré dans la fiche.
- **Spécialités** : une ligne par spécialité ; « Ajouter une spécialité » dans le volet de la
  compétence parente.
- **Talents** : acquis (avec le nombre de prises) puis disponibles dans la carrière, avec leur
  coût. Toucher un talent ouvre son volet : description (référentiel local prioritaire, puis
  base Sheets, comme aujourd'hui), rang, achat.

### 5.3 Carrière

- Carte du rang actuel : carrière, titre, statut, rang.
- **Trois jauges** : caractéristiques à 5 × rang, huit compétences à 5 × rang, un talent du
  rang ; chacune avec la liste de ce qui manque.
- Bouton d'achat du rang suivant, avec son coût (100 XP rang achevé, 200 XP sinon).
- Aperçu replié du rang suivant.
- **Changement de carrière** : possible depuis le téléphone, avec les mêmes règles et la même
  commande que sur le bureau.
- Lien « Toutes les carrières » vers la visionneuse existante, en plein écran.
- Historique des carrières.

### 5.4 Journal

- Bascule **Expérience · Possessions et notes**.
- Expérience : gagnée, dépensée, libre ; historique antéchronologique (libellé, nature, montant).
  Pas de bouton d'ajout de gain pour un joueur.
- Possessions et notes : texte libre, enregistré comme aujourd'hui.

### 5.5 Volet d'achat (caractéristique, compétence, talent)

- Titre, nature (de base, avancée, de carrière), total.
- Calcul en clair : « Sociabilité 41 + 5 avances = 46 ».
- Sélecteur du nombre d'avances (− / +) ; aperçu du nouveau total, du coût selon le barème
  officiel (`xp.js`, tarif doublé hors carrière) et de l'XP restante.
- **Un seul bouton** « Acheter pour N XP », sans étape de confirmation. Désactivé si l'XP
  libre ne suffit pas, avec la raison.
- **Hors connexion** : achat désactivé, raison affichée (« Achat possible une fois en ligne »).
- Résultat annoncé (`role="status"`) ; en cas de refus serveur, message explicite et valeurs
  inchangées.

## 6. Édition

- **Valeurs de base réservées au MJ, partout.** La base des caractéristiques l'est déjà
  (commande `correct`). **Nom et race** le deviennent :
  - serveur : dans `validatePatchPayload` (`functions/src/fiche/service.mjs`), un `patch` qui
    touche `nom` ou `race` est refusé (`permission-denied`) si le rôle n'est pas `mj` ;
  - bureau : `setFicheRole` (`js/fiche.js`) désactive les champs `#nom` et `#race` pour un
    joueur. **Seule exception admise** à la règle « aucun changement visible sur le bureau » ;
  - mobile : aucun contrôle d'édition de ces valeurs pour un joueur ;
  - tests : refus serveur pour un joueur, acceptation pour le MJ.
- **Export et import JSON** : dans le menu ⋯.

## 7. Apparence

- Thèmes **sombre et parchemin**, avec les variables de `css/base.css` et
  `css/theme-parchment.css` ; aucune couleur en dur.
- Densité **confortable** : lignes de 50 px, texte de base 17 px, en `rem`.
- Animations **sobres** : volets qui glissent, transition d'onglet ; désactivées avec
  `prefers-reduced-motion`.
- Tablette et paysage : **une colonne centrée** (`--m-content-width`).
- Polices Cinzel et Crimson Text auto-hébergées, comme le reste de l'application mobile.

## 8. Accessibilité

Au niveau des briefs L2-09 à L2-11 et L4 : vrais boutons et liens, libellés explicites,
focus visible, contraste ≥ 4,5:1 dans les deux thèmes, cibles ≥ 44 px, information jamais
portée par la seule couleur (cadre doré doublé d'un texte), annonces des achats et des erreurs.

## 9. Livraison

- **Un seul lot livré** (une version), développé en briefs successifs.
- **Transition** : « Ancienne fiche » reste accessible depuis le menu ⋯ pendant quelques
  versions, puis le lien est retiré.
- Discipline de version habituelle : `APP_VERSION` (`js/layout.js`, `sw.js`) et `CHANGELOG.md`
  sur le commit de livraison ; nouveaux fichiers ajoutés au précache du service worker.

## 10. Critères d'acceptation

1. À 390 px, l'écran Principal tient sans défilement pour un personnage sans sorts.
2. Aucune modification visible de `fiche.html` à 1280 px et plus (comparaison avant/après),
   hormis nom et race désactivés en session joueur.
3. Un achat d'avance de compétence, de caractéristique, de talent et de rang réussit en ligne,
   débite le bon montant et apparaît au Journal ; hors ligne, les boutons d'achat sont
   désactivés avec leur raison.
4. Un joueur ne voit aucun contrôle de gain d'XP ni de modification des valeurs de base ; un
   `patch` joueur sur `nom` ou `race` est refusé par le serveur, celui du MJ accepté.
5. Recherche et filtres retrouvent « Résistance à l'alcool » en tapant « resistance alc ».
6. Les deux thèmes passent les contrastes ; navigation complète au clavier et au lecteur d'écran.
7. Retour arrière, rechargement et lien profond `#/fiches/<id>/carriere` ouvrent le bon onglet.
8. `npm run check` et `npm run lint` passent, avec des tests de comportement pour le tri, les
   filtres, l'aperçu de coût et le choix des compétences affichées sur Principal.

## 11. Points ouverts

- ~~O1 — Chance et Détermination~~ : tranché, lecture seule (§ 5.1).
- ~~O2 — Stats dérivées~~ : tranché, ligne discrète sous la grille (§ 5.1).
- ~~O3 — Valeurs de base réservées au MJ~~ : tranché, verrouillage serveur partout (§ 6).

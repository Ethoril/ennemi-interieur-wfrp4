# Rapport d’exécution — Alignement V5 des Armes, Armures & Espèces

- **Branche** : `gemini/armes-v5` (locale uniquement, aucun `git push`, aucun déploiement Firebase, aucune écriture sur Google Sheets ou Firestore).
- **Brief source** : `docs/briefs/BRIEF_ARMES_ARMURES_V5_ET_ESPECES.md`
- **Référence officielle V5** : `L06 — Warhammer V4,5 - Livre de Base (VF, Khaos Project)` pp. 298–308 & p. 341 (`RAPPORT_CATALOGUE_ARMES_L06.md`).

---

## 1. Synthèse des travaux réalisés

### A. Préparation du Google Sheet V5 (`docs/briefs/CHANGEMENTS_FEUILLE_ARMES_V5.md` & `docs/briefs/csv-armes-v5/`)
Les 4 onglets concernés du Google Sheet (`1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs`) ont été intégralement préparés sous forme de fichiers CSV prêts à importer dans `docs/briefs/csv-armes-v5/` et documentés cellule par cellule dans `docs/briefs/CHANGEMENTS_FEUILLE_ARMES_V5.md` :

1. **`Mots Clés Armes et Armures.csv`** (`21` cellules modifiées, `2` lignes ajoutées) :
   - **Ajouts V5** :
     - **`Bouclier`** (`id: bouclier`, Nom EN : `Shield`, Type : `Qualité d'armure`) : annule le malus de `-20` pour défendre contre une attaque à distance, permet d'opposer les attaques à distance à portée Moyenne/Longue/Extrême, et ignore `1 PA` sur le bras porteur si tenu en main.
     - **`Inflige X`** (`id: inflige`, Nom EN : `Inflicts X`, Type : `Qualité d'arme`) : permet de renoncer aux dégâts en dépensant `2 Avantages` pour infliger l'état `X`.
   - **Bascules V5** :
     - **`Explosion X`** : basculée sur l'effet V5 (cible principale + `X` cibles supplémentaires à moins de `X × 2` mètres).
     - **`Recharge X`** : basculée sur l'effet V5 (`X` Actions pour recharger ; test Étendu de *Projectile (Groupe)* à `+20` demandant `X` DR seulement sous la menace ennemie).
   - **7 mots-clés V4 marqués en `Remarque`** (`Épuisante`, `Immobilisante`, `Lente`, `Percutante`, `Perturbante`, `Précise`, `Protectrice X`) : conservés dans l'onglet pour la compatibilité des objets historiques déjà équipés sur les fiches, mais retirés de tous les objets du catalogue. Le `Nom EN` de `Protectrice X` a été passé à `Shield (V4)` (et `Anciens noms` vidé) afin que `"Shield"` et `"Bouclier"` résolvent exclusivement vers la nouvelle qualité V5 `bouclier`.

2. **`Armes Corps à Corps.csv`** (`50` cellules modifiées, `7` lignes supprimées, `2` lignes ajoutées) :
   - **70 objets du Livre de base** alignés champ par champ sur `L06` pp. 300–307 (`Coup-de-poing`, `Garrot (2M)`, `Fléau`, `Fléau d’armes (2M)`, `Bâton de combat (2M)`, `Hallebarde (2M)`, `Lance (2M)`, `Pioche (2M)`, `Marteau de guerre (2M)`).
   - **Suppression du groupe `Parade`** :
     - `Main gauche` et `Brise-épée` déplacés dans **`Escrime`** avec ajout de la qualité `Parade`.
     - `Targe (Buckler)` ajoutée dans **`Escrime`** pour son usage offensif/parade (`BF +1`, `Inoffensive, Parade`, L06 p. 300).
     - `Filet` (`Défensive, Inflige (Empêtré 50)`), `Cape` (`Défensive, Inflige (Empêtré 25), Inoffensive`) et `Filet Druchii` déplacés dans **`Base`**.
     - Les `7` lignes de boucliers (`Targe (Buckler)`, `Bouclier`, `Bouclier standard`, `Grand Bouclier`, `Pavois`, `Pavois (Pavise)`, `Bouclier Haut Elfe`) sont retirées de *Armes Corps à Corps* et transférées dans *Armures* (`Catégorie = Bouclier`).
   - **Ajout de `Fouet`** dans le groupe **`Fléau`** (`Très longue`, `BF +2`, `À enroulement, Déséquilibrée, Inoffensive`, L06 p. 300).
   - **Conversions des armes de suppléments** vers la nomenclature V5 (voir § 2 ci-dessous).

3. **`Armes à Distance.csv`** (`55` cellules modifiées, `3` lignes supprimées, `1` ligne ajoutée) :
   - **Alignement L06 p. 301** des armes à distance du Livre de base (`Tromblon (2M)`, `Arquebuse (2M)`, `Pistolet`, `Arc (2M)`, `Arc long (2M)`, `Arc court (2M)`, `Arbalète de poing`, `Arbalète (2M)`, `Arbalète lourde (2M)`, `Long fusil d’Hochland (2M)`, `Arquebuse à répétition (2M)`, `Pistolet à répétition`, `Lasso (2M)`, `Bolas`, `Bombe`, `Bombe incendiaire`, `Fronde`, `Fustibale (2M)`, `Rocher`, `Couteau de lancer`).
   - **Déplacements de groupes** :
     - `Long fusil d’Hochland (2M)` déplacé de `Poudre Noire` vers **`Ingénierie`**.
     - `Bolas` déplacé de `Lancer` vers **`Entraves`** (`Inflige (Empêtré 35), Inflige (À terre), Inoffensive`).
     - `Filet` ajouté dans **`Entraves`** (`Portée BF`, `Inflige (Empêtré 50)`).
     - `Fouet` retiré (déplacé dans *Armes Corps à Corps* → `Fléau`).
   - **Suppression des doublons** :
     - `Mousquet (2M)` (ligne 52, *Up in Arms*, doublon de la ligne 19) supprimé.
     - `Pistolet` (ligne 53, *Core Rulebook*, doublon de la ligne 5) supprimé.

4. **`Armures.csv`** (`20` cellules modifiées, `5` lignes ajoutées) :
   - **Alignement L06 p. 306** des pénalités d'armure (`Calotte de cuir` + `Partielle` ; `Chausses de mailles`, `Cotte de mailles`, `Coiffe de mailles`, `Plastron`, `Heaume`, `Jambières d’acier`, `Heaume ouvert`, plus les armures de suppléments en Gromril, Ithilmar, Écailles de Dragon et À vapeur).
   - **Ajout de la catégorie `Bouclier` (5 lignes)** :
     - `Targe (Buckler)` (`PA 1`, `Bouclier`),
     - `Bouclier` (`PA 2`, `Bouclier` — fusion de `Bouclier` et `Bouclier standard`),
     - `Grand Bouclier` (`PA 3`, `Bouclier`),
     - `Pavois (Pavise)` (`PA 3`, `Bouclier`, pénalité `Encombrante` — fusion de `Pavois` et `Pavois (Pavise)`),
     - `Bouclier Haut Elfe` (`PA 2`, `Bouclier, Raffiné 1, Solide 1`).

---

### B. Mise à jour du générateur et du catalogue (`tools/refresh-equipment-catalog.mjs` & `js/data/equipment-catalog.json`)
- **`parseKeywords(text)`** dans `tools/refresh-equipment-catalog.mjs` :
  - Conserve les accents et la casse des paramètres entre parenthèses (ex. `Inflige (Empêtré 50)` → `{ id: "inflige", parameter: "Empêtré 50" }`).
  - Fusionne proprement les occurrences multiples d'un même mot-clé paramétré sur un même objet (ex. `Inflige (Empêtré 35), Inflige (À terre)` sur `Bolas` → `{ id: "inflige", parameter: "Empêtré 35, À terre" }`).
  - Accepte les paramètres numériques signés (ex. `Explosion +1` sur `Grenaille et poudre (12)` → `{ id: "explosion", parameter: "+1" }`).
- **Traitement des boucliers dans `Armures.csv` (`Catégorie = Bouclier`)** :
  - Lit les PA directement depuis `Valeur d'Armure (PA)`, conserve `kind: 'shield'`, `layer: 'none'`, couvre les 6 localisations, et attribue le profil offensif V5 (`damage: 'BF + 1'`, `reach: 'Personnelle'`, Arme improvisée selon L06 p. 306) aux boucliers tenus en main (`Pavois (Pavise)` conserve `damage: ''`, `reach: ''`).
- **Munitions standard (`standardAmmunition`) alignées sur L06 p. 302** :
  - `Flèches elfiques (12)` : Portée `Comme l’arc + 10`, Dégâts `+0`, Qualités `Empaleuse`.
  - `Balles et poudre (12)` : Dégâts `+0`, Qualités `Empaleuse, Perforante`.
  - `Grenaille et poudre (12)` : Dégâts `+0`, Qualités `Explosion +1`.
  - `Munitions improvisées et poudre` : Dégâts `-1`, aucune qualité/défaut.
- **Catalogue régénéré** : `211` équipements (`items`), `57` mots-clés (`keywords`), synchronisé avec `functions/src/data/equipment-catalog.json`.
- **Interface fiche (`js/equipment/view.js`)** :
  - Le bouton `+ Ajouter` de la section **Armures** permet désormais de rechercher et d'ajouter aussi bien les armures que les boucliers (`['armour', 'shield'].includes(item.kind)`), tout en les conservant également accessibles depuis la section **Armes et boucliers**.

---

## 2. Conversions de suppléments marquées « à arbitrer » et doublons Nains signalés

### A. Conversions des armes de suppléments vers V5 (marquées « à arbitrer »)

| Onglet | Objet (Supplément) | Ancienne valeur (V4) | Nouvelle valeur proposée (V5) | Justification |
|---|---|---|---|---|
| Armes CàC | `Épée Bâtarde` (*Up in Arms*) | `Défensive, Percutante` | `Défensive, Dévastatrice` | Aligné sur l'Épée bâtarde (2M) L06 (`Percutante` → `Dévastatrice`) |
| Armes CàC | `Grande Hache de Chrace (2M)` (*High Elf PG*) | `Hachoir, Percutante, Encombrante` | `Taille, Dévastatrice, Déséquilibrée` | Aligné sur la Grande hache (2M) L06 |
| Armes CàC | `Hallebarde de Garde Phénix (2M)` (*High Elf PG*) | `Défensive, Empaleuse, Hachoir, Percutante, Magique` | `Défensive, Empaleuse, Taille, Dévastatrice, Magique` | `Percutante` → `Dévastatrice` |
| Armes CàC | `Marteau Piqueur à Vapeur (2M)` (*Dwarf PG*) | `Percutante, Lente, Dévastatrice` | `Assommante, Déséquilibrée, Dévastatrice` | Aligné sur le Marteau de guerre (2M) L06 (`Lente` → `Déséquilibrée`, `Percutante` → `Assommante`) |
| Armes CàC | `Marteau Piqueur à Vapeur (2M)` (*Archives I*) | `Assommante, Lente, Dévastatrice` | `Assommante, Déséquilibrée, Dévastatrice` | `Lente` → `Déséquilibrée` |
| Armes CàC | `Pique (2M)` (*Up in Arms*) | `Empaleuse, Percutante (en charge)` | `Empaleuse, Dévastatrice` | `Percutante` → `Dévastatrice` |
| Armes CàC | `Hache-Pic (2M)` (*Dwarf PG*) | `(aucune qualité)` | `Déséquilibrée, Dévastatrice, Taille, Perforante` | Combinaison Grande hache + Pioche L06 |
| Armes CàC | `Lance de Chasse` (*Archives III*) | `Empaleuse, Défensive, Percutante` | `Empaleuse, Défensive, Dévastatrice` | `Percutante` → `Dévastatrice` |
| Armes CàC | `Coup-de-poing (Knuckledusters)` (*Up in Arms*) | `Inoffensive` | `(aucune)` | Aligné sur `Coup-de-poing` L06 p. 300 |
| Armes CàC | `Fléau Lourd (2M)` (*Up in Arms*) | `Perturbante, Percutante, Épuisante, Enroulement` | `À enroulement, Assommante, Déséquilibrée, Dévastatrice` | Aligné sur `Fléau d’armes (2M)` L06 p. 300 |
| Armes CàC | `Fouet de Guerre` / `Fouet d'Agonie` (*Archives II* / *Sea of Claws*) | `Enroulement, Immobilisante, Rapide / Peur` | `À enroulement, Déséquilibrée, Inflige (Empêtré votre Force), Rapide / Peur` | `Immobilisante` → `Inflige (Empêtré votre Force)` + `Déséquilibrée` |
| Armes CàC | `Brise-Épée Nain` (*Dwarf PG*) | Groupe `Parade`, `Défensive, Piège-lame, Solide` | Groupe `Escrime`, `Défensive, Parade, Piège-lame, Solide 1` | Suppression du groupe `Parade` → `Escrime` + `Parade` |
| Armes CàC | `Filet Druchii` (*Salzenmund*) | Groupe `Parade`, `Immobilisante, Empaleuse` | Groupe `Base`, `Défensive, Inflige (Empêtré 50), Empaleuse` | Suppression du groupe `Parade` → `Base` + `Inflige (Empêtré 50)` |
| Armes CàC | `Attrape-Homme (2M)` (*Up in Arms*) | `Immobilisante, Assommante` | `Inflige (Empêtré votre Force), Assommante` | `Immobilisante` → `Inflige (Empêtré votre Force)` |
| Armes Distance | `Mousquet (2M)` (*Up in Arms*) | `Poudre noire, Dangereuse, Percutante, Précise, Recharge 3` | `À poudre noire, Dévastatrice, Pointue, Recharge 3` | Aligné sur l'Arquebuse V5 + `Pointue` (`Précise` → `Pointue`) |
| Armes Distance | `Pistolet de Duel` (*Up in Arms*) | `Poudre noire, Dangereuse, Percutante, Pistolet, Précise, Recharge 2` | `À poudre noire, Dévastatrice, Pistolet, Pointue, Recharge 2` | Aligné sur le Pistolet V5 + `Pointue` |
| Armes Distance | `Baliste de Poing` (*Sea of Claws*) | `Percutante, Empaleuse, Recharge 2` | `Dévastatrice, Empaleuse, Recharge 2` | `Percutante` → `Dévastatrice` |
| Armes Distance | `Arbalète à Répétition Druchii (2M)` / `Arbalète à Répétition` (*Salzenmund* / *High Elf PG*) | `Recharge 3` | `Recharge 4` | Aligné sur le barème V5 des armes à répétition |
| Armes Distance | `Canon Orgue Portatif (2M)` / `Lance-Flammes Nain (2M)` / `Tromblon Grudge-Raker (2M)` | `Recharge 5 / 6 / 3` | `Recharge 6 / 6 / 4` | Barème V5 + `Inflige (Enflammé)` sur le Lance-Flammes |
| Armes Distance | `Bolas Lourds` (*Middenheim*) | Groupe `Lancer`, `Immobilisante, Assommante` | Groupe `Entraves`, `Inflige (Empêtré 45), Inflige (À terre), Assommante` | Aligné sur `Bolas` L06 p. 301 |
| Armes Distance | `Filet Barbelé` (*Corsairs*) | `Immobilisante, Déchirante` | `Inflige (Empêtré 50), Déchirante` | Aligné sur `Filet` L06 p. 301 |
| Armes Distance | `Bombe Incendiaire Naine` / `Bombe Cinderblast` / `Flasque de Feu` | `Explosion X` | `+ Inflige (Enflammé)` | Aligné sur `Bombe incendiaire` L06 p. 301 |
| Armes Distance | `Lance-Rochers (2M)` (*Up in Arms*) | `Assommante, Percutante` | `Assommante, Dévastatrice` | `Percutante` → `Dévastatrice` |
| Armes Distance | `Javeline Lourde` (*Archives III*) | `Empaleuse, Percutante` | `Empaleuse, Dévastatrice` | `Percutante` → `Dévastatrice` |

### B. Signalement des 4 paires de quasi-doublons Nains (*Archives I* vs *Dwarf Player's Guide*)
Conformément à la Décision 7, ces 4 paires ont été **conservées telles quelles** dans le catalogue mais sont signalées pour arbitrage éventuel du MJ :
1. **`Hache de lancer naine`** (*Archives of the Empire Vol. I*, Lancer) vs **`Hache de Lancer Naine`** (*Dwarf Player's Guide*, Lancer).
2. **`Marteau Piqueur à Vapeur (2M)`** (*Dwarf Player's Guide*, Deux-Mains) vs **`Marteau Piqueur à Vapeur (2M)`** (*Archives of the Empire Vol. I*, Deux-Mains).
3. **`Harpon à Ressort (2M)`** (*Dwarf Player's Guide*, Ingénierie) vs **`Harpon à Ressort (2M)`** (*Archives of the Empire Vol. I*, Ingénierie).
4. **`Bombarde à Vapeur (2M)`** (*Dwarf Player's Guide*, Ingénierie) vs **`Bombarde à Vapeur (2M)`** (*Archives of the Empire Vol. I*, Ingénierie).

---

## 3. PJ concernés par `Corps à corps (Parade)` / `(Bouclier)` (Décision 2)

L'inspection des sauvegardes de fiches PJ (`tmp/firestore-fiches-backup-20260416-232056.json`) montre qu'**un seul PJ** possède des avances dans cette spécialité :

- **Elysia Valtieri (`elysia`)** (*Prêtre de Myrmidia*, Rang 4, Humaine) :
  - Compétence avancée enregistrée : `{ id: "mig_dc505ed27cdc6335b7d2e8b403bb57f9", nom: "Corps à corps (Bouclier)", carac: "cc", adv: 5 }` (résolue dans `referentiel-public.json` vers `Corps à corps (Parade)` via l'alias `Corps à corps (Bouclier)`).
  - Équipement / Possessions : possède une `"Targe"`, une `"Armure de Mailles (2 PA)"`, une `"Lance de Myrmidia"` et une `"Épée Longue Magique"`.
  - **Aucune migration automatique n'a été appliquée** conformément au brief : le MJ pourra choisir de reclasser ses `+5` avances vers `Corps à corps (Escrime)` (pour sa Targe utilisée en parade) ou `Corps à corps (Base)` (pour le maniement de bouclier/arme à une main en V5).

---

## 4. Alignement des Espèces (Point 9 du brief)

Les fichiers `js/fiche/derived.js`, `js/fiche.js`, `js/fiche-bureau/app.js`, `js/mobile/views/fiche-principal.js`, `fiche-ancienne.html`, `tools/fixtures/fiche-qa.html`, `js/catalogue/talent-source.js` et `js/mobile/fiche-aptitudes-model.js` ont été alignés :

| Espèce (`data.race`) | Libellé | Mouvement | Formule Blessures max (`+ Dur à cuire × BE`) |
|---|---|---:|---|
| `humain` (ou vide) | Humain | `4` | `BF + (2 × BE) + BFM` |
| `nain` | Nain | `3` | `BF + (2 × BE) + BFM` |
| `halfelin` / `halfling` | Halfelin | `3` *(corrigé de 4)* | `BF + (2 × BE) + BFM` *(corrigé : inclut BF selon L06 p. 341)* |
| `gnome` | Gnome | `3` | `(2 × BE) + BFM` *(Petite : sans BF)* |
| `haut-elfe` | Haut Elfe | `5` | `BF + (2 × BE) + BFM` |
| `elfe-sylvain` | Elfe Sylvain | `5` | `BF + (2 × BE) + BFM` |
| `elfe-noir` | Elfe Noir | `5` | `BF + (2 × BE) + BFM` |
| `elfe-des-mers` | Elfe des Mers | `5` | `BF + (2 × BE) + BFM` |
| `elfe` *(rétrocompat)* | Elfe | `5` | `BF + (2 × BE) + BFM` |
| `ogre` | Ogre | `6` | `(BF + (2 × BE) + BFM + Dur à cuire × BE) × 2` *(Grande : ×2)* |
| `skink` | Skink | `6` | `(2 × BE) + BFM` *(Petite : sans BF)* |
| Valeur non reconnue | — | `null` → affiche `'Espèce inconnue'` | `BF + (2 × BE) + BFM` |

---

## 5. Tests modifiés et vérifications exécutées

Conformément à la contrainte sur les tests existants, seuls les 3 fichiers de tests qui pinnaient les anciennes valeurs V4 ou l'ancien calcul Halfelin ont été mis à jour :

1. **`tools/fiche-equipment.test.mjs`** :
   - Nombre d'objets du catalogue : `213` → `211` (suppression des doublons `Mousquet (2M)` et `Pistolet`, fusion des doublons `Bouclier standard` et `Pavois`, déplacement de `Fouet` de Distance vers CàC, ajout de `Targe (Buckler)` en `Escrime` et de `Filet` en `Entraves`).
   - Nombre de mots-clés : `55` → `57` (ajout de `bouclier` et `inflige`).
   - `Targe (Buckler)` : test explicite des deux entrées (`get('Targe (Buckler)', 'Bouclier')` avec `ap: 1`, `damage: 'BF + 1'` et `get('Targe (Buckler)', 'Escrime')` avec `damage: 'BF +1'`).
   - `Flèches elfiques (12)` : mots-clés `['precise', 'empaleuse', 'perforante']` → `['empaleuse']` (L06 p. 302).
2. **`tools/fiche-equipment-browser.mjs`** :
   - Lors de l'ajout d'un `Bouclier` en mode MJ, modification directe du champ `[name="ap"]` au lieu du spinbutton `Paramètre de Protectrice X` (puisque les boucliers V5 portent la qualité `Bouclier` sans paramètre et non plus `Protectrice X`).
3. **`tools/fiche-mobile-derived.test.mjs`** :
   - Blessures max du Halfelin (`halfelin` / `halfling`) : `12` (`18` avec `Dur à cuire` ×2) au lieu de `9` (`15`), et ajout des tests pour `gnome` (`9` / `15`), `skink` (`9`) et `ogre` (`24` / `36`).
   - Mouvement : `halfling` / `halfelin` / `gnome` à `3`, `elfe-noir` / `elfe-des-mers` à `5`, `skink` à `6`, et `mouvement({ race: 'inconnue' }) === null`.

---

## 6. Suites à donner côté `Outil MJ Warhammer`

1. **Google Sheet (`1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs`)** :
   - Importer les 4 CSV de `docs/briefs/csv-armes-v5/` dans leurs onglets respectifs (*Mots Clés Armes et Armures*, *Armes Corps à Corps*, *Armes à Distance*, *Armures*), puis relancer `node tools/refresh-equipment-catalog.mjs` sans `--source-dir` pour vérifier que le hash en ligne coïncide.
2. **Compétences du Google Sheet** :
   - Retirer ou marquer obsolète la spécialité `Corps à corps (Parade)` dans l'onglet des compétences si souhaité, après avoir arbitré le reclassement des `+5` avances d'**Elysia Valtieri**.
3. **Dépôt `Outil MJ Warhammer`** :
   - Aligner si nécessaire les tables locales du générateur PNJ / calcul de blessures d'`Outil MJ Warhammer` sur les mêmes formules d'espèces et sur les nouveaux profils d'armes V5.

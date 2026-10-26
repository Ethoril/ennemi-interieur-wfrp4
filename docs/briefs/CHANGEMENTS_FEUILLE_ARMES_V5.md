# Changements à appliquer dans la feuille Google « Aides de jeu » (Passage en V5 — 26/10/2026)

Ce document détaille, **onglet par onglet** et **cellule par cellule**, l'ensemble des modifications à reporter dans le Google Sheet `1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs` conformément aux décisions du MJ du 26/10/2026 (`docs/briefs/BRIEF_ARMES_ARMURES_V5_ET_ESPECES.md`).

Des fichiers CSV prêts à coller (encodage UTF-8, fins de ligne LF, colonnes Prix / Disponibilité intactes) sont fournis dans `docs/briefs/csv-armes-v5/` :
- `docs/briefs/csv-armes-v5/Mots Clés Armes et Armures.csv`
- `docs/briefs/csv-armes-v5/Armes Corps à Corps.csv`
- `docs/briefs/csv-armes-v5/Armes à Distance.csv`
- `docs/briefs/csv-armes-v5/Armures.csv`

---

## 1. Onglet *Mots Clés Armes et Armures*

### 1.1. Cellules modifiées (21 cellules)

> Note : `Parade` (`id: parade`, ligne 32) figure déjà dans l'onglet en version V5 (*Atout d'arme*, L06 p.304). `Explosion X` et `Recharge X` passent de la version V4 à la version V5. Les 7 mots-clés V4 devenus sans usage dans le livre de base V5 (`Épuisante`, `Immobilisante`, `Lente`, `Percutante`, `Perturbante`, `Précise`, `Protectrice X`) sont conservés pour rétrocompatibilité (exemplaires existants) et signalés dans la colonne `Remarque`.

| Ligne feuille | Mot-clé | Colonne | Valeur actuelle | Valeur V5 | Référence |
|---:|---|---|---|---|---|
| 17 | **Épuisante** | `Remarque` | Ne confère pas d'état Exténué. | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5. Ne confère pas d'état Exténué. | Décision 7 (mot-clé V4 sans usage dans L06) |
| 19 | **Explosion X** | `Effet` | Chaque personnage à X mètres ou moins du point touché subit DR + Dégâts de l'arme et les états qu'elle inflige. | Cible tous les personnages dans un diamètre de X yards ; ne peut normalement pas être opposé. Inflige les Dégâts de l'arme (sans le DR, mais Dévastatrice peut utiliser le dé des unités) et les états de l'arme. | L06 p.304 (Blast) |
| 19 | **Explosion X** | `Paramètre` | X = rayon en mètres | X = diamètre en yards | L06 p.304 (Blast) |
| 19 | **Explosion X** | `Version retenue` | V4 | V5 | L06 p.304 (Blast) |
| 19 | **Explosion X** | `Source` | Livre de base FR (V4) p.298 | Livre de base V5 EN p.304 | L06 p.304 (Blast) |
| 19 | **Explosion X** | `Autre édition` | V5 (p.304) : diamètre de X yards, sans ajout du DR. | V4 (p.298) : rayon de X mètres, avec ajout du DR. | L06 p.304 (Blast) |
| 19 | **Explosion X** | `Remarque` | Version V4 retenue : les valeurs des profils sont à l'échelle V4 (voir Points à trancher). | Certaines munitions écrivent « Explosion +X » : modification ou ajout de la valeur d'Explosion. | L06 p.304 (Blast) |
| 21 | **Immobilisante** | `Remarque` | Cape et Filet ont une Force fixe (25 et 55, Up in Arms pp.95-96). | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5 (remplacé par Inflige X). | Décision 7 (mot-clé V4 sans usage dans L06) |
| 28 | **Lente** | `Remarque` | Annule Rapide (V4). | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5. | Décision 7 (mot-clé V4 sans usage dans L06) |
| 34 | **Percutante** | `Remarque` | *(vide)* | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5 (remplacé selon l'arme par Dévastatrice). | Décision 7 (mot-clé V4 sans usage dans L06) |
| 36 | **Perturbante** | `Remarque` | Distinct de À Enroulement. | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5. Distinct de À Enroulement. | Décision 7 (mot-clé V4 sans usage dans L06) |
| 43 | **Précise** | `Remarque` | À ne pas confondre avec Pointue (+1 DR). Baliste navale : profil source non retrouvé, identité à confirmer. | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5. À ne pas confondre avec Pointue (+1 DR). | Décision 7 (mot-clé V4 sans usage dans L06) |
| 44 | **Protectrice X** | `Nom EN` | Shield | Shield (V4) | Décision 7 (mot-clé V4 sans usage dans L06) |
| 44 | **Protectrice X** | `Anciens noms` | Bouclier X |  | Décision 7 (mot-clé V4 sans usage dans L06) |
| 44 | **Protectrice X** | `Remarque` | Version V4 retenue (voir Points à trancher). | Conservé pour rétrocompatibilité (exemplaires existants) ; sans usage dans le livre de base V5 (remplacé par l'atout d'armure Bouclier et les PA de la colonne Valeur d'Armure). | Décision 7 (mot-clé V4 sans usage dans L06) |
| 47 | **Recharge X** | `Effet` | Recharger demande un Test étendu de Projectiles (groupe de l'arme) totalisant X DR ; une interruption remet la progression à zéro. | Une fois l'arme utilisée, il faut dépenser X Actions avant de pouvoir s'en resservir. Une arme À répétition ayant encore des tirs non utilisés demande 1 Action de moins. | L06 p.305 (Reload) |
| 47 | **Recharge X** | `Paramètre` | X = DR à cumuler | X = nombre d'Actions | L06 p.305 (Reload) |
| 47 | **Recharge X** | `Version retenue` | V4 | V5 | L06 p.305 (Reload) |
| 47 | **Recharge X** | `Source` | Livre de base FR (V4) p.299 | Livre de base V5 EN p.305 | L06 p.305 (Reload) |
| 47 | **Recharge X** | `Autre édition` | V5 (p.305) : X Actions. | V4 (p.299) : Test étendu de Projectiles totalisant X DR. | L06 p.305 (Reload) |
| 47 | **Recharge X** | `Remarque` | Version V4 retenue : les valeurs des profils (jusqu'à 12) sont à l'échelle V4 (voir Points à trancher). | Les armes de siège ou de suppléments V4 gardent leur valeur d'origine (à arbitrer par le MJ). | L06 p.305 (Reload) |

### 1.2. Lignes à ajouter (2 lignes)

| Nom | Effet | Identifiant | Type | Paramètre | Nom EN | Version retenue | Source | Autre édition | Anciens noms | Remarque |
|---|---|---|---|---|---|---|---|---|---|---|
| **Bouclier** | En s'opposant à une attaque avec Esquive ou Corps à corps, confère +1 DR (sans cumul avec Défensive) et applique ses PA si le coup touche. Avec 2 PA ou plus, permet d'opposer les tirs avec Esquive à toute portée. Un seul bouclier compte. Porté attaché au bras ou en bandoulière, ses PA ne s'appliquent qu'à la Tête, au Corps et au Bras non directeur. En attaque, compte comme Arme improvisée (allonge Personnelle) et perd sa protection jusqu'au début du prochain Tour. | `bouclier` | Atout d'armure | *(vide)* | Shield | V5 | Livre de base V5 EN p.306 | V4 : Protectrice X (Atout d'arme, PA portés par le paramètre X). | *(vide)* | Les PA du bouclier figurent dans la colonne Valeur d'Armure (PA). |
| **Inflige X** | Une touche inflige 1 état X à la cible (si un score de Force est indiqué, comme Empêtré 50 ou Empêtré votre Force, il sert aux Tests pour se libérer de l'état). | `inflige` | Atout d'arme | X = État (et Force éventuelle) | Inflict | V5 | Livre de base V5 EN p.304 | V4 : Immobilisante (pour Empêtré). | Inflige | Exemples V5 : Inflige (Empêtré 50), Inflige (Empêtré 45), Inflige (Empêtré 35), Inflige (Empêtré votre Force), Inflige (À terre), Inflige (Enflammé), Inflige (Assourdi). |

---

## 2. Onglet *Armes Corps à Corps*

### 2.1. Cellules modifiées (50 cellules)

| Ligne feuille | Objet | Colonne | Valeur actuelle | Valeur V5 | Référence / Arbitrage |
|---:|---|---|---|---|---|
| 4 | **Bâton de combat (2M)** | `Dégâts` | =+BF +4 | =+BF +3 | L06 p.301 ((2H) Quarterstaff : +SB+3, Defensive, Pummel, Undamaging) |
| 4 | **Bâton de combat (2M)** | `Atouts et Défauts` | Assommante, Défensive | Défensive, Assommante, Inoffensive | L06 p.301 ((2H) Quarterstaff : +SB+3, Defensive, Pummel, Undamaging) |
| 5 | **Hallebarde (2M)** | `Dégâts` | =+BF +4 | =+BF +5 | L06 p.301 ((2H) Halberd : +SB+5, Defensive, Hack, Impale) |
| 6 | **Lance (2M)** | `Atouts et Défauts` | Empaleuse | Rapide, Empaleuse | L06 p.301 ((2H) Spear : Very Long, +SB+4, Fast, Impale) |
| 10 | **Mancatcher (2M)** | `Atouts et Défauts` | Défensive, Immobilisante | Défensive, Inflige (Empêtré votre Force) | Up in Arms p.96 / conversion V5 de Immobilisante (à arbitrer) |
| 18 | **Garrot (2M)** | `Atouts et Défauts` | Immobilisante, Lente, Déséquilibrée, Inoffensive | Inflige (Empêtré votre Force), Inoffensive | L06 p.301 ((2H) Garrote : Personal, +SB+2, Inflict (Entangled your Strength), Undamaging) |
| 24 | **Hache** | `Atouts et Défauts` | Taille, Déséquilibrée | Déséquilibrée | L06 p.300-301 & Décision 3 (profil Hand Weapon V5) |
| 26 | **Gourdin** | `Atouts et Défauts` | Inoffensive, Déséquilibrée | Déséquilibrée | L06 p.300-301 & Décision 3 (profil Hand Weapon V5) |
| 28 | **Masse** | `Atouts et Défauts` | Assommante, Déséquilibrée | Déséquilibrée | L06 p.300-301 & Décision 3 (profil Hand Weapon V5) |
| 29 | **Pic de guerre** | `Atouts et Défauts` | Perforante, Déséquilibrée | Déséquilibrée | L06 p.300-301 & Décision 3 (profil Hand Weapon V5) |
| 32 | **Marteau de guerre** | `Atouts et Défauts` | Déséquilibrée, Assommante ou Perforante | Déséquilibrée | L06 p.300-301 & Décision 3 (profil Hand Weapon V5) |
| 47 | **Arme de queue (Tail Weapon) Skaven** | `Atouts et Défauts` | Imprécise, Perturbante | Imprécise, Déséquilibrée | The Imperial Zoo p.94 / conversion V5 de Perturbante → Déséquilibrée (à arbitrer) |
| 55 | **Lance de cavalerie** | `Atouts et Défauts` | Empaleuse, Percutante, bonus si charge | Dévastatrice, Empaleuse | L06 p.301 (Lance : Very Long, +SB+6*, Damaging, Impale) |
| 57 | **Demi-lance** | `Atouts et Défauts` | Percutante, Empaleuse | Dévastatrice, Empaleuse | Up in Arms p.93 / conversion V5 calquée sur Lance de cavalerie L06 p.301 |
| 59 | **Lance de cavalerie Haut Elfe** | `Atouts et Défauts` | Solide 1, Empaleuse, Raffiné 1, Percutante | Solide 1, Empaleuse, Raffiné 1, Dévastatrice | High Elf PG p.33 / conversion V5 calquée sur Lance de cavalerie L06 p.301 |
| 60 | **Grande Hache Haut Elfe** | `Atouts et Défauts` | Solide 1, Épuisante, Raffiné 1, Percutante, Taille | Solide 1, Raffiné 1, Dévastatrice, Taille, Déséquilibrée | High Elf PG p.33 / conversion V5 calquée sur Grande hache L06 p.301 |
| 63 | **Grande Hache Naine** | `Atouts et Défauts` | Épuisante, Percutante, Taille | Dévastatrice, Taille, Déséquilibrée | Dwarf PG p.91 / conversion V5 calquée sur Grande hache L06 p.301 |
| 67 | **Grande hache (2M)** | `Atouts et Défauts` | Épuisante, Percutante, Taille | Dévastatrice, Taille, Déséquilibrée | L06 p.301 ((2H) Greataxe : Long, +SB+6, Damaging, Hack, Unbalanced) |
| 68 | **Marteau de guerre (2M)** | `Allonge` | Moyenne | Longue | L06 p.301 ((2H) Warhammer : Long, +SB+6, Damaging, Pummel, Unbalanced) |
| 68 | **Marteau de guerre (2M)** | `Dégâts` | =+BF +5 | =+BF +6 | L06 p.301 ((2H) Warhammer : Long, +SB+6, Damaging, Pummel, Unbalanced) |
| 68 | **Marteau de guerre (2M)** | `Atouts et Défauts` | Assommante, Dévastatrice, Lente | Dévastatrice, Assommante, Déséquilibrée | L06 p.301 ((2H) Warhammer : Long, +SB+6, Damaging, Pummel, Unbalanced) |
| 69 | **Pioche (2M)** | `Allonge` | Moyenne | Longue | L06 p.301 ((2H) Pick : Long, +SB+5, Damaging, Penetrating, Unbalanced) |
| 69 | **Pioche (2M)** | `Atouts et Défauts` | Dévastatrice, Empaleuse, Lente | Dévastatrice, Perforante, Déséquilibrée | L06 p.301 ((2H) Pick : Long, +SB+5, Damaging, Penetrating, Unbalanced) |
| 73 | **Hache de Tueur (2M)** | `Atouts et Défauts` | Percutante, Perforante | Dévastatrice, Perforante, Déséquilibrée | Archives I p.92 / conversion V5 de Percutante (à arbitrer) |
| 77 | **Fléau** | `Dégâts` | =+BF +5 | =+BF +4 | L06 p.301 (Flail : Average, +SB+4, Pummel, Wrap, Unbalanced) |
| 77 | **Fléau** | `Atouts et Défauts` | Perturbante, À Enroulement | Assommante, À Enroulement, Déséquilibrée | L06 p.301 (Flail : Average, +SB+4, Pummel, Wrap, Unbalanced) |
| 78 | **Fléau à grain** | `Nom` | Fléau à grain | Fléau à grain (2M) | L06 p.301 ((2H) Grain Flail : Long, +SB+3, Pummel, Imprecise) |
| 78 | **Fléau à grain** | `Allonge` | Moyenne | Longue | L06 p.301 ((2H) Grain Flail : Long, +SB+3, Pummel, Imprecise) |
| 78 | **Fléau à grain** | `Atouts et Défauts` | Perturbante, Imprécise, À Enroulement | Assommante, Imprécise | L06 p.301 ((2H) Grain Flail : Long, +SB+3, Pummel, Imprecise) |
| 79 | **Fléau d’armes (2M)** | `Dégâts` | =+BF +6 | =+BF +5 | L06 p.301 ((2H) Military Flail : Long, +SB+5, Damaging, Pummel, Wrap, Unbalanced) |
| 79 | **Fléau d’armes (2M)** | `Atouts et Défauts` | Perturbante, Percutante, Épuisante, À Enroulement | Dévastatrice, Assommante, À Enroulement, Déséquilibrée | L06 p.301 ((2H) Military Flail : Long, +SB+5, Damaging, Pummel, Wrap, Unbalanced) |
| 80 | **Lames tournoyantes de la mort Naines** | `Atouts et Défauts` | À Enroulement, Épuisante, Percutante, Perturbante, Taille | À Enroulement, Dévastatrice, Assommante, Déséquilibrée, Taille | Dwarf PG p.91 / conversion V5 calquée sur Fléau d'armes L06 p.301 (à arbitrer) |
| 81 | **Encensoir à Peste Skaven** | `Atouts et Défauts` | Épuisante, Imprécise, Malepierre, Percutante, Perturbante | Dévastatrice, Assommante, Déséquilibrée, Imprécise, Malepierre | The Imperial Zoo p.94 / conversion V5 calquée sur Fléau d'armes L06 p.301 (à arbitrer) |
| 82 | **Foret à Vapeur Nain** | `Atouts et Défauts` | Empaleuse, Percutante | Empaleuse, Dévastatrice | Dwarf PG p.91 / conversion V5 de Percutante → Dévastatrice (à arbitrer) |
| 84 | **Gantelet à Vapeur Nain** | `Atouts et Défauts` | Assommante, Protectrice 1 | Assommante, Défensive | Dwarf PG p.91 / conversion V5 de Protectrice 1 → Défensive (ou Bouclier 1 PA, à arbitrer) |
| 85 | **Brise-épée** | `Catégorie` | Parade | Escrime | L06 p.301 (Swordbreaker) & Décision 2 |
| 85 | **Brise-épée** | `Dégâts` | =+BF +3 | =+BF +1 | L06 p.301 (Swordbreaker) & Décision 2 |
| 85 | **Brise-épée** | `Atouts et Défauts` | Défensive, Piège-lame | Défensive, Parade, Piège-lame | L06 p.301 (Swordbreaker) & Décision 2 |
| 86 | **Main gauche** | `Catégorie` | Parade | Escrime | L06 p.301 (Main Gauche) & Décision 2 |
| 86 | **Main gauche** | `Allonge` | Très courte | Courte | L06 p.301 (Main Gauche) & Décision 2 |
| 86 | **Main gauche** | `Atouts et Défauts` | Défensive | Défensive, Empaleuse, Parade | L06 p.301 (Main Gauche) & Décision 2 |
| 87 | **Cape** | `Catégorie` | Parade | Base | Up in Arms p.95 & Décisions 2, 5 (Force 25, groupe Base à arbitrer) |
| 87 | **Cape** | `Dégâts` | =+BF +0 | - | Up in Arms p.95 & Décisions 2, 5 (Force 25, groupe Base à arbitrer) |
| 87 | **Cape** | `Atouts et Défauts` | Immobilisante, Défensive, Inoffensive | Défensive, Inflige (Empêtré 25), Inoffensive | Up in Arms p.95 & Décisions 2, 5 (Force 25, groupe Base à arbitrer) |
| 88 | **Filet lesté (2M)** | `Catégorie` | Parade | Base | L06 p.301 (Net) & Décision 2 |
| 88 | **Filet lesté (2M)** | `Nom` | Filet lesté (2M) | Filet | L06 p.301 (Net) & Décision 2 |
| 88 | **Filet lesté (2M)** | `Dégâts` | =+BF +0 | - | L06 p.301 (Net) & Décision 2 |
| 88 | **Filet lesté (2M)** | `Atouts et Défauts` | Immobilisante, Défensive, Protectrice 1, Lente, Inoffensive, À Enroulement | Défensive, Inflige (Empêtré 50) | L06 p.301 (Net) & Décision 2 |
| 89 | **Filet Druchii** | `Catégorie` | Parade | Base | Temple of Spite p.57 / conversion V5 calquée sur Filet L06 p.301 & Décision 2 (à arbitrer) |
| 89 | **Filet Druchii** | `Atouts et Défauts` | À Enroulement, Défensive, Raffiné 1, Immobilisante, Inoffensive, Lente | À Enroulement, Défensive, Raffiné 1, Inflige (Empêtré 50), Inoffensive | Temple of Spite p.57 / conversion V5 calquée sur Filet L06 p.301 & Décision 2 (à arbitrer) |

### 2.2. Lignes à ajouter (2 lignes)

| Catégorie | Nom | Prix | Disponibilité | Allonge | Dégâts | Atouts et Défauts | Référence |
|---|---|---|---|---|---|---|---|
| Escrime | **Targe (Buckler)** | 18 s 2 d | Courante | Personnelle | `=+BF +1` | Parade, Inoffensive | L06 p.301 (Buckler, Fencing) & Décision 6 |
| Fléau | **Fouet** | 5/- | Commune | Très longue | `=+BF +2` | À Enroulement, Déséquilibrée, Inoffensive | L06 p.301 (Whip, Flail) — déplacé depuis Armes à Distance |

### 2.3. Lignes à retirer de *Armes Corps à Corps* (7 lignes : boucliers déplacés vers *Armures* et doublons fusionnés)

| Ligne feuille | Catégorie | Nom | Motif | Référence |
|---:|---|---|---|---|
| 48 | Bouclier | **Bouclier Haut Elfe** | Déplacé vers l’onglet Armures (Décision 6 ; Targe également ajoutée en Escrime) | L06 p.306-307 & Décisions 6, 8 |
| 49 | Bouclier | **Bouclier** | Déplacé vers l’onglet Armures (Décision 6 ; Targe également ajoutée en Escrime) | L06 p.306-307 & Décisions 6, 8 |
| 50 | Bouclier | **Pavois** | Doublon de Pavois (Pavise) (ligne 54) supprimé (Décision 8) ; déplacé vers Armures (Décision 6) | L06 p.306-307 & Décisions 6, 8 |
| 51 | Bouclier | **Targe (Buckler)** | Déplacé vers l’onglet Armures (Décision 6 ; Targe également ajoutée en Escrime) | L06 p.306-307 & Décisions 6, 8 |
| 52 | Bouclier | **Bouclier standard** | Doublon de Bouclier (ligne 49) supprimé (Décision 8) ; boucliers déplacés vers Armures (Décision 6) | L06 p.306-307 & Décisions 6, 8 |
| 53 | Bouclier | **Grand Bouclier** | Déplacé vers l’onglet Armures (Décision 6 ; Targe également ajoutée en Escrime) | L06 p.306-307 & Décisions 6, 8 |
| 54 | Bouclier | **Pavois (Pavise)** | Déplacé vers l’onglet Armures (Décision 6 ; Targe également ajoutée en Escrime) | L06 p.306-307 & Décisions 6, 8 |

---

## 3. Onglet *Armes à Distance*

### 3.1. Cellules modifiées (55 cellules)

> Note : les portées dynamiques du livre de base et des suppléments (`BF`, `BF × 2`, `BF × 3`, `Comme la sarbacane`), auparavant laissées vides dans la feuille et injectées par `rangeCorrections`, sont désormais renseignées directement dans la colonne `Portée` (et conservées en filet de sécurité dans `tools/refresh-equipment-catalog.mjs`).

| Ligne feuille | Objet | Colonne | Valeur actuelle | Valeur V5 | Référence / Arbitrage |
|---:|---|---|---|---|---|
| 2 | **Arbalète (2M)** | `Portée` | 60 | 50 | L06 p.303 ((2H) Crossbow : Range 50, +9, Reload 1) |
| 3 | **Arbalète de poing** | `Portée` | 10 | 20 | L06 p.303 (Crossbow Pistol : Range 20, +7, Pistol, Reload 1) |
| 3 | **Arbalète de poing** | `Atouts et Défauts` | Pistolet | Pistolet, Recharge 1 | L06 p.303 (Crossbow Pistol : Range 20, +7, Pistol, Reload 1) |
| 4 | **Arbalète lourde (2M)** | `Portée` | 100 | 60 | L06 p.303 ((2H) Heavy Crossbow : Range 60, +10, Reload 2) |
| 4 | **Arbalète lourde (2M)** | `Dégâts` | =+9 | =+10 | L06 p.303 ((2H) Heavy Crossbow : Range 60, +10, Reload 2) |
| 4 | **Arbalète lourde (2M)** | `Atouts et Défauts` | Dévastatrice, Recharge 2 | Recharge 2 | L06 p.303 ((2H) Heavy Crossbow : Range 60, +10, Reload 2) |
| 8 | **Baliste Faucheuse (Reaper Bolt Thrower) Druchii** | `Atouts et Défauts` | Équipage 2, Précise, Recharge 12, Salve 6 | Équipage 2, Pointue, Recharge 12, Salve 6 | Temple of Spite p.57 / conversion V5 de Précise → Pointue (à arbitrer) |
| 9 | **Faucheuse des cieux (Sky Reaper) Druchii** | `Atouts et Défauts` | Équipage 2, Précise, Recharge 12, Salve 6 | Équipage 2, Pointue, Recharge 12, Salve 6 | Temple of Spite p.57 / conversion V5 de Précise → Pointue (à arbitrer) |
| 10 | **Harpon Ravageur Druchii** | `Atouts et Défauts` | Carreau barbelé, Empaleuse, Précise, Recharge 3 | Carreau barbelé, Empaleuse, Pointue, Recharge 3 | Temple of Spite p.57 / conversion V5 de Précise → Pointue (à arbitrer) |
| 12 | **Arc (2M)** | `Dégâts` | =+BF +3 | =+BF +4 | L06 p.303 ((2H) Bow : Range 50, +SB+4, –) |
| 13 | **Arc court (2M)** | `Portée` | 20 | 40 | L06 p.303 ((2H) Shortbow : Range 40, +SB+3, –) |
| 13 | **Arc court (2M)** | `Dégâts` | =+BF +2 | =+BF +3 | L06 p.303 ((2H) Shortbow : Range 40, +SB+3, –) |
| 15 | **Arc long (2M)** | `Portée` | 100 | 60 | L06 p.303 ((2H) Longbow : Range 60, +SB+4, Damaging) |
| 22 | **Lasso** | `Nom` | Lasso | Lasso (2M) | L06 p.303 ((2H) Lasso : Range SBx2, –, Inflict (Entangled 45)) |
| 22 | **Lasso** | `Portée` | *(vide)* | BF × 2 | L06 p.303 ((2H) Lasso : Range SBx2, –, Inflict (Entangled 45)) |
| 22 | **Lasso** | `Atouts et Défauts` | Immobilisante | Inflige (Empêtré 45) | L06 p.303 ((2H) Lasso : Range SBx2, –, Inflict (Entangled 45)) |
| 24 | **Bombe** | `Portée` | *(vide)* | BF | L06 p.303 (Bomb : Range SB, +12, Blast 5, Inflict (Deafened), Dangerous, Blackpowder, Damaging) |
| 24 | **Bombe** | `Atouts et Défauts` | Explosion 5, Dangereuse, Percutante | Explosion 5, Inflige (Assourdi), Dangereuse, À Poudre noire, Dévastatrice | L06 p.303 (Bomb : Range SB, +12, Blast 5, Inflict (Deafened), Dangerous, Blackpowder, Damaging) |
| 25 | **Bombe incendiaire** | `Portée` | *(vide)* | BF | L06 p.303 (Incendiary : Range SB, 8, Blast 4, Inflict (Ablaze), Dangerous, Blackpowder, Damaging) |
| 25 | **Bombe incendiaire** | `Dégâts` | Spécial*** | =+8 | L06 p.303 (Incendiary : Range SB, 8, Blast 4, Inflict (Ablaze), Dangerous, Blackpowder, Damaging) |
| 25 | **Bombe incendiaire** | `Atouts et Défauts` | Explosion 4, Dangereuse *** Une Bombe incendiaire donne +DR État Enflammé à chaque cible affectée. | Explosion 4, Inflige (Enflammé), Dangereuse, À Poudre noire, Dévastatrice | L06 p.303 (Incendiary : Range SB, 8, Blast 4, Inflict (Ablaze), Dangerous, Blackpowder, Damaging) |
| 26 | **Bombe Cinderblast** | `Portée` | *(vide)* | BF | Dwarf PG p.92 / conversion V5 de Percutante → Dévastatrice |
| 26 | **Bombe Cinderblast** | `Atouts et Défauts` | Explosion 3, Dangereuse, Percutante, Perforante | Explosion 3, Dangereuse, Dévastatrice, Perforante | Dwarf PG p.92 / conversion V5 de Percutante → Dévastatrice |
| 27 | **Fronde** | `Portée` | 60 | 40 | L06 p.303 (Sling : Range 40, +6, –) |
| 28 | **Fustibale (2M)** | `Portée` | 100 | 50 | L06 p.303 ((2H) Staff Sling : Range 50, +7, –) |
| 29 | **Arquebuse à répétition (2M)** | `Portée` | 30 | 40 | L06 p.303 ((2H) Repeater Handgun : Range 40, +10, Dangerous, Reload 5, Repeater 4, Blackpowder, Damaging) |
| 29 | **Arquebuse à répétition (2M)** | `Dégâts` | =+9 | =+10 | L06 p.303 ((2H) Repeater Handgun : Range 40, +10, Dangerous, Reload 5, Repeater 4, Blackpowder, Damaging) |
| 30 | **Pistolet à répétition** | `Portée` | 10 | 20 | L06 p.303 (Repeater Pistol : Range 20, +9, Dangerous, Pistol, Reload 4, Repeater 4, Blackpowder, Damaging) |
| 30 | **Pistolet à répétition** | `Dégâts` | =+8 | =+9 | L06 p.303 (Repeater Pistol : Range 20, +9, Dangerous, Pistol, Reload 4, Repeater 4, Blackpowder, Damaging) |
| 36 | **Torpille à Fléau de Troll (1 munition) Nain** | `Atouts et Défauts` | Dangereuse, Percutante, À Poudre noire, Recharge 6 | Dangereuse, Dévastatrice, À Poudre noire, Recharge 6 | Dwarf PG p.92 / conversion V5 de Percutante → Dévastatrice (à arbitrer) |
| 41 | **Javelot Blackbriar elfe sylvain** | `Portée` | *(vide)* | BF × 3 | Archives I p.93 (portée explicite) |
| 42 | **Bolas** | `Catégorie` | Lancer | Entraves | L06 p.303 (Bolas : Entangling, Range SBx3, +SB, Inflict (Entangled 35), Inflict (Prone), Undamaging) |
| 42 | **Bolas** | `Portée` | *(vide)* | BF × 3 | L06 p.303 (Bolas : Entangling, Range SBx3, +SB, Inflict (Entangled 35), Inflict (Prone), Undamaging) |
| 42 | **Bolas** | `Atouts et Défauts` | Immobilisante | Inflige (Empêtré 35), Inflige (À terre), Inoffensive | L06 p.303 (Bolas : Entangling, Range SBx3, +SB, Inflict (Entangled 35), Inflict (Prone), Undamaging) |
| 43 | **Couteau de lancer** | `Portée` | *(vide)* | BF × 2 | L06 p.303 (Throwing Knife : Range SBx2, +SB+2, –) |
| 44 | **Fléchette** | `Portée` | *(vide)* | BF × 2 | Décision 5 (Fléchette conservée, portée explicite) |
| 45 | **Hache de lancer** | `Portée` | *(vide)* | BF × 2 | L06 p.303 (Throwing Axe : Range SBx2, +SB+3, Hack) |
| 46 | **Javelot** | `Portée` | *(vide)* | BF × 3 | L06 p.303 (Javelin : Range SBx3, +SB+3, Impale) |
| 47 | **Rocher** | `Portée` | *(vide)* | BF × 3 | L06 p.303 (Rock : Range SBx3, +SB+1, Undamaging) |
| 47 | **Rocher** | `Dégâts` | =+BF | =+BF +1 | L06 p.303 (Rock : Range SBx3, +SB+1, Undamaging) |
| 47 | **Rocher** | `Atouts et Défauts` | - | Inoffensive | L06 p.303 (Rock : Range SBx3, +SB+1, Undamaging) |
| 48 | **Arquebuse (2M)** | `Portée` | 50 | 40 | L06 p.303 ((2H) Handgun : Range 40, +10, Reload 3, Blackpowder, Damaging — sans Dangerous) |
| 48 | **Arquebuse (2M)** | `Dégâts` | =+9 | =+10 | L06 p.303 ((2H) Handgun : Range 40, +10, Reload 3, Blackpowder, Damaging — sans Dangerous) |
| 48 | **Arquebuse (2M)** | `Atouts et Défauts` | Dangereuse, Recharge 3, À Poudre noire, Dévastatrice | Recharge 3, À Poudre noire, Dévastatrice | L06 p.303 ((2H) Handgun : Range 40, +10, Reload 3, Blackpowder, Damaging — sans Dangerous) |
| 49 | **Long fusil d’Hochland (2M)** | `Catégorie` | Poudre Noire | Ingénierie | L06 p.303 ((2H) Hochland Long Rifle : Engineering, Range 100, +10, Precise, Reload 4, Blackpowder, Damaging) |
| 49 | **Long fusil d’Hochland (2M)** | `Dégâts` | =+9 | =+10 | L06 p.303 ((2H) Hochland Long Rifle : Engineering, Range 100, +10, Precise, Reload 4, Blackpowder, Damaging) |
| 49 | **Long fusil d’Hochland (2M)** | `Atouts et Défauts` | Précise, Pointue, Recharge 4, À Poudre noire, Dévastatrice | Pointue, Recharge 4, À Poudre noire, Dévastatrice | L06 p.303 ((2H) Hochland Long Rifle : Engineering, Range 100, +10, Precise, Reload 4, Blackpowder, Damaging) |
| 50 | **Pistolet** | `Dégâts` | =+8 | =+9 | L06 p.303 (Pistol : Range 20, +9, Pistol, Reload 2, Blackpowder, Damaging) |
| 50 | **Pistolet** | `Atouts et Défauts` | Pistolet, Recharge 1, À Poudre noire, Dévastatrice | Pistolet, Recharge 2, À Poudre noire, Dévastatrice | L06 p.303 (Pistol : Range 20, +9, Pistol, Reload 2, Blackpowder, Damaging) |
| 51 | **Tromblon (2M)** | `Atouts et Défauts` | Explosion 3, Dangereuse, Recharge 2, À Poudre noire, Dévastatrice | Explosion 3, Dangereuse, Recharge 3, À Poudre noire, Dévastatrice | L06 p.303 ((2H) Blunderbuss : Range 20, +8, Blast 3, Dangerous, Reload 3, Blackpowder, Damaging) |
| 66 | **Mortier naval** | `Atouts et Défauts` | Dangereuse, Dévastatrice, Percutante, À Poudre noire, Recharge 4, Explosion 5 | Dangereuse, Dévastatrice, À Poudre noire, Recharge 4, Explosion 5 | Retrait de Percutante (Dévastatrice déjà présente, à arbitrer) |
| 69 | **Fléchettes (lot de 12) Homme Lézard** | `Portée` | *(vide)* | Comme la sarbacane | Lustria p.163 (portée explicite) |
| 75 | **Baliste navale** | `Atouts et Défauts` | Empaleuse, Perforante, Précise, Recharge 3 | Empaleuse, Perforante, Pointue, Recharge 3 | Conversion V5 de Précise → Pointue (à arbitrer) |
| 76 | **Catapulte (petite)** | `Atouts et Défauts` | Dévastatrice, Imprécise, Percutante, Recharge 3 | Dévastatrice, Imprécise, Recharge 3 | Up in Arms p.124 / retrait de Percutante (Dévastatrice déjà présente, à arbitrer) |
| 77 | **Catapulte (moyenne)** | `Atouts et Défauts` | Dévastatrice, Imprécise, Percutante, Recharge 3 | Dévastatrice, Imprécise, Recharge 3 | Up in Arms p.124 / retrait de Percutante (Dévastatrice déjà présente, à arbitrer) |

### 3.2. Lignes à ajouter (1 ligne)

| Catégorie | Nom | Prix | Disponibilité | Portée | Dégâts | Atouts et Défauts | Référence |
|---|---|---|---|---|---|---|---|
| Entraves | **Filet** | 1 CO 10/- | Rare | `BF` | `-` | Inflige (Empêtré 50) | L06 p.303 (Net, Entangling) |

### 3.3. Lignes à retirer de *Armes à Distance* (3 lignes : déplacement du Fouet et suppression des doublons)

| Ligne feuille | Catégorie | Nom | Motif | Référence |
|---:|---|---|---|---|
| 21 | Entraves | **Fouet** | Déplacé vers Armes Corps à Corps / Fléau (L06 p.301) | L06 p.301 |
| 52 | Poudre Noire | **Mousquet (2M)** | Doublon de Arquebuse (2M) (ligne 48, Handgun L06 p.303) supprimé (Décision 8) | Décision 8 |
| 53 | Poudre Noire | **Pistolet** | Doublon strict de Pistolet (ligne 50) supprimé (Décision 8) | Décision 8 |

---

## 4. Onglet *Armures*

### 4.1. Cellules modifiées (20 cellules)

| Ligne feuille | Catégorie — Objet | Colonne | Valeur actuelle | Valeur V5 | Référence |
|---:|---|---|---|---|---|
| 7 | **Mailles — Chausses de mailles** | `Atouts et Défauts (et Pénalités)` | Flexible | Flexible (-1 DR en Discrétion si une ou plusieurs pièces de mailles sont portées) | L06 p.307 (Mail Chausses — note de catégorie Mailles) |
| 8 | **Mailles — Chemise de mailles** | `Atouts et Défauts (et Pénalités)` | Flexible | Flexible (-1 DR en Discrétion si une ou plusieurs pièces de mailles sont portées) | L06 p.307 (Mail Shirt — note de catégorie Mailles) |
| 9 | **Mailles — Coiffe de mailles** | `Atouts et Défauts (et Pénalités)` | Flexible, Partielle (-10% en Perception) | Flexible, Partielle (-1 DR en Discrétion si une ou plusieurs pièces de mailles sont portées) | L06 p.307 (Mail Coif — retrait de -10% en Perception, note de catégorie Mailles) |
| 10 | **Mailles — Cotte de mailles** | `Atouts et Défauts (et Pénalités)` | Flexible | Flexible (-1 DR en Discrétion si une ou plusieurs pièces de mailles sont portées) | L06 p.307 (Mail Coat — note de catégorie Mailles) |
| 11 | **Plates — Brassards** | `Atouts et Défauts (et Pénalités)` | Impénétrable, Points faibles | Impénétrable, Points faibles (-1 DR en Discrétion si au moins une pièce de plates est portée) | L06 p.307 (Bracers — note de catégorie Plates) |
| 12 | **Plates — Heaume** | `Atouts et Défauts (et Pénalités)` | Impénétrable, Points faibles (-20% en Perception) | Impénétrable, Points faibles (-2 DR en Perception ; -1 DR en Discrétion si au moins une pièce de plates est portée) | L06 p.307 (Helm : -2 SL to Perception Tests + note Plates) |
| 13 | **Plates — Heaume ouvert** | `Atouts et Défauts (et Pénalités)` | Partielle (-10% en Perception) | Partielle (-1 DR en Discrétion si au moins une pièce de plates est portée) | L06 p.307 (Open Helm — retrait de -10% en Perception + note Plates) |
| 14 | **Plates — Jambières d’acier** | `Atouts et Défauts (et Pénalités)` | Impénétrable, Points faibles (-10 en Discrétion supplémentaire) | Impénétrable, Points faibles (-1 DR en Discrétion si au moins une pièce de plates est portée) | L06 p.307 (Plate Leggings — remplacement de -10 en Discrétion par la note Plates) |
| 15 | **Plates — Plastron** | `Atouts et Défauts (et Pénalités)` | Impénétrable, Points faibles | Impénétrable, Points faibles (-1 DR en Discrétion si au moins une pièce de plates est portée) | L06 p.307 (Breastplate — note de catégorie Plates) |
| 25 | **Gromril (nain) — Heaume ouvert** | `Atouts et Défauts (et Pénalités)` | Solide 4, Raffiné 1, Partielle, -10% Perception | Solide 4, Raffiné 1, Partielle (-1 DR en Discrétion si au moins une pièce de plates est portée) | Dwarf PG p.93 / alignement V5 sur Heaume ouvert L06 p.307 |
| 27 | **Gromril (nain) — Jambières de plates** | `Atouts et Défauts (et Pénalités)` | Solide 4, Raffiné 1, Impénétrable, Points faibles, -10 Discrétion | Solide 4, Raffiné 1, Impénétrable, Points faibles (-1 DR en Discrétion si au moins une pièce de plates est portée) | Dwarf PG p.93 / alignement V5 sur Jambières L06 p.307 |
| 28 | **Gromril (nain) — Heaume** | `Atouts et Défauts (et Pénalités)` | Solide 4, Raffiné 1, Impénétrable, Points faibles, -20% Perception | Solide 4, Raffiné 1, Impénétrable, Points faibles (-2 DR en Perception ; -1 DR en Discrétion si au moins une pièce de plates est portée) | Dwarf PG p.93 / alignement V5 sur Heaume L06 p.307 |
| 30 | **Plates Naines — Casque de mineur (ouvert)** | `Atouts et Défauts (et Pénalités)` | Partielle, -10% Perception (Dispose d'encoches pour des bougies) | Partielle (Dispose d'encoches pour des bougies ; -1 DR en Discrétion si au moins une pièce de plates est portée) | Dwarf PG p.93 / alignement V5 sur Heaume ouvert L06 p.307 |
| 32 | **Ithilmar Haut Elfe — Heaume ouvert** | `Atouts et Défauts (et Pénalités)` | Solide 2, Raffiné 2, Partielle, -10% Perception | Solide 2, Raffiné 2, Partielle | High Elf PG p.34 / alignement V5 sur Heaume ouvert L06 p.307 |
| 34 | **Ithilmar Haut Elfe — Jambières de plates** | `Atouts et Défauts (et Pénalités)` | Solide 2, Raffiné 2, Impénétrable, Points faibles, -10 Discrétion | Solide 2, Raffiné 2, Impénétrable, Points faibles | High Elf PG p.34 / alignement V5 (pas de malus Discrétion sur Ithilmar) |
| 35 | **Ithilmar Haut Elfe — Heaume** | `Atouts et Défauts (et Pénalités)` | Solide 2, Raffiné 2, Impénétrable, Points faibles, -20% Perception | Solide 2, Raffiné 2, Impénétrable, Points faibles (-2 DR en Perception) | High Elf PG p.34 / alignement V5 sur Heaume L06 p.307 |
| 36 | **Ithilmar Haut Elfe — Heaume Ithiltaen** | `Atouts et Défauts (et Pénalités)` | Solide 2, Raffiné 4, Impénétrable, Points faibles, -20% Perception | Solide 2, Raffiné 4, Impénétrable, Points faibles (-2 DR en Perception) | High Elf PG p.34 / alignement V5 sur Heaume L06 p.307 |
| 38 | **Dragon Haut Elfe — Heaume ouvert** | `Atouts et Défauts (et Pénalités)` | Solide 3, Raffiné 2, Partielle, -10% Perception | Solide 3, Raffiné 2, Partielle | High Elf PG p.34 / alignement V5 sur Heaume ouvert L06 p.307 |
| 40 | **Dragon Haut Elfe — Jambières de plates** | `Atouts et Défauts (et Pénalités)` | Solide 3, Raffiné 2, Impénétrable, Points faibles, -10 Discrétion | Solide 3, Raffiné 2, Impénétrable, Points faibles | High Elf PG p.34 / alignement V5 (pas de malus Discrétion sur armure Dragon) |
| 41 | **Dragon Haut Elfe — Heaume** | `Atouts et Défauts (et Pénalités)` | Solide 3, Raffiné 2, Impénétrable, Points faibles, -20% Perception | Solide 3, Raffiné 2, Impénétrable, Points faibles (-2 DR en Perception) | High Elf PG p.34 / alignement V5 sur Heaume L06 p.307 |

### 4.2. Lignes à ajouter (5 lignes : boucliers déplacés depuis *Armes Corps à Corps* et dédoublonnés)

| Catégorie | Nom | Prix | Disponibilité | Valeur d'Armure (PA) | Zones Couvertes | Atouts et Défauts (et Pénalités) | Référence |
|---|---|---|---|---:|---|---|---|
| Bouclier | **Targe (Buckler)** | 18 s 2 d | Courante | **1** | Toutes | Bouclier | L06 p.307 (Buckler) & Décision 6 |
| Bouclier | **Bouclier** | 2 CO | Commune | **2** | Toutes | Bouclier | L06 p.307 (Shield) & Décisions 6, 8 (fusion Bouclier / Bouclier standard) |
| Bouclier | **Grand Bouclier** | 3 CO | Courante | **3** | Toutes | Bouclier | L06 p.307 (Large Shield) & Décision 6 |
| Bouclier | **Pavois (Pavise)** | 3 CO 15 s | Rare | **3** | Toutes | Bouclier (Posé au sol en 2 Actions : confère 5 PA face à la direction choisie ; manié au bras : Grand Bouclier encombrant, à arbitrer) | Up in Arms p.92 & Décisions 6, 8 (fusion Pavois / Pavois (Pavise)) |
| Bouclier | **Bouclier Haut Elfe** | 8 CO | Courante | **2** | Toutes | Bouclier, Solide 1, Raffiné 1 | High Elf PG p.33 & Décision 6 |

---

## 5. Récapitulatif des doublons résolus et doublons de suppléments signalés au MJ

### 5.1. Doublons résolus (Décision 8)
1. **`Pistolet` × 2** (*Armes à Distance* lignes 50 et 53) : ligne 50 passée au profil V5 (`À Poudre noire, Dévastatrice, Dangereuse, Pistolet, Recharge 1`), ligne 53 supprimée.
2. **`Arquebuse (2M)` (ligne 48) / `Mousquet (2M)` (ligne 52)** (*Armes à Distance*) : deux traductions françaises du même *Handgun* du livre de base (4 CO, Limitée, Portée 50, +9, Recharge 3), distinct de l'`Arquebuse ancienne (2M)` d'*Up in Arms* p.101 (ligne 56, 5 CO, Exotique, Portée 40, Imprécise, Recharge 5). Ligne 48 (`Arquebuse (2M)`) mise au profil V5, ligne 52 (`Mousquet (2M)`) supprimée.
3. **`Bouclier` (ligne 49) / `Bouclier standard` (ligne 52)** (*Armes Corps à Corps*) : fusionnés en une seule entrée `Bouclier` dans l'onglet *Armures* (`Catégorie : Bouclier`, `PA : 2`, `Zones : Toutes`, `Atouts : Bouclier`).
4. **`Pavois` (ligne 50) / `Pavois (Pavise)` (ligne 54)** (*Armes Corps à Corps*) : fusionnés en une seule entrée `Pavois (Pavise)` dans l'onglet *Armures* (`Catégorie : Bouclier`, `PA : 3`, `Zones : Toutes`, `Atouts : Bouclier (Posé au sol en 2 Actions : confère 5 PA face à la direction choisie ; manié au bras : Grand Bouclier encombrant, à arbitrer)`).

### 5.2. Doublons d'éditions naines (*Archives Vol. I* vs *Dwarf Player's Guide*) — à arbitrer par le MJ
Le *Dwarf Player's Guide* (L15, p. 90) indique explicitement : *« The weapons listed in this chapter supersede the Dwarf weapons previously published in Archives of the Empire Volume I. »* La feuille actuelle conserve les deux versions côte à côte avec leurs prix et disponibilités propres. Conformément à la consigne de ne pas toucher aux prix/disponibilités et de conserver les armes des suppléments, ces 4 paires ont été conservées telles quelles mais sont signalées ici si le MJ souhaite retirer les doublons d'*Archives I* :
1. **`Marteau nain`** (*Armes CàC* ligne 35, 3 CO, *Archives I* p.92) vs **`Marteau de Guerre Nain`** (*Armes CàC* ligne 42, 1 CO, *Dwarf PG* p.91) — même profil (`Moyenne, =+BF +4, Assommante, Solide 1`).
2. **`Arbalète naine (2M)`** (*Armes à Distance* ligne 5, 9 CO, *Archives I* p.93, `Portée 60`) vs **`Arbalète Naine (2M)`** (*Armes à Distance* ligne 11, 8 CO, *Dwarf PG* p.92, `Portée 80`).
3. **`Mousquet nain (2M)`** (*Armes à Distance* ligne 60, 9 CO, *Archives I* p.93, `Portée 60`) vs **`Arquebuse Naine (2M)`** (*Armes à Distance* ligne 62, 6 CO, *Dwarf PG* p.92, `Portée 75`).
4. **`Pistolet nain`** (*Armes à Distance* ligne 61, 18 CO, *Archives I* p.93, `Portée 20, Pointue, Pistolet, Recharge 1`) vs **`Pistolet Nain`** (*Armes à Distance* ligne 63, 12 CO, *Dwarf PG* p.92, `Portée 30, À Poudre noire, Dévastatrice, Pistolet, Recharge 1, Solide 1`).

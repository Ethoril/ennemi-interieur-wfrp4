# Brief — passage des armes et armures en V5, et calculs d'espèces (26/10/2026)

Décisions du MJ du 26/10. Rédigé depuis l'Outil MJ Warhammer, où le travail de vérification a été fait. Exécutant prévu : Gemini. **Tu ne publies rien et tu ne pousses rien** ; commits locaux seulement, sur une branche dédiée de ce dépôt (`git switch -c gemini/armes-v5`), fins de ligne LF.

## Pourquoi

La feuille « Aides de jeu » (Google Sheet `1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs`, onglets *Armes Corps à Corps*, *Armes à Distance*, *Armures*, *Mots Clés Armes et Armures*) suit encore le livre de base V4 (livre FR) pour les armes et armures : 43 des 70 objets du livre de base diffèrent du livre V5. Le MJ passe en V5. Les règles de la table sont « V5 partout ».

Lire d'abord (chemins absolus) :
- `E:/Outil MJ Warhammer/tmp/gemini-verifs/RAPPORT_CATALOGUE_ARMES_L06.md` — relevé complet, objet par objet, champ par champ (L06 p.300-307). Vérifié par sondage : exact.
- `E:/Outil MJ Warhammer/tmp/gemini-verifs/SYNTHESE_CATALOGUE_ARMES_L06.md` — synthèse et conséquences.
- Livre V5 : `E:\Projet Warhammer Ennemi Intérieur\tmp\catalogue-bibliotheque\pdfs\Livre de base V5 EN v2.pdf` (p.300-307 tableaux ; p.304-306 Atouts et Défauts ; p.112-113 compétences). Les autres livres : `E:/Outil MJ Warhammer/docs/divin/DIVIN_CORPUS_LIVRES*.json`. Extraction ciblée `pdftotext -layout -f P -l P`, tableaux douteux en image (`pdftoppm -png -r 80`).

Chaîne des données : feuille Google → `node tools/refresh-equipment-catalog.mjs` (ce dépôt) → `js/data/equipment-catalog.json` → l'Outil MJ régénère son catalogue depuis ce dépôt (`tools/generate-reference-catalog.mjs --source-dir=…`, côté outil, hors de ce brief).

## Décisions du MJ à appliquer

1. **Armes et armures du livre de base : profils V5** (groupe, allonge ou portée, dégâts, Atouts et Défauts ; armures : emplacements, PA, Atouts, pénalités). Ne pas toucher aux prix, disponibilités, encombrements.
2. **Groupe Parade supprimé** (V5 : Corps à corps = Base, Bagarre, Cavalerie, Escrime, Fléau, Hast, Deux mains ; p.112). Main gauche, Brise-épée, Targe → Escrime ; « Parade » devient un Atout d'arme. **Augmentations existantes en Corps à corps (Parade) sur les fiches : au cas par cas** → produire la liste des PJ concernés (spécialité, augmentations) pour décision du MJ ; ne rien migrer automatiquement.
3. **Armes à une main détaillées conservées en lignes séparées** (Hache, Masse, Pic de guerre, Marteau de guerre, Gourdin…), même si la V5 les regroupe sous « Hand Weapon » (p.300) : choix du MJ, quitte à ce qu'elles aient toutes les mêmes caractéristiques. Profil de chacune = Hand Weapon V5 (allonge Moyenne, +BF +4, Déséquilibrée) ; un Atout propre n'est gardé que s'il vient d'un supplément, converti en mot-clé V5 ; sinon les lignes sont identiques. Les autres armes à une main du livre V5 (Dague, Couteau, Épée, Fleuret, Rapière, Coup-de-poing…) suivent leur ligne.
4. **Armes des suppléments conservées**, adaptées en V5 quand elles utilisent des mots-clés V4 sans équivalent (Perturbante, Lente, Épuisante, Précise, Percutante, Immobilisante, Protectrice) : proposer la conversion, ligne par ligne, sans inventer de chiffres ; marquer « à arbitrer » ce qui n'a pas d'équivalent évident.
5. **Objets V4 absents du livre V5 conservés** (Fléchette, Arc elfique, Plastron de cuir bouilli, Cape), mots-clés convertis en V5.
6. **Boucliers en V5** : dans le tableau des armures (PA 1 / 2 / 3 sur toutes les localisations, qualité Bouclier : +1 DR en défense, arme improvisée en attaque, p.306-307) ; la Targe existe aussi comme arme d'Escrime (p.301).
7. **Mots-clés** (onglet *Mots Clés Armes et Armures*) : ajouter ou mettre à jour les entrées V5 nécessaires (au minimum : Inflige (État X) / *Inflict*, Bouclier / *Shield* V5, Explosion / *Blast* et Recharge / *Reload* en version V5, Parade en Atout d'arme) ; marquer les entrées V4 devenues sans usage dans le livre de base, sans les supprimer (exemplaires existants).
8. **Doublons de la feuille** à résoudre : Pistolet ×2, Bouclier / Bouclier standard, Pavois / Pavois (Pavise), Arquebuse / Mousquet (2M).
9. **Calcul des Blessures et du Mouvement des espèces** (ce dépôt calcule aussi ces valeurs : `js/fiche/derived.js`, lignes 8 et 29 au 26/10, et l'équivalent bureau/mobile) — à aligner sur l'outil :
   - Halfling : **Mouvement 3** ; **Blessures V5 = BF + 2×BE + BFM** (+ BE par rang de Dur à cuire) — retirer l'exclusion du BF.
   - Ogre : **Blessures × 2** (Taille Grande, L06 p.361).
   - Espèces ajoutées : Gnome (Petit : Mouvement 3, Blessures 2×BE + BFM, L24 p.88), Elfe noir Mouvement 5 (L09 p.44), Elfe des mers Mouvement 5 (L08 p.57), Skink Mouvement 6 (L07 p.160).
   - Une espèce inconnue est signalée au lieu de recevoir un Mouvement de 4 par défaut.

## Étapes

1. **Liste de changements pour la feuille** — Gemini n'a pas accès en écriture à la feuille : produire `docs/briefs/CHANGEMENTS_FEUILLE_ARMES_V5.md`, onglet par onglet, une ligne par cellule à changer (objet, colonne, valeur actuelle → valeur V5, page du livre), plus les lignes à ajouter (mots-clés, Targe en Escrime, Filet à distance en Entraves, boucliers en armure) et les doublons. Fournir aussi, si utile, un CSV par onglet prêt à coller. Le MJ applique dans la feuille.
2. **Après application par le MJ** : `node tools/refresh-equipment-catalog.mjs`, contrôle que les 70 objets du livre de base correspondent maintenant à L06 (script de comparaison en lecture des PDF ou du rapport), et que le parseur de mots-clés reconnaît tous les nouveaux libellés.
3. **Fiches** : adapter ce qui dépend des groupes et mots-clés (compétences d'arme, affichage des Atouts, boucliers devenus armure) ; liste des PJ avec Corps à corps (Parade) pour le MJ ; calculs d'espèces (point 9). Tests du dépôt mis à jour et verts ; les tests qui épinglent les anciennes valeurs V4 sont modifiés **seulement** pour refléter une décision ci-dessus, listés dans le commit.
4. **Rapport** `docs/briefs/RAPPORT_ARMES_ARMURES_V5.md` : ce qui a changé, conversions proposées « à arbitrer », PJ concernés par la Parade, tests, ce qui reste à faire côté outil.

## Ce qui reste ensuite côté Outil MJ (hors de ce brief)

Régénérer le catalogue de l'outil depuis ce dépôt, puis adapter les moteurs de l'outil (groupes d'armes de la maîtrise F2-C sans Parade, mots-clés V5 pour le lot F2-D, boucliers en armure, calcul des espèces). Le lot F2-D de l'outil attend cette mise à jour.

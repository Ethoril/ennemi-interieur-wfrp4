# Équipement des fiches

La fiche bureau affiche deux cartouches, Armes et boucliers et Armures. Le mobile propose un cinquième onglet Équipement. Seul le MJ ajoute, modifie, retire ou actualise les objets. Il n'existe pas d'état équipé ou porté : toutes les pièces d'armure listées participent au calcul, et le joueur choisit son arme en partie.

## Profils et calculs

Le catalogue `js/data/equipment-catalog.json` contient 205 profils et 55 mots clés provenant des quatre onglets des aides de jeu. Chaque ajout crée une copie dans `data.equipment` avec une identité propre, sa base et sa version de catalogue. Les évolutions ultérieures du catalogue ne remplacent pas ces copies. Le MJ peut appliquer explicitement le profil de base, avec confirmation de la perte des personnalisations.

Les dégâts et portées BF sont calculés avec le Bonus de Force actuel. Les expressions spéciales et les valeurs alternatives restent lisibles. Les talents, pénalités et autres effets sont des rappels, sans modification automatique des caractéristiques ou des dégâts. Les paramètres numériques de Protectrice et les PA d'un bouclier restent cohérents dans l'éditeur.

Pour chaque zone, le calcul retient la meilleure protection de cuir souple, la meilleure couche Flexible, puis la meilleure couche non flexible. Les bonus explicitement additionnels s'ajoutent ; deux copies de la même base de bonus ne le multiplient pas. Les autres pièces restent visibles et le détail de la zone explique leur exclusion. Les PA de Partielle ou Points faibles restent une valeur de référence marquée d'un astérisque : les conditions de l'attaque ne sont pas connues de la fiche. Les boucliers sont affichés comme bonus conditionnels séparés, avec un seul bouclier retenu.

Le cumul et les défauts sont vérifiés dans le Livre de base V5 EN v2, p. 306-307. Les profils et les mots clés gardent l'édition des aides de jeu, notamment Protectrice V4. Le mémo explique les conditions V5 et signale cette différence. Le choix de la meilleure pièce d'une même couche et la déduplication des bonus sont l'arbitrage explicite de cette fiche.

## Personnalisation et modèles

Le MJ part d'un profil, change son nom, ses statistiques, ses zones, ses notes ou ses mots clés. Il choisit uniquement des mots clés du référentiel et leurs paramètres ; il ne crée pas de définition libre. Une modification vaut uniquement pour la copie ouverte.

« Enregistrer comme modèle MJ » crée un modèle privé dans `equipment_models`, proposé lors d'un ajout sur toute fiche. Un modèle est immuable : ses copies restent personnalisables. L'accès à cette collection est réservé au MJ, et les modèles invalides sont filtrés à la lecture. Aucun modèle ni contenu de fiche ne se trouve dans le catalogue public.

## Sauvegarde et compatibilité

La commande `equipment` utilise le contrôleur existant et la transaction serveur : droits MJ, révision exacte, reçu rejouable et historique. La comparaison de l'objet avant modification empêche aussi qu'un éditeur ancien écrase une modification reçue entre-temps. Une réponse réseau perdue peut être reprise avec le même identifiant d'opération.

Les autres champs et les XP restent conservés. Export et import incluent l'équipement, y compris sur l'ancienne fiche. Les fiches sans ce champ sont compatibles et commencent avec une liste vide. Les notes de possessions ne sont pas converties automatiquement.

## Sources et maintenance

Régénérer le catalogue : `node tools/refresh-equipment-catalog.mjs`. Le script peut lire des CSV locaux avec `--source-dir=<dossier>` et conserve leurs empreintes ainsi que les références des compléments.

Douze portées absentes ont été complétées à partir du livre français et des suppléments vérifiés. La portée du Globe de Vent Empoisonné Skaven reste vide : Imperial Zoo p. 94 mentionne l'objet sans fournir sa portée. La fiche affiche « À confirmer par le MJ » ; aucun chiffre n'a été inventé. La bombe Cinderblast conserve le profil +14 des aides de jeu et la portée BF d'Archives de l'Empire I p. 93, plutôt que le profil plus récent différent du guide nain.

Le texte du mémo provient de `js/equipment/memo.js`. Exporter ses sections et sa source en JSON, puis utiliser `tools/build-armour-memo.py <json> <pdf> --font-dir <dossier de polices Windows>` pour créer le PDF ; copier le résultat dans `docs/memo-armures.pdf` et vérifier son rendu.

## Validation et activation

- `npm run check` et `npm run lint`.
- `node tools/equipment-emulator.mjs` : modèles privés MJ, schéma fermé et refus des écritures directes sur la fiche.
- `tools/fiche-equipment-browser.mjs` avec `BUREAU_PLAYWRIGHT_MODULE` et `BUREAU_QA_URL` : vraies interfaces bureau/mobile avec dépôts fictifs, personnalisation, modèles, conflits, reprise réseau, téléchargement PDF et affichage 320/390 pixels dans les deux thèmes.

Le client, la fonction des fiches et les règles Firestore doivent être publiés ensemble. Ce développement local ne migre aucune fiche, ne pousse aucun commit et ne déploie aucune ressource.

# Validation locale — candidat v2.29.0

Validation finale effectuée le 5 octobre 2026 par l’agent orchestrateur après codage et revue par trois agents Luna.

## Résultat

Les évolutions sont implémentées dans le dépôt. Aucun déploiement, aucune migration des cinq fiches réelles et aucune modification de leur contenu n’ont été effectués pendant cette validation. Les parcours navigateur utilisent uniquement des personnages et réponses fictifs sur localhost.

| Périmètre | Résultat vérifié |
| --- | --- |
| Fiches concurrentes | Commandes serveur versionnées et idempotentes, fusion des champs compatibles, comparaison explicite des conflits, achats et annulations sans double débit/remboursement. |
| Achèvement de carrière | Seuil `5 × rang actuel` pour toutes les caractéristiques cumulées et huit compétences distinctes de carrière ; au moins un talent du rang actuel. Coût de changement calculé automatiquement. |
| Contributions publiques | Comptes joueurs existants, édition des contenus visibles et relations publiques, secrets MJ exclus, suppression/restauration des créations propres, historique et corbeille. |
| Référentiels MJ | Aliases explicites, aperçu d’impact, arbitrage des doublons, sauvegardes transactionnelles, descriptions locales prioritaires sur Google Sheets. |
| Mobile et visionneuse | Accès connecté depuis l’application mobile, fiche sans débordement horizontal à 390 px, aperçu du rang suivant et modale des carrières en lecture seule. |
| Reprise après fermeture | Brouillons ordinaires et corrections MJ conservés par compte/personnage/session ; récupération explicite, motif préservé, erreur de stockage locale signalée. |
| Purge des images | Reprise MJ après fermeture, rôle vérifié avant rejeu des reçus, références revérifiées par transaction, candidats isolés par tentative et résultats concurrents protégés par bail. |

## Contrôles automatisés

- `npm run check` : succès ; suites Functions **79/79**, fiche/catalogue/contributions **92/92**, suite générale **592/592**. Aucun échec ni test ignoré.
- `npm run lint` : succès.
- `git diff --check` : succès.
- `npm run test:j2-rules` : **5/5** sur Firestore Emulator, projet `demo-j2-contributions` ; comprend refus des écritures de contenu directes et écriture de courbure autorisée.
- `npm run test:j2-services` : **1/1** sur Firestore Emulator, projet `demo-j2-services` ; intégration réelle Admin SDK F1/R3/J2 et horodatages serveur.
- Le runner des règles refuse de démarrer lorsqu’une configuration ADC est présente. Les deux runners sont intégrés à un job CI dédié.

## Parcours navigateur

- Largeur de contenu égale à la largeur disponible (**375 px** dans un viewport de **390 px**) : aucun débordement horizontal.
- Relation publique : choix des PNJ par nom ; enregistrement du libellé et du style avec révision d’origine, révision réciproque et seules les valeurs modifiées.
- Import MJ : fichier JSON fictif, motif saisi dans la modale, confirmation serveur visible et nouvelle fiche affichée.
- Correction MJ : brouillon d’avance sauvegardé, page rechargée, récupération choisie explicitement ; avance et motif retrouvés sans commande réseau automatique.
- Visionneuse de carrière : modale lisible à largeur téléphone, choix de carrière et version adaptée accessibles en lecture seule.

La capture mobile est conservée hors du dépôt, dans `docs/evolutions-retour-xp-2026-10-04/recette/visionneuse-mobile.jpg` à la racine du workspace. Elle montre uniquement une recette fictive.

## Activation restante

Suivre [activation-finale.md](activation-finale.md) : Functions, index, règles, client puis migration contrôlée des fiches. L’autorisation précédente de lecture Firestore était limitée aux libellés de compétences et talents ; la lecture intégrale et la migration des cinq fiches demandent une extension explicite de ce périmètre.

Les coûts XP historiques restent conservés. Une fusion de compétences ambiguë demande une décision MJ ; aucune somme ni sélection automatique du maximum n’est appliquée.

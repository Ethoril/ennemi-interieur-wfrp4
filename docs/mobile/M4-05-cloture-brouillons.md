# M4-05 — Brouillons et conflits mobile

## Contrat livré

- Seuls les champs publics du formulaire sont conservés dans le stockage local versionné.
- Notes privées et portraits restent en mémoire de session et ne passent ni dans le brouillon, ni dans le cache applicatif.
- Les écritures MJ restent en ligne uniquement. Hors connexion, l’interface conserve le brouillon et annonce explicitement l’absence de synchronisation.
- Une divergence `updatedAt` public ou privé bloque l’écriture. Le MJ peut recharger, copier le texte public local ou forcer après une seconde confirmation.
- Un document absent n’est jamais recréé par une résolution de conflit.

## Recette différée

La recette Android physique doit couvrir la saisie, le réseau bridé, la fermeture pendant un enregistrement,
la restauration/expiration des brouillons, les conflits et les deux thèmes à 320–430 px.

La recette iOS est explicitement différée : vérifier ultérieurement le clavier, le retour système, le stockage
local après suspension et la purge privée à la fermeture. Aucun statut iOS validé ne doit être annoncé avant cette exécution.

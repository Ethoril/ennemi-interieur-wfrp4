# M1-04 — Recette intégrité PNJs

Cette recette valide les cascades Firestore, les relations et le cycle de vie des portraits.
Elle s’exécute avec le compte MJ dans l’émulateur avant toute ouverture mobile. Aucun scénario ne
supprime une donnée de production.

Le champ `suppressionEnCours` verrouille un PNJ pendant sa cascade. Un verrou global
`integrity_locks/pnj-deletion` est créé dans la même transaction : un second PNJ ne peut pas
démarrer une suppression tant que le premier n'est pas finalisé. Pendant ce verrou, les règles
refusent les créations et modifications ordinaires d'indices, y compris celles d'un ancien client.
Seule la mise à jour de cascade qui retire l'identifiant du PNJ verrouillé est autorisée. Le batch
final supprime ensemble `pnjs_prives` et le PNJ, mais conserve le verrou et ses `imagePaths` jusqu'à
la fin du nettoyage Storage. Le verrou n'est supprimé qu'après réussite de toutes les images ; une
reprise serveur reste donc possible même si le journal local est perdu.
Chaque nettoyage d'image pose aussi `integrity_locks/images/{collection}/{ownerId}`. Il interdit
uniquement les mutations d'image du propriétaire (les modifications textuelles restent possibles),
et est repris depuis Firestore au chargement MJ, même sans `localStorage`.

Les nouvelles relations utilisent un identifiant déterministe dérivé de tous leurs champs
significatifs. La transaction relit les deux endpoints et refuse les PNJs absents, marqués ou une
relation identique concurrente ; les deux sens d’une relation bidirectionnelle sont donc engagés
ensemble.

## Contrôles automatisés

- `npm run lint`
- `npm run check`
- `npm run test:m1-03-emulator` avec Java 21 et les deux émulateurs Firebase disponibles
- `npm run test:m1-04-emulator` avec Java 21 et Firestore Emulator disponible
  : verrou PNJ durable, recréation bloquée puis restaurée, verrou image et mutation texte.
- `npm run audit:m1-04-storage -- --project=demo-m1-04 --bucket=demo-m1-04.appspot.com` : inventaire
  administratif read-only des objets `portraits/` et `indices/` sans référence. En production,
  ajouter `--confirm-production=campagne-wrpg` et effectuer ce contrôle avec les mêmes gardes
  d’émulateur que l’inventaire M1-03. La commande n’a volontairement aucun mode suppression.
  Les chemins legacy plats sont volontairement refusés par le nettoyage automatique et restent
  signalés pour traitement par la migration opérateur M1-03.

Le test M1-04 vérifie la transaction bidirectionnelle, le refus d’une auto-relation, la
cascade indices/relations/`pnjs_prives`, le découpage sous 500 écritures, la journalisation de
reprise, le verrou global contre les écritures concurrentes d’indices, la comparaison canonique
des chemins Storage, les verrous image par propriétaire et la réconciliation des filtres.

## Scénarios manuels

1. Créer une relation bidirectionnelle entre deux PNJs, interrompre artificiellement l’écriture
   réseau, puis vérifier qu’aucun des deux sens n’est présent seul.
2. Tenter une relation d’un PNJ vers lui-même : l’interface doit refuser avant toute écriture.
3. Supprimer un PNJ lié à plusieurs relations et indices : l’impact doit être annoncé, les
   relations doivent disparaître et `indices.pnjsLies` ne doit plus contenir l’identifiant.
4. Rejouer une suppression avec plus de 498 écritures de cascade : les lots intermédiaires
   doivent progresser, et une panne doit laisser l’état local de reprise sans message de succès.
5. Remplacer un portrait partagé ou référencé par une URL legacy : l’ancien objet ne doit être
   supprimé que lorsqu’aucune référence canonique ne subsiste.
6. Supprimer un PNJ dont le portrait échoue côté Storage : Firestore peut être terminé, mais
   l’écran doit signaler explicitement le nettoyage à reprendre. Une reconnexion MJ doit relancer
   le recovery ; aucun faux succès silencieux n’est accepté.
7. Sous verrou de suppression, tenter de créer ou modifier un indice depuis un ancien client :
   l’écriture doit être refusée ; retirer l’identifiant verrouillé avec `arrayRemove` doit réussir.
8. Activer un filtre, retirer sa valeur lors d’un rechargement, puis vérifier que le filtre revient
   à « Tous » et que le compteur visible correspond à l’état réel.
9. Ouvrir rapidement deux PNJs avec latences différentes : les indices du premier ne doivent
   jamais apparaître dans le panneau du second.
10. Rejouer les scénarios en thème sombre et parchemin, à 375 px, avec la console navigateur vide.

## Limite connue

Les anciens clients dont le JavaScript est mis en cache bénéficient désormais du verrou Firestore
pour la course sur les indices ; ils ne connaissent toutefois pas le protocole de reprise local.
Le bump de clôture M1-05 reste requis avant une campagne de suppression depuis un appareil réel.

La recette iPhone reste différée, conformément à la décision du 19 août 2026. Android physique
est le prochain support d’appareil prévu.

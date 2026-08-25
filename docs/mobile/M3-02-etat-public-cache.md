# M3-02 — État public et cache hors ligne

## Portée livrée

L’application mobile dispose désormais d’un store public unique. Il assemble exclusivement les trois
flux autorisés aux joueurs : PNJs visibles, relations visibles et indices découverts. Les vues ne
contactent jamais Firebase directement et ne reçoivent aucune surface d’authentification, d’écriture ou
de données MJ.

Le client public M2 est initialisé avec la persistance Firestore avant la création des abonnements. Si
le navigateur refuse cette persistance (quota, navigation privée, API absente ou conflit entre onglets),
le client retombe explicitement sur un cache mémoire. Ce repli permet de continuer en ligne, mais il est
signalé dans Réglages et n’est jamais présenté comme un cache durable.

## États présentés au joueur

Chaque ressource conserve indépendamment son état `loading`, `ready`, `empty` ou `error`, ses données
normalisées et les métadonnées `fromCache` / `hasPendingWrites`. Une collection en erreur ne vide donc
pas les deux autres.

- `Synchronisé avec le serveur` n’apparaît que lorsque les trois flux ont fourni un snapshot serveur
  sans écriture en attente.
- `lastServerAt` n’avance jamais à partir de `navigator.onLine` ou d’un snapshot cache/pending. Sa
  dernière valeur confirmée est conservée pendant une perte de réseau.
- Un premier lancement hors ligne sans cache affiche une explication et un bouton **Réessayer**.
- Un lancement hors ligne avec cache garde les données consultables et les marque comme enregistrées.
- Une permission refusée est distinguée d’une indisponibilité technique.
- Quand un PNJ est dépublié, le store retire immédiatement les relations qui le référencent, avant même
  l’émission suivante du dépôt Relations.

Les écrans PNJ liste et détail s’abonnent au store et libèrent leur abonnement à chaque démontage. Le
cycle `pagehide` / `pageshow` du cache de navigation ferme puis recrée l’ensemble de la composition :
aucun listener ou callback d’une génération précédente ne peut réécrire le nouvel écran.

## Préférences persistées

La clé versionnée `wfrp-mobile-preferences-v1` contient uniquement :

- le thème `dark` ou `parchment` ;
- la dernière section (`pnjs`, `enquetes` ou `reglages`) ;
- la recherche et les filtres publics bornés.

La lecture est fail-closed face à un JSON invalide ou à une autre version. L’écriture ignore les champs
inconnus et tolère un refus de quota. Aucun document Firestore, texte privé, jeton, URL signée ou URL
objet n’est stocké dans `localStorage`.

## Diagnostic sans donnée personnelle

`session.inspect()` expose seulement la génération, le mode de cache, l’état de connexion et, pour
chaque ressource, un statut, un nombre d’éléments, les métadonnées de synchronisation et une catégorie
d’erreur. Il ne retourne ni contenu de document, ni URL, ni secret.

## Validation locale

Le test comportemental `tools/m3-02-public-store.test.mjs` couvre les transitions cache/serveur,
l’immuabilité profonde, les scénarios hors ligne, l’isolation des erreurs, la dépublication, les courses
de démarrage/arrêt, le rollback d’abonnements, trois cycles complets, le bfcache, la composition publique
injectable et les préférences hostiles.

La recette Android réelle (premier lancement en ligne, second lancement hors ligne et retour réseau)
reste à exécuter avec le lot de recette mobile. iOS demeure explicitement différé.

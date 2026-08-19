# M1-02 — Règles et index Firestore

Le dépôt versionne `firestore.rules` et `firestore.indexes.json`. Les lectures publiques doivent
toujours porter le filtre correspondant (`visibleJoueurs == true` ou `decouvert == true`) ; une
règle Firestore ne transforme pas une requête non filtrée en liste filtrée.

Après l'exécution et le contrôle de M1-01, lancer obligatoirement le préflight en lecture seule.
Il parcourt `pnjs`, `relations`, `indices` et `pnjs_prives`, sans journaliser de valeur de note :

```text
npm run preflight:m1-02 -- --project=demo-m1-02 --bucket=demo-m1-02.appspot.com
```

Le préflight doit être vert avant toute préparation d'index ou de règles. Pour une lecture de
production, la confirmation explicite `--confirm-production=campagne-wrpg` est requise ;
`--execute` est toujours refusé.

Un filtre de visibilité seul utilise l'index mono-champ automatique de Firestore. Le seul index
composite versionné est celui de `pnjsLies` (array) + `decouvert`. `ordre` reste facultatif et les
tris stables restent côté client jusqu'à une évolution du schéma qui le rend obligatoire.

Les règles interdisent d'écrire une relation publique si l'un de ses PNJs est absent ou masqué.
M1-02 livre déjà la cascade côté bureau : lors du masquage d'un PNJ, les relations publiques
incidentes sont révoquées dans le même batch que le PNJ et la note privée. La limite Firestore de
500 écritures bloque l'opération avant commit avec un message explicite ; aucune moitié de
transition n'est annoncée comme enregistrée. M1-04 réutilisera et généralisera cette cascade pour
les autres interfaces et transitions.

Les règles ne peuvent pas prouver une jointure dynamique entre chaque relation et ses deux PNJs
dans une requête de liste : les accès `get/exists` sont bornés et l'évaluation d'une liste peut
échouer dès que plusieurs relations sont candidates. Une relation legacy publique vers un PNJ
masqué reste donc un signal bloquant du préflight, pas une promesse de filtrage de lecture. La
solution pratique livrée ici est : seuls les writers de l'application créent/modifient les
relations, le cascadeur révoque les liens lors du masquage, et le préflight/audit doit être vert
avant activation. Les règles ne protègent pas contre un bypass Admin/console. Bloquer toutes les
listes serait une régression fonctionnelle ; une Cloud Function ou une projection publique serait
hors de l'architecture et de la maintenance de M1-02.

Les Rules valident `pnjsLies` comme liste et limitent sa taille, mais le langage Rules ne permet
pas de vérifier uniformément le type de chaque élément arbitraire. Le MJ reste donc la seule
source d'écriture de cette liste ; le préflight vérifie chaque ID comme chaîne bornée et sa
référence. La validation complète côté dépôt sera renforcée dans M2.

## Recette locale

Utiliser uniquement un projet `demo-*` et les émulateurs locaux :

```text
npm run lint
npm run check
npm run test:m1-02-emulator
```

Le runner refuse `campagne-wrpg`, vérifie la présence de l'émulateur avant toute initialisation
de client et n'initialise jamais Firebase Admin sur une cible réelle.

## Déploiement contrôlé

Après vérification de la migration M1-01 et d'une sauvegarde M0 hors dépôt, depuis un terminal
Firebase explicitement connecté au projet attendu :

```text
firebase deploy --only firestore:indexes --project campagne-wrpg
# attendre l'état READY des index dans la console Firebase
firebase deploy --only firestore:rules --project campagne-wrpg
```

L'ordre est volontaire : les index sont prêts avant l'activation des règles. Tester ensuite une
lecture visiteur (PNJ/relation public et indice découvert), une lecture directe masquée et une
lecture/écriture MJ vérifié.

## Retour arrière

En cas de refus inattendu, conserver les index et déployer une règle d'urgence fail-closed
(collections sensibles en lecture MJ uniquement), puis retester visiteur et MJ. La règle
pré-M1-02 qui rendait PNJs et relations publics n'est acceptable en retour arrière que si aucun
document masqué ou privé n'existe encore ; dès qu'une migration a créé ces données, la restaurer
rouvrirait une fuite. La migration M1-01 est réversible séparément par la sauvegarde M0 ; elle ne
doit pas être annulée par une restauration manuelle de documents en production.

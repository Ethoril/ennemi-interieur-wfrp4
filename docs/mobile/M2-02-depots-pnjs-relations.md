# M2-02 — dépôts PNJs et relations

Les modules `js/data/pnjs-repository.js` et `js/data/relations-repository.js` sont une couche
sans DOM, sans singleton Firebase et sans décision d'authentification. Chaque fabrique reçoit
explicitement `{ sdk, client }`, ce qui permet d'injecter les clients bureau, public et MJ et de
tester la couche avec des doubles.

## Séparation public / MJ

Le dépôt public expose uniquement les lectures publiques. Il ne possède ni abonnement privé ni
méthode de mutation. Sa requête PNJs porte `visibleJoueurs == true`, puis la normalisation
réapplique un filtrage fail-closed sur `visibleJoueurs` et `suppressionEnCours`. Une relation
publique est également rejetée si l'un de ses deux endpoints n'est pas dans l'ensemble de PNJs
visibles fourni par l'écran appelant.

Le dépôt MJ expose les lectures complètes, le document privé et les mutations. Les mutations
valident une whitelist bornée, utilisent des timestamps serveur et, lorsqu'un
`expectedUpdatedAt` est fourni, le vérifient dans la transaction.

## Abonnements

Chaque abonnement retourne une fonction de désabonnement idempotente. Aucun callback n'est émis
après désabonnement. Les listes sont normalisées puis triées par `ordre`, nom replié Unicode
(NFKD, sans marques, minuscule) et identifiant ; les relations le sont par type puis identifiant.
Une émission identique est dédupliquée, mais une modification de `fromCache` ou
`hasPendingWrites` est conservée. `subscribeOne` émet aussi `null` pour un document absent ou
devenu non visible, et les documents privés suivent la même déduplication.

## Relations bidirectionnelles

L'identifiant est dérivé de la relation normalisée par `relationId`. Une création bidirectionnelle
lit les deux PNJs et les deux identifiants avant d'écrire dans une transaction unique. Les
doublons exacts, les auto-relations, les endpoints absents ou marqués pour suppression sont
refusés. Une modification re-clé le document dans une transaction sûre : l'ancien document, la
destination et les endpoints sont lus avant suppression/écriture, et une destination existante
provoque un conflit. Une paire n'est re-clée que lorsqu'un `reciprocalId` explicite est fourni et
que le miroir inverse est prouvé dans la même transaction. La suppression d'une paire suit la
même preuve ; un identifiant fourni par l'appelant n'est jamais cru seul.

## Masquage et suppression PNJ

Le passage d'un PNJ à `visibleJoueurs == false` révoque les relations publiques dans des
sous-transactions bornées à 8 relations. Cette limite conservatrice tient compte de la limite de
20 appels documentaires des règles Firestore (`get`/`getAfter`) par transaction ou batch. La
première sous-transaction applique le PNJ, le privé et le premier sous-lot ; les suivantes ne
touchent qu'aux relations et vérifient que le PNJ est toujours masqué. Une relecture de
stabilisation et un plafond global évitent les boucles infinies. Si une course laisse encore une
relation publique ou republie le PNJ, la mutation échoue en conflit afin qu'une reprise puisse
terminer la révocation.

La suppression conserve le protocole M1-04 : verrou global Firestore, marqueur
`suppressionEnCours`, passes de cascade bornées (les indices utilisent `arrayRemove`), relecture
finale, suppression atomique du document public et du privé, puis nettoyage image injecté. Le
verrou n'est supprimé qu'après le nettoyage Storage. En cas de panne, les méthodes `remove` et
`resumeRemoval` lèvent une erreur normalisée avec un état structuré :

```js
{
  firestoreDone: boolean,
  imageCleanupPending: boolean,
  lockRetained: boolean,
  imagePaths: string[],
  legacyImageSkipped: boolean
}
```

La reprise relit le verrou Firestore ; elle ne dépend donc pas d'un journal local ou d'un PNJ
encore cliquable. Un service image doit être injecté lorsqu'un portrait protégé existe : son
absence ou son échec n'est jamais présenté comme un succès. Un ancien chemin externe, corrompu ou
`imageUrl` legacy est conservé sans jamais être renvoyé : `legacyImageSkipped` vaut `true` dans
les états concernés et dans le verrou M1-04. Le booléen durable permet à l'écran de signaler le
portrait legacy sans exposer son URL ou son chemin.
Le remplacement d'un portrait (nettoyage de l'ancien fichier après le commit du nouveau) reste
délibérément dans le service images de M2-03 ; ce dépôt ne prétend pas l'avoir réalisé.

## Limites et suite

Les dépôts ne modifient pas les pages existantes, les règles, la version applicative ou le cache.
M2-03 branchera le service images réel ; M2-04/M2-05 adapteront les écrans et le precache après
validation de cette couche.

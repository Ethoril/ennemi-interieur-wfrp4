# M2-01 — Clients Firebase et normalisation

La couche M2-01 prépare les futurs écrans mobiles sans modifier les écrans bureau PNJs et
Enquêtes. La configuration publique est dans `js/firebase-config.js`, tandis que
`js/firebase-init.js` conserve ses exports historiques (`app`, `auth`, `db`, `storage`,
`functions`, `appCheck`).

Les fabriques de `js/data/firebase-clients.js` reçoivent un SDK injecté, ce qui permet aux tests
et aux futurs écrans d’utiliser des doubles sans singleton caché :

- `createBureauClient` enveloppe les services déjà initialisés ;
- `createPublicMobileClient` utilise l’application nommée `mobile-public`, Storage en lecture et
  `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` ; un probe réseau est
  effectué avant d’annoncer le mode persistant et, en cas d’échec, l’application est recréée avec
  `memoryLocalCache()` et `cache.mode` vaut `memory-fallback`. Auth n’est jamais initialisé.
- `createMjMobileClient` utilise `mobile-mj`, Auth, `memoryLocalCache()` et Storage, puis déconnecte
  Auth lors de `close()`.

Les listeners créés par `client.listen(...)` sont suivis et tous supprimés par `close()`. Les
applications mobiles terminent Firestore puis suppriment leur application nommée lorsque le dernier
client la libère ; pour le client MJ, `signOut` intervient également uniquement à ce dernier handle.
Une fermeture en cours est enregistrée par couple SDK/nom d’application : une recréation attend sa
fin et ne peut pas réutiliser l’application ou la base en terminaison. Le nettoyage tente toujours
`deleteApp`, même si `signOut` ou `terminate` échoue, puis expose une erreur stable. Le client bureau
historique n’est pas fermé par ce mécanisme. Les deux applications nommées sont idempotentes et
refusent une configuration différente sous le même nom.

Lorsqu’une préparation échoue avant qu’un handle soit rendu, une fabrique ne supprime que
l’application qu’elle a créée elle-même ; une application déjà fournie par un autre propriétaire
reste intacte. Un handle réussi est en revanche responsable de son application mobile et la ferme
au dernier `close()`. Une suppression impossible conserve un état bloquant afin d’éviter toute
réutilisation ambiguë. Les clients de fallback exposent uniquement un état sérialisable (`mode`,
`persistent`, `fallback`, `reason`) ; la cause technique reste portée par l’erreur normalisée et
n’est pas recopiée dans le cache UI.

Le client MJ et le fallback public exigent les API modernes `initializeFirestore` et
`memoryLocalCache`; ils échouent avec une erreur stable si un cache mémoire explicite n’est pas
disponible. Aucun `getFirestore` implicite ne peut donc transformer un fallback en cache persistant.

Les fonctions de `js/data/firebase-normalizers.js` sont pures et fail-closed : visibilité absente
ou atypique, PNJ marqué `suppressionEnCours`, références d’image invalides, identifiants falsifiés et
timestamps non comparables produisent des valeurs sûres et des `issues`, sans permettre au champ `id`
des données de remplacer l’identifiant du snapshot.

`js/firebase-config.js` est précaché avec `firebase-init.js`, car ce dernier l’importe au démarrage
du site et doit rester utilisable hors ligne. Les modules préparatoires `js/data/*` ne sont pas encore
précachés : ils ne sont consommés par aucun écran livré et seront ajoutés avec le shell mobile lors de
M2-05, après validation de son graphe d’imports.

`js/data/firebase-errors.js` fournit les catégories stables `permission`, `offline`, `not-found`,
`conflict`, `validation` et `unknown`. L’erreur technique reste dans `cause` pour les logs ou les
tests, mais le message exposé à l’interface est toujours générique.

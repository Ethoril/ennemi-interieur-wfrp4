# M2-04 — intégration bureau des dépôts temps réel

Les pages `pnjs.html` et `enquetes.html` composent désormais leur client dans
`js/bureau-data.js`. Le module reçoit le client Firebase bureau historique et
construit les dépôts publics ou MJ selon l'identité courante : PNJs, relations,
indices et images. Les pages ne chargent plus directement les modules CDN
Firestore/Storage.

## Cycle de vie

Chaque changement d'utilisateur ou de rôle invalide la génération de lecture,
désabonne les listes et la note privée, révoque les URLs objet puis ferme le
client bureau précédent avant de construire le suivant. `pagehide` applique le
même nettoyage. Un callback tardif est ignoré par la génération de page/panneau.

## Abonnements et UI

Les listes PNJs/relations/indices utilisent les abonnements des dépôts. Les
filtres, la recherche, la sélection du graphe et le panneau restent des états
de présentation ; une émission distante reconstruit les données sans les
autoriser à réinitialiser ces états. Un PNJ qui devient masqué ou disparaît
ferme le panneau et la modale concernée avec un message explicite. La fermeture
d'un indice édité suit le même principe.

Les relations reçues portent `reciprocalId` uniquement lorsqu'un miroir inverse
unique et strictement identique sur tous les champs métier est présent. Une
relation inverse partielle reste donc une relation simple. Les actions de
mutation recapturent la session, le rôle, le panneau et le dépôt après chaque
confirmation ou attente.

La lecture ponctuelle des indices liés au panneau possède son propre
unsubscribe et son jeton de génération : elle est annulée à l'ouverture d'un
autre panneau, à la fermeture, au changement d'identité et au `pagehide`.

## Mutations et images

Les mutations normales bureau passent par les dépôts MJ. Les images sont
chargées via le dépôt d'images, avec handles et `release()` conservés en mémoire
jusqu'au prochain rendu ou changement de session. Une sauvegarde PNJ/indice
compense un upload si le commit Firestore échoue ; les suppressions et reprises
restent celles des dépôts M2-02/M2-03 et de leurs verrous durables.

Tout flux PNJ muni d'un fichier passe par `images.replace`, y compris une
création sans ancien portrait. Un commit Firestore confirmé avec nettoyage
Storage en attente est affiché comme enregistré et propose la reprise ; un
commit incertain est affiché comme état à réconcilier, sans exposer de chemin.

Les fonctions de reprise administratives sont composées dans
`js/bureau-data.js` et délèguent aux dépôts et aux verrous serveur. Les pages ne
réimportent donc ni Firestore, ni Storage, ni le journal de protection.

Les nouveaux modules de composition et de dépôt ne sont pas ajoutés au
précache dans ce lot : le prochain lot de publication devra les inclure avec
le bump de cache. Cela évite de prétendre qu'une ancienne installation du
Service Worker sait servir cette version avant sa clôture de release.

Lors d'un `pagehide`, les abonnements sont arrêtés, les URLs objet révoquées,
les modales fermées et les notes privées/formulaires MJ vidés avant le snapshot
bfcache. Les recherches, filtres et positions de lecture restent des états de
présentation et sont reconstruits au `pageshow`.

## Vérifications

- `npm run lint`
- `node --test tools/m2-04-bureau.test.mjs`
- `npm run check`
- recette manuelle dans deux fenêtres : création, masquage, relation, indice,
  déconnexion et reconnexion ; deux thèmes et largeur 375 px.

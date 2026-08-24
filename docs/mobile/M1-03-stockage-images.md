# M1-03 — Stockage d’images protégé

## Pré-requis et garde

Le préflight M1-02 puis une sauvegarde M0 complète sont obligatoires avant toute exécution. La
migration M1-03 est `tools/migrations/m1-03-storage.mjs` et reste en lecture seule tant que
`--execute` n’est pas fourni. Les cibles de production exigent le projet et bucket exacts, la
confirmation `--confirm-production=campagne-wrpg` et un manifeste M0 complet situé hors dépôt.
Le runner émulateur refuse production avant toute initialisation Firebase.

La commande d’inventaire ne logue que des comptes et des signaux (`orphelin`, propriétaire absent,
collision ou références multiples) ; elle n’affiche aucune URL complète, valeur de document ou
contenu d’image. Le fichier d’état `--state` hors dépôt permet la reprise après interruption.

## Ordre des phases

```text
inventory (dry-run) → copy-verify → reference → cleanup (confirmation distincte)
```

`copy-verify` crée `portraits/{pnjId}/{fileName}` ou `indices/{indiceId}/{fileName}` sans supprimer
la source, puis vérifie taille, MIME raster et `md5Hash`. `reference` écrit seulement `imagePath`
après cette vérification. `cleanup` est une commande ultérieure qui exige
`--confirm-cleanup=<projet>` et ne supprime une source qu’après relecture de la référence.
Les collisions, doublons et propriétaires absents bloquent l’exécution concernée. Le deuxième
passage réutilise les cibles existantes et l’état de reprise, sans nouveau doublon.
L’état conserve uniquement les chemins, identités média et empreintes SHA-256 des valeurs brutes
de référence : une représentation URL différente, même canoniquement équivalente, doit donc
relancer la phase de référence depuis un nouvel état.

Il n’existe pas d’atomicité inter-services Storage/Firestore : un upload suivi d’un refus Firestore
est compensé par suppression du nouvel objet côté client. Dès que le backend répond, le navigateur
inscrit aussi le chemin dans un journal `localStorage`; il ne l’acquitte qu’après le commit ou une
suppression confirmée. Au prochain passage MJ, une reprise différée vérifie d’abord la référence
Firestore puis supprime uniquement l’objet resté orphelin. L’identifiant d’opération dérive du
SHA-256 du contenu afin qu’une nouvelle tentative avec la même image réutilise la même cible.
L’outil de migration signale en complément les objets non référencés. Une référence n’est jamais
écrite avant la copie vérifiée.

Les nouveaux uploads passent par la callable v2 `uploadProtectedImage` (`functions/`, région
`europe-west1`) : le navigateur ne téléverse plus directement dans Storage et ne reçoit jamais
d’URL persistante. La function vérifie l’identité MJ vérifiée, la taille, le MIME et la signature,
impose le chemin déterministe et utilise une création conditionnelle idempotente. Elle exige aussi
désormais un jeton App Check valide (`enforceAppCheck: true`). Le client initialise
`ReCaptchaEnterpriseProvider` très tôt sur l’origine de production `ethoril.github.io`, avec
renouvellement automatique. La configuration opérateur attendue est un TTL de 1 heure et un
seuil de score de 0,5 ; aucune enforcement App Check globale n’est requise, seule cette callable
est protégée. La clé reCAPTCHA Enterprise est une clé publique ; aucun jeton de debug n’est
enregistré dans le dépôt. La restriction de domaine de la clé doit rester limitée à
`ethoril.github.io` : `localhost` et les adresses de développement ne doivent pas être ajoutés à
la clé de production.

Sur `localhost`, `127.0.0.1` et les autres origines de développement, App Check n’est volontairement
pas initialisé : cela permet d’utiliser les émulateurs sans introduire de jeton de debug. Un client
de développement qui pointe par erreur vers la callable de production est donc refusé par le
serveur, ce qui évite de transformer le mode local en contournement de sécurité.

État opérateur déployé et revérifié le 24 août 2026 : provider reCAPTCHA Enterprise enregistré,
domaine unique `ethoril.github.io`, TTL d’une heure, seuil de score `0,5`, plan Blaze actif, IAM
Storage↔Firestore limité au compte technique Firebase Storage et aucune enforcement App Check
globale. Le client `v2.16.0` a été publié avant la callable ; `uploadProtectedImage`, les règles
Firestore et les règles Storage ont ensuite été déployées dans cet ordre. Une requête sans jeton et
une requête avec un faux jeton App Check sont refusées en `401`, tandis que le client de production
obtient ses données et ses images protégées sans erreur App Check. Un upload MJ réel a ensuite créé
un PNJ privé temporaire et son portrait protégé ; leur suppression a ramené l’inventaire à ses
3 références initiales et aux 2 seuls orphelins volontairement conservés.
Si la callable détecte des métadonnées non conformes et que sa suppression compensatoire échoue,
elle émet l’événement structuré `protected-image-cleanup-required` dans Cloud Logging avec le seul
chemin et le code d’erreur. Ce signal et l’inventaire M1-03 constituent la reprise opérateur.

Exemple local (le fichier d’état doit rester hors dépôt) :

Ces commandes doivent être lancées avec `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` et
`STORAGE_EMULATOR_HOST=127.0.0.1:9199` (ou `FIREBASE_STORAGE_EMULATOR_HOST`) ; même un dry-run
hors production est refusé si l’un des deux émulateurs manque.

```text
node tools/migrations/m1-03-storage.mjs inventory --project=demo-m1-03 --bucket=demo-m1-03.appspot.com
node tools/migrations/m1-03-storage.mjs copy-verify --project=demo-m1-03 --bucket=demo-m1-03.appspot.com --execute --state=C:\temp\m1-03.json
node tools/migrations/m1-03-storage.mjs reference --project=demo-m1-03 --bucket=demo-m1-03.appspot.com --execute --state=C:\temp\m1-03.json
node tools/migrations/m1-03-storage.mjs cleanup --project=demo-m1-03 --bucket=demo-m1-03.appspot.com --execute --confirm-cleanup=demo-m1-03 --state=C:\temp\m1-03.json
```

Pour production, ajouter le manifeste M0 hors dépôt (`--backup-manifest=...`) et
`--confirm-production=campagne-wrpg` à chaque phase ; cleanup conserve sa confirmation distincte.

## CORS et affichage

`getBlob()` nécessite la configuration versionnée [`storage.cors.json`](../../storage.cors.json).
Le contrôle local, sans appel réseau, se lance avec
`npm run preflight:m1-03-cors -- --project=demo-m1-03 --bucket=demo-m1-03.appspot.com`.
Le contrôle read-only du bucket via le SDK Admin se lance avec `node tools/migrations/m1-03-cors-preflight.mjs inspect --project=demo-m1-03 --bucket=demo-m1-03.appspot.com`;
il exige les deux émulateurs hors production ou la confirmation explicite en production. L’application
guardée (jamais exécutée ici) est :

```text
node tools/migrations/m1-03-cors-preflight.mjs apply --project=campagne-wrpg --bucket=campagne-wrpg.firebasestorage.app --execute --confirm-production=campagne-wrpg --confirm-cors=campagne-wrpg
```

L’inspection read-only confirme que la CORS production est conforme à la configuration versionnée.
Les règles Storage et la callable ont été déployées le 24 août 2026. Pour un
rollback, restaurer l’export CORS préalable avec l’outil opérateur Google Cloud, puis réinspecter ;
ce script n’applique volontairement que la configuration canonique du dépôt.

Les écrans chargent `imagePath` via le SDK Storage (`getBlob`), fabriquent une URL objet mémoire et
la révoquent lors d’un rechargement/changement de vue. Dès qu’un `imagePath` existe, toute erreur
(`permission-denied`, absence ou réseau) laisse l’image absente : il n’y a jamais de repli URL. Le
fallback URL legacy ne sert que lorsque `imagePath` est absent. Le cleanup production a été
explicitement confirmé et exécuté le 24 août 2026 : les trois sources référencées ont été supprimées
après vérification de leur copie protégée et de leur référence Firestore. Les deux objets orphelins
connus n’ont pas été supprimés et restent signalés dans l’inventaire opérateur.
`getDownloadURL()` est interdit côté client : Firebase peut recréer un token lorsqu’il n’en existe
plus un et réintroduire une URL contournant les règles. Le client utilise exclusivement `getBlob()`
et des URL objet mémoire révoquées.

Le Service Worker exclut les endpoints Storage des stratégies Cache Storage et, à son activation,
purge aussi toute réponse Storage héritée dans le cache courant. Le module App Check fait partie du
précache local. Le bump global M1-05 aligne désormais `APP_VERSION` et `CACHE_NAME` sur `v2.16.0` ;
la version cliente et les règles Firebase correspondantes sont publiées.
Les objets créés ou migrés portent également `Cache-Control: no-store`, afin que le cache HTTP du
navigateur ne conserve pas un blob après un passage public → secret.

## Règles et rollback applicatif

Le contrôle Firebase/Google Cloud du 24 août 2026 confirme que l’intégration des règles Storage
avec Firestore (accès `firestore.get/exists`, service account/IAM requis par Firebase) est active
pour le projet. Les règles versionnées ont été compilées puis déployées le même jour.

Déployer le nouveau client (qui écrit `imagePath`) avant la restriction Firestore qui interdit la
création ou la modification d’un `imageUrl` legacy. Sur remplacement explicite depuis l’interface,
le client supprime l’ancien `imagePath` ou objet legacy seulement après le commit Firestore; un
échec laisse un avertissement et un chemin à reprendre. La suppression d’une fiche entière et de
son image reste planifiée pour M1-04.

Les chemins déterministes sont lisibles par le MJ vérifié ou par un visiteur si le document
propriétaire est public (`visibleJoueurs` pour un PNJ, `decouvert` pour un indice). Le MJ non vérifié,
les propriétaires absents et les documents masqués sont refusés. Les créations et remplacements
acceptent seulement les raster JPEG/PNG/WebP/GIF/AVIF, dans les limites 2 MiB (portrait) et 5 MiB
(indice), et suppression/écriture sont MJ vérifié seulement. Les chemins plats legacy ne sont pas
écrits par l’application; leurs tokens historiques doivent être supprimés lors du cleanup. Les
uploads directs Web sont interdits : le backend crée les objets sans token exploitable et vérifie
les metadata avant de répondre. Les règles refusent toute création ou mise à jour Storage directe,
même au MJ ; seules les suppressions compensatoires restent autorisées au MJ vérifié.

En cas de rollback avant cleanup, conserver `imageUrl` et les sources. En cas de rollback après
création d’un chemin protégé, revenir à un repli MJ-only testé plutôt qu’à une règle publique :
restaurer une ancienne règle publique n’est acceptable que si aucun contenu masqué n’a jamais été
créé. Ne supprimer ni champ ni objet sans manifeste et confirmation séparée.

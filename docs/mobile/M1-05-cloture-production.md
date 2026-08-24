# M1-05 — Journal de clôture production

Date d’exécution : 24 août 2026. Projet : `campagne-wrpg`. Bucket :
`campagne-wrpg.firebasestorage.app`.

## Résultat

Le socle de sécurité M1 est déployé. Le client `v2.16.0` a été publié sur `master` avant tout
durcissement serveur, puis la callable d’upload, les règles Firestore et les règles Storage ont été
activées. La lecture publique des onglets PNJs et Enquêtes reste fonctionnelle après migration.

La clôture fonctionnelle MJ conserve deux vérifications manuelles : un upload authentifié réel et
la purge visuelle des données privées après déconnexion. Elles doivent être exécutées avec le compte
MJ avant de déclarer la recette utilisateur entièrement terminée. La recette Android physique reste
le jalon appareil ; la recette iPhone est différée faute d’appareil disponible.

## Sauvegarde et migration

La sauvegarde complète préalable est stockée hors dépôt dans
`E:\Projet Warhammer Ennemi Intérieur\backups\ennemi-interieur\M1-05-preprod-20260824-083344`.
Son manifeste est complet : 6 documents Firestore, 5 objets Storage et 9 empreintes SHA-256
validées. Une restauration dans des émulateurs isolés a réussi avant la migration.

- M1-01 : 6 documents préparés lors du premier passage ; le second passage ne propose aucune
  modification, aucun conflit et aucune erreur.
- M1-02 : préflight vert sur 6 documents ; l’index `pnjsLies + decouvert` a atteint l’état `READY`
  avant le déploiement des règles.
- M1-03 : 3 images copiées, vérifiées et référencées sous leur propriétaire. Les 3 anciennes sources
  référencées ont ensuite été supprimées. Elles sont restaurables depuis la sauvegarde.
- Inventaire final : 3 références protégées, aucune source legacy référencée restante et exactement
  2 objets orphelins connus. Ces deux objets sont conservés volontairement et ne doivent pas être
  supprimés sans nouvelle autorisation explicite.

Le fichier d’état de reprise reste hors dépôt dans
`E:\Projet Warhammer Ennemi Intérieur\backups\ennemi-interieur\M1-05-state-20260824-083344`.

## Configuration et déploiements

- GitHub Pages sert `v2.16.0`, `js/app-check.js`, l’initialisation App Check et le Service Worker
  `wfrp-cache-v2.16.0`.
- reCAPTCHA Enterprise est limité à `ethoril.github.io`, avec TTL d’une heure et seuil `0,5`.
- App Check n’est pas imposé globalement : seule `uploadProtectedImage` utilise
  `enforceAppCheck: true`.
- Le rôle Firestore requis par les règles Storage est attribué au seul compte technique Firebase
  Storage. La CORS du bucket correspond à `storage.cors.json`.
- `uploadProtectedImage` est active en `europe-west1`. Les images de build Cloud Functions âgées de
  plus de 7 jours sont purgées automatiquement ; cette politique ne concerne aucun média du site.
- Les règles Firestore et Storage versionnées dans le dépôt ont compilé et ont été publiées.

Le runtime Node.js 20 de la fonction reste opérationnel mais doit être migré avant sa date de
retrait annoncée au 30 octobre 2026. Ce suivi ne remet pas en cause le déploiement courant.

## Preuves de recette

- Tests locaux : lint vert, suite complète 108/108, tests Functions 7/7, aucun test ignoré au moment
  du déploiement de la callable.
- Émulateurs : restauration de sauvegarde validée ; matrices M1-01 à M1-04 vertes, dont la suite
  d’intégrité M1-04 2/2.
- App Check : requête sans jeton refusée en `401`; faux jeton refusé en `401`; chargement du client
  de production sans erreur App Check. Le test positif callable avec session MJ reste à consigner.
- Production visiteur : 3 PNJ chargés, images protégées accessibles, aucun message « Image protégée
  inaccessible » et aucune erreur console. Enquêtes charge correctement et affiche l’état vide prévu.
- Après cleanup Storage : les 3 PNJ et leurs portraits protégés restent accessibles sans erreur.

## Retour arrière

Ne jamais rétablir une règle publique permissive si des données masquées existent. En cas d’incident,
publier d’abord une règle d’urgence fail-closed, conserver les index, puis diagnostiquer. Les données
et médias antérieurs sont disponibles dans la sauvegarde ci-dessus ; toute restauration doit être
validée dans un émulateur vide avant une intervention production. La restauration M1-05 fournie par
l’outillage reste volontairement interdite vers un projet de production.

## Actions de clôture restantes

- [ ] Connexion MJ sur le site public, upload protégé avec une image de test contrôlée, puis contrôle
  qu’une requête valide atteint la validation métier sans objet orphelin.
- [ ] Déconnexion MJ et vérification que notes, états administratifs et blobs privés disparaissent.
- [ ] Rotation du mot de passe d’application SMTP qui a pu apparaître dans un journal opérateur, puis
  vérification de l’extension d’envoi sans exposer la nouvelle valeur.
- [ ] Recette Android physique ; recette iPhone explicitement différée.
- [x] Deux portraits orphelins conservés sans suppression.

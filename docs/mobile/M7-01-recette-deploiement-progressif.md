# M7-01 — Recette globale et déploiement non annoncé

Date de préparation : 25 août 2026.

## État du candidat

- Version mobile actuellement publiée : commit `4e695f2` — `v2.22.1`.
- Correctif local non publié : `v2.22.2`, reprise réseau publique renforcée après erreur persistante.
- Candidat caché précédent : commit `3386741` — `v2.21.8`.
- Référence précédente : commit `5dc077b` — `v2.21.6` ; référence historique antérieure :
  commit `f9f4a71` — `v2.21.5`.
- Référence de synchronisation antérieure : commit `58fe964` — `v2.21.4`.
- Le candidat publié utilise la popup Google au premier geste et conserve la CSP exacte requise par
  Firebase Auth (`https://apis.google.com` dans `script-src`).
- Version témoin antérieure : commit `387d1cf` — `v2.21.2` ; le commit documentaire `5376782` est inclus
  dans le déploiement actuel.
- La publication `v2.21.6` absorbe les marqueurs de redirection laissés par `v2.21.5` sans boucle.
- Le déploiement M7-01 conserve `start_url: ./index.html`. Le candidat M7-02 fait désormais évoluer
  ce démarrage vers `./app/index.html` et ajoute les liens publics après le constat Android.
- La préparation locale n'avait lancé aucun déploiement. Le push de `712417f` a ensuite été autorisé
  explicitement et les workflows GitHub Pages et validation se sont terminés avec succès. La
  sauvegarde de production en lecture seule décrite ci-dessous a également reçu une autorisation
  distincte.

Le rapport ne confond pas la publication avec sa validation fonctionnelle complète. Le chemin de
succès Auth Android est confirmé ; les preuves Android complètes restent à produire séparément.
L’inspection du cache réel a été exécutée, le correctif `v2.21.7` publié, puis le cache recontrôlé.

Le contrôle HTTPS historique du 25 août 2026 confirme que `/app/` servait la coque `v2.21.4` sous le
sous-chemin GitHub Pages attendu. La page historique publique affichait également `v2.21.4`, ne contenait aucun
lien vers `/app/`, et le manifeste publié conserve `id` et `start_url` à `./index.html` avec le scope
`./`. Le profil navigateur de contrôle avait initialement le worker `v2.21.2` en attente ; le bouton
du bandeau a activé `v2.21.3` en un cycle, le bandeau a disparu et les diagnostics interface/worker
se sont alignés.

Sur l'appareil Android du propriétaire, le passage `v2.21.1` vers le témoin `v2.21.2` par le bouton
du bandeau a été confirmé : une seule activation/recharge, disparition du bandeau et diagnostics de
version alignés. Cette preuve ne vaut pas validation de la matrice Android complète.

Après la publication historique de `v2.21.4`, le propriétaire a confirmé sur Android l'affichage attendu puis
le statut « Synchronisé avec le serveur ». Le message « Données enregistrées — synchronisation en
attente » ne reste donc plus bloqué après la confirmation serveur. Cette preuve est limitée au
hotfix de métadonnées et ne vaut pas validation de la matrice Android complète.

Le commit autorisé `5dc077b` a publié `v2.21.6` avec succès. Un contrôle HTTPS a confirmé
l’interface et le worker `v2.21.6`. Sur Android, le premier geste « Connexion Google » a ouvert la
popup et le retour a établi une session MJ active. L’annulation, le retry, la restauration de route
et les autres scénarios Android restent ouverts.

L’inspection réelle de Chrome a compté 123 entrées dans `wfrp-cache-v2.21.6`. Aucun document
Firestore, token, URL Storage, portrait ou donnée privée n’y figurait. Un script reCAPTCHA servi
par `www.gstatic.com/recaptcha/...` était toutefois présent alors que l’Auth et App Check doivent
rester hors Cache Storage. `v2.21.7` étend la garde protégée à ce chemin, migre vers un cache neuf
et ajoute un scénario de purge. Après publication de `d42e1cd` et activation volontaire, Chrome
affiche interface et worker `v2.21.7`, un seul cache de 122 entrées, aucune ressource protégée et
aucune réponse opaque.

Le retour arrière d’interface a été éprouvé hors production dans une copie de travail détachée sur
`5dc077b` / `v2.21.6` : les 26 tests PWA/M7 de cette référence passent. La copie temporaire a été
supprimée après contrôle ; aucun push, déploiement ou accès Firebase n’a eu lieu pendant ce test.

## Sauvegarde M7-01 vérifiée

La sauvegarde datée a été créée hors dépôt dans
`E:\Sauvegardes\ennemi-interieur\M7-01-2026-08-25`. L'opération a uniquement lu Firestore et
téléchargé les objets Storage ; aucune écriture, migration, restauration ou suppression n'a été
effectuée sur Firebase production.

- manifeste `complete: true`, projet `campagne-wrpg` et bucket
  `campagne-wrpg.firebasestorage.app` ;
- 6 documents Firestore : 3 PNJ, 3 relations, aucun document privé et aucun indice ;
- 5 objets Storage, 1 787 576 octets, empreintes et tailles identiques aux sauvegardes de référence ;
- 3 portraits référencés sous leurs chemins protégés, aucune référence cassée et exactement les
  2 portraits orphelins connus, conservés sans suppression ;
- inventaire agrégé sans valeur de campagne écrit dans le dossier de sauvegarde ;
- restauration et comparaison réussies dans des émulateurs Firestore et Storage vides, cible
  `demo-mobile` / `demo-mobile.appspot.com`.

Le passage vers `v2.21.7` ne modifie aucune donnée Firestore ou Storage : cette sauvegarde reste
la sauvegarde de référence valide pour le candidat, sans nouvelle lecture ni écriture de production.

La comparaison avec M0-01 et M1-05 confirme les mêmes volumes et contenus binaires. La différence
attendue est le déplacement des trois portraits référencés vers leurs chemins protégés owner-scoped,
effectué lors de M1 ; les deux objets orphelins historiques restent inchangés.

## Contrôles locaux exécutables

Le test `tools/m7-01-release.test.mjs` couvre localement :

- le correctif `v2.22.2` dans `js/layout.js`, `sw.js`, la méta mobile et CHANGELOG, distinct de
  `4e695f2` / `v2.22.1`, de l’activation `f1d0fdc` / `v2.22.0` et de la référence `d42e1cd` / `v2.21.7` ;
- la distinction avec la référence `712417f` / `v2.21.3` et le témoin `387d1cf` / `v2.21.2` ;
- le cache dérivé, le manifeste unique et le maintien du `start_url` historique ;
- le graphe local de `/app/`, la syntaxe des modules et les ressources précachées ;
- l’absence d’annonce `/app/` dans les pages bureau et le manifeste ;
- la présence de cette procédure et de ses états non validés.

Commandes à exécuter avant toute nouvelle publication : `npm run lint`, `npm run test:m7-01`,
`npm run check` et `git diff --check`. Aucun résultat de ces commandes ne constitue une recette
Android, Auth, Cache Storage ou règles de production.

Les quatre runners de règles M1-01 à M1-04 ont également terminé avec un code de sortie nul dans
des émulateurs isolés le 25 août 2026 ; M1-04 annonce 2/2 scénarios réussis. Cette preuve ne vaut ni
inspection ni publication des règles ou index de production.

## Matrice de recette — état honnête

| Contrôle | Statut M7-01 | Preuve attendue |
|---|---|---|
| Sauvegarde Firestore/Storage datée hors dépôt | **OK** | Manifeste complet, inventaire et restauration émulateur réussie |
| Pages bureau visiteur/MJ | **Non exécuté dans ce lot** | Parcours PNJs/Enquêtes et console sans erreur |
| `/app/` réel sous le sous-chemin HTTPS | **OK** | Coque, interface et worker `v2.21.7` contrôlés ; racine historique et manifeste inchangés |
| Android physique | **Partiel** | Mise à jour, confirmation serveur et succès Auth popup vérifiés ; autres scénarios à faire |
| iOS physique | **Différé** | Appareil disponible et matrice M6-03 |
| Auth Google en mode installé | **Partiel** | Popup primaire et session MJ active confirmées en `v2.21.6` ; annulation, retry, retour route et ancien redirect restent à tester |
| Inspection réelle Cache Storage | **OK** | `wfrp-cache-v2.21.7`, 122 entrées, aucune ressource protégée, réponse opaque ou donnée de campagne |
| Règles et index production | **Partiel** | Quatre runners émulateur verts ; état déployé à contrôler |
| Bêta MJ/joueur | **Non exécutée** | Retour expurgé, sans donnée de campagne |
| Rollback hors production | **OK local** | Copie détachée `5dc077b` / `v2.21.6`, 26/26 tests PWA/M7, copie supprimée sans déploiement |

## Procédure de déploiement silencieux à autoriser

1. `f1d0fdc` / `v2.22.0` a activé le démarrage mobile puis `4e695f2` / `v2.22.1` a supprimé le
   doublon visuel de statut. `v2.22.2` corrige localement la reprise de synchronisation Android et
   requiert une autorisation de push distincte.
2. Produire une sauvegarde Firestore/Storage hors dépôt, comparer son inventaire à M0-01 et tester
   sa restauration dans des émulateurs isolés.
3. Exécuter les gates locaux puis les règles/index sur émulateurs ; ne publier aucune règle sans
   vérifier la compatibilité avec les documents existants.
4. Publier le candidat par le flux GitHub Pages autorisé, sans modifier `start_url`, manifeste,
   navigation bureau ou liens de découverte.
5. Vérifier l’URL `/app/` réelle sous son sous-chemin, puis exécuter la matrice Android. iOS reste
   différé et doit être indiqué explicitement.
6. Partager l’URL uniquement avec le MJ et un testeur choisi si cette bêta est autorisée. Ne relever
   que l’appareil, le navigateur, l’étape, le résultat et la sévérité ; aucune donnée de campagne.

## Retour arrière séparé

### Interface et Service Worker

Pour un défaut limité à la coque ou à l’interface :

1. arrêter la bêta et retirer toute URL partagée ;
2. republier le commit interface antérieur validé (par exemple `490c59d`, `v2.21.1`) via le flux
   normal, sans réécriture d’historique ;
3. conserver `start_url` et `id` historiques ;
4. laisser le Service Worker précédent activer son cache versionné et vérifier qu’un worker déjà
   installé reçoit bien la nouvelle coque ;
5. ne supprimer aucune donnée Firestore/Storage pour un problème d’interface.

### Règles et index

Les règles et index ne sont pas restaurés avec l’interface par automatisme. Comparer d’abord les
fichiers versionnés et le schéma réellement utilisé ; ne revenir à une version serveur que si elle
reste compatible avec les documents actuels. Une règle d’urgence doit rester fail-closed et être
testée dans les émulateurs avant toute publication.

### Données Firestore et Storage

Une restauration de données est réservée à une perte ou corruption confirmée. Elle exige un
diagnostic, une sauvegarde datée vérifiée hors dépôt, une restauration d’essai dans un émulateur et
une autorisation distincte. Ne jamais restaurer une sauvegarde pour un simple défaut PWA, Auth ou
Service Worker ; ne jamais supprimer les objets orphelins sans inventaire et autorisation.

## Critères de sortie

- [x] Activation publiée `f1d0fdc` / `v2.22.0`, correctif publié `4e695f2` / `v2.22.1`, correctif
  local `v2.22.2`, référence précédente
  `d42e1cd` / `v2.21.7` et témoin `387d1cf` / `v2.21.2` distingués honnêtement ; succès Auth
  Android confirmé.
- [x] M7-01 a conservé l’ancien démarrage ; la bascule et la découverte sont isolées dans M7-02.
- [x] Procédure de rollback interface/SW, règles/index et données séparée.
- [x] Contrôles locaux automatisables ajoutés.
- [x] Backup daté, comparaison aux références et restauration émulateur.
- [ ] Matrice bureau/mobile/sécurité réelle.
- [ ] Matrice Android physique complète ; succès Auth installé déjà confirmé.
- [x] Inspection Cache Storage réelle : 122 entrées, aucune ressource protégée ou opaque après
  activation de `v2.21.7`.
- [ ] Bêta contrôlée ; rollback hors production validé localement.
- [ ] Validation iOS : différée.

M7-02 ne doit commencer qu’après levée explicite des blocages et validation du candidat sans anomalie
bloquante ou majeure.

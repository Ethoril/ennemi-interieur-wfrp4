# M7-01 — Recette globale et déploiement non annoncé

Date de préparation : 25 août 2026.

## État du candidat

- Version actuellement déployée de référence : commit `387d1cf` — `v2.21.2`.
- Nouveau candidat local : `v2.21.3`, non poussé et non déployé ; il contient le titre document
  contextualisé et change donc la coque précachée.
- Documentation locale actuelle : `5376782`, non poussée au moment de cette préparation.
- `start_url` reste `./index.html` ; aucun lien public ni entrée de navigation n’annonce `/app/`.
- La préparation locale n'a lancé aucun déploiement. La sauvegarde de production en lecture seule
  décrite ci-dessous a ensuite été exécutée avec l'autorisation explicite du propriétaire.

Le rapport ne confond pas l’existence du candidat avec sa validation fonctionnelle complète. Les
preuves Android complètes, Auth installée et cache réel restent à produire séparément.

Le contrôle HTTPS du 25 août 2026 confirme que `/app/` sert la coque déployée `v2.21.2` sous le sous-chemin
GitHub Pages attendu. La page historique publique affiche également `v2.21.2`, ne contient aucun
lien vers `/app/`, et le manifeste publié conserve `id` et `start_url` à `./index.html` avec le scope
`./`. Le profil navigateur de contrôle avait encore le worker précédent en attente de mise à jour,
comportement prévu par l'activation volontaire.

Sur l'appareil Android du propriétaire, le passage `v2.21.1` vers le témoin `v2.21.2` par le bouton
du bandeau a été confirmé : une seule activation/recharge, disparition du bandeau et diagnostics de
version alignés. Cette preuve ne vaut pas validation de la matrice Android complète.

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

Le bump local vers `v2.21.3` ne modifie aucune donnée Firestore ou Storage : cette sauvegarde reste
la sauvegarde de référence valide pour le candidat, sans nouvelle lecture ni écriture de production.

La comparaison avec M0-01 et M1-05 confirme les mêmes volumes et contenus binaires. La différence
attendue est le déplacement des trois portraits référencés vers leurs chemins protégés owner-scoped,
effectué lors de M1 ; les deux objets orphelins historiques restent inchangés.

## Contrôles locaux exécutables

Le test `tools/m7-01-release.test.mjs` couvre localement :

- la version candidate locale `v2.21.3` dans `js/layout.js`, `sw.js`, la méta mobile et CHANGELOG ;
- la distinction avec la version déployée `387d1cf` / `v2.21.2` ;
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
| `/app/` réel sous le sous-chemin HTTPS | **OK** | Coque déployée v2.21.2, racine historique et manifeste contrôlés |
| Android physique | **Partiel** | Mise à jour v2.21.1 → v2.21.2 validée ; autres scénarios à faire |
| iOS physique | **Différé** | Appareil disponible et matrice M6-03 |
| Auth Google en mode installé | **Non exécuté** | Redirection, retour route et session |
| Inspection réelle Cache Storage | **Non exécutée** | Absence de données protégées/opaques |
| Règles et index production | **Partiel** | Quatre runners émulateur verts ; état déployé à contrôler |
| Bêta MJ/joueur | **Non exécutée** | Retour expurgé, sans donnée de campagne |
| Rollback hors production | **Procédure préparée, test non exécuté** | Prévisualisation et ancien worker actif |

## Procédure de déploiement silencieux à autoriser

1. Geler le candidat local `v2.21.3` et vérifier qu’aucun changement non lié n’est mélangé ; le
   déploiement de référence reste `387d1cf` / `v2.21.2` tant qu'une autorisation spécifique n'est pas
   donnée.
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

- [x] Version déployée `387d1cf` / `v2.21.2` et candidat local `v2.21.3` distingués honnêtement.
- [x] `start_url` et absence d’annonce publique conservés.
- [x] Procédure de rollback interface/SW, règles/index et données séparée.
- [x] Contrôles locaux automatisables ajoutés.
- [x] Backup daté, comparaison aux références et restauration émulateur.
- [ ] Matrice bureau/mobile/sécurité réelle.
- [ ] Android physique et Auth installée.
- [ ] Inspection Cache Storage réelle.
- [ ] Bêta contrôlée et rollback hors production.
- [ ] Validation iOS : différée.

M7-02 ne doit commencer qu’après levée explicite des blocages et validation du candidat sans anomalie
bloquante ou majeure.

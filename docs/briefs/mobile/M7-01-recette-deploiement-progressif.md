# M7-01 — Recette globale et déploiement non annoncé

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et tous les briefs de clôture M1 à M6.

| | |
|---|---|
| Lot | M7 — Mise en production |
| Objectif | Tester la version exacte de production sans encore changer le point d'entrée public |
| Estimation | 2 jours |
| Fichiers | documentation de recette/déploiement, correctifs bloquants strictement ciblés |
| Dépend de | M6-03 |

## Stratégie de déploiement

La migration est additive et la nouvelle application existe déjà sous `/app/`, mais aucun lien ni
`start_url` ne l'annonce. Déployer d'abord cette version silencieuse sur GitHub Pages permet de tester
le vrai HTTPS, le sous-chemin, Firebase Auth et le service worker avant d'orienter les joueurs vers elle.

## À faire

### 1. Geler le candidat

Identifier le commit candidat et interdire les changements non liés pendant la recette. Exécuter tous
les contrôles : lint, syntaxe, smoke tests, existence du précache, tests unitaires, règles Firestore et
Storage. Vérifier versions et changelog, mais ne pas incrémenter une nouvelle version ici sans correctif.

Créer une nouvelle sauvegarde Firestore/Storage hors dépôt et comparer ses comptes à M0-01. Confirmer
que migrations et contrôles d'orphelins sont idempotents.

### 2. Vérifier la compatibilité complète

Matrice à exécuter avant déploiement :

- pages bureau PNJs et Enquêtes, visiteur et MJ ;
- `/app/` joueur, MJ, en ligne, réseau lent et hors ligne ;
- deux thèmes, petits/grands téléphones, portrait/paysage ;
- navigation croisée PNJs ↔ Enquêtes ;
- création, modification concurrente, publication et suppression ;
- images publiques/privées et inspection des caches ;
- ancien navigateur raisonnablement supporté avec repli explicite.

### 3. Déployer sans annoncer

Déployer le candidat selon le flux GitHub Pages actuel, sans nouveau système d'hébergement. Conserver
le manifeste avec l'identité stabilisée et l'ancien `start_url`. Ne pas ajouter de lien dans la
navigation principale, de bannière publique ni de consigne aux joueurs.

Après propagation, vérifier directement l'URL réelle `/app/` sur Android physique, puis sur iPhone dès
qu'un appareil devient disponible. Tant que ce second test est différé, l'indiquer dans le rapport.
Tester les imports, CSP, redirection Google, scope du worker, chemins d'icônes et règles du projet de
production. Ne pas se contenter du serveur local ou d'une preview à la racine.

### 4. Faire une bêta contrôlée

Partager l'URL uniquement avec le MJ et, si décidé, un joueur testeur informé. Ne collecter que des
retours fonctionnels sans donnée personnelle : appareil/navigateur, étape, résultat attendu/obtenu,
capture expurgée et sévérité. Tester au moins une session réelle de consultation sans effectuer une
expérience risquée sur les données de campagne.

### 5. Qualifier les anomalies

- **Bloquant** : fuite, perte de données, Auth impossible, installation/lancement impossible — rollback.
- **Majeur** : action principale inutilisable sur une plateforme — corriger et reprendre la matrice.
- **Mineur** : gêne sans perte/contournement simple — documenter pour itération suivante.

Tout correctif changeant code/cache crée un nouveau candidat, aligne la version selon les conventions
et refait au moins la recette ciblée plus le smoke test global.

### 6. Préparer le retour arrière

Documenter le commit antérieur, les commandes de redéploiement, les règles/index correspondants et ce
qui ne doit pas être restauré aveuglément. Comme les données sont communes, distinguer clairement :

- rollback de l'interface/service worker, généralement sûr ;
- rollback des règles, seulement si compatible avec le schéma actuel ;
- restauration de données, uniquement après diagnostic de perte/corruption.

Tester le retour à l'ancienne coque sur un environnement de prévisualisation et vérifier qu'un worker
déjà installé se met à jour au lieu de rester bloqué.

## Checklist de sortie

- [ ] Commit candidat et sauvegarde datée identifiés.
- [ ] Toutes les suites automatiques sont vertes.
- [ ] Matrice bureau/mobile/sécurité exécutée.
- [ ] `/app/` réel testé sur Android ; iPhone testé ou explicitement marqué différé.
- [ ] Auth redirection et service worker fonctionnent sous le sous-chemin réel.
- [ ] Aucune donnée privée en cache persistant.
- [ ] Bêta contrôlée sans anomalie bloquante ou majeure.
- [ ] Retour arrière testé et documenté.
- [ ] Manifeste et navigation publique encore non basculés.

## Critères d'acceptation

La version exacte disponible en production est validée dans des conditions réelles, sans avoir encore
modifié l'expérience des utilisateurs existants. M7-02 peut activer la découverte avec un rollback prêt.

## Commit

`docs(release): valider le deploiement mobile non annonce (M7-01)`

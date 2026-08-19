# Baseline M0-01 — PNJs et Enquêtes

> Référence locale préparée le 19 août 2026. Ce document ne contient aucune donnée Firebase
> réelle, aucun export et aucun identifiant de joueur.

## Point de départ

- Commit de référence du dépôt : `f00c58a` (`chore(dev): ajouter l’outillage Firebase de test`).
- Version affichée par `js/layout.js` et `sw.js` : `v2.15.0`.
- Branche de référence : `master`.
- Projet Firebase de production confirmé : `campagne-wrpg` ; l'état exact du déploiement Hosting
  reste à confirmer séparément. Ce sous-lot a effectué une sauvegarde en lecture seule après
  autorisation explicite, sans aucune écriture Firebase de production.

## Contrôles reproductibles

Depuis la racine du projet :

```text
npm ci
npm run lint
npm run check
npm run test:mobile
node --check tools/mobile-fixture.mjs
node --check tools/mobile-fixture.test.mjs
```

`npm run check` exécute le smoke test historique, le validateur du fixture et ses tests négatifs.
`npm run test:mobile` rejoue uniquement les tests Node du jeu fictif M0-01 dans
`tools/fixtures/mobile-baseline.json`.

## Sauvegarde et restauration contrôlées

`tools/mobile-backup.mjs` ne se connecte à aucun service sans `--execute`. Le projet et le bucket
doivent toujours être fournis explicitement, le chemin de sortie doit être absolu et hors dépôt,
et un dossier existant n'est jamais écrasé. Pour la production, la confirmation exacte
`--confirm-production=campagne-wrpg` est obligatoire. Une sauvegarde réelle a été exécutée le
19 août 2026 après autorisation explicite : 6 documents Firestore et 5 objets Storage.

Exemple de préparation sans connexion :

```text
node tools/mobile-backup.mjs backup --project=demo-mobile --bucket=demo-mobile.appspot.com --out="C:\chemin\hors-depot\M0-01"
```

Le mode restauration exige les variables d'émulateur Firestore et Storage. Hors émulateur, deux
gardes supplémentaires sont nécessaires (`--allow-non-emulator-restore` et
`--confirm-restore=ID`) ; la production reste interdite. Les fichiers Storage sont copiés avec
leurs métadonnées utiles et leurs empreintes SHA-256, sans token de téléchargement.

Le test complet, volontairement exclu de `npm run check`, se lance avec :

```text
npm run test:mobile-emulator
```

Il injecte le fixture dans les émulateurs, exporte vers un dossier temporaire hors dépôt, vide les
collections et objets de test, restaure puis vérifie les comptes, identifiants, références et
fichiers. L'intégration Emulator Suite a réussi le 19 août 2026 avec Temurin 21.0.12 : 15
documents et 9 fichiers ont été exportés, vidés puis restaurés. La restauration est additive :
elle écrit les documents et objets présents dans le backup, sans supprimer les données absentes
du backup.

Un dossier de backup partiel (manifest absent ou `complete: false`) ne doit jamais être repris :
l'isoler ou le supprimer hors dépôt, puis relancer l'export dans un nouveau dossier.

## Résultat production agrégé

L'inventaire de la sauvegarde locale est disponible dans
[`M0-01-inventaire-production.md`](M0-01-inventaire-production.md). Il recense uniquement les
comptes, champs, types, absences, anomalies de références et agrégats Storage. La sauvegarde
source reste hors dépôt ; son chemin local n'est pas versionné.

La restauration/validation d'un backup arbitraire se rejoue uniquement dans les émulateurs avec :

```text
npm run test:mobile-backup-restore -- --input="CHEMIN_ABSOLU_HORS_DEPOT" --project=demo-mobile --bucket=demo-mobile.appspot.com
```

Le test vérifie les comptes, identifiants, structures de données, types Storage et tailles sans
afficher les contenus. La cible `campagne-wrpg` est rejetée par le lanceur et par l'outil de
restauration. Ce contrôle a réussi le 19 août 2026 sur la sauvegarde de production (6 documents et
5 fichiers, dont 3 portraits référencés et 2 objets orphelins). La restauration de test est additive ; le nettoyage préalable du runner ne concerne
que les émulateurs.

Les exports Firebase de production doivent être déposés dans un dossier explicitement choisi
**hors du dépôt**, par exemple `../backups/ennemi-interieur/M0-01/`. L'export M0-01 respecte cette
règle ; son chemin exact a été communiqué au mainteneur mais n'est pas versionné. Son manifeste et
chaque fichier ont été contrôlés, puis la sauvegarde a été restaurée avec succès dans les
émulateurs Firestore et Storage.

## Jeu de test fictif

Le fixture est déterministe et ne contient que des identifiants `fixture-*` :

| Cas | Couverture |
|---|---|
| PNJs | 4 `visibleJoueurs`, 1 masqué, 1 visible sans portrait |
| Notes | collection `pnjs_prives` séparée, documents `{id: pnjId, notes}` ; aucun champ privé dans `pnjs` |
| Relations | `source`/`cible` + `visibleJoueurs`, relation simple, paire miroir, référence cassée volontaire |
| Indices | 2 découverts, 1 secret, 1 lié à plusieurs PNJs via `pnjsLies` |
| Storage | chaque portrait sous `portraits/{pnjId}/{file}`, chaque indice sous `indices/{indiceId}/{file}`, protection cohérente et un orphelin |
| Échappement | accents, apostrophes, `<`, `>` et texte fictif privé |

Le validateur vérifie également les cardinalités et les références sans afficher le contenu des
champs. Il ne se connecte à aucun service.

## Recette de référence manuelle

Cette matrice décrit les contrôles à rejouer avant une migration. Les opérations d'écriture doivent
se faire uniquement avec le fixture dans un émulateur ou un projet de test explicitement choisi.

| Parcours | Bureau sombre | Bureau parchemin | Android | iOS |
|---|---:|---:|---:|---:|
| Ouvrir PNJs en visiteur | OK | OK | simulé OK | différé |
| Rechercher et filtrer un PNJ | recherche OK | recherche OK | recherche OK ; filtres à faire | différé |
| Ouvrir une fiche PNJ et revenir à la liste | à faire | à faire | à faire | différé |
| Ouvrir Enquêtes et un indice découvert | à faire | à faire | à faire | différé |
| Vérifier qu'un indice secret n'est pas visible visiteur | à faire | à faire | à faire | différé |
| Connexion MJ et création/modification/suppression de test | à faire | à faire | à faire | différé |
| Ajouter puis relire une relation | à faire | à faire | à faire | différé |
| Déconnexion et disparition des contenus MJ | à faire | à faire | à faire | différé |
| Largeurs 375, 390, 430 px | sans objet | sans objet | graphe OK ; tableau en défaut | différé |

À chaque passage, noter les erreurs console, requêtes refusées, états de chargement et anomalies
déjà présentes sans les corriger dans M0-01. Le jalon appareil est Android ; la validation iPhone
reste explicitement différée jusqu'à disponibilité d'un appareil.

### Résultats de référence du 19 août 2026

- Visiteur : PNJs et Enquêtes s'ouvrent sans erreur console ; les thèmes sombre et parchemin sont
  corrects à 1440 px.
- PNJs : le graphe ne provoque pas d'overflow global aux largeurs 375, 390 et 430 px ; une
  recherche sans résultat renvoie bien un état vide.
- Enquêtes : aucune erreur ni overflow à 375 px ; l'état vide est cohérent avec la production
  (aucun indice visible).
- Défaut préexistant — vue Tableau PNJs : largeur d'environ 633 px et overflow horizontal du body
  (environ 661 px) aux largeurs clientes 360, 375 et 415 px.
- Défaut préexistant — viewport 1280 px : le bouton de thème se place vers x=1331, hors écran et
  la fin de la navigation est tronquée ; à 1440 px le bouton fonctionne.
- Les parcours MJ de création, modification et suppression n'ont pas été exécutés : M0 interdit
  toute écriture de production. iOS reste différé.

## Garde-fous du dépôt

`.gitignore` exclut uniquement l'état et les journaux de l'émulateur Firebase. Il n'exclut pas un
répertoire d'exports : la règle est de conserver ces exports hors du dossier du dépôt, afin de ne
pas les rendre récupérables par inadvertance dans l'historique Git.

Avant toute opération Firebase réelle, le mainteneur doit fournir une cible de test ou autoriser
explicitement une sauvegarde de production. Cette autorisation n'est pas implicite dans M0-01.

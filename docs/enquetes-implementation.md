# Documents et enquêtes — réalisation V2

Version livrée : **2.34.0**, basée sur la proposition V2 et ses contrats de réalisation (section 17).
La livraison intègre la fiche bureau **2.33.0**, publiée pendant le développement (commit 82d37d3), sans remplacer ses modules.

## Fonctionnement

L’entrée Enquêtes ouvre un espace commun au bureau et au mobile :

- **Enquêtes** : dossiers ouverts, en pause, résolus ou archivés ; description, pièces, personnes, notes personnelles, relations, chronologie et graphe.
- **Documents** : bibliothèque de pièces du MJ et de contributions des joueurs ; texte, catégories, provenance, étiquettes, fichiers et liens vers plusieurs affaires ou PNJ.
- **Mon carnet** : notes privées, brouillons et liens personnels. Les autres joueurs et le MJ ne peuvent pas les lire.
- **Corbeille** : retrait réversible, restauration et conservation pendant trente jours avant purge.

Les documents acceptent JPEG, PNG, WebP, PDF et texte UTF-8. Limites : 10 Mo par fichier, dix fichiers par document, 100 000 caractères de texte. Les images importées par le navigateur sont réduites à 2 560 pixels et accompagnées d’une miniature. Les annotations portent sur une version précise d’image ; les PDF restent consultables sans annotation.

Les enquêtes appartiennent au MJ. Un joueur peut proposer un document commun, gérer sa contribution et prendre des notes privées. La publication d’une annotation personnelle passe par une copie explicitement partagée. Les objets personnels n’acquièrent pas l’audience d’une affaire simplement parce qu’ils y sont liés.

L’export ZIP contient les objets accessibles, un manifeste de relations, la chronologie et les fichiers courants. L’ajout de contenu privé au paquet est un choix explicite de l’utilisateur.

## Implantation

- Domaine validé côté serveur : `functions/src/enquetes/domain.mjs`. Copie cliente générée par `tools/sync-enquetes-domain.mjs`.
- Services : `functions/src/enquetes/service.mjs`, handlers App Check, commandes avec révision et identifiant d’opération.
- Client Firebase : `js/enquetes-runtime.js`.
- Vue commune : `js/enquetes-workspace.js` ; entrée bureau : `js/enquetes-workspace-bureau.js`.
- Intégration mobile : routes Enquêtes de `js/mobile/app.js`, accès depuis les PNJ ; intégration bureau depuis `js/pnjs.js`.
- D3 et JSZip : versions figées, assemblées localement et précachées ; licences dans `js/vendor/enquetes-LICENSES.txt`.

Les anciens modules restent présents pour les routes historiques et les tests de compatibilité ; la nouvelle composition ne les utilise plus comme espace Enquêtes.

## Stockage et confidentialité

Les collections `enq_commun/data`, `enq_mj/data` et `enq_users/{uid}` séparent les audiences. Le registre contient les identités, révisions et références, et les fichiers disposent d’autorisations distinctes. Les règles refusent l’écriture directe des objets communs, y compris au MJ : ces mutations passent par les fonctions contrôlées.

`enq_accounts/{uid}` est créé par le service pour un membre identifié de la campagne. Un ancien membre inscrit conserve son carnet ; un compte Google extérieur ne peut ni s’inscrire lui-même, ni créer un carnet, ni téléverser un fichier.

Le carnet utilise des transactions liant note, registre et reçu d’opération. Les erreurs et conflits gardent le brouillon ; une modification faite pendant une sauvegarde conserve la version saisie ensuite. Les brouillons sont associés au compte et ne sont pas affichés après un changement de compte.

Les changements de visibilité et retraits passent par une cascade durable : barrière globale, plan, curseur et bail exclusif de travail. Les audiences des relations et des fichiers suivent celle de leurs références. Les annotations privées restent privées. Les fonctions historiques de PNJ participent à cette barrière lorsqu’elles modifient les accès.

Les fichiers vont d’abord dans une zone temporaire appartenant à l’utilisateur. Le serveur vérifie taille et signature, puis copie dans un emplacement protégé sans jeton public de téléchargement. Les versions restent disponibles selon les annotations autorisées. Les fichiers temporaires et les fichiers finalisés jamais attachés sont nettoyés après vingt-quatre heures.

Le MJ conserve les données sensibles en mémoire. Le cache persistant des joueurs est effacé à la déconnexion. Un poste partagé doit utiliser la déconnexion avant changement d’utilisateur.

## Exploitation et bascule

La mise à disposition fonctionnelle est unique. Les déploiements techniques de Firebase et GitHub Pages sont successifs ; le drapeau d’activation est modifié seulement après les contrôles.

Ordre appliqué :

1. Partir du dernier `origin/master` dans un worktree isolé ; copier uniquement les changements Enquêtes.
2. Sauvegarder les données et fichiers, chiffrer l’archive AES-256-GCM avec une clé protégée par DPAPI Windows, puis relire et vérifier son intégrité.
3. Effectuer l’import à blanc, traiter toute anomalie, puis appliquer l’import rejouable.
4. Déployer les fonctions, règles et index Firebase.
5. Publier la version statique et attendre la fin effective du job GitHub Pages.
6. Activer `campagne/acces.enqEnabled` et `enq_control/public` dans une transaction.
7. Vérifier les services, la version publique et l’entrée bureau/mobile.

Commandes de l’opérateur, exécutées depuis la livraison isolée :

```powershell
node tools/enquetes-prod-backup.mjs --project campagne-wrpg --confirm-production --out-dir "F:\Sauvegardes WRPG\enquetes-v2"
node tools/enquetes-import.mjs --project campagne-wrpg --confirm-production --report "F:\Sauvegardes WRPG\enquetes-v2\import-dry.json"
node tools/enquetes-import.mjs --project campagne-wrpg --confirm-production --apply --report "F:\Sauvegardes WRPG\enquetes-v2\import-apply.json"
node node_modules/firebase-tools/lib/bin/firebase.js deploy --project campagne-wrpg --only functions,firestore:rules,firestore:indexes,storage --non-interactive
node tools/enquetes-activation.mjs --project campagne-wrpg --confirm-production --apply
```

La production utilise la session Firebase CLI du compte MJ vérifié ; aucun jeton ni fichier ADC n’est écrit dans le dépôt. Les outils de tests refusent les identifiants et cibles de production.

L’import ne modifie pas les indices sources. Il attribue des identités déterministes, crée une correspondance pour les anciennes routes, copie uniquement les images appartenant au bon emplacement et signale les PNJ absents. L’activation vérifie que tous les indices ont une correspondance active.

Le travail de maintenance `maintainEnqueteContent`, toutes les cinq minutes, reprend les cascades interrompues, purge les corbeilles expirées et nettoie les temporaires. Les travaux terminés effacent leur contenu de commande : les plans ne gardent que les métadonnées nécessaires. L’index `enq_jobs(status, payloadCleaned)` est livré avec les règles.

## Sauvegarde, restauration et retour

Sauvegarde préalable du 6 octobre 2026 : **87 documents et 4 fichiers**, archive chiffrée de 3 248 629 octets, relue et validée :

`F:\Sauvegardes WRPG\enquetes-v2\enquetes-1791301860194.dpapi.json`

SHA-256 de l’archive :
`44807a2ce2bd78265d3fbad842f9d2e638c0c2fd326c80dbd54881a2868af201`

L’archive couvre les collections de campagne, PNJ, indices, contributions et Enquêtes, y compris les sous-collections sans document parent, ainsi que les fichiers documents, indices et portraits. Elle n’est lisible qu’avec le profil Windows de l’opérateur qui l’a créée. Conserver aussi les moyens de récupération de ce profil.

La restauration automatisée de `tools/lib/enquetes-recovery.mjs` est limitée à un projet **demo** avec les deux émulateurs locaux et une destination vide. Le test vérifie documents, notes privées, curseurs de travaux et octets Storage après restauration. Une restauration en production doit être une intervention distincte et ciblée ; l’outil ne peut pas écraser les données réelles.

Pour revenir temporairement à l’ancien espace :

```powershell
node tools/enquetes-activation.mjs --project campagne-wrpg --confirm-production --disable --apply
```

Puis republier une composition statique compatible avec l’ancien espace, en conservant les données Enquêtes et les évolutions indépendantes de la fiche. Désactiver seul le drapeau ne transforme pas la nouvelle interface en ancienne interface. Ne pas supprimer les nouvelles collections et ne pas restaurer intégralement l’archive sur des données ayant évolué depuis la bascule.

## Preuves et limites

- `npm run check` : domaine synchronisé, tests serveur, tests de la vue, fiches, catalogue, PNJ, compatibilité mobile, service worker et cohérence de livraison.
- `npm run test:enquetes:emulator` : **22 tests réussis**, règles Firestore/Storage, transactions réelles, accès privés, rejet d’un compte extérieur, fichiers, cascades, reprise, purge et restauration.
- Lint des nouveaux modules et outils réussi.
- Recette navigateur locale avec données fictives : dossier, liens, note personnelle sauvegardée, Markdown, graphe et disposition à 390 pixels de largeur.
- Import de production à blanc : **0 indice à convertir, 0 existant, 0 anomalie**. Les sources restent intactes.

La vérification mobile est une émulation de largeur dans un navigateur, sans essai sur un téléphone physique. La recette locale utilise des données fictives et ne démontre pas à elle seule un parcours authentifié réel avec App Check ; les contrôles effectués après publication sont consignés ci-dessous.

## Résultat de production

Mise en production achevée le **6 octobre 2026**, version **2.34.0**.

- Livraison fonctionnelle : commit `5045b7a`, suivi de la correction limitée du verrouillage npm `535a28b`.
- Firebase : déploiement terminé ; les cinq fonctions Enquêtes sont `ACTIVE` en `europe-west1`.
- Index `status / payloadCleaned` : `READY`.
- Cloud Scheduler : `ENABLED`, toutes les cinq minutes, fuseau `Europe/Paris`.
- CI corrigée : [Validate data — réussite](https://github.com/Ethoril/ennemi-interieur-wfrp4/actions/runs/37492192159).
- Publication : [GitHub Pages — job deploy terminé avec succès](https://github.com/Ethoril/ennemi-interieur-wfrp4/actions/runs/37492191045).
- Contrôle global local : **973 exécutions de tests réussies**, réparties en 9 tests de vue, 99 tests serveur, 269 tests fiche/catalogue/contributions et 596 tests transversaux.
- Recette Enquêtes sur émulateurs : **22 tests réussis**.
- Import appliqué : aucun indice présent, aucune anomalie.
- Activation relue sur la base réelle : session MJ active, protocole 1, maintenance désactivée ; les deux marqueurs d’activation concordent.
- Appel HTTPS sans authentification/App Check : refus HTTP 401.
- Contrôle HTTP public : version 2.34.0 concordante dans le layout, le service worker et la méta mobile.
- Contrôle navigateur public : nouvelle entrée Documents et enquêtes et version 2.34.0 affichées, connexion demandée avant lecture.

Le navigateur de vérification ne dispose pas d’une session Google de campagne : le parcours complet connecté avec App Check en production n’a pas été reproduit. La vérification de l’identité MJ et de l’état des données a utilisé le client administrateur autorisé ; elle ne remplace pas un essai du navigateur d’un joueur. Les règles et les parcours ont été vérifiés avec les émulateurs et les données fictives, sans créer de pièces de test dans la campagne réelle.

Les utilisateurs ayant une PWA déjà ouverte doivent accepter sa mise à jour ; sur le bureau, fermer les anciens onglets du site puis rouvrir l’entrée permet d’activer le nouveau cache.

Site : [Documents et enquêtes](https://ethoril.github.io/ennemi-interieur-wfrp4/enquetes.html).

## Interface — v2.35.0

La refonte visuelle utilise le composant commun `js/enquetes-workspace.js` avec une option `layout: 'desktop' | 'mobile'`. Le bureau fournit un rail, le détail et un carnet ; la coque mobile monte uniquement la liste, le dossier en quatre onglets ou la pièce. Les espaces, filtres et onglets mobiles restent en mémoire de module, par compte, et les contextes de pièce sont conservés pendant la navigation.

`js/enquetes-view-model.js` contient les projections pures (compteurs, liens, pièces, numéros, personnages, chronologie et notes). `js/enquetes-menu.js` gère les menus au clavier et le retour du focus. Les deux modules figurent dans le précache. Les jetons `--enq-*` sont définis dans `css/enquetes-workspace.css` et redéfinis dans `css/theme-parchment.css` ; les couleurs de papier et de visionneuse viennent des jetons des deux thèmes.

L’image s’agrandit au clic hors mode annotation. En mode annotation, le clic place une épingle ; un bouton permet aussi de créer au clavier une annotation centrale, dont les coordonnées restent éditables. Les numéros sont relatifs au dossier pour les pièces et au fichier pour les annotations.

La note rapide et l’éditeur complet passent par le même `saveNote`, puis par `addLink` en zone personnelle. Un brouillon est associé au compte et à l’identifiant de note, jamais enregistré dans les données de campagne avant l’envoi. Hors connexion, reprendre le brouillon après reconnexion pour l’envoyer ; aucune nouvelle file d’attente n’est créée.

Les mises à jour du même objet ne remettent plus la lecture mobile en haut. La saisie rapide conserve son formulaire par compte et contexte ; seule la liste du carnet est reconstruite. Depuis une note, ses cibles sont les enquêtes, documents et PNJ liés, sans lien entre notes. Si le stockage local est indisponible, la saisie reste ouverte et l'envoi en ligne demeure possible.

Les métadonnées de fichiers sont mises en cache dans la vue jusqu'au changement de la liste `document.files`, avec invalidation au changement de compte et au démontage. Les vignettes utilisent `objectUrl(file, { thumbnail: true })`. Le zoom possède son propre cycle de libération d'URL, indépendant des re-rendus du détail, jusqu'à sa fermeture ou au démontage.

Recette locale : `tools/fixtures/enquetes-qa.html` ; paramètres `role=joueur`, `layout=mobile`, `id=` (liste), `id=affaire` (dossier), `id=lettre` (pièce), `theme=parchment`. Le rapport de recette et les captures sont dans `docs/briefs/enquetes-ui/recette/`. La fusion et le push sur master nécessitent une demande explicite.

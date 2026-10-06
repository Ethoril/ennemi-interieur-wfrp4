# Proposition corrigée — documents et enquêtes

**Version 2, base de travail avec contrats de réalisation — 6 octobre 2026**

Cette version remplace la proposition du même jour (`proposition-documents-enquetes.md`). Elle conserve les deux orientations approuvées : conception indépendante de l’onglet actuel et mise à disposition en une seule livraison, sur ordinateur et mobile. Les choix marqués **[tranché]** ont été arrêtés par le commanditaire ; le reste découle de l’analyse et de l’environnement réel de l’application.

## 1 Contexte retenu

L’application sert une campagne : un MJ et cinq joueurs, authentifiés par Google. Le site est statique (HTML et modules JavaScript sans framework), hébergé sur GitHub Pages. Firebase fournit Firestore, Storage, Auth, App Check et des Cloud Functions v2 qui portent déjà les écritures sensibles, l’historique et la corbeille des contenus communs. Le bureau utilise une page par fonction ; le mobile est une PWA à routeur unique. Les deux partagent `js/data/*`.

Ce dimensionnement fixe l’échelle : quelques centaines de documents, quelques milliers de notes au total. Il n’y a ni moteur de recherche dédié, ni pagination serveur, ni fusion automatique de textes. Ces mécanismes coûteraient plus qu’ils ne rapporteraient à six comptes.

## 2 Objets

**Document** : une pièce consultable. Titre, description courte, corps de texte facultatif, catégorie (Lettre, Témoignage, Carte, Illustration, Rapport, Autre), étiquettes, provenance (session, lieu en texte libre, personne ayant remis la pièce, date dans l’univers), **origine**, audience, auteur, révision et dates techniques. Jusqu’à 10 fichiers.

**Origine [tranché]** : chaque document porte `origine = piece` (remise par le MJ ou trouvée en jeu) ou `origine = contribution` (rédigée par un joueur, y compris une note partagée). L’origine s’affiche en badge et se filtre. Une hypothèse publiée ne se lit jamais comme une preuve.

**Enquête** : une question à résoudre. Titre, question centrale, résumé, état (Ouverte, En pause, Résolue), archivage indépendant de l’état, étiquettes, audience, conclusion facultative, ordre des documents.

**Note** : observation ou hypothèse personnelle. Titre facultatif (la première ligne sinon), texte, étiquettes, liens. **Elle appartient au compte (uid) [tranché]**, pas au personnage : elle survit à un changement de personnage et n’est jamais transmise.

**PNJ** : la fiche existante (`pnjs`) reste la source. Elle devient un point d’entrée vers les documents, enquêtes et notes qui la concernent. Le rôle d’un PNJ dans une enquête (témoin, suspect, victime, contact, autre) appartient au lien, pas à la fiche.

**Relation entre documents** : Appuie, Contredit, Complète, Renvoie à, avec une courte justification.

**Événement de chronologie [tranché]** : intitulé, description, repère temporel libre (« Avant le carnaval »), date de session ou date dans l’univers facultatives, ordre manuel, documents et PNJ liés.

**Annotation [tranché : images seulement]** : repère ou zone rectangulaire sur une image, avec commentaire. Les PDF se consultent dans la visionneuse native du navigateur et ne sont pas annotables.

## 3 Modèle d’accès en trois zones

Les règles Firestore autorisent ou refusent un document entier, jamais un champ. La confidentialité repose donc sur l’emplacement des données, pas sur un champ « audience » filtré à la lecture.

| Zone | Chemin | Lecteurs |
| --- | --- | --- |
| Commune | `enq_commun/…` | membres de la campagne et MJ |
| MJ | `enq_mj/…` | MJ seulement |
| Personnelle | `enq_users/{uid}/…` | propriétaire seulement (MJ compris pour son propre espace) |

**Règle unique** : un objet ou un lien vit dans la zone la plus restrictive de ses extrémités. Exemples :

- Un document commun relié à une enquête commune : le lien est dans la zone commune.
- Un document secret relié à une enquête commune : le lien est dans la zone MJ. Les joueurs ne voient ni le lien ni l’identifiant du document.
- Une note d’un joueur reliée à une enquête commune : le lien est dans `enq_users/{uid}`. Personne d’autre n’en voit trace.
- Un PNJ caché (`visibleJoueurs == false`) relié à un document commun : le lien est dans la zone MJ.

Conséquences :

- Aucun objet commun ne stocke d’identifiant d’objet plus restreint. L’ordre des documents d’une enquête commune ne liste que des documents communs ; l’ordre secret vit dans un document miroir de la zone MJ.
- Les compteurs, la recherche, la chronologie et l’export travaillent sur ce que le lecteur a déjà reçu. Ils ne peuvent pas révéler ce que les règles ont refusé.
- Le « document personnel préparé » d’un joueur vit dans sa zone personnelle jusqu’à publication.

**Changement de visibilité** : publier, cacher, rendre secret, ou masquer un PNJ passe par un callable unique. Il déplace en une transaction l’objet et tous ses liens vers la bonne zone. Le masquage d’un PNJ, aujourd’hui un simple champ, doit donc déclencher ce même callable. Sans cette cascade, un lien commun révélerait l’identifiant d’un objet devenu secret.

Les écritures communes et MJ passent toutes par des callables (App Check obligatoire), dans le prolongement de `functions/src/contributions/service.mjs`. Les écritures dans la zone personnelle sont directes, contraintes par des règles `hasOnly` et des limites de taille.

## 4 Rôles et droits

| Action | Joueur | MJ |
| --- | --- | --- |
| Lire la zone commune | Oui | Oui |
| Lire la zone MJ | Non | Oui |
| Lire la zone personnelle d’un autre compte | Non | Non |
| Créer des notes, documents et liens personnels | Oui | Oui |
| Publier son document dans la zone commune | Oui, après confirmation | Oui, après confirmation |
| Relier son document commun à une enquête commune | Oui, directement | Oui |
| Modifier son document commun | Oui | Oui |
| Modifier le document commun d’un autre | Non | Oui, avec historique |
| Créer, modifier, résoudre une enquête commune | Non | Oui |
| Ordonner les documents d’une enquête commune | Non (ajout en fin de liste) | Oui |
| Créer relations et événements communs | Oui, modifiables par leur auteur | Oui, tous |
| Mettre en corbeille ses propres contributions communes | Oui | Oui, toutes |
| Restaurer et purger la corbeille | Ses objets personnels seulement | Oui |

**Publication directe, modération après coup [tranché]**. Un joueur ne connaît pas les secrets du MJ ; ce qu’il publie ne peut pas les révéler. Le MJ peut masquer (retour en zone personnelle de l’auteur), mettre en corbeille ou modifier avec historique. Il ne peut ni lire ni s’approprier un contenu personnel.

La confidentialité des notes repose sur les règles d’accès. Ce n’est pas du chiffrement : le propriétaire du projet Firebase peut techniquement lire les données depuis la console. L’écran du carnet le dit en une phrase.

Un compte retiré de `campagne/acces` perd l’accès aux zones commune et MJ. Sa zone personnelle reste la sienne et reste exportable.

## 5 Fichiers et téléversement

- **Limites [tranché]** : 10 Mo par fichier, 10 fichiers par document, 100 000 caractères de corps.
- Formats : JPEG, PNG, WebP, PDF, TXT, Markdown. Les images sont recompressées dans le navigateur avant envoi (bord long 2 560 px) ; l’original n’est pas conservé au-delà de 10 Mo.
- **Envoi** : téléversement résumable direct vers `staging/{uid}/{uploadId}`, autorisé par les règles Storage (propriétaire, taille, type déclaré). Un callable vérifie le type réel et la taille, puis déplace le fichier vers `documents/{docId}/{fileId}/{version}`. Les fichiers en transit non rattachés sont nettoyés après 24 h.
- Le chemin définitif ne dépend pas de la zone. La règle Storage relit l’emplacement du document (commun, MJ ou personnel de l’auteur) avant d’autoriser la lecture. Les images restent servies par `getBlob` authentifié, sans URL publique.
- Un document n’est publié que lorsque tous ses fichiers sont vérifiés. Un échec laisse un brouillon personnel, jamais une pièce commune incomplète.
- Remplacer un fichier crée une nouvelle version. Les annotations restent attachées à la version annotée. Les versions antérieures sont réservées aux éditeurs, avec un accès ciblé à la version annotée pour son lecteur autorisé (section 17.3). Il n’y a pas d’interface de comparaison.
- Il n’y a pas de miniatures générées côté serveur : la recompression à l’envoi en produit une de 400 px, stockée comme fichier dérivé de la même version.

## 6 Enquêtes, liens et vues

La fiche d’une enquête présente :

1. La synthèse : question, état, conclusion.
2. Les documents, dans l’ordre éditorial du MJ.
3. Les PNJ et leur rôle.
4. Mes notes liées (visibles par leur seul auteur).
5. Les relations.
6. La chronologie.

Une enquête vide propose d’ajouter un document, de relier un PNJ ou de prendre une note. Résoudre n’efface et ne verrouille rien ; une réouverture apparaît dans l’historique.

Chaque fiche (document, enquête, PNJ, note) comporte un panneau **Liens** pour consulter, ajouter et retirer les liens autorisés. Retirer un lien ne supprime aucun objet. Les liens se lisent dans les deux sens.

**Relations [tranché : liste + graphe réutilisé]**. La vue principale est une liste structurée des relations, utilisable au clavier et au lecteur d’écran, identique sur mobile. Une vue graphe en lecture, construite sur le moteur D3 de `pnjs.js`, montre documents, PNJ, et pour leur auteur ses notes et relations privées. Seule une disposition personnelle est enregistrée (zone personnelle). Il n’y a pas de disposition commune. Déplacer un nœud ne modifie aucun lien.

**Chronologie [tranché]**. C’est une liste ordonnée par enquête. Les événements communs vivent en zone commune ou MJ selon l’enquête et leurs pièces ; les événements privés vivent dans la zone personnelle et s’intercalent dans la vue de leur auteur. Une date fictive n’est jamais convertie en date réelle. Ajouter un document ne crée jamais d’événement.

**Annotations**. Elles sont privées par défaut. Elles apparaissent aussi dans une liste textuelle sous l’image. Partager une annotation crée une copie commune après confirmation ; le MJ peut la modérer.

## 7 Carnet et partage

Le carnet regroupe toutes les notes du compte, liées ou non. Il se filtre par enquête, PNJ, document et « non classées ». Le bouton **Ajouter une note** sur chaque fiche ouvre un éditeur léger avec le contexte déjà lié.

La sauvegarde est automatique, avec quatre états visibles : brouillon local, synchronisation, sauvegardée, échec. Un brouillon local n’est jamais présenté comme sauvegardé.

**Partager une note** crée, après un aperçu modifiable, un document commun d’origine `contribution`. Les liens proposés sont filtrés : seuls ceux dont l’autre extrémité est commune sont transmissibles. La note reste privée ; les deux objets évoluent ensuite indépendamment.

## 8 Recherche

La recherche se fait dans le navigateur. À l’ouverture de l’espace Enquêtes, le client charge les textes et métadonnées accessibles (sans les fichiers) et construit un index normalisé (casse et accents ignorés). Il porte sur les titres, descriptions, corps, transcriptions, étiquettes, noms de PNJ et, pour leur seul auteur, les notes personnelles.

L’index ne contient que ce que les règles ont déjà livré au lecteur ; il ne peut rien révéler d’autre. Les résultats indiquent le type d’objet et le passage trouvé. La portée est « tout » ou « cette enquête ». Le contenu des fichiers n’est pas indexé.

Volume de référence : 500 documents avec un corps moyen de 3 000 caractères, soit 1,5 million de caractères de corps. Le budget de transfert et de mémoire est mesuré avec les notes, métadonnées et index (section 17.5).

## 9 Conflits, hors connexion, historique

**Conflits [tranché : révision + choix]**. Chaque objet modifiable porte un numéro de révision. Une écriture transmet la révision lue et un `operationId` stable (pas de doublon lors d’une reprise réseau). Si la révision a changé, l’écriture est refusée ; l’interface montre « votre version » et « version actuelle », et l’utilisateur garde l’une, l’autre, ou recopie à la main. Il n’y a pas de fusion automatique. Le même mécanisme couvre deux appareils d’un même compte sur une note.

**Hors connexion [tranché : cache Firestore + brouillons]**. Les textes déjà consultés restent lisibles via le cache persistant Firestore déjà activé pour les joueurs. La session MJ conserve son cache mémoire seulement. Les notes en cours d’édition ont un brouillon local isolé par compte, synchronisé à la reconnexion. Les fichiers ne sont disponibles qu’en ligne. Publication, changement de visibilité, suppression et toute écriture commune exigent une connexion. La déconnexion du compte vide le cache Firestore et les brouillons après avertissement s’il reste des brouillons non synchronisés.

Révocation : un objet retiré d’une zone disparaît des requêtes en écoute, le client le retire de l’écran et de l’index. Un appareil hors ligne garde ce qu’il a déjà, jusqu’à sa prochaine connexion. L’interface de retrait de visibilité le signale en une phrase.

**Historique**. Il s’appuie sur le service existant (`getContentHistory`) pour les objets communs et MJ : création, publication, changement de visibilité, modification, corbeille, restauration. Il n’enregistre jamais de texte personnel ni d’identifiant d’objet plus restreint que son lecteur.

## 10 Corbeille et export

- La mise en corbeille est réversible et réutilise le service existant (trash, restore, purge, audit).
- **Rétention de 30 jours [tranché]** : une fonction planifiée (`onSchedule`, quotidienne) purge les entrées échues. Elle est nouvelle ; la purge actuelle est manuelle et réservée au MJ.
- La restauration recalcule la zone selon les droits actuels. Un objet restauré revient non publié si sa republication exposerait un contenu, et les liens devenus interdits ne sont pas recréés.
- Une note garde son texte quand sa source disparaît. Un lien mort affiche « pièce indisponible » à l’auteur qui l’avait créé, et rien à qui n’y a jamais eu accès.
- Un fichier n’est purgé que si aucune version conservée ni entrée de corbeille ne le référence.
- **Export** : il est généré dans le navigateur (JSZip) à partir des seules données reçues. L’export d’une enquête contient une synthèse Markdown, les documents accessibles, leurs fichiers et un manifeste JSON des liens. L’export personnel ajoute, sur sélection explicite, les notes du compte. Personne n’exporte les notes d’autrui.
- La sauvegarde administrative reste distincte : export Firestore planifié et copie du bucket, avec une restauration testée sur un projet de recette avant la bascule.

## 11 Modèle de données Firestore

| Collection | Zone | Contenu principal |
| --- | --- | --- |
| `enq_commun/data/documents/{id}` | commune | document et métadonnées des fichiers |
| `enq_commun/data/enquetes/{id}` | commune | enquête, ordre des documents communs |
| `enq_commun/data/liens/{id}` | commune | liens entre objets communs, rôle PNJ |
| `enq_commun/data/relations/{id}` | commune | relations entre documents communs |
| `enq_commun/data/evenements/{id}` | commune | événements communs |
| `enq_commun/data/annotations/{id}` | commune | annotations partagées |
| `enq_mj/data/…` | MJ | mêmes sous-collections pour le secret, plus `ordres/{enqueteId}` |
| `enq_users/{uid}/…` | personnelle | notes, documents en préparation, liens, relations, événements, annotations, dispositions du graphe |
| `content_*` (existant) | serveur | historique, corbeille, audit, opérations |

Identifiants de lien déterministes, par exemple `doc_{a}__enq_{b}`, pour garantir l’unicité. Les liens stockent les deux extrémités pour les requêtes dans les deux sens (`where('a', '==', id)` et `where('b', '==', id)`).

Fichiers : `staging/{uid}/…` (écriture client, propriétaire seulement) puis `documents/{docId}/…` (lecture selon la zone du document, écriture serveur seulement).

## 12 Reprise de l’existant

**Import contrôlé [tranché]**. Un script Admin convertit `indices` en documents d’origine `piece` :

- `titre` → titre ;
- `description` → corps ;
- image → fichier version 1, avec copie dans `documents/…` ;
- `pnjsLies` → liens ;
- `decouvert` → zone commune ou MJ ;
- `type` → catégorie, avec `Autre` par défaut ;
- `source` et `dateDecouverte` → provenance.

Le script produit un rapport (convertis, ignorés, anomalies), peut être rejoué sans doublon, et ne supprime ni ne modifie `indices`. L’ancienne collection passe en lecture MJ seule à la bascule. Les anciennes URL (`enquetes.html`, routes mobiles) redirigent vers le nouvel espace.

## 13 Critères de réception

Validés sur ordinateur et mobile (Android et iOS), avec trois comptes : MJ, joueur A, joueur B.

1. Créer une pièce avec deux images et une transcription ; la retrouver par recherche sans accents.
2. La relier à deux PNJ et deux enquêtes ; un seul exemplaire des fichiers existe dans Storage.
3. Retirer un lien ; la pièce et ses autres liens restent intacts.
4. Créer une note depuis une pièce, la lier à deux enquêtes, la retrouver dans le carnet.
5. La note de A n’est visible ni par B ni par le MJ, y compris par lecture Firestore directe avec un identifiant deviné.
6. Partager une note ; le document commun porte l’origine `contribution`, la note reste privée et évolue seule.
7. Document secret et liens secrets : aucune trace côté joueur dans la liste, la recherche, les compteurs, le graphe, la chronologie, l’export ou Storage.
8. Rendre secret un document commun déjà relié : tous ses liens quittent la zone commune ; l’écran d’un joueur connecté le retire en direct.
9. Masquer un PNJ relié à des documents communs : même vérification.
10. A publie et relie directement un document ; le MJ le masque ; il revient dans la zone personnelle de A.
11. Annoter une image, remplacer le fichier, retrouver l’annotation sur l’ancienne version.
12. Chronologie à dates fictives, ordre manuel conservé ; événement privé intercalé chez son seul auteur.
13. Couper le réseau pendant une note ; retrouver le brouillon ; résoudre un conflit entre deux appareils.
14. Interrompre un téléversement, le reprendre ; aucun document commun incomplet, aucun doublon.
15. Mettre une enquête en corbeille, la restaurer sans republication involontaire ; purge automatique après 30 jours vérifiée sur une entrée datée artificiellement.
16. Export d’enquête par A : seulement des contenus communs ; export personnel avec notes sur sélection.
17. Retirer B de `campagne/acces` : il perd la zone commune, garde et exporte son carnet.
18. Import de `indices` rejoué deux fois : état final équivalent, identifiants stables et aucun doublon.
19. Restauration d’une sauvegarde de contrôle avec fichiers, versions et liens cohérents.
20. Tests de règles Firestore et Storage (`@firebase/rules-unit-testing`) pour chaque zone et chaque rôle, intégrés à `npm run check`.
21. Une image de 10 Mo et un PDF de 10 Mo s’ouvrent sur un téléphone d’entrée de gamme.
22. Montée de version du service worker : les nouvelles pages sont précachées, les anciennes routes redirigent.

Accessibilité : chaque action a un nom accessible, le focus est géré dans les fenêtres, aucune action ne dépend d’un glisser, la liste des relations et celle des annotations remplacent les vues graphiques.

Performance cible (campagne de référence : 500 documents, 100 PNJ, 30 enquêtes, 500 notes par compte) : première liste utile en moins de 3 s sur 4G, résultats de recherche en moins de 200 ms une fois l’index construit.

## 14 Hors périmètre

OCR, IA, édition simultanée, partage public, messagerie, gestion des lieux et objets, annotation de PDF, mise hors connexion volontaire avec fichiers, fusion automatique de textes, disposition commune du graphe, moteur de recherche externe. Leur exclusion définit le périmètre ; elle n’annonce pas de livraison ultérieure.

## 15 Difficultés principales

1. **Double interface** : pages bureau et PWA mobile pour chaque écran. C’est le premier poste de coût. Les vues doivent s’appuyer sur des modèles partagés dans `js/data/` et ne différer que par le rendu.
2. **Zones et cascades** : callable de changement de visibilité, ordres miroirs, branchement du masquage PNJ, et la batterie de tests de règles qui les garantit.
3. **Téléversement résumable** : zone de transit, vérification serveur, nettoyage, recompression côté client.
4. **Recherche et chargement initial** : construire l’index sans bloquer l’affichage sur mobile.
5. **Import et bascule** : script rejouable, redirections, sauvegarde et retour arrière testés.

## 16 Bascule

Elle se déroule ainsi :

1. Sauvegarde Firestore et Storage.
2. Import contrôlé et lecture du rapport.
3. Tests de réception.
4. Préparation coordonnée puis activation unique des règles, des fonctions et du front (bump `APP_VERSION` dans `layout.js` et `sw.js`, CHANGELOG).
5. Redirection des anciennes routes.

Le retour technique rétablit le front et les règles précédents après gel des écritures et conservation des données V2 nouvelles. Il ne restitue pas ces nouveautés dans indices ; le protocole détaillé figure en section 17.6.

Cette proposition n’autorise aucune mise en œuvre ni suppression de données par sa seule rédaction.

## 17 Contrats de réalisation complémentaires

Ces précisions complètent la V2 sans changer les choix marqués [tranché]. Elles règlent les points relevés lors de sa relecture et constituent les contrats à appliquer lors de la réalisation.

### 17.1 Espaces personnels et associations

Les espaces personnels ne forment pas une audience commune plus restrictive : chaque uid constitue une audience distincte. Un lien privé appartient à un seul uid et ne peut référencer que ses propres objets personnels et des objets communs auxquels il a accès. Un utilisateur ne peut jamais créer un lien vers un objet personnel d'un autre uid, même en devinant son identifiant. Le MJ ne dispose d'aucune exception pour les objets personnels des joueurs.

Le MJ peut associer dans son propre espace privé ses notes aux objets secrets qu'il est autorisé à lire. Les autres comptes ne peuvent pas créer une association vers la zone MJ.

Les cascades de visibilité concernent l'objet modéré et ses dépendances communes ou MJ. Elles ne déplacent, ne publient et ne suppriment aucune note, annotation ou association personnelle. Un lien personnel vers une pièce devenue inaccessible reste dans le carnet de son auteur, avec une indication neutre ; aucun titre ni extrait retiré n'est rechargé.

Les liens privés vers une pièce commune devenue personnelle chez un autre auteur deviennent donc inactifs. Le serveur refuse leur nouvelle création ; leur existence antérieure n'accorde aucun droit de lecture.

### 17.2 Déplacement et cascade de visibilité

Chaque objet conserve un identifiant stable malgré son déplacement. Un registre serveur de localisation et d'accès permet de retrouver sa zone actuelle sans demander au client de parcourir des zones interdites. Le registre n'est pas interrogeable librement par les utilisateurs et ne retourne jamais la localisation d'un objet inaccessible.

Toute création de dépendance commune, modification de visibilité et mutation PNJ est soumise au même protocole. Le service versionne l'état de visibilité de chaque extrémité ; créer un lien pendant son déplacement provoque une reprise ou un refus, jamais une référence commune vers un secret. Les chemins anciens et nouveaux d'écriture du masquage PNJ sont inclus dans ce contrôle.

La cascade recense les liens, relations, événements, annotations communes, ordres éditoriaux, historique consultable et autorisations de fichiers affectés. Les notes personnelles sont exclues. Un événement contenant plusieurs pièces prend l'audience nécessaire à l'ensemble de ses références ; il n'est pas déplacé vers le commun tant qu'une de ses références reste secrète.

Une petite cascade est validée dans une transaction bornée après calcul de ses écritures et de sa taille. Une cascade qui dépasse le budget ne commence pas partiellement dans ce mode. Elle utilise une opération durable : préparation, verrouillage des audiences concernées, déplacement par lots avec curseur, vérification et activation finale. Les audiences verrouillées restent indisponibles aux lecteurs ordinaires pendant l'opération, plutôt que d'exposer des dépendances incohérentes.

Le verrou est imposé par les règles Firestore et Storage, ainsi que par les callables. Il ne s'agit pas d'un simple indicateur d'interface. Les clients écoutent son état, retirent de l'affichage et de la recherche les données concernées lors d'un refus d'accès, puis recréent leurs abonnements après activation. Les opérations se reprennent par un worker serveur ; elles ne dépendent pas de l'onglet du MJ restant ouvert.

Un échec laisse un état protégé et reprenable. Les fichiers déjà téléchargés et les appareils hors ligne conservent les limites de révocation décrites en section 9. La transaction Firestore ne constitue pas une transaction commune à Firestore et Storage.

### 17.3 Accès aux fichiers et versions annotées

Le chemin stable d'un fichier est accompagné d'un descripteur d'accès serveur. Il référence la zone courante, l'auteur, l'état actif ou verrouillé, la version et les droits applicables. Le document public ne contient aucune liste de lecteurs privés.

Les règles Storage doivent disposer d'une vérification bornée : consulter successivement les trois zones possibles puis l'appartenance à la campagne est exclu. Le descripteur et les données de contrôle nécessaires sont conçus dans le budget des lectures autorisées par Storage. Toute modification d'audience met à jour ce descripteur dans le protocole de cascade.

Une version remplacée n'est plus proposée dans la fiche générale. Un lecteur autorisé qui conserve une annotation sur cette version peut consulter cette version depuis l'annotation, tant qu'il possède toujours l'accès au document. Cette permission est établie par le serveur pour le uid et la version concernés ; elle n'accorde ni édition du document ni accès à toutes ses anciennes versions.

Retirer l'accès au document retire aussi cet accès de consultation ciblé. Une annotation personnelle reste lisible par son auteur, mais ne permet pas de récupérer une image devenue secrète. Le fichier de l'ancienne version n'est pas purgé tant qu'une annotation conservée autorisée ou la politique de rétention le requiert.

### 17.4 Écritures personnelles et brouillons

Les notes personnelles et leurs brouillons ont des fonctions distinctes. Le brouillon local peut être modifié sans connexion. La validation d'une version serveur nécessite une connexion et une comparaison atomique des révisions.

La création directe d'une note initialise sa révision. Une modification directe utilise une transaction Firestore vérifiant la révision lue, l'auteur et l'identifiant d'opération. Les règles imposent les champs autorisés, les limites, l'immutabilité de l'auteur et une progression exacte de la révision. Une écriture simple hors transaction ne contourne pas cette garde.

L'identifiant d'opération reste identique après un résultat réseau inconnu. Un reçu privé écrit atomiquement avec la note permet de reconnaître une opération déjà confirmée. Les reprises ne créent pas de seconde note et ne réappliquent pas une ancienne version sur un texte plus récent.

Hors connexion, le client écrit exclusivement dans le brouillon local. À la reconnexion il compare la base conservée à la version serveur, puis valide ou présente le conflit. Les états « sauvegardée » et « synchronisation » reflètent les confirmations réellement reçues. Le choix d'une version après conflit utilise encore la dernière révision connue ; un deuxième changement distant ne peut pas être écrasé sans nouvelle comparaison.

Le contenu, la révision de base, l'identifiant du compte et l'opération en attente sont conservés dans le brouillon. Un changement de compte ne peut ni charger ni synchroniser les brouillons du compte précédent. Le même protocole est appliqué aux autres textes personnels sauvegardés automatiquement.

### 17.5 Mémoire, index et import

L'estimation de la section 8 décrit 1,5 million de caractères de corps de documents, et non une taille garantie de téléchargement. Le budget réel inclut l'encodage, les métadonnées, PNJ, notes, liens, objets JavaScript et l'index de recherche.

Les essais mesurent le transfert, le temps de construction de l'index et le pic de mémoire sur le téléphone de référence. L'interface rend la liste avant la fin de l'indexation et indique lorsque la recherche n'est pas encore complète. L'index est construit par tâches courtes ou dans un worker si nécessaire. Aucun fichier binaire n'y entre.

Le critère de rejouabilité de l'import est : état final équivalent, mêmes identifiants, aucun objet ou fichier dupliqué et anomalies traçables. Le deuxième rapport peut distinguer les objets déjà importés ; il n'est pas tenu d'être textuellement identique au premier.

### 17.6 Mise en service et retour technique

La mise à disposition fonctionnelle reste unique. La préparation technique des fonctions, règles et fichiers statiques peut être ordonnée : ces services ne sont pas décrits comme un déploiement atomique.

Un indicateur serveur d'activation et une version de protocole empêchent le nouveau client d'écrire avant validation du backend. Pendant la bascule, les écritures des anciennes routes sont désactivées ; les clients déjà ouverts reçoivent un message de mise à jour. Le service worker ne doit pas conserver un client ancien autorisé à écrire avec un protocole incompatible.

Avant activation : sauvegarde vérifiée, import, vérification des permissions et fichiers, recette complète, puis ouverture unique du nouvel espace. Le plan précise également les règles à rétablir pour que l'ancienne collection redevienne lisible si un retour est nécessaire.

Après activation, les objets nouveaux ne sont pas présents dans indices. Revenir à l'ancien front ne restitue donc pas l'état de jeu actualisé. Le retour technique gèle les nouvelles écritures, conserve toutes les données et fichiers V2, exporte les opérations depuis l'activation, puis rétablit l'ancien service avec un avertissement explicite sur sa date de référence. La reprise de la V2 doit conserver les notes et contenus créés pendant son utilisation.

La restauration d'une ancienne sauvegarde sur les données V2 actives sans conservation de leurs nouveautés est interdite. La préférence après activation est une correction du nouveau service ; le retour reste un mécanisme d'incident, pas une seconde livraison.

### 17.7 Vérifications supplémentaires

Les critères de réception sont complétés par les essais suivants :

23. Une association vers l'objet personnel d'un autre uid est refusée, même avec un identifiant connu ; une association personnelle préexistante reste privée après une cascade.
24. Une création de lien concurrente à un changement d'audience ne laisse aucune référence interdite dans la zone commune.
25. Une cascade au-delà du budget transactionnel, interrompue entre deux lots, reste inaccessible aux comptes non autorisés et reprend sans duplication.
26. Un lecteur conserve l'accès à la version portant son annotation, puis le perd si le document devient inaccessible, sans perdre le texte de son annotation privée.
27. Deux appareils modifient une note depuis la même révision ; un seul confirme son écriture et l'autre conserve son brouillon pour résoudre le conflit.
28. Une écriture personnelle dont la réponse réseau est perdue est reconnue à la reprise par son reçu, sans réécriture ni doublon.
29. Une ancienne version du front ou du service worker ne peut pas écrire pendant la bascule ou via un protocole retiré.
30. Un exercice de retour technique après création d'une note et d'un document V2 conserve ces nouveaux contenus et permet leur reprise ultérieure.

### 17.8 Références techniques

Les contraintes de transactions, de validation atomique et de fonctionnement hors connexion sont documentées dans [Transactions et écritures par lot](https://firebase.google.com/docs/firestore/manage-data/transactions). Les contraintes de lectures Firestore par les règles Storage sont documentées dans [Fonctionnement des règles de sécurité](https://firebase.google.com/docs/rules/rules-behavior). Ces références justifient les protocoles de réalisation ; elles ne modifient pas le périmètre fonctionnel approuvé.


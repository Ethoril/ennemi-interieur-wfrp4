## [2.17.0] - 2026-08-25

### Couche de données commune
- **Dépôts partagés PNJs, relations, indices et images** : contrats publics/MJ documentés, erreurs normalisées, métadonnées temps réel, désabonnement et cycle de vie explicités.
- **Intégration bureau** : les pages PNJs et Enquêtes passent par la composition commune, avec protections de session, reprise des verrous et nettoyage des ressources.
- **Précache complet** : le graphe local requis par les deux pages est inclus dans le Service Worker.

### Vérification
- Les tests unitaires, d'intégration et de règles sont exécutables localement. La recette multi-fenêtres, réseau, bfcache et deux thèmes reste à réaliser manuellement ; aucun accès Firebase de production n'a été effectué dans ce lot.

## [2.16.0] - 2026-08-24

### Sécurité et mobile
- **App Check progressif** : le client initialise reCAPTCHA Enterprise sur l’origine de production, tandis que la callable d’upload protégé exige désormais App Check. Le développement local reste sans jeton de debug et ne peut pas utiliser accidentellement la callable de production.
- **Socle M1 déployé** : la visibilité Firestore, les règles d’intégrité, les images protégées, la fonction d’upload et App Check sont actifs sur `campagne-wrpg`. Les trois anciennes copies référencées ont été migrées puis nettoyées ; les deux portraits orphelins connus restent volontairement conservés.

### PWA & Cache
- **Précache App Check** : le module local de configuration est inclus dans le Service Worker.
- **Incrémentation du cache** : passage en `wfrp-cache-v2.16.0`.

## [2.15.0] - 2026-08-18

### Accueil
- **La date de la prochaine session s'affiche dans le hero**, juste sous le titre, visible dès l'arrivée sur la page au lieu d'être reléguée sous la ligne de flottaison.
- **Quatre cartes de navigation ajoutées** pour les pages apparues depuis : Cartes, PNJs, Enquêtes et Calendrier.
- **La scène 3D se termine sur un gros plan de Morrslieb** : en passant sous les cartes, la lune du Chaos revient et grossit jusqu'à révéler son visage démoniaque, au lieu de s'attarder sur la ville.

### Accessibilité
- **Tous les champs de formulaire ont enfin un libellé associé** (fiche, PNJs, enquêtes), y compris ceux générés à la volée — compétences, journal d'XP, sorts, prières, boutons de suppression. Un lecteur d'écran les annonce désormais correctement au lieu de « champ de saisie, vide ».
- **L'état de sauvegarde de la fiche et les erreurs de vote du Calendrier sont annoncés vocalement.**
- **Repère de contenu et lien d'évitement sur les onze pages** : au clavier, la première tabulation propose d'aller droit au contenu sans traverser les neuf entrées de la navigation. L'indicateur de focus est visible partout, dans les deux thèmes.
- **Contraste renforcé** des libellés de formulaire et des bordures de champs, dans les deux thèmes.

### Personnages
- **Espèce Nain** disponible sur la fiche (Mouvement 3), et le **rang maximum passe de 4 à 5** pour couvrir la carrière Mage (Haut Elfe).

### Interface
- **Les actions destructives passent par une modale de confirmation** thématisée, au lieu des fenêtres système : réinitialisation de fiche (nommant le personnage), suppression de PNJ, de relation, d'indice, de sondage, de la réponse d'un joueur, et remplacement de fiche à l'import. Le focus se place d'office sur « Annuler », et Échap ou un clic sur le voile annulent.

### Corrections
- **Aides de Jeux** : les en-têtes de colonnes ne disparaissent plus quand on tape dans la recherche.
- **Enquêtes** : lorsque la liste d'indices est vide, le message « Aucun indice » ne recouvre plus la page et ne bloque plus les boutons (dont la connexion).

### Performance
- **Scène 3D de l'accueil** : les positions de défilement ne sont plus recalculées à chaque événement de défilement, ce qui allège le rendu.

### PWA & Cache
- **Fonctionnement hors-ligne fiabilisé** : page de repli dédiée, pré-cache élargi (Leaflet, modale de confirmation) et cache lié à la version de l'application.
- **Incrémentation du cache** : passage en `wfrp-cache-v2.15.0`.

### Calendrier
- **Mise en forme du Calendrier sortie du JavaScript** vers la feuille de style, avec suivi du thème parchemin.

### Sous le capot
- Contrôles d'intégration continue ajoutés (syntaxe des modules, ESLint, cohérence version / cache / CHANGELOG), nettoyage de code mort et de fichiers obsolètes.

## [2.14.1] - 2026-08-17

### Performance
- **Chargement des styles accéléré** : les feuilles de style et la police étaient découvertes en cascade, chacune n'étant demandée qu'après l'analyse de la précédente — la police partait au troisième aller-retour, pendant lequel l'affichage était bloqué. Tout est désormais demandé en parallèle dès la lecture de la page. Deux feuilles vides et un fichier intermédiaire devenu inutile ont été supprimés au passage.
- **Plus de clignotement au passage en thème Parchemin** : la feuille du thème est chargée d'emblée au lieu d'être ajoutée par le script.

### Sécurité
- **Politique de sécurité resserrée page par page** : l'autorisation des scripts en ligne, qui affaiblissait la protection contre les injections, ne subsiste que sur l'accueil, où la scène 3D l'exige. Chaque page n'autorise plus que les services qu'elle utilise réellement — l'accueil, par exemple, ne fait plus aucune référence à Firebase depuis que le calendrier n'en dépend plus.

### Corrections
- **Téléchargement de l'export de fiche** durci pour Firefox, où la révocation trop rapide du lien pouvait annuler l'enregistrement du fichier.
- **Mise en cache hors ligne réparée** : la liste des ressources pré-chargées citait un fichier supprimé, ce qui faisait échouer l'installation du cache en silence.

## [2.14.0] - 2026-08-17

### Personnages
- **Export et import de la fiche** : deux boutons en bas de la fiche permettent de télécharger une sauvegarde complète au format JSON et de la restaurer. Le fichier est daté et identifié, à conserver hors du navigateur — c'est le filet de sécurité qui manquait. Réimporter écrase la fiche courante après confirmation, et l'état restauré part aussitôt vers le cloud.

### Performance
- **31 Mo d'images supprimés** : un fond décoratif de 14 Mo qui n'était référencé nulle part, et les cinq images de repli au format PNG, devenues inutiles depuis que tous les navigateurs lisent le WebP. Le dossier d'images passe de 32 Mo à moins de 1 Mo.

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v11`.

## [2.13.4] - 2026-08-17

### Personnages — perte de données corrigée
- **Consulter une fiche ne peut plus en détruire le contenu (critique).** Le code choisissait entre la copie du cloud et celle du navigateur en comparant deux horloges différentes, celle du poste et celle du serveur. Or afficher une fiche suffisait à marquer la copie locale comme la plus récente : ouvrir une fiche pour la lire pouvait donc reverser un vieux cache par-dessus les modifications de quelqu'un d'autre. L'arbitrage repose désormais sur une information vérifiable — cette copie porte-t-elle des modifications qui n'ont pas encore été envoyées.
- **Les modifications faites juste avant de quitter la page ne sont plus perdues.** La sauvegarde vers le cloud attendait deux secondes ; fermer l'onglet, changer de page ou verrouiller son téléphone dans cet intervalle l'annulait sans rien dire. L'envoi est maintenant forcé au moment où la page disparaît, y compris sur mobile où l'ancien mécanisme ne se déclenchait pas du tout.
- **Deux modifications rapprochées ne s'écrasent plus.** Une sauvegarde demandée pendant qu'une autre était en cours était purement abandonnée ; elle est désormais mise en file et envoyée à la suite.
- **Un échec d'enregistrement est visible.** Le message « ⚠ Non enregistré » s'affiche au lieu d'un silence qui laissait croire que tout était sauvegardé.

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v10`.

## [2.13.3] - 2026-08-17

### Sécurité
- **Règles Firebase versionnées et durcies (critique)** : les règles Firestore et Storage entrent dans le dépôt (`firestore.rules`, `storage.rules`) et sont déployées. Jusqu'ici le modèle d'autorisation n'existait que dans la console, non versionné et non relisible, tandis que tous les contrôles côté navigateur se contournaient depuis la console de développement. Désormais : les indices non découverts ne sont plus lisibles hors Maître de Jeu, la collection `mail` n'accepte que la création d'un message adressé au Maître de Jeu et de forme imposée — elle ne peut plus servir de relais —, l'écriture sur les PNJs, les relations et les indices est réservée au Maître de Jeu, et les téléversements d'images sont bornés en taille et en type.
- **Sondage de session** : un visiteur sans compte peut toujours voter et modifier sa réponse, mais il ne peut plus supprimer la réponse d'un autre joueur, remplacer les dates, clôturer le sondage ni le supprimer. Le vote reste anonyme, par choix.
- **Adresses des joueurs jamais exposées** : la table des accès aux fiches vit dans Firestore et n'est lisible que par le Maître de Jeu. Le navigateur ne la télécharge pas : ce sont les règles qui tranchent l'autorisation, côté serveur.

### Personnages
- **Accès des joueurs à leur fiche** : chaque joueur ouvre désormais sa fiche avec son compte Google. La fonctionnalité annoncée en 2.10.0 ne fonctionnait en réalité pour personne d'autre que le Maître de Jeu, la table d'autorisation étant restée vide depuis son introduction. Ajouter ou retirer un joueur se fait maintenant dans la console Firebase, sans mise en ligne.
- **Message d'attente** : « Vérification des accès… » s'affiche pendant le contrôle, au lieu du message de refus qui apparaissait à tort pendant une fraction de seconde.

### Accueil
- **Le calendrier impérial suit enfin la date du jour.** Il affichait « Hexennacht, An 2512 » depuis sa mise en ligne, sans jamais avancer d'un jour : le document de campagne dont il dépendait n'avait jamais été créé, et l'échec de lecture était silencieux. Le calendrier est désormais calculé à partir de la date réelle — l'année civile décalée de 486 ans, et le jour de l'année étiré sur les 400 jours du calendrier impérial. Les douze mois et les six jours de fête défilent donc au cours de l'année.
- **Plus aucune requête réseau depuis le calendrier** : les contrôles d'avance manuelle du Maître de Jeu, qui ne pouvaient de toute façon pas fonctionner, sont retirés. La date se rafraîchit d'elle-même au passage de minuit.

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v9`.

## [2.13.2] - 2026-08-11

### Sécurité
- **Injection HTML sur le Calendrier (critique)** : les pseudos des votants et les libellés de dates sont désormais échappés avant affichage, dans les trois états de la page (sondage ouvert vu par le MJ, vu par un visiteur, et sondage clôturé) ainsi que dans la modale de détail des votes et dans le courriel de notification. Le vote étant anonyme, n'importe quel visiteur pouvait jusqu'ici faire exécuter du script chez tous les autres, dont le Maître de Jeu — la seule session disposant d'un accès en écriture aux fiches, aux PNJs et aux indices. Le pseudo est également borné à 40 caractères et refuse les caractères de contrôle.
- **Injection HTML sur les fiches de personnages** : échappement des libellés d'achat XP, coûts, noms de sorts, notes de carrières, résumés de prières, noms de compétences, spécialisations personnalisées et talents ajoutés à la main. Ces valeurs étant stockées dans le cloud, une fiche de joueur pouvait atteindre la session du Maître de Jeu à l'ouverture. Les listes de suggestions et les puces du panneau de carrière sont couvertes.
- **Validation du personnage demandé** : le paramètre `char` de la fiche est vérifié contre la liste des personnages connus ; une valeur inconnue redirige vers Le Groupe sans créer de sauvegarde locale parasite.
- **Règles Firebase versionnées** *(préparé, déploiement à venir)* : les règles Firestore et Storage entrent dans le dépôt sous forme de briefs, en vue de rendre les indices non découverts illisibles hors Maître de Jeu et d'empêcher la collection `mail` de servir de relais.

### Qualité
- **Documentation de correction** : ajout de `docs/briefs/` — vingt briefs de développement issus de l'audit technique de la v2.13.1, répartis en deux lots (v2.13.2 sécurité, v2.14.0 qualité), accompagnés d'un socle de contraintes communes.

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v8` pour que les correctifs de sécurité remplacent immédiatement les fichiers stockés dans les navigateurs.

## [2.13.1] - 2026-06-11

### Accueil
- **Espace de défilement supplémentaire** : ajout de hauteur avant la vue finale, pour que les cartes de navigation soient sorties de l'écran au moment où la caméra plonge sur les toits d'Altdorf.

## [2.13.0] - 2026-06-11

### Accueil — « La Comète à deux queues »
- **Scène 3D au défilement** : l'accueil s'ouvre sur une scène en quatre chapitres qui se déroule au fil du scroll — ciel étoilé, comète à deux queues de Sigmar, Morrslieb la lune du Chaos, puis la silhouette d'Altdorf en contrebas.
- **Le visage de Morrslieb** : un visage démoniaque se révèle dans la lune en fin de défilement, clin d'œil à la Geheimnisnacht.
- **Textures entièrement procédurales** : aucune image n'est téléchargée pour la scène, tout est généré au chargement.
- **Thème sombre par défaut** : le thème sombre devient celui de tous les visiteurs, puisqu'il porte la scène. Les préférences enregistrées ont été réinitialisées une seule fois ; tout choix manuel fait ensuite avec le bouton ☀️/🌙 reste respecté.
- **Repli intégral sur le design classique** : la scène est ignorée sans WebGL, sur mobile (moins de 768 px), en thème parchemin, et pour les visiteurs préférant les animations réduites. Le site garde alors exactement son apparence précédente.
- **Ménagement des machines** : qualité réduite entre 768 et 1200 px, rendu en pause quand l'onglet est masqué, et passage à 30 images par seconde après cinq secondes sans défilement.

### Technique
- **Three.js 0.180.0** chargé par carte d'import depuis le CDN.

### PWA & Cache
- **Incrémentation du cache** : passage en `wfrp-cache-v7` avec les nouveaux fichiers de la scène.

## [2.12.0] - 2026-06-03

### Réflectorisation & Architecture ESM
- **Nettoyage de l'espace global (`window.*`)** : Suppression des assignations de variables globales dans `js/utils.js`. Les fonctions `esc`, `cap`, `stripAccents`, et `parseCSV` sont désormais importées explicitement dans les scripts sous forme de modules ES.
- **Modulisation Fiche & Cloud** : Connexion explicite en ES Modules entre `js/fiche.js` et `js/fiche-cloud.js` via imports/exports (suppression des liaisons via l'objet global `window`).
- **Allègement HTML** : Retrait de la balise script obsolète pour `js/utils.js` dans `fiche.html`, le script étant importé directement en JS.

### Authentification & Administration Centralisée
- **Création du service `js/auth.js`** : Regroupement de toute la logique de surveillance d'état d'authentification (`watchAuth`), de connexion (`loginWithGoogle`), de déconnexion (`logout`) et de vérification d'adresse administrateur.
- **Suppression de la redondance** : Remplacement des imports Firebase Auth en doublon et de la logique de connexion/déconnexion réécrite dans `pnjs.js`, `enquetes.js`, `doodle.js`, `calendar.js` et `fiche-cloud.js`.

### PWA & Cache
- **Incrémentation du cache** : Passage du cache en version `wfrp-cache-v6` pour rafraîchir immédiatement les fichiers du service worker.

## [2.11.8] - 2026-06-02

### Personnages
- **Mise en page du portrait** : Le portrait du personnage occupe désormais l'intégralité du rectangle de son conteneur (au lieu d'être rogné dans un cercle) pour éviter de couper les illustrations (chevelure, écus, équipements). Le format s'adapte aussi sur mobile sous forme de carte carrée à bords arrondis.

### PWA & Cache
- **Incrémentation du cache** : Passage du cache en version `wfrp-cache-v5` pour rafraîchir immédiatement les fichiers du service worker.

## [2.11.7] - 2026-06-02

### Personnages
- **Titre dynamique** : Le grand titre "FICHE DE PERSONNAGE" a été remplacé par le nom du personnage actif. Le titre de l'onglet du navigateur s'actualise également en direct.
- **Portraits des personnages** : Intégration d'un espace premium affichant le portrait du personnage (Bhelgi, Caelel, Elysia, Hellaya, Wren) de manière circulaire avec cadre doré et ombrage, s'adaptant automatiquement sur mobile (responsive) et s'intégrant au thème Parchemin.

### PWA & Cache
- **Incrémentation du cache** : Passage du cache en version `wfrp-cache-v4` pour rafraîchir immédiatement les fichiers du service worker.

## [2.11.6] - 2026-06-01

### Planification & Calendrier
- **Mode vertical par défaut** : La vue verticale est désormais activée par défaut pour faciliter la navigation sur de longues listes de dates.
- **Format vertical en cartes** : Refonte complète de la disposition verticale qui affiche chaque date sous forme de carte individuelle, masquant le tableau croisé volumineux par défaut.
- **Modale de détail des votes** : Ajout d'une modale interactive accessible en cliquant sur le compteur de votes d'une carte. Elle affiche les votants avec des avatars dynamiques et propose des filtres rapides (Tous/Oui/Non) ainsi que des boutons de modification/suppression directe.
- **Saisie du pseudo au-dessus** : Repositionnement ergonomique du champ de saisie du pseudo et du bouton de validation en haut à gauche (au-dessus des cartes).
- **Validation doublée** : Ajout d'un second bouton de validation du vote en bas de la liste des cartes pour un confort de vote optimal.
- **Synchronisation du pseudo** : Le pseudo saisi est conservé de manière bidirectionnelle lors de la bascule entre les formats horizontal et vertical.

### PWA & Cache
- **Incrémentation du cache** : Passage du cache en version `wfrp-cache-v3` pour rafraîchir immédiatement les fichiers du service worker.

## [2.11.5] - 2026-05-28

### Corrections
- **Fiche (Réinitialisation)** : Correction d'un bug où la réinitialisation cloud d'une fiche ne nettoyait pas le cache local, causant sa résurrection au rechargement de la page.
- **Fiche (Multi-personnages)** : Isolation du localStorage par personnage (clé dynamique incluant l'ID du personnage) pour éviter les conflits d'écrasement local lorsque plusieurs personnages sont ouverts sur le même navigateur.

## [2.11.4] - 2026-05-27

### Planification & Calendrier
- **Notification par email (MDJ)** : Écriture automatique dans la collection `mail` lors de la validation d'un vote joueur pour déclencher l'envoi d'une alerte au MDJ via l'extension Firebase Trigger Email.

## [2.11.3] - 2026-05-27

### Planification & Calendrier
- **Modification directe par les joueurs** : Ajout d'une icône crayon ✏️ cliquable par tous les joueurs à côté de leur nom pour pré-remplir le formulaire de vote avec leurs disponibilités actuelles.
- **Alerte de confirmation de modification** : Demande de confirmation `"Tu t'apprêtes à modifier les disponibilités de xxx, est-ce bien toi ?"` en cas de soumission avec un pseudo déjà existant (insensible à la casse, évite les doublons et les écrasements accidentels).

## [2.11.2] - 2026-05-27

### Planification & Calendrier
- **Refonte de l'interface MDJ (Doodle)** : Séparation claire entre l'interface de création de nouveau sondage et les contrôles de gestion du sondage actif pour éviter les confusions d'affichage.
- **Contrôles de sondage actif** : Ajout de boutons d'administration pour modifier les dates du sondage en cours, clôturer ou réouvrir les votes (avec bannière de statut dynamique et verrouillage des inputs), et supprimer le sondage actif.
- **Suppression de réponses individuelles** : Ajout d'icônes poubelles cliquables par le MDJ directement dans le tableau à côté de chaque joueur pour nettoyer ou corriger des votes.
- **Améliorations de style et lisibilité** : Élargissement de la colonne "Joueurs" à 180px, fixation d'une largeur minimale de 120px sur les colonnes de dates pour éviter les retours à la ligne intempestifs (maximum 2 lignes), et intégration d'une barre de défilement horizontale dorée visible en permanence.

## [2.11.1] - 2026-05-27

### PWA & Cache
- **Résolution des problèmes de cache persistants** : Refonte de la stratégie de fetch du Service Worker. Utilisation de la stratégie *Network First* combinée avec l'option `{ cache: 'no-cache' }` pour toutes les ressources locales de code (HTML, CSS, JS), empêchant le cache HTTP du navigateur de renvoyer des pages obsolètes.
- **Stale-While-Revalidate** : Remplacement de la stratégie *Cache First* par *Stale-While-Revalidate* pour les assets non-code (images locales, polices de caractères, CDNs), permettant leur mise à jour silencieuse en tâche de fond.
- **Enregistrement optimisé** : Enregistrement du Service Worker avec l'option `{ updateViaCache: 'none' }` dans `js/main.js` pour forcer le navigateur à vérifier les mises à jour de `sw.js` directement sur le réseau.
- **Incrémentation du cache** : Passage du cache en version `wfrp-cache-v2` pour purger automatiquement les fichiers obsolètes stockés dans le cache des navigateurs clients.

## [2.11.0] - 2026-05-27

### Planification & Calendrier
- **Sondage Doodle (Planification de sessions)** : Ajout d'une nouvelle page "Calendrier" permettant de créer des sondages de dates pour planifier les parties.
- **Vote public en temps réel** : Les joueurs peuvent indiquer leurs disponibilités de manière anonyme et en temps réel grâce à une écoute Firestore active, sans connexion Google obligatoire.
- **Panneau Admin MDJ** : Possibilité pour le MDJ (David) de lancer un nouveau sondage (saisie de dates libre séparée par des virgules) et de supprimer le sondage actif depuis son interface d'administration sécurisée.
- **Intégration et UX** : Nouvelle entrée "Calendrier" dans la barre de navigation, tableau des votes synchronisé en temps réel avec indicateur de totaux de présence et design parchemin/sombre avec styles d'interactions or.

## [2.10.0] - 2026-05-27

### Personnages
- **Fiches de Personnages Individuelles** : Les joueurs disposent désormais de leur propre fiche accessible depuis "Le Groupe", sauvegardée indépendamment sur Firebase.
- **Sécurité et Authentification** : Séparation des sauvegardes dans le cloud (Firebase Firestore) selon le nom du personnage. Accès sécurisé côté client pour le Maître de Jeu, et base préparée pour autoriser les emails des joueurs individuellement.
- **Fiche de Test** : Maintien de l'icône Parchemin dans "Le Groupe", redirigeant désormais vers la page de test `fiche.html?char=test`.

## [2.9.0] - 2026-05-26

### Améliorations Techniques & UX
- **PWA** : Ajout d'un manifeste et d'un Service Worker pour permettre l'installation de l'application et le cache hors-ligne.
- **Modules JS** : Uniformisation du JavaScript avec l'utilisation de modules ES6 (<script type="module">).
- **CSS** : Découpage du fichier monolithique style.css en fichiers séparés (ase.css, layout.css, components.css, pnjs.css) pour une meilleure maintenabilité.
- **PNJs (Graphe D3)** : Accentuation de l'effet de focus (assombrissement plus fort des nœuds non connectés au clic).
- **Animations & UX** : Ajout de micro-animations (survol des cartes, ouverture de modales en popIn).
- **Responsive** : Ajustements des conteneurs du graphe D3 et des cartes Leaflet pour une meilleure manipulation sur mobile.
## [2.8.2] - 2026-05-26

### Thème Parchemin (Clair) & Accessibilité
- **PNJs (Graphe)** : Correction du contraste des nœuds. Le fond des cadres (`.node-card`) n'est plus noir mais s'adapte au thème (blanc chaud `#faf4e8` sur parchemin) afin de rendre les noms en brun foncé parfaitement lisibles.
- **PNJs (Portrait placeholders)** : Le fond des cercles placeholders de portrait s'adapte désormais au thème (`var(--bg-surface)`) pour contraster avec les initiales.
- **PNJs (Badges et chips)** : Refonte des teintes de statut (allié, ennemi, neutre, vivant, décédé, inconnu) et de relations (mentor, rival, etc.) pour utiliser des variables CSS adaptées à fort contraste (ratio > 4.5:1 WCAG AA) sur le thème parchemin.
- **PNJs (Luminosité dynamique)** : La fonction `stringToColor` adapte automatiquement la luminosité des teintes calculées pour les relations personnalisées en fonction du thème actif.
- **PNJs (Texture)** : Application de la texture grain fin au conteneur du graphe `#pnj-graph` pour l'unifier visuellement avec le reste du site.
- **Indices & Fiches** : Amélioration du contraste des boutons danger, des chips d'indices (Page Enquêtes) et des badges de statut cloud (Page Fiche).

## [2.8.1] - 2026-05-26

### Corrections & Audit technique
- **Fiche (Race condition)** : Résolution d'une faille de chargement concurrent entre le cache local (localStorage) et Firestore. L'initialisation attend désormais le chargement complet des bases de données JSON (`careers.json` et `skills.json`) et évite d'exécuter le rendu local si les données cloud ont déjà pris le dessus, ce qui provoquait une duplication des listes de compétences/talents/XP et la corruption de la fiche.
- **PNJs (Marqueurs SVG)** : Correction de la génération des IDs des marqueurs de flèches SVG. Les couleurs de relation en HSL (générées dynamiquement) contenaient des parenthèses et virgules invalides qui cassaient les liens D3. Les identifiants sont désormais nettoyés et purement alphanumériques.
- **PNJs (Vue Tableau)** : Rafraîchissement automatique et immédiat des boutons d'édition administrative sur la vue tableau lors d'une connexion ou déconnexion.
- **Enquêtes (Race condition)** : Ajout d'une sécurité par ID de chargement unique dans `enquetes.js` pour éliminer tout conflit d'exécution en parallèle des requêtes Firestore (par exemple, lors d'un login ultra-rapide).
- **Groupe** : Suppression du sous-titre de test temporaire sous le bouton "Fiche HTML".

## [2.8.0] - 2026-05-26

### Sécurité (CSP) — Authentification Firebase
- **Fix Firebase Auth** : résolution de l'erreur `Firebase: Error (auth/internal-error)` lors de la connexion Google en autorisant les scripts `'unsafe-inline'` et les connexions/frames vers les domaines nécessaires (`https://*.firebaseapp.com`, `https://apis.google.com`, `https://accounts.google.com`, `https://www.google.com`) dans les directives `script-src`, `connect-src` et `frame-src` de la politique de sécurité du contenu (CSP) de toutes les pages.
- **Sécurisation du Carnet d'Enquêtes** : ajout de la balise meta CSP sur la page `enquetes.html` avec les mêmes règles de sécurité adaptées.

### Carnet d'Enquêtes
- **Nouvelle page d'enquêtes** (`enquetes.html` / `js/enquetes.js`) : interface interactive pour le suivi des indices découverts durant la campagne.
- **Mode Administration** : bouton d'accès admin Google avec formulaires d'ajout/édition d'indices (titre, description, illustration facultative par image, statut de découverte, liaison dynamique avec la liste des PNJs).
- **Filtrage et recherche** : recherche d'indices par mots-clés et filtres rapides (tous / découverts / secrets pour l'administrateur).

### Calendrier Impérial
- **Widget sur l'accueil** : intégration d'un widget de calendrier impérial interactif sur la page d'accueil (gérant les mois, phases de lunes et événements spéciaux de la campagne).

### Technique & Données
- **Données compétences (JSON)** : transition de `skills.js` vers un format structuré `skills.json` avec validation par l'intégration continue. Ajout de compétences et spécialités manquantes.
- **Factorisation** : centralisation des parseurs CSV et utilitaires de texte dans `js/utils.js`.
- **PNJs** : correction d'un bug de réinitialisation de couleur de la légende dans le graphe PNJ lors des changements de snapshot de couleur.

---

## [2.7.0] - 2026-05-21

### Fiche — Multi-utilisateur & Centralisation Firebase
- **Fiches multi-utilisateurs** : suppression des restrictions d'adresse email codées en dur côté client. Tout utilisateur connecté via Google dispose désormais de sa propre fiche sauvegardée dans son espace cloud Firestore (`fiches/{uid}`).
- **Centralisation technique** : regroupement de l'initialisation de Firebase et du chargement des services dans un module unique `js/firebase-init.js` partagé.
- **Robustesse DOM (PNJ)** : sécurisation du ciblage du message de chargement/erreur sur `#pnj-loading` pour éviter les crashs si le squelette HTML est modifié.

---

## [2.6.0] - 2026-05-20

### Fiche — Personnalisation par-fiche d'une carrière
- **Mode édition par rang** : bouton **✎ Personnaliser** dans le header de chaque rang du panneau de référence. Active des contrôles d'édition sans toucher à la base de données globale — utile quand le MJ accorde une modification spécifique à un joueur (échanger une compétence de carrière contre une autre, p. ex.)
- **Retirer une compétence/talent** : en mode édition, un `×` apparaît sur chaque chip pour la retirer. Les chips retirées s'affichent barrées en édition (avec un `↺` pour restaurer), et sont masquées en mode normal
- **Ajouter une compétence/talent custom** : champ avec autocomplétion (datalist) en bas de chaque liste — les ajouts s'affichent avec un ★ vert et participent à la détection « dans la carrière » pour les achats XP
- **Badge ✎ modifié** dans le header des rangs personnalisés, en mode normal — repère visuel pour ne pas oublier qu'on a divergé du livre
- **Persistance** : les overrides sont stockés dans `state.careerOverrides[careerId][rang]` (sync cloud + localStorage). Indépendants par fiche : changer la carrière courante ou réimporter la base globale les laisse intacts
- Comportement intégré aux helpers existants : `isSkillInCareer`, `isTalentInCareer`, `getCareerAllSkills`, highlighting, ghost rows — tous tiennent compte des overrides

---

## [2.5.0] - 2026-05-20

### Fiche — Base de données complète des carrières
- **132 carrières** importées depuis le Google Sheet (Livre de base, Dwarf Player Guide, High Elf Player Guide, Deft Steps, Up in Arms, Winds of Magic, Archives 1-3, Middenheim) en remplacement des 3 carrières mock initiales — couverture exhaustive du panneau de référence carrière, autocomplétion et détection « dans la carrière »
- **Script d'import** (`tools/import-careers.mjs`) qui fetche le sheet, normalise les apostrophes typographiques, regroupe les variantes et régénère `js/data/careers.js` — relancer après chaque modification du sheet pour synchroniser
- **Variantes de rang** : certains rangs ont plusieurs versions (ex: rang 2 d'Artisan a la version « Artisan » classique et « Façonneur de Pierre » du Dwarf PG). Le panneau de référence affiche un sélecteur de variante quand plusieurs sont disponibles ; le choix est persisté dans `chosenVariants` et utilisé pour la détection « dans la carrière » et le highlighting
- **Sous-carrières avec prérequis** : les 3 sous-carrières de Mage (HE) (Prêtre-Forgeron de Vaul, Tisseur de Tempêtes, Maître du Savoir de Hoeth) affichent un bandeau « Prérequis : Mage (HE) — rang 2 minimum » informatif (non bloquant — la règle de jeu se fait à l'oral)
- **Comportement généreux par défaut** : tant qu'une variante n'a pas été explicitement choisie, toutes les variantes du rang sont considérées comme « dans la carrière » pour éviter les faux négatifs pendant les achats XP

### Compétences & spécialisations ajoutées
- Nouvelles compétences : `Augure`, `Psychométrie` (Winds of Magic)
- Nouvelles spécialisations : `Voile (Skycraft)`, `Conduite (Skycutter)`, `Soins aux animaux (Roc)` (Dwarf / High Elf Player Guides)

### Technique
- Bug pré-existant corrigé : `});` orphelin dans `bindAll()` qui fermait la fonction prématurément ; les listeners `btn-add-sort` / `btn-add-priere` / `btn-add-xp(-gain)` / toggles de sections optionnelles sont maintenant bien dans le scope de la fonction
- Le rang max d'une carrière est désormais lu dynamiquement (Mage HE va jusqu'à 5, les autres restent à 4)

---

## [2.4.3] - 2026-05-06

### PNJs — Étiquette unique sur lien bidirectionnel
- **Label unique** : un lien bidirectionnel (A→B + B→A) chevauchant naturellement, seule l'étiquette du premier sens est affichée — plus de doublon de texte au milieu de la courbe

---

## [2.4.2] - 2026-05-06

### PNJs — Directionnalité des liens
- **Flèches sur les liens** : chaque lien porte un embout flèche (marqueur SVG) coloré de la même teinte que le lien, pointant vers le personnage cible
- **Liens partant/arrivant sur les bordures des cartes** : les chemins bezier sont tronqués aux bordures des cartouches (calcul de l'intersection tangente/rectangle) — plus de traits qui commencent ou finissent au centre d'une carte
- **Bidirectionnel** : nouvelle case à cocher dans le formulaire de création — si cochée, deux records Firestore sont créés (A→B et B→A) ; les deux liens reçoivent chacun une flèche et s'écartent naturellement grâce aux courbes anti-chevauchement

---

## [2.4.1] - 2026-05-06

### PNJs — Liens (suite)
- **Palette 16 couleurs** : le sélecteur de couleur du lien est remplacé par une palette de 16 teintes douces — swatches cliquables avec indicateur d'état actif
- **Liens parallèles non chevauchants** : deux liens entre les mêmes personnages courbent dans des directions opposées (courbes de Bézier avec échelle alternée ×1/−1/×2/−2…)
- **Édition de relation** : en mode admin, un bouton ✏ apparaît sur chaque relation du panneau latéral pour modifier type, label, couleur et style sans recréer la relation

---

## [2.4.0] - 2026-05-06

### PNJs — Vue graphe refonte (carte mentale)
- **Cartouches** : les nœuds circulaires sont remplacés par des cartes rectangulaires affichant portrait, nom et statut · lieu
- **Barre accent** : une barre colorée à gauche de chaque carte reflète le colorBy actif (statut, lieu ou groupe)
- **Liens en courbes** : les liens droits sont remplacés par des courbes de Bézier quadratiques
- **Labels sur les liens** : le type ou label de la relation est affiché directement sur le lien (textPath SVG)
- **Épinglage après déplacement** : glisser une carte la fixe en place (comportement carte mentale) ; au chargement initial, le layout s'auto-stabilise puis se fige
- **Trait plus épais** : stroke-width des liens passé à 3.5px (était 2px)

### PNJs — Personnalisation des liens
- **Couleur custom** : color picker dans le formulaire "Ajouter une relation" — la couleur est stockée dans Firestore et appliquée dans le graphe et les chips du panneau détail
- **Style continu / pointillé** : toggle ━━ / ╌╌ pour choisir le style du trait au moment de la création
- Compatibilité ascendante : les relations existantes sans couleur ni style continuent d'utiliser les couleurs par type (allié, ennemi, famille…)

---

## [2.3.0] - 2026-05-06

### Fiche — Journal XP repensé
- **Gains XP journalisés** : nouveau bouton "+ Gain XP" — raison + montant — les gains s'affichent en vert dans le journal
- **XP Total calculé automatiquement** : la somme des entrées de gain remplace le champ manuel
- **XP Disponible = Total gagné − Total dépensé**, tous deux issus du journal
- **Migration automatique** : les anciennes fiches avec un `xpTotal` manuel sont converties en entrée "XP initial (migré)" au premier chargement
- Raccourcis clavier dans le formulaire de gain (Entrée pour passer au champ suivant / valider)

---

## [2.2.1] - 2026-05-01

### Fix
- **Perte de données corrigée** : synchronisation cloud/local basée sur les timestamps — si les données locales sont plus récentes que le cloud (ex: modification dans la fenêtre de debounce de 2s), elles sont conservées et poussées vers le cloud plutôt qu'écrasées
- `save()` enregistre désormais `_savedAt: Date.now()` dans le localStorage pour comparaison
- `ficheLoadCloud` reçoit le timestamp Firestore (`updatedAt`) et préfère la source la plus fraîche

---

## [2.2.0] - 2026-04-30

### Fiche — Section Talents refonte
- **Talents acquis en chips cliquables** : chaque talent s'affiche comme un badge cliquable qui ouvre directement la modale de description — plus d'entrée texte ni de colonne Notes
- **Badge hors carrière** : un marqueur `!` orange signale les talents acquis hors carrière (info préservée dans le state)
- **Ajout manuel** : le bouton "+ Ajouter manuellement" insère un champ de saisie inline ; dès que le nom est confirmé, il devient un chip cliquable
- **Section "Talents achetables" supprimée** : redondante avec le panneau de référence carrière et le journal XP

---

# Changelog

Toutes les modifications notables du site sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/).

---

## [2.1.2] - 2026-04-30

### Fiche de Personnage — Talents "au choix"
- **Sélecteur de spécialisation pour les talents** : quand on saisit le nom de base d'un talent qui existe en version "au choix" dans une carrière (ex: "Maître artisan"), un sélecteur de spécialisation apparaît automatiquement avec les variantes connues + "Autre (personnalisé)…"
- **Persistance `customTalents`** : une spécialisation de talent saisie manuellement est mémorisée et réapparaît dans le sélecteur aux prochains achats (sauvegardée dans le cloud)
- **Détection carrière** : `isTalentInCareer("Maître artisan (Forgeron)")` reconnaît le talent comme dans la carrière si celle-ci possède "Maître artisan (au choix)"

---

## [2.1.1] - 2026-04-30

### Fiche de Personnage — Carrières
- **Surbrillance des compétences avancées achetées** : les compétences avancées déjà achetées qui font partie de la carrière active sont maintenant surlignées comme les compétences de base
- **Panneau carrière cumulatif** : à partir du rang 2, le panneau de référence affiche tous les rangs acquis (rang 1, rang 2…) avec leurs compétences et talents respectifs, plus le rang en cours — chaque rang passé est marqué "✓ acquis"

---

## [2.1.0] - 2026-04-30

### Fiche de Personnage — Carrières & Compétences
- **Spécialisations personnalisées persistantes** : une spécialisation saisie manuellement dans le journal XP est mémorisée dans `customSpecs` et réapparaît dans le dropdown lors des prochains achats (sauvegardée dans le cloud)
- **Slots "au choix"** : les entrées carrière de type `Métier (au choix)` ou `Savoir (Région)` sont détectées automatiquement ; un tel slot est considéré rempli dès qu'une compétence du même groupe de base est achetée — plus besoin de les saisir deux fois
- **Ghost rows cliquables** : cliquer sur une compétence carrière grisée (non achetée) ouvre directement le formulaire XP pré-rempli avec le bon groupe et la spécialisation ; les slots ouverts s'affichent en ambre avec une `★`
- **Fix correspondance carrière** : `isSkillInCareer()` utilise désormais le match exact par défaut ; le match par groupe de base ne s'applique qu'aux slots ouverts (évitait de faux positifs entre, p.ex., Corps à corps Base et Corps à corps Flambard)
- **Talents "au choix"** : un talent de carrière de type `Savoir-vivre (au choix)` reconnaît tout talent du même groupe comme étant dans la carrière

---

## [2.0.0] - 2026-04-30

### Sauvegarde cloud — Fiche de Personnage
- **Firebase Auth** : bouton "Connexion Google" dans l'en-tête de la fiche ; seul `ethoril@gmail.com` est autorisé pour l'instant
- **Firestore** : la fiche est sauvegardée dans `fiches/{uid}` avec debounce 2 s après chaque modification ; rechargement automatique au login
- **Fallback localStorage** : si non connecté, la fiche continue de se sauvegarder localement ; la connexion charge le cloud par-dessus
- **Fix bug** : les avances des compétences de base ne se restoraient pas après rechargement de page (`buildBasicSkills` s'exécutait avant `load`) — corrigé en inversant l'ordre d'init

### Technique
- `exportData()` / `resetState()` / `applyData()` extraits de `save()` / `load()` pour permettre le rechargement propre depuis le cloud
- `js/fiche-cloud.js` : nouveau module ES isolé pour toute la logique Firebase de la fiche

> **Règle Firestore à ajouter manuellement** dans la console Firebase :
> ```
> match /fiches/{userId} {
>   allow read, write: if request.auth != null && request.auth.uid == userId;
> }
> ```

---

## [1.9.3] - 2026-04-29

### Fiche — Carrière & Talents
- **Highlighting** : les colonnes de caractéristiques liées à la carrière et les lignes de compétences de base concernées sont mis en évidence par une couleur de fond
- **Compétences avancées fantôme** : les compétences avancées de la carrière (rangs 1 au rang actuel) non encore achetées apparaissent en grisé dans la section avancées — non éditables tant qu'elles ne sont pas achetées via le journal XP
- **Modale talent** : cliquer sur un talent dans le panneau de carrière ouvre une modale avec sa description complète (chargée depuis le même Google Sheet que l'aide de jeu)
- **Races corrigées** : Humain.e / Elfe Sylvain.e / Haut.e Elfe / Halfelin.ne / Ogre

---

## [1.9.2] - 2026-04-29

### Fiche — Carrière
- **Autocomplétion** : le champ "Carrière actuelle" propose les carrières connues de la base de données
- **Panneau référence carrière** : quand une carrière reconnue est saisie, un panneau s'affiche avec les caractéristiques, compétences et talents disponibles pour le rang sélectionné

---

## [1.9.1] - 2026-04-29

### Correctif
- **Hotfix `window.WFRP_SKILLS`** : `const` en balise `<script>` ne s'attache pas à `window` — ajout de `window.WFRP_SKILLS`, `window.WFRP_SKILL_GROUPS_WITH_SPECS` et `window.WFRP_CAREERS` à la fin des fichiers de données pour que toutes les fonctions de `fiche.js` (autocomplete, dropdown groupe/spéc, détection carrière) fonctionnent correctement

---

## [1.9.0] - 2026-04-29

### Données & compétences
- **`skills.js` complet** : 158 entrées (44 de base + 114 avancées) issues du sheet officiel — chaque spécialisation est une entrée distincte avec `group`, `spec`, `nom`, `carac`, `basic`
- **`BASIC_SKILLS` corrigé** : 25 compétences conformes au sheet (suppression des erreurs d'édition, ajout Chevaucher/Divertissement/Orientation/Ramer/etc., Corps à corps affiché comme "Corps à corps (Base)")

### Journal XP — sélecteur à deux niveaux
- **Groupe → Spécialisation** : le formulaire d'achat propose d'abord le groupe de compétence, puis un dropdown des spécialisations connues issues de la DB
- **Option "Autre (personnalisé)…"** : permet de créer une nouvelle spécialisation non listée
- Coût distingué : compétences de base 5/10/15… XP, avancées 10/15/20… XP
- Détection "dans la carrière" mise à jour pour le nouveau sélecteur

### Compétences avancées — autocomplete
- Le champ de nom de compétence avancée supporte maintenant `<datalist>` avec les 158 compétences de la DB
- La caractéristique est **auto-remplie** quand un nom reconnu est sélectionné

---

## [1.8.0] - 2026-04-28

### Ajouté — Système d'avancement XP (fiche de personnage)
- **Base de données compétences** (`js/data/skills.js`) : 31 compétences de base + 27 avancées avec carac associée et flag spécialisation
- **Base de données carrières** (`js/data/careers.js`) : 3 carrières initiales (Agitateur, Artisan, Bourgeois) avec 4 rangs chacune — compétences et talents par rang
- **Calme & Ragot** ajoutés aux compétences de base du tableau de fiche
- **Formulaire d'achat XP transactionnel** : sélection guidée (type → cible → avances) avec calcul automatique du coût selon les règles WFRP4 (tranches 25/30/40/50/70/90 pour les caracs, 5/10/15/20/25/30 pour les compétences — ×2 hors carrière)
- **Détection automatique "dans la carrière"** : la case est pré-cochée si la compétence/carac/talent figure dans la carrière active au rang actuel
- **Application immédiate sur la fiche** : valider un achat met à jour la carac, la compétence ou le talent directement
- **Annulation avec revert** : supprimer une entrée appliquée (badge ✓) revient en arrière sur la fiche

---

## [1.7.1] - 2026-04-29

### Amélioré — Fiche de personnage
- **Fortune → Chance** (renommage)
- **Historique des carrières** : tableau d'anciennes carrières (nom, rang atteint, notes)
- **Sorts** : section optionnelle (masquée par défaut) avec nom, vent de magie, CN, portée, durée, résumé
- **Prières & Miracles** : section optionnelle avec type (Bénédiction / Miracle) et résumé
- **Journal XP** : tableau de dépenses avec type, achat, coût — XP dépensé auto-calculé depuis le journal
- **Talents** : tableaux "Acquis" et "Achetables" éditables (ajout/suppression dynamique)

---

## [1.7.0] - 2026-04-29

### Ajouté
- **Fiche de personnage HTML** (`fiche.html`) : première version interactive
  - 10 caractéristiques avec base / avances / total auto-calculé
  - Stats dérivées : Mouvement (selon race), Blessures max (FB + 2×EB + FMB), trackers éditables
  - 29 compétences de base avec valeur de caractéristique et total auto-calculés
  - Compétences avancées ajoutables dynamiquement
  - Sections Talents et Possessions
  - Sauvegarde automatique en localStorage
- **Le Groupe** : 6ème carte "Fiche HTML" pointant vers `fiche.html`

---

## [1.6.12] - 2026-04-28

### Supprimé
- **Footer** : retrait de l'attribution Vecteezy (SVG texture non utilisé)

---

## [1.6.11] - 2026-04-28

### Ajouté
- **Vidéos** : 3 nouveaux épisodes — Middenheim : La Cité du Loup Blanc (7), Les Vents de Magie (8), Les Voisins de l'Empire (9)

---

## [1.6.10] - 2026-04-28

### Corrigé
- **Le Groupe** : suppression du `max-width: 1100px` codé en dur sur `.character-grid` — la grille utilise désormais toute la largeur du conteneur (1600 px)

---

## [1.6.9] - 2026-04-28

### Modifié
- **Mise en page** : largeur maximale étendue de 1200 px à 1600 px — meilleure utilisation de l'espace sur les écrans larges, mobile inchangé

---

## [1.6.8] - 2026-04-28

### Modifié
- **Thème parchemin — fond** : suppression du SVG Vecteezy, remplacement par un dégradé CSS en trois teintes (#E9DDC3 → #E7DAC1 → #E2D7BB)

---

## [1.6.7] - 2026-04-28

### Amélioré
- **Thème parchemin — texture réelle** : remplacement de la texture CSS générée par un SVG Vecteezy (photo parchemin IA embarquée en base64) — `cover` + `fixed` pour remplir l'écran
- **Attribution** : lien Vecteezy ajouté dans le footer, affiché uniquement en thème parchemin

---

## [1.6.6] - 2026-04-28

### Corrigé
- **Navbar desktop** : `white-space: nowrap` + `flex-shrink: 0` sur le brand et les liens — "LE GROUPE" et "AIDES DE JEUX" ne se replient plus sur deux lignes
- **Navbar desktop** : padding horizontal des liens réduit (16 px → 10 px) pour laisser plus de place
- **Accueil** : `card-grid` minmax 300 px → 260 px — les 4 cartes tiennent sur une ligne dans un conteneur 1200 px

---

## [1.6.5] - 2026-04-28

### Amélioré
- **Thème parchemin — texture** : fond de page avec fibres horizontales et surfaces (cartes, panneaux, modals) avec grain fin, générés en CSS pur via filtre SVG `feTurbulence` (aucun fichier image supplémentaire)

---

## [1.6.4] - 2026-04-28

### Ajouté
- **Thème parchemin** : deuxième thème visuel clair (tons papier vieilli, bordeaux foncé) activable via un bouton ☀️/🌙 dans la navbar — persisté en localStorage sur toutes les pages

---

## [1.6.3] - 2026-04-28

### Amélioré
- **Graphe PNJs** : les nœuds affichent désormais le portrait du personnage clipé en cercle, avec un anneau coloré indiquant le statut (ou la dimension active). Fallback sur le cercle coloré pour les PNJs sans portrait. Anneau pointillé conservé pour les décédés.

---

## [1.6.2] - 2026-04-28

### Ajouté
- **Cadrage portrait** : sélecteur de rognage carré (Cropper.js) affiché au moment de l'upload — permet de choisir la zone à conserver avant sauvegarde

---

## [1.6.1] - 2026-04-28

### Corrigé
- **Portraits PNJs** : remplacement d'Uploadcare (clé invalide, images en 404) par Firebase Storage (`europe-west9`) — upload et affichage des portraits fonctionnels

---

## [1.6.0] - 2026-04-28

### Technique
- **État centralisé** : les 12 variables globales de `pnjs.js` regroupées dans un objet `state` — débogage et lisibilité améliorés
- **Fusion loadData/reloadData** : une seule fonction `loadData({ init })` remplace les deux — moins de duplication, gestion d'erreur unifiée
- **Délégation d'événements** : le panneau de détail PNJ utilise un unique listener sur le conteneur statique au lieu de rebinder 6-8 handlers à chaque ouverture
- **Module utils.js** : `esc`, `cap`, `stripAccents` extraits dans un module partagé — suppression des doublons entre `pnjs.js` et `sheets.js`
- **Recherche insensible aux accents (PNJs)** : "elysia" trouve désormais "Élysia" dans le graphe et le tableau

---

## [1.5.0] - 2026-04-27

### Ajouté
- **PNJs éditable** : les données sont désormais stockées dans Firestore (Firebase) au lieu de Google Sheets
- **Authentification Google** : bouton "Admin" en toolbar — connexion via Google OAuth (email autorisé uniquement)
- **Création / modification de PNJ** : modal complet avec nom, statut, vivant, lieu, groupe social, description, portrait (upload Uploadcare)
- **Suppression de PNJ** : cascade sur toutes les relations du personnage (batch Firestore)
- **Ajout de relation** : formulaire inline dans le panneau de détail (cible, type, label)
- **Suppression de relation** : bouton × sur chaque chip de relation (mode admin)
- **Upload portrait** : hébergement via Uploadcare (serveurs européens, GDPR), URL CDN WebP 500 px stockée dans Firestore
- **État vide** : message affiché si Firestore ne contient aucun PNJ
- Bouton ✏ dans le panneau de détail et la vue tableau (admin uniquement)

### Technique
- `js/pnjs.js` converti en module ES (`type="module"`) — D3 importé via jsDelivr ESM, Firebase v10.12.0 via gstatic CDN
- Suppression du tag `<script src="d3.v7.min.js">` dans `pnjs.html` (import géré dans le module)
- Champs Firestore en minuscules : `nom, statut, vivant, lieu, groupe, description, imageUrl`

---

## [1.4.2] - 2026-04-27

### Corrigé
- **PNJs** : ajout de `main.js` manquant sur `pnjs.html` (toolbar et header invisibles à cause du `fade-in` non déclenché)
- **PNJs** : direction des relations affichée dans le panneau de détail (`→` si le PNJ courant est source, `←` s'il est cible)

---

## [1.4.1] - 2026-04-27

### Amélioré (PNJs)
- **Toggle Graphe / Tableau** : bascule entre le réseau interactif et un tableau trié par clic sur les en-têtes
- **Couleur par** : boutons Statut / Lieu / Groupe recolorent les nœuds et animent un clustering spatial par force D3
- Recherche textuelle active dans les deux vues (graphe et tableau)
- Filtres actifs appliqués au tableau
- Compteur de résultats en vue tableau
- Descriptions tronquées dans le tableau avec texte complet au survol

---

## [1.4.0] - 2026-04-27

### Ajouté
- **Page PNJs** : réseau interactif force-directed (D3.js) des personnages non-joueurs de la campagne
- Données pilotées par deux onglets Google Sheets (`pnjs` et `relations`)
- Filtres dynamiques par Statut, Vivant, Lieu et Groupe Social
- Recherche textuelle par nom et description
- Panneau de détail latéral avec portrait, badges, description et relations cliquables
- Navigation entre fiches PNJs via les chips de relations
- Nœuds à opacité réduite pour les PNJs décédés (cercle en pointillés) ou au statut inconnu
- Légende intégrée dans le graphe

---

## [1.3.1] - 2026-04-27

### Ajouté
- **Favicon** : icône ⚜ SVG (fleur de lys dorée sur fond sombre) affichée dans l'onglet du navigateur sur toutes les pages

---

## [1.3.0] - 2026-04-27

### Ajouté
- **Page "Cartes"** : nouvelle page avec visionneuse interactive (Leaflet.js) pour deux cartes haute résolution
- **Carte de l'Empire** : 14 400×14 400 px, 1 365 tuiles WebP sur 6 niveaux de zoom
- **Carte du Vieux Monde** : 32 000×28 050 px, 1 253 tuiles WebP sur 6 niveaux de zoom
- Lien "Cartes" ajouté à la navigation sur toutes les pages

---

## [1.2.5] - 2026-04-27

### Corrigé
- **Aides de Jeux** : l'onglet "Coûts XP" localise désormais ses colonnes par nom de header — résistant aux réorganisations du Google Sheet
- **Règles** : fermeture d'un accordéon après ouverture d'une table de critique s'anime correctement (transition fluide au lieu d'un saut)

---

## [1.2.4] - 2026-04-27

### Corrigé
- **Aides de Jeux** : échappement HTML sur toutes les valeurs injectées depuis Google Sheets — une cellule contenant `<` ou `>` ne peut plus briser la mise en page
- **Accueil** : suppression du texte "(soon™ pour ça)"

---

## [1.2.3] - 2026-04-27

### Amélioré
- **Accueil** : date de la prochaine session lue dynamiquement depuis Google Sheets (onglet "date prochaine session", cellule B1) — plus besoin de modifier le code pour la mettre à jour

---

## [1.2.2] - 2026-04-27

### Amélioré
- **Le Groupe** : portraits convertis en WebP (-96% de poids, 18 MB → 774 KB) avec fallback PNG pour les navigateurs anciens
- **Le Groupe** : attribut `loading="lazy"` ajouté sur tous les portraits

---

## [1.2.1] - 2026-04-27

### Modifié
- **Technique** : navbar et footer centralisés dans `js/layout.js` (source unique pour la version, les liens de navigation et le contenu du footer)

---

## [1.2.0] - 2026-03-29

### Ajouté
- **Le Groupe** : les vignettes de personnages sont désormais cliquables et ouvrent la fiche de perso Google Sheets correspondante (nouvel onglet)

---

## [1.1.1] - 2026-02-28

### Ajouté
- **Aides de Jeux** : 2 nouveaux onglets — Armures (🛡️) et Talents (🎭)

---

## [1.1.0] - 2026-02-27

### Ajouté
- **Page "Le Groupe"** : nouvelle page avec les portraits des 5 personnages (Bhelgi, Caelel, Elysia, Hellaya, Wren) en vignettes circulaires
- Lien "Le Groupe" ajouté à la navigation sur toutes les pages

---

## [1.0.0] - 2026-02-27

### Amélioré
- **Accueil mobile** : espaces réduits pour voir les cartouches sans scroller
- **Aides de Jeux** : bouton "Ouvrir dans Google Sheets (idéal sur PC)" déplacé au-dessus des onglets
- **Magie** : fond des cartouches de sort teinté selon le Vent de Magie (Aqshy=rouge, Azyr=bleu, Chamon=or, Ghur=ambre, Ghyran=vert, Hysh=blanc, Shyish=violet, Ulgu=gris)

---

## [0.11.0] - 2026-02-27

### Ajouté
- **Tables de Mutations** dans la section Corruption : Physiques (55 entrées), Sous-tableau Tête Bestiale (10 animaux), Mentales (34 entrées)
- Colonnes par Dieu du Chaos (Universel, Khorne, Nurgle, Slaanesh, Tzeentch)
- Notes de visibilité (¹ cachable, ² démarche, ³ incachable)

---

## [0.10.0] - 2026-02-27

### Ajouté
- **Tables des Incantations Imparfaites** : 2 tables collapsibles (Mineures + Majeures, 20 entrées chacune) dans la section Magie

### Modifié
- Section "Blessures & Coups Critiques" renommée → "Santé, Critiques et Survie"

---

## [0.9.0] - 2026-02-27

### Ajouté
- **Tables des Coups Critiques** : 4 tables collapsibles (Tête, Bras, Corps, Jambe) dans la section Combat
- Section renommée "Localisation des dégâts & Tables Critiques"
- Chaque table avec 20 entrées (D100, Nom, Effet)

---

## [0.8.0] - 2026-02-27

### Corrigé
- Onglet Coûts XP : séparation en 2 tableaux distincts + correction coût "+1 Talent" manquant
- Recherche insensible aux accents (ex: "regeneration" → "régénération")
- Gestion des CSV corrompus par le format de cellules Google Sheets
- Onglets en wrap (multi-lignes) sur mobile, plus de scroll horizontal

---

## [0.7.0] - 2026-02-27

### Ajouté
- **Aides de Jeux dynamique** : remplacement de l'iframe Google Sheets par un affichage custom
- 6 onglets cliquables (Coûts XP, Magie, Miracles, Armes CàC, Armes à Distance, Mots Clés)
- Données chargées en temps réel depuis Google Sheets (API CSV)
- Cartes responsives pour chaque sort, arme, miracle
- Barre de recherche avec filtrage instantané
- Bouton "Ouvrir dans Google Sheets"
- Spinner de chargement

---

## [0.6.0] - 2026-02-26

### Modifié
- Passage complet au tutoiement sur toutes les pages (accueil, vidéos, règles, aides de jeux)
- Correction d'encodage UTF-8 sur tous les fichiers HTML

---

## [0.5.0] - 2026-02-26

### Modifié
- Titre hero : "Ennemi Intérieur" (simplifié)
- Texte d'accueil : ton informel, tutoiement, mention feuille de perso (soon™)
- Hero réduit en hauteur pour rapprocher les cartes
- Carte Vidéos : tutoiement + "..."
- Carte Règles renommée → "Règles du Jeu"

---

## [0.4.0] - 2026-02-26

### Modifié
- Onglet "Tableau" renommé en "Aides de Jeux" (navbar + page d'accueil)
- Titre et description de la page mis à jour
- Google Sheet élargi à 95% de la largeur de la page

---

## [0.3.0] - 2026-02-26

### Ajouté
- Badge de version affiché dans la navbar (en haut à droite) sur toutes les pages
- Style `.nav-version` dans le design system

---

## [1.0.0] - 2026-02-26

### Corrigé
- Miniatures YouTube : utilisation de `hqdefault.jpg` (toujours disponible) au lieu de `maxresdefault.jpg`

### Ajouté
- Script de déploiement `deploy.ps1`

---

## [0.1.0] - 2026-02-26

### Ajouté
- **Page d'accueil** : hero section + 3 cartes de navigation
- **Page Vidéos** : galerie de 6 vidéos YouTube avec modal lightbox
- **Page Tableau** : intégration Google Sheets en lecture seule
- **Page Règles** : 5 sections en accordéon (Combat, Critiques, Magie, Peur, Corruption)
- **Design system** : thème dark fantasy (Cinzel + Crimson Text, palette or/bordeaux/noir)
- **Anti-indexation** : `robots.txt` + meta `noindex, nofollow` sur chaque page
- **Navigation** : navbar responsive avec burger menu mobile
- **Animations** : scroll reveal, hover effects, transitions fluides

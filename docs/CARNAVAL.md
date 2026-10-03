# Carnaval de Middenheim

Le module bureau `carnaval.html` utilise l'authentification MJ existante. La carte de Middenheim reste publique dans **Cartes**, y compris par URL directe `carte.html?map=middenheim`. Cette visionneuse charge uniquement l'image et cinq repères géographiques.

## Utilisation

Après connexion MJ, choisir le jour et l'heure, puis la vue **Jour**, **Lieu** ou **PNJ**. Le filtre horaire montre les présences à leurs heures individuelles, distinctes de celles du spectacle. Les heures de la nuit suivante portent une mention explicite. La prochaine rencontre suit les présences annoncées ; une absence d'information ne produit aucune localisation supposée.

Le temps de campagne peut être enregistré pour retrouver la même heure sur un autre appareil. Les filtres et le zoom restent propres à la vue. Un clic sur un lieu sélectionne son repère ; un clic sur un PNJ ouvre sa fiche actuelle ou propose une association manuelle avec une fiche existante. Le lien utilise son identifiant stable.

**Modifier** adapte une scène et ses présences, permet d'écrire des notes et conserve le programme source. **Réinitialiser vers la source** restaure le programme sans effacer les notes. Une scène annulée reste réactivable. **＋ Scène** ajoute un événement à la campagne. Les chevauchements dans deux lieux différents sont signalés sans correction automatique.

Les événements secrets sont des prévisions du scénario. Les heures approximatives et inconnues sont indiquées explicitement ; avancer l'horloge ne déclenche aucune action. Les durées inconnues ne servent pas à conclure à une présence continue ou à un chevauchement.

Le Carnaval exige une connexion. Une sauvegarde n'est confirmée qu'après validation serveur. En cas de modification concurrente, les données actuelles sont rechargées avec un message de conflit. Il faut alors réappliquer son changement. La déconnexion vide la vue privée, ses formulaires et ses abonnements, et libère les portraits temporaires.

## Activation sur le site

Le développement est additif. Avant d'ouvrir le module sur le site hébergé :

1. Publier les règles `firestore.rules` avec le processus habituel du projet, puis les fichiers statiques de cette version.
2. Se connecter avec le compte MJ vérifié, ouvrir **Carnaval · MJ** et choisir le fichier local privé `data-privees/carnaval-source.json`, situé dans le dossier de travail parent du dépôt.
3. Cliquer sur **Importer la source**, puis associer les personnages aux fiches PNJ existantes.

L'initialisation crée la source et le suivi dans une seule transaction. Elle refuse d'écraser une source ou un suivi déjà présents. Cet outil de préparation initiale ne constitue pas un import/export du suivi de campagne.

**Ne pas copier le JSON source ni les PDF dans le dépôt ou dans les ressources publiques.** La source contient les horaires, les présences et les prévisions privées du scénario. Le fichier de carte dérivé et sa miniature sont publics, conformément au cahier des charges.

## Architecture

- `js/carnaval-model.js` : validation, programme effectif, présences, temps ordonné, rencontres et conflits de lieux.
- `js/data/carnaval-repository.js` : abonnements serveur et transactions de sauvegarde, obtenu par `js/bureau-data.js` seulement pour le MJ.
- `js/carnaval.js`, `carnaval.html`, `css/carnaval.css` : interface, formulaires, synchronisation et cycle de vie privé.
- `js/middenheim-map.js` : image publique et repères partagés avec `js/maps.js`.
- `carnaval_sources/current` : programme source versionné, création initiale uniquement.
- `carnaval_campaigns/current` : horloge, associations, adaptations, scènes ajoutées et notes, avec révision incrémentée à chaque écriture.

Les événements publics portent des bornes en minutes entre 0 et 1800. Pour les prévisions secrètes, `start: null, end: null` signifie heure inconnue ; un début numérique avec `end: null` est un jalon à durée inconnue. Une présence `start: null, end: null` reprend les bornes connues de sa scène et est signalée comme déduite.

Les règles serveur imposent le rôle MJ vérifié, les tailles et types de la structure principale, les timestamps serveur et la progression des révisions. Le modèle client vérifie aussi chaque événement, ses présences et ses références. Les deux collections restent interdites aux joueurs et aux visiteurs. La source est immuable même pour le MJ. Le client refuse les snapshots issus uniquement du cache ; le Service Worker conserve seulement le shell vide et les ressources publiques.

## Vérification

```sh
npm run lint
npm run check
npm run test:carnaval
npm run test:carnaval:rules
```

Le dernier test exige Java et démarre un émulateur Firestore local sur le port 8088, dans le projet fixe `demo-carnaval`. Il ne cible jamais la campagne réelle. Il vérifie notamment les accès refusés, l'immutabilité, les révisions et les transactions concurrentes.

Pour la recette navigateur : vérifier les vues et horaires, le passage après minuit, l'association et la mise à jour d'une fiche, l'adaptation/réinitialisation et les notes, les annulations, les conflits, la coupure réseau et la purge après déconnexion ; puis les deux thèmes sur ordinateur et tablette. Vérifier séparément la carte publique et les deux visionneuses existantes.

### Recette du 3 octobre 2026

Le lint et les 537 tests de `npm run check` passent. Les quatre tests sur l'émulateur Firestore passent, dont le refus des lectures hors MJ et la sauvegarde concurrente du dépôt réel.

Le parcours Chromium a été vérifié avec la transcription privée locale et des fiches PNJ de test, en simulant les rôles et les réponses des dépôts, sans modifier la campagne hébergée. Il couvre les trois vues, les présences individuelles, les nuits, les horaires inconnus, les fiches actualisées, les notes et adaptations, les créations/suppressions, les annulations, les chevauchements, les conflits, la coupure/reprise réseau, la purge, le clavier et le toucher. Les deux thèmes passent sur ordinateur et tablette. La carte publique de Middenheim et les deux cartes existantes chargent correctement.

Le PDF cartographique original est conservé. Les dérivés publics excluent uniquement sa marge de pied de page personnalisée ; les cinq repères ont été vérifiés sur le dessin.

Cette recette confirme le développement local ; les rôles et réponses des dépôts y étaient simulés.

### Activation en production du 3 octobre 2026

Les règles Firestore ont été compilées et publiées dans `campagne-wrpg`. Le programme privé a ensuite été initialisé avec son suivi dans une écriture atomique exigeant l'absence des deux documents : 8 jours et 67 scènes (62 publiques dans le scénario et 5 prévisions secrètes). Le suivi démarre à la révision 0, jour 1 à 08h00, sans association automatique aux fiches PNJ.

Les deux documents ont été relus et validés après l'initialisation. Une lecture anonyme de chacune des deux collections reçoit un refus HTTP 403. La transcription privée reste hors du dépôt ; l'interface d'import initial demeure disponible pour une nouvelle campagne sans source.

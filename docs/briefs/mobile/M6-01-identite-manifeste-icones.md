# M6-01 — Identité PWA stable, manifeste et icônes

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M3-01.

| | |
|---|---|
| Lot | M6 — Installation PWA |
| Objectif | Faire évoluer la PWA existante sans créer une seconde application installée |
| Estimation | 1,5 jour |
| Fichiers | `manifest.json`, icônes PNG/maskable, balises HTML, documentation de contrôle |
| Dépend de | M3-01 |

## Risque principal

Le manifeste actuel n'a pas de champ `id`. Les navigateurs dérivent donc l'identité de l'application
de son `start_url`. Modifier directement ce dernier vers `/app/` peut être interprété comme une autre
PWA et produire deux installations. Il faut stabiliser l'identité actuelle avant ce changement.

## À faire

### 1. Mesurer l'identité déployée

Sur l'URL GitHub Pages réelle, relever dans les outils du navigateur l'identifiant calculé, le scope et
le `start_url` résolu. Tenir compte d'un éventuel sous-chemin de dépôt. Ajouter à `manifest.json` un
champ `id` relatif qui se résout exactement vers l'identité existante. Dans ce brief, conserver encore
`start_url: "./index.html"`.

Installer avant/après sur un profil de test et vérifier que le navigateur propose une mise à jour de la
même application, pas une deuxième icône. Documenter les résultats Chrome/Android.

### 2. Compléter le manifeste

Définir nom court adapté à l'écran, description, `display: standalone`, orientation non forcée sauf
preuve d'usage, couleurs cohérentes et scope exact. Préparer la future bascule de `start_url` vers
`./app/index.html` sans l'activer avant M7-02.

Ajouter si pertinent des raccourcis vers PNJs et Enquêtes seulement lorsque leur URL de démarrage
fonctionne dans le scope et ne compromet pas la compatibilité. Les libellés restent français.

### 3. Produire les icônes

À partir de l'identité visuelle existante, fournir au minimum :

- PNG 192 × 192 et 512 × 512 `purpose: any` ;
- PNG maskable 512 × 512 avec zone sûre contrôlée ;
- icône Apple Touch 180 × 180 ;
- favicon existant conservé pour le web.

Les fichiers déclarent leurs vraies dimensions et types. Vérifier fonds clair/sombre, masque cercle,
arrondi Android et rendu iOS ; aucun texte fin illisible. Les sources éventuelles restent versionnées
si elles sont utiles à la maintenance.

### 4. Aligner les pages

Ajouter/lier le manifeste et les balises Apple/theme nécessaires dans `app/index.html`, sans multiplier
les manifestes sur la même origine. Le site bureau et `/app/` doivent pointer vers le même fichier.
Éviter les métadonnées contradictoires entre thème clair et sombre.

## Ne pas faire

- Ne pas changer encore le `start_url` public.
- Ne pas créer `app/manifest.json` ou enregistrer un second service worker.
- Ne pas annoncer l'installation avant M6-03/M7.
- Ne pas déclarer un SVG comme PNG ni des dimensions qu'il n'a pas.

## Vérifications

- [ ] Identité calculée avant changement consignée.
- [ ] Champ `id` résolu strictement vers cette identité.
- [ ] Installation avant/après n'engendre pas deux applications.
- [ ] Audit manifeste sans erreur de taille/type/scope.
- [ ] Icônes contrôlées avec masques Android et écran d'accueil iOS.
- [ ] Bureau et mobile partagent un manifeste unique.

## Critères d'acceptation

L'identité de la PWA est explicitement stable et ses icônes sont valides sur iOS/Android, sans avoir
encore changé le point de démarrage ni créé une seconde application installable.

## Commit

`feat(pwa): stabiliser l'identite et ajouter les icones (M6-01)`

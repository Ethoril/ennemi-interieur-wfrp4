# Recette locale — Enquêtes v2.35.0

Date : 6 octobre 2026. Branche : `feat/enquetes-ui`. Lot E-01 à E-07.

## Périmètre et environnement

Refonte du rendu bureau/mobile, sans modification du domaine, des services Firebase ni des règles. Toutes les interactions de cette recette utilisent les données fictives de `tools/fixtures/enquetes-qa.html`. Aucun accès aux données de campagne ni déploiement.

Fixture servie sur `http://127.0.0.1:8135/tools/fixtures/enquetes-qa.html`. Le port 8000 appartient à une plage réservée sur cette machine ; un serveur local lié uniquement à 127.0.0.1 et interdisant les chemins cachés a été utilisé hors du dépôt.

Paramètres reproductibles : `id=affaire` pour le dossier, `layout=mobile&id=` pour la liste, `theme=parchment`, `role=joueur`, `offline=1` pour simuler l'état hors connexion. Pour conserver la numérotation contextuelle de la lettre, l'ouvrir depuis le dossier plutôt que par son identifiant directement.

## Contrôles effectués

- [x] `npm run check` : succès, y compris les tests du domaine, des fonctions, des fiches, du mobile et de cohérence de version.
- [x] `npm run lint` : succès, aucun avertissement.
- [x] `npm run test:enquetes` : 41 tests réussis, aucun échec ni test ignoré.
- [x] Versions `sw.js`, `js/layout.js` et métadonnée mobile cohérentes : v2.35.0. Nouveaux modules dans le précache.
- [x] Douze captures des six écrans, sombre et parchemin, avec la hiérarchie des maquettes : rail/dossier/carnet, papier numéroté, visionneuse sombre, écrans mobiles distincts et feuille de note.
- [x] Bureau à 1440 px, 1100 px et 800 px : trois, deux puis une colonne ; aucun débordement horizontal observé. Mobile à 390 et 375 px.
- [x] Parcours MJ sur fixture : création d'un dossier, création d'une pièce liée, versement d'un PNG, annotation via le clavier, déplacement d'une pièce dans l'ordre éditorial, passage secret puis public, corbeille puis restauration de la pièce personnelle.
- [x] Parcours joueur sur fixture : dossier commun sans action Modifier/Ordonner/Publier, note rapide privée, apparition dans Mes notes, ouverture du formulaire de partage d'une copie avec audience Groupe.
- [x] Hors connexion simulé : texte conservé et message d'envoi différé via Reprendre le brouillon. Les tests couvrent brouillon, échec réseau, reprise et changements de compte.
- [x] Graphe accessible par onglet ; changement d'onglet au clavier et associations `aria-controls`/`aria-labelledby` vérifiés.
- [x] Menu mobile externe : ouverture au clavier, `aria-expanded`, fermeture par Échap et retour de focus sur le déclencheur.
- [x] Ordre éditorial : focus maintenu sur le contrôle de la pièce déplacée, nouvel ordre annoncé, enregistrement visible dans les numéros du dossier.
- [x] Annotation au clavier : mode explicite puis création au centre à x/y = 0,5. Numéro, texte et audience annoncés ; focus et surbrillance liés aux épingles.
- [x] Contrastes des textes visibles inspectés dans les deux thèmes, sur dossier, pièce, zoom et note : mesure des couleurs calculées avec composition des fonds transparents, seuil 4,5:1. Le cachet utilise un dégradé, vérifié séparément avec ses couleurs. Correction des contrôles sur visionneuse/zoom et du titre de note parchemin.
- [x] Cibles tactiles mesurées sur la pièce à 375 px : aucun contrôle visible sous 44 × 44 px.
- [x] Réduction de mouvement : règles sans transitions/animations et sans rotation/soulèvement présentes ; vérification statique.
- [x] Agent du dépôt `a11y-reviewer` lancé en lecture seule, neuf points signalés puis corrigés ; dernière relecture ciblée sans blocage concret.
- [x] CSS obsolète de hauteur maximale mobile supprimé ; styles de liens conservés car encore utilisés par les notes et les PNJ. Un seul menu d'objet dans l'en-tête sur mobile.

## Vérifications non réalisées ou partielles

- [ ] Téléchargement et contenu du ZIP MJ/joueur : action toujours disponible et tests de sélection d'export verts ; l'événement de téléchargement n'a pas été reçu dans le navigateur intégré. La confirmation de partage d'une copie n'a pas non plus été vérifiée jusqu'au résultat final dans ce navigateur. À refaire dans un navigateur classique.
- [ ] Mobile physique, clavier virtuel et lecteur d'écran réel.
- [ ] Zoom texte à 200 % et préférence système de mouvement réduit dans un navigateur réel ; les adaptations CSS et le fonctionnement clavier ont été vérifiés localement.
- [ ] Cache Service Worker hors connexion et envoi après reconnexion réelle : la fixture simule l'état hors connexion, elle ne constitue pas une recette du cache en production.
- [ ] CI distante : aucun push autorisé, donc aucune exécution distante revendiquée.
- [ ] Production : aucune fusion dans `master`, aucun push ni déploiement Firebase.

Ces réserves restent ouvertes pour la recette avant mise en production. Elles ne sont pas présentées comme des vérifications réussies.

## Captures

Captures du viewport, bureau 1440 × 1080 et mobile 390 × 844. Les écrans longs se poursuivent par défilement. Le suffixe `-parchment` désigne le thème clair.

| Écran | Sombre | Parchemin |
|---|---|---|
| Dossier bureau | [capture](01-bureau-dossier.png) | [capture](01-bureau-dossier-parchment.png) |
| Pièce bureau | [capture](02-bureau-piece.png) | [capture](02-bureau-piece-parchment.png) |
| Liste mobile | [capture](03-mobile-liste.png) | [capture](03-mobile-liste-parchment.png) |
| Dossier mobile | [capture](04-mobile-dossier.png) | [capture](04-mobile-dossier-parchment.png) |
| Pièce mobile | [capture](05-mobile-piece.png) | [capture](05-mobile-piece-parchment.png) |
| Note rapide mobile | [capture](06-mobile-note-rapide.png) | [capture](06-mobile-note-rapide-parchment.png) |

## Modifications préexistantes exclues

`firestore.indexes.json`, `tools/j2-contribution-rules.test.mjs`, `.claude/launch.json`, `img/pnj-default.png` et les briefs/maquettes fournis étaient déjà présents ou modifiés avant le lot. Ils restent hors des commits de développement ; seul le nouveau sous-dossier `recette` est ajouté ici.

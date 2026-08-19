# M4-03 — Appareil photo, recadrage et cycle de vie portrait

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md), M1-03 et M4-02.

| | |
|---|---|
| Lot | M4 — Administration PNJs mobile |
| Objectif | Ajouter ou remplacer un portrait avec un flux réellement adapté au téléphone |
| Estimation | 1,5 jour |
| Fichiers | composant image mobile, styles, service images partagé, tests |
| Dépend de | M4-02 |

## Parcours cible

Dans le formulaire PNJ, le MJ peut prendre une photo ou choisir un fichier, vérifier un aperçu,
recadrer si nécessaire, compresser puis enregistrer. La photo n'est téléversée qu'après confirmation
et son accès suit `visibleJoueurs` via les règles Storage.

## À faire

### 1. Sélectionner la source

Utiliser un `input type="file"` acceptant les images et proposant `capture="environment"` lorsque le
navigateur le permet. Garder le choix dans la photothèque. Expliquer sobrement que l'appareil photo
nécessite HTTPS et une autorisation système ; gérer refus et annulation sans erreur bloquante.

### 2. Valider côté client

Contrôler type réel décodable et taille avant traitement. Refuser SVG et formats non pris en charge si
le pipeline ne garantit pas leur sûreté. Afficher une limite explicite cohérente avec Storage. Ne pas
faire confiance au nom ou au seul `file.type`.

### 3. Préparer l'image

Avec Canvas natif, corriger l'orientation, proposer un cadrage simple centré, produire un format et des
dimensions documentés, puis compresser avec un compromis lisibilité/poids. Ne pas ajouter une lourde
bibliothèque uniquement pour le recadrage. Afficher poids original/final et un aperçu identique au
rendu de fiche.

Libérer bitmap, canvas temporaire et URL objet à l'annulation, au remplacement et au démontage.

### 4. Téléverser avec progression

Réserver l'identifiant du PNJ avant le chemin Storage. Montrer progression, annulation si supportée et
erreurs réseau/quota. À la sauvegarde : téléverser le nouveau fichier, mettre à jour `portraitPath`,
puis supprimer l'ancien comme prévu par le dépôt. Une panne ne doit jamais perdre l'ancien portrait.

Pour une création annulée après upload, exécuter la compensation ou consigner l'objet orphelin pour le
contrôle administratif. Aucun blob n'est placé dans le cache persistant public par ce composant.

### 5. Prévoir suppression et remplacement

Une action « Retirer le portrait » affiche une confirmation et n'agit qu'à la sauvegarde. Annuler le
formulaire restaure l'ancien état. Deux sélections successives ne doivent téléverser que la dernière
version validée.

## Recette appareils

- [ ] Prise de photo Android et choix photothèque Android.
- [ ] Prise/choix iPhone Safari, orientation correcte.
- [ ] Très grande image compressée sous les limites.
- [ ] Fichier invalide ou corrompu refusé clairement.
- [ ] Annulation à chaque étape sans fichier orphelin.
- [ ] Panne après upload : compensation ou reprise signalée.
- [ ] Remplacement réussi puis ancien fichier supprimé.
- [ ] Visiteur voit le portrait public mais pas celui d'un PNJ masqué.
- [ ] URLs objet et ressources Canvas libérées.

## Critères d'acceptation

Le flux fonctionne d'une main sur les deux plateformes, n'exige aucune dépendance d'exécution et
préserve l'ancien portrait ainsi que la confidentialité en cas d'échec.

## Commit

`feat(mobile): ajouter la capture et le traitement des portraits (M4-03)`

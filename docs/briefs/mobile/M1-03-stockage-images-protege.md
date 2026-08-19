# M1-03 — Images protégées et migration Storage

> Lire d'abord [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md),
> [`../../PLAN-PWA-MOBILE.md`](../../PLAN-PWA-MOBILE.md) et M1-02.

| | |
|---|---|
| Lot | M1 — Sécurité et intégrité |
| Objectif | Empêcher l'accès aux images de contenus masqués ou secrets |
| Estimation | 2 jours |
| Fichiers | `storage.rules`, scripts de migration, `js/pnjs.js`, `js/enquetes.js` |
| Dépend de | M1-02 |

## Problème à résoudre

Les règles actuelles autorisent la lecture publique de `portraits/{file}` et `indices/{file}`. Une
URL de téléchargement persistante peut donc exposer l'image d'un indice secret, même si Firestore
refuse son document. Le nouveau rangement doit permettre aux règles Storage de retrouver le document
propriétaire dans Firestore.

## Modèle cible

- `portraits/{pnjId}/{fileName}` pour les portraits ;
- `indices/{indiceId}/{fileName}` pour les illustrations d'indices ;
- champs Firestore `imagePath` ou `portraitPath`, contenant un chemin Storage, pas une URL durable ;
- ancien champ `imageUrl` accepté temporairement en lecture pendant la migration, jamais créé ensuite.

## À faire

### 1. Définir les règles Storage

Utiliser `firestore.get()`/`firestore.exists()` avec le document propriétaire :

- portrait lisible par le MJ ou si `pnjs/{pnjId}.visibleJoueurs == true` ;
- image d'indice lisible par le MJ ou si `indices/{indiceId}.decouvert == true` ;
- écriture/suppression réservée au MJ vérifié ;
- création limitée aux images, avec tailles maximales cohérentes ;
- empêcher le remplacement d'un fichier par un contenu non image.

Le nom du fichier ne porte aucune décision de sécurité. Tester les documents propriétaires absents.

### 2. Écrire une migration en deux phases

Le script idempotent doit :

1. inventorier anciens fichiers, références et orphelins en `--dry-run` ;
2. copier chaque fichier vers le chemin cible déterministe sans effacer la source ;
3. vérifier taille, type et intégrité de la copie ;
4. écrire le nouveau chemin dans le document propriétaire ;
5. signaler les doublons et propriétaires absents ;
6. permettre une reprise après interruption ;
7. supprimer les sources seulement dans une commande ultérieure et explicitement confirmée.

Une migration partielle ne doit pas casser l'affichage : le chemin protégé est prioritaire, puis
l'ancienne URL sert de repli transitoire. La date de suppression du repli est documentée.

### 3. Adapter l'affichage

Pour un chemin protégé, charger le blob via le SDK Storage après autorisation, fabriquer une URL
objet locale, puis la révoquer quand la fiche ou la vue disparaît. Prévoir les états chargement,
image absente et accès refusé. Ne pas placer les images secrètes dans le précache du service worker.

### 4. Adapter les nouvelles écritures

Tout nouvel envoi choisit d'abord ou crée l'identifiant Firestore, puis téléverse dans le dossier de
cet identifiant et enregistre le chemin. En cas d'échec entre Storage et Firestore, supprimer le
nouveau fichier ou le consigner pour reprise. Une image remplacée n'est supprimée qu'après validation
de la nouvelle référence.

### 5. Tester les règles

Couvrir visiteur, non-MJ et MJ pour : contenu public, contenu masqué, contenu devenu public, contenu
redevenu secret, document propriétaire absent, mauvais identifiant, lecture et écriture. Vérifier
également qu'une ancienne URL déjà connue ne donne plus accès une fois le fichier source supprimé.

## Ne pas faire

- Ne pas supprimer les anciens fichiers pendant la copie initiale.
- Ne pas considérer le token de téléchargement comme une autorisation.
- Ne pas mettre de blob privé en Cache Storage ou dans un cache persistant applicatif.
- Ne pas journaliser les anciennes URL complètes.

## Vérifications

- [ ] La matrice Storage est automatisée dans l'émulateur.
- [ ] Une image publique s'affiche en visiteur et une image secrète échoue.
- [ ] Le changement de visibilité prend effet sans renommer le fichier.
- [ ] Le deuxième passage de migration ne crée aucun doublon.
- [ ] Les URLs objet sont révoquées lors d'un changement de vue.
- [ ] Les orphelins sont listés avant toute suppression.

## Critères d'acceptation

La confidentialité d'une image suit celle de son document Firestore, les contenus existants restent
affichables pendant la migration et un retour arrière documenté est possible.

## Commit

`security(storage): proteger et migrer les images (M1-03)`

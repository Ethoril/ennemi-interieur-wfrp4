# Plan d'action — Application mobile PWA PNJs & Enquêtes

> **Statut :** proposition validée, mise en œuvre non commencée  
> **Date :** 19 août 2026  
> **Périmètre :** expérience mobile installable pour les pages PNJs et Enquêtes  
> **Architecture imposée :** même projet Firebase, mêmes données Firestore, aucune sauvegarde mobile séparée

> Lire d'abord [`briefs/00-CONVENTIONS.md`](briefs/00-CONVENTIONS.md). Les contraintes du projet
> restent applicables : site statique, modules ES natifs, aucun framework, aucun bundler et aucune
> dépendance npm à l'exécution.

---

## 1. Décision retenue

Construire une **PWA mobile dédiée**, pensée comme une application et non comme une adaptation
responsive des pages actuelles.

Elle proposera deux modes à partir du même code et des mêmes données :

- **joueur non connecté** : consultation des PNJs, relations et indices rendus publics ;
- **Maître de Jeu connecté** : création, modification et suppression, particulièrement pour les
  PNJs et leurs relations, puis pour les indices.

Le site bureau reste disponible et conserve ses interfaces adaptées aux grands écrans : graphe
D3, tableau et formulaires actuels. L'application mobile dispose de ses propres écrans, mais les
deux interfaces consomment une **couche de données commune**.

```text
Interface bureau PNJs ─────┐
Interface bureau Enquêtes ─┤
                           ├── Services partagés ── Firestore / Storage actuels
Application mobile PNJs ───┤
Application mobile Enquêtes┘
```

La PWA est le produit mobile principal. Un emballage Capacitor pourra être ajouté plus tard si
une présence dans les stores ou des fonctions natives le justifient ; il ne fait pas partie du
premier périmètre.

---

## 2. Objectifs

### 2.1 Fonctionnels

- Installer l'application depuis une page web sur Android et iOS.
- La lancer en mode autonome, sans barre de navigateur.
- Consulter rapidement les PNJs et les indices d'une seule main.
- Naviguer sans rupture entre un PNJ, ses relations et ses indices associés.
- Permettre au MJ de modifier un PNJ pendant une partie depuis son téléphone.
- Propager les modifications vers le site bureau et les autres téléphones sans rechargement.
- Rendre les données publiques déjà consultées disponibles hors connexion.
- Afficher sans ambiguïté les états : chargement, hors ligne, synchronisation, enregistré, erreur
  et conflit.

### 2.2 Techniques

- Une seule source de vérité : Firestore.
- Une seule implémentation des lectures et écritures Firestore pour le bureau et le mobile.
- Règles Firestore et Storage versionnées dans le dépôt.
- Évolution progressive et rétrocompatible du schéma.
- Aucun framework, bundler ou serveur applicatif ajouté.
- Déploiement conservé sur GitHub Pages.
- Échec du mobile sans régression sur le site bureau.

### 2.3 Qualité

- Cibles tactiles d'au moins 44 × 44 px.
- Prise en compte des encoches et barres d'accueil iOS.
- Utilisation complète au clavier et avec un lecteur d'écran lorsque le matériel le permet.
- Aucun secret de MJ envoyé à un client joueur.
- Aucun fichier Storage secret rendu publiquement énumérable ou téléchargeable.
- Mise à jour de la PWA contrôlée, sans mélange silencieux de deux versions.

---

## 3. Hors périmètre initial

- Réécriture de l'ensemble des onze pages en application mobile.
- Publication immédiate dans l'App Store ou le Play Store.
- Notifications push.
- Mode multicomptes ou plusieurs rôles de MJ.
- Chat, commentaires entre joueurs ou journal collaboratif.
- Refonte du graphe D3 bureau.
- Synchronisation avec une autre base que le projet Firebase actuel.
- Édition simultanée caractère par caractère de type document collaboratif.

Ces points pourront être réévalués après validation de la PWA en conditions réelles.

---

## 4. État de départ

### 4.1 Données

Collections actuellement concernées :

| Collection | Contenu | Lecture joueur | Écriture |
|---|---|---|---|
| `pnjs` | identité, statut, vie, lieu, groupe, description, portrait | publique | MJ |
| `relations` | source, cible, type, label, couleur, style | publique | MJ |
| `indices` | titre, description, découverte, image, PNJs liés | découverts uniquement | MJ |

Les images vivent dans :

- `portraits/` pour les PNJs ;
- `indices/` pour les illustrations d'indices.

### 4.2 Chargement actuel

[`js/pnjs.js`](../js/pnjs.js) et [`js/enquetes.js`](../js/enquetes.js) utilisent principalement
`getDocs()`. Les données sont donc cohérentes au prochain chargement, mais les changements d'un
autre appareil n'apparaissent pas immédiatement.

### 4.3 PWA actuelle

Le dépôt possède déjà :

- [`manifest.json`](../manifest.json) ;
- [`sw.js`](../sw.js) ;
- une stratégie de cache des ressources locales ;
- une page de repli [`offline.html`](../offline.html).

Cette base installe le site général et lance `index.html`. Elle ne définit pas encore une
expérience mobile propre aux PNJs et Enquêtes. Le cache du service worker couvre la coque web,
mais Firestore utilise son cache mémoire par défaut : les données ne survivent pas à une fermeture
du navigateur.

---

## 5. Risques à traiter avant l'ouverture mobile

### S1 — Illustrations secrètes publiquement lisibles

[`storage.rules`](../storage.rules) autorise aujourd'hui `read: if true` sur `indices/{file}`.
Une illustration d'indice non découvert n'est donc pas réellement secrète.

Le commentaire indiquant que Storage ne peut pas interroger Firestore est obsolète : les règles
Storage peuvent utiliser `firestore.get()` et `firestore.exists()`.

**Décision :** lier le chemin du fichier à l'identifiant de l'indice et autoriser sa lecture si
le demandeur est MJ ou si le document Firestore correspondant porte `decouvert == true`.

Chemin cible :

```text
indices/{indiceId}/{nomFichier}
```

Ne plus stocker une URL publique durable comme source de vérité. Stocker `imagePath`, récupérer
le fichier par le SDK Storage après évaluation des règles, puis créer une URL `blob:` locale pour
l'affichage.

Compatibilité transitoire :

- les lecteurs préfèrent `imagePath` ;
- ils utilisent l'ancien `imageUrl` uniquement pendant la migration ;
- une migration copie les fichiers vers le nouveau chemin ;
- les anciens objets et champs ne sont supprimés qu'après validation complète.

### S2 — Description de PNJ et relations entièrement publiques

Le champ actuel est présenté comme « Description, notes… », alors que le document entier est
public. De même, toutes les relations sont visibles par les joueurs.

**Décision recommandée :** séparer explicitement le public du privé.

- `pnjs/{id}.description` devient la description visible par les joueurs.
- Les notes MJ vivent dans `pnjs_prives/{id}` avec lecture et écriture MJ uniquement.
- Ajouter `visibleJoueurs: true|false` aux PNJs et relations.
- Les documents existants sont migrés avec `visibleJoueurs: true` pour conserver l'affichage
  actuel.
- Les requêtes joueur portent obligatoirement `where('visibleJoueurs', '==', true)`.
- Les requêtes MJ peuvent charger l'ensemble.

Cette séparation évite de compter sur un masquage d'interface, qui n'est jamais une protection.

### S3 — Cohérence des écritures

À corriger avant de réutiliser les mutations depuis deux interfaces :

- création bidirectionnelle de relations dans un `writeBatch()` unique ;
- suppression d'un PNJ avec nettoyage de ses relations et des `pnjsLies` dans les indices ;
- suppression de l'ancien fichier lors du remplacement d'une image ;
- suppression du fichier lors de la suppression du document ;
- nettoyage des fichiers orphelins produits par une écriture Firestore échouée ;
- gestion des conflits entre une édition bureau et une édition mobile.

### S4 — Courses asynchrones du panneau PNJ

`openPanel()` peut terminer une ancienne requête après un clic sur un autre PNJ ou après la
fermeture du panneau. Ajouter un identifiant de chargement ou un contrôleur d'annulation et
ignorer tout résultat qui ne correspond plus au PNJ demandé.

### S5 — Filtres devenus invisibles

Après un rechargement, les boutons de filtre sont recréés mais les ensembles actifs sont
conservés. Retirer les valeurs actives qui n'existent plus et fournir une action visible
« Réinitialiser les filtres ».

---

## 6. Modèle de données cible

Les champs ajoutés doivent rester optionnels pendant toute la migration. Les fonctions de
normalisation leur donnent des valeurs par défaut.

### 6.1 `pnjs/{pnjId}`

```js
{
    nom: string,
    statut: 'allié' | 'neutre' | 'ennemi' | '',
    vivant: 'oui' | 'non' | 'inconnu',
    lieu: string,
    groupe: string,
    description: string,       // visible par les joueurs
    imagePath: string,         // cible
    imageUrl: string,          // ancien champ, transitoire
    visibleJoueurs: boolean,
    ordre: number | null,
    createdAt: Timestamp,
    updatedAt: Timestamp
}
```

### 6.2 `pnjs_prives/{pnjId}`

```js
{
    notes: string,
    updatedAt: Timestamp
}
```

Le document privé n'est jamais chargé dans le mode joueur.

### 6.3 `relations/{relationId}`

```js
{
    source: string,
    cible: string,
    type: string,
    label: string,
    color: string | null,
    style: 'solid' | 'dashed',
    visibleJoueurs: boolean,
    createdAt: Timestamp,
    updatedAt: Timestamp
}
```

### 6.4 `indices/{indiceId}`

```js
{
    titre: string,
    description: string,
    decouvert: boolean,
    pnjsLies: string[],
    imagePath: string,
    imageUrl: string,          // ancien champ, transitoire
    ordre: number | null,
    dateDecouverte: Timestamp | null,
    createdAt: Timestamp,
    updatedAt: Timestamp
}
```

### 6.5 Compatibilité et migrations

- Un champ absent ne doit jamais casser le rendu.
- `visibleJoueurs` absent est interprété comme `true` côté MJ pendant la migration, mais les
  règles joueur ne sont durcies qu'après remplissage du champ sur tous les documents.
- `style` absent vaut `solid`.
- `imagePath` absent replie sur `imageUrl` jusqu'à la fin de migration.
- `ordre` absent replie sur un tri stable par nom ou titre.
- Tous les scripts de migration sont idempotents, possèdent un mode `--dry-run` et n'impriment
  aucune donnée personnelle dans le dépôt.
- Un export de sauvegarde est réalisé hors du dépôt avant chaque migration destructive.

---

## 7. Architecture JavaScript cible

### 7.1 Principe

Les modules de données ne doivent connaître ni le DOM bureau ni le DOM mobile. Ils reçoivent les
instances Firebase nécessaires et exposent des objets normalisés.

Arborescence indicative :

```text
js/
├── firebase-config.js
├── firebase-init.js                 # bureau, comportement actuel
├── firebase-mobile-init.js          # configuration mobile et cache persistant public
├── data/
│   ├── pnjs-repository.js
│   ├── relations-repository.js
│   ├── indices-repository.js
│   ├── images-repository.js
│   └── normalizers.js
├── mobile/
│   ├── app.js
│   ├── router.js
│   ├── session.js
│   ├── ui.js
│   └── views/
│       ├── pnjs-list.js
│       ├── pnj-detail.js
│       ├── pnj-edit.js
│       ├── relation-edit.js
│       ├── enquetes-list.js
│       ├── enquete-detail.js
│       └── enquete-edit.js
```

Les noms finaux peuvent évoluer, mais la séparation des responsabilités est obligatoire.

### 7.2 API des dépôts

API minimale attendue :

```text
subscribePnjs(mode, callback, onError) → unsubscribe
subscribeRelations(mode, callback, onError) → unsubscribe
subscribeIndices(mode, callback, onError) → unsubscribe
getPrivatePnjNotes(pnjId)

createPnj(data, portrait)
updatePnj(pnjId, data, portrait, expectedUpdatedAt)
deletePnj(pnjId)

createRelation(data, bidirectionnelle)
updateRelation(relationId, data, expectedUpdatedAt)
deleteRelation(relationId)

createIndice(data, illustration)
updateIndice(indiceId, data, illustration, expectedUpdatedAt)
deleteIndice(indiceId)
```

Chaque mutation :

- normalise les champs ;
- vérifie les préconditions client pour produire un message utile ;
- laisse les règles Firebase trancher l'autorisation ;
- écrit `updatedAt` avec `serverTimestamp()` ;
- utilise batch ou transaction lorsqu'une opération touche plusieurs documents ;
- convertit les erreurs Firebase en catégories d'interface stables ;
- ne fait jamais d'`alert()` directement.

### 7.3 Temps réel

Remplacer les lectures ponctuelles des trois collections par `onSnapshot()`.

Précautions :

- désabonnement lors d'un changement de mode ou quand la page disparaît ;
- nouvel abonnement après connexion ou déconnexion MJ ;
- jeton de génération pour ignorer les callbacks d'un ancien abonnement ;
- conservation de la sélection et des filtres lors d'une mise à jour ;
- indication visuelle lorsque les données viennent du cache ;
- absence de clignotement complet lors d'une simple modification de document.

### 7.4 Conflits d'édition

Au chargement d'un formulaire, conserver la valeur `updatedAt` observée. À l'enregistrement :

- si le document n'a pas changé, appliquer la modification ;
- s'il a changé depuis un autre appareil, proposer « Recharger » ou « Écraser » ;
- ne jamais écraser silencieusement une version plus récente ;
- une transaction nécessaire au contrôle de conflit exige une connexion ; hors ligne, conserver
  un brouillon local et différer l'envoi.

Le compte MJ étant unique, cette protection vise surtout l'usage simultané ordinateur + téléphone.

---

## 8. Architecture Firebase et sécurité

### 8.1 Règles Firestore

Étendre [`firestore.rules`](../firestore.rules) pour couvrir :

- `pnjs` : lecture MJ ou `visibleJoueurs == true`, écriture MJ ;
- `pnjs_prives` : lecture et écriture MJ uniquement ;
- `relations` : lecture MJ ou `visibleJoueurs == true`, écriture MJ ;
- `indices` : comportement actuel conservé ;
- validation des clés autorisées ;
- types principaux et tailles maximales raisonnables ;
- références `source`, `cible` et `pnjsLies` bornées en taille côté document.

Comme les règles ne filtrent pas les résultats, les requêtes joueur doivent porter les mêmes
contraintes de visibilité.

### 8.2 Règles Storage

Chemins cibles :

```text
portraits/{pnjId}/{file}
indices/{indiceId}/{file}
```

Règles attendues :

- portraits : lecture autorisée seulement si le PNJ est visible ou si le demandeur est MJ ;
- illustrations : lecture autorisée seulement si l'indice est découvert ou si le demandeur est
  MJ ;
- écriture MJ uniquement ;
- adresse MJ vérifiée comme dans les règles Firestore ;
- taille et MIME imposés ;
- refus des extensions ou types non-images ;
- accès Firestore depuis Storage activé et testé dans le projet Firebase.

### 8.3 Index Firestore

Ajouter et versionner `firestore.indexes.json`, puis le déclarer dans `firebase.json`.

Prévoir les index réellement utilisés par :

- PNJs visibles triés par `ordre` ou `nom` ;
- relations visibles ;
- indices découverts triés ;
- indices découverts contenant un PNJ donné ;
- requêtes MJ avec tri, si elles le nécessitent.

Ne pas attendre une erreur en production et la création manuelle d'un index depuis un lien de la
console.

### 8.4 Cache public et données privées

- Le cache persistant mobile contient les données accessibles aux joueurs.
- Les notes privées et indices secrets ne doivent pas être persistés par défaut sur un appareil
  partagé.
- Le mode MJ explique clairement si une option « appareil de confiance » active un cache privé.
- Pour le premier lot, les données privées peuvent rester en mémoire uniquement et exiger une
  connexion.
- Déconnexion MJ : retirer immédiatement les données privées de l'état et du DOM.
- Un indice déjà révélé peut avoir été copié ou mis en cache par un joueur ; le repasser secret
  ne peut pas effacer les copies déjà reçues. Cette limite doit être assumée dans l'interface.

---

## 9. Produit mobile

### 9.1 Coque générale

Créer :

```text
app/
├── index.html
├── manifest.webmanifest             # si le manifeste racine n'est pas réutilisé
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    ├── icon-maskable-512.png
    └── apple-touch-icon.png

css/
└── mobile-app.css
```

La coque contient :

- en-tête compact, titre de l'écran et action contextuelle ;
- zone de contenu scrollable ;
- navigation basse `PNJs` / `Enquêtes` ;
- zone d'état réseau et synchronisation ;
- point d'entrée discret « Mode MJ » ;
- conteneur de dialogue accessible ;
- gestion des `safe-area-inset-top`, `right`, `bottom` et `left` ;
- thème sombre par défaut, avec réutilisation des jetons de couleur existants.

### 9.2 Navigation

GitHub Pages ne fournissant pas de réécriture serveur, utiliser un routeur minimal basé sur le
fragment d'URL :

```text
app/index.html#/pnjs
app/index.html#/pnjs/{id}
app/index.html#/pnjs/{id}/modifier
app/index.html#/enquetes
app/index.html#/enquetes/{id}
app/index.html#/enquetes/{id}/modifier
app/index.html#/reglages
```

Exigences :

- boutons Retour cohérents avec l'historique du navigateur ;
- liens profonds partageables ;
- retour à la liste avec conservation de la recherche et de la position de défilement ;
- route inexistante redirigée vers `/pnjs` ;
- route secrète refusée sans fuite de contenu ;
- ouverture des anciens liens `pnjs.html?id=` et `enquetes.html?id=` toujours fonctionnelle sur
  le site bureau.

### 9.3 Écran PNJs — joueur

- Recherche collée en haut, avec bouton d'effacement.
- Liste verticale, pas de graphe par défaut.
- Carte : portrait, nom, statut, vivant/décédé, lieu et groupe.
- Tri stable par `ordre`, puis nom.
- Bouton « Filtres » ouvrant une feuille basse.
- Filtres : statut, vivant, lieu, groupe ; compteur de filtres actifs ; réinitialisation globale.
- État vide différenciant « aucun PNJ publié » et « aucun résultat pour ces filtres ».
- Chargement progressif des portraits.
- Option future seulement : vue locale des relations autour d'un PNJ, jamais requise pour la
  navigation principale.

### 9.4 Fiche PNJ — joueur

- Bouton Retour visible.
- Portrait grand format sans forcer un recadrage circulaire.
- Nom, badges, lieu et groupe.
- Description publique.
- Relations sous forme de grandes lignes tactiles ; appui vers l'autre PNJ.
- Indices découverts associés ; appui vers l'enquête.
- Aucun espace vide réservé aux actions MJ.
- Lien profond conservé après installation.

### 9.5 Édition PNJ — MJ

- Bouton flottant « + » sur la liste.
- Action « Modifier » dans la fiche.
- Formulaire plein écran, conçu pour le clavier mobile.
- Champs : nom, statut, vivant, lieu, groupe, visibilité joueurs, description publique, notes MJ.
- Photo depuis la photothèque ou l'appareil photo.
- Recadrage tactile et compression WebP avant téléversement.
- Aperçu de la fiche joueur avant publication.
- Validation en ligne et résumé d'erreurs au-dessus du formulaire.
- Bouton Enregistrer collé en bas mais jamais masqué par le clavier.
- Brouillon local jusqu'à confirmation de l'enregistrement.
- Suppression dans un menu secondaire, avec confirmation et explication de la cascade.

### 9.6 Relations — MJ

- Liste des relations existantes dans la fiche.
- Ajout dans une feuille basse : PNJ cible, type, label, couleur, style, visibilité, sens unique
  ou bidirectionnel.
- Modification avec les mêmes champs.
- Création bidirectionnelle atomique.
- Empêcher une relation d'un PNJ vers lui-même.
- Avertir ou fusionner selon la décision produit en cas de doublon exact.
- Après suppression, actualiser immédiatement les deux fiches concernées.

### 9.7 Écran Enquêtes — joueur

- Recherche collée en haut.
- Liste verticale d'indices découverts.
- Tri par `ordre`, puis `dateDecouverte`, puis titre.
- Carte compacte : titre, illustration, extrait et PNJs associés.
- Fiche d'indice plein écran pour les descriptions longues.
- Illustration ouvrable sans provoquer de zoom involontaire de la page.
- PNJs associés ouvrant directement leur fiche mobile.

### 9.8 Édition Enquêtes — MJ

À livrer après stabilisation de l'édition PNJ, mais avec la même architecture :

- création et modification ;
- découvert / secret ;
- ordre et date de découverte ;
- illustration protégée ;
- sélection tactile des PNJs liés avec recherche ;
- aperçu joueur ;
- suppression avec nettoyage Storage.

---

## 10. Installation PWA

### 10.1 Identité

Éviter deux PWA installables qui se chevauchent sur la même origine.

Stratégie recommandée : faire évoluer l'identité PWA actuelle pour que son écran de démarrage
devienne `app/index.html`, tout en laissant le site bureau navigable normalement.

Migration en deux livraisons :

1. relever l'identifiant calculé de la PWA actuellement déployée et ajouter un champ `id` stable
   sans changer `start_url` ;
2. après propagation, conserver cet `id` et changer `start_url` vers l'application mobile.

Si la conservation de l'ancienne installation s'avère impossible à valider sur iOS et Android,
alternative : héberger la PWA mobile sur un sous-domaine distinct. Ne pas adopter cette solution
sans mesurer son coût de déploiement et de configuration Firebase.

### 10.2 Manifeste

Le manifeste final doit contenir au minimum :

- `id` stable ;
- `name` et `short_name` adaptés ;
- `start_url` mobile ;
- `scope` explicite ;
- `display: standalone` ;
- couleurs de fond et de thème ;
- icônes PNG 192 et 512 ;
- icône `maskable` ;
- description ;
- captures d'écran Android si elles améliorent l'invite d'installation.

Ajouter dans `app/index.html` :

- `viewport-fit=cover` ;
- `theme-color` ;
- `apple-touch-icon` ;
- lien vers le manifeste ;
- CSP minimale correspondant uniquement aux services réellement utilisés.

### 10.3 Parcours d'installation

- Android/Chromium : bouton « Installer l'application » lorsque l'événement d'installation est
  disponible.
- iOS : panneau d'aide expliquant Partager → Ajouter à l'écran d'accueil → Ouvrir comme app web.
- Navigateur non compatible : conserver un accès web normal sans bouton cassé.
- Application déjà installée : ne plus afficher l'invitation.
- Ne jamais bloquer l'utilisation derrière l'installation.

### 10.4 Service worker et mises à jour

Conserver un seul service worker pour éviter des portées concurrentes.

- Ajouter la coque mobile, ses styles, modules et icônes au pré-cache.
- Ne pas rendre l'installation du worker dépendante d'une ressource CDN.
- Cache-first pour les icônes et ressources immuables.
- Network-first pour HTML, CSS et JS, comme aujourd'hui.
- Firestore reste géré par son SDK, pas par le cache HTTP du service worker.
- Ne jamais mettre en cache une réponse contenant des notes MJ ou un indice encore secret.
- Afficher « Une mise à jour est disponible » et recharger sur action de l'utilisateur.
- Garder la vérification CI de cohérence entre version d'application et version de cache.
- Ajouter une vérification CI de l'existence de chaque ressource du pré-cache.

---

## 11. Hors connexion et synchronisation

### 11.1 Joueurs

Activer la persistance Firestore multi-onglets pour les requêtes publiques de l'application.

Comportement attendu :

- première visite en ligne obligatoire ;
- réouverture hors ligne avec les PNJs, relations et indices publics déjà reçus ;
- badge « Hors ligne — données du {date} » ;
- recherches et navigation fonctionnelles sur le cache ;
- resynchronisation automatique au retour du réseau ;
- pas d'état vide mensonger si le réseau tombe avant la première synchronisation.

### 11.2 MJ

- Les formulaires peuvent conserver un brouillon local.
- Les modifications de texte peuvent être mises en attente seulement si leur stratégie de conflit
  est définie.
- Une transaction de contrôle de conflit et un nouveau téléversement d'image exigent une
  connexion dans le premier lot.
- Le bouton Enregistrer indique explicitement pourquoi il est différé ou refusé.
- Fermer ou verrouiller le téléphone ne doit jamais faire croire qu'une modification a été
  enregistrée si elle ne l'a pas été.

### 11.3 Images

- Mettre en cache les portraits publics après leur première consultation.
- Ne jamais précharger toutes les illustrations.
- Une illustration secrète n'est ni préchargée ni placée dans un cache public.
- Lorsqu'un indice est révélé, son image devient consultable et peut alors être mise en cache.
- Repasser un indice en secret ne garantit pas l'effacement des copies déjà reçues par les
  joueurs ; afficher cet avertissement au MJ.

---

## 12. Découpage de réalisation

### Lot M0 — Baseline et sauvegardes

**Objectif :** pouvoir mesurer les régressions et revenir en arrière.

- Installer les dépendances de développement avec `npm ci`.
- Exécuter `npm run lint`, `npm run check` et `node --check` sur tous les modules.
- Capturer les parcours bureau PNJs et Enquêtes dans les deux thèmes.
- Capturer les rendus 375, 390, 430 px et bureau.
- Inventorier les documents et objets Storage sans écrire leur contenu dans le dépôt.
- Exporter une sauvegarde Firestore/Storage hors du dépôt.
- Définir les comptes et données de test non personnels.

**Terminé lorsque :** les contrôles sont verts, les sauvegardes existent et les parcours de
référence sont documentés.

### Lot M1 — Sécurité et intégrité

**Objectif :** corriger les risques avant de multiplier les clients.

- Ajouter visibilité PNJs/relations et notes privées.
- Migrer les documents existants de façon rétrocompatible.
- Protéger les images d'indices via les règles Storage et `imagePath`.
- Aligner la vérification d'adresse confirmée entre Firestore et Storage.
- Rendre les relations bidirectionnelles atomiques.
- Nettoyer les références et images lors des suppressions.
- Corriger la course `openPanel()` et les filtres fantômes.
- Ajouter les tests de règles Firebase.

**Terminé lorsque :** un joueur ne peut lire aucun document ou fichier secret, et toutes les
opérations mult documents sont atomiques ou compensées.

### Lot M2 — Couche de données commune

**Objectif :** supprimer la duplication future.

- Extraire configuration, normalisation et dépôts.
- Implémenter les abonnements temps réel.
- Implémenter les mutations communes.
- Adapter PNJs bureau sans changer son rendu.
- Adapter Enquêtes bureau sans changer son rendu.
- Vérifier les deux thèmes et l'administration bureau.

**Terminé lorsque :** `pnjs.js` et `enquetes.js` ne contiennent plus d'accès Firestore ou Storage
direct hors appels aux dépôts, et le comportement bureau est inchangé.

### Lot M3 — Coque mobile et lecture PNJs

**Objectif :** obtenir une première application utilisable par un joueur.

- Créer `app/index.html`, styles, routeur et navigation basse.
- Ajouter état réseau, chargement, erreur et cache.
- Construire liste, recherche, filtres et fiche PNJ.
- Intégrer relations et indices associés.
- Conserver état et scroll entre liste et détail.
- Vérifier accessibilité et tailles tactiles.

**Terminé lorsque :** un joueur peut accomplir tout le parcours PNJ d'une main à 375 px, en
ligne et depuis un cache déjà rempli.

### Lot M4 — Édition PNJs mobile

**Objectif :** permettre au MJ de gérer les PNJs pendant une partie.

- Ajouter connexion/déconnexion MJ adaptée au mode installé.
- Construire création, modification, aperçu et suppression.
- Ajouter photo, recadrage, compression et remplacement propre.
- Construire l'éditeur de relations.
- Ajouter gestion de brouillon, conflit et statuts d'enregistrement.
- Tester une modification depuis mobile observée en temps réel sur bureau, et inversement.

**Terminé lorsque :** toutes les opérations PNJ/relations disponibles sur bureau sont réalisables
sur téléphone sans fuite de droits ni perte silencieuse.

### Lot M5 — Lecture et édition Enquêtes

**Objectif :** compléter les deux onglets du périmètre.

- Construire liste et fiche joueur.
- Ajouter navigation croisée PNJ ↔ indice.
- Construire création, modification, publication et suppression MJ.
- Protéger et nettoyer les illustrations.
- Ajouter ordre et date de découverte.

**Terminé lorsque :** publier un indice depuis le téléphone le fait apparaître immédiatement chez
les joueurs et dans la page bureau.

### Lot M6 — Installation et finition PWA

**Objectif :** transformer le client mobile en produit installable fiable.

- Stabiliser l'identité du manifeste.
- Produire les icônes définitives.
- Migrer `start_url` vers l'application.
- Étendre le pré-cache.
- Ajouter parcours d'installation Android et iOS.
- Ajouter gestion de mise à jour.
- Vérifier mode autonome, safe areas, rotation et reprise après verrouillage.

**Terminé lorsque :** l'application s'installe, se met à jour et se relance correctement sur un
iPhone et un Android physiques.

### Lot M7 — Validation et activation publique

**Objectif :** livrer sans casser le site existant.

- Déployer d'abord `/app/` sans lien public ni changement du manifeste.
- Tester l'URL réelle GitHub Pages sur téléphones physiques.
- Valider les règles et index déployés.
- Faire tester le parcours joueur et le parcours MJ en situation de partie.
- Corriger les anomalies bloquantes.
- Activer le nouveau `start_url` et les invitations d'installation.
- Mettre à jour README, CHANGELOG, version et cache.

**Terminé lorsque :** les critères de recette finale sont tous cochés et le retour arrière a été
testé au moins une fois hors production.

---

## 13. Stratégie de tests

### 13.1 Automatisés

- `npm run lint` sans avertissement.
- `npm run check` vert.
- `node --check` sur chaque module.
- Tests unitaires des normaliseurs, tris, filtres et transformations de données.
- Tests Firebase Emulator Suite pour chaque rôle et chaque collection.
- Tests Storage : taille, MIME, MJ, joueur, découvert, secret, objet sans document associé.
- Tests de batch : relation bidirectionnelle tout ou rien.
- Tests de migration en `--dry-run`, puis sur un projet ou jeu de données de test.
- Test CI que chaque ressource locale pré-cachée existe.
- Test CI de cohérence version `layout.js` / `sw.js` / CHANGELOG.

L'outillage supplémentaire reste en `devDependencies` uniquement.

### 13.2 Matrice de droits

| Action | Déconnecté | Compte non-MJ | MJ |
|---|---:|---:|---:|
| Lire PNJ visible | oui | oui | oui |
| Lire PNJ masqué | non | non | oui |
| Lire notes privées | non | non | oui |
| Lire relation visible | oui | oui | oui |
| Lire relation masquée | non | non | oui |
| Lire indice découvert et image | oui | oui | oui |
| Lire indice secret et image | non | non | oui |
| Écrire PNJ/relation/indice | non | non | oui |
| Téléverser ou supprimer une image | non | non | oui |

Tester les règles directement avec le SDK, sans se contenter de l'absence des boutons.

### 13.3 Appareils et contextes

> **Décision du 19 août 2026 :** la validation sur iPhone est temporairement différée faute
> d'appareil disponible. Android physique reste le jalon courant. Les scénarios iOS sont conservés
> et devront être rejoués plus tard ; jusque-là, la documentation doit indiquer « iOS non validé ».

- iPhone récent avec encoche, Safari puis PWA installée.
- iPhone de petit format si disponible.
- Android Chrome, navigateur puis PWA installée.
- Largeurs simulées 375, 390 et 430 px.
- Portrait et paysage.
- Thèmes sombre et parchemin si le thème est conservé dans la PWA.
- Connexion rapide, lente, coupée avant chargement et coupée pendant enregistrement.
- Réouverture après fermeture forcée et après verrouillage de l'écran.
- Clavier virtuel ouvert sur chaque formulaire long.
- Texte agrandi à 200 %.
- `prefers-reduced-motion`.

### 13.4 Scénarios de recette essentiels

1. Le joueur installe l'application et retrouve l'icône correcte.
2. Il cherche un PNJ, ouvre sa fiche, suit une relation puis revient à sa recherche intacte.
3. Il ouvre un indice depuis un PNJ puis revient au PNJ.
4. Hors ligne après une première synchronisation, les données publiques restent consultables.
5. Un indice secret et son illustration sont inaccessibles par requête directe.
6. Le MJ se connecte, crée un PNJ avec photo et relation bidirectionnelle.
7. Le site bureau reçoit le nouveau PNJ sans rechargement.
8. Le MJ modifie ce PNJ sur bureau ; le téléphone reçoit la modification.
9. Deux éditions concurrentes déclenchent un avertissement, pas un écrasement silencieux.
10. Remplacer puis supprimer une image ne laisse pas d'objet Storage orphelin.
11. Supprimer un PNJ nettoie relations et références dans les indices.
12. Déconnexion MJ retire immédiatement notes et contenus secrets de l'écran.
13. Une nouvelle version de la PWA propose une mise à jour contrôlée.
14. Le site bureau PNJs et Enquêtes fonctionne exactement comme avant la refactorisation.

---

## 14. Déploiement et retour arrière

### 14.1 Ordre de déploiement

1. Règles et index compatibles avec l'ancien code.
2. Champs de migration et nouveaux chemins Storage, sans supprimer les anciens.
3. Couche de données commune et clients bureau compatibles ancien/nouveau schéma.
4. Application `/app/` non annoncée.
5. Validation réelle sur GitHub Pages.
6. Activation du manifeste et du parcours d'installation.
7. Suppression différée des champs et fichiers anciens après une période de stabilité.

Ne jamais déployer une règle exigeant un nouveau champ avant que tous les documents le possèdent
et que tous les clients sachent l'interroger.

### 14.2 Retour arrière

- Le site bureau reste disponible pendant tout le projet.
- Chaque migration de schéma est additive avant d'être destructive.
- Conserver temporairement `imageUrl` permet de revenir au lecteur précédent.
- Désactiver le lien public vers `/app/` et restaurer le `start_url` précédent suffit à retirer
  la PWA mobile de l'entrée principale sans supprimer les données.
- Une version de cache supplémentaire force le retour à des ressources stables.
- Les règles précédentes restent identifiables dans Git, mais ne sont restaurées que si elles ne
  rouvrent pas la faille des images secrètes.
- Les sauvegardes Firestore/Storage restent hors du dépôt et sont datées.

---

## 15. Documentation à maintenir

À chaque lot livré :

- mettre à jour [`CHANGELOG.md`](../CHANGELOG.md) ;
- synchroniser la version dans `js/layout.js` et `sw.js` ;
- documenter tout nouveau champ Firestore dans ce fichier ou dans un document de schéma dédié ;
- documenter les index et règles nécessaires ;
- ajouter les nouveaux actifs au service worker et aux contrôles CI ;
- mettre à jour le README avec le lien d'installation lorsque l'application est publique ;
- consigner les limites hors ligne et le comportement de remise en secret d'un indice ;
- ne jamais placer d'export Firestore, d'adresse joueur ou de donnée de campagne privée dans le
  dépôt public.

Le plan est décliné en **28 briefs autonomes** dans
[`briefs/mobile/README.md`](briefs/mobile/README.md), avec ordre, dépendances, fichiers concernés,
étapes exactes, recettes et message de commit.

---

## 16. Estimation indicative

Ordre de grandeur pour une personne connaissant déjà le dépôt, hors attente de validation :

| Lot | Charge indicative |
|---|---:|
| M0 — baseline et sauvegardes | 1 jour |
| M1 — sécurité et intégrité | 7 jours |
| M2 — couche de données commune | 8 jours |
| M3 — lecture PNJs mobile | 6,5 jours |
| M4 — édition PNJs mobile | 8,5 jours |
| M5 — Enquêtes mobile | 4 jours |
| M6 — installation et finition PWA | 5 jours |
| M7 — validation et activation | 3 jours |

Total indicatif après découpage détaillé : **43 jours de travail**, à répartir en livraisons
indépendantes. Cette estimation prudente remplace la première fourchette macro : elle inclut les
briefs de clôture, les migrations idempotentes, les tests de règles et les recettes sur appareils
physiques. Les principales incertitudes restent la migration sécurisée des images,
l'authentification Google en mode installé sur iOS et la validation en conditions réelles.

---

## 17. Critères de réussite finale

Le projet est considéré terminé lorsque :

- la PWA s'installe et se lance comme une application sur iOS et Android ;
- son interface mobile n'est pas une simple compression des pages bureau ;
- joueurs et MJ voient exactement les données correspondant à leur rôle ;
- le MJ peut gérer PNJs, portraits et relations entièrement depuis son téléphone ;
- Enquêtes est consultable et administrable sur mobile ;
- mobile et bureau reflètent les changements en temps réel ;
- aucune sauvegarde parallèle n'existe ;
- les données publiques déjà consultées restent disponibles hors ligne ;
- aucun indice, fichier ou note secrète n'est accessible à un joueur ;
- aucune écriture mult documents ne laisse un état partiel ;
- aucun conflit n'écrase silencieusement une version plus récente ;
- les parcours bureau ne régressent pas ;
- lint, smoke tests, tests de règles et recette appareils sont verts ;
- le déploiement et le retour arrière sont documentés et reproductibles.

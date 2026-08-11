# L1-04 — Versionner et durcir les règles Firebase

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 1 — sécurité (v2.13.2) |
| **Constat d'audit** | B3 — critique |
| **Estimation** | 3 h |
| **Fichiers** | `firestore.rules`, `storage.rules`, `firebase.json`, `.firebaserc` (tous nouveaux) |
| **Dépend de** | `L1-03` — la règle des fiches lit `campagne/acces`, qui doit exister |

---

## Pourquoi

Le dépôt ne contient **aucun** `firestore.rules`, `storage.rules` ni `firebase.json`. Tout le
modèle d'autorisation vit uniquement dans la console Firebase : non versionné, non relisible,
non testable, impossible à restaurer après une fausse manœuvre.

Or côté client, `isUserAdmin()`, `state.isAdmin` et `isUserAuthorized()` ne sont que de
l'affichage — ils masquent des boutons, ils ne protègent rien. N'importe qui peut ouvrir la
console du navigateur et écrire directement dans Firestore avec le SDK déjà chargé.

Deux expositions précises motivent l'urgence :

1. **La collection `mail`.** `js/doodle.js` y écrit depuis une session non authentifiée pour
   déclencher l'extension Trigger Email. Si la règle autorise la création libre, n'importe qui
   peut y déposer un document avec un `to` et un `html` arbitraires : un relais de courriel
   ouvert signant depuis le domaine du projet.
2. **Les indices non découverts.** `js/enquetes.js` *filtre* avec
   `where('decouvert','==',true)`. Un filtre de requête n'est pas une protection : si la règle
   autorise la lecture de la collection, un joueur lit tous les indices secrets de la campagne
   en trois lignes de console.

---

## À faire

### 1. `firebase.json` et `.firebaserc`

```json
// firebase.json
{
  "firestore": { "rules": "firestore.rules" },
  "storage":   { "rules": "storage.rules" }
}
```

```json
// .firebaserc
{
  "projects": { "default": "campagne-wrpg" }
}
```

Ne **pas** ajouter de section `hosting` : le site est servi par GitHub Pages, pas par Firebase
Hosting.

### 2. `firestore.rules`

Base à partir de laquelle travailler. Huit collections à couvrir.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isGM() {
      return request.auth != null
          && request.auth.token.email == 'ethoril@gmail.com'
          && request.auth.token.email_verified == true;
    }

    function acces() {
      return get(/databases/$(database)/documents/campagne/acces).data;
    }

    // ── Fiches : le MJ, ou une adresse listée dans campagne/acces ──
    match /fiches/{charId} {
      allow read, write: if isGM()
        || (request.auth != null
            && request.auth.token.email in acces().get(charId, []));
    }

    // ── Table d'accès : contient les adresses des joueurs, donc des données
    //    personnelles. Lecture réservée au MJ, jamais exposée au navigateur.
    //    La fonction acces() ci-dessus la consulte côté serveur, ce qui ne
    //    demande aucun droit de lecture au client. ──
    match /campagne/acces {
      allow read, write: if isGM();
    }

    // ── Calendrier impérial : lecture publique, avance réservée au MJ ──
    match /campagne/state {
      allow read:  if true;
      allow write: if isGM();
    }

    // ── PNJs et relations : lecture publique, édition MJ ──
    match /pnjs/{id}      { allow read: if true; allow write: if isGM(); }
    match /relations/{id} { allow read: if true; allow write: if isGM(); }

    // ── Indices : un secret non découvert n'est pas lisible ──
    match /indices/{id} {
      allow read:  if isGM() || resource.data.decouvert == true;
      allow write: if isGM();
    }

    // ── Sondage : le vote reste anonyme, par choix de conception.
    //    Un visiteur sans compte peut ajouter ou modifier SA réponse, une à
    //    la fois. Il ne peut ni supprimer une réponse existante, ni toucher
    //    aux dates, ni clôturer, ni supprimer le sondage. ──
    match /doodle/current {
      allow read: if true;
      allow create, delete: if isGM();
      allow update: if isGM() || (
           request.resource.data.diff(resource.data)
                 .affectedKeys().hasOnly(['responses'])
        && request.resource.data.responses.size() <= 30
        && request.resource.data.responses.diff(resource.data.responses)
                 .affectedKeys().size() == 1
        // Aucun votant existant ne disparaît : interdit la suppression
        // d'une réponse par un anonyme, que le MJ conserve via isGM().
        && request.resource.data.responses.keys()
                 .hasAll(resource.data.responses.keys())
      );
    }

    // ── Courriels : création seule, destinataire et forme imposés ──
    match /mail/{id} {
      allow read, update, delete: if false;
      allow create: if
           request.resource.data.keys().hasOnly(['to', 'message'])
        && request.resource.data.to == 'ethoril@gmail.com'
        && request.resource.data.message.keys().hasOnly(['subject', 'html'])
        && request.resource.data.message.subject.size() <= 200
        && request.resource.data.message.html.size() <= 2000;
    }
  }
}
```

### 3. `storage.rules`

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    function isGM() {
      return request.auth != null
          && request.auth.token.email == 'ethoril@gmail.com';
    }

    match /portraits/{file} {
      allow read:  if true;
      allow write: if isGM()
        && request.resource.size < 2 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }

    match /indices/{file} {
      allow read:  if true;
      allow write: if isGM()
        && request.resource.size < 5 * 1024 * 1024
        && request.resource.contentType.matches('image/.*');
    }
  }
}
```

### 4. Déployer

Le déploiement des règles ne passe **pas** par GitHub Pages :

```bash
npx firebase-tools deploy --only firestore:rules,storage
```

À défaut de CLI, copier-coller le contenu des deux fichiers dans la console Firebase. Dans les
deux cas, **le fichier du dépôt est la source de vérité** : on le modifie d'abord, on déploie
ensuite. Jamais l'inverse, sinon le fichier versionné redevient de la décoration.

---

## Trois limites à connaître

Elles changent ce sur quoi on peut compter. À lire avant d'écrire les règles, pas après.

### Le pseudo d'un votant ne peut pas être validé côté serveur

Le pseudo est une **clé** de la map `responses`. Le langage de règles Firestore ne permet pas
d'extraire une clé pour en tester la longueur ou le contenu — il n'y a pas de boucle, et
`affectedKeys()` renvoie un ensemble qu'on peut compter mais pas parcourir.

La règle ci-dessus limite donc le nombre de votants (30) et le nombre de clés modifiées par
écriture (1), mais **pas** le contenu du pseudo. Celui-ci est borné côté client par le brief
`L1-01`, et la vraie défense reste l'échappement.

Une alternative existe : passer `responses` d'une map à un tableau d'objets
`[{ nom, votes }]`. Le pseudo devient alors une *valeur*, donc validable par les règles. Coût :
une migration du document existant et la réécriture de `renderPoll()`, `submitVote()` et
`openVotesModal()`, soit environ 2 h de plus.

**Cette alternative n'est pas à mettre en œuvre dans ce brief.** Elle demande une validation
préalable. Implémenter la solution par défaut ci-dessus.

### Le vote anonyme est un choix assumé, pas une faiblesse à corriger

Décision du 11 août 2026 : **les joueurs votent sans compte, et cela ne change pas.** Ne pas
proposer de connexion obligatoire, ne pas ajouter de règle exigeant `request.auth != null` sur
`doodle/current`.

Ce que la conception accepte donc, en connaissance de cause : quelqu'un qui saisit le pseudo
d'un autre joueur écrase sa réponse. C'est déjà le cas aujourd'hui, la confirmation
« est-ce bien toi ? » n'étant qu'un garde-fou côté client. La règle `hasAll` ci-dessus réduit
tout de même la casse : un anonyme peut modifier une réponse, jamais en faire disparaître une.

La protection qui compte contre un visiteur malveillant reste l'échappement du brief `L1-01`,
pas l'authentification.

### La règle `indices` impose la forme des requêtes

`allow read: if isGM() || resource.data.decouvert == true` n'autorise une lecture **en liste**
que si la requête porte elle-même la contrainte `decouvert == true`. C'est déjà le cas de
`js/enquetes.js` (~l. 68) et de `js/pnjs.js` (~l. 719) pour un visiteur non administrateur.

Ces deux requêtes deviennent donc **obligatoires** : il ne faudra pas les « simplifier » plus
tard en enlevant le filtre, sous peine de casser la page pour tous les non-administrateurs.
Ajouter un commentaire à cet effet dans les deux fichiers JS.

### Les images d'indices ne sont pas vraiment protégées

Les URL délivrées par `getDownloadURL()` contiennent un jeton aléatoire, donc l'illustration
d'un indice non découvert n'est pas devinable en pratique. Mais elle n'est pas protégée par la
règle : les règles Storage ne peuvent pas aller consulter le drapeau `decouvert` du document
Firestore correspondant.

C'est une protection par obscurité, et c'est assumé. La seule vraie garantie serait de ne
téléverser l'illustration qu'au moment de la révélation de l'indice — hors périmètre, à décider
plus tard. Le noter en commentaire dans `storage.rules`.

---

## Ne pas faire

- **Ne pas déployer avant d'avoir testé.** Une règle trop stricte casse le site pour tout le
  monde, y compris le MJ. Dérouler toute la checklist avant `firebase deploy`.
- **Ne pas ajouter de section `hosting`** dans `firebase.json`.
- **Ne pas remplacer le contrôle par email par un contrôle par UID.** Les UID ne sont pas
  connus à l'avance et le projet raisonne en adresses partout ailleurs.
- **Ne pas assouplir une règle parce qu'un parcours échoue.** Si un parcours légitime est
  bloqué, c'est en général le code client qui doit adapter sa requête (cas des indices).

---

## Vérification

Les tests « depuis la console » se font dans la console du navigateur, sur une page du site où
le SDK Firebase est déjà chargé (`pnjs.html` par exemple), en état **déconnecté**.

### Ce qui doit être refusé

- [ ] Lire `indices` **sans** filtre : refusé.
- [ ] Écrire dans `mail` un document dont `to` est une autre adresse : refusé.
- [ ] Écrire dans `mail` un document avec une clé supplémentaire (`replyTo`, `cc`…) : refusé.
- [ ] Écrire `{ closed: true }` sur `doodle/current` : refusé.
- [ ] Écrire deux pseudos d'un coup dans `responses` : refusé.
- [ ] Remplacer ou supprimer les 15 dates du sondage : refusé.
- [ ] Supprimer la réponse d'un joueur existant (`deleteField()` sur une clé de `responses`) :
      refusé — c'est ce que garantit la clause `hasAll`.
- [ ] **Voter normalement, sans être connecté : accepté.** C'est le comportement à préserver ;
      si ce point échoue, la règle est trop stricte et c'est elle qu'il faut corriger, pas
      l'application.
- [ ] Écrire dans `pnjs`, `relations` ou `indices` : refusé.
- [ ] Écrire sur `campagne/state` (avancer le calendrier) : refusé.
- [ ] Avec un **compte joueur** : lire `fiches/wren` en n'y étant pas listé : refusé.
- [ ] Avec un **compte joueur** : écrire dans `campagne/acces` : refusé.
- [ ] Avec un **compte joueur** : **lire** `campagne/acces` : refusé. C'est ce qui garantit que
      les adresses des joueurs ne circulent pas — le vérifier explicitement, c'est la raison
      d'être de cette règle.
- [ ] Avec un compte joueur autorisé : sa fiche se lit **quand même**, ce qui prouve que la
      fonction `acces()` consulte bien le document côté serveur sans droit de lecture client.
- [ ] Onglet Réseau, connecté en joueur : aucune réponse Firestore ne contient d'adresse
      électronique d'un autre joueur.

### Ce qui doit continuer de fonctionner

- [ ] Lire `indices` **avec** `where('decouvert','==',true)`, déconnecté.
- [ ] Le vote normal au Calendrier, déconnecté, y compris le courriel de notification
      effectivement reçu.
- [ ] Le calendrier impérial de l'accueil s'affiche déconnecté.
- [ ] Le graphe des PNJs et le panneau de détail s'affichent déconnecté, avec les indices
      découverts liés.
- [ ] La page Enquêtes affiche les indices découverts, déconnecté.
- [ ] Compte joueur : sa fiche s'ouvre, se charge et se sauvegarde.
- [ ] Compte MJ : les six fiches, la création et la modification de PNJ, l'ajout et la
      suppression de relation, la création et la modification d'indice, le téléversement d'un
      portrait et d'une illustration d'indice, l'avance du calendrier impérial, et les six
      actions d'administration du sondage.

### Documentation

- [ ] Les trois limites ci-dessus sont reportées en commentaire dans les fichiers de règles.
- [ ] Le commentaire sur l'obligation du filtre `decouvert` est ajouté dans `js/enquetes.js`
      et `js/pnjs.js`.

---

## Message de commit

```
feat(securite): versionner et durcir les regles Firestore et Storage (B3)

Le modele d'autorisation n'existait que dans la console Firebase, non
versionne et non relisible, tandis que tous les controles cote client
se contournent depuis la console du navigateur.

- firestore.rules : 8 collections, acces des fiches lu depuis campagne/acces
- collection mail limitee a la creation, destinataire et forme imposes
- indices non decouverts illisibles hors MJ
- doodle/current : un anonyme ne modifie que responses, une cle a la fois
- storage.rules : ecriture MJ seule, type et taille bornes
- firebase.json et .firebaserc pour le deploiement des regles
```

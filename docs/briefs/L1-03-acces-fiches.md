# L1-03 — Ouvrir les fiches aux joueurs

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 1 — sécurité (v2.13.2) |
| **Constat d'audit** | B2 — critique |
| **Estimation** | 1 h 30 |
| **Fichiers** | `js/fiche-cloud.js` |
| **Prérequis** | Le document `campagne/acces` doit exister dans Firestore (voir § 1) |
| **Dépend de** | — |

---

## Pourquoi

Dans `js/fiche-cloud.js`, la table d'autorisation est vide et l'a toujours été depuis le commit
qui l'a introduite — « feat: deploiement des fiches de personnages individuelles et
securisation firebase », `63f7471` au moment d'écrire ce brief :

```js
const CHAR_OWNERS = {
    bhelgi: [], caelel: [], elysia: [],
    hellaya: [], wren: [], test: []
};
```

`isUserAuthorized()` ne renvoie donc `true` que pour `ADMIN_EMAIL`. **Tout joueur qui se
connecte avec son compte Google voit le mur « Vous n'avez pas l'autorisation d'accéder à la
fiche de … ».** La fonctionnalité annoncée dans le CHANGELOG 2.10.0 — « Les joueurs disposent
désormais de leur propre fiche accessible depuis Le Groupe » — n'a jamais fonctionné pour eux.

La solution retenue déplace la table dans Firestore, pour qu'ajouter ou retirer un joueur ne
demande plus un commit et un déploiement, et pour que les règles Firestore (`L1-04`) lisent la
même source de vérité que le client.

---

## À faire

### 1. Créer le document Firestore

Dans la console Firebase, collection `campagne`, document `acces` — à côté du document `state`
déjà utilisé par le calendrier impérial :

```
campagne/acces
{
  bhelgi:  ["adresse-du-joueur@gmail.com"],
  caelel:  ["adresse-du-joueur@gmail.com"],
  elysia:  ["adresse-du-joueur@gmail.com"],
  hellaya: ["adresse-du-joueur@gmail.com"],
  wren:    ["adresse-du-joueur@gmail.com"]
}
```

Chaque valeur est un tableau : un personnage peut avoir plusieurs propriétaires (un joueur et
son conjoint qui tient la fiche, par exemple). Le personnage `test` n'a pas d'entrée — seul le
MJ y accède, par la règle qui le concerne.

**Les adresses sont à demander au MJ.** Si elles ne sont pas disponibles au moment de traiter
le brief, créer le document avec cinq tableaux vides : le code sera correct et il n'y aura plus
qu'à remplir la console.

### 2. Remplacer `CHAR_OWNERS` par une lecture mise en cache

Supprimer la constante et écrire à sa place :

```js
// La table d'accès vit dans Firestore (campagne/acces) pour qu'ajouter un joueur
// ne demande pas de déploiement, et pour que les règles Firestore lisent la même
// source de vérité que le client. Lue une fois par chargement de page.
let _accesPromise = null;

function getAcces() {
    if (!_accesPromise) {
        _accesPromise = getDoc(doc(db, 'campagne', 'acces'))
            .then(s => (s.exists() ? s.data() : {}))
            .catch(e => {
                console.error('[fiche-cloud] lecture campagne/acces:', e);
                return {};   // en cas d'échec : aucun accès, jamais l'inverse
            });
    }
    return _accesPromise;
}

async function isUserAuthorized(user, charId) {
    if (!user?.email) return false;
    if (user.email === GM_EMAIL) return true;
    const acces = await getAcces();
    return (acces[charId] || []).includes(user.email);
}
```

Le `catch` qui renvoie `{}` est important : en cas d'erreur réseau, l'utilisateur n'a **aucun**
accès. Ne jamais choisir l'inverse par confort.

### 3. Propager le passage en asynchrone

`isUserAuthorized()` devient une fonction `async`. Deux appelants à adapter :

**`cloudSave()`** — l'appel doit être attendu :

```js
const user = auth.currentUser;
if (!user) return;
if (!(await isUserAuthorized(user, charId))) return;
```

Attention : `cloudSave` est appelée depuis un `setTimeout` dans `js/fiche.js`
(`saveNow._t`). L'échec d'autorisation doit y rester **silencieux**, comme aujourd'hui, sans
rejet de promesse non capturé dans la console.

**Le callback de `watchAuth()`** — il est déjà `async`, il suffit d'ajouter `await` aux deux
tests `isUserAuthorized(user, charId)`.

### 4. Traiter la fenêtre de vérification

Aujourd'hui, `showLoginWall()` affiche immédiatement le message de refus. Avec une lecture
asynchrone, ce message apparaîtrait à tort pendant la durée de la requête.

Dans le callback de `watchAuth`, quand un utilisateur est connecté : afficher d'abord
« Vérification des accès… » via `showLoginWall()`, puis n'afficher le refus qu'une fois la
réponse obtenue.

```js
if (user) {
    showLoginWall('Vérification des accès…');
    const autorise = await isUserAuthorized(user, charId);
    if (!autorise) {
        // … barre d'authentification + message de refus
        showLoginWall("Vous n'avez pas l'autorisation d'accéder à cette fiche.");
        return;
    }
    // … suite inchangée
}
```

Profiter du passage pour retirer `charId` du message de refus : le nom technique du personnage
n'apporte rien au joueur, qui sait sur quelle page il est.

---

## Ne pas faire

- **Ne pas mettre les adresses en dur dans le JavaScript**, même « en attendant ». C'est
  exactement ce que ce brief supprime.
- **Ne pas utiliser `onSnapshot`** pour la table d'accès. Une lecture unique par chargement
  suffit, un abonnement temps réel serait du quota consommé pour rien.
- **Ne pas mettre la table d'accès en cache dans `localStorage`.** Un cache local d'une
  décision d'autorisation est manipulable par l'utilisateur.
- **Ne pas considérer ce brief comme suffisant.** Le contrôle reste côté client et se contourne
  depuis la console du navigateur : c'est le brief `L1-04` qui rend l'autorisation réelle, en
  appliquant la même table dans les règles Firestore. Les deux vont ensemble.

---

## Vérification

- [ ] Avec un compte joueur listé sur son personnage : la fiche s'ouvre, les données se
      chargent, une modification se sauvegarde (statut « ☁ Sauvegardé »).
- [ ] Avec ce même compte, en changeant l'URL vers un autre personnage : message de refus,
      et **aucune** donnée de la fiche affichée derrière le mur.
- [ ] Avec le compte MJ : les six fiches s'ouvrent, y compris `test` qui n'est pas dans
      `campagne/acces`.
- [ ] Déconnecté : le mur affiche « Connexion requise pour accéder à la fiche. »
- [ ] Mode hors ligne (outils de développement), connecté : le mur reste affiché et la fiche
      **ne s'ouvre pas**. Une erreur dans la console est acceptable, un accès accordé ne l'est
      pas.
- [ ] Le message « Vérification des accès… » est visible brièvement, et le message de refus
      n'apparaît **jamais** pour un joueur pourtant autorisé, même sur connexion lente
      (throttling « Slow 3G » dans les outils de développement).
- [ ] Enchaîner deux modifications espacées de 3 secondes : les **deux** partent vers
      Firestore. La promesse mise en cache ne doit pas court-circuiter le second envoi.
- [ ] Ajouter une adresse dans `campagne/acces` en console, recharger la page : l'accès est
      accordé sans redéploiement.

---

## Message de commit

```
feat(fiche): table d'acces des fiches dans Firestore (B2)

CHAR_OWNERS etait vide depuis son introduction : seul le MJ pouvait
ouvrir une fiche, les joueurs voyaient un refus d'autorisation.

- lecture de campagne/acces, mise en cache dans une promesse de module
- isUserAuthorized devient async, propagation dans cloudSave et watchAuth
- etat intermediaire "Verification des acces" pour ne plus afficher le
  refus pendant la requete
- aucun acces en cas d'echec de lecture
```

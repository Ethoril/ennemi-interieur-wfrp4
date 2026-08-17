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

**Deux contraintes de casse, sous peine d'une table inopérante :**

- Les **noms de champs** reprennent exactement le paramètre `char` de l'URL, en minuscules :
  `bhelgi`, `caelel`, `elysia`, `hellaya`, `wren`. Le code fait `acces[charId]`, une lecture de
  clé sensible à la casse — `Bhelgi` ne serait jamais trouvé.
- Les **adresses** sont saisies **en minuscules**. La règle Firestore compare avec
  `request.auth.token.email.lower() in …` : elle normalise l'adresse entrante, mais le langage de
  règles ne sait pas parcourir une liste pour normaliser les valeurs stockées.

### Les adresses sont des données personnelles — elles ne sortent pas de Firestore

**Le MJ saisit les cinq adresses lui-même, directement dans la console Firebase.** Elles ne
doivent apparaître dans **aucun** fichier du dépôt, aucun commit, aucun brief, aucun message,
aucune capture d'écran. Le dépôt est public : une adresse commise y reste dans l'historique et
n'en sort qu'au prix d'une réécriture et d'une intervention du support GitHub.

Le développeur n'a pas besoin de les connaître : il crée le document avec cinq tableaux vides,
écrit le code, et le MJ remplit les valeurs. C'est aussi pour cela que la table vit dans
Firestore et non dans le JavaScript.

Conséquence sur la conception, développée aux points 2 et 3 : **le navigateur ne lit jamais
cette table.** Seules les règles Firestore la consultent, côté serveur.

### 2. Supprimer `CHAR_OWNERS` et `isUserAuthorized()` — sans rien lire à la place

Supprimer les deux, **sans les remplacer par une lecture de `campagne/acces`.** Un contrôle
d'autorisation écrit en JavaScript est de l'affichage : il se contourne depuis la console du
navigateur, et il obligerait à télécharger les cinq adresses dans le navigateur de chaque
visiteur connecté.

**L'autorisation est décidée par les règles Firestore** (`L1-04`), qui consultent
`campagne/acces` côté serveur via `get()`. Le rôle du client se réduit à : tenter la lecture de
la fiche, et interpréter le refus.

C'est à la fois plus sûr et plus simple que la version initialement prévue — un aller-retour
réseau au lieu de deux, et plus aucune propagation d'`async` à travers le module.

### 3. Réécrire le callback de `watchAuth()`

Le contrôle d'autorisation disparaît au profit du résultat de la lecture :

```js
watchAuth(async (user, isAdmin) => {
    const bar = document.getElementById('fiche-auth-bar');
    if (!bar) return;

    if (!user) {
        // … branche non connectée, inchangée
        return;
    }

    // L'autorisation est tranchée par les règles Firestore, qui lisent
    // campagne/acces côté serveur : le navigateur ne voit jamais les adresses
    // des joueurs. Un refus se manifeste par une erreur permission-denied.
    showLoginWall('Vérification des accès…');

    let snap;
    try {
        snap = await getDoc(doc(db, 'fiches', charId));
    } catch (e) {
        if (e.code === 'permission-denied') {
            bar.innerHTML = `
                <span class="fiche-auth-user">☁ ${esc(user.displayName || user.email)}</span>
                <button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
            document.getElementById('btn-cloud-signout')
                ?.addEventListener('click', () => logout());
            showLoginWall("Vous n'avez pas l'autorisation d'accéder à cette fiche.");
            return;
        }
        setStatus('⚠ Erreur de chargement', 'error');
        console.error('[fiche-cloud] load error:', e);
        showLoginWall('Chargement impossible. Réessayez plus tard.');
        return;
    }

    // … construction de la barre d'authentification et du bouton de reset (isAdmin)
    // … puis, si snap.exists(), ficheLoadCloud(snap.data().data, millis)
    // … puis showFiche()
});
```

Deux points à respecter :

- **Un échec réseau n'est pas un refus.** Ne traiter comme refus que
  `e.code === 'permission-denied'`. Toute autre erreur laisse le mur affiché avec un message
  distinct, jamais la fiche ouverte.
- **Une fiche inexistante n'est pas un refus.** Pour un personnage dont le document n'a jamais
  été créé, la règle autorise la lecture et `snap.exists()` vaut `false` : la fiche s'ouvre
  vide, comme aujourd'hui.

### 4. Adapter `cloudSave()`

Retirer l'appel à `isUserAuthorized()` : c'est la règle qui refuse l'écriture. Distinguer le
refus d'autorisation d'une vraie erreur, pour ne pas afficher « ⚠ Erreur » à quelqu'un qui voit
déjà le mur :

```js
} catch (e) {
    if (e.code === 'permission-denied') {
        setStatus('');           // le mur est déjà affiché, ne pas alarmer
        return;
    }
    setStatus('⚠ Erreur', 'error');
    console.error('[fiche-cloud] save error:', e);
} finally {
    _saving = false;
}
```

Après ces suppressions, l'import `ADMIN_EMAIL as GM_EMAIL` peut devenir inutilisé dans ce
fichier — le retirer si c'est le cas. `isAdmin`, fourni par `watchAuth`, reste utilisé pour le
bouton de réinitialisation.
```

Profiter du passage pour retirer `charId` du message de refus : le nom technique du personnage
n'apporte rien au joueur, qui sait sur quelle page il est.

---

## Ne pas faire

- **Ne jamais écrire une adresse de joueur dans un fichier du dépôt**, même en exemple, même en
  commentaire, même « en attendant ». Le dépôt est public.
- **Ne pas mettre les adresses en dur dans le JavaScript**, même « en attendant ». C'est
  exactement ce que ce brief supprime.
- **Ne pas lire `campagne/acces` depuis le navigateur**, ni avec `getDoc`, ni avec
  `onSnapshot`, ni pour « afficher la liste des joueurs autorisés ». Ce document ne quitte pas
  Firestore : la règle de `L1-04` en réserve la lecture au MJ, et toute tentative côté client
  échouerait de toute façon en `permission-denied`.
- **Ne pas mettre la table d'accès en cache dans `localStorage`.** Un cache local d'une
  décision d'autorisation est manipulable par l'utilisateur — et il y déposerait les adresses.
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

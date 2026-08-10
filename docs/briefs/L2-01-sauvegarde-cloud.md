# L2-01 — Fiabiliser la sauvegarde cloud de la fiche

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | I2 |
| **Estimation** | 1 h 30 |
| **Fichiers** | `js/fiche-cloud.js`, `js/fiche.js` |
| **Dépend de** | `L1-03` (la signature de `isUserAuthorized` a changé) |
| **À traiter avant** | `L2-02` — les deux touchent au chemin de sauvegarde |

---

## Pourquoi

Deux fuites se cumulent et font perdre silencieusement des modifications.

**La garde `_isSaving` abandonne une sauvegarde.** Dans `cloudSave()`, si une écriture est déjà
en vol, la nouvelle demande fait simplement `return`. Il n'y a ni file d'attente ni reprise :
les modifications de cette fenêtre ne partent jamais.

**Le vidage avant fermeture ne concerne que le local.** `js/fiche.js` écoute `beforeunload` et
appelle `saveNow()`, qui écrit dans `localStorage` puis **réarme** un minuteur cloud de 2 s.
Ce minuteur ne se déclenchera jamais, l'onglet se fermant avant.

La comparaison d'horodatage de `ficheLoadCloud()` rattrape le coup — mais seulement depuis le
même navigateur. Un joueur qui saisit ses achats XP, ferme l'onglet et rouvre sa fiche sur son
téléphone perd ses dernières modifications.

---

## À faire

### 1. File d'attente dans `cloudSave()`

Remplacer la garde `_isSaving` par un couple « en cours / en attente ». La demande arrivée
pendant une écriture n'est plus jetée : elle est mémorisée et relancée à la fin, avec les
données les plus récentes.

```js
let _saving = false;
let _pending = null;

export const cloudSave = async (data) => {
    const user = auth.currentUser;
    if (!user) return;
    if (!(await isUserAuthorized(user, charId))) return;

    // Une écriture est en vol : mémoriser la demande au lieu de la jeter.
    // Seules les données les plus récentes comptent, d'où l'écrasement.
    if (_saving) { _pending = data; return; }

    _saving = true;
    setStatus('Sauvegarde…', 'saving');
    try {
        await setDoc(doc(db, 'fiches', charId), { data, updatedAt: serverTimestamp() });
        setStatus('☁ Sauvegardé', 'saved');
        setTimeout(() => setStatus(''), 3000);
    } catch (e) {
        setStatus('⚠ Erreur', 'error');
        console.error('[fiche-cloud] save error:', e);
    } finally {
        _saving = false;
        if (_pending) {
            const suivant = _pending;
            _pending = null;
            cloudSave(suivant);
        }
    }
};
```

L'écrasement de `_pending` est volontaire : si trois modifications arrivent pendant une
écriture, seule la dernière image de l'état a un intérêt.

### 2. Envoi immédiat exposé pour la fermeture

Ajouter à `js/fiche-cloud.js` un export qui court-circuite la file d'attente, à utiliser au
moment où la page disparaît :

```js
/** Envoi immédiat, sans passer par la file : utilisé à la fermeture de la page. */
export const cloudSaveNow = async (data) => {
    _pending = null;
    _saving = false;
    return cloudSave(data);
};
```

### 3. Remplacer `beforeunload` dans `js/fiche.js`

Le bloc actuel (~l. 1847) écoute `beforeunload` et ne vide que le minuteur local. Le remplacer
par un vidage complet, déclenché sur les deux événements réellement fiables :

```js
// Vidage complet avant disparition de la page : localStorage ET cloud.
// `beforeunload` seul ne suffisait pas — saveNow() réarme un minuteur cloud
// de 2 s qui ne se déclenche jamais. `pagehide` et `visibilitychange` sont
// par ailleurs les seuls événements fiables sur mobile, où l'onglet peut
// être supprimé sans jamais émettre `beforeunload`.
function flushAll() {
    if (_saveLocalTimer) { clearTimeout(_saveLocalTimer); _saveLocalTimer = null; }
    const data = exportData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ _savedAt: Date.now(), ...data }));
    clearTimeout(saveNow._t);
    cloudSaveNow?.(data);
}

window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
});
```

Adapter l'import en tête de fichier : `import { cloudSave, cloudSaveNow } from './fiche-cloud.js';`

Ne **pas** garder l'écouteur `beforeunload` en plus : `pagehide` couvre les mêmes cas et le
doublon provoquerait deux écritures.

### 4. Éviter les envois inutiles

`visibilitychange` se déclenche à chaque passage en arrière-plan, même sans modification.
Ajouter un drapeau « état modifié depuis le dernier envoi cloud » et sortir tôt de `flushAll()`
s'il est faux. Le poser dans `save()` et `saveNow()`, le retirer après un envoi cloud réussi.

---

## Ne pas faire

- **Ne pas toucher à `ficheLoadCloud()`.** La comparaison `_savedAt` / `updatedAt` est correcte
  et reste le filet de dernier recours.
- **Ne pas utiliser `navigator.sendBeacon()`.** L'écriture passe par le SDK Firestore, qui gère
  son propre transport et sa propre authentification.
- **Ne pas raccourcir le débounce cloud de 2 s.** Il protège le quota Firestore ; le problème
  n'était pas sa durée mais l'absence de vidage.
- **Ne pas transformer `flushAll` en fonction `async`** avec `await` : au moment de `pagehide`,
  la page peut disparaître avant la résolution. On lance l'écriture, on n'attend pas.

---

## Vérification

Utiliser `fiche.html?char=test`.

- [ ] Modifier une caractéristique puis fermer l'onglet dans la seconde. Rouvrir la fiche dans
      un **autre navigateur** connecté au même compte : la valeur est là.
- [ ] Même essai sur mobile (ou en simulation) en basculant vers une autre application plutôt
      qu'en fermant l'onglet.
- [ ] Saisir rapidement cinq valeurs différentes dans le même champ : le statut passe par
      « Sauvegarde… » puis « ☁ Sauvegardé », et la **dernière** valeur est bien celle stockée
      dans Firestore (vérifier dans la console Firebase).
- [ ] Réseau coupé pendant une saisie : le statut passe en « ⚠ Erreur ». Rétablir le réseau,
      modifier à nouveau : l'ensemble repart.
- [ ] Passer l'onglet en arrière-plan **sans avoir rien modifié**, dix fois de suite : aucune
      écriture Firestore (onglet Réseau, filtre `firestore`).
- [ ] Passer en arrière-plan **après** une modification : une écriture, une seule.
- [ ] Recharger la page : l'état est complet, sans duplication de lignes dans les compétences
      avancées, les talents ou le journal XP.
- [ ] Compte non autorisé sur cette fiche : aucune écriture, aucun rejet de promesse non
      capturé dans la console.

---

## Message de commit

```
fix(fiche): ne plus perdre de sauvegardes cloud (I2)

La garde _isSaving jetait toute demande arrivant pendant une ecriture,
et beforeunload ne vidait que le minuteur localStorage : la derniere
modification avant fermeture n'atteignait jamais Firestore.

- file d'attente a la place de la garde, relance en fin d'ecriture
- export cloudSaveNow pour un envoi immediat
- vidage complet sur pagehide et visibilitychange, plus fiables que
  beforeunload sur mobile
- drapeau d'etat modifie pour eviter les envois inutiles
```

# L2-11 — Modale de confirmation pour les actions destructives

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | N4 (partiel — 7 actions sur 13) |
| **Estimation** | 2 h |
| **Fichiers** | `js/ui-confirm.js` (nouveau), `css/components.css`, `js/fiche-cloud.js`, `js/pnjs.js`, `js/enquetes.js`, `js/doodle.js` |
| **Dépend de** | — |

---

## Pourquoi

Le projet compte treize `alert()` et `confirm()` natifs. Ils sont bloquants, hors thème,
non stylables, et Safari sur iOS les supprime parfois après plusieurs dialogues d'affilée — ce
qui peut faire passer une suppression sans confirmation.

Le plus préoccupant est la réinitialisation de fiche : deux `confirm()` enchaînés, puis un
`deleteDoc` irréversible. Une suppression aussi lourde de conséquences mérite mieux qu'un
dialogue système que l'utilisateur valide par réflexe.

**Périmètre volontairement restreint** : seules les **7 actions destructives** passent en modale.
Les 6 `alert()` d'erreur restent en place, c'est une décision assumée.

---

## À faire

### 1. Créer `js/ui-confirm.js`

Un module exposant une fonction unique qui renvoie une promesse de booléen, construite sur
l'élément `<dialog>` — il fournit gratuitement la gestion du focus, la fermeture par `Échap` et
le voile modal, qu'une `<div>` maison devrait réimplémenter.

```js
import { esc } from './utils.js';

let _dialog = null;

function ensureDialog() {
    if (_dialog) return _dialog;
    _dialog = document.createElement('dialog');
    _dialog.className = 'ui-confirm';
    _dialog.innerHTML = `
        <h3 class="ui-confirm-titre"></h3>
        <p  class="ui-confirm-message"></p>
        <div class="ui-confirm-actions">
            <button class="ui-confirm-annuler" type="button">Annuler</button>
            <button class="ui-confirm-valider" type="button"></button>
        </div>`;
    document.body.appendChild(_dialog);
    return _dialog;
}

/**
 * Demande une confirmation. Renvoie une promesse résolue à true si l'action
 * est confirmée, false sinon (bouton Annuler, Échap, clic sur le voile).
 */
export function confirmAction({ titre, message, libelleAction = 'Confirmer', danger = false }) {
    const d = ensureDialog();
    d.querySelector('.ui-confirm-titre').textContent   = titre;
    d.querySelector('.ui-confirm-message').textContent = message;
    const valider = d.querySelector('.ui-confirm-valider');
    valider.textContent = libelleAction;
    valider.classList.toggle('ui-confirm-danger', danger);
    d.classList.toggle('ui-confirm--danger', danger);

    return new Promise(resolve => {
        const fin = (reponse) => {
            valider.removeEventListener('click', ok);
            d.removeEventListener('close', annule);
            d.removeEventListener('click', voile);
            d.close();
            resolve(reponse);
        };
        const ok     = () => fin(true);
        const annule = () => fin(false);
        const voile  = (e) => { if (e.target === d) fin(false); };

        valider.addEventListener('click', ok);
        d.addEventListener('close', annule);      // couvre Échap
        d.addEventListener('click', voile);
        d.showModal();
        d.querySelector('.ui-confirm-annuler').focus();   // défaut non destructif
    });
}
```

Points de conception à respecter :

- `textContent` partout, jamais `innerHTML` — le titre et le message peuvent contenir un nom de
  personnage ou de joueur.
- Le focus initial va sur **Annuler**, pas sur l'action destructive.
- Les écouteurs sont retirés à chaque fermeture : le dialogue est réutilisé, sans quoi ils
  s'empileraient à chaque appel.
- L'événement `close` couvre `Échap` sans écouteur clavier supplémentaire.

### 2. Styler dans `css/components.css`

Avec les jetons du projet, dans les deux thèmes. Ne pas oublier `dialog::backdrop`, qui n'hérite
pas des variables du document dans tous les navigateurs — utiliser une valeur littérale
semi-transparente y est acceptable, c'est un voile neutre.

Prévoir : largeur maximale (~28rem), bordure dorée, `border-radius: var(--radius-md)`,
le bouton de danger en `var(--blood-bright)`, et une mise en page qui tient en 375 px de large
avec les deux boutons atteignables au pouce.

Respecter `prefers-reduced-motion` si une animation d'apparition est ajoutée — l'animation
`popIn` existante de `components.css` est déjà appliquée à d'autres modales, la réutiliser.

### 3. Remplacer les 7 appels

Toutes les fonctions appelantes deviennent `async` si elles ne le sont pas.

| Fichier | Action | Ce qui change |
|---|---|---|
| `js/fiche-cloud.js` | Réinitialisation de fiche | Les **deux** `confirm()` enchaînés deviennent **une** modale, avec le nom du personnage dans le message et le libellé d'action « Supprimer définitivement » |
| `js/pnjs.js` | `deletePnj()` | « Supprimer ce personnage et toutes ses relations ? » → nommer le PNJ |
| `js/pnjs.js` | `deleteRelation()` | « Supprimer cette relation ? » |
| `js/enquetes.js` | Suppression d'indice | Nommer l'indice |
| `js/doodle.js` | Suppression du sondage | Mentionner que toutes les réponses seront perdues |
| `js/doodle.js` | Clôture / réouverture | Non destructif mais irréversible côté joueurs — retenu |
| `js/doodle.js` | Suppression de la réponse d'un joueur | **Deux emplacements** : tableau horizontal et modale de votes |

Exemple pour la réinitialisation de fiche :

```js
const ok = await confirmAction({
    titre: 'Réinitialiser la fiche',
    message: `Toutes les données de la fiche de ${charId} seront supprimées `
           + `définitivement : caractéristiques, compétences, talents, journal XP. `
           + `Cette action est irréversible.`,
    libelleAction: 'Supprimer définitivement',
    danger: true,
});
if (!ok) return;
```

Le bouton « ➕ Lancer un nouveau sondage » (`btnAdminForceNew`) utilise aussi un `confirm()` :
il n'est pas destructif en soi (il ouvre juste le formulaire de création), donc **le laisser en
`confirm()`** ou le supprimer purement — il ne fait qu'ouvrir un panneau.

### 4. Ne pas toucher au reste

Restent en dialogues natifs, par décision :

- Le `confirm()` « Tu t'apprêtes à modifier les disponibilités de X, est-ce bien toi ? » du
  vote : non destructif, déclenché fréquemment, et le passer en modale rallongerait un parcours
  déjà quotidien.
- Les 6 `alert()` d'erreur (`Connexion impossible`, `Erreur : …`, `Erreur de suppression : …`,
  etc.).

---

## Ne pas faire

- **Ne pas ajouter de système de notifications (toasts).** Envisagé et écarté du périmètre.
- **Ne pas réimplémenter le voile et le piège de focus à la main.** `<dialog>` + `showModal()`
  les fournit.
- **Ne pas rendre `confirmAction` synchrone.** Une confirmation asynchrone est la seule option
  possible hors dialogues natifs ; les appelants doivent devenir `async`.
- **Ne pas oublier le second emplacement de suppression de réponse** dans `js/doodle.js` : le
  code est dupliqué entre `renderPoll()` (tableau horizontal) et
  `openVotesModal()` → `renderVoters()` (modale). Les deux doivent passer en modale.
- **Ne pas créer plusieurs éléments `<dialog>`.** Un seul, réutilisé, sinon ils s'accumulent
  dans le DOM.

---

## Vérification

- [ ] Les **7** parcours de confirmation fonctionnent, dans les deux thèmes :
      réinitialisation de fiche, suppression de PNJ, suppression de relation, suppression
      d'indice, suppression de sondage, clôture / réouverture de sondage, suppression de réponse
      (tableau **et** modale).
- [ ] Chaque parcours annulé laisse les données **intactes** — le vérifier réellement, pas
      seulement à l'écran.
- [ ] La modale se ferme par : bouton Annuler, `Échap`, clic sur le voile. Les trois renvoient
      `false`.
- [ ] Le focus arrive sur **Annuler** à l'ouverture, et revient sur le bouton d'origine à la
      fermeture.
- [ ] Ouvrir puis fermer la modale dix fois de suite : elle fonctionne toujours, et un seul
      élément `<dialog>` existe dans le DOM (les écouteurs ne s'empilent pas — c'est le défaut
      le plus probable de cette implémentation).
- [ ] Un nom de PNJ ou de joueur contenant `<b>` ou une apostrophe s'affiche littéralement dans
      le message.
- [ ] Sur 375 px de large : la modale tient à l'écran, les deux boutons sont atteignables.
- [ ] Suppression de PNJ : les relations associées sont bien supprimées aussi (le comportement
      métier ne doit pas changer).
- [ ] La modale de suppression de réponse depuis la modale de votes : les **deux** se ferment
      correctement, sans se superposer ni se bloquer mutuellement.
- [ ] Le `confirm()` du vote (« est-ce bien toi ? ») est **toujours** un dialogue natif.

---

## Message de commit

```
feat(ui): modale de confirmation pour les actions destructives (N4)

Les confirmations d'actions irreversibles passaient par confirm(),
bloquant, hors theme, et parfois supprime par Safari iOS apres
plusieurs dialogues d'affilee.

- js/ui-confirm.js : confirmAction() sur <dialog>, focus par defaut sur
  Annuler, fermeture par Echap et par le voile
- 7 confirmations remplacees (fiche, PNJ, relation, indice, sondage,
  cloture, reponse de joueur x2)
- la double confirmation de reinitialisation de fiche devient une seule
  modale nommant le personnage
- les 6 alert() d'erreur et le confirm() de modification de vote restent
  en dialogues natifs, par decision
```

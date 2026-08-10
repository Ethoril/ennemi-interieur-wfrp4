# L1-01 — Échapper les rendus du Calendrier

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md)**, en particulier la section 3.

|  |  |
|---|---|
| **Lot** | 1 — sécurité (v2.13.2) |
| **Constat d'audit** | B1 — critique |
| **Estimation** | 1 h 30 |
| **Fichiers** | `js/doodle.js` |
| **Dépend de** | — |

---

## Pourquoi

`js/doodle.js` n'importe pas `esc()` et interpole des données d'utilisateur directement dans
`innerHTML`. Or le vote au Calendrier est **anonyme par conception** : n'importe quel visiteur
de la page peut soumettre un pseudo, et ce pseudo est écrit dans Firestore puis réaffiché chez
tous les autres visiteurs.

Conséquence actuelle : un pseudo contenant `<img src=x onerror=…>` fait exécuter du script
chez tout le monde, y compris chez le MJ — la seule session privilégiée du projet, qui a un
accès en écriture aux fiches, aux PNJs et aux indices. La CSP de la page contient
`script-src 'unsafe-inline'`, donc elle n'arrête rien.

C'est le constat le plus grave de l'audit. Ce brief est le premier à traiter.

---

## À faire

### 1. Importer `esc`

En tête de `js/doodle.js`, après les imports Firebase existants :

```js
import { esc } from './utils.js';
```

### 2. Échapper les interpolations, fonction par fonction

Une douzaine de sites, dans cinq fonctions. Les numéros de ligne sont ceux de la v2.13.1 et
bougeront au fil des modifications — se repérer aux noms de fonction.

**`updateAuthBar(user)`** — ~l. 244
`${user.displayName || user.email}` est injecté dans `doodleAuthBar.innerHTML`.
`displayName` vient de Google mais reste une donnée externe : l'échapper.

**`renderHorizontalPoll()`** — ~l. 449 à 482
- `${date}` dans les `<th>` du `<thead>` (les libellés de dates sont saisis par le MJ).
- `${name}` dans les trois branches de `nameHtml` (admin / non-admin / sondage clôturé),
  à chaque fois dans un `<span>`.
- Les attributs `data-player="${name.replace(/"/g, '&quot;')}"` — **remplacer ce
  `replace()` par `esc(name)`**. Neutraliser le guillemet sans neutraliser `<` ne protège
  rien : le navigateur reprend l'analyse au premier `<` et l'attribut est refermé.
- Les attributs `title="Modifier la réponse de ${name}"` et
  `title="Supprimer la réponse de ${name}"`.

**`renderVerticalPoll()`** — ~l. 581
`${date}` dans le `<span>` de titre de chaque carte.

**`openVotesModal()` → `renderVoters()`** — ~l. 752 à 771
- `${name}` dans le `<span>` du nom du votant.
- `${initials}` dans `.doodle-voter-avatar` (dérivé de `name.charAt(0)`, donc un caractère
  qui peut être `<`).
- Les quatre attributs `data-player` des boutons `.modal-btn-edit` et `.modal-btn-delete`,
  même remarque que ci-dessus sur le `replace()`.

Noter au passage que `modalDateDetails.textContent = dateText` (~l. 723) est **déjà correct** :
c'est le pattern à privilégier quand on n'insère que du texte.

**`submitVote()`** — ~l. 685
`${nameToSave}` est injecté dans le corps HTML du courriel envoyé au MJ via la collection
`mail`. C'est une injection HTML dans la boîte de réception : l'échapper aussi.

### 3. Borner le pseudo avant écriture

Dans `submitVote()`, après la récupération de `voterName` et avant l'écriture Firestore,
ajouter une validation. Les règles Firestore ne peuvent pas le faire — le pseudo est une *clé*
de map et le langage de règles ne sait pas extraire une clé pour la tester (voir `L1-04`).
C'est donc la seule borne possible, et elle vient **en plus** de l'échappement, pas à sa place.

```js
// Le pseudo est une clé de la map `responses` : les règles Firestore ne peuvent pas
// en valider le contenu (pas de boucle dans le langage de règles). Borne côté client.
const MAX_PSEUDO = 40;
if (voterName.length > MAX_PSEUDO || /[\x00-\x1f\x7f]/.test(voterName)) {
    if (voteError) {
        voteError.textContent = `Pseudo trop long ou caractères non autorisés (${MAX_PSEUDO} caractères maximum).`;
        voteError.style.display = 'inline';
    }
    if (voterNameInput) voterNameInput.focus();
    return;
}
```

Placer ce bloc juste après le contrôle du pseudo réservé au MJ (`voterName.toLowerCase() === 'david'`),
pour rester cohérent avec les messages d'erreur existants.

---

## Ne pas faire

- **Ne pas réécrire les rendus en `createElement`/`textContent`.** Cette option a été
  évaluée et écartée : elle réécrit ~300 lignes pour un gain de sécurité identique une fois
  l'échappement en place. La structure actuelle est conservée.
- **Ne pas toucher au CSS ni aux attributs `style=`.** Les 56 styles en ligne de ce fichier
  sont traités par le brief `L2-04`. Ce brief ne doit rien changer à l'apparence.
- **Ne pas modifier la logique de vote**, ni le tri des joueurs, ni le calcul des totaux.

---

## Vérification

- [ ] Voter avec le pseudo `<img src=x onerror=alert(1)>` : le texte s'affiche **littéralement**
      dans le tableau horizontal, dans la modale de votes, et dans le courriel reçu. Aucune
      alerte ne se déclenche, aucune image cassée n'apparaît.
- [ ] Voter avec le pseudo `"><script>alert(1)</script>` : idem.
- [ ] Créer un sondage dont une date contient `<b>samedi</b>` : les balises restent visibles
      en texte dans les deux formats d'affichage.
- [ ] Voter avec un pseudo contenant une apostrophe (`Jean-Loup d'Altdorf`) : le vote
      s'enregistre, le bouton crayon le repropose correctement, et le bouton poubelle du MJ
      le supprime bien. **C'est le cas de non-régression le plus probable** — `esc()` transforme
      l'apostrophe en `&#39;`, il faut vérifier que les comparaisons de noms côté JS
      utilisent bien la valeur brute et non la valeur échappée.
- [ ] Un pseudo de 41 caractères est refusé avec un message clair, sans écriture Firestore.
- [ ] Les deux formats (horizontal et vertical) fonctionnent, connecté en MJ et déconnecté.
- [ ] Sondage clôturé : l'affichage reste correct et les boutons de suppression du MJ marchent.
- [ ] Console du navigateur vide.

---

## Message de commit

```
fix(doodle): echapper les rendus du sondage et borner le pseudo (B1)

Le vote etant anonyme, un pseudo ou un libelle de date pouvait injecter
du HTML execute chez tous les visiteurs, dont la session du MJ.

- import de esc() depuis utils.js
- echappement des 12 interpolations de updateAuthBar, renderHorizontalPoll,
  renderVerticalPoll, openVotesModal et du corps du courriel
- remplacement des replace(/"/g) par esc() sur les attributs data-player
- borne de longueur et refus des caracteres de controle sur le pseudo
```

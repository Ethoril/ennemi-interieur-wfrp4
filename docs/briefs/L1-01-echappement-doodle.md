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
- `${name}` dans les **trois** branches de `nameHtml` — trois `<span>` distincts, aux
  environs des lignes 463, 473 et 481 :
  1. sondage ouvert, connecté en MJ (crayon + poubelle) ;
  2. sondage ouvert, visiteur (crayon seul) ;
  3. **sondage clôturé, connecté en MJ** (poubelle seule) — c'est la branche la plus facile à
     oublier, parce qu'il faut clôturer un sondage pour la voir.
- Les attributs `data-player="${name.replace(/"/g, '&quot;')}"` — **remplacer ce
  `replace()` par `esc(name)`**. Neutraliser le guillemet sans neutraliser `<` ne protège
  rien : le navigateur reprend l'analyse au premier `<` et l'attribut est refermé.
- Les attributs `title="Modifier la réponse de ${name}"` et
  `title="Supprimer la réponse de ${name}"` (trois occurrences ; le
  `title="Modifier ma réponse"` de la branche visiteur ne contient pas de nom).

**Ne pas échapper `${nameHtml}`** à la ligne ~489 : c'est le fragment de balisage assemblé
juste au-dessus, pas une donnée. Cf. section 3 des conventions.

**Compte de contrôle** — après modification, ces trois commandes doivent renvoyer `0` :

```bash
grep -c '\${name}'                  js/doodle.js   # 7 sites avant, 0 après
grep -c '\${date}'                  js/doodle.js   # 2 sites avant, 0 après
grep -c "replace(/\"/g, '&quot;')"  js/doodle.js   # 8 sites avant, 0 après
```

Les `${esc(name)}` ne sont pas comptés par ces motifs : un compte non nul signale un site
oublié.

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

## Données en production — un sondage est en cours

**Au 11 août 2026, `doodle/current` contient un sondage ouvert : 15 dates et 4 réponses de
joueurs.** Ces réponses ne doivent être écrasées sous aucun prétexte. Une sauvegarde du
document existe hors dépôt (`../doodle-current-BACKUP-2026-08-11.json`), mais elle est un
filet, pas une autorisation.

### Les deux chemins de destruction

**1. Perdre `{ merge: true }`.** L'écriture de `submitVote()` est :

```js
await setDoc(docRef, { responses: { [nameToSave]: votes } }, { merge: true });
```

Sans `{ merge: true }`, ce `setDoc` **remplace le document entier** : les 15 dates, le drapeau
`closed` et les réponses des trois autres joueurs disparaissent. Cette option n'est pas un
détail de style, c'est ce qui rend l'écriture non destructrice. Même remarque pour les écritures
de `btnSaveDates`, `btnAdminClose` et de la suppression d'une réponse.

Seul `btnCreatePoll` écrit **sans** `merge`, et c'est volontaire : il crée un nouveau sondage.
Ne pas y toucher, et ne pas cliquer sur « Lancer le sondage » pendant les essais.

**2. Échapper `nameToSave` avant l'écriture.** La variable est utilisée à trois endroits, et un
seul demande un échappement :

| Usage | Traitement |
|---|---|
| clé de la map `responses` dans `setDoc` | **valeur brute** — l'échapper créerait un votant en double (`Jean-Loup d&#39;Altdorf`) et orphelinerait la réponse d'origine |
| `subject` du courriel | **valeur brute** — c'est un champ texte, pas du HTML |
| `html` du courriel | **`esc(nameToSave)`** — seul site à échapper |

Règle générale : **`esc()` s'applique au rendu, jamais avant une écriture.** Firestore et
`state` contiennent toujours la valeur brute.

### Essais sans toucher au sondage réel

Les charges utiles de la checklist (`<img src=x onerror=alert(1)>`, pseudo de 41 caractères)
créeraient de vrais votants parasites dans le sondage en cours, que le MJ devrait ensuite
supprimer un par un.

Pendant les essais uniquement, faire pointer le module sur un document de test :

```js
// js/doodle.js, ~l. 43 — TEMPORAIRE, à remettre sur 'current' avant de committer
const docRef = doc(db, 'doodle', 'test');
```

Créer le sondage de test depuis l'interface MJ, dérouler la checklist dessus, puis **rétablir
`'current'`**. Contrôle obligatoire avant le commit :

```bash
grep -n "doc(db, 'doodle'" js/doodle.js    # doit afficher 'current', jamais 'test'
```

Un commit qui laisse `'test'` casse le calendrier pour tous les joueurs sans erreur visible.

## Ne pas faire

- **Ne pas réécrire les rendus en `createElement`/`textContent`.** Cette option a été
  évaluée et écartée : elle réécrit ~300 lignes pour un gain de sécurité identique une fois
  l'échappement en place. La structure actuelle est conservée.
- **Ne pas toucher au CSS ni aux attributs `style=`.** Les 56 styles en ligne de ce fichier
  sont traités par le brief `L2-04`. Ce brief ne doit rien changer à l'apparence.
- **Ne pas modifier la logique de vote**, ni le tri des joueurs, ni le calcul des totaux.
- **Ne toucher à aucun chemin d'écriture Firestore.** Ce brief ajoute des appels à `esc()` dans
  les fonctions de rendu et une validation en amont d'une écriture. Les appels `setDoc`,
  `deleteDoc` et `addDoc` eux-mêmes, leurs arguments et leurs options restent identiques au
  caractère près — à la seule exception de `esc()` appliqué au champ `html` du courriel.
- **Ne pas restructurer `submitVote()`.** La validation du pseudo s'insère telle quelle, après
  le contrôle du nom réservé au MJ et avant tout le reste. Ne pas déplacer les lignes
  existantes, ne pas factoriser, ne pas extraire de fonction : c'est la fonction qui écrit dans
  le sondage en cours.

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
- [ ] Les deux formats (horizontal et vertical) fonctionnent, **connecté en MJ puis
      déconnecté** — c'est l'état de connexion qui sélectionne la branche de `nameHtml`, donc
      les deux doivent être vus.
- [ ] **Sondage clôturé, connecté en MJ** : le nom des joueurs s'affiche correctement et le
      bouton poubelle fonctionne. C'est la troisième branche de `nameHtml`, invisible sans
      clôturer un sondage — la vérifier explicitement, pas par déduction.
- [ ] Le nom du joueur s'affiche bien à l'écran dans les trois branches : aucun `<span>` ni
      `<button>` visible en clair, ce qui signalerait un fragment de balisage échappé par
      erreur.
- [ ] Console du navigateur vide.

### Intégrité du sondage en cours — à vérifier en dernier, avant le commit

- [ ] `grep -n "doc(db, 'doodle'" js/doodle.js` affiche `'current'` et non `'test'`.
- [ ] `grep -c "merge: true" js/doodle.js` renvoie la même valeur qu'avant modification.
- [ ] `nameToSave` n'est **pas** échappé dans l'appel `setDoc` ni dans le `subject` du courriel.
- [ ] Sur la page réelle : les **15 dates** sont là, les **4 votants** (Marie, David, rodo,
      Morgane) sont là avec leurs disponibilités inchangées, le sondage est toujours ouvert.
- [ ] Aucun votant parasite issu des essais (`<img…>`, pseudo de 41 caractères) ne subsiste
      dans le sondage réel. S'il y en a, les supprimer via le bouton poubelle du MJ.
- [ ] En cas de doute sur l'état du document, le comparer à
      `../doodle-current-BACKUP-2026-08-11.json`.

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

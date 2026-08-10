# L2-09 — Libellés de formulaire et annonces

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | N3 (première moitié) |
| **Estimation** | 1 h |
| **Fichiers** | `fiche.html`, `pnjs.html`, `enquetes.html`, `js/fiche.js`, `js/doodle.js`, `js/fiche-cloud.js` |
| **Dépend de** | — |

---

## Pourquoi

**27 `<label>` dans le projet, aucun avec `for`, aucun englobant son champ.** Tous les champs de
la fiche, du formulaire de PNJ et du formulaire d'indice sont donc annoncés sans libellé par un
lecteur d'écran : « champ de saisie, vide » et rien de plus, quinze fois de suite sur la fiche.

Par ailleurs l'indicateur d'état de sauvegarde (« ☁ Sauvegardé », « ⚠ Erreur ») et les messages
d'erreur de vote du Calendrier sont purement visuels : ils changent sans qu'aucune technologie
d'assistance ne le signale.

Répartition :

| Fichier | `<label>` |
|---|---|
| `fiche.html` | 15 |
| `pnjs.html` | 7 |
| `enquetes.html` | 5 |

---

## À faire

### 1. Associer les libellés

Purement mécanique : tous les champs concernés ont déjà un `id`.

```html
<!-- avant -->
<div class="fiche-field">
    <label>Nom</label>
    <input type="text" id="nom" placeholder="Nom du personnage">
</div>

<!-- après -->
<div class="fiche-field">
    <label for="nom">Nom</label>
    <input type="text" id="nom" placeholder="Nom du personnage">
</div>
```

Passer les trois fichiers. Dans `fiche.html`, ne pas oublier les libellés du bloc
« Stats Dérivées » et ceux du bloc XP — pour ces derniers, `<label>XP Total …</label>` pointe
vers un `<span>` et non vers un champ de saisie : un `<span>` ne peut pas être la cible d'un
`for`. Remplacer ces trois `<label>` par des `<span class="derived-label">` (ou la classe
appropriée) et adapter le sélecteur CSS correspondant. Un `<label>` qui n'étiquette rien est une
erreur de balisage.

Même vérification dans les blocs `.derived-stat` : ceux qui encadrent un `<span>`
(`Mouvement`, `Blessures max`) sont dans le même cas.

### 2. Libeller les champs générés en JavaScript

Plusieurs champs créés par `js/fiche.js` n'ont aucun libellé visible et ne peuvent pas en avoir
un — ils sont dans des cellules de tableau. Leur donner un `aria-label` explicite :

- `buildBasicSkills()` : le champ `.sk-adv` de chaque ligne →
  `aria-label="Avances en ${sk.nom}"` (échapper la valeur, cf. `L1-02`).
- `renderAdvancedSkills()` : le champ de nom, le sélecteur de caractéristique et le champ
  d'avances → `aria-label` décrivant la colonne et l'index de ligne.
- Les boutons `.btn-rm` (`×`) : ils ont un `title` mais pas de nom accessible fiable →
  ajouter `aria-label="Supprimer"`, précisé si possible (`Supprimer le sort Boule de feu`).
- `renderXpLog()` : les champs de raison, montant, achat, coût et note.

Ne pas chercher l'exhaustivité au caractère près : viser les champs où l'utilisateur saisit une
donnée, pas les cellules de simple affichage.

### 3. Annoncer les changements d'état

**Statut de sauvegarde de la fiche.** L'élément `#fiche-cloud-status` est recréé à chaque
changement d'état d'authentification, dans le `bar.innerHTML` de `js/fiche-cloud.js`. Ajouter
les attributs au moment de sa création :

```html
<span class="fiche-cloud-status" id="fiche-cloud-status"
      role="status" aria-live="polite"></span>
```

`aria-live="polite"` annonce sans interrompre et sans voler le focus — c'est ce qu'on veut pour
un indicateur de sauvegarde.

**Erreurs de vote du Calendrier.** Dans `js/doodle.js`, les deux éléments `#vote-error` et
`#vote-error-vertical` :

```html
<span id="vote-error" class="doodle-vote-error" role="alert"></span>
```

`role="alert"` implique `aria-live="assertive"` : approprié pour une erreur qui bloque l'action
en cours.

Attention : un élément `aria-live` doit **exister dans le DOM avant** que son contenu change.
Les deux éléments sont bien créés avec le formulaire, donc c'est le cas — mais si un rendu les
recrée en même temps que le message, l'annonce ne se déclenchera pas. Vérifier le point 3 de la
checklist.

### 4. Formulaires de PNJ et d'indice

`pnjs.html` et `enquetes.html` ont des `<input type="file">` avec un libellé, et
`enquetes.html` a une grille de cases à cocher générée par
`populatePnjsCheckboxGrid()` dans `js/enquetes.js`. Cette grille utilise déjà un `<label>`
englobant sa case à cocher, ce qui est **correct** — ne pas y toucher.

---

## Ne pas faire

- **Ne pas ajouter `aria-label` à un champ qui a déjà un `<label for>`.** Le premier écrase le
  second dans le calcul du nom accessible, et l'on se retrouve avec deux sources de vérité.
- **Ne pas utiliser `aria-live` sur un conteneur dont tout le contenu est réécrit** (le
  `bar.innerHTML` entier, par exemple) : le lecteur d'écran relirait l'ensemble à chaque
  changement. Le poser sur l'élément de statut lui-même.
- **Ne pas remplacer les `title` existants.** Ils servent l'infobulle à la souris ; `aria-label`
  s'ajoute, il ne remplace pas.
- **Ne pas toucher au CSS**, sauf les sélecteurs devenus faux par le remplacement de `<label>`
  par `<span>` au point 1.

---

## Vérification

Un lecteur d'écran est nécessaire pour la partie annonces : NVDA sous Windows (gratuit) ou
Narrateur (Windows + Ctrl + Entrée).

- [ ] `grep -c '<label' fiche.html pnjs.html enquetes.html` et
      `grep -c '<label[^>]*for=' fiche.html pnjs.html enquetes.html` donnent le même total pour
      les libellés conservés.
- [ ] Parcourir la fiche entièrement au clavier (Tab) : **chaque** champ est annoncé avec son
      libellé, y compris les avances de compétences et les lignes du journal XP.
- [ ] Cliquer sur le texte d'un libellé place le focus dans son champ — c'est le test le plus
      rapide, et il ne demande pas de lecteur d'écran.
- [ ] Sauvegarder une modification avec un lecteur d'écran actif : « Sauvegardé » est annoncé,
      **sans** que le focus quitte le champ en cours d'édition.
- [ ] Tenter un vote sans pseudo au Calendrier : le message d'erreur est annoncé.
- [ ] Aucun `<label>` ne pointe vers un `id` inexistant (l'inspecteur d'accessibilité du
      navigateur le signale).
- [ ] L'apparence est **strictement inchangée** dans les deux thèmes, y compris aux endroits où
      un `<label>` est devenu un `<span>`.
- [ ] L'onglet Accessibilité des outils de développement ne signale plus de champ sans nom
      accessible sur `fiche.html`, `pnjs.html` et `enquetes.html`.

---

## Message de commit

```
a11y: associer les libelles de formulaire et annoncer les changements
d'etat (N3)

Les 27 <label> du projet n'avaient ni attribut for ni champ englobe :
tous les champs de la fiche, du formulaire de PNJ et du formulaire
d'indice etaient annonces sans libelle.

- attribut for sur les libelles des trois pages
- <label> sans cible remplaces par des <span> (blocs XP et stats derivees)
- aria-label sur les champs generes en JavaScript (avances, journal XP,
  boutons de suppression)
- role=status et aria-live sur l'indicateur de sauvegarde cloud
- role=alert sur les messages d'erreur de vote
```

# L2-03 — Feuille d'impression de la fiche

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | I3 |
| **Estimation** | 1 h |
| **Fichiers** | `css/fiche-print.css` (nouveau), `fiche.html` |
| **Dépend de** | — |

---

## Pourquoi

Il n'y a **aucune** règle `@media print` dans les 5 146 lignes de CSS du projet. Imprimer une
fiche aujourd'hui produit la page complète avec sa navigation, ses boutons de suppression, son
fond sombre et ses champs de saisie encadrés.

Or une fiche sur papier reste le format le plus fiable à la table de jeu, et c'est aussi la
sauvegarde de dernier recours quand tout le reste a échoué.

---

## À faire

### 1. Créer `css/fiche-print.css` et le lier

```html
<!-- fiche.html, dans le <head>, après css/fiche.css -->
<link rel="stylesheet" href="css/fiche-print.css" media="print">
```

L'attribut `media="print"` évite tout risque d'interférence avec l'affichage écran, et le
navigateur ne le charge qu'à l'impression.

Ne **pas** utiliser `@media print` à l'intérieur de `css/fiche.css` : un fichier séparé reste
lisible et se désactive d'un seul trait en cas de problème.

### 2. Contenu attendu

Compter 70 à 90 lignes. Les points à traiter :

**Masquer ce qui n'a pas de sens sur papier**

```css
@page { margin: 12mm; }

nav.navbar,
footer.footer,
.ornament,
#fiche-login-wall,
#fiche-auth-bar,
#hero3d-canvas,
.btn-add,
.btn-rm,
.btn-toggle-opt,
.btn-close-section,
.optional-toggles,
.fiche-backup-row,
#xp-gain-form,
#xp-add-form,
#tbody-career-adv-ghost,
.career-rang-edit-btn,
.career-tag-action,
.career-add-row,
.talent-rm { display: none !important; }
```

Les lignes fantômes de carrière (`#tbody-career-adv-ghost`) sont des suggestions d'achat, pas
des données du personnage : elles ne s'impriment pas. Idem pour les deux formulaires XP et tous
les contrôles d'édition.

**Forcer un rendu clair**

Le site est sombre par défaut : sur papier, cela consomme de l'encre et donne un résultat
illisible. Forcer fond blanc et texte noir, y compris quand le thème parchemin est actif.

```css
html, body {
    background: #fff !important;
    color: #000 !important;
}
```

Neutraliser aussi les ombres (`box-shadow: none`) et les fonds de cartes.

**Rendre les champs de saisie lisibles**

Les valeurs sont dans des `<input>` et des `<select>`. Retirer bordures et fonds pour qu'ils
se lisent comme du texte, en conservant la valeur visible :

```css
input, select, textarea {
    border: 0 !important;
    background: transparent !important;
    color: #000 !important;
    -webkit-appearance: none;
    appearance: none;
}
input[type="number"] { width: auto !important; }
textarea { height: auto !important; min-height: 0; resize: none; }
```

Attention au `<textarea>` des possessions : sans hauteur automatique, seule la première ligne
s'imprime. Le tester avec un texte long.

**Déplier les sections optionnelles visibles**

Les sections Sorts et Prières sont masquées par `style="display:none"` en ligne quand elles
sont désactivées. Ne **pas** les forcer visibles à l'impression : si le joueur ne les utilise
pas, elles ne doivent pas apparaître. En revanche, quand elles sont visibles, vérifier qu'elles
s'impriment correctement.

**Éviter les coupures**

```css
.fiche-section,
table { break-inside: avoid; }
thead { display: table-header-group; }
h2 { break-after: avoid; }
```

`display: table-header-group` fait répéter les en-têtes de colonnes si un tableau déborde sur
la page suivante.

**Titre de page**

Le nom du personnage est dans `#fiche-page-title`, mis à jour dynamiquement. Le laisser visible
et lui donner une taille raisonnable pour du papier.

### 3. Ajouter un bouton d'impression

Dans le bloc `.fiche-backup-row` créé par le brief `L2-02`, ou seul si `L2-02` n'est pas encore
traité :

```html
<button class="btn-add" id="btn-print-fiche" type="button">🖨 Imprimer</button>
```

```js
document.getElementById('btn-print-fiche')?.addEventListener('click', () => window.print());
```

---

## Ne pas faire

- **Ne pas créer une page d'impression séparée** (`fiche-print.html`). Une feuille CSS suffit et
  évite de dupliquer le rendu.
- **Ne pas utiliser `visibility: hidden`** pour masquer : l'élément garderait sa place et
  laisserait des trous. `display: none` est le bon outil ici.
- **Ne pas retirer `media="print"`** du lien pour « tester plus facilement ». Les outils de
  développement permettent d'émuler le média d'impression (Rendering → Emulate CSS media type).
- **Ne pas viser une mise en page à la maquette de la fiche officielle.** L'objectif est une
  sortie lisible et complète, pas une reproduction du document de Games Workshop.

---

## Vérification

Utiliser une fiche bien remplie (celle du scénario de test de `L2-02` convient).

- [ ] Aperçu avant impression : la fiche tient sur 2 à 3 pages A4.
- [ ] Aucune navigation, aucun pied de page, aucun bouton, aucune ligne fantôme.
- [ ] Fond blanc, texte noir, aucune zone sombre — y compris en partant du **thème parchemin**.
- [ ] Toutes les valeurs sont lisibles : caractéristiques (base, avances, total), compétences de
      base et avancées, talents, journal XP, stats dérivées.
- [ ] Le `<textarea>` des possessions s'imprime **en entier** avec un texte de 10 lignes.
- [ ] Aucun tableau coupé au milieu d'une ligne ; les en-têtes se répètent si un tableau passe
      d'une page à l'autre.
- [ ] Le nom du personnage apparaît en titre.
- [ ] Sections Sorts et Prières masquées à l'écran : elles n'apparaissent pas sur papier.
      Sections visibles : elles s'impriment correctement.
- [ ] Le panneau de référence de carrière s'imprime sans ses boutons de personnalisation.
- [ ] Impression en PDF depuis Chrome **et** depuis Firefox : rendu comparable.
- [ ] L'affichage écran est **strictement inchangé** dans les deux thèmes.

---

## Message de commit

```
feat(fiche): feuille d'impression de la fiche de personnage (I3)

Le projet n'avait aucune regle @media print : imprimer une fiche
sortait la navigation, les boutons et un fond sombre.

- css/fiche-print.css, liee en media="print"
- masquage des controles d'edition, formulaires XP et lignes fantomes
- rendu clair force, champs de saisie affiches comme du texte
- gestion des coupures de page et repetition des en-tetes de tableau
- bouton d'impression dans la fiche
```

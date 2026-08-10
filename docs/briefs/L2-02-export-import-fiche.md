# L2-02 — Export et import JSON de la fiche

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | I3 |
| **Estimation** | 1 h 30 |
| **Fichiers** | `js/fiche.js`, `fiche.html`, `css/fiche.css` |
| **Dépend de** | `L2-01` — les deux touchent au chemin de sauvegarde |

---

## Pourquoi

Une fiche de personnage représente des mois de jeu et n'existe qu'à deux endroits, tous deux
volatils : un document Firestore et un `localStorage`. Il n'y a **aucun** moyen d'en sortir une
copie.

Le bouton « 🗑️ Reset Fiche » du MJ appelle `deleteDoc` après deux `confirm()` et ne conserve
rien. Une fausse manœuvre, une règle Firestore mal écrite ou un bug de fusion, et le personnage
est perdu.

---

## À faire

### 1. Extraire `renderAll()` — le préalable

Le bloc de re-rendu complet est aujourd'hui **dupliqué** entre `ficheLoadCloud()` (~l. 1982) et
le gestionnaire de `DOMContentLoaded` (~l. 2115) :

```js
buildBasicSkills(); renderCareerDetail(); renderAdvancedSkills();
renderCareers(); renderTalents(); renderSorts(); renderPrieres();
renderXpLog(); applyOptVisible();
```

En faire une fonction, et l'appeler depuis les deux endroits existants plus le nouvel import.
C'est la seule modification de structure du brief, et elle doit être faite en premier : sans
elle, l'import dupliquerait le bloc une troisième fois.

```js
// Re-rendu complet de la fiche depuis `state`. Appelée après tout
// remplacement global de l'état : chargement cloud, chargement local, import.
function renderAll() {
    buildBasicSkills();
    renderCareerDetail();
    renderAdvancedSkills();
    renderCareers();
    renderTalents();
    renderSorts();
    renderPrieres();
    renderXpLog();
    applyOptVisible();
}
```

Vérifier après extraction que les deux parcours existants (chargement cloud et chargement local)
fonctionnent toujours, **avant** d'ajouter l'export et l'import.

### 2. Export

`exportData()` existe déjà et renvoie exactement l'objet voulu. L'envelopper :

```js
function exportToFile() {
    const payload = {
        _format:  'wfrp4-fiche',
        _version: 1,
        _app:     APP_VERSION_FICHE,   // voir remarque ci-dessous
        _charId:  _charParam || 'test',
        _exportedAt: new Date().toISOString(),
        ...exportData(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)],
                          { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const jour = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `fiche-${payload._charId}-${jour}.json`;
    a.click();
    URL.revokeObjectURL(url);
}
```

`APP_VERSION` est déclaré dans `js/layout.js`, qui n'exporte rien. **Ne pas** transformer
`layout.js` en module exportant sa constante pour si peu : lire la version depuis le DOM, où
elle est déjà présente, ou omettre le champ. La solution la plus simple :

```js
const APP_VERSION_FICHE = document.querySelector('.nav-version')?.textContent?.trim() || '';
```

Les champs `_format`, `_version` et `_charId` servent à valider un fichier à l'import et à
interpréter d'anciens exports plus tard.

### 3. Import

```js
async function importFromFile(file) {
    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch {
        alert("Fichier illisible : ce n'est pas un JSON valide.");
        return;
    }
    if (payload?._format !== 'wfrp4-fiche') {
        alert("Ce fichier n'est pas un export de fiche de personnage.");
        return;
    }
    if (!confirm("Remplacer la fiche actuelle par le contenu de ce fichier ? "
               + "L'état actuel sera perdu.")) return;

    resetState();
    applyData(payload);
    renderAll();
    recalc();          // recalc() appelle save(), qui propage vers le cloud
    updatePageTitle();
    updateCharacterPortrait();
}
```

Points d'attention :

- **L'ordre compte** : `resetState()` avant `applyData()`. `applyData()` utilise `push(...)` sur
  les tableaux de `state`, donc sans réinitialisation préalable les listes se cumuleraient.
- **`recalc()` doit être appelé après le rendu**, pas avant : il écrit dans des éléments
  du DOM que `renderAll()` vient de créer.
- **Le nouvel état doit partir vers le cloud.** `recalc()` appelle `save()` qui déclenche la
  chaîne habituelle. Vérifier que c'est bien le cas.
- Ne pas vérifier `_charId` : importer la fiche de Bhelgi dans l'onglet de Wren est une
  manipulation légitime du MJ (récupération après incident).

### 4. Interface

Dans `fiche.html`, dans la section `#fiche-content-section`, après le bloc « Possessions &
Notes » : un petit bloc de deux boutons, cohérent avec les `.btn-add` existants.

```html
<div class="fiche-backup-row">
    <button class="btn-add" id="btn-export-fiche" type="button">⬇ Exporter en JSON</button>
    <button class="btn-add" id="btn-import-fiche" type="button">⬆ Importer un JSON</button>
    <input type="file" id="file-import-fiche" accept=".json,application/json" hidden>
    <span class="fiche-backup-hint">Sauvegarde locale de la fiche, à conserver hors du navigateur.</span>
</div>
```

Câbler dans `bindAll()`, au milieu des autres boutons :

```js
document.getElementById('btn-export-fiche')?.addEventListener('click', exportToFile);
document.getElementById('btn-import-fiche')?.addEventListener('click',
    () => document.getElementById('file-import-fiche')?.click());
document.getElementById('file-import-fiche')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) importFromFile(f);
    e.target.value = '';   // permet de réimporter le même fichier
});
```

Styler `.fiche-backup-row` et `.fiche-backup-hint` dans `css/fiche.css`, avec les jetons
existants. Prévoir le passage à la ligne sur mobile.

---

## Ne pas faire

- **Ne pas ajouter de librairie** pour le téléchargement (`FileSaver.js` ou équivalent).
  `Blob` + `URL.createObjectURL` suffisent.
- **Ne pas exporter le contenu brut de `localStorage`.** `exportData()` est la représentation
  canonique de l'état ; `localStorage` contient en plus le champ interne `_savedAt`.
- **Ne pas remplacer les deux `confirm()` par une modale** ici. C'est l'objet du brief `L2-11`,
  et l'import n'en fait pas partie (il n'est pas destructif au sens où on garde le fichier).
- **Ne pas versionner d'exports dans Firestore.** L'historique automatique a été évalué et
  écarté du périmètre.

---

## Vérification

Utiliser `fiche.html?char=test`.

- [ ] Remplir une fiche substantielle : caractéristiques, 3 compétences avancées dont une
      spécialisée, 2 anciennes carrières, 4 talents, 2 sorts, 1 prière, 5 entrées de journal XP
      dont 2 gains et 2 achats appliqués, une variante de rang choisie, un rang personnalisé
      (compétence retirée et talent ajouté), les deux sections optionnelles visibles.
- [ ] Exporter : le fichier se télécharge, son nom est `fiche-test-AAAA-MM-JJ.json`, son
      contenu est indenté et lisible.
- [ ] Réinitialiser la fiche (bouton MJ), puis réimporter : **tout** revient à l'identique.
      Comparer point par point la liste ci-dessus, y compris les overrides de carrière et les
      variantes choisies, qui sont les plus faciles à perdre.
- [ ] Après import, recharger la page : l'état est toujours là (donc l'import a bien été poussé
      vers Firestore, pas seulement affiché).
- [ ] Importer un fichier `.json` quelconque (un `package.json` par exemple) : message
      d'erreur clair, fiche intacte.
- [ ] Importer un fichier tronqué à la main : message d'erreur clair, fiche intacte.
- [ ] Annuler la confirmation d'import : la fiche est intacte.
- [ ] Importer deux fois le même fichier d'affilée : le second import fonctionne (c'est ce que
      la remise à zéro de `e.target.value` garantit).
- [ ] Les deux parcours préexistants fonctionnent toujours après l'extraction de `renderAll()` :
      chargement d'une fiche depuis le cloud à la connexion, et chargement depuis
      `localStorage` en cas d'échec du cloud.
- [ ] Affichage correct des deux boutons dans les deux thèmes et en 375 px de large.

---

## Message de commit

```
feat(fiche): export et import JSON de la fiche (I3)

Une fiche n'existait qu'en Firestore et en localStorage, sans aucun
moyen d'en sortir une copie, alors que le bouton de reinitialisation
du MJ la supprime sans filet.

- extraction de renderAll(), qui etait duplique entre ficheLoadCloud
  et DOMContentLoaded
- export dans un fichier JSON date et identifie (_format, _version)
- import avec validation du format et confirmation, puis propagation
  du nouvel etat vers le cloud
```

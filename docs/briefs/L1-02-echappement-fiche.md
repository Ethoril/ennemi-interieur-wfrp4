# L1-02 — Échapper les rendus de la fiche de personnage

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md)**, en particulier la section 3.

|  |  |
|---|---|
| **Lot** | 1 — sécurité (v2.13.2) |
| **Constat d'audit** | I1 |
| **Estimation** | 1 h 30 |
| **Fichiers** | `js/fiche.js`, `js/fiche-cloud.js` |
| **Dépend de** | — |

---

## Pourquoi

`js/fiche.js` **importe déjà `esc`** en tête de fichier mais ne l'applique pas à ses rendus de
tableaux. Une vingtaine de sites d'interpolation, répartis sur neuf fonctions.

Ce n'est pas seulement une auto-injection : la fiche est stockée dans Firestore et le MJ ouvre
les fiches des joueurs. Un compte joueur devient donc un vecteur vers la session
administrateur, qui a un accès en écriture à toutes les collections.

Le cas le plus directement exploitable est en **contexte texte** — pas besoin de sortir d'un
attribut, le balisage s'exécute tel quel :

```js
// renderXpLog(), ~l. 1699
`<td>${e.achat} <span class="xp-applied-badge">✓</span></td>`
//     ^^^^^^^^^ libellé d'achat XP saisi par le joueur
```

Les autres sont en contexte d'attribut `value="…"` ou `title="…"`, où un guillemet double
suffit à sortir.

---

## À faire

### 1. `js/fiche.js` — sites à échapper

`esc` est déjà importé (l. 1). Il n'y a qu'à l'appliquer. Se repérer aux noms de fonction,
les numéros de ligne bougeront.

| Fonction | Interpolations à échapper |
|---|---|
| `renderXpLog()` | `${e.achat}` en contexte texte (**le cas critique**), `${e.type}`, et les `value="${e.raison}"`, `value="${e.achat}"`, `value="${e.note}"` des trois variantes de ligne |
| `renderAdvancedSkills()` | `value="${sk.nom}"` |
| `renderCareers()` | `value="${c.nom}"`, `value="${c.note}"` |
| `renderSorts()` | `value="${s.nom}"`, `${s.portee}`, `${s.duree}`, `${s.resume}` |
| `renderPrieres()` | `value="${p.nom}"`, `value="${p.resume}"` |
| `renderTalents()` | `${t.nom}` en contexte texte, `title="${t.note}"` |
| `renderCareerChips()` | `data-talent="${item}"`, `data-name="${item}"`, et `${item}` en contexte texte — pour les chips officielles **et** les chips ajoutées (★) |
| `buildTalentsDatalistHtml()` | `<option value="${t}">` — la liste inclut les spécialisations personnalisées de `state.customTalents` |
| `buildXfSpecPicker()` | `<option value="${s}">${s}</option>` — `state.customSpecs` |
| `buildXfTalentSpecPicker()` | `<option value="${s}">${s}</option>` — `state.customTalents` |

Les trois derniers sont faciles à oublier : les spécialisations personnalisées sont saisies
librement par le joueur (« Autre (personnalisé)… ») puis réinjectées dans les listes de
suggestions à chaque ouverture du formulaire XP.

### 2. `js/fiche.js` — sites à échapper aussi, par uniformité

Ces valeurs viennent de `js/data/careers.json` ou de constantes du code, donc elles sont sûres
**aujourd'hui**. Les échapper quand même : cela évite d'avoir à se souvenir de l'exception le
jour où la base de carrières deviendra éditable, et le coût est nul.

- `renderCareerDetail()` : `${career.nom}`, `${currentVariant.titre}`, `${displayed.titre}`,
  le bandeau de prérequis (`${career.prereq.career}`, `${career.prereq.minRang}`), et les
  `<option value="${v.titre}">${v.titre}</option>` du sélecteur de variante.
- `buildCareerDatalist()` : `value="${c.nom}"`.
- `ensureSkillsDatalist()` : `value="${s.nom}"`.
- `renderCareerAdvGhosts()` : `data-ghost-nom="${nom}"` et `${nom}` en contexte texte.

### 3. `js/fiche-cloud.js` — barre d'authentification

Deux `bar.innerHTML` (~l. 92 et ~l. 108) injectent
`${user.displayName || user.email}`. Échapper les deux.

### 4. `js/fiche-cloud.js` — valider `charId`

Le paramètre `char` de l'URL est lu sans contrôle (~l. 8) puis utilisé comme identifiant de
document Firestore et comme clé `localStorage`.

**Ce n'est pas une injection HTML** : le message du mur de connexion passe par
`msgEl.textContent`, qui est sûr. Mais rien n'empêche `?char=nimportequoi` de créer une clé
`localStorage` arbitraire et de tenter une lecture Firestore inutile.

Ajouter une liste blanche juste après la lecture du paramètre :

```js
const CHAR_IDS = ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren', 'test'];
const charId = urlParams.get('char');

if (!charId || !CHAR_IDS.includes(charId)) {
    alert("Aucun personnage valide spécifié. Redirection vers le groupe…");
    window.location.href = 'groupe.html';
    throw new Error('charId invalide');   // stoppe l'évaluation du module
}
```

Le `throw` est nécessaire : aujourd'hui l'affectation de `window.location.href` ne stoppe pas
l'exécution du module, et tout le code qui suit tourne avec un `charId` invalide avant que le
navigateur ne change de page.

---

## Ne pas faire

- **Ne pas passer les rendus en `createElement`.** La structure par chaînes HTML avec
  délégation d'événements est le pattern du projet, elle est conservée.
- **Ne pas toucher au moteur XP**, aux caches de carrière (`_careerCache`), ni à la logique de
  sauvegarde. Ce brief n'ajoute que des appels à `esc()`.
- **Ne pas échapper les valeurs stockées dans `state`.** L'échappement se fait **au rendu**,
  jamais à la saisie : `state` et Firestore contiennent la valeur brute. Échapper à la saisie
  ferait apparaître des `&#39;` dans les champs et corromprait les données.

---

## Vérification

Utiliser `fiche.html?char=test` pour tous les essais destructifs.

- [ ] Saisir `"><img src=x onerror=alert(1)>` comme **libellé d'achat XP** (bouton
      « + Dépense XP », champ Achat) : le texte s'affiche littéralement, aucune alerte.
- [ ] Même charge utile comme **nom de sort**, **note de carrière**, **résumé de prière** et
      **nom de compétence avancée** : idem.
- [ ] Même charge utile comme **spécialisation personnalisée** (formulaire XP → Compétence
      avancée → un groupe à spécialisation → « Autre (personnalisé)… ») : la valeur doit
      réapparaître littéralement dans la liste de suggestions à la réouverture du formulaire.
- [ ] Même charge utile comme **talent ajouté à la main** sur un rang de carrière (bouton
      « ✎ Personnaliser » d'un rang, puis champ « + Ajouter un talent »).
- [ ] Recharger la page après chaque essai : la valeur revient de Firestore et reste inerte.
- [ ] **Non-régression apostrophe** : une compétence avancée nommée `Conduite d'attelage`
      reste éditable, se sauvegarde, et le surlignage « dans la carrière » fonctionne toujours.
      Vérifier aussi un nom de personnage avec apostrophe.
- [ ] Le panneau de référence de carrière s'affiche normalement pour une carrière à variantes
      (essayer `Artisan` rang 2) et pour une sous-carrière à prérequis
      (`Prêtre-Forgeron de Vaul`).
- [ ] Les lignes fantômes de compétences de carrière s'affichent et restent cliquables.
- [ ] `fiche.html` sans paramètre, puis avec `?char=inexistant` : redirection vers
      `groupe.html`, et **aucune** clé `wfrp4-fiche-inexistant` créée dans `localStorage`.
- [ ] Console vide.

---

## Message de commit

```
fix(fiche): echapper les rendus et valider le parametre char (I1)

esc() etait importe mais non applique aux rendus de tableaux. Un libelle
d'achat XP en contexte texte permettait une injection persistee dans
Firestore, executee a l'ouverture de la fiche par le MJ.

- echappement des ~25 interpolations de 9 fonctions de rendu
- echappement du displayName dans la barre d'authentification
- liste blanche sur le parametre char + arret de l'evaluation du module
```

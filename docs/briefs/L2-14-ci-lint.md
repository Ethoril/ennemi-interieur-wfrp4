# L2-14 — Contrôles de syntaxe et ESLint en CI

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | N7 |
| **Estimation** | 1 h 30 |
| **Fichiers** | `eslint.config.mjs` et `package.json` (nouveaux), `.github/workflows/validate.yml` |
| **Dépend de** | — (à traiter en dernier du lot : il faut lint un code déjà corrigé) |

---

## Pourquoi

La CI actuelle valide **uniquement les données** : elle analyse `careers.json` et `skills.json`
et croise les références de compétences. C'est bien, et à conserver.

Mais **rien ne relit les 6 731 lignes de JavaScript**. Une faute de syntaxe dans `js/fiche.js`
part en production sans obstacle, et le site n'a pas d'environnement de recette pour l'attraper.

Le projet s'appuie par ailleurs sur des variables globales (`L` pour Leaflet, `WFRP_CAREERS`,
`WFRP_SKILLS` posées sur `window`) : c'est un domaine où une faute de frappe passe totalement
inaperçue jusqu'à l'exécution.

---

## À faire

### 1. `package.json`

Le projet n'en a pas. Le créer, minimal, en marquant clairement qu'il ne sert qu'à l'outillage :

```json
{
  "name": "ennemi-interieur-wfrp4",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Outillage de developpement uniquement. Le site est statique et ne charge aucune dependance npm.",
  "scripts": {
    "lint": "eslint .",
    "check": "node tools/smoke-test.mjs",
    "dev": "node tools/dev-server.mjs"
  },
  "devDependencies": {
    "eslint": "^9.0.0"
  }
}
```

Ajouter `node_modules/` et `package-lock.json` au `.gitignore` — ou committer le lock, au choix,
mais **surtout pas** `node_modules/`.

Le champ `"type": "module"` est cohérent avec les `.mjs` de `tools/`. Vérifier après ajout que
`node tools/smoke-test.mjs` et `node tools/dev-server.mjs` fonctionnent toujours : le champ
change l'interprétation par défaut des `.js` du projet côté Node, ce qui pourrait affecter les
petits scripts en ligne du workflow (`node -e "…"` avec `require()`). Si c'est le cas, convertir
ces scripts en ESM ou renommer en `.cjs`.

### 2. `eslint.config.mjs`

Configuration plate (ESLint 9), volontairement réduite aux règles qui attrapent de vraies
erreurs sans générer de bruit sur du code existant.

```js
const navigateur = {
    window: 'readonly', document: 'readonly', navigator: 'readonly',
    localStorage: 'readonly', location: 'readonly', history: 'readonly',
    fetch: 'readonly', console: 'readonly', performance: 'readonly',
    alert: 'readonly', confirm: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly',
    requestAnimationFrame: 'readonly',
    URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
    FileReader: 'readonly', CustomEvent: 'readonly', Response: 'readonly',
    IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
    MutationObserver: 'readonly', CSS: 'readonly',
    HTMLScriptElement: 'readonly', WebGLRenderingContext: 'readonly',
    // Globales du projet, posées hors module
    L: 'readonly',                    // Leaflet, chargé en script classique
    WFRP_CAREERS: 'readonly',         // js/fiche.js, via window
    WFRP_SKILLS: 'readonly',
    WFRP_SKILL_GROUPS_WITH_SPECS: 'readonly',
};

const travailleur = {
    self: 'readonly', caches: 'readonly', clients: 'readonly',
    Request: 'readonly', Response: 'readonly', URL: 'readonly',
    fetch: 'readonly', console: 'readonly',
};

const regles = {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none' }],
    'no-unsafe-optional-chaining': 'error',
    'no-constant-condition': 'error',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-self-assign': 'error',
    'no-unreachable': 'error',
    'no-fallthrough': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
};

export default [
    { ignores: ['node_modules/**', 'tiles/**', 'docs/**'] },
    {
        files: ['js/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'module', globals: navigateur,
        },
        rules: regles,
    },
    {
        files: ['sw.js'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'script', globals: travailleur,
        },
        rules: { ...regles, 'no-unused-vars': 'warn' },
    },
    {
        files: ['tools/**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022, sourceType: 'module',
            globals: { process: 'readonly', console: 'readonly', require: 'readonly' },
        },
        rules: regles,
    },
];
```

`no-undef` est la règle qui rend le plus ici. `no-unused-vars` aurait signalé l'import mort de
`fiche-cloud.js` et l'export jamais appelé de `fiche.js` — les deux points du constat N6. En
revanche, aucune règle standard ne détecte l'affectation redondante de `sheets.js` : celle-là ne
se voit qu'à la lecture.

### 3. Premier passage de mise au propre

Un ESLint sur du code existant sort toujours une dizaine d'avertissements. **Les traiter avant de
rendre l'étape bloquante** :

1. Lancer `npx eslint .` en local.
2. Corriger les `error` — chacune est un vrai problème.
3. Examiner les `warn` un par un : soit corriger, soit ajouter un
   `// eslint-disable-next-line` avec une justification en commentaire, soit assouplir la règle.
4. Ne **jamais** désactiver une règle globalement pour faire taire un cas particulier.

Si `no-undef` remonte une globale légitime absente de la liste, l'ajouter à `navigateur` avec un
commentaire, plutôt que désactiver la règle.

### 4. Étapes de workflow

Ajouter à `.github/workflows/validate.yml`, à côté des tâches existantes :

```yaml
  syntaxe:
    name: Syntaxe des modules
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: node --check sur tous les modules
        run: |
          set -e
          for f in js/*.js js/hero3d/*.js sw.js tools/*.mjs; do
            node --check "$f"
          done

  lint:
    name: ESLint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - run: npm run lint
```

`node --check` sur `sw.js` : il n'est pas un module ES, donc `--check` l'analyse comme un script
classique, ce qui est correct. Les fichiers de `js/` sont des modules — si `node --check` se
plaint des `import`, utiliser `node --input-type=module --check` ou renoncer à cette étape pour
`js/` puisque ESLint couvre déjà la syntaxe. Vérifier le comportement réel avant de figer.

Ne pas oublier `cache: npm` sur la tâche de lint, sinon chaque exécution retélécharge ESLint.

---

## Ne pas faire

- **Ne pas ajouter de dépendance npm chargée par le site.** ESLint est une `devDependency`, elle
  n'entre jamais dans une page.
- **Ne pas committer `node_modules/`.**
- **Ne pas ajouter Prettier ni de règles de style** (guillemets, points-virgules, longueur de
  ligne). Le projet a une mise en forme hétérogène assumée (2 et 4 espaces selon les fichiers) et
  un reformatage global produirait un diff illisible qui masquerait les vraies corrections.
- **Ne pas activer `eslint:recommended` en entier.** Il apporte une trentaine de règles dont
  plusieurs vont bruiter sur ce code. La liste ci-dessus est délibérément restreinte ; elle peut
  s'étoffer plus tard.
- **Ne pas ajouter de validation HTML** dans ce brief. Elle a été évaluée et écartée du
  périmètre.

---

## Vérification

- [ ] `npm ci` puis `npm run lint` passe en local, **zéro `error`**.
- [ ] Les `warn` restants sont soit corrigés, soit justifiés par un commentaire.
- [ ] `npm run check` (smoke-test) passe toujours.
- [ ] `npm run dev` démarre le serveur local.
- [ ] Introduire volontairement une faute de syntaxe dans `js/fiche.js` : la CI échoue.
- [ ] Introduire volontairement `documnet.getElementById('x')` : `no-undef` la signale.
- [ ] Introduire volontairement une variable inutilisée : elle est signalée.
- [ ] Les deux tâches existantes (`smoke-test` et `json-lint`) fonctionnent toujours.
- [ ] La tâche de version ajoutée par `L2-12` fonctionne toujours si elle est déjà en place.
- [ ] `node_modules/` est bien ignoré par Git.
- [ ] Le site fonctionne toujours à l'identique : ce brief ne doit **rien** changer au
      comportement. Vérifier tout de même les onze pages, au cas où une correction de `no-undef`
      aurait touché du code réellement exécuté.

---

## Message de commit

```
ci: verifier la syntaxe et linter le JavaScript (N7)

La CI ne validait que careers.json et skills.json : rien ne relisait
les 6 731 lignes de JavaScript, et une faute de syntaxe partait en
production sans obstacle.

- package.json d'outillage (devDependency ESLint, scripts lint/check/dev)
- eslint.config.mjs : regles restreintes a celles qui attrapent de vraies
  erreurs, globales du projet declarees (L, WFRP_CAREERS, WFRP_SKILLS)
- taches de workflow : node --check et npm run lint
- premier passage de mise au propre des avertissements
```

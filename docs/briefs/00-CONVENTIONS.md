# Contraintes communes — à lire avant tout brief

Ce document s'applique à **tous** les briefs de `docs/briefs/`. En cas de contradiction entre
un brief et ce fichier, ce fichier gagne. En cas de doute sur un point non couvert ici,
demander plutôt que décider seul.

---

## 1. Ce qu'est ce projet

Site compagnon statique pour une campagne de Warhammer Fantasy Roleplay 4e, hébergé sur
GitHub Pages depuis la branche `master`, dossier racine.

- **11 pages HTML** autonomes, chacune avec son propre `<head>` complet.
- **Modules ES natifs** chargés directement par le navigateur (`<script type="module">`).
  Aucun bundler, aucun transpileur, aucune étape de build.
- **Aucune dépendance npm à l'exécution.** Les librairies tierces (Firebase, d3, Cropper,
  Three.js, Leaflet) sont importées depuis leur CDN par URL versionnée.
- **Firebase** (Firestore, Auth, Storage) porte l'état partagé ; **Google Sheets** sert de
  back-office pour les données de règles.
- `npm`/`node` ne servent qu'à l'outillage de développement (`tools/`) et à la CI.

Le déploiement est un `git push` sur `master`. Il n'y a pas d'environnement de recette.

## 2. Interdits absolus

Ces points ne sont pas négociables et aucun brief ne demandera de les franchir :

- **Ne pas introduire de framework** (React, Vue, Svelte, Alpine, jQuery…).
- **Ne pas introduire de bundler ni de transpileur** (Vite, webpack, esbuild, Babel, TypeScript).
- **Ne pas ajouter de dépendance npm chargée par le site.** Les seules dépendances npm
  autorisées sont des `devDependencies` utilisées uniquement en CI (voir brief `L2-14`).
- **Ne pas convertir les modules ES en scripts classiques**, ni l'inverse.
- **Ne pas toucher à `tiles/`** (2 618 tuiles de carte générées) ni à `js/data/careers.json`
  et `js/data/skills.json` sauf demande explicite d'un brief.
- **Ne pas changer les versions des librairies CDN.** Les URL sont épinglées volontairement.
- **Ne pas reformater du code qu'on ne modifie pas.** Un diff doit contenir la correction et
  rien d'autre — pas de passage de guillemets simples aux doubles, pas de réindentation
  globale, pas de tri d'imports.

## 3. Sécurité — la règle qui gouverne tout le lot 1

`js/utils.js` exporte la fonction d'échappement du projet :

```js
export const esc = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
```

**Toute donnée qui ne vient pas d'une constante du code doit passer par `esc()` avant
d'entrer dans une chaîne HTML**, que ce soit en contexte texte ou en contexte d'attribut.
Cela vaut pour :

- ce qu'un utilisateur saisit (pseudo, nom de personnage, note, libellé d'achat XP…) ;
- ce qui vient de Firestore, y compris écrit par quelqu'un d'autre ;
- ce qui vient de Google Sheets ;
- ce qui vient de l'URL (`URLSearchParams`) ;
- `user.displayName` et `user.email` renvoyés par Firebase Auth.

**Alternative toujours préférable :** utiliser `textContent` plutôt que `innerHTML` quand on
n'insère que du texte. `js/doodle.js` en donne déjà un exemple correct :
`modalDateDetails.textContent = dateText`.

`js/pnjs.js` et `js/enquetes.js` sont la référence à imiter : ils appliquent `esc()`
systématiquement. `js/doodle.js` et `js/fiche.js` sont ceux à corriger.

**Ne jamais remplacer `esc()` par un remplacement partiel** du type
`name.replace(/"/g, '&quot;')`. Neutraliser le guillemet sans neutraliser `<` ne protège
rien.

### Ce qu'il ne faut surtout PAS échapper

Le code construit ses rendus par fragments : une variable interpolée contient souvent **du HTML
déjà assemblé**. L'échapper afficherait le balisage en clair à l'écran et casserait la page.
C'est le risque principal d'un passage d'échappement mené trop uniformément.

Repères pour distinguer les deux cas :

- **À échapper** : une valeur qui vient de `state`, de Firestore, de Google Sheets, de l'URL ou
  d'un champ de saisie. C'est une *donnée*.
- **À laisser tel quel** : une variable dont le nom se termine par `Html`, `H`, `Btn`, `Badge`,
  `Picker`, `Attr`, `chips`, ou qui est construite quelques lignes plus haut par un
  `` `<span…>` ``. C'est un *fragment de balisage*.

Les fragments concernés, à ne pas toucher — `js/fiche.js` : `skillsH`, `talentsH`, `rangsHtml`,
`prereqHtml`, `statusBadge`, `modifiedBadge`, `variantPicker`, `editBtn`, `actionBtn`,
`talAttr`, `noneOpt`, `hors` ; `js/doodle.js` : `nameHtml`, `actionsHtml` ;
`js/fiche-cloud.js` : `resetButtonHtml`.

En cas de doute : afficher la page après modification. Un `<span>` visible en clair à l'écran
signale un fragment échappé par erreur.

### Les valeurs numériques comptent aussi

`state` est rempli par `applyData()` depuis Firestore ou `localStorage` **sans aucune coercion
de type**. Un champ censé être un nombre (`cout`, `montant`, `adv`, `rang`, `cn`) peut donc
contenir une chaîne arbitraire si le document a été écrit par un autre client ou importé depuis
un fichier. Les `value="${…}"` de champs numériques doivent être échappés comme les autres.

## 4. Style de code

- **Indentation** : 4 espaces dans `js/`, 2 espaces dans `js/main.js`, `sw.js` et les fichiers
  HTML/CSS. Suivre le fichier qu'on modifie, ne pas l'harmoniser.
- **Nommage** : `camelCase` pour les fonctions et variables, `SCREAMING_SNAKE` pour les
  constantes de module, préfixe `_` pour l'état interne d'un module (`_saveLocalTimer`,
  `_careersBound`).
- **Commentaires en français**, et ils expliquent *pourquoi*, pas *quoi*. Le projet a déjà
  cette discipline, la conserver :

  ```js
  // Délégation : un seul jeu de listeners attaché au tbody, jamais ré-attaché.
  // Le re-render réécrit innerHTML, ce qui aurait empilé les listeners.
  ```

- **Patterns existants à respecter** :
  - Délégation d'événements sur le conteneur parent, protégée par un drapeau
    `_xxxBound` pour ne pas empiler les écouteurs au re-rendu.
  - Rendu par réécriture de `innerHTML` du conteneur, puis ré-attachement si nécessaire.
  - Sauvegardes débouncées : 400 ms en local, 2 s vers le cloud.
  - Mémoïsation avec point d'invalidation explicite (`_careerCache` /
    `invalidateCareerCache()`).
- **Pas de `var`.** `const` par défaut, `let` si réaffectation.
- **Fichiers en UTF-8 sans BOM**, fins de ligne LF.

## 5. Thèmes et CSS

Le site a deux thèmes : sombre (défaut) et parchemin, activé par
`data-theme="parchment"` sur `<html>`.

- **Toute couleur passe par un jeton CSS** défini dans `css/base.css` (`:root`) et redéclaré
  dans `css/theme-parchment.css`. Les jetons existants :
  `--bg-darkest`, `--bg-dark`, `--bg-card`, `--bg-surface`, `--bg-overlay`,
  `--gold`, `--gold-bright`, `--gold-dim`, `--copper`, `--blood`, `--blood-bright`,
  `--text-primary`, `--text-secondary`, `--text-muted`, `--text-heading`,
  `--border-subtle`, `--border-gold`, `--border-strong`, `--statut-allie`,
  `--statut-ennemi`, `--statut-neutre`, `--link-*`, `--dim-0` à `--dim-9`,
  `--shadow-*`, `--space-*`, `--radius-*`, `--transition-*`, `--font-heading`, `--font-body`.
- **Aucune couleur littérale** (`#c94c4c`, `rgba(0,0,0,0.3)`) dans un fichier `.js` ou dans un
  attribut `style=`. Si un jeton manque, en créer un dans les deux thèmes.
- **Toute modification visuelle se vérifie dans les deux thèmes.** Un correctif qui répare le
  sombre et casse le parchemin n'est pas livrable.

## 6. Version, CHANGELOG et cache

Le projet impose que ces trois éléments changent **ensemble**, à chaque livraison :

1. `APP_VERSION` en tête de `js/layout.js`
2. `CACHE_NAME` en tête de `sw.js` (purge le cache des visiteurs)
3. Une entrée datée dans `CHANGELOG.md`, en français, groupée par rubrique

**Un brief individuel ne bumpe rien.** Seuls les briefs de clôture (`L1-05`, `L2-15`) le font,
une fois le lot complet. Les autres briefs se contentent de leur correction.

Le brief `L2-12` ajoute un contrôle CI qui rend cette règle automatique.

## 7. Vérification

**Il n'y a pas de framework de test dans ce projet.** Chaque brief porte donc une checklist de
vérification manuelle, et elle fait partie du travail : un brief n'est pas terminé tant que
tous ses points ne sont pas cochés.

Serveur local :

```bash
node tools/dev-server.mjs      # http://localhost:8000/
```

Contrôles automatiques disponibles :

```bash
node tools/smoke-test.mjs      # cohérence careers.json / skills.json
```

Points à vérifier systématiquement, même quand le brief ne le redit pas :

- **La console du navigateur est vide** — aucune erreur, aucune violation de CSP.
- **Les deux thèmes** s'affichent correctement sur les pages touchées.
- **Le rendu mobile** tient (largeur 375 px), la navigation en menu burger fonctionne.
- **Le service worker** ne sert pas une version périmée : vider le cache dans les outils de
  développement avant de conclure qu'un correctif ne marche pas.

## 8. Données personnelles — le dépôt est public

`github.com/Ethoril/ennemi-interieur-wfrp4` est un dépôt **public**. Tout ce qui y est commis
est consultable, et le rester : une donnée retirée dans un commit ultérieur demeure dans
l'historique, et l'en effacer exige une réécriture d'historique plus une intervention du support
GitHub. Ce cas s'est déjà produit sur ce dépôt en août 2026.

**Ne jamais commiter** :

- une adresse électronique de joueur, même en exemple ou en commentaire ;
- le nom civil de quiconque ;
- un jeton, une clé privée, un identifiant de service.

La seule adresse admise dans le code est celle du MJ, `ethoril@gmail.com`, déjà publique dans
`js/firebase-init.js`.

Les données personnelles des joueurs vivent **dans Firestore uniquement**, saisies à la main
dans la console par le MJ. Le code y accède par les règles de sécurité, côté serveur — il ne les
télécharge pas dans le navigateur. Voir les briefs `L1-03` et `L1-04`.

Corollaire pour les sauvegardes et les exports : un fichier contenant des pseudos ou des
adresses de joueurs se place **hors du dépôt** (par exemple à côté de lui, jamais dedans), et ne
s'ajoute pas à `.gitignore` pour « pouvoir le garder au même endroit » — hors du dépôt veut dire
hors du dossier.

## 9. Comptes et données de test

- L'administrateur (MJ) est `ethoril@gmail.com`, constante `ADMIN_EMAIL` dans
  `js/firebase-init.js`. C'est le seul compte privilégié.
- La fiche `fiche.html?char=test` sert de bac à sable — l'utiliser pour tout essai destructif
  plutôt qu'une fiche de joueur.
- Les collections Firestore utilisées : `fiches`, `pnjs`, `relations`, `indices`,
  `doodle` (document `current`), `campagne` (documents `state` et, à créer, `acces`), `mail`.
- Chemins Storage : `portraits/`, `indices/`.

## 10. Git

### Identité de commit — à vérifier avant le premier commit

Le dépôt est public et **une seule identité y est admise**, auteur comme committer :

```
Ethoril <ethoril@users.noreply.github.com>
```

L'historique a été entièrement réécrit le 10 août 2026 pour l'uniformiser : 43 des 125 commits
exposaient un nom civil et des adresses professionnelles, parce que Git avait déduit une
identité du nom de machine faute de configuration. **Ne pas réintroduire une autre identité.**

Avant le premier commit, dans l'environnement de travail quel qu'il soit :

```bash
git config user.name  "Ethoril"
git config user.email "ethoril@users.noreply.github.com"
git config --global user.useConfigOnly true   # Git refuse de deviner une identité
```

`useConfigOnly` est posé en global sur la machine du mainteneur, mais **pas** dans un conteneur,
une machine virtuelle ou un environnement distant : l'y reposer systématiquement. Vérifier
après le premier commit :

```bash
git log -1 --format='%an <%ae> | %cn <%ce>'
```

Toute autre valeur que `Ethoril <ethoril@users.noreply.github.com>` des deux côtés doit être
corrigée **avant** de pousser — après, la correction demande une réécriture d'historique et une
intervention du support GitHub.

### Le reste

- **Un brief = un commit** (ou une courte série cohérente). Ne pas mélanger deux briefs.
- Message de commit au format conventionnel, en français, avec la référence du constat
  d'audit entre parenthèses. Chaque brief fournit le message à utiliser.
- **Ne pas lancer `deploy.ps1` en cours de lot.** Le script pousse directement sur `master`,
  donc en production. Il ne s'utilise qu'en fin de lot, après vérification.
- Ne jamais réécrire l'historique (`push --force`, `rebase` de commits poussés), ne jamais
  utiliser `--author` ni `--amend` sur un commit déjà poussé.
- Les SHA antérieurs au 10 août 2026 cités dans une documentation ancienne ne correspondent
  plus à rien : retrouver un commit par son intitulé.

## 11. Ordre de traitement

Le **lot 1** (`L1-*`) referme deux failles d'autorisation et débloque l'accès des joueurs à
leur fiche. Il est prioritaire et se livre seul.

Le **lot 2** (`L2-*`) traite la fiabilité, le poids, le thème parchemin, l'accessibilité et
l'outillage. Ses briefs sont largement indépendants, avec deux exceptions signalées dans les
en-têtes concernés.

Chaque brief indique ses dépendances. En l'absence de dépendance déclarée, il peut être
traité isolément.

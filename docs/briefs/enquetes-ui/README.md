# Briefs — Refonte de l'interface Enquêtes (bureau et mobile)

Refonte **visuelle et ergonomique** de l'espace « Documents et enquêtes » livré en v2.34.0.
Le modèle de données, les services Firebase, les règles et les brouillons ne changent pas.
Un brief = un commit autonome sur la branche `feat/enquetes-ui`.
Exécution par un autre assistant : voir [`PROMPT-CHATGPT.md`](PROMPT-CHATGPT.md).

> **Lire avant toute intervention :**
> 1. [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) — gagne en cas de contradiction ;
> 2. ce fichier (principes, jetons, correspondance maquette → données) ;
> 3. les maquettes de [`maquettes/`](maquettes/) : un `.html` statique par écran **et** sa capture
>    `.png` à la taille réelle. Les couleurs y sont en dur ; le code réel utilise les jetons du § 3.
>    Les maquettes montrent l'intention, pas le balisage à copier : le rendu reste construit par
>    `createElement` / `textContent` dans le style du fichier existant.

| Maquette | Écran |
|---|---|
| `01-bureau-dossier` | `enquetes.html?id=<enquête>` — trois colonnes : dossiers, dossier ouvert, carnet |
| `02-bureau-piece` | `enquetes.html?id=<document>` — visionneuse et fiche de la pièce |
| `03-mobile-liste` | `app/#/enquetes` — liste des dossiers |
| `04-mobile-dossier` | `app/#/enquetes/<enquête>` — dossier en onglets |
| `05-mobile-piece` | `app/#/enquetes/<document>` — pièce : image puis panneau |
| `06-mobile-note-rapide` | feuille basse ouverte par le bouton flottant « Note rapide » |

## 1. État actuel (à connaître)

- Un **seul composant** sert bureau et mobile : `createEnqueteWorkspaceView` dans
  `js/enquetes-workspace.js` (≈ 400 lignes denses). Bureau : `js/enquetes-workspace-bureau.js`.
  Mobile : `js/mobile/app.js` l. 387-389 branche les routes `ENQUETES`, `ENQUETE`, `ENQUETE_NEW`,
  `ENQUETE_EDIT` dessus. Les anciennes vues `js/mobile/views/enquete*.js` ne sont plus routées :
  ne pas les modifier.
- Styles : `css/enquetes-workspace.css` (9 lignes minifiées), chargé par `enquetes.html` et
  `app/index.html`.
- Tests : `tools/enquetes-workspace.test.mjs` (faux DOM : `classList.add` seulement,
  `querySelectorAll` ne comprend que `.classe` ou `TAG`, pas de `closest`/`matches`/`innerHTML`).
  Il **doit rester vert à chaque brief** ; l'étendre plutôt que le contourner.
- Recette visuelle : `tools/fixtures/enquetes-qa.html` (runtime factice, servi par
  `node tools/dev-server.mjs` → `http://localhost:8000/tools/fixtures/enquetes-qa.html`).
  App Check bloque Firestore hors production : la fixture est le seul moyen de voir l'écran.

Défauts constatés (ce que la refonte corrige) : titre « Documents et enquêtes » affiché deux fois
et bandeau de 350 px ; tous les contrôles ont le même style de bouton (navigation, objets, actions
destructives) ; actions affichées avant le contenu ; pièces listées deux fois (« Liens » et
« Pièces du dossier ») et PNJ mêlés aux notes ; état d'une enquête en petit texte ; relations en
texte brut ; chronologie sans forme ; graphe caché en bas ; sur mobile, liste et détail empilés sur
la même page avec une barre d'onglets qui doublonne la navigation basse.

## 2. Principes d'exécution

1. Briefs dans l'ordre. Chacun laisse `npm run check`, `npm run lint` et `npm run test:enquetes` verts.
2. **Aucune régression fonctionnelle** : droits (`canEdit`, `isGm`, zones `commun`/`mj`/`user:`),
   confirmations, brouillons locaux, conflits de révision, export ZIP, corbeille, historique,
   annotations, ordre éditorial, graphe et disposition personnelle restent accessibles. Une action
   peut changer de place (menu ⋯), jamais disparaître.
3. **Pas de nouveau service ni de changement de schéma.** Tout ce qui s'affiche se calcule depuis
   `state.records` / `state.pnjs` existants. Ne pas toucher `js/enquetes-runtime.js`,
   `js/data/enquetes-domain.js` (synchronisé vers `functions/`), `functions/`, `firestore.rules`.
4. **Logique en fonctions pures** dans un nouveau module `js/enquetes-view-model.js` (sans DOM),
   testées dans `tools/enquetes-ui-*.test.mjs`. Les scripts listent leurs tests un par un : ajouter
   le motif `tools/enquetes-ui-*.test.mjs` à `check` (à côté de `tools/enquetes-workspace.test.mjs`)
   **et** à `test:enquetes` dans `package.json` (E-01).
5. **Sécurité / CSP** : rendu par `createElement` + `textContent` uniquement. `app/index.html` a
   `style-src 'self'` : **aucun attribut `style`** ni `<style>` injecté ; le CSSOM
   (`el.style.left = …`) reste permis (déjà utilisé pour les marqueurs d'annotation).
6. **Précache** : tout nouveau fichier JS/CSS importé est ajouté à `ASSETS_LOCAUX` de `sw.js`
   dans le brief qui le crée. Pas de changement de version avant E-07.
7. Accessibilité : cibles ≥ 44 px sur mobile, focus visible, onglets en `role="tablist"` avec
   flèches gauche/droite, menu ⋯ accessible au clavier (Échap ferme et rend le focus), états jamais
   portés par la couleur seule (toujours un libellé).
8. Ne pas reformater le code existant non modifié. Commits au format du dépôt, terminés par la
   ligne `Co-Authored-By` de la session.

## 3. Jetons de design

Déclarer sur `.enq-workspace` (dans `css/enquetes-workspace.css`) à partir des variables de
`css/base.css`, et redéfinir le bloc pour le thème clair (`css/theme-parchment.css`, voir E-07).

| Jeton | Valeur sombre | Usage |
|---|---|---|
| `--enq-ground` | `var(--bg-dark)` `#0e0e18` | fond du dossier |
| `--enq-rail` | `#0b0b14` | colonnes latérales |
| `--enq-raised` | `var(--bg-card)` `#141422` / `var(--bg-card-hover)` `#1a1a2e` | cartes, champs |
| `--enq-line` | `rgba(201,168,76,.14)` à `.3` | séparateurs, contours |
| `--enq-accent` | `var(--gold)` `#c9a84c` | action principale, sélection |
| `--enq-paper` | `#e6d7b5` | fiches de pièce (parchemin) |
| `--enq-ink` | `#2a2116` (secondaire `#4a3d2a`, discret `#6b5a3e`) | texte sur parchemin |
| `--enq-wax` | `var(--blood)` `#7a1f1f` → `#b23a2e` | cachet, numéro de pièce |
| `--enq-state-open` | `#c9a84c` | Ouverte |
| `--enq-state-paused` | `#8a8a9a` | En pause |
| `--enq-state-solved` | `var(--statut-allie)` `#4caf7d` | Résolue |
| `--enq-suspect` | `var(--statut-ennemi)` `#e06a6a` | rôle « Suspect » d'un PNJ |

Typographie : `var(--font-heading)` (Cinzel) pour titres, numéros de pièce et intitulés de
section en capitales espacées (`letter-spacing:.14em`, 11-15 px) ; Crimson Text pour tout le reste,
italique pour la question centrale (épigraphe entre guillemets « »). Pas d'autre police.

**Élément signature** : les documents sont des **fiches de parchemin** (`--enq-paper`, ombre
portée, légère rotation ±0,6° désactivée sous `prefers-reduced-motion`) ; l'état du dossier est un
**cachet de cire** rond. Tout le reste reste sobre.

Hiérarchie des boutons (E-01) : `enq-button--primary` (fond or, texte sombre : une seule par
écran), `enq-button` (contour), `enq-button--quiet` (texte seul, liens d'appoint),
`enq-button--danger` (dans le menu ⋯ uniquement), `enq-icon-button` (44 × 44, `aria-label`
obligatoire).

## 4. Correspondance maquette → données

| Élément de maquette | Source |
|---|---|
| Compteurs « Dossiers 3 · Pièces 5 · Carnet 2 » | nombre de `records` par `type` (`enquetes` non archivées, `documents`, `notes`) |
| Puces d'état + compteurs | `enquete.etat` ∈ Ouverte / En pause / Résolue ; « Archivées » = `archive === true` |
| Ligne méta d'une carte dossier | nb de documents liés · nb de PNJ liés · `dateSession` du dernier `evenements` (ordre max) |
| « Pièce n° N » | rang dans l'ordre du dossier : `enquete.ordre`, puis les documents liés hors ordre (même tri que `renderRelated`). Numéro **relatif au dossier** : une pièce ouverte hors contexte n'en a pas |
| Catégorie / « Pièce reçue » / « Contribution · auteur » | `document.categorie`, `document.origine` (`piece` / `contribution`) |
| Badge « Appuie la pièce n° 1 » | `relations` (`nature`, `a`, `b`) entre deux pièces du dossier |
| « 1 fichier · 2 annotations » | `document.files.length` ; `annotations` où `document === id` |
| PNJ + rôle | `liens` vers un `pnjs`, `lien.role` (« Suspect » → `--enq-suspect`) |
| Chronologie | `evenements` où `enquete === id`, triés par `ordre` ; surtitre = `repere · dateSession` |
| Carnet de la colonne droite | `notes` liées au dossier ; « Non classée » = note sans aucun `liens` |
| « visible du groupe » / « Secret MJ » / « Personnel » | `zone` `commun` / `mj` / `user:*` |
| « Reprendre le brouillon » | `client.listDrafts(uid)` (existant) |

## 5. Ordre

| Brief | Objet | Dépend de |
|---|---|---|
| [E-01](E-01-socle-jetons-modele.md) | Jetons CSS, hiérarchie des boutons, menu ⋯, modèle de vue pur, fixture enrichie | — |
| [E-02](E-02-bureau-colonnes-liste.md) | Bureau : trois colonnes, colonne des dossiers, en-tête de page compact | E-01 |
| [E-03](E-03-bureau-dossier.md) | Bureau : dossier ouvert (cachet, pièces parchemin, PNJ, chronologie, tableau des liens) | E-02 |
| [E-04](E-04-piece-annotations.md) | Pièce ouverte : visionneuse, épingles numérotées, fiche, navigation dans le dossier | E-03 |
| [E-05](E-05-mobile-ecrans.md) | Mobile : écrans séparés liste / dossier en onglets / pièce | E-04 |
| [E-06](E-06-note-rapide.md) | Note rapide (colonne carnet bureau, bouton flottant + feuille basse mobile) | E-05 |
| [E-07](E-07-cloture.md) | Thème clair, accessibilité, mouvement réduit, version v2.35.0, livraison | tous |

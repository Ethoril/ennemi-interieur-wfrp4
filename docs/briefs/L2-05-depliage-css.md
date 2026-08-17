# L2-05 — Déplier la chaîne de chargement CSS

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | M1 |
| **Estimation** | 1 h |
| **Fichiers** | les 11 pages HTML, `js/layout.js`, `css/base.css` ; suppression de `css/style.css`, `css/layout.css`, `css/pnjs.css` |
| **Dépend de** | — |
| **À traiter avant** | `L2-12` — la liste de pré-cache du service worker cite `css/style.css` |

---

## Pourquoi

Le chargement des styles est sérialisé sur **trois niveaux** :

1. la page lie `css/style.css`, qui ne contient que cinq `@import` ;
2. `base.css` est découvert et téléchargé ;
3. `base.css` commence lui-même par un `@import` vers Google Fonts.

Chaque `@import` n'est découvert qu'après l'analyse du fichier précédent : la requête de police
part au **troisième aller-retour**, et le rendu est bloqué pendant tout ce temps. Il n'y a par
ailleurs aucun `preconnect` vers `fonts.gstatic.com`.

Accessoirement, `css/layout.css` et `css/pnjs.css` sont **vides** mais toujours importés — deux
requêtes pour rien.

---

## À faire

### 1. Remplacer le lien unique dans les 11 pages

Bloc de référence à mettre dans le `<head>`, à la place de
`<link rel="stylesheet" href="css/style.css">` :

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&display=swap">
<link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css">
<link rel="stylesheet" href="css/theme-parchment.css">
```

L'URL de police est celle actuellement en tête de `css/base.css` : la reprendre **à
l'identique**, sans changer les graisses demandées.

### 2. Ajouter les feuilles spécifiques, page par page

| Page | Feuilles supplémentaires |
|---|---|
| `index.html` | `css/hero3d.css` |
| `fiche.html` | `css/fiche.css` |
| `groupe.html` | `css/fiche.css` |
| `doodle.html` | `css/doodle.css` (si `L2-04` est fait) |
| `carte.html` | Leaflet (CDN, déjà présent avec son SRI) |
| `pnjs.html` | Cropper (CDN, déjà présent avec son SRI) |
| les autres | aucune |

`css/hero3d.css` ne concerne que l'accueil : la scène 3D n'existe que là. Vérifier tout de même
qu'aucune de ses règles ne sert ailleurs avant de la retirer des autres pages — elles sont
toutes scopées sous `html.hero3d-active`, donc a priori non.

### 3. Retirer l'injection dynamique du thème parchemin

`js/layout.js` (~l. 29-32) crée un `<link>` vers `css/theme-parchment.css` à l'exécution :

```js
const link = document.createElement('link');
link.rel  = 'stylesheet';
link.href = 'css/theme-parchment.css';
document.head.appendChild(link);
```

Supprimer ce bloc : la feuille est maintenant liée statiquement. Elle est entièrement scopée
sous `[data-theme="parchment"]`, donc inoffensive quand le thème est sombre, et son chargement
anticipé supprime le bref flash de style non appliqué au premier passage en Parchemin.

**Conserver** la fonction `initTheme()` autour, qui pose l'attribut `data-theme` et gère le
drapeau `themeResetV213`.

### 4. Retirer l'`@import` de police de `base.css`

Supprimer la ligne 6 de `css/base.css` (`@import url('https://fonts.googleapis.com/…')`),
maintenant que la police est liée dans chaque page. En profiter pour réécrire l'en-tête de
commentaire du fichier s'il contient des caractères abîmés (voir aussi `L2-13`).

### 5. Supprimer les trois fichiers

```bash
git rm css/style.css css/layout.css css/pnjs.css
```

`css/style.css` ne contenait que les `@import`. Les deux autres sont vides — vérifier avant
suppression qu'ils le sont bien restés.

---

## Ne pas faire

- **Ne pas concaténer les feuilles** en un seul fichier. La séparation par rôle
  (base / composants / thème / page) est lisible et suffit ; un fichier de 5 000 lignes ne
  s'édite pas.
- **Ne pas ajouter d'étape de build** pour générer les `<head>`. Onze blocs identiques recopiés
  à la main est le prix à payer pour un site sans build, et c'est un choix assumé du projet.
- **Ne pas héberger la police en local** dans ce brief. C'est une autre discussion (poids du
  dépôt contre dépendance réseau), hors périmètre.
- **Ne pas changer l'ordre des feuilles.** `base.css` puis `components.css` puis le thème :
  `theme-parchment.css` surcharge les jetons, il doit venir après leur déclaration.
- **Ne pas oublier une page.** Il y en a onze : `index`, `groupe`, `videos`, `tableau`,
  `regles`, `cartes`, `carte`, `pnjs`, `enquetes`, `doodle`, `fiche`.

---

## Vérification

C'est **le chantier au risque visuel le plus élevé du lot** : il touche le chargement des styles
de toutes les pages. La vérification page par page n'est pas optionnelle.

- [ ] Les **onze** pages s'affichent à l'identique, en thème sombre. Comparer aux captures
      d'avant modification.
- [ ] Les **onze** pages s'affichent à l'identique en thème parchemin.
- [ ] La bascule de thème fonctionne sur chaque page et **sans flash** de style au premier
      passage en parchemin (c'est le gain attendu du point 3).
- [ ] Onglet Réseau, cache vidé : plus aucune requête vers `style.css`, `layout.css` ni
      `pnjs.css`. La requête de police part dans la **première** vague, en parallèle des
      feuilles locales et non après elles.
- [ ] Les polices Cinzel et Crimson Text s'appliquent bien (un repli en Times serait visible
      immédiatement sur les titres).
- [ ] La scène 3D de l'accueil fonctionne toujours (elle dépend de `hero3d.css` pour
      positionner son canvas).
- [ ] La fiche et la page Groupe ont bien `fiche.css`.
- [ ] `carte.html` : la carte Leaflet s'affiche, ses contrôles sont stylés.
- [ ] `pnjs.html` : le graphe s'affiche, la modale de recadrage Cropper est stylée.
- [ ] Rendu mobile 375 px sur les onze pages.
- [ ] Aucune 404 dans la console sur aucune page.

---

## Message de commit

```
perf(css): deplier la chaine de chargement des feuilles de style (M1)

Le chargement etait serialise sur trois niveaux : la page liait
style.css, qui importait base.css, qui importait Google Fonts. La
requete de police partait au troisieme aller-retour, rendu bloque.

- feuilles liees directement dans les 11 pages, avec preconnect
- police remontee en <link> depuis l'@import de base.css
- theme-parchment.css lie statiquement, injection dynamique de
  layout.js supprimee (supprime aussi le flash au premier passage)
- suppression de style.css et des deux feuilles vides layout.css
  et pnjs.css
```

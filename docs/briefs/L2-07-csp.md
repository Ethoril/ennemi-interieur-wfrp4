# L2-07 — Resserrer la politique de sécurité du contenu

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | M3 |
| **Estimation** | 1 h |
| **Fichiers** | les 11 pages HTML (balise `<meta>` CSP) |
| **Dépend de** | `L1-01` et `L1-02` livrés — l'échappement doit être en place avant de compter sur autre chose |

---

## Pourquoi

Les onze pages portent `script-src 'unsafe-inline'`, ajouté en 2.8.x pour débloquer une erreur
`auth/internal-error` à la connexion Google. C'est précisément la directive qui aurait limité
les injections des constats B1 et I1.

Or **une seule page a réellement un script en ligne** : `index.html`, avec sa carte d'import
Three.js. Sur les dix autres, `'unsafe-inline'` est un reliquat.

Par ailleurs la politique complète est recopiée **à l'identique** dans onze fichiers : toute
évolution demande onze modifications cohérentes, et chaque page autorise des origines dont elle
n'a aucun besoin.

---

## À faire

### 1. Retirer `'unsafe-inline'` des dix pages sans script en ligne

Vérifier d'abord, page par page, l'absence de `<script>` sans `src` et d'attribut d'événement
en ligne (`onclick=`, `onerror=`…) :

```bash
grep -n '<script' *.html | grep -v 'src='
grep -n 'on[a-z]*="' *.html
```

`index.html` conserve `'unsafe-inline'` pour sa carte d'import. Les cartes d'import externes ne
sont pas supportées par les navigateurs, il n'y a donc pas d'alternative — le noter en
commentaire HTML juste au-dessus de la balise `<meta>` pour que la raison ne se perde pas.

### 2. Élaguer les origines page par page

Actuellement chaque page autorise toutes les origines utilisées par n'importe quelle page. En
réalité :

| Origine | Utilisée par |
|---|---|
| `https://unpkg.com` | `carte.html` seulement (Leaflet) |
| `https://cdn.jsdelivr.net` | `pnjs.html` (d3, Cropper) et `index.html` (Three.js) |
| `https://img.youtube.com` (`img-src`) | `videos.html` seulement |
| `https://www.youtube.com` (`frame-src`) | `videos.html` seulement |
| `https://docs.google.com` (`connect-src`) | `tableau.html`, `fiche.html` (modale talents), `index.html` (prochaine session) |
| `https://docs.google.com` (`frame-src`) | à vérifier — probablement plus utilisé |
| `https://www.gstatic.com` | toutes les pages chargeant Firebase |
| `https://*.googleusercontent.com` (`img-src`) | pages affichant un avatar Google |
| `https://firebasestorage.googleapis.com`, `https://*.firebasestorage.app` | `pnjs.html`, `enquetes.html` |
| `https://apis.google.com`, `https://accounts.google.com`, `https://*.firebaseapp.com`, `https://www.google.com` | pages avec connexion Google : `index`, `fiche`, `pnjs`, `enquetes`, `doodle` |

Pages sans Firebase du tout : `groupe.html`, `videos.html`, `regles.html`, `cartes.html`,
`carte.html`, `tableau.html`. Leur CSP peut être nettement plus courte — vérifier tout de même
que `js/layout.js` n'a pas besoin de Firebase (il ne fait qu'un `fetch` vers
`docs.google.com` pour la prochaine session, donc `connect-src https://docs.google.com` reste
nécessaire partout où la barre de navigation s'affiche… c'est-à-dire partout).

### 3. Si un parcours casse

**Ne pas insister.** Rétablir `'unsafe-inline'` ou l'origine concernée sur la page en question,
et l'expliquer en commentaire HTML :

```html
<!-- 'unsafe-inline' requis ici : <raison constatée> -->
```

La défense qui compte est l'échappement livré en `L1-01` et `L1-02`. Ce brief est un
durcissement supplémentaire, pas un prérequis de sécurité : mieux vaut une CSP imparfaite et un
site qui marche.

### 4. Limite à connaître

Livrée par `<meta http-equiv>`, une CSP ne peut pas porter `frame-ancestors`, `report-uri` ni
`report-to`. GitHub Pages ne permettant pas de définir d'en-têtes HTTP, ces directives resteront
inaccessibles. Ce n'est pas contournable dans le cadre actuel — le noter et passer.

---

## Ne pas faire

- **Ne pas introduire de hash ou de nonce.** Les nonces exigent une génération par requête,
  donc un serveur : impossible sur GitHub Pages. Les hash sont possibles pour un script en ligne
  figé, mais la carte d'import de `index.html` n'a pas besoin d'être en ligne pour une autre
  raison — inutile de compliquer.
- **Ne pas ajouter de générateur de `<head>`.** Onze politiques distinctes recopiées à la main
  est cohérent avec un site sans build.
- **Ne pas retirer `'unsafe-inline'` de `style-src`.** Le projet utilise massivement des
  attributs `style=` (notamment sur la fiche et le Calendrier) ; le brief `L2-04` en supprime une
  partie mais pas la totalité. Ce serait un chantier à part.
- **Ne pas élargir une directive pour faire disparaître un avertissement.** Si une violation
  apparaît, identifier la ressource et l'autoriser précisément.

---

## Vérification

À faire page par page, avec la console ouverte. Une violation de CSP s'affiche comme
`Refused to load … because it violates the following Content Security Policy directive`.

- [ ] **Connexion Google** testée sur les cinq pages qui l'utilisent : `index.html`
      (contrôles du calendrier impérial), `fiche.html`, `pnjs.html`, `enquetes.html`,
      `doodle.html`. La fenêtre s'ouvre, le retour fonctionne, la session persiste.
- [ ] **Déconnexion** sur ces mêmes pages.
- [ ] `carte.html` : Leaflet se charge, les tuiles s'affichent, l'outil de mesure fonctionne.
- [ ] `pnjs.html` : le graphe d3 s'affiche, la modale de recadrage Cropper s'ouvre, un
      téléversement de portrait aboutit et l'image s'affiche.
- [ ] `enquetes.html` : les illustrations d'indices s'affichent, un téléversement aboutit.
- [ ] `index.html` : la scène Three.js se charge (donc la carte d'import fonctionne), le
      calendrier impérial s'affiche, la date de prochaine session se charge depuis
      `docs.google.com`.
- [ ] `tableau.html` : les huit onglets se chargent depuis Google Sheets.
- [ ] `fiche.html` : la modale de description d'un talent se charge (elle interroge
      `docs.google.com`).
- [ ] `videos.html` : les vignettes YouTube s'affichent et une vidéo se lance dans la modale.
- [ ] Les avatars Google s'affichent là où ils apparaissent.
- [ ] Console vide de violations sur les **onze** pages.
- [ ] Toute origine retirée puis remise l'est avec un commentaire expliquant pourquoi.

---

## Message de commit

```
security(csp): retirer unsafe-inline et elaguer les origines (M3)

script-src 'unsafe-inline' etait present sur les 11 pages alors que
seule index.html a un script en ligne (la carte d'import Three.js).
Chaque page autorisait par ailleurs des origines dont elle n'a pas
l'usage.

- 'unsafe-inline' retire de 10 pages, conserve et documente sur index
- origines elaguees page par page (unpkg, jsdelivr, youtube, firebase)
- limite notee : en <meta>, frame-ancestors et report-uri sont
  inaccessibles, et GitHub Pages ne permet pas d'en-tetes HTTP
```

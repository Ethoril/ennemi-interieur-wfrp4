# L2-06 — Supprimer 31 Mo d'images

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constat d'audit** | M2 |
| **Estimation** | 30 min |
| **Fichiers** | `img/`, `groupe.html`, `js/fiche.js` |
| **Dépend de** | — |

---

## Pourquoi

Le dossier `img/` pèse **32 Mo** pour ce qui devrait en peser un.

`img/vecteezy_old-grunge-frame-background_153249.svg` fait **14 Mo** et n'est référencé nulle
part — vérifié sur l'ensemble des fichiers HTML, CSS et JS. C'est du poids mort intégral.

Les cinq PNG de portraits totalisent **18,4 Mo**, dont `Wren.png` à lui seul 8,3 Mo, alors que
les WebP équivalents font 74 à 290 Ko. Ces PNG ne servent que de repli dans des balises
`<picture>` : aucun navigateur sorti depuis 2020 ne les télécharge, WebP étant supporté partout
depuis Safari 14.

| Fichier | Taille |
|---|---|
| `vecteezy_old-grunge-frame-background_153249.svg` | 14,1 Mo — non référencé |
| `Wren.png` | 8,4 Mo |
| `Bhelgi.png` | 2,9 Mo |
| `Hellaya.png` | 2,5 Mo |
| `Elysia.png` | 2,4 Mo |
| `Caelel.png` | 2,3 Mo |

---

## À faire

### 1. Supprimer les fichiers

```bash
git rm "img/vecteezy_old-grunge-frame-background_153249.svg"
git rm img/Bhelgi.png img/Caelel.png img/Elysia.png img/Hellaya.png img/Wren.png
```

Avant de supprimer le SVG, **revérifier** qu'il n'est vraiment cité nulle part :

```bash
grep -rn "vecteezy" --include=*.html --include=*.css --include=*.js .
```

Conserver les WebP et les deux vignettes de cartes (`thumb-empire.webp`,
`thumb-vieux-monde.webp`), qui sont utilisées.

### 2. `groupe.html` — remplacer les `<picture>`

Cinq blocs à simplifier :

```html
<!-- avant -->
<div class="character-portrait">
    <picture>
        <source srcset="img/Bhelgi.webp" type="image/webp">
        <img src="img/Bhelgi.png" alt="Bhelgi" loading="lazy">
    </picture>
</div>

<!-- après -->
<div class="character-portrait">
    <img src="img/Bhelgi.webp" alt="Bhelgi" loading="lazy">
</div>
```

Vérifier que les règles CSS de `.character-portrait` ciblent bien l'`<img>` et pas le
`<picture>` — s'il existe un sélecteur `.character-portrait picture`, l'adapter dans
`css/fiche.css`.

### 3. `js/fiche.js` — réduire la table `PORTRAITS`

La constante (~l. 23) devient :

```js
const PORTRAITS = {
    bhelgi:  { src: 'img/Bhelgi.webp',  alt: 'Bhelgi'  },
    caelel:  { src: 'img/Caelel.webp',  alt: 'Caelel'  },
    elysia:  { src: 'img/Elysia.webp',  alt: 'Elysia'  },
    hellaya: { src: 'img/Hellaya.webp', alt: 'Hellaya' },
    wren:    { src: 'img/Wren.webp',    alt: 'Wren'    },
};
```

Et le rendu dans `updateCharacterPortrait()` :

```js
portraitEl.innerHTML = `<img src="${portrait.src}" alt="${esc(portrait.alt)}" loading="lazy">`;
```

Conserver la branche de repli qui affiche `📜` et la classe
`character-portrait--placeholder` quand aucun portrait ne correspond.

### 4. Ne pas purger l'historique Git

`git rm` allège l'arbre de travail mais **pas** l'historique : les blobs restent dans le pack et
la taille d'un clone ne bougera pas. La purge demanderait de réécrire l'historique et un
`push --force`.

**Ce n'est pas demandé et ne doit pas être fait.** Le gain (temps de clone) ne justifie pas le
risque sur un dépôt qui n'a pas de sauvegarde ailleurs. Le noter dans le message de commit pour
que la question ne revienne pas.

---

## Ne pas faire

- **Ne pas réécrire l'historique Git.** Point ci-dessus.
- **Ne pas régénérer les WebP.** Ils sont corrects et dimensionnés.
- **Ne pas toucher à `tiles/`** (18 Mo, 2 618 fichiers). Ces tuiles sont utilisées par la
  visionneuse de cartes et ne sont pas régénérables sans les images sources, qui sont exclues du
  dépôt par `.gitignore`.
- **Ne pas ajouter de `srcset` avec plusieurs tailles.** Les portraits s'affichent à une seule
  taille, ce serait de la complexité gratuite.

---

## Vérification

- [ ] `du -sh img/` renvoie environ 1 Mo (contre 32 Mo).
- [ ] Les cinq portraits s'affichent sur `groupe.html`, en thème sombre et en parchemin.
- [ ] Les cinq portraits s'affichent dans l'en-tête de leur fiche
      (`fiche.html?char=bhelgi` et les quatre autres).
- [ ] `fiche.html?char=test` affiche bien le repli `📜`.
- [ ] Le cadrage et les proportions des portraits sont inchangés — le CSS de
      `.character-portrait` a été adapté au format rectangulaire en 2.11.8, vérifier que rien
      ne casse sur mobile où il passe en carré arrondi.
- [ ] Aucune 404 sur un `.png` dans la console, ni sur `groupe.html` ni sur les fiches.
- [ ] `grep -rn "\.png" --include=*.html --include=*.js --include=*.css .` ne renvoie plus de
      référence aux portraits.

---

## Message de commit

```
perf(img): supprimer 31 Mo d'images inutilisees ou obsoletes (M2)

- suppression du SVG de 14 Mo, reference dans aucun fichier
- suppression des 5 PNG de repli (18,4 Mo, dont Wren.png a 8,4 Mo) :
  WebP est supporte par tous les navigateurs depuis Safari 14
- <picture> remplaces par de simples <img> dans groupe.html
- table PORTRAITS de fiche.js reduite a une URL par personnage

L'historique Git n'est volontairement pas reecrit : les blobs restent
dans le pack, mais l'arbre de travail passe de 32 Mo a environ 1 Mo.
```

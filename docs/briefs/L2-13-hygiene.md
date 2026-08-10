# L2-13 — Encodage, code mort et fichiers obsolètes

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Constats d'audit** | N2, N6 |
| **Estimation** | 1 h |
| **Fichiers** | `CHANGELOG.md`, `css/base.css`, `js/fiche.js`, `js/sheets.js`, `js/main.js`, `js/hero3d/`, `.editorconfig` et `.gitattributes` (nouveaux) |
| **Dépend de** | — |

---

## Pourquoi

Deux constats sans gravité mais qui gênent le travail au quotidien.

**N2 — encodage double.** Toute la moitié basse de `CHANGELOG.md` est de l'UTF-8 doublement
encodé : `RÃ©solution`, `â€™`, `compÃ©tences`, `dÃ©sormais`. L'historique du projet en devient
pénible à relire. L'en-tête de `css/style.css` a le même problème (ce fichier disparaît avec
`L2-05`, mais `css/base.css` doit être vérifié).

**N6 — code mort et vestiges.** Sept petites choses laissées derrière, dont un point d'entrée de
test livré en production.

---

## Tâche 1 — N2 : corriger l'encodage

### `CHANGELOG.md`

Les séquences abîmées suivent le motif classique du double encodage : le fichier a été lu en
Latin-1 puis réécrit en UTF-8. La correction consiste à faire l'aller-retour inverse.

```bash
# Repérer l'étendue du problème
grep -n 'Ã©\|Ã¨\|â€™\|Ã \|Ãª\|Ã´\|Ã§' CHANGELOG.md | wc -l
```

Corriger, puis **relire intégralement** la partie corrigée : une conversion automatique peut
abîmer autre chose, notamment les caractères non alphabétiques (`—`, `«` `»`, `✓`, `☁`, les
emoji des titres de rubriques). Ce fichier est lu par le MJ, il doit être impeccable.

Correspondances les plus fréquentes, pour vérification manuelle :

| Abîmé | Correct |
|---|---|
| `Ã©` | `é` |
| `Ã¨` | `è` |
| `Ãª` | `ê` |
| `Ã ` | `à` |
| `Ã§` | `ç` |
| `Ã´` | `ô` |
| `â€™` | `’` |
| `â€”` | `—` |
| `â€œ` `â€` | `“` `”` |
| `Â«` `Â»` | `«` `»` |
| `âœ“` | `✓` |
| `â˜` | `☁` ou `★` selon le contexte — **à vérifier au cas par cas** |

Ne **pas** modifier le contenu rédactionnel au passage : on corrige l'encodage, pas le texte.

### `css/base.css`

Vérifier son en-tête de commentaire. Le brief `L2-05` supprime `css/style.css`, dont l'en-tête
était abîmé ; si le même en-tête a été recopié dans `base.css`, le réécrire proprement.

### Prévenir la récidive

`.editorconfig` :

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true

[*.{js,mjs,json}]
indent_style = space
indent_size = 4

[{*.html,*.css,*.md,sw.js,js/main.js}]
indent_style = space
indent_size = 2
```

Les tailles d'indentation reflètent l'existant, elles ne le changent pas — voir la section 4 des
conventions. `sw.js` et `js/main.js` sont en 2 espaces contrairement au reste de `js/`.

`.gitattributes` :

```
* text=auto eol=lf

*.webp  binary
*.png   binary
*.jpg   binary
*.svg   text eol=lf
```

Vérifier après ajout que `git status` ne signale pas la totalité du dépôt comme modifiée. Si
c'est le cas, `git add --renormalize .` en un commit **séparé** et clairement identifié.

---

## Tâche 2 — N6 : code mort et vestiges

Sept points, tous petits.

| Fichier | Constat | Action |
|---|---|---|
| `js/fiche.js` | `setCloudLoaded` est exporté et jamais appelé | Supprimer la fonction et son export. Vérifier d'abord par `grep -rn "setCloudLoaded" .` |
| `js/fiche-cloud.js` | `exportData` importé et inutilisé (l. 4) | **Ne rien faire si `L2-02` est déjà passé** : l'import y devient utile. Sinon, le retirer de la liste d'import. |
| `js/sheets.js` | Branche `if (firstRowCorrupted)` (~l. 45-53) : elle réassigne `dataStart = 1`, valeur déjà en place | Supprimer l'affectation redondante et **conserver** le nettoyage des en-têtes, qui sert réellement. Reformuler le commentaire pour dire ce que fait vraiment la branche. |
| `js/hero3d/scroll-timeline.js` | Point d'entrée de test `window.__HERO3D_PROGRESS` (~l. 120) livré en production | Le conditionner à un paramètre d'URL (`?hero3dDebug=1`) plutôt que le retirer — il sert aux captures. Documenter son usage en commentaire. |
| `js/main.js` | `console.log('SW registered!', reg)` (~l. 214) | Supprimer le `console.log`, **garder** le `console.error` du `catch`. |
| `js/hero3d/index.js` | `console.log("Hero3D: Conditions non réunies…")` (~l. 31) | Le garder : il est utile au diagnostic (« pourquoi la scène ne s'affiche pas »). Le passer en `console.debug` pour qu'il n'apparaisse plus au niveau par défaut. |
| `implementation_plan.md` (racine) | Plan du Doodle de mai, avec ses questions ouvertes non répondues, alors que la fonctionnalité est livrée depuis trois mois | Déplacer dans `docs/archives/` avec un en-tête indiquant qu'il est historique. |
| `tools/skills-baseline.json` | Contient `[]` — ce qui est **correct** (aucune incohérence connue) mais ressemble à un fichier oublié | Ajouter deux lignes de commentaire dans `tools/smoke-test.mjs` expliquant qu'un tableau vide signifie « aucune dette », pas « fichier non généré ». |

---

## Ne pas faire

- **Ne pas réécrire l'historique Git** pour corriger l'encodage des anciens commits.
- **Ne pas reformater `CHANGELOG.md`** au-delà de la correction d'encodage : pas de
  réharmonisation des titres, pas de retour à la ligne différent, pas de réécriture de phrases.
- **Ne pas supprimer `window.__HERO3D_PROGRESS`.** Le conditionner suffit ; il a une utilité.
- **Ne pas supprimer `tools/skills-baseline.json`.** Son absence fait échouer le smoke-test avec
  un message demandant de le régénérer.
- **Ne pas mélanger la renormalisation `.gitattributes` avec les autres modifications** si elle
  touche beaucoup de fichiers. Commit séparé.
- **Ne pas changer les tailles d'indentation existantes** via `.editorconfig`. Le fichier décrit
  l'existant, il ne le réforme pas.

---

## Vérification

### Encodage

- [ ] `grep -c 'Ã©\|â€™\|Ã¨\|Ãª\|Â«' CHANGELOG.md` renvoie 0.
- [ ] Relecture de la moitié basse de `CHANGELOG.md` : les accents sont corrects, **et** les
      caractères spéciaux (`—`, `«` `»`, `✓`, `☁`, `★`, `⟵`, emoji) sont intacts.
- [ ] Le fichier est en UTF-8 **sans BOM** (`file CHANGELOG.md`, ou vérifier les trois premiers
      octets).
- [ ] Aucune modification du contenu rédactionnel : `git diff` ne montre que des changements de
      caractères accentués.
- [ ] `.editorconfig` et `.gitattributes` sont ajoutés, et `git status` est propre après leur
      ajout (ou la renormalisation est dans un commit séparé et identifié).

### Code mort

- [ ] `grep -rn "setCloudLoaded" .` ne renvoie plus rien.
- [ ] `grep -c "console.log" js/*.js js/hero3d/*.js sw.js` : plus que le strict nécessaire.
- [ ] `js/sheets.js` : les huit onglets se chargent toujours, y compris celui dont la première
      ligne est fusionnée dans le Google Sheet (c'est le cas que la branche traite — le
      reproduire, ou au minimum vérifier que les huit onglets s'affichent avec les bons
      en-têtes).
- [ ] La scène 3D fonctionne toujours, et `?hero3dDebug=1` permet encore de forcer la
      progression.
- [ ] Le service worker s'enregistre toujours (vérifier dans l'onglet Application, pas par le
      message de console qui a été supprimé).
- [ ] `node tools/smoke-test.mjs` passe.
- [ ] `implementation_plan.md` n'est plus à la racine, son remplacement dans `docs/archives/`
      porte un en-tête explicite.

---

## Messages de commit

Deux commits.

```
chore(encodage): corriger le double encodage UTF-8 du CHANGELOG (N2)

Toute la moitie basse du fichier etait de l'UTF-8 lu en Latin-1 puis
reecrit en UTF-8 (RA©solution, aTM, competences abimees).

- correction des sequences, caracteres speciaux verifies un par un
- .editorconfig et .gitattributes pour prevenir la recidive
```

```
chore: supprimer le code mort et les vestiges de developpement (N6)

- setCloudLoaded : exporte et jamais appele
- affectation redondante dans la branche firstRowCorrupted de sheets.js
- console.log d'enregistrement du service worker
- point d'entree de test __HERO3D_PROGRESS conditionne a ?hero3dDebug=1
- implementation_plan.md deplace dans docs/archives/
- commentaire sur skills-baseline.json vide, qui est un etat valide
```

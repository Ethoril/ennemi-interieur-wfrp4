# L3-06 — CHANGELOG, version, livraison

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 3 — apparence et fluidité |
| **Constat** | N1 |
| **Estimation** | 30 min |
| **Fichiers** | `js/layout.js`, `sw.js`, `CHANGELOG.md`, `docs/briefs/README.md` |
| **Dépend de** | `L3-01` à `L3-05` |

---

## À faire

1. Suivre le skill `/livraison` : bump mineur de `APP_VERSION` dans `js/layout.js` **et**
   `sw.js`, entrée CHANGELOG qui décrit ce que voient les joueurs (barre qui ne déborde plus,
   transitions entre pages, chargements plus lisibles, animations), pas les détails CSS.
2. Si `L3-04` a changé la liste des fichiers servis, vérifier le pré-cache de `sw.js`
   (`cache.addAll()` est atomique : un chemin faux fait échouer l'installation en silence).
3. Barrer les briefs livrés dans le tableau du lot 3 de `docs/briefs/README.md`.
4. `npm run lint` et `npm run check` sortent sans erreur.

## Vérification

- [ ] Console du navigateur vide sur les onze pages.
- [ ] Les deux thèmes, 375 px et 1440 px, sur les onze pages.
- [ ] Service worker : la nouvelle version s'installe et remplace l'ancienne.
- [ ] Test sur Android (PWA installée) : rien de cassé côté `app/`.

## Commit

    release: vX.Y.0 - navigation, transitions et animations (N1)

---
name: livraison
description: Bump de version de fin de lot — aligne APP_VERSION dans js/layout.js et sw.js, ajoute l'entrée CHANGELOG datée, et vérifie la cohérence exigée par la CI. À n'utiliser que sur un commit de clôture de lot (L1-05, L2-15, release), jamais sur un brief individuel.
disable-model-invocation: true
---

# Livraison — bump de version coordonné

La règle du projet (`docs/briefs/00-CONVENTIONS.md` §6) impose que **trois éléments changent
ensemble, à chaque livraison, et jamais séparément** :

1. `APP_VERSION` en tête de `js/layout.js` (ligne 1, format `'vX.Y.Z'`)
2. `APP_VERSION` en tête de `sw.js` (ligne 3, format `'vX.Y.Z'`) — pilote `CACHE_NAME`,
   ce qui purge le cache des visiteurs
3. Une entrée datée dans `CHANGELOG.md`, en français, groupée par rubrique

La CI (`.github/workflows/validate.yml`, job `version-coherence`) refuse le push si les deux
`APP_VERSION` diffèrent ou si le CHANGELOG n'a pas d'entrée `[X.Y.Z]` (sans le `v`).

> **Un brief individuel ne bumpe rien.** Seuls les briefs de clôture (`L1-05`, `L2-15`) et les
> `release:` le font, une fois le lot complet et vérifié. Si l'intention n'est pas une clôture
> de lot, arrête-toi et signale-le.

## Étapes

1. **Confirmer le numéro de version.** Lire l'`APP_VERSION` actuelle dans `js/layout.js`.
   Demander à l'utilisateur la nouvelle (`patch` pour un correctif, `minor` pour une
   fonctionnalité) s'il ne l'a pas donnée. Format `vX.Y.Z`.

2. **Aligner les deux `APP_VERSION`** — `js/layout.js` ligne 1 et `sw.js` ligne 3. Valeurs
   strictement identiques, `v` compris.

3. **Rédiger l'entrée CHANGELOG** en tête de `CHANGELOG.md`, au format existant :

   ```
   ## [X.Y.Z] - AAAA-MM-JJ

   ### <Rubrique>
   - **Titre court en gras** : phrase en français qui explique l'effet pour l'utilisateur,
     pas le détail technique. Le CHANGELOG existant est le modèle de ton à suivre.
   ```

   Utiliser la date du jour. Grouper par rubrique (`Personnages`, `Performance`, `Sécurité`,
   `Corrections`, `PWA & Cache`, `Accessibilité`…). S'appuyer sur les briefs livrés dans le lot
   et sur `git log` depuis la dernière release pour recenser les changements. Ne rien inventer
   qui ne soit pas dans les commits.

4. **Vérifier la cohérence** — même contrôle que la CI :

   ```bash
   node -e "const fs=require('node:fs'),rd=f=>fs.readFileSync(f,'utf8');const a=rd('js/layout.js').match(/APP_VERSION = '(.+?)'/)?.[1],b=rd('sw.js').match(/APP_VERSION = '(.+?)'/)?.[1];if(a!==b)throw'layout '+a+' != sw '+b;if(!rd('CHANGELOG.md').includes('['+a.slice(1)+']'))throw'CHANGELOG sans entree pour '+a;console.log('Version coherente : '+a)"
   ```

5. **Ne pas déployer.** `deploy.ps1` pousse directement sur `master`, donc en production
   (§10). Il ne s'utilise qu'en fin de lot, après validation manuelle par le MJ. S'arrêter au
   commit ; laisser l'utilisateur lancer le déploiement.

6. Proposer le message de commit de clôture au format conventionnel FR, p. ex.
   `release: vX.Y.Z - <résumé du lot>`.

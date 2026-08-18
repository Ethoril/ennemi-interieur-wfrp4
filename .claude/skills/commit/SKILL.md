---
name: commit
description: Prépare un commit au format du projet — vérifie d'abord l'identité Git imposée (dépôt public), puis rédige un message conventionnel en français avec la référence du constat d'audit entre parenthèses. Un brief = un commit. Ne déploie jamais.
disable-model-invocation: true
---

# Commit

Rédige et crée un commit conforme à `docs/briefs/00-CONVENTIONS.md` §10.

## 1. Vérifier l'identité — AVANT le commit

Le dépôt `github.com/Ethoril/ennemi-interieur-wfrp4` est **public** et **une seule identité y
est admise**, auteur comme committer :

```
Ethoril <ethoril@users.noreply.github.com>
```

Vérifier la config locale, et la poser si besoin (l'y reposer systématiquement hors de la
machine du mainteneur : conteneur, VM, environnement distant) :

```bash
git config user.name  "Ethoril"
git config user.email "ethoril@users.noreply.github.com"
git config user.useConfigOnly true
```

> Ne jamais utiliser `--author`. Ne jamais commiter une autre identité : la corriger après push
> exige une réécriture d'historique et une intervention du support GitHub.

## 2. Contrôler le contenu

- **Un brief = un commit** (ou une courte série cohérente). Ne pas mélanger deux briefs.
- Relire `git diff --staged`. Ne rien commiter qui relève des interdits §8 : adresse
  électronique de joueur, nom civil, jeton, clé privée. La seule adresse admise est
  `ethoril@gmail.com`, déjà publique.
- Le diff ne doit contenir que la correction — pas de reformatage parasite (§2).

## 3. Rédiger le message

Format conventionnel, en français, référence du constat d'audit entre parenthèses quand elle
existe. Types observés dans l'historique : `fix`, `feat`, `refactor`, `chore`, `docs`, `ci`,
`security`, `release`, `merge`.

```
{type}({scope}): {description à l'impératif, minuscule, sans point final} ({réf})
```

Exemples réels du dépôt :

```
refactor(doodle): sortir la mise en forme du JavaScript (I4)
security(csp): retirer unsafe-inline et elaguer les origines (M3)
fix(pwa): page hors-ligne, pre-cache elargi et version liee (N8, N5)
```

## 4. Ne pas déployer

`deploy.ps1` pousse directement sur `master`, donc en production (§10). S'arrêter au commit ;
ne pas pousser ni déployer sans demande explicite. Ne jamais `--amend` ni réécrire un commit
déjà poussé.

## 5. Vérifier après coup

```bash
git log -1 --format='%an <%ae> | %cn <%ce>'
```

Toute valeur autre que `Ethoril <ethoril@users.noreply.github.com>` des deux côtés est à
corriger **avant** de pousser.

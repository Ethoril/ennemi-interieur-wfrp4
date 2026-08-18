---
name: nouveau-brief
description: Crée un brief de correction dans docs/briefs/ au format maison — en-tête, objectif, fichiers concernés, détail des modifications, message de commit et checklist de vérification manuelle. Utiliser pour ouvrir un nouveau chantier issu de l'audit.
disable-model-invocation: true
---

# Nouveau brief

Génère un fichier `docs/briefs/L{lot}-{nn}-{slug}.md` conforme à `docs/briefs/00-CONVENTIONS.md`
et au style des briefs existants. `00-CONVENTIONS.md` prévaut toujours ; ne pas y déroger.

## Avant d'écrire

1. Demander (si non fourni) : le **lot** (`L1`, `L2`, …), le **numéro** (`nn` à deux chiffres,
   suite du lot), l'**objet** en une phrase, et la **référence du constat d'audit** (ex. `I4`,
   `M5`, `N3`) à porter entre parenthèses dans le titre de commit.
2. Regarder les briefs voisins dans `docs/briefs/` pour reprendre le niveau de détail et le ton.
   Le dépôt est la source de vérité : citer fichier + fonction + ligne, ne pas recopier le code.

## Squelette à produire

```markdown
# {Lot}-{nn} — {Objet}

**Constat** : {réf} — {sévérité éventuelle}
**Fichiers** : {liste des fichiers concernés}
**Dépendances** : {aucune, ou « {autre brief} avant celui-ci »}
**Estimation** : {durée}

## Objectif

{Un paragraphe : le problème, et l'état visé une fois le brief traité.}

## Modifications

{Par fichier, ce qu'il faut changer — fichier, fonction, ligne. Rappeler les règles de
00-CONVENTIONS.md qui s'appliquent : échappement esc() (§3), jetons CSS (§5), pas de reformatage
hors correction (§2). Ne pas recopier le code existant.}

## Ce qu'il ne faut PAS faire

{Les écarts tentants mais interdits, façon les autres briefs.}

## Vérification

{Checklist manuelle — il n'y a pas de framework de test (§7). Reprendre systématiquement :}
- [ ] Console du navigateur vide (aucune erreur, aucune violation de CSP).
- [ ] Les deux thèmes (sombre + parchemin) s'affichent correctement sur les pages touchées.
- [ ] Rendu mobile 375 px, menu burger fonctionnel.
- [ ] Service worker : cache vidé avant de conclure.
- [ ] {points spécifiques au brief}

## Commit

Format conventionnel FR, un brief = un commit, référence du constat entre parenthèses :

    {type}({scope}): {description} ({réf})
```

## Après écriture

- Ne pas bumper la version : un brief individuel ne touche ni `APP_VERSION` ni le CHANGELOG (§6,
  voir le skill `/livraison`).
- Proposer d'ajouter la ligne du brief au tableau de lot dans `docs/briefs/README.md`.

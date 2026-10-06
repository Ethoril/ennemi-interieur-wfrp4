# Briefs — Fiche de personnage mobile

Déclinaison de [`../../FICHE-MOBILE.md`](../../FICHE-MOBILE.md) (cahier des charges) en unités de
travail ordonnées. Un brief = un commit autonome sur la branche `feat/fiche-mobile`.

> **Lire avant toute intervention :**
> 1. [`../00-CONVENTIONS.md`](../00-CONVENTIONS.md) — gagne en cas de contradiction ;
> 2. [`../../FICHE-MOBILE.md`](../../FICHE-MOBILE.md) — le quoi ;
> 3. [`CARTE-TECHNIQUE.md`](CARTE-TECHNIQUE.md) — le où (chemins, fonctions, pièges).
>
> Maquettes de référence : `.claude/design-fiche-mobile/project/*.dc.html` (non versionnées,
> HTML lisible ; les couleurs y sont en dur, le code réel utilise les variables de `css/base.css`).

## Principes d'exécution

1. Traiter les briefs dans l'ordre. Chacun laisse `npm run check` et `npm run lint` verts.
2. **Le bureau ne change pas**, sauf le verrouillage nom/race (F-01). Ne pas refactorer
   `js/fiche.js` : il n'est pas importable depuis le mobile (couplé au DOM) ; les calculs dont le
   mobile a besoin sont réécrits en modules purs, testés.
3. **Référentiels de compétences (v2.30–2.31, 5 octobre)** : les compétences sont regroupées en
   formes reliées avec un nom principal. Le mobile affiche toujours
   `primarySkillLabel(engine.skillResolver, nomStocké)` (`js/catalogue/skill-forms.js`) et
   construit son moteur avec `createPublishedCatalogueEngine`, alimenté par le catalogue vivant
   (`repository.subscribePublicCatalogue`) avec repli sur `js/catalogue/referentiel-public.json`.
   Les achats envoient `engine.catalogVersion`. Jamais de libellé brut affiché, jamais de
   résolution maison.
4. **Précache** : tout nouveau fichier importé (statiquement ou dynamiquement) depuis
   `js/mobile/app.js`, et `css/mobile-fiche.css`, est ajouté à `ASSETS_LOCAUX` de `sw.js` **dans le
   brief qui le crée** (test « précache fermé » de `tools/m7-01-release.test.mjs`). Pas de
   changement de version avant F-08.
5. **Tests** : nommer les nouveaux tests `tools/fiche-mobile-*.test.mjs` (pris par le glob de
   `npm run check` et par la CI). Logique en fonctions pures testées sans DOM ; vues testées sur un
   faux DOM minimal comme les tests `m3-*` (pas de `classList`, `closest`, `innerHTML`, `matches`).
6. **Sécurité et CSP** : rendu par `createElement`/`textContent` uniquement ; pas d'attribut `style`
   (CSP `style-src 'self'`), CSSOM autorisé ; pas de chaîne `firebase` ni d'URL `https://` dans
   `js/mobile/app.js`, `router.js`, `views/fiche-access.js` (test m3-01) — les SDK Firebase passent
   par un module chargé dynamiquement.
7. Si `js/fiche/*.js` synchronisé vers `functions/` est modifié : `node tools/sync-fiche-domain.mjs`
   et committer les copies. Éviter autant que possible : créer de nouveaux modules plutôt.
8. Commits au format du dépôt, terminés par la ligne `Co-Authored-By` fournie par la session.

## Ordre

| Brief | Objet | Dépend de |
|---|---|---|
| [F-01](F-01-verrouillage-nom-race.md) | Nom et race réservés au MJ (serveur + bureau) | — |
| [F-02](F-02-socle-route-onglets.md) | Route, données, en-tête, onglets, menu ⋯, fixture QA | F-01 |
| [F-03](F-03-principal.md) | Onglet Principal et stats dérivées | F-02 |
| [F-04](F-04-volet-achat.md) | Feuille basse et achat d'avances (caractéristiques, compétences, talents) | F-03 |
| [F-05](F-05-aptitudes.md) | Onglet Aptitudes | F-04 |
| [F-06](F-06-carriere.md) | Onglet Carrière | F-04 |
| [F-07](F-07-journal-export.md) | Onglet Journal, possessions, export / import | F-02 |
| [F-08](F-08-cloture.md) | Clôture : thèmes, accessibilité, version, livraison | tous |

Livraison unique en **v2.32.0** (F-08). Les fonctions Firebase sont redéployées en même temps
(F-01 modifie `functions/src/fiche/service.mjs`).

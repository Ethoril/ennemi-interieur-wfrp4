# L2-16 — Calendrier impérial calé sur la date du jour

> **Lire d'abord [`00-CONVENTIONS.md`](00-CONVENTIONS.md).**

|  |  |
|---|---|
| **Lot** | 2 — qualité (v2.14.0) |
| **Origine** | Demande du 11 août 2026, hors audit |
| **Estimation** | 1 h 30 |
| **Fichiers** | `js/calendar.js`, `index.html` |
| **Dépend de** | — |
| **À traiter avant** | `L2-15` (clôture du lot) |

---

## Pourquoi

**Le calendrier impérial de l'accueil affiche la même date depuis sa mise en ligne :
« Hexennacht, jour de fête, An 2512 C.I. »** — le premier jour du calendrier. Il n'a jamais
avancé d'un jour.

Le mécanisme du défaut, constaté le 11 août 2026 :

- le document `campagne/state` **n'a jamais été créé** dans Firestore ;
- sa lecture est refusée aux visiteurs non connectés (`PERMISSION_DENIED`), et l'appel
  `onSnapshot` de `js/calendar.js` **n'a pas de callback d'erreur** : l'échec est silencieux ;
- `updateCalendarUI()` n'est appelé, dans ce chemin, que si le document existe ;
- mais le widget s'affiche quand même, parce que `watchAuth()` se déclenche au chargement même
  sans utilisateur, appelle `updateAdminControlsVisibility()`, qui appelle `updateCalendarUI()` ;
- avec `currentDay = 1`, la valeur par défaut du module.

Les boutons ±1 jour et ±1 semaine du MJ ne peuvent pas fonctionner non plus, faute de document
et de droit d'écriture.

**Décision : le calendrier devient une fonction pure de la date du jour.** Il ne suit plus la
chronologie de la campagne — c'est un ornement, pas un outil de jeu. Cela supprime d'un coup le
document Firestore, la règle de sécurité, l'écoute temps réel, les contrôles d'administration et
les écritures qui échouent.

---

## À faire

### 1. La correspondance date réelle → date impériale

Deux règles, et rien d'autre.

**L'année** suit l'année civile, décalée de 486 ans : 2026 donne 2512, 2027 donne 2513.

**Le jour de l'année** est mis à l'échelle de 365 (ou 366) vers 400, par interpolation linéaire
des extrémités :

```js
// Le calendrier impérial compte 400 jours, l'année civile 365 ou 366. On étire
// linéairement, de sorte que le 1er janvier tombe sur le jour 1 et le 31 décembre
// sur le jour 400. Conséquence assumée : environ un jour impérial sur dix est
// sauté, la progression n'est donc pas d'exactement un jour par jour.
const DECALAGE_ANNEES = 486;   // 2026 → 2512
const JOURS_IMPERIAUX = 400;

function dateImperiale(maintenant = new Date()) {
    const annee = maintenant.getFullYear();

    // Arithmétique en UTC, et non en heure locale : soustraire deux dates locales
    // séparées par un changement d'heure fait perdre ou gagner une heure, ce qui
    // décale le jour de l'année entre minuit et 1 h du matin pendant tout l'été.
    // Date.UTC ignore les fuseaux et les heures d'été.
    const jourCivil = Math.round(
        (Date.UTC(annee, maintenant.getMonth(), maintenant.getDate())
         - Date.UTC(annee, 0, 1)) / 86400000
    ) + 1;                                                    // 1..365/366
    const joursAnnee = Math.round(
        (Date.UTC(annee + 1, 0, 1) - Date.UTC(annee, 0, 1)) / 86400000
    );                                                        // 365 ou 366

    const jourImperial = 1 + Math.floor(
        (jourCivil - 1) * (JOURS_IMPERIAUX - 1) / (joursAnnee - 1)
    );

    const anneeImperiale = annee + DECALAGE_ANNEES;
    // globalDay conserve la sémantique attendue par getWeekday() et
    // getMorrsliebPhase() : un compteur continu depuis le jour 1 de l'an 2512.
    const globalDay = (anneeImperiale - 2512) * JOURS_IMPERIAUX + jourImperial;

    return { anneeImperiale, jourImperial, globalDay };
}
```

Valeurs de contrôle, déjà vérifiées :

| Date réelle | Jour impérial | Affichage attendu |
|---|---|---|
| 1ᵉʳ janvier | 1 | Hexennacht, jour de fête |
| 11 août 2026, **à n'importe quelle heure** | 244 | 11 Erntezeit, An 2512 C.I. |
| 31 décembre | 400 | 33 Vorhexen |
| 29 février 2028 (bissextile) | 65 | 32 Nachexen, An 2514 C.I. |

**Cas de non-régression à ne pas perdre** : `new Date(2026, 7, 11, 0, 30)` doit donner **244**,
comme `new Date(2026, 7, 11, 14, 0)`. Une première version de ce brief utilisait une
soustraction de dates locales et renvoyait 243 pour le premier — l'heure d'été fait perdre un
jour entre minuit et 1 h, pendant les sept mois où elle s'applique. C'est ce que l'arithmétique
UTC corrige.

Les 12 mois **et** les 6 jours de fête sont tous atteints au cours d'une année, y compris
Mondstille et Vorhexen. Vérifié sur les 365 jours, et sur une année bissextile.

### 2. Ce qui disparaît de `js/calendar.js`

- **Les trois imports Firebase** en tête de fichier (`db`, `watchAuth`, et les fonctions
  Firestore). Le module ne doit plus rien importer d'autre que ses propres constantes.
- `let isAdmin` et toute la logique d'administration : `adjustDay()`,
  `updateAdminControlsVisibility()`, l'appel à `watchAuth()`, et le bloc
  `<div class="calendar-controls" id="calendar-admin-controls">` du gabarit HTML, avec ses
  quatre boutons et leurs écouteurs.
- `let currentDay = 1` : remplacé par le résultat de `dateImperiale()`.
- L'appel `onSnapshot` et les `setDoc` / `updateDoc` de repli.

### 3. Ce qui reste inchangé

Ne pas toucher à ces quatre fonctions, elles sont correctes :

- `getImperialDateDetails(dayOfYear)` — découpage en mois et jours de fête ;
- `getWeekday(globalDay, details)` — les 8 jours de la semaine impériale, festivals exclus ;
- `getMannsliebPhase(dayOfYear)` — **cycle WFRP de 25 jours conservé**, décision du
  11 août 2026 : on ne cale pas Mannslieb sur la vraie Lune, on reste fidèle aux règles du jeu ;
- `getMorrsliebPhase(globalDay, isFestival)` — cycle chaotique déterministe.

Elles fonctionnent telles quelles dès lors que `globalDay` garde la sémantique définie
ci-dessus.

### 4. Rafraîchissement à minuit

Le site peut rester ouvert d'un jour sur l'autre. Programmer un recalcul au prochain minuit
plutôt que laisser une date périmée à l'écran :

```js
function programmerMinuit() {
    const maintenant = new Date();
    const minuit = new Date(maintenant);
    minuit.setHours(24, 0, 5, 0);          // 5 s après minuit, marge d'arrondi
    setTimeout(() => { updateCalendarUI(); programmerMinuit(); },
               minuit - maintenant);
}
```

### 5. `index.html`

La section n'a plus de dépendance asynchrone : elle peut être visible d'emblée.

```html
<!-- avant -->
<section class="section-calendar fade-in" id="imperial-calendar-section" style="display: none;">
<!-- après -->
<section class="section-calendar fade-in" id="imperial-calendar-section">
```

Retirer en conséquence le `container.style.display = ''` de `init()`.

Attention : la scène 3D de l'accueil calcule ses ancres de défilement sur la hauteur réelle de
la page, et un `ResizeObserver` les recalcule quand elle change. Une section désormais visible
dès le premier rendu **améliore** cette situation — mais le vérifier.

---

## Ne pas faire

- **Ne pas conserver `campagne/state` « au cas où ».** Le document n'existe pas, plus rien ne le
  lit après ce brief. Le laisser dans le code entretiendrait la confusion.
- **Ne pas caler Mannslieb sur la vraie Lune.** Évalué et écarté : on garde le cycle de 25 jours
  du jeu.
- **Ne pas chercher à faire avancer le jour impérial exactement d'un par jour.** C'est
  incompatible avec une année de 400 jours calée sur l'année civile, et les trois options ont été
  pesées. Conséquence acceptée : le jour de la semaine impérial saute parfois d'un cran
  supplémentaire, environ une fois sur dix. **Ne pas le « corriger ».**
- **Ne pas toucher aux quatre fonctions de calcul** listées au point 3.
- **Ne pas supprimer `js/auth.js` ni `js/firebase-init.js`** : ils servent aux autres pages. Seul
  `calendar.js` cesse de les importer.

---

## Impact sur les autres briefs

- **`L1-04`** : la règle `match /campagne/state` devient inutile et doit être retirée du fichier
  de règles. Celle de `campagne/acces` reste, elle sert aux fiches.
- **`L2-12`** : rien à changer, `calendar.js` reste dans la liste de pré-cache.
- **`L2-15`** : ajouter une rubrique Accueil à l'entrée de CHANGELOG.

---

## Vérification

- [ ] L'accueil affiche la date impériale correspondant à aujourd'hui — comparer à la table de
      contrôle du point 1.
- [ ] Modifier temporairement la date du système (ou forcer une date dans `dateImperiale()`) et
      vérifier : 1ᵉʳ janvier donne Hexennacht, 31 décembre donne 33 Vorhexen, le 29 février d'une
      année bissextile ne casse rien.
- [ ] **Insensibilité à l'heure d'été** : `dateImperiale(new Date(2026, 7, 11, 0, 30))` et
      `dateImperiale(new Date(2026, 7, 11, 14, 0))` renvoient le **même** jour impérial, 244.
      Tester aussi une date en heure d'hiver (15 janvier 00 h 30) et le lendemain d'un changement
      d'heure (fin mars, fin octobre).
- [ ] Les deux lunes s'affichent avec leur phase et leur emoji.
- [ ] Le jour de la semaine s'affiche pour un jour ordinaire, et « Jour de Fête » pour un festival.
- [ ] **Aucun bouton d'administration** n'apparaît, même connecté en MJ.
- [ ] **Onglet Réseau : plus aucune requête Firestore émise depuis l'accueil.** C'est le gain
      principal de ce brief.
- [ ] Console vide, y compris déconnecté — l'erreur silencieuse d'`onSnapshot` a disparu.
- [ ] La scène 3D suit toujours ses cinq chapitres, et la section calendrier ne provoque plus de
      saut de mise en page au chargement.
- [ ] `grep -c "firebase\|watchAuth" js/calendar.js` renvoie `0`.
- [ ] Les deux thèmes, et le rendu à 375 px de large.

---

## Message de commit

```
feat(accueil): calendrier imperial cale sur la date du jour (hors audit)

Le widget affichait "Hexennacht, an 2512" depuis sa mise en ligne : le
document campagne/state n'avait jamais ete cree, sa lecture est refusee
aux visiteurs, et l'onSnapshot correspondant n'a pas de callback
d'erreur. Le widget s'affichait quand meme via watchAuth, avec la valeur
par defaut currentDay = 1.

Le calendrier devient une fonction pure de la date du jour : annee civile
decalee de 486 ans, jour de l'annee etire de 365 vers 400 par
interpolation lineaire. Les 12 mois et les 6 fetes sont tous atteints.

- suppression des trois imports Firebase, de l'ecoute temps reel et des
  controles d'administration
- rafraichissement programme au prochain minuit
- section visible d'emblee, plus de reveal asynchrone
- fonctions de calcul des mois, jours de semaine et lunes inchangees ;
  Mannslieb garde son cycle WFRP de 25 jours
```

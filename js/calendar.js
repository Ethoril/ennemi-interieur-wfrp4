// ── Constants & Calendar Structure ──────────────────────────────────────────
// Le calendrier impérial compte 400 jours, l'année civile 365 ou 366. On étire
// linéairement, de sorte que le 1er janvier tombe sur le jour 1 et le 31 décembre
// sur le jour 400. Conséquence assumée : environ un jour impérial sur dix est
// sauté, la progression n'est donc pas d'exactement un jour par jour.
const DECALAGE_ANNEES = 486;   // 2026 → 2512
const JOURS_IMPERIAUX = 400;

const CALENDAR_STRUCTURE = [
    { type: 'festival', name: 'Hexennacht' },
    { type: 'month', name: 'Nachexen', days: 32 },
    { type: 'month', name: 'Jahrdrung', days: 33 },
    { type: 'festival', name: 'Mitterfruhl' },
    { type: 'month', name: 'Pflugzeit', days: 33 },
    { type: 'month', name: 'Sigmarzeit', days: 33 },
    { type: 'month', name: 'Sommerzeit', days: 33 },
    { type: 'festival', name: 'Sonnstill' },
    { type: 'month', name: 'Vorgeheim', days: 33 },
    { type: 'festival', name: 'Geheimnistag' },
    { type: 'month', name: 'Nachgeheim', days: 32 },
    { type: 'month', name: 'Erntezeit', days: 33 },
    { type: 'festival', name: 'Mittherbst' },
    { type: 'month', name: 'Brauzeit', days: 33 },
    { type: 'month', name: 'Kaldezeit', days: 33 },
    { type: 'month', name: 'Ulriczeit', days: 33 },
    { type: 'festival', name: 'Mondstille' },
    { type: 'month', name: 'Vorhexen', days: 33 },
];

const WEEKDAYS = [
    'Wellentag',
    'Aubentag',
    'Marktag',
    'Backstag',
    'Behahltag',
    'Konistag',
    'Angestag',
    'Festag'
];

const MANNSLIEB_PHASES = [
    "Pleine Lune",
    "Gibbeuse Décroissante",
    "Gibbeuse Décroissante",
    "Gibbeuse Décroissante",
    "Gibbeuse Décroissante",
    "Gibbeuse Décroissante",
    "Dernier Quartier",
    "Dernier Croissant",
    "Dernier Croissant",
    "Dernier Croissant",
    "Dernier Croissant",
    "Dernier Croissant",
    "Nouvelle Lune",
    "Premier Croissant",
    "Premier Croissant",
    "Premier Croissant",
    "Premier Croissant",
    "Premier Croissant",
    "Premier Quartier",
    "Gibbeuse Croissante",
    "Gibbeuse Croissante",
    "Gibbeuse Croissante",
    "Gibbeuse Croissante",
    "Gibbeuse Croissante",
    "Gibbeuse Croissante"
];

const MORRSLIEB_PHASES = [
    "Pleine Lune",
    "Gibbeuse Décroissante",
    "Dernier Quartier",
    "Dernier Croissant",
    "Nouvelle Lune",
    "Premier Croissant",
    "Premier Quartier",
    "Gibbeuse Croissante"
];

const PHASE_EMOJIS = {
    "Pleine Lune": "🌕",
    "Gibbeuse Décroissante": "🌖",
    "Dernier Quartier": "🌗",
    "Dernier Croissant": "🌘",
    "Nouvelle Lune": "🌑",
    "Premier Croissant": "🌒",
    "Premier Quartier": "🌓",
    "Gibbeuse Croissante": "🌔"
};

// ── Helper Logic ────────────────────────────────────────────────────────────
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

function getImperialDateDetails(dayOfYear) {
    let current = 0;
    let festivalsBefore = 0;
    for (const item of CALENDAR_STRUCTURE) {
        if (item.type === 'festival') {
            current += 1;
            if (current === dayOfYear) {
                return {
                    isFestival: true,
                    name: item.name,
                    day: null,
                    month: null,
                    festivalsBefore: festivalsBefore
                };
            }
            festivalsBefore += 1;
        } else {
            if (dayOfYear > current && dayOfYear <= current + item.days) {
                return {
                    isFestival: false,
                    name: null,
                    day: dayOfYear - current,
                    month: item.name,
                    festivalsBefore: festivalsBefore
                };
            }
            current += item.days;
        }
    }
    return null;
}

function getWeekday(globalDay, details) {
    if (details.isFestival) {
        return null;
    }
    const fullYears = Math.floor((globalDay - 1) / 400);
    const festivalsInFullYears = fullYears * 6;
    const totalFestivalsBefore = festivalsInFullYears + details.festivalsBefore;
    const activeWeekdayIndex = (globalDay - 1 - totalFestivalsBefore) % 8;
    return WEEKDAYS[activeWeekdayIndex];
}

function getMannsliebPhase(dayOfYear) {
    const val = (dayOfYear - 1) % 25;
    return MANNSLIEB_PHASES[val];
}

function getMorrsliebPhase(globalDay, isFestival) {
    if (isFestival) {
        return "Pleine Lune";
    }
    // Chaotic deterministic phase
    const seed = Math.sin(globalDay * 78.233) * 43758.5453;
    const index = Math.floor((seed - Math.floor(seed)) * 8);
    return MORRSLIEB_PHASES[index];
}

// ── UI rendering ────────────────────────────────────────────────────────────
function updateCalendarUI() {
    const widget = document.getElementById('imperial-calendar-widget');
    if (!widget) return;

    const { anneeImperiale, jourImperial, globalDay } = dateImperiale();
    const details = getImperialDateDetails(jourImperial);
    if (!details) return;

    const weekday = getWeekday(globalDay, details);
    const mannsliebPhase = getMannsliebPhase(jourImperial);
    const morrsliebPhase = getMorrsliebPhase(globalDay, details.isFestival);

    const mannsliebEmoji = PHASE_EMOJIS[mannsliebPhase];
    const morrsliebEmoji = PHASE_EMOJIS[morrsliebPhase];

    // Build the date HTML
    let dateHtml = '';
    let weekdayHtml = '';
    if (details.isFestival) {
        weekdayHtml = `<div class="calendar-weekday">Jour de Fête</div>`;
        dateHtml = `<div class="calendar-date">${details.name}</div>`;
    } else {
        weekdayHtml = `<div class="calendar-weekday">${weekday}</div>`;
        dateHtml = `<div class="calendar-date">${details.day} ${details.month}</div>`;
    }

    widget.innerHTML = `
        <div class="calendar-header">Calendrier de l'Empire</div>
        ${weekdayHtml}
        <div class="calendar-date-container">
            ${dateHtml}
            <div class="calendar-year">An ${anneeImperiale} C.I.</div>
        </div>
        <div class="calendar-moons">
            <div class="moon-card mannslieb">
                <span class="moon-name">Mannslieb</span>
                <span class="moon-icon" title="${mannsliebPhase}">${mannsliebEmoji}</span>
                <span class="moon-phase">${mannsliebPhase}</span>
            </div>
            <div class="moon-card morrslieb">
                <span class="moon-name">Morrslieb</span>
                <span class="moon-icon" title="${morrsliebPhase}">${morrsliebEmoji}</span>
                <span class="moon-phase">${morrsliebPhase}</span>
            </div>
        </div>
    `;
}

function programmerMinuit() {
    const maintenant = new Date();
    const minuit = new Date(maintenant);
    minuit.setHours(24, 0, 5, 0);          // 5 s après minuit, marge d'arrondi
    setTimeout(() => { updateCalendarUI(); programmerMinuit(); },
               minuit - maintenant);
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
    updateCalendarUI();
    programmerMinuit();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}


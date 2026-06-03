import { db } from './firebase-init.js';
import { watchAuth } from './auth.js';
import { doc, onSnapshot, updateDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Constants & Calendar Structure ──────────────────────────────────────────
const START_YEAR = 2512; // Standard WFRP4 Campaign Year starting point

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

// ── State ───────────────────────────────────────────────────────────────────
let currentDay = 1;
let isAdmin = false;

// ── Helper Logic ────────────────────────────────────────────────────────────
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

    const year = Math.floor((currentDay - 1) / 400) + START_YEAR;
    const dayOfYear = ((currentDay - 1) % 400) + 1;
    const details = getImperialDateDetails(dayOfYear);
    if (!details) return;

    const weekday = getWeekday(currentDay, details);
    const mannsliebPhase = getMannsliebPhase(dayOfYear);
    const morrsliebPhase = getMorrsliebPhase(currentDay, details.isFestival);

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
            <div class="calendar-year">An ${year} C.I.</div>
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
        <div class="calendar-controls" id="calendar-admin-controls" style="display: ${isAdmin ? 'flex' : 'none'};">
            <button class="btn-ctrl" id="btn-sub-week" title="Reculer d'une semaine">-1 Semaine</button>
            <button class="btn-ctrl" id="btn-sub-day" title="Reculer d'un jour">-1 Jour</button>
            <button class="btn-ctrl" id="btn-add-day" title="Avancer d'un jour">+1 Jour</button>
            <button class="btn-ctrl" id="btn-add-week" title="Avancer d'une semaine">+1 Semaine</button>
        </div>
    `;

    // Bind event listeners for admin controls if displayed
    if (isAdmin) {
        document.getElementById('btn-sub-week').addEventListener('click', () => adjustDay(-8));
        document.getElementById('btn-sub-day').addEventListener('click', () => adjustDay(-1));
        document.getElementById('btn-add-day').addEventListener('click', () => adjustDay(1));
        document.getElementById('btn-add-week').addEventListener('click', () => adjustDay(8));
    }
}

async function adjustDay(amount) {
    if (!isAdmin) return;
    const campaignDocRef = doc(db, 'campagne', 'state');
    const newDay = Math.max(1, currentDay + amount);
    try {
        await updateDoc(campaignDocRef, { currentDay: newDay });
    } catch (e) {
        console.error("Error updating campaign currentDay:", e);
        alert("Erreur de mise à jour du calendrier: " + e.message);
    }
}

function updateAdminControlsVisibility() {
    const controls = document.getElementById('calendar-admin-controls');
    if (controls) {
        controls.style.display = isAdmin ? 'flex' : 'none';
    }
    // Re-render to bind/unbind event listeners properly depending on auth status
    updateCalendarUI();
}

// ── Init ─────────────────────────────────────────────────────────────────────
function init() {
    const container = document.getElementById('imperial-calendar-section');
    if (container) {
        container.style.display = '';
    }

    const campaignDocRef = doc(db, 'campagne', 'state');
    
    // Realtime listener
    onSnapshot(campaignDocRef, (snapshot) => {
        if (!snapshot.exists()) {
            setDoc(campaignDocRef, { currentDay: 1 })
                .catch(err => console.error("Error initializing currentDay:", err));
        } else {
            const data = snapshot.data();
            if (data && typeof data.currentDay === 'number') {
                currentDay = data.currentDay;
                updateCalendarUI();
            } else {
                updateDoc(campaignDocRef, { currentDay: 1 })
                    .catch(err => console.error("Error updating currentDay:", err));
            }
        }
    });

    watchAuth((user, isUserAdmin) => {
        isAdmin = isUserAdmin;
        updateAdminControlsVisibility();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

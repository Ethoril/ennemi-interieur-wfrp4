'use strict';

const CARACS = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];

const CARAC_LABELS = {
    cc: 'CC', ct: 'CT', f: 'F', e: 'E',
    i: 'I', ag: 'Ag', dex: 'Dex', int: 'Int', fm: 'FM', soc: 'Soc',
};

const BASIC_SKILLS = [
    { nom: 'Art',                       carac: 'dex' },
    { nom: 'Athlétisme',                carac: 'ag'  },
    { nom: 'Baratin',                   carac: 'soc' },
    { nom: 'Charme',                    carac: 'soc' },
    { nom: 'Charme Animal',             carac: 'fm'  },
    { nom: 'Commandement',              carac: 'soc' },
    { nom: 'Commerce',                  carac: 'int' },
    { nom: 'Conduite',                  carac: 'ag'  },
    { nom: 'Corps à Corps (Ordinaire)', carac: 'cc'  },
    { nom: 'Crochetage',                carac: 'dex' },
    { nom: 'Discrétion',                carac: 'ag'  },
    { nom: 'Endurance',                 carac: 'e'   },
    { nom: 'Équitation',                carac: 'ag'  },
    { nom: 'Escamotage',                carac: 'dex' },
    { nom: 'Esquive',                   carac: 'ag'  },
    { nom: 'Expression Artistique',     carac: 'soc' },
    { nom: 'Intimidation',              carac: 'f'   },
    { nom: 'Intuition',                 carac: 'i'   },
    { nom: 'Jeu',                       carac: 'int' },
    { nom: 'Langue (Reikspiel)',        carac: 'int' },
    { nom: 'Meneur',                    carac: 'soc' },
    { nom: 'Nage',                      carac: 'ag'  },
    { nom: 'Perception',                carac: 'i'   },
    { nom: 'Persuasion',                carac: 'soc' },
    { nom: 'Psychologie',               carac: 'fm'  },
    { nom: 'Sang-Froid',                carac: 'fm'  },
    { nom: 'Soins',                     carac: 'int' },
    { nom: 'Survie',                    carac: 'int' },
    { nom: 'Tir (Ordinaire)',           carac: 'ct'  },
];

const MOUVEMENT = { humain: 4, nain: 3, elfe: 5, halfling: 3 };

const STORAGE_KEY = 'wfrp4-fiche-test';

const state = {
    carac: Object.fromEntries(CARACS.map(c => [c, { base: 0, adv: 0 }])),
    skillsBasic:    {},  // nom → avances
    skillsAdvanced: [],  // [{ nom, carac, adv }]
    talentsAcquired:  [],
    talentsAvailable: [],
};

// ── Helpers ──────────────────────────────────────────

function safeId(str) { return str.replace(/[^a-zA-Z0-9]/g, '_'); }

function getTotal(c) {
    return (state.carac[c]?.base ?? 0) + (state.carac[c]?.adv ?? 0);
}

function getBonus(c) { return Math.floor(getTotal(c) / 10); }

function computeBlessures() {
    return getBonus('f') + 2 * getBonus('e') + getBonus('fm');
}

// ── Recalcul global ───────────────────────────────────

function recalc() {
    // Caractéristiques — totaux
    CARACS.forEach(c => {
        const el = document.getElementById(`total-${c}`);
        if (el) el.textContent = getTotal(c);
    });

    // Stats dérivées
    const race = document.getElementById('race')?.value || 'humain';
    setText('mouvement', MOUVEMENT[race] ?? 4);
    setText('blessures-max', computeBlessures());

    // XP
    const xpTotal = +getVal('xp-total');
    const xpSpent = +getVal('xp-spent');
    setText('xp-dispo', xpTotal - xpSpent);

    // Compétences de base — totaux
    BASIC_SKILLS.forEach(sk => {
        const sid = safeId(sk.nom);
        const caracVal = getTotal(sk.carac);
        const adv = state.skillsBasic[sk.nom] ?? 0;
        setText(`sk-carac-${sid}`, caracVal);
        setText(`sk-total-${sid}`, caracVal + adv);
    });

    // Compétences avancées — totaux
    state.skillsAdvanced.forEach((sk, i) => {
        const caracVal = getTotal(sk.carac);
        setText(`adv-carac-val-${i}`, caracVal);
        setText(`adv-total-${i}`, caracVal + (sk.adv ?? 0));
    });

    save();
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function getVal(id) {
    return document.getElementById(id)?.value ?? '';
}

// ── Construction des tableaux ─────────────────────────

function buildBasicSkills() {
    const tbody = document.getElementById('tbody-skills-basic');
    if (!tbody) return;

    tbody.innerHTML = BASIC_SKILLS.map(sk => {
        const sid = safeId(sk.nom);
        const adv = state.skillsBasic[sk.nom] ?? 0;
        return `<tr>
            <td class="sk-nom">${sk.nom}</td>
            <td class="sk-carac-lbl">${CARAC_LABELS[sk.carac]}</td>
            <td class="sk-carac-val" id="sk-carac-${sid}">0</td>
            <td><input class="sk-adv" type="number" data-skill="${sk.nom}" min="0" max="30" value="${adv}"></td>
            <td class="sk-total" id="sk-total-${sid}">0</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.sk-adv').forEach(inp => {
        inp.addEventListener('input', () => {
            state.skillsBasic[inp.dataset.skill] = +inp.value || 0;
            recalc();
        });
    });
}

function buildAdvancedSkills() {
    renderAdvancedSkills();
}

function renderAdvancedSkills() {
    const tbody = document.getElementById('tbody-skills-advanced');
    if (!tbody) return;

    tbody.innerHTML = state.skillsAdvanced.length === 0
        ? `<tr class="empty-row"><td colspan="5">Aucune compétence avancée</td></tr>`
        : state.skillsAdvanced.map((sk, i) => `
            <tr>
                <td><input class="sk-nom-input" type="text" data-idx="${i}" data-field="nom" value="${sk.nom}" placeholder="Nom"></td>
                <td>
                    <select class="sk-carac-sel" data-idx="${i}">
                        ${CARACS.map(c => `<option value="${c}" ${sk.carac === c ? 'selected' : ''}>${CARAC_LABELS[c]}</option>`).join('')}
                    </select>
                </td>
                <td class="sk-carac-val" id="adv-carac-val-${i}">0</td>
                <td><input class="sk-adv sk-adv-adv" type="number" data-idx="${i}" min="0" max="30" value="${sk.adv ?? 0}"></td>
                <td class="sk-total" id="adv-total-${i}">0</td>
                <td><button class="btn-rm-adv-skill" data-idx="${i}" title="Supprimer">×</button></td>
            </tr>`
        ).join('');

    tbody.querySelectorAll('.sk-nom-input').forEach(inp => {
        inp.addEventListener('input', () => {
            state.skillsAdvanced[+inp.dataset.idx].nom = inp.value;
            save();
        });
    });
    tbody.querySelectorAll('.sk-carac-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            state.skillsAdvanced[+sel.dataset.idx].carac = sel.value;
            recalc();
        });
    });
    tbody.querySelectorAll('.sk-adv-adv').forEach(inp => {
        inp.addEventListener('input', () => {
            state.skillsAdvanced[+inp.dataset.idx].adv = +inp.value || 0;
            recalc();
        });
    });
    tbody.querySelectorAll('.btn-rm-adv-skill').forEach(btn => {
        btn.addEventListener('click', () => {
            state.skillsAdvanced.splice(+btn.dataset.idx, 1);
            renderAdvancedSkills();
            recalc();
        });
    });
}

// ── Persistence ───────────────────────────────────────

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        nom:      getVal('nom'),
        race:     getVal('race'),
        carriere: getVal('carriere'),
        rang:     getVal('rang'),
        xpTotal:  getVal('xp-total'),
        xpSpent:  getVal('xp-spent'),
        carac:    state.carac,
        skillsBasic:    state.skillsBasic,
        skillsAdvanced: state.skillsAdvanced,
        blessuresActuelles: getVal('blessures-act'),
        resilience:    getVal('resilience'),
        determination: getVal('determination'),
        fortune:    getVal('fortune'),
        destin:     getVal('destin'),
        corruption: getVal('corruption'),
        possessions: getVal('possessions'),
    }));
}

function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);

    setField('nom',       d.nom);
    setField('race',      d.race);
    setField('carriere',  d.carriere);
    setField('rang',      d.rang);
    setField('xp-total',  d.xpTotal);
    setField('xp-spent',  d.xpSpent);
    setField('blessures-act', d.blessuresActuelles);
    setField('resilience',    d.resilience);
    setField('determination', d.determination);
    setField('fortune',   d.fortune);
    setField('destin',    d.destin);
    setField('corruption', d.corruption);
    setField('possessions', d.possessions);

    if (d.carac) {
        Object.assign(state.carac, d.carac);
        CARACS.forEach(c => {
            setField(`base-${c}`, state.carac[c]?.base ?? 0);
            setField(`adv-${c}`,  state.carac[c]?.adv  ?? 0);
        });
    }
    if (d.skillsBasic)    Object.assign(state.skillsBasic, d.skillsBasic);
    if (d.skillsAdvanced) state.skillsAdvanced.push(...d.skillsAdvanced);
}

function setField(id, val) {
    if (val == null) return;
    const el = document.getElementById(id);
    if (el) el.value = val;
}

// ── Listeners ─────────────────────────────────────────

function bindListeners() {
    // Caractéristiques
    CARACS.forEach(c => {
        document.getElementById(`base-${c}`)?.addEventListener('input', e => {
            state.carac[c].base = +e.target.value || 0;
            recalc();
        });
        document.getElementById(`adv-${c}`)?.addEventListener('input', e => {
            state.carac[c].adv = +e.target.value || 0;
            recalc();
        });
    });

    // Infos générales
    ['nom', 'carriere', 'rang', 'race', 'xp-total', 'xp-spent',
     'blessures-act', 'resilience', 'determination',
     'fortune', 'destin', 'corruption', 'possessions'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            if (id === 'race' || id === 'xp-total' || id === 'xp-spent') recalc();
            else save();
        });
    });

    // Ajouter compétence avancée
    document.getElementById('btn-add-adv-skill')?.addEventListener('click', () => {
        state.skillsAdvanced.push({ nom: '', carac: 'int', adv: 0 });
        renderAdvancedSkills();
        recalc();
    });
}

// ── Init ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    buildBasicSkills();
    load();
    buildAdvancedSkills();
    bindListeners();
    recalc();
});

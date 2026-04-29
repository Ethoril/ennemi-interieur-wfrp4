'use strict';

// ── Constantes ────────────────────────────────────────

const CARACS = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const CARAC_LABELS = { cc:'CC', ct:'CT', f:'F', e:'E', i:'I', ag:'Ag', dex:'Dex', int:'Int', fm:'FM', soc:'Soc' };
const MOUVEMENT = { humain:4, nain:3, elfe:5, halfling:3 };
const STORAGE_KEY = 'wfrp4-fiche-test';

const XP_TYPES = ['Caractéristique','Compétence','Talent','Sort','Prière','Miracle','Autre'];

const VENTS = ['Aqshy','Azyr','Chamon','Ghur','Ghyran','Hysh','Shyish','Ulgu','Magie Commune','Autre'];

// Compétences de base affichées sur la fiche (une ligne par groupe, Corps à corps avec "(Base)").
// Les spécialisations de ces groupes se créent dans la section Compétences avancées.
const BASIC_SKILLS = [
    { nom:'Art',                     carac:'dex' },
    { nom:'Athlétisme',              carac:'ag'  },
    { nom:'Calme',                   carac:'fm'  },
    { nom:'Charme',                  carac:'soc' },
    { nom:'Chevaucher',              carac:'ag'  },
    { nom:'Commandement',            carac:'soc' },
    { nom:'Conduite',                carac:'ag'  },
    { nom:'Corps à corps (Base)',    carac:'cc'  },
    { nom:'Discrétion',              carac:'ag'  },
    { nom:'Divertissement',          carac:'soc' },
    { nom:'Emprise sur les animaux', carac:'fm'  },
    { nom:'Escalade',                carac:'f'   },
    { nom:'Esquive',                 carac:'ag'  },
    { nom:'Intimidation',            carac:'f'   },
    { nom:'Intuition',               carac:'i'   },
    { nom:'Marchandage',             carac:'soc' },
    { nom:'Orientation',             carac:'i'   },
    { nom:'Pari',                    carac:'int' },
    { nom:'Perception',              carac:'i'   },
    { nom:'Ragot',                   carac:'soc' },
    { nom:'Ramer',                   carac:'f'   },
    { nom:'Résistance',              carac:'e'   },
    { nom:"Résistance à l'alcool",   carac:'e'   },
    { nom:'Subornation',             carac:'soc' },
    { nom:'Survie en extérieur',     carac:'int' },
];

// ── Moteur XP ─────────────────────────────────────────

const CARAC_XP_BANDS    = [25, 30, 40, 50, 70, 90];
const SKILL_XP_BANDS    = [5,  10, 15, 20, 25, 30];   // compétences de base
const SKILL_XP_BANDS_ADV = [10, 15, 20, 25, 30, 35];  // compétences avancées

function xpBandCost(bands, currentAdv, count, inCareer) {
    let total = 0;
    for (let i = 0; i < count; i++) {
        const band = Math.min(Math.floor((currentAdv + i) / 5), bands.length - 1);
        total += inCareer ? bands[band] : bands[band] * 2;
    }
    return total;
}

// ── Carrière active ────────────────────────────────────

function getActiveCareerData() {
    if (!window.WFRP_CAREERS) return null;
    const name = getVal('carriere').toLowerCase().trim();
    if (!name) return null;
    return WFRP_CAREERS.find(c =>
        c.nom.toLowerCase() === name ||
        c.rangs.some(r => r.titre.toLowerCase() === name)
    );
}

function getActiveRang() {
    return Math.min(4, Math.max(1, +getVal('rang') || 1));
}

function skillBaseNom(fullNom) {
    return fullNom.split('(')[0].trim().toLowerCase();
}

function isSkillInCareer(nom) {
    const career = getActiveCareerData();
    if (!career) return false;
    const rang = getActiveRang();
    const base = skillBaseNom(nom);
    for (let r = 1; r <= rang; r++) {
        const rd = career.rangs.find(x => x.rang === r);
        if (rd?.skills.some(s => skillBaseNom(s) === base)) return true;
    }
    return false;
}

function isCaracInCareer(carac) {
    const career = getActiveCareerData();
    return career ? career.carac.includes(carac) : false;
}

function isTalentInCareer(talentNom) {
    const career = getActiveCareerData();
    if (!career) return false;
    const rang = getActiveRang();
    const nom = talentNom.toLowerCase().trim();
    for (let r = 1; r <= rang; r++) {
        const rd = career.rangs.find(x => x.rang === r);
        if (rd?.talents.some(t => t.toLowerCase() === nom)) return true;
    }
    return false;
}

// ── Formulaire d'achat XP ─────────────────────────────

function showXpForm() {
    const form = document.getElementById('xp-add-form');
    if (!form) return;
    form.style.display = '';
    form.innerHTML = `
        <div class="xp-form-inner">
            <div class="xp-form-row">
                <select id="xf-type">
                    <option value="">— Type d'achat —</option>
                    <option value="carac">Caractéristique</option>
                    <option value="skill-basic">Compétence de base</option>
                    <option value="skill-adv">Compétence avancée</option>
                    <option value="talent">Talent</option>
                </select>
                <span id="xf-target-wrap" class="xf-target-wrap"></span>
                <label class="xf-avances-label">
                    Avances&nbsp;
                    <input type="number" id="xf-avances" min="1" max="30" value="1">
                </label>
                <label class="xf-incareer-label">
                    <input type="checkbox" id="xf-incareer" checked>
                    Dans la carrière
                </label>
            </div>
            <div class="xf-cost-row">
                Coût estimé : <strong id="xf-cost">—</strong> XP
            </div>
            <div class="xf-actions">
                <button class="btn-add" id="xf-validate">✓ Valider et appliquer</button>
                <button class="btn-rm"  id="xf-cancel">Annuler</button>
            </div>
        </div>`;

    document.getElementById('xf-type').addEventListener('change', updateXfTarget);
    document.getElementById('xf-avances').addEventListener('input', computeXfCost);
    document.getElementById('xf-incareer').addEventListener('change', computeXfCost);
    document.getElementById('xf-validate').addEventListener('click', validateXpPurchase);
    document.getElementById('xf-cancel').addEventListener('click', () => { form.style.display = 'none'; });
}

// Retourne les groupes uniques (triés) pour le type donné ('basic' | 'adv' | 'all')
function getSkillGroups(filter) {
    if (!window.WFRP_SKILLS) return [];
    const filtered = filter === 'all' ? WFRP_SKILLS
        : WFRP_SKILLS.filter(s => filter === 'basic' ? s.basic : !s.basic);
    return [...new Set(filtered.map(s => s.group))].sort((a, b) => a.localeCompare(b, 'fr'));
}

// Retourne les spécialisations connues pour un groupe (basic + advanced) + '' si sans-spec
function getSpecsForGroup(group) {
    if (!window.WFRP_SKILLS) return [];
    return WFRP_SKILLS.filter(s => s.group === group && s.spec).map(s => s.spec);
}

// Carac d'un groupe de compétence
function getCaracForGroup(group) {
    if (!window.WFRP_SKILLS) return 'int';
    return WFRP_SKILLS.find(s => s.group === group)?.carac || 'int';
}

// Nom complet sélectionné dans le formulaire XP
function getXfSkillFullNom() {
    const group = document.getElementById('xf-group')?.value || '';
    if (!group) return '';
    const specSel = document.getElementById('xf-spec-sel');
    if (!specSel) return group;
    const specVal = specSel.value;
    if (specVal === '_custom') {
        const custom = document.getElementById('xf-spec-custom')?.value?.trim() || '';
        return custom ? `${group} (${custom})` : group;
    }
    return specVal ? `${group} (${specVal})` : group;
}

// Avances actuelles du skill sélectionné dans le formulaire
function getXfSkillCurrentAdv(fullNom) {
    if (!fullNom) return 0;
    if (BASIC_SKILLS.some(s => s.nom === fullNom)) return state.skillsBasic[fullNom] || 0;
    return state.skillsAdvanced.find(s => s.nom === fullNom)?.adv || 0;
}

function buildXfSpecPicker(group, wrap) {
    const specs = getSpecsForGroup(group);
    if (specs.length === 0) { wrap.innerHTML = ''; return; }

    const specSel = document.createElement('select');
    specSel.id = 'xf-spec-sel';
    specSel.className = 'xf-spec-sel';
    specSel.innerHTML =
        specs.map(s => `<option value="${s}">${s}</option>`).join('') +
        '<option value="_custom">Autre (personnalisé)…</option>';
    wrap.appendChild(specSel);

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.id = 'xf-spec-custom';
    customInput.placeholder = 'Spécialisation…';
    customInput.className = 'xf-spec-input';
    customInput.style.display = 'none';
    wrap.appendChild(customInput);

    const onChange = () => {
        customInput.style.display = specSel.value === '_custom' ? '' : 'none';
        document.getElementById('xf-incareer').checked = isSkillInCareer(getXfSkillFullNom());
        computeXfCost();
    };
    specSel.addEventListener('change', onChange);
    customInput.addEventListener('input', onChange);
}

function updateXfTarget() {
    const type = document.getElementById('xf-type').value;
    const wrap = document.getElementById('xf-target-wrap');
    wrap.innerHTML = '';

    if (type === 'carac') {
        const sel = document.createElement('select');
        sel.id = 'xf-target';
        sel.innerHTML = '<option value="">— Caractéristique —</option>' +
            CARACS.map(c => {
                const adv = state.carac[c].adv || 0;
                return `<option value="${c}">${CARAC_LABELS[c]} (avances: ${adv}, total: ${getCaracTotal(c)})</option>`;
            }).join('');
        wrap.appendChild(sel);
        sel.addEventListener('change', () => {
            document.getElementById('xf-incareer').checked = isCaracInCareer(sel.value);
            computeXfCost();
        });

    } else if (type === 'skill-basic' || type === 'skill-adv') {
        const filter = type === 'skill-basic' ? 'basic' : 'adv';
        const groups = getSkillGroups(filter);

        // Sélecteur de groupe
        const grpSel = document.createElement('select');
        grpSel.id = 'xf-group';
        grpSel.className = 'xf-group-sel';
        grpSel.innerHTML = '<option value="">— Compétence —</option>' +
            groups.map(g => {
                const adv = getXfSkillCurrentAdv(g);
                return `<option value="${g}">${g}${adv ? ` (av. ${adv})` : ''}</option>`;
            }).join('');
        wrap.appendChild(grpSel);

        // Zone du sélecteur de spécialisation
        const specWrap = document.createElement('span');
        specWrap.id = 'xf-spec-wrap';
        specWrap.className = 'xf-target-wrap';
        wrap.appendChild(specWrap);

        grpSel.addEventListener('change', () => {
            specWrap.innerHTML = '';
            buildXfSpecPicker(grpSel.value, specWrap);
            document.getElementById('xf-incareer').checked = isSkillInCareer(getXfSkillFullNom());
            computeXfCost();
        });

    } else if (type === 'talent') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'xf-talent';
        inp.placeholder = 'Nom du talent…';
        inp.className = 'xf-talent-input';
        wrap.appendChild(inp);
        inp.addEventListener('input', () => {
            document.getElementById('xf-incareer').checked = isTalentInCareer(inp.value);
            computeXfCost();
        });
    }
    computeXfCost();
}

function computeXfCost() {
    const type     = document.getElementById('xf-type')?.value || '';
    const avances  = Math.max(1, +document.getElementById('xf-avances')?.value || 1);
    const inCareer = document.getElementById('xf-incareer')?.checked ?? true;
    const costEl   = document.getElementById('xf-cost');
    if (!costEl) return 0;

    let cost = 0;

    if (type === 'carac') {
        const carac = document.getElementById('xf-target')?.value;
        if (carac) cost = xpBandCost(CARAC_XP_BANDS, state.carac[carac].adv || 0, avances, inCareer);

    } else if (type === 'skill-basic' || type === 'skill-adv') {
        const fullNom = getXfSkillFullNom();
        if (fullNom) {
            const bands   = type === 'skill-basic' ? SKILL_XP_BANDS : SKILL_XP_BANDS_ADV;
            const currAdv = getXfSkillCurrentAdv(fullNom);
            cost = xpBandCost(bands, currAdv, avances, inCareer);
        }

    } else if (type === 'talent') {
        cost = inCareer ? 100 : 200;
    }

    costEl.textContent = cost > 0 ? cost : '—';
    return cost;
}

function validateXpPurchase() {
    const type     = document.getElementById('xf-type')?.value || '';
    const avances  = Math.max(1, +document.getElementById('xf-avances')?.value || 1);
    const inCareer = document.getElementById('xf-incareer')?.checked ?? true;
    const cost     = computeXfCost();
    if (!type || cost <= 0) return;

    let achatLabel = '', targetNom = '', targetType = '', targetStorage = '';

    if (type === 'carac') {
        const carac = document.getElementById('xf-target')?.value;
        if (!carac) return;
        state.carac[carac].adv = (state.carac[carac].adv || 0) + avances;
        setVal(`adv-${carac}`, state.carac[carac].adv);
        achatLabel = `${CARAC_LABELS[carac]} +${avances}`;
        targetNom = carac; targetType = 'carac'; targetStorage = 'carac';

    } else if (type === 'skill-basic' || type === 'skill-adv') {
        const fullNom = getXfSkillFullNom();
        if (!fullNom) return;
        const group = document.getElementById('xf-group')?.value || fullNom;
        const carac = getCaracForGroup(group);

        // Corps à corps (Base) et compétences sans spec → skillsBasic si elles y sont
        const inBasicTable = BASIC_SKILLS.some(s => s.nom === fullNom);
        if (inBasicTable) {
            state.skillsBasic[fullNom] = (state.skillsBasic[fullNom] || 0) + avances;
            const inp = document.querySelector(`.sk-adv[data-skill="${CSS.escape(fullNom)}"]`);
            if (inp) inp.value = state.skillsBasic[fullNom];
            targetStorage = 'skillsBasic';
        } else {
            // Spécialisation ou compétence avancée → skillsAdvanced
            let existing = state.skillsAdvanced.find(s => s.nom === fullNom);
            if (!existing) {
                state.skillsAdvanced.push({ nom: fullNom, carac, adv: 0 });
                existing = state.skillsAdvanced[state.skillsAdvanced.length - 1];
            }
            existing.adv = (existing.adv || 0) + avances;
            renderAdvancedSkills();
            targetStorage = 'skillsAdvanced';
        }
        achatLabel = `${fullNom} +${avances}`;
        targetNom = fullNom; targetType = type;

    } else if (type === 'talent') {
        const nom = document.getElementById('xf-talent')?.value?.trim();
        if (!nom) return;
        state.talentsAcq.push({ nom, note: inCareer ? '' : 'hors carrière' });
        renderTalents('acq');
        achatLabel = nom; targetNom = nom; targetType = 'talent'; targetStorage = 'talent';
    }

    state.xpLog.push({
        type:      type === 'carac' ? 'Caractéristique' : type === 'talent' ? 'Talent' : 'Compétence',
        achat:     achatLabel,
        cout:      cost,
        note:      '',
        applied:   true,
        targetNom, targetType, targetStorage,
        avances:   type !== 'talent' ? avances : 1,
    });

    renderXpLog();
    recalc();
    document.getElementById('xp-add-form').style.display = 'none';
}

function revertXpEntry(entry) {
    if (!entry.applied) return;
    const { targetStorage, targetNom, avances } = entry;
    if (targetStorage === 'carac') {
        state.carac[targetNom].adv = Math.max(0, (state.carac[targetNom].adv || 0) - avances);
        setVal(`adv-${targetNom}`, state.carac[targetNom].adv);
    } else if (targetStorage === 'skillsBasic') {
        state.skillsBasic[targetNom] = Math.max(0, (state.skillsBasic[targetNom] || 0) - avances);
        const inp = document.querySelector(`.sk-adv[data-skill="${CSS.escape(targetNom)}"]`);
        if (inp) inp.value = state.skillsBasic[targetNom];
    } else if (targetStorage === 'skillsAdvanced') {
        const sk = state.skillsAdvanced.find(s => s.nom === targetNom);
        if (sk) { sk.adv = Math.max(0, (sk.adv || 0) - avances); renderAdvancedSkills(); }
    } else if (targetStorage === 'talent') {
        const idx = state.talentsAcq.map(t => t.nom).lastIndexOf(targetNom);
        if (idx >= 0) { state.talentsAcq.splice(idx, 1); renderTalents('acq'); }
    } else {
        // Rétrocompat : anciennes entrées sans targetStorage
        const { targetType } = entry;
        if (targetType === 'carac') {
            state.carac[targetNom].adv = Math.max(0, (state.carac[targetNom].adv || 0) - avances);
            setVal(`adv-${targetNom}`, state.carac[targetNom].adv);
        } else if (targetType === 'skill-basic') {
            state.skillsBasic[targetNom] = Math.max(0, (state.skillsBasic[targetNom] || 0) - avances);
        } else if (targetType === 'skill-adv') {
            const sk = state.skillsAdvanced.find(s => s.nom === targetNom);
            if (sk) { sk.adv = Math.max(0, (sk.adv || 0) - avances); renderAdvancedSkills(); }
        } else if (targetType === 'talent') {
            const idx = state.talentsAcq.map(t => t.nom).lastIndexOf(targetNom);
            if (idx >= 0) { state.talentsAcq.splice(idx, 1); renderTalents('acq'); }
        }
    }
}

// ── État ──────────────────────────────────────────────

const state = {
    carac:          Object.fromEntries(CARACS.map(c => [c, { base:0, adv:0 }])),
    skillsBasic:    {},
    skillsAdvanced: [],
    careers:        [],
    talentsAcq:     [],
    talentsAvail:   [],
    sorts:          [],
    prieres:        [],
    xpLog:          [],
    optVisible:     { 'section-sorts': false, 'section-prieres': false },
};

// ── Helpers ───────────────────────────────────────────

const sid    = s => s.replace(/[^a-zA-Z0-9]/g, '_');
const getVal = id => document.getElementById(id)?.value ?? '';
const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
const setVal  = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };

function getCaracTotal(c) { return (state.carac[c]?.base ?? 0) + (state.carac[c]?.adv ?? 0); }
function getBonus(c)      { return Math.floor(getCaracTotal(c) / 10); }

// ── Recalcul ──────────────────────────────────────────

function recalc() {
    // Totaux carac
    CARACS.forEach(c => setText(`total-${c}`, getCaracTotal(c)));

    // Dérivées
    const race = document.getElementById('race')?.value || 'humain';
    setText('mouvement', MOUVEMENT[race] ?? 4);
    setText('blessures-max', getBonus('f') + 2 * getBonus('e') + getBonus('fm'));

    // XP — dépensé = somme du journal
    const xpSpent = state.xpLog.reduce((s, e) => s + (+e.cout || 0), 0);
    const xpTotal = +getVal('xp-total') || 0;
    setText('xp-spent-display', xpSpent);
    setText('xp-dispo', xpTotal - xpSpent);
    setText('xp-log-total', xpSpent);

    // Compétences de base
    BASIC_SKILLS.forEach(sk => {
        const cval = getCaracTotal(sk.carac);
        const adv  = state.skillsBasic[sk.nom] ?? 0;
        setText(`sk-carac-${sid(sk.nom)}`, cval);
        setText(`sk-total-${sid(sk.nom)}`, cval + adv);
    });

    // Compétences avancées
    state.skillsAdvanced.forEach((sk, i) => {
        const cval = getCaracTotal(sk.carac);
        setText(`adv-carac-val-${i}`, cval);
        setText(`adv-total-${i}`, cval + (+sk.adv || 0));
    });

    save();
}

// ── Compétences de base ───────────────────────────────

function buildBasicSkills() {
    const tbody = document.getElementById('tbody-skills-basic');
    if (!tbody) return;
    tbody.innerHTML = BASIC_SKILLS.map(sk => {
        const s   = sid(sk.nom);
        const adv = state.skillsBasic[sk.nom] ?? 0;
        return `<tr>
            <td class="sk-nom">${sk.nom}</td>
            <td class="sk-carac-lbl">${CARAC_LABELS[sk.carac]}</td>
            <td class="sk-carac-val" id="sk-carac-${s}">0</td>
            <td><input class="sk-adv" type="number" data-skill="${sk.nom}" min="0" max="30" value="${adv}"></td>
            <td class="sk-total" id="sk-total-${s}">0</td>
        </tr>`;
    }).join('');
    tbody.querySelectorAll('.sk-adv').forEach(inp => {
        inp.addEventListener('input', () => {
            state.skillsBasic[inp.dataset.skill] = +inp.value || 0;
            recalc();
        });
    });
}

// ── Compétences avancées ──────────────────────────────

function ensureSkillsDatalist() {
    if (document.getElementById('wfrp-skills-list')) return;
    const dl = document.createElement('datalist');
    dl.id = 'wfrp-skills-list';
    if (window.WFRP_SKILLS) {
        dl.innerHTML = WFRP_SKILLS.map(s => `<option value="${s.nom}">`).join('');
    }
    document.body.appendChild(dl);
}

function renderAdvancedSkills() {
    ensureSkillsDatalist();
    const tbody = document.getElementById('tbody-skills-advanced');
    if (!tbody) return;
    tbody.innerHTML = state.skillsAdvanced.length === 0
        ? `<tr class="empty-row"><td colspan="6">Aucune compétence avancée</td></tr>`
        : state.skillsAdvanced.map((sk, i) => `<tr>
            <td><input class="sk-nom-input" type="text" list="wfrp-skills-list"
                       data-idx="${i}" value="${sk.nom}" placeholder="Nom ou Groupe (Spécialisation)"></td>
            <td><select class="sk-carac-sel" data-idx="${i}">
                ${CARACS.map(c => `<option value="${c}" ${sk.carac===c?'selected':''}>${CARAC_LABELS[c]}</option>`).join('')}
            </select></td>
            <td class="sk-carac-val" id="adv-carac-val-${i}">0</td>
            <td><input class="sk-adv sk-adv-adv" type="number" data-idx="${i}" min="0" max="30" value="${sk.adv ?? 0}"></td>
            <td class="sk-total" id="adv-total-${i}">0</td>
            <td><button class="btn-rm" data-type="adv-skill" data-idx="${i}" title="Supprimer">×</button></td>
        </tr>`).join('');
    bindAdvancedSkills(tbody);
}

function bindAdvancedSkills(tbody) {
    tbody.querySelectorAll('.sk-nom-input').forEach(inp =>
        inp.addEventListener('input', () => {
            const idx = +inp.dataset.idx;
            state.skillsAdvanced[idx].nom = inp.value;
            // Auto-remplir la carac si le nom correspond à une compétence connue
            const found = window.WFRP_SKILLS?.find(s => s.nom === inp.value);
            if (found) {
                state.skillsAdvanced[idx].carac = found.carac;
                const sel = tbody.querySelector(`.sk-carac-sel[data-idx="${idx}"]`);
                if (sel) sel.value = found.carac;
                recalc();
            } else {
                save();
            }
        }));
    tbody.querySelectorAll('.sk-carac-sel').forEach(sel =>
        sel.addEventListener('change', () => { state.skillsAdvanced[+sel.dataset.idx].carac = sel.value; recalc(); }));
    tbody.querySelectorAll('.sk-adv-adv').forEach(inp =>
        inp.addEventListener('input', () => { state.skillsAdvanced[+inp.dataset.idx].adv = +inp.value || 0; recalc(); }));
    tbody.querySelectorAll('.btn-rm[data-type="adv-skill"]').forEach(btn =>
        btn.addEventListener('click', () => { state.skillsAdvanced.splice(+btn.dataset.idx, 1); renderAdvancedSkills(); recalc(); }));
}

// ── Carrières ─────────────────────────────────────────

function buildCareerDatalist() {
    const dl = document.getElementById('career-names-list');
    if (!dl || !window.WFRP_CAREERS) return;
    dl.innerHTML = WFRP_CAREERS.map(c => `<option value="${c.nom}">`).join('');
}

function renderCareerDetail() {
    const panel = document.getElementById('career-detail-panel');
    if (!panel) return;

    const career = getActiveCareerData();
    if (!career) { panel.style.display = 'none'; return; }

    const rang = Math.min(4, Math.max(1, +getVal('rang') || 1));
    const rd   = career.rangs.find(r => r.rang === rang);
    if (!rd)   { panel.style.display = 'none'; return; }

    const CARAC_FULL = { cc:'CC', ct:'CT', f:'F', e:'E', i:'I', ag:'Ag', dex:'Dex', int:'Int', fm:'FM', soc:'Soc' };
    const caracLabels = (career.carac || []).map(c => CARAC_FULL[c] || c).join(', ') || '—';
    const skillsHtml  = (rd.skills  || []).map(s => `<span class="career-tag">${s}</span>`).join('') || '<em>—</em>';
    const talentsHtml = (rd.talents || []).map(t => `<span class="career-tag career-tag-talent">${t}</span>`).join('') || '<em>—</em>';

    panel.style.display = '';
    panel.innerHTML = `
        <div class="fiche-section career-detail-section">
            <h2>${career.nom} — ${rd.titre} <span class="career-rang-badge">Rang ${rang}</span></h2>
            <div class="career-detail-grid">
                <div class="career-detail-col">
                    <div class="career-detail-label">Caractéristiques</div>
                    <div class="career-detail-tags">${caracLabels}</div>
                </div>
                <div class="career-detail-col">
                    <div class="career-detail-label">Compétences (rang ${rang})</div>
                    <div class="career-detail-tags">${skillsHtml}</div>
                </div>
                <div class="career-detail-col">
                    <div class="career-detail-label">Talents (rang ${rang})</div>
                    <div class="career-detail-tags">${talentsHtml}</div>
                </div>
            </div>
        </div>`;
}

function renderCareers() {
    const tbody = document.getElementById('tbody-careers');
    if (!tbody) return;
    tbody.innerHTML = state.careers.length === 0
        ? `<tr class="empty-row"><td colspan="4">Aucune ancienne carrière</td></tr>`
        : state.careers.map((c, i) => `<tr>
            <td><input class="career-input" type="text" data-idx="${i}" data-field="nom" value="${c.nom}" placeholder="Nom de la carrière"></td>
            <td><input class="career-rang" type="number" data-idx="${i}" data-field="rang" min="1" max="4" value="${c.rang ?? 1}"></td>
            <td><input class="career-note" type="text" data-idx="${i}" data-field="note" value="${c.note}" placeholder="Notes…"></td>
            <td><button class="btn-rm" data-type="career" data-idx="${i}" title="Supprimer">×</button></td>
        </tr>`).join('');
    tbody.querySelectorAll('[data-type="career"]').forEach(btn =>
        btn.addEventListener('click', () => { state.careers.splice(+btn.dataset.idx, 1); renderCareers(); save(); }));
    tbody.querySelectorAll('.career-input, .career-rang, .career-note').forEach(inp =>
        inp.addEventListener('input', () => { state.careers[+inp.dataset.idx][inp.dataset.field] = inp.value; save(); }));
}

// ── Talents ───────────────────────────────────────────

function renderTalents(type) {
    const arr   = type === 'acq' ? state.talentsAcq : state.talentsAvail;
    const tbid  = `tbody-talents-${type}`;
    const cols  = type === 'acq' ? ['Talent','Notes'] : ['Talent','Coût XP'];
    const tbody = document.getElementById(tbid);
    if (!tbody) return;
    tbody.innerHTML = arr.length === 0
        ? `<tr class="empty-row"><td colspan="3">Aucun talent</td></tr>`
        : arr.map((t, i) => `<tr>
            <td><input class="talent-input" type="text" data-idx="${i}" data-type="${type}" data-field="nom" value="${t.nom}" placeholder="${cols[0]}"></td>
            <td><input class="talent-input" type="text" data-idx="${i}" data-type="${type}" data-field="note" value="${t.note}" placeholder="${cols[1]}"></td>
            <td><button class="btn-rm" data-type="talent-${type}" data-idx="${i}" title="Supprimer">×</button></td>
        </tr>`).join('');
    tbody.querySelectorAll('.talent-input').forEach(inp =>
        inp.addEventListener('input', () => {
            const arr2 = inp.dataset.type === 'acq' ? state.talentsAcq : state.talentsAvail;
            arr2[+inp.dataset.idx][inp.dataset.field] = inp.value;
            save();
        }));
    tbody.querySelectorAll(`.btn-rm[data-type="talent-${type}"]`).forEach(btn =>
        btn.addEventListener('click', () => {
            const arr2 = type === 'acq' ? state.talentsAcq : state.talentsAvail;
            arr2.splice(+btn.dataset.idx, 1);
            renderTalents(type);
            save();
        }));
}

// ── Sorts ─────────────────────────────────────────────

function renderSorts() {
    const tbody = document.getElementById('tbody-sorts');
    if (!tbody) return;
    tbody.innerHTML = state.sorts.length === 0
        ? `<tr class="empty-row"><td colspan="7">Aucun sort</td></tr>`
        : state.sorts.map((s, i) => `<tr>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="nom" value="${s.nom}" placeholder="Nom du sort"></td>
            <td><select class="sort-vent" data-idx="${i}">
                ${VENTS.map(v => `<option value="${v}" ${s.vent===v?'selected':''}>${v}</option>`).join('')}
            </select></td>
            <td><input class="sort-cn" type="number" data-idx="${i}" data-field="cn" min="0" value="${s.cn ?? 0}" style="width:52px"></td>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="portee" value="${s.portee}" placeholder="Portée"></td>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="duree" value="${s.duree}" placeholder="Durée"></td>
            <td><input class="sort-input sort-wide" type="text" data-idx="${i}" data-field="resume" value="${s.resume}" placeholder="Résumé de l'effet"></td>
            <td><button class="btn-rm" data-type="sort" data-idx="${i}" title="Supprimer">×</button></td>
        </tr>`).join('');
    tbody.querySelectorAll('.sort-input, .sort-cn').forEach(inp =>
        inp.addEventListener('input', () => { state.sorts[+inp.dataset.idx][inp.dataset.field] = inp.value; save(); }));
    tbody.querySelectorAll('.sort-vent').forEach(sel =>
        sel.addEventListener('change', () => { state.sorts[+sel.dataset.idx].vent = sel.value; save(); }));
    tbody.querySelectorAll('.btn-rm[data-type="sort"]').forEach(btn =>
        btn.addEventListener('click', () => { state.sorts.splice(+btn.dataset.idx, 1); renderSorts(); save(); }));
}

// ── Prières & Miracles ────────────────────────────────

function renderPrieres() {
    const tbody = document.getElementById('tbody-prieres');
    if (!tbody) return;
    tbody.innerHTML = state.prieres.length === 0
        ? `<tr class="empty-row"><td colspan="4">Aucune prière / miracle</td></tr>`
        : state.prieres.map((p, i) => `<tr>
            <td><input class="priere-input" type="text" data-idx="${i}" data-field="nom" value="${p.nom}" placeholder="Nom"></td>
            <td><select class="priere-type" data-idx="${i}">
                <option value="Bénédiction" ${p.type==='Bénédiction'?'selected':''}>Bénédiction</option>
                <option value="Miracle"     ${p.type==='Miracle'?'selected':''}>Miracle</option>
            </select></td>
            <td><input class="priere-input sort-wide" type="text" data-idx="${i}" data-field="resume" value="${p.resume}" placeholder="Résumé des effets"></td>
            <td><button class="btn-rm" data-type="priere" data-idx="${i}" title="Supprimer">×</button></td>
        </tr>`).join('');
    tbody.querySelectorAll('.priere-input').forEach(inp =>
        inp.addEventListener('input', () => { state.prieres[+inp.dataset.idx][inp.dataset.field] = inp.value; save(); }));
    tbody.querySelectorAll('.priere-type').forEach(sel =>
        sel.addEventListener('change', () => { state.prieres[+sel.dataset.idx].type = sel.value; save(); }));
    tbody.querySelectorAll('.btn-rm[data-type="priere"]').forEach(btn =>
        btn.addEventListener('click', () => { state.prieres.splice(+btn.dataset.idx, 1); renderPrieres(); save(); }));
}

// ── Journal XP ────────────────────────────────────────

function renderXpLog() {
    const tbody = document.getElementById('tbody-xp-log');
    if (!tbody) return;

    function rowHtml(e, i) {
        if (e.applied) {
            return `<tr class="xp-applied-row">
                <td>${e.type}</td>
                <td>${e.achat} <span class="xp-applied-badge">✓</span></td>
                <td class="col-num">${e.cout}</td>
                <td><input class="xp-note" type="text" data-idx="${i}" data-field="note" value="${e.note ?? ''}" placeholder="Note…"></td>
                <td><button class="btn-rm" data-type="xp" data-idx="${i}" title="Supprimer (annule l'effet)">×</button></td>
            </tr>`;
        }
        return `<tr>
            <td><select class="xp-type-sel" data-idx="${i}">
                ${XP_TYPES.map(t => `<option value="${t}" ${e.type===t?'selected':''}>${t}</option>`).join('')}
            </select></td>
            <td><input class="xp-achat" type="text" data-idx="${i}" data-field="achat" value="${e.achat ?? ''}" placeholder="Achat (ex: +5 CC)"></td>
            <td><input class="xp-cout" type="number" data-idx="${i}" data-field="cout" min="0" value="${e.cout ?? 0}" style="width:60px"></td>
            <td><input class="xp-note" type="text" data-idx="${i}" data-field="note" value="${e.note ?? ''}" placeholder="Note…"></td>
            <td><button class="btn-rm" data-type="xp" data-idx="${i}" title="Supprimer">×</button></td>
        </tr>`;
    }

    tbody.innerHTML = state.xpLog.length === 0
        ? `<tr class="empty-row"><td colspan="5">Aucune dépense enregistrée</td></tr>`
        : state.xpLog.map(rowHtml).join('');

    tbody.querySelectorAll('.xp-type-sel').forEach(sel =>
        sel.addEventListener('change', () => { state.xpLog[+sel.dataset.idx].type = sel.value; recalc(); }));
    tbody.querySelectorAll('.xp-achat').forEach(inp =>
        inp.addEventListener('input', () => { state.xpLog[+inp.dataset.idx].achat = inp.value; save(); }));
    tbody.querySelectorAll('.xp-cout').forEach(inp =>
        inp.addEventListener('input', () => { state.xpLog[+inp.dataset.idx].cout = +inp.value || 0; recalc(); }));
    tbody.querySelectorAll('.xp-note').forEach(inp =>
        inp.addEventListener('input', () => { state.xpLog[+inp.dataset.idx].note = inp.value; save(); }));
    tbody.querySelectorAll('.btn-rm[data-type="xp"]').forEach(btn =>
        btn.addEventListener('click', () => {
            const entry = state.xpLog[+btn.dataset.idx];
            if (entry?.applied) revertXpEntry(entry);
            state.xpLog.splice(+btn.dataset.idx, 1);
            renderXpLog();
            recalc();
        }));
}

// ── Sections optionnelles ─────────────────────────────

function applyOptVisible() {
    Object.entries(state.optVisible).forEach(([id, visible]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    });
}

// ── Persistence ───────────────────────────────────────

function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        nom:       getVal('nom'),
        race:      getVal('race'),
        carriere:  getVal('carriere'),
        rang:      getVal('rang'),
        xpTotal:   getVal('xp-total'),
        carac:     state.carac,
        skillsBasic:    state.skillsBasic,
        skillsAdvanced: state.skillsAdvanced,
        careers:        state.careers,
        talentsAcq:     state.talentsAcq,
        talentsAvail:   state.talentsAvail,
        sorts:          state.sorts,
        prieres:        state.prieres,
        xpLog:          state.xpLog,
        optVisible:     state.optVisible,
        blessuresAct:  getVal('blessures-act'),
        resilience:    getVal('resilience'),
        determination: getVal('determination'),
        chance:        getVal('chance'),
        destin:        getVal('destin'),
        corruption:    getVal('corruption'),
        possessions:   getVal('possessions'),
    }));
}

function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);

    setVal('nom', d.nom);  setVal('race', d.race);  setVal('carriere', d.carriere);
    setVal('rang', d.rang); setVal('xp-total', d.xpTotal);
    setVal('blessures-act', d.blessuresAct); setVal('resilience', d.resilience);
    setVal('determination', d.determination); setVal('chance', d.chance);
    setVal('destin', d.destin); setVal('corruption', d.corruption);
    setVal('possessions', d.possessions);

    if (d.carac) {
        Object.assign(state.carac, d.carac);
        CARACS.forEach(c => { setVal(`base-${c}`, state.carac[c]?.base ?? 0); setVal(`adv-${c}`, state.carac[c]?.adv ?? 0); });
    }
    if (d.skillsBasic)    Object.assign(state.skillsBasic, d.skillsBasic);
    if (d.skillsAdvanced) state.skillsAdvanced.push(...d.skillsAdvanced);
    if (d.careers)        state.careers.push(...d.careers);
    if (d.talentsAcq)     state.talentsAcq.push(...d.talentsAcq);
    if (d.talentsAvail)   state.talentsAvail.push(...d.talentsAvail);
    if (d.sorts)          state.sorts.push(...d.sorts);
    if (d.prieres)        state.prieres.push(...d.prieres);
    if (d.xpLog)          state.xpLog.push(...d.xpLog);
    if (d.optVisible)     Object.assign(state.optVisible, d.optVisible);
}

// ── Listeners ─────────────────────────────────────────

function bindAll() {
    // Carac inputs
    CARACS.forEach(c => {
        ['base','adv'].forEach(row => {
            document.getElementById(`${row}-${c}`)?.addEventListener('input', e => {
                state.carac[c][row] = +e.target.value || 0;
                recalc();
            });
        });
    });

    // Champs simples
    ['nom','carriere','rang','blessures-act','resilience','determination','chance','destin','corruption','possessions']
        .forEach(id => document.getElementById(id)?.addEventListener('input', save));

    // Panneau référence carrière
    ['carriere','rang'].forEach(id =>
        document.getElementById(id)?.addEventListener('input', renderCareerDetail));
    ['race','xp-total'].forEach(id => document.getElementById(id)?.addEventListener('input', recalc));

    // Boutons ajout
    document.getElementById('btn-add-adv-skill')?.addEventListener('click', () => {
        state.skillsAdvanced.push({ nom:'', carac:'int', adv:0 });
        renderAdvancedSkills(); recalc();
    });
    document.getElementById('btn-add-career')?.addEventListener('click', () => {
        state.careers.push({ nom:'', rang:1, note:'' });
        renderCareers(); save();
    });
    document.getElementById('btn-add-talent-acq')?.addEventListener('click', () => {
        state.talentsAcq.push({ nom:'', note:'' });
        renderTalents('acq'); save();
    });
    document.getElementById('btn-add-talent-avail')?.addEventListener('click', () => {
        state.talentsAvail.push({ nom:'', note:'' });
        renderTalents('avail'); save();
    });
    document.getElementById('btn-add-sort')?.addEventListener('click', () => {
        state.sorts.push({ nom:'', vent:'Aqshy', cn:0, portee:'', duree:'', resume:'' });
        renderSorts(); save();
    });
    document.getElementById('btn-add-priere')?.addEventListener('click', () => {
        state.prieres.push({ nom:'', type:'Bénédiction', resume:'' });
        renderPrieres(); save();
    });
    document.getElementById('btn-add-xp')?.addEventListener('click', showXpForm);

    // Sections optionnelles — toggle
    document.querySelectorAll('.btn-toggle-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            state.optVisible[target] = !state.optVisible[target];
            applyOptVisible();
            save();
        });
    });
    document.querySelectorAll('.btn-close-section').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            state.optVisible[target] = false;
            applyOptVisible();
            save();
        });
    });
}

// ── Init ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    buildCareerDatalist();
    buildBasicSkills();
    load();
    renderCareerDetail();
    renderAdvancedSkills();
    renderCareers();
    renderTalents('acq');
    renderTalents('avail');
    renderSorts();
    renderPrieres();
    renderXpLog();
    applyOptVisible();
    bindAll();
    recalc();
});

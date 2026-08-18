import { esc, stripAccents, parseCSV } from './utils.js';
import { cloudSave } from './fiche-cloud.js';

// Promesse de chargement des bases de données JSON et statut du cloud
export const dbLoadingPromise = Promise.all([loadCareersData(), loadSkillsData()]);
export let isCloudLoaded = false;


// ── Constantes ────────────────────────────────────────

const CARACS = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const CARAC_LABELS = { cc:'CC', ct:'CT', f:'F', e:'E', i:'I', ag:'Ag', dex:'Dex', int:'Int', fm:'FM', soc:'Soc' };
const MOUVEMENT = {
    humain:4, 'elfe-sylvain':5, 'haut-elfe':5, halfelin:4, ogre:6,
    elfe:5, halfling:4, nain:3, // rétrocompat anciennes sauvegardes
};
const _charParam = new URLSearchParams(window.location.search).get('char');
const STORAGE_KEY = 'wfrp4-fiche-' + (_charParam || 'test');

const PORTRAITS = {
    bhelgi:  { src: 'img/Bhelgi.webp',  alt: 'Bhelgi'  },
    caelel:  { src: 'img/Caelel.webp',  alt: 'Caelel'  },
    elysia:  { src: 'img/Elysia.webp',  alt: 'Elysia'  },
    hellaya: { src: 'img/Hellaya.webp', alt: 'Hellaya' },
    wren:    { src: 'img/Wren.webp',    alt: 'Wren'    },
};
const PORTRAIT_KEYS = Object.keys(PORTRAITS);

// Slot de carrière ouvert : "(au choix)" ou catégorie générique à choisir
const OPEN_SPEC_PATTERN   = /\((?:.*?\bchoix\b|n'importe quelle|celle du lanceur).*?\)$/i;
const GENERIC_SPEC_WORDS  = new Set(['Région','Localité','Langue','Commerce','Peuple','Matériau','Arme','Ennemi','Organisation','Divinité','Vent']);
function isOpenCareerSlot(s) {
    if (OPEN_SPEC_PATTERN.test(s)) return true;
    const m = s.match(/\(([^)]+)\)$/);
    return m ? GENERIC_SPEC_WORDS.has(m[1].trim()) : false;
}

function expandChoiceSkill(s) {
    const orMatch = s.match(/\(([^)]+)\)$/);
    if (orMatch) {
        if (isOpenCareerSlot(s)) return [s];
        const content = orMatch[1].trim();
        if (content.startsWith('ou ')) {
            const base = s.split('(')[0].trim();
            const alt = content.substring(3).trim();
            return [base, alt];
        }
        const parts = content.split(/,?\s+ou\s+|\s*,\s*/);
        if (parts.length > 1) {
            const base = s.split('(')[0].trim();
            return parts.map(p => `${base} (${p.trim()})`);
        }
    }
    return [s];
}

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
    { nom:"Conduite d'attelage",     carac:'ag'  },
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
    // Le rang max dépend de la carrière (Mage HE va jusqu'à 5, les autres à 4).
    const career = getActiveCareerData();
    const maxRang = career ? Math.max(4, ...career.rangs.map(r => r.rang)) : 4;
    return Math.min(maxRang, Math.max(1, +getVal('rang') || 1));
}

// ── Variantes de rang ──────────────────────────────────
// Certains rangs ont plusieurs entrées (variantes par race / supplément).
// L'utilisateur peut en choisir une dans le panneau de référence ;
// le choix est persisté dans state.chosenVariants[careerId][rang].

function getRangVariants(career, rang) {
    return career.rangs.filter(r => r.rang === rang);
}

function getChosenVariantTitre(careerId, rang) {
    return state.chosenVariants?.[careerId]?.[rang] || null;
}

function setChosenVariantTitre(careerId, rang, titre) {
    if (!state.chosenVariants[careerId]) state.chosenVariants[careerId] = {};
    if (titre) state.chosenVariants[careerId][rang] = titre;
    else delete state.chosenVariants[careerId][rang];
    invalidateCareerCache();
}

// Renvoie la variante choisie pour ce rang, ou null si l'utilisateur n'a pas choisi
// (ou s'il n'y a qu'une variante — pas besoin de choix).
function getActiveVariantForRang(career, rang) {
    const variants = getRangVariants(career, rang);
    if (variants.length === 1) return variants[0];
    if (variants.length === 0) return null;
    const chosen = getChosenVariantTitre(career.id, rang);
    return chosen ? variants.find(v => v.titre === chosen) || null : null;
}

// Variantes à considérer comme "dans la carrière" : la choisie si choix, sinon toutes.
// Comportement généreux par défaut — évite les faux négatifs pendant que la joueuse
// achète des compétences avant d'avoir formalisé la variante avec le MJ.
function getVariantsToConsider(career, rang) {
    const active = getActiveVariantForRang(career, rang);
    return active ? [active] : getRangVariants(career, rang);
}

// ── Overrides par-fiche ────────────────────────────────
// Le MJ peut retirer ou ajouter manuellement une compétence/talent sur un rang
// donné de la carrière, sans modifier la DB globale. Stocké dans
// state.careerOverrides[careerId][rang] = { skillsRemoved, skillsAdded, talentsRemoved, talentsAdded }.

function getOverrides(careerId, rang) {
    return state.careerOverrides?.[careerId]?.[rang] || null;
}

function ensureOverrides(careerId, rang) {
    if (!state.careerOverrides[careerId]) state.careerOverrides[careerId] = {};
    if (!state.careerOverrides[careerId][rang]) {
        state.careerOverrides[careerId][rang] = {
            skillsRemoved: [], skillsAdded: [],
            talentsRemoved: [], talentsAdded: [],
        };
    }
    return state.careerOverrides[careerId][rang];
}

// Supprime les entrées vides du state pour garder le JSON propre.
function cleanupOverrides(careerId, rang) {
    const o = state.careerOverrides?.[careerId]?.[rang];
    if (!o) return;
    if (!o.skillsRemoved.length && !o.skillsAdded.length
        && !o.talentsRemoved.length && !o.talentsAdded.length) {
        delete state.careerOverrides[careerId][rang];
    }
    if (state.careerOverrides[careerId]
        && Object.keys(state.careerOverrides[careerId]).length === 0) {
        delete state.careerOverrides[careerId];
    }
}

function hasOverrides(careerId, rang) {
    const o = getOverrides(careerId, rang);
    return !!(o && (o.skillsRemoved.length || o.skillsAdded.length
                 || o.talentsRemoved.length || o.talentsAdded.length));
}

// Listes effectives : (skills/talents de la variante) − retirées + ajoutées.
// Les overrides s'appliquent au rang, indépendamment de la variante choisie.
function getEffectiveSkills(career, rang, variant) {
    const base = (variant?.skills || []).slice();
    const o = getOverrides(career.id, rang);
    if (!o) return base;
    const removed = new Set(o.skillsRemoved.map(s => s.toLowerCase()));
    return [
        ...base.filter(s => !removed.has(s.toLowerCase())),
        ...o.skillsAdded,
    ];
}

function getEffectiveTalents(career, rang, variant) {
    const base = (variant?.talents || []).slice();
    const o = getOverrides(career.id, rang);
    if (!o) return base;
    const removed = new Set(o.talentsRemoved.map(t => t.toLowerCase()));
    return [
        ...base.filter(t => !removed.has(t.toLowerCase())),
        ...o.talentsAdded,
    ];
}

function skillBaseNom(fullNom) {
    return fullNom.split('(')[0].trim().toLowerCase();
}

// ── Cache des sets carrière ───────────────────────────
// Coûts XP et highlights étaient recalculés à chaque keystroke (O(carrières
// × rangs × variantes × skills) à chaque appel). On mémoïse par
// (careerId, rang) — clé invalidée à : changement de carrière/rang, choix
// de variante, ajout/retrait d'override, resetState, applyData.
// Les helpers passent en O(1) (Set lookup) sur les hits.
const _careerCache = {
    skills:    new Map(),  // → { exact: Set<lower>, openBases: Set<lowerBase> }
    talents:   new Map(),  // → idem
    allSkills: new Map(),  // → Array<string> ordonné (display)
    caracs:    new Map(),  // → Set<carac>
};

function invalidateCareerCache() {
    _careerCache.skills.clear();
    _careerCache.talents.clear();
    _careerCache.allSkills.clear();
    _careerCache.caracs.clear();
}

function _careerKey(careerId, rang) { return `${careerId}::${rang}`; }

function _buildCareerSkillSets(career, rang) {
    const exact = new Set(), openBases = new Set();
    for (let r = 1; r <= rang; r++) {
        for (const rd of getVariantsToConsider(career, r)) {
            for (const s of getEffectiveSkills(career, r, rd)) {
                for (const expanded of expandChoiceSkill(s)) {
                    exact.add(expanded.toLowerCase());
                    if (isOpenCareerSlot(expanded)) openBases.add(skillBaseNom(expanded));
                }
            }
        }
    }
    return { exact, openBases };
}

function _buildCareerTalentSets(career, rang) {
    const exact = new Set(), openBases = new Set();
    for (let r = 1; r <= rang; r++) {
        for (const rd of getVariantsToConsider(career, r)) {
            for (const t of getEffectiveTalents(career, r, rd)) {
                exact.add(t.toLowerCase());
                if (OPEN_SPEC_PATTERN.test(t)) openBases.add(t.split('(')[0].trim().toLowerCase());
            }
        }
    }
    return { exact, openBases };
}

function _buildCareerCaracs(career, rang) {
    const set = new Set();
    for (let r = 1; r <= rang; r++) {
        for (const rd of getVariantsToConsider(career, r)) {
            (rd.caracs || []).forEach(c => set.add(c));
        }
    }
    return set;
}

function _memo(map, key, build) {
    let v = map.get(key);
    if (v) return v;
    v = build();
    map.set(key, v);
    return v;
}

function isSkillInCareer(nom) {
    const career = getActiveCareerData();
    if (!career) return false;
    const sets = _memo(_careerCache.skills, _careerKey(career.id, getActiveRang()),
                       () => _buildCareerSkillSets(career, getActiveRang()));
    const nomLower = nom.toLowerCase();
    if (sets.exact.has(nomLower)) return true;
    return sets.openBases.has(skillBaseNom(nom));
}

function isCaracInCareer(carac) {
    const career = getActiveCareerData();
    if (!career) return false;
    const set = _memo(_careerCache.caracs, _careerKey(career.id, getActiveRang()),
                      () => _buildCareerCaracs(career, getActiveRang()));
    if (set.has(carac)) return true;
    // Rétrocompat (anciennes données sans rd.caracs) : utiliser la liste agrégée.
    return career.carac.includes(carac);
}

function isTalentInCareer(talentNom) {
    const career = getActiveCareerData();
    if (!career) return false;
    const sets = _memo(_careerCache.talents, _careerKey(career.id, getActiveRang()),
                       () => _buildCareerTalentSets(career, getActiveRang()));
    const nom = talentNom.toLowerCase().trim();
    if (sets.exact.has(nom)) return true;
    return sets.openBases.has(nom.split('(')[0].trim());
}

// ── Formulaire d'achat XP ─────────────────────────────

function showXpForm(options = {}) {
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
            </div>
            <div class="xf-cost-row">
                Coût estimé : <strong id="xf-cost">—</strong> XP
                <span id="xf-career-badge" class="xf-career-badge"></span>
            </div>
            <div class="xf-actions">
                <button class="btn-add" id="xf-validate">✓ Valider et appliquer</button>
                <button class="btn-rm"  id="xf-cancel">Annuler</button>
            </div>
        </div>`;

    document.getElementById('xf-type').addEventListener('change', updateXfTarget);
    document.getElementById('xf-avances').addEventListener('input', computeXfCost);
    document.getElementById('xf-validate').addEventListener('click', validateXpPurchase);
    document.getElementById('xf-cancel').addEventListener('click', () => { form.style.display = 'none'; });

    // Pré-remplissage si appelé depuis un ghost row
    if (options.type) {
        const typeEl = document.getElementById('xf-type');
        typeEl.value = options.type;
        updateXfTarget();

        if (options.group) {
            const grpSel = document.getElementById('xf-group');
            if (grpSel) {
                grpSel.value = options.group;
                const specWrap = document.getElementById('xf-spec-wrap');
                if (specWrap) {
                    specWrap.innerHTML = '';
                    buildXfSpecPicker(options.group, specWrap);
                }
                // Pré-sélectionner la spécialisation fixe si fournie
                if (options.spec) {
                    const specSel = document.getElementById('xf-spec-sel');
                    if (specSel) {
                        const opt = [...specSel.options].find(o => o.value === options.spec);
                        if (opt) {
                            specSel.value = options.spec;
                        } else {
                            specSel.value = '_custom';
                            const customInp = document.getElementById('xf-spec-custom');
                            if (customInp) { customInp.value = options.spec; customInp.style.display = ''; }
                        }
                    }
                }
                computeXfCost();
            }
        }
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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

// ── Cache des talents issus des carrières (immuable) ───────
let _careerTalentsBaseCache = null;
function getCareerTalentsBase() {
    if (_careerTalentsBaseCache) return _careerTalentsBaseCache;
    if (!window.WFRP_CAREERS) return null;
    const set = new Set();
    WFRP_CAREERS.forEach(c => c.rangs.forEach(r => r.talents.forEach(t => {
        if (isOpenCareerSlot(t)) set.add(t.split('(')[0].trim());
        else set.add(t);
    })));
    _careerTalentsBaseCache = set;
    return set;
}

// HTML de datalist mémoïsé — invalidé quand state.customTalents change.
let _talentsDatalistCache = { sig: null, html: '' };
function buildTalentsDatalistHtml() {
    const base = getCareerTalentsBase();
    if (!base) return null;
    const sig = JSON.stringify(state.customTalents || {});
    if (_talentsDatalistCache.sig === sig) return _talentsDatalistCache.html;
    const set = new Set(base);
    Object.entries(state.customTalents || {}).forEach(([baseName, specs]) =>
        specs.forEach(spec => set.add(`${baseName} (${spec})`))
    );
    const html = [...set].sort((a, b) => a.localeCompare(b, 'fr'))
        .map(t => `<option value="${esc(t)}">`).join('');
    _talentsDatalistCache = { sig, html };
    return html;
}

// Specs connues pour un groupe de talent (depuis toutes les carrières)
function getTalentSpecsForGroup(groupBase) {
    if (!window.WFRP_CAREERS) return [];
    const lowerBase = groupBase.toLowerCase().trim();
    const specs = new Set();
    WFRP_CAREERS.forEach(c => c.rangs.forEach(r => r.talents.forEach(t => {
        if (OPEN_SPEC_PATTERN.test(t)) return;
        const tBase = t.split('(')[0].trim().toLowerCase();
        const m = t.match(/\(([^)]+)\)$/);
        if (tBase === lowerBase && m) specs.add(m[1].trim());
    })));
    return [...specs].sort((a, b) => a.localeCompare(b, 'fr'));
}

// Vérifie si un talent existe en version "au choix" dans une carrière quelconque
function isTalentGroupOpen(groupBase) {
    if (!window.WFRP_CAREERS) return false;
    const lowerBase = groupBase.toLowerCase().trim();
    return WFRP_CAREERS.some(c => c.rangs.some(r => r.talents.some(t =>
        isOpenCareerSlot(t) && t.split('(')[0].trim().toLowerCase() === lowerBase
    )));
}

function buildXfTalentSpecPicker(groupBase, wrap) {
    wrap.innerHTML = '';
    const knownSpecs  = getTalentSpecsForGroup(groupBase);
    const customSpecs = state.customTalents[groupBase] || [];
    const allSpecs    = [...new Set([...knownSpecs, ...customSpecs])];

    const specSel = document.createElement('select');
    specSel.id = 'xf-talent-spec-sel';
    specSel.className = 'xf-spec-sel';
    specSel.innerHTML =
        allSpecs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('') +
        '<option value="_custom">Autre (personnalisé)…</option>';
    if (allSpecs.length === 0) specSel.value = '_custom';
    wrap.appendChild(specSel);

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.id = 'xf-talent-spec-custom';
    customInput.placeholder = 'Spécialisation…';
    customInput.className = 'xf-spec-input';
    customInput.style.display = allSpecs.length === 0 ? '' : 'none';
    wrap.appendChild(customInput);

    const onChange = () => {
        customInput.style.display = specSel.value === '_custom' ? '' : 'none';
        computeXfCost();
    };
    specSel.addEventListener('change', onChange);
    customInput.addEventListener('input', onChange);
}

function getXfTalentFullNom() {
    const inp = document.getElementById('xf-talent');
    if (!inp) return '';
    // Nettoyer "(au choix)" éventuel dans la saisie
    const base = inp.value.trim().replace(OPEN_SPEC_PATTERN, '').trim();
    if (!base) return '';
    const specSel = document.getElementById('xf-talent-spec-sel');
    if (!specSel) return base;
    if (specSel.value === '_custom') {
        const custom = document.getElementById('xf-talent-spec-custom')?.value?.trim() || '';
        return custom ? `${base} (${custom})` : base;
    }
    return `${base} (${specSel.value})`;
}

function buildXfSpecPicker(group, wrap) {
    const knownSpecs  = getSpecsForGroup(group);
    const customSpecs = state.customSpecs[group] || [];
    const allSpecs    = [...new Set([...knownSpecs, ...customSpecs])];
    if (allSpecs.length === 0) { wrap.innerHTML = ''; return; }

    const specSel = document.createElement('select');
    specSel.id = 'xf-spec-sel';
    specSel.className = 'xf-spec-sel';
    specSel.innerHTML =
        allSpecs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('') +
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
        sel.addEventListener('change', computeXfCost);

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
            computeXfCost();
        });

    } else if (type === 'talent') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.id = 'xf-talent';
        inp.placeholder = 'Nom du talent…';
        inp.className = 'xf-talent-input';
        inp.setAttribute('list', 'xf-talent-datalist');
        inp.setAttribute('autocomplete', 'off');
        wrap.appendChild(inp);

        const talentSpecWrap = document.createElement('span');
        talentSpecWrap.id = 'xf-talent-spec-wrap';
        talentSpecWrap.className = 'xf-target-wrap';
        wrap.appendChild(talentSpecWrap);

        // Datalist mémoïsée : on garde le noeud DOM et on ne reconstruit le HTML
        // que si la signature des customTalents a changé.
        const html = buildTalentsDatalistHtml();
        if (html !== null) {
            let dl = document.getElementById('xf-talent-datalist');
            if (!dl) {
                dl = document.createElement('datalist');
                dl.id = 'xf-talent-datalist';
                document.body.appendChild(dl);
            }
            if (dl.dataset.sig !== _talentsDatalistCache.sig) {
                dl.innerHTML = html;
                dl.dataset.sig = _talentsDatalistCache.sig;
            }
        }

        inp.addEventListener('input', () => {
            // Retirer "(au choix)" si l'utilisateur a sélectionné le nom complet depuis la datalist
            const val = inp.value.trim().replace(OPEN_SPEC_PATTERN, '').trim();
            if (val && isTalentGroupOpen(val)) {
                buildXfTalentSpecPicker(val, talentSpecWrap);
            } else {
                talentSpecWrap.innerHTML = '';
            }
            computeXfCost();
        });
    }
    computeXfCost();
}

function getXfInCareer() {
    const type = document.getElementById('xf-type')?.value || '';
    if (type === 'carac') {
        const carac = document.getElementById('xf-target')?.value;
        return carac ? isCaracInCareer(carac) : false;
    } else if (type === 'skill-basic' || type === 'skill-adv') {
        const nom = getXfSkillFullNom();
        return nom ? isSkillInCareer(nom) : false;
    } else if (type === 'talent') {
        const nom = getXfTalentFullNom();
        return nom ? isTalentInCareer(nom) : false;
    }
    return false;
}

function computeXfCost() {
    const type     = document.getElementById('xf-type')?.value || '';
    const avances  = Math.max(1, +document.getElementById('xf-avances')?.value || 1);
    const inCareer = getXfInCareer();
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

    // Badge carrière informatif
    const badge = document.getElementById('xf-career-badge');
    if (badge && type) {
        const career = getActiveCareerData();
        if (!career) {
            badge.textContent = '';
        } else {
            badge.textContent    = inCareer ? '✓ dans la carrière' : '✗ hors carrière';
            badge.dataset.career = inCareer ? 'yes' : 'no';
        }
    }

    return cost;
}

function validateXpPurchase() {
    const type     = document.getElementById('xf-type')?.value || '';
    const avances  = Math.max(1, +document.getElementById('xf-avances')?.value || 1);
    const inCareer = getXfInCareer();
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

        // Mémoriser la spécialisation personnalisée pour la retrouver dans le picker
        const specSel = document.getElementById('xf-spec-sel');
        if (specSel?.value === '_custom') {
            const customVal = document.getElementById('xf-spec-custom')?.value?.trim();
            if (customVal && group) {
                if (!state.customSpecs[group]) state.customSpecs[group] = [];
                if (!state.customSpecs[group].includes(customVal)) state.customSpecs[group].push(customVal);
            }
        }

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
        const nom = getXfTalentFullNom();
        if (!nom) return;

        // Mémoriser la spécialisation personnalisée
        const specSel = document.getElementById('xf-talent-spec-sel');
        if (specSel?.value === '_custom') {
            const base     = document.getElementById('xf-talent')?.value?.trim().replace(OPEN_SPEC_PATTERN, '').trim();
            const customVal = document.getElementById('xf-talent-spec-custom')?.value?.trim();
            if (base && customVal) {
                if (!state.customTalents[base]) state.customTalents[base] = [];
                if (!state.customTalents[base].includes(customVal)) state.customTalents[base].push(customVal);
            }
        }

        state.talentsAcq.push({ nom, note: inCareer ? '' : 'hors carrière' });
        renderTalents();
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
        if (idx >= 0) { state.talentsAcq.splice(idx, 1); renderTalents(); }
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
            if (idx >= 0) { state.talentsAcq.splice(idx, 1); renderTalents(); }
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
    customSpecs:    {},   // { 'Métier': ['Boulangerie', 'Tonnelier'], ... }
    customTalents:  {},   // { 'Maître artisan': ['Apothicaire', 'Forgeron'], ... }
    chosenVariants: {},   // { careerId: { rang: variantTitre, ... }, ... }
    careerOverrides:{},   // { careerId: { rang: { skillsRemoved, skillsAdded, talentsRemoved, talentsAdded } } }
    optVisible:     { 'section-sorts': false, 'section-prieres': false },
};

// État éphémère d'édition (pas persisté) — un Set de clés `${careerId}_${rang}`
const editingRangs = new Set();
function isEditingRang(careerId, rang) { return editingRangs.has(`${careerId}_${rang}`); }
function setEditingRang(careerId, rang, on) {
    const key = `${careerId}_${rang}`;
    if (on) editingRangs.add(key);
    else    editingRangs.delete(key);
}

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

    // XP — total gagné = somme des entrées gain, dépensé = somme des achats
    const xpGained = state.xpLog.filter(e => e.kind === 'gain').reduce((s, e) => s + (+e.montant || 0), 0);
    const xpSpent  = state.xpLog.filter(e => e.kind !== 'gain').reduce((s, e) => s + (+e.cout || 0), 0);
    setText('xp-total-display', xpGained);
    setText('xp-spent-display', xpSpent);
    setText('xp-dispo', xpGained - xpSpent);
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

let _basicSkillsBound = false;
function buildBasicSkills() {
    const tbody = document.getElementById('tbody-skills-basic');
    if (!tbody) return;
    tbody.innerHTML = BASIC_SKILLS.map(sk => {
        const s   = sid(sk.nom);
        const adv = state.skillsBasic[sk.nom] ?? 0;
        return `<tr data-skill="${sk.nom}">
            <td class="sk-nom">${sk.nom}</td>
            <td class="sk-carac-lbl">${CARAC_LABELS[sk.carac]}</td>
            <td class="sk-carac-val" id="sk-carac-${s}">0</td>
            <td><input class="sk-adv" type="number" data-skill="${sk.nom}" min="0" max="30" value="${esc(adv)}" aria-label="Avances en ${esc(sk.nom)}"></td>
            <td class="sk-total" id="sk-total-${s}">0</td>
        </tr>`;
    }).join('');
    // Délégation : buildBasicSkills est rappelé sur ficheLoadCloud — sans
    // garde, chaque login cloud empilerait un listener par compétence.
    if (!_basicSkillsBound) {
        tbody.addEventListener('input', e => {
            const t = e.target;
            if (!t.classList.contains('sk-adv')) return;
            state.skillsBasic[t.dataset.skill] = +t.value || 0;
            recalc();
        });
        _basicSkillsBound = true;
    }
}

// ── Compétences avancées ──────────────────────────────

function ensureSkillsDatalist() {
    if (document.getElementById('wfrp-skills-list')) return;
    const dl = document.createElement('datalist');
    dl.id = 'wfrp-skills-list';
    if (window.WFRP_SKILLS) {
        dl.innerHTML = WFRP_SKILLS.map(s => `<option value="${esc(s.nom)}">`).join('');
    }
    document.body.appendChild(dl);
}

// Datalist globale des talents (utilisée par les champs d'ajout d'overrides).
// Mémoïsée : le DOM persiste, et le HTML n'est régénéré que si la signature
// des customTalents a évolué depuis le dernier appel.
function ensureTalentsDatalist() {
    const html = buildTalentsDatalistHtml();
    if (html === null) return;
    let dl = document.getElementById('wfrp-talents-list');
    if (!dl) {
        dl = document.createElement('datalist');
        dl.id = 'wfrp-talents-list';
        document.body.appendChild(dl);
    }
    if (dl.dataset.sig !== _talentsDatalistCache.sig) {
        dl.innerHTML = html;
        dl.dataset.sig = _talentsDatalistCache.sig;
    }
}

let _advSkillsBound = false;
function renderAdvancedSkills() {
    ensureSkillsDatalist();
    const tbody = document.getElementById('tbody-skills-advanced');
    if (!tbody) return;
    tbody.innerHTML = state.skillsAdvanced.length === 0
        ? `<tr class="empty-row"><td colspan="6">Aucune compétence avancée</td></tr>`
        : state.skillsAdvanced.map((sk, i) => `<tr>
            <td><input class="sk-nom-input" type="text" list="wfrp-skills-list"
                       data-idx="${i}" value="${esc(sk.nom)}" placeholder="Nom ou Groupe (Spécialisation)"
                       aria-label="Nom de la compétence, ligne ${i + 1}"></td>
            <td><select class="sk-carac-sel" data-idx="${i}" aria-label="Caractéristique, ligne ${i + 1}">
                ${CARACS.map(c => `<option value="${c}" ${sk.carac===c?'selected':''}>${CARAC_LABELS[c]}</option>`).join('')}
            </select></td>
            <td class="sk-carac-val" id="adv-carac-val-${i}">0</td>
            <td><input class="sk-adv sk-adv-adv" type="number" data-idx="${i}" min="0" max="30" value="${esc(sk.adv ?? 0)}" aria-label="Avances, ligne ${i + 1}"></td>
            <td class="sk-total" id="adv-total-${i}">0</td>
            <td><button class="btn-rm" data-type="adv-skill" data-idx="${i}" title="Supprimer" aria-label="Supprimer la compétence, ligne ${i + 1}">×</button></td>
        </tr>`).join('');
    if (!_advSkillsBound) {
        bindAdvancedSkillsDelegated(tbody);
        _advSkillsBound = true;
    }
    applyCareerHighlights();
    renderCareerAdvGhosts();
}

// Délégation : un seul jeu de listeners attaché au tbody, jamais ré-attaché.
// Le re-render réécrit innerHTML, ce qui aurait empilé les listeners avec
// l'ancienne approche (cf. audit — fuite mémoire + double-déclenchement).
// Les data-idx étant régénérés à chaque render, ils restent synchrones avec
// state.skillsAdvanced même après splice().
function bindAdvancedSkillsDelegated(tbody) {
    tbody.addEventListener('input', e => {
        const t = e.target;
        const idx = +t.dataset.idx;
        if (Number.isNaN(idx) || !state.skillsAdvanced[idx]) return;
        if (t.classList.contains('sk-nom-input')) {
            state.skillsAdvanced[idx].nom = t.value;
            const found = window.WFRP_SKILLS?.find(s => s.nom === t.value);
            if (found) {
                state.skillsAdvanced[idx].carac = found.carac;
                const sel = tbody.querySelector(`.sk-carac-sel[data-idx="${idx}"]`);
                if (sel) sel.value = found.carac;
                recalc();
            } else {
                save();
            }
        } else if (t.classList.contains('sk-adv-adv')) {
            state.skillsAdvanced[idx].adv = +t.value || 0;
            recalc();
        }
    });
    tbody.addEventListener('change', e => {
        const t = e.target;
        if (!t.classList.contains('sk-carac-sel')) return;
        const idx = +t.dataset.idx;
        if (Number.isNaN(idx) || !state.skillsAdvanced[idx]) return;
        state.skillsAdvanced[idx].carac = t.value;
        recalc();
    });
    tbody.addEventListener('click', e => {
        const btn = e.target.closest('.btn-rm[data-type="adv-skill"]');
        if (!btn || !tbody.contains(btn)) return;
        const idx = +btn.dataset.idx;
        if (Number.isNaN(idx)) return;
        state.skillsAdvanced.splice(idx, 1);
        renderAdvancedSkills();
        recalc();
    });
}

// ── Carrières ─────────────────────────────────────────

// ── Talent Modal ──────────────────────────────────────

const TALENT_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs'
    + '/gviz/tq?tqx=out:csv&sheet=Talents';
let _talentCache = null;

async function fetchTalentData() {
    if (_talentCache) return _talentCache;
    try {
        const res = await fetch(TALENT_SHEET_URL);
        if (!res.ok) return null;
        // parseCSV importé de js/utils.js
        const rows = parseCSV(await res.text());
        if (rows.length < 2) return null;
        const [headers, ...data] = rows;
        _talentCache = { headers, data };
        return _talentCache;
    } catch { return null; }
}

function ensureTalentModal() {
    if (document.getElementById('talent-modal')) return;
    const div = document.createElement('div');
    div.id = 'talent-modal';
    div.className = 'talent-modal-backdrop';
    div.style.display = 'none';
    div.innerHTML = `
        <div class="talent-modal-box" role="dialog">
            <button class="talent-modal-close" id="talent-modal-close" title="Fermer">×</button>
            <div id="talent-modal-body"></div>
        </div>`;
    div.addEventListener('click', e => {
        if (e.target === div || e.target.id === 'talent-modal-close') div.style.display = 'none';
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') div.style.display = 'none';
    });
    document.body.appendChild(div);
}

async function showTalentModal(nom) {
    ensureTalentModal();
    const modal = document.getElementById('talent-modal');
    const body  = document.getElementById('talent-modal-body');
    body.innerHTML = '<p class="talent-modal-loading">Chargement…</p>';
    modal.style.display = 'flex';

    const td = await fetchTalentData();
    // esc importé de js/utils.js
    const _e = esc;

    if (!td) { body.innerHTML = `<h3>${_e(nom)}</h3><p>Impossible de charger les données.</p>`; return; }

    const nomIdx = td.headers.findIndex(h => h.toLowerCase() === 'nom');
    const titleIdx = nomIdx >= 0 ? nomIdx : 0;
    const row = td.data.find(r => (r[titleIdx] || '').toLowerCase() === nom.toLowerCase());

    if (!row) { body.innerHTML = `<h3 class="talent-modal-title">${_e(nom)}</h3><p><em>Aucune description disponible.</em></p>`; return; }

    let html = `<h3 class="talent-modal-title">${_e(row[titleIdx])}</h3>`;
    td.headers.forEach((h, i) => {
        if (i === titleIdx || !row[i]) return;
        html += `<div class="talent-modal-field">
            <span class="talent-modal-label">${_e(h)}</span>
            <span class="talent-modal-value">${_e(row[i]).replace(/\n/g, '<br>')}</span>
        </div>`;
    });
    body.innerHTML = html;
}

// ── Carrière — highlights & ghosts ────────────────────

function getCareerAllSkills(career, rang) {
    return _memo(_careerCache.allSkills, _careerKey(career.id, rang), () => {
        const seen = new Set(), noms = [];
        for (let r = 1; r <= rang; r++) {
            for (const rd of getVariantsToConsider(career, r)) {
                getEffectiveSkills(career, r, rd).forEach(s => {
                    if (!seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); noms.push(s); }
                });
            }
        }
        return noms;
    });
}

function applyCareerHighlights() {
    document.querySelectorAll('.carac-in-career').forEach(el => el.classList.remove('carac-in-career'));
    document.querySelectorAll('.skill-in-career').forEach(tr => tr.classList.remove('skill-in-career'));

    const career = getActiveCareerData();
    if (!career) return;
    const rang = getActiveRang();

    career.carac.forEach(c => {
        ['base', 'adv'].forEach(type =>
            document.getElementById(`${type}-${c}`)?.closest('td')?.classList.add('carac-in-career')
        );
        document.getElementById(`total-${c}`)?.closest('td')?.classList.add('carac-in-career');
    });

    const allSkills = getCareerAllSkills(career, rang);

    // Compétences de base
    document.querySelectorAll('#tbody-skills-basic tr[data-skill]').forEach(tr => {
        const nom  = tr.dataset.skill;
        const base = skillBaseNom(nom);
        const match = allSkills.some(s => {
            return expandChoiceSkill(s).some(opt => {
                if (opt.toLowerCase() === nom.toLowerCase()) return true;
                return isOpenCareerSlot(opt) && skillBaseNom(opt) === base;
            });
        });
        if (match) tr.classList.add('skill-in-career');
    });

    // Compétences avancées achetées
    document.querySelectorAll('#tbody-skills-advanced tr:not(.empty-row)').forEach((tr, i) => {
        const sk = state.skillsAdvanced[i];
        if (sk && isSkillInCareer(sk.nom)) tr.classList.add('skill-in-career');
    });
}

function renderCareerAdvGhosts() {
    const tbody = document.getElementById('tbody-career-adv-ghost');
    if (!tbody) return;

    const career = getActiveCareerData();
    if (!career || !window.WFRP_SKILLS) { tbody.innerHTML = ''; return; }

    const rang = getActiveRang();
    const allSkills         = getCareerAllSkills(career, rang);
    const basicBaseNoms     = new Set(BASIC_SKILLS.map(s => skillBaseNom(s.nom)));
    const purchasedNoms     = new Set(state.skillsAdvanced.map(s => s.nom.toLowerCase()));
    const purchasedBaseNoms = new Set(state.skillsAdvanced.map(s => skillBaseNom(s.nom)));

    const ghosts = allSkills.filter(s => {
        const base = skillBaseNom(s);
        if (basicBaseNoms.has(base)) return false;
        if (isOpenCareerSlot(s)) return !purchasedBaseNoms.has(base);
        return !expandChoiceSkill(s).some(opt => purchasedNoms.has(opt.toLowerCase()));
    });

    if (ghosts.length === 0) { tbody.innerHTML = ''; return; }

    tbody.innerHTML = ghosts.map(nom => {
        const isOpen   = isOpenCareerSlot(nom);
        const base     = skillBaseNom(nom);
        const found    = WFRP_SKILLS.find(s => skillBaseNom(s.nom) === base || skillBaseNom(s.group || '') === base);
        const carac    = found?.carac || 'int';
        const caracVal = getCaracTotal(carac);
        const cls      = `sk-ghost-row${isOpen ? ' sk-ghost-open' : ''}`;
        const title    = isOpen
            ? 'Slot ouvert — cliquez pour choisir une spécialisation dans le journal XP'
            : 'Non achetée — cliquez pour l\'ouvrir dans le journal XP';
        return `<tr class="${cls}" data-ghost-nom="${esc(nom)}" data-ghost-open="${isOpen}" title="${title}" role="button" tabindex="0">
            <td class="sk-nom">${esc(nom)}</td>
            <td class="sk-carac-lbl">${CARAC_LABELS[carac]}</td>
            <td class="sk-carac-val">${caracVal}</td>
            <td><input class="sk-adv" type="number" disabled value="0" tabindex="-1"></td>
            <td class="sk-total">${caracVal}</td>
            <td></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.sk-ghost-row').forEach(tr => {
        const handler = () => {
            const careerNom = tr.dataset.ghostNom;
            const isOpen    = tr.dataset.ghostOpen === 'true';
            const base      = careerNom.split('(')[0].trim();
            // Trouver le nom de groupe exact dans WFRP_SKILLS (casse correcte)
            const wfrpGroup = window.WFRP_SKILLS?.find(s =>
                (s.group || '').toLowerCase() === base.toLowerCase()
            )?.group || base;
            // Pour un slot fixe avec spec (ex: "Langue (Noblesse)"), pré-remplir la spec
            const specPart = !isOpen && careerNom.includes('(') && !careerNom.includes(' ou ')
                ? (careerNom.match(/\(([^)]+)\)/)?.[1] ?? null) : null;
            showXpForm({ type: 'skill-adv', group: wfrpGroup, spec: specPart });
        };
        tr.addEventListener('click', handler);
        tr.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') handler(); });
    });
}

function buildCareerDatalist() {
    const dl = document.getElementById('career-names-list');
    if (!dl || !window.WFRP_CAREERS) return;
    dl.innerHTML = WFRP_CAREERS.map(c => `<option value="${esc(c.nom)}">`).join('');
}

// Construit le HTML d'une liste de chips (compétences ou talents) pour un rang,
// en tenant compte des overrides et du mode édition.
function renderCareerChips(career, rang, variant, kind, editing) {
    const baseItems = (kind === 'skills' ? variant?.skills : variant?.talents) || [];
    const o         = getOverrides(career.id, rang);
    const removed   = o ? (kind === 'skills' ? o.skillsRemoved : o.talentsRemoved) : [];
    const added     = o ? (kind === 'skills' ? o.skillsAdded   : o.talentsAdded)   : [];
    const removedSet = new Set(removed.map(s => s.toLowerCase()));
    const isTalent  = (kind === 'talents');

    const chips = [];

    // Chips officielles (non retirées en mode normal ; retirées affichées barrées en édition)
    baseItems.forEach(item => {
        const isRem = removedSet.has(item.toLowerCase());
        if (isRem && !editing) return;
        const baseCls = `career-tag${isTalent ? ' career-tag-talent' : ''}${isRem ? ' career-tag-removed' : ''}`;
        const talAttr = isTalent && !isRem
            ? ` data-talent="${esc(item)}" role="button" tabindex="0" title="Voir la description"` : '';
        const actionBtn = editing
            ? `<button class="career-tag-action" data-rang="${rang}" data-kind="${kind}" data-action="${isRem ? 'restore' : 'remove'}" data-name="${esc(item)}" title="${isRem ? 'Restaurer' : 'Retirer'}">${isRem ? '↺' : '×'}</button>`
            : '';
        chips.push(`<span class="${baseCls}"${talAttr}>${esc(item)}${actionBtn}</span>`);
    });

    // Chips ajoutées (★)
    added.forEach(item => {
        const baseCls = `career-tag career-tag-added${isTalent ? ' career-tag-talent' : ''}`;
        const talAttr = isTalent
            ? ` data-talent="${esc(item)}" role="button" tabindex="0" title="Voir la description"` : '';
        const actionBtn = editing
            ? `<button class="career-tag-action" data-rang="${rang}" data-kind="${kind}" data-action="remove-added" data-name="${esc(item)}" title="Retirer cet ajout">×</button>`
            : '';
        chips.push(`<span class="${baseCls}"${talAttr}><span class="career-tag-added-mark">★</span> ${esc(item)}${actionBtn}</span>`);
    });

    if (editing) {
        const listAttr = kind === 'skills' ? ' list="wfrp-skills-list"' : ' list="wfrp-talents-list"';
        const label = kind === 'skills' ? 'une compétence' : 'un talent';
        chips.push(`<span class="career-add-row">
            <input class="career-add-input" type="text"${listAttr}
                   data-rang="${rang}" data-kind="${kind}"
                   placeholder="+ Ajouter ${label}…" autocomplete="off">
        </span>`);
    }

    return chips.length ? chips.join('') : '<em>—</em>';
}

function renderCareerDetail() {
    const panel = document.getElementById('career-detail-panel');
    if (!panel) return;

    const career = getActiveCareerData();
    if (!career) {
        panel.style.display = 'none';
        applyCareerHighlights();
        renderCareerAdvGhosts();
        return;
    }

    const rang = getActiveRang();
    const variantsCurrent = getRangVariants(career, rang);
    const currentVariant  = getActiveVariantForRang(career, rang) || variantsCurrent[0];
    if (!currentVariant) {
        panel.style.display = 'none';
        applyCareerHighlights();
        renderCareerAdvGhosts();
        return;
    }

    ensureSkillsDatalist();
    ensureTalentsDatalist();

    const caracLabels = (career.carac || []).map(c => CARAC_LABELS[c] || c).join(', ') || '—';

    // Bandeau prérequis pour les sous-carrières (ex: Prêtre-Forgeron de Vaul exige Mage (HE) rang 2)
    let prereqHtml = '';
    if (career.prereq) {
        prereqHtml = `
        <div class="career-prereq-banner" title="Prérequis d'entrée dans cette sous-carrière">
            <span class="career-prereq-icon">⚑</span>
            Prérequis : <strong>${esc(career.prereq.career)}</strong> — rang ${esc(career.prereq.minRang)} minimum
        </div>`;
    }

    // Sections par rang (cumulatif rang 1 → rang courant)
    let rangsHtml = '';
    for (let r = 1; r <= rang; r++) {
        const variants = getRangVariants(career, r);
        if (variants.length === 0) continue;

        const isPast    = r < rang;
        const chosen    = getActiveVariantForRang(career, r);
        const displayed = chosen || variants[0];
        const editing   = isEditingRang(career.id, r);
        const modified  = hasOverrides(career.id, r);

        // Sélecteur de variante si > 1 variante pour ce rang
        let variantPicker = '';
        if (variants.length > 1) {
            const noneOpt = chosen
                ? ''
                : '<option value="">— Variante à choisir —</option>';
            variantPicker = `
            <select class="career-variant-sel" data-rang="${r}" title="Choisir la variante de ce rang">
                ${noneOpt}
                ${variants.map(v =>
                    `<option value="${esc(v.titre)}" ${chosen?.titre === v.titre ? 'selected' : ''}>${esc(v.titre)}</option>`
                ).join('')}
            </select>`;
        }

        const skillsH  = renderCareerChips(career, r, displayed, 'skills',  editing);
        const talentsH = renderCareerChips(career, r, displayed, 'talents', editing);

        const statusBadge = isPast
            ? '<span class="career-rang-acquired">✓ acquis</span>'
            : '<span class="career-rang-current">◆ en cours</span>';

        const modifiedBadge = modified
            ? `<span class="career-rang-modified" title="Ce rang a été personnalisé sur cette fiche">✎ modifié</span>`
            : '';
        const editBtn = `<button class="career-rang-edit-btn${editing ? ' career-rang-edit-btn-on' : ''}" data-rang="${r}" title="${editing ? "Terminer l'édition" : 'Personnaliser ce rang sur cette fiche'}">${editing ? '✓ Terminer' : '✎ Personnaliser'}</button>`;

        rangsHtml += `
        <div class="career-rang-section${isPast ? ' career-rang-past' : ''}${editing ? ' career-rang-editing' : ''}">
            <div class="career-rang-header">
                <span class="career-rang-badge${isPast ? ' career-rang-badge-past' : ''}">Rang ${r}</span>
                <span class="career-rang-titre">${esc(displayed.titre)}</span>
                ${statusBadge}
                ${modifiedBadge}
                ${variantPicker}
                ${editBtn}
            </div>
            <div class="career-detail-grid career-detail-grid-2col">
                <div class="career-detail-col">
                    <div class="career-detail-label">Compétences</div>
                    <div class="career-detail-tags">${skillsH}</div>
                </div>
                <div class="career-detail-col">
                    <div class="career-detail-label">Talents${editing ? '' : ' — cliquez pour la description'}</div>
                    <div class="career-detail-tags">${talentsH}</div>
                </div>
            </div>
        </div>`;
    }

    panel.style.display = '';
    panel.innerHTML = `
        <div class="fiche-section career-detail-section">
            <h2>${esc(career.nom)} — ${esc(currentVariant.titre)} <span class="career-rang-badge">Rang ${esc(rang)}</span></h2>
            ${prereqHtml}
            <div class="career-detail-carac">
                <span class="career-detail-label">Caractéristiques :</span>
                <span class="career-detail-carac-vals">${caracLabels}</span>
            </div>
            ${rangsHtml}
        </div>`;

    // Talent modal : ouvrir au clic sur un chip talent (sauf si on a cliqué sur le × d'édition)
    panel.querySelectorAll('[data-talent]').forEach(el => {
        el.addEventListener('click', e => {
            if (e.target.closest('.career-tag-action')) return;
            showTalentModal(el.dataset.talent);
        });
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') showTalentModal(el.dataset.talent); });
    });

    // Persister le choix de variante et re-rendre
    panel.querySelectorAll('.career-variant-sel').forEach(sel => {
        sel.addEventListener('change', () => {
            const r = +sel.dataset.rang;
            setChosenVariantTitre(career.id, r, sel.value || null);
            save();
            renderCareerDetail();
            renderAdvancedSkills();
        });
    });

    // Toggle du mode édition par rang
    panel.querySelectorAll('.career-rang-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const r = +btn.dataset.rang;
            setEditingRang(career.id, r, !isEditingRang(career.id, r));
            renderCareerDetail();
        });
    });

    // Actions sur les chips (retirer / restaurer / retirer un ajout)
    panel.querySelectorAll('.career-tag-action').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const r      = +btn.dataset.rang;
            const kind   = btn.dataset.kind;   // 'skills' | 'talents'
            const action = btn.dataset.action; // 'remove' | 'restore' | 'remove-added'
            const name   = btn.dataset.name;
            const o      = ensureOverrides(career.id, r);
            const removedKey = kind === 'skills' ? 'skillsRemoved' : 'talentsRemoved';
            const addedKey   = kind === 'skills' ? 'skillsAdded'   : 'talentsAdded';

            if (action === 'remove') {
                if (!o[removedKey].some(x => x.toLowerCase() === name.toLowerCase())) {
                    o[removedKey].push(name);
                }
            } else if (action === 'restore') {
                o[removedKey] = o[removedKey].filter(x => x.toLowerCase() !== name.toLowerCase());
            } else if (action === 'remove-added') {
                o[addedKey] = o[addedKey].filter(x => x !== name);
            }
            cleanupOverrides(career.id, r);
            invalidateCareerCache();
            save();
            renderCareerDetail();
            renderAdvancedSkills();
        });
    });

    // Champ d'ajout d'une compétence/talent au rang
    panel.querySelectorAll('.career-add-input').forEach(input => {
        const submit = () => {
            const val = input.value.trim();
            if (!val) return;
            const r    = +input.dataset.rang;
            const kind = input.dataset.kind;
            const o    = ensureOverrides(career.id, r);
            const addedKey = kind === 'skills' ? 'skillsAdded' : 'talentsAdded';
            if (!o[addedKey].some(x => x.toLowerCase() === val.toLowerCase())) {
                o[addedKey].push(val);
            }
            input.value = '';
            invalidateCareerCache();
            save();
            renderCareerDetail();
            renderAdvancedSkills();
        };
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
        input.addEventListener('blur', () => { if (input.value.trim()) submit(); });
    });

    applyCareerHighlights();
    renderCareerAdvGhosts();
}

let _careersBound = false;
function renderCareers() {
    const tbody = document.getElementById('tbody-careers');
    if (!tbody) return;
    tbody.innerHTML = state.careers.length === 0
        ? `<tr class="empty-row"><td colspan="4">Aucune ancienne carrière</td></tr>`
        : state.careers.map((c, i) => `<tr>
            <td><input class="career-input" type="text" data-idx="${i}" data-field="nom" value="${esc(c.nom)}" placeholder="Nom de la carrière" aria-label="Nom de la carrière, ligne ${i + 1}"></td>
            <td><input class="career-rang" type="number" data-idx="${i}" data-field="rang" min="1" max="4" value="${esc(c.rang ?? 1)}" aria-label="Rang, ligne ${i + 1}"></td>
            <td><input class="career-note" type="text" data-idx="${i}" data-field="note" value="${esc(c.note)}" placeholder="Notes…" aria-label="Notes, ligne ${i + 1}"></td>
            <td><button class="btn-rm" data-type="career" data-idx="${i}" title="Supprimer" aria-label="Supprimer la carrière, ligne ${i + 1}">×</button></td>
        </tr>`).join('');
    if (!_careersBound) {
        tbody.addEventListener('input', e => {
            const t = e.target;
            if (!t.matches('.career-input, .career-rang, .career-note')) return;
            const entry = state.careers[+t.dataset.idx];
            if (!entry) return;
            entry[t.dataset.field] = t.value;
            save();
        });
        tbody.addEventListener('click', e => {
            const btn = e.target.closest('.btn-rm[data-type="career"]');
            if (!btn || !tbody.contains(btn)) return;
            state.careers.splice(+btn.dataset.idx, 1);
            renderCareers();
            save();
        });
        _careersBound = true;
    }
}

// ── Talents ───────────────────────────────────────────

function _confirmNewTalent(inp) {
    const idx = +inp.dataset.idx;
    if (!state.talentsAcq[idx]) return;
    const nom = inp.value.trim();
    if (nom) { state.talentsAcq[idx].nom = nom; save(); }
    else state.talentsAcq.splice(idx, 1);
    renderTalents();
}

let _talentsBound = false;
function renderTalents() {
    const wrap = document.getElementById('talents-acq-chips');
    if (!wrap) return;

    wrap.innerHTML = state.talentsAcq.length === 0
        ? '<span class="talent-empty">Aucun talent acquis</span>'
        : state.talentsAcq.map((t, i) => {
            if (!t.nom) {
                // Entrée vide (ajout manuel en cours) → input de saisie
                return `<span class="talent-entry-new">
                    <input class="talent-name-new" type="text" data-idx="${i}"
                           placeholder="Nom du talent…" autocomplete="off" list="xf-talent-datalist"
                           aria-label="Nom du nouveau talent">
                    <button class="btn-rm talent-rm" data-idx="${i}" title="Annuler" aria-label="Annuler l'ajout du talent">×</button>
                </span>`;
            }
            const hors = t.note ? ` <span class="talent-hors-badge" title="${esc(t.note)}">!</span>` : '';
            return `<span class="talent-chip-wrap">
                <button class="talent-chip career-tag-talent" data-idx="${i}"
                        title="Cliquer pour voir la description">${esc(t.nom)}${hors}</button>
                <button class="btn-rm talent-rm" data-idx="${i}" title="Supprimer" aria-label="Supprimer le talent ${esc(t.nom)}">×</button>
            </span>`;
        }).join('');

    if (!_talentsBound) {
        wrap.addEventListener('click', e => {
            const rm = e.target.closest('.talent-rm');
            if (rm && wrap.contains(rm)) {
                state.talentsAcq.splice(+rm.dataset.idx, 1);
                renderTalents();
                save();
                return;
            }
            const chip = e.target.closest('.talent-chip');
            if (chip && wrap.contains(chip)) {
                const entry = state.talentsAcq[+chip.dataset.idx];
                if (entry) showTalentModal(entry.nom);
            }
        });
        // focusout > blur car blur ne bubble pas
        wrap.addEventListener('focusout', e => {
            if (e.target.classList?.contains('talent-name-new')) _confirmNewTalent(e.target);
        });
        wrap.addEventListener('keydown', e => {
            if (e.key === 'Enter' && e.target.classList?.contains('talent-name-new')) {
                e.preventDefault();
                e.target.blur();
            }
        });
        _talentsBound = true;
    }

    // Auto-focus de l'input d'ajout (effet visuel, pas un listener)
    wrap.querySelector('.talent-name-new')?.focus();
}

// ── Sorts ─────────────────────────────────────────────

let _sortsBound = false;
function renderSorts() {
    const tbody = document.getElementById('tbody-sorts');
    if (!tbody) return;
    tbody.innerHTML = state.sorts.length === 0
        ? `<tr class="empty-row"><td colspan="7">Aucun sort</td></tr>`
        : state.sorts.map((s, i) => `<tr>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="nom" value="${esc(s.nom)}" placeholder="Nom du sort" aria-label="Nom du sort, ligne ${i + 1}"></td>
            <td><select class="sort-vent" data-idx="${i}" aria-label="Vent de magie, ligne ${i + 1}">
                ${VENTS.map(v => `<option value="${v}" ${s.vent===v?'selected':''}>${v}</option>`).join('')}
            </select></td>
            <td><input class="sort-cn" type="number" data-idx="${i}" data-field="cn" min="0" value="${esc(s.cn ?? 0)}" style="width:52px" aria-label="Nombre de conjuration, ligne ${i + 1}"></td>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="portee" value="${esc(s.portee)}" placeholder="Portée" aria-label="Portée, ligne ${i + 1}"></td>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="duree" value="${esc(s.duree)}" placeholder="Durée" aria-label="Durée, ligne ${i + 1}"></td>
            <td><input class="sort-input sort-wide" type="text" data-idx="${i}" data-field="resume" value="${esc(s.resume)}" placeholder="Résumé de l'effet" aria-label="Résumé de l'effet, ligne ${i + 1}"></td>
            <td><button class="btn-rm" data-type="sort" data-idx="${i}" title="Supprimer" aria-label="Supprimer le sort, ligne ${i + 1}">×</button></td>
        </tr>`).join('');
    if (!_sortsBound) {
        tbody.addEventListener('input', e => {
            const t = e.target;
            if (!t.matches('.sort-input, .sort-cn')) return;
            const entry = state.sorts[+t.dataset.idx];
            if (!entry) return;
            entry[t.dataset.field] = t.value;
            save();
        });
        tbody.addEventListener('change', e => {
            const t = e.target;
            if (!t.classList.contains('sort-vent')) return;
            const entry = state.sorts[+t.dataset.idx];
            if (!entry) return;
            entry.vent = t.value;
            save();
        });
        tbody.addEventListener('click', e => {
            const btn = e.target.closest('.btn-rm[data-type="sort"]');
            if (!btn || !tbody.contains(btn)) return;
            state.sorts.splice(+btn.dataset.idx, 1);
            renderSorts();
            save();
        });
        _sortsBound = true;
    }
}

// ── Prières & Miracles ────────────────────────────────

let _prieresBound = false;
function renderPrieres() {
    const tbody = document.getElementById('tbody-prieres');
    if (!tbody) return;
    tbody.innerHTML = state.prieres.length === 0
        ? `<tr class="empty-row"><td colspan="4">Aucune prière / miracle</td></tr>`
        : state.prieres.map((p, i) => `<tr>
            <td><input class="priere-input" type="text" data-idx="${i}" data-field="nom" value="${esc(p.nom)}" placeholder="Nom" aria-label="Nom de la prière, ligne ${i + 1}"></td>
            <td><select class="priere-type" data-idx="${i}" aria-label="Type, ligne ${i + 1}">
                <option value="Bénédiction" ${p.type==='Bénédiction'?'selected':''}>Bénédiction</option>
                <option value="Miracle"     ${p.type==='Miracle'?'selected':''}>Miracle</option>
            </select></td>
            <td><input class="priere-input sort-wide" type="text" data-idx="${i}" data-field="resume" value="${esc(p.resume)}" placeholder="Résumé des effets" aria-label="Résumé des effets, ligne ${i + 1}"></td>
            <td><button class="btn-rm" data-type="priere" data-idx="${i}" title="Supprimer" aria-label="Supprimer la prière, ligne ${i + 1}">×</button></td>
        </tr>`).join('');
    if (!_prieresBound) {
        tbody.addEventListener('input', e => {
            const t = e.target;
            if (!t.classList.contains('priere-input')) return;
            const entry = state.prieres[+t.dataset.idx];
            if (!entry) return;
            entry[t.dataset.field] = t.value;
            save();
        });
        tbody.addEventListener('change', e => {
            const t = e.target;
            if (!t.classList.contains('priere-type')) return;
            const entry = state.prieres[+t.dataset.idx];
            if (!entry) return;
            entry.type = t.value;
            save();
        });
        tbody.addEventListener('click', e => {
            const btn = e.target.closest('.btn-rm[data-type="priere"]');
            if (!btn || !tbody.contains(btn)) return;
            state.prieres.splice(+btn.dataset.idx, 1);
            renderPrieres();
            save();
        });
        _prieresBound = true;
    }
}

// ── Journal XP ────────────────────────────────────────

function renderXpLog() {
    const tbody = document.getElementById('tbody-xp-log');
    if (!tbody) return;

    function rowHtml(e, i) {
        if (e.kind === 'gain') {
            return `<tr class="xp-gain-row">
                <td><span class="xp-gain-badge">Gain</span></td>
                <td><input class="xp-gain-raison" type="text" data-idx="${i}" value="${esc(e.raison ?? '')}" placeholder="Raison…" aria-label="Raison du gain, ligne ${i + 1}"></td>
                <td class="col-num"><input class="xp-gain-montant" type="number" data-idx="${i}" min="0" value="${esc(e.montant ?? 0)}" style="width:60px" aria-label="Montant du gain en XP, ligne ${i + 1}"></td>
                <td></td>
                <td><button class="btn-rm" data-type="xp" data-idx="${i}" title="Supprimer" aria-label="Supprimer le gain, ligne ${i + 1}">×</button></td>
            </tr>`;
        }
        if (e.applied) {
            return `<tr class="xp-applied-row">
                <td>${esc(e.type)}</td>
                <td>${esc(e.achat)} <span class="xp-applied-badge">✓</span></td>
                <td class="col-num">${esc(e.cout)}</td>
                <td><input class="xp-note" type="text" data-idx="${i}" data-field="note" value="${esc(e.note ?? '')}" placeholder="Note…" aria-label="Note, ligne ${i + 1}"></td>
                <td><button class="btn-rm" data-type="xp" data-idx="${i}" title="Supprimer (annule l'effet)" aria-label="Supprimer l'achat, ligne ${i + 1}">×</button></td>
            </tr>`;
        }
        return `<tr>
            <td><select class="xp-type-sel" data-idx="${i}" aria-label="Type de dépense, ligne ${i + 1}">
                ${XP_TYPES.map(t => `<option value="${t}" ${e.type===t?'selected':''}>${t}</option>`).join('')}
            </select></td>
            <td><input class="xp-achat" type="text" data-idx="${i}" data-field="achat" value="${esc(e.achat ?? '')}" placeholder="Achat (ex: +5 CC)" aria-label="Achat, ligne ${i + 1}"></td>
            <td><input class="xp-cout" type="number" data-idx="${i}" data-field="cout" min="0" value="${esc(e.cout ?? 0)}" style="width:60px" aria-label="Coût en XP, ligne ${i + 1}"></td>
            <td><input class="xp-note" type="text" data-idx="${i}" data-field="note" value="${esc(e.note ?? '')}" placeholder="Note…" aria-label="Note, ligne ${i + 1}"></td>
            <td><button class="btn-rm" data-type="xp" data-idx="${i}" title="Supprimer" aria-label="Supprimer la dépense, ligne ${i + 1}">×</button></td>
        </tr>`;
    }

    tbody.innerHTML = state.xpLog.length === 0
        ? `<tr class="empty-row"><td colspan="5">Aucune entrée enregistrée</td></tr>`
        : state.xpLog.map(rowHtml).join('');

    if (!renderXpLog._bound) {
        tbody.addEventListener('input', e => {
            const t = e.target;
            const entry = state.xpLog[+t.dataset.idx];
            if (!entry) return;
            if (t.classList.contains('xp-gain-raison'))       { entry.raison  = t.value;             save();  return; }
            if (t.classList.contains('xp-gain-montant'))      { entry.montant = +t.value || 0;       recalc(); return; }
            if (t.classList.contains('xp-achat'))             { entry.achat   = t.value;             save();  return; }
            if (t.classList.contains('xp-cout'))              { entry.cout    = +t.value || 0;       recalc(); return; }
            if (t.classList.contains('xp-note'))              { entry.note    = t.value;             save();  return; }
        });
        tbody.addEventListener('change', e => {
            const t = e.target;
            if (!t.classList.contains('xp-type-sel')) return;
            const entry = state.xpLog[+t.dataset.idx];
            if (!entry) return;
            entry.type = t.value;
            recalc();
        });
        tbody.addEventListener('click', e => {
            const btn = e.target.closest('.btn-rm[data-type="xp"]');
            if (!btn || !tbody.contains(btn)) return;
            const idx = +btn.dataset.idx;
            const entry = state.xpLog[idx];
            if (entry?.applied) revertXpEntry(entry);
            state.xpLog.splice(idx, 1);
            renderXpLog();
            recalc();
        });
        renderXpLog._bound = true;
    }
}

function showXpGainForm() {
    const form = document.getElementById('xp-gain-form');
    if (!form) return;
    form.style.display = 'block';
    form.innerHTML = `
        <div class="xp-gain-form-inner">
            <input type="text" id="xg-raison" placeholder="Raison du gain (ex: fin de session)…" style="flex:1">
            <input type="number" id="xg-montant" placeholder="XP" min="1" style="width:80px">
            <button class="btn-add" id="xg-save-btn">Ajouter</button>
            <button class="btn-rm" id="xg-cancel-btn" title="Annuler" aria-label="Annuler">×</button>
        </div>`;
    document.getElementById('xg-raison').focus();
    document.getElementById('xg-save-btn').addEventListener('click', () => {
        const raison  = document.getElementById('xg-raison').value.trim();
        const montant = +document.getElementById('xg-montant').value || 0;
        if (!raison || !montant) return;
        state.xpLog.unshift({ kind: 'gain', raison, montant });
        renderXpLog();
        recalc();
        form.style.display = 'none';
    });
    document.getElementById('xg-cancel-btn').addEventListener('click', () => {
        form.style.display = 'none';
    });
    document.getElementById('xg-raison').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('xg-montant').focus();
    });
    document.getElementById('xg-montant').addEventListener('keydown', e => {
        if (e.key === 'Enter') document.getElementById('xg-save-btn').click();
    });
}

// ── Sections optionnelles ─────────────────────────────

function applyOptVisible() {
    Object.entries(state.optVisible).forEach(([id, visible]) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    });
}

// ── Persistence ───────────────────────────────────────

export function exportData() {
    return {
        nom:           getVal('nom'),
        race:          getVal('race'),
        carriere:      getVal('carriere'),
        rang:          getVal('rang'),
        blessuresAct:  getVal('blessures-act'),
        resilience:    getVal('resilience'),
        determination: getVal('determination'),
        chance:        getVal('chance'),
        destin:        getVal('destin'),
        corruption:    getVal('corruption'),
        possessions:   getVal('possessions'),
        carac:          state.carac,
        skillsBasic:    state.skillsBasic,
        skillsAdvanced: state.skillsAdvanced,
        careers:        state.careers,
        talentsAcq:     state.talentsAcq,
        talentsAvail:   state.talentsAvail,
        sorts:          state.sorts,
        prieres:        state.prieres,
        xpLog:          state.xpLog,
        customSpecs:    state.customSpecs,
        customTalents:  state.customTalents,
        chosenVariants: state.chosenVariants,
        careerOverrides:state.careerOverrides,
        optVisible:     state.optVisible,
    };
}

function exportToFile() {
    const APP_VERSION_FICHE = document.querySelector('.nav-version')?.textContent?.trim() || '';
    const payload = {
        _format:     'wfrp4-fiche',
        _version:    1,
        _app:        APP_VERSION_FICHE,
        _charId:     _charParam || 'test',
        _exportedAt: new Date().toISOString(),
        ...exportData(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)],
                          { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const jour = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `fiche-${payload._charId}-${jour}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFromFile(file) {
    let payload;
    try {
        payload = JSON.parse(await file.text());
    } catch {
        alert("Fichier illisible : ce n'est pas un JSON valide.");
        return;
    }
    if (payload?._format !== 'wfrp4-fiche') {
        alert("Ce fichier n'est pas un export de fiche de personnage.");
        return;
    }
    if (!confirm("Remplacer la fiche actuelle par le contenu de ce fichier ? "
               + "L'état actuel sera perdu.")) return;

    resetState();
    applyData(payload);
    renderAll();
    recalc();          // recalc() appelle save(), qui propage vers le cloud
    updatePageTitle();
    updateCharacterPortrait();
}

// Debounce local de 400 ms : évite un JSON.stringify + setItem à chaque keystroke.
// Cloud save reste à 2 s. saveNow() reste utilisable pour les actions discrètes
// (ajout d'item, toggle) qui doivent être persistées sans attendre.
// Pendant le rendu initial et le chargement cloud, les helpers appellent recalc(),
// qui se termine par save(). Sans cette garde, le simple fait d'OUVRIR une fiche la
// marquait comme modifiée : la copie locale paraissait alors plus fraîche que le
// cloud, et une visite suivante repoussait ce cache par-dessus les modifications
// d'un autre. Consulter une fiche pouvait donc en détruire le contenu.
let _suppressSave = false;
function withoutSaving(fn) {
    _suppressSave = true;
    try { fn(); } finally { _suppressSave = false; }
}

let _saveLocalTimer = null;
function save() {
    if (_suppressSave) return;
    clearTimeout(_saveLocalTimer);
    _saveLocalTimer = setTimeout(saveNow, 400);
}

// `_dirty` remplace la comparaison d'horodatages entre `_savedAt` (horloge du
// client) et `updatedAt` (horloge du serveur), qui n'était pas fiable. Le drapeau
// dit une chose vérifiable : cette copie locale porte des modifications qui n'ont
// pas encore atteint le cloud. Il est posé à l'écriture locale et levé par
// markCloudSaved(), appelée par fiche-cloud.js après une écriture réussie.
function writeLocal(dirty) {
    const data = exportData();
    localStorage.setItem(STORAGE_KEY,
        JSON.stringify({ _savedAt: Date.now(), _dirty: dirty, ...data }));
    return data;
}

export function markCloudSaved() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const local = JSON.parse(raw);
        local._dirty = false;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(local));
    } catch { /* cache illisible : sans conséquence, il sera réécrit */ }
}

function saveNow() {
    if (_saveLocalTimer) { clearTimeout(_saveLocalTimer); _saveLocalTimer = null; }
    const data = writeLocal(true);

    // Cloud save debounced 2 s — cloudSave importé de fiche-cloud.js.
    // `saveNow._t` est remis à null au déclenchement : sans cela il resterait un
    // identifiant vrai indéfiniment, et flushAll() croirait avoir une écriture en
    // attente à chaque passage en arrière-plan.
    clearTimeout(saveNow._t);
    saveNow._t = setTimeout(() => { saveNow._t = null; cloudSave?.(data); }, 2000);
}

// Vidage complet avant disparition de la page : local ET cloud. `beforeunload`
// seul ne suffisait pas — saveNow() y réarmait un minuteur cloud de 2 s qui ne se
// déclenchait jamais, donc la dernière modification n'atteignait jamais Firestore.
// `pagehide` et `visibilitychange` sont par ailleurs les seuls événements fiables
// sur mobile, où l'onglet peut être supprimé sans émettre `beforeunload`.
function flushAll() {
    const enAttente = _saveLocalTimer !== null;
    if (_saveLocalTimer) { clearTimeout(_saveLocalTimer); _saveLocalTimer = null; }
    let data;
    if (enAttente) data = writeLocal(true);

    // Rien à envoyer si aucune modification n'est en attente côté cloud.
    if (!enAttente && !saveNow._t) return;
    clearTimeout(saveNow._t);
    saveNow._t = null;
    cloudSave?.(data ?? exportData());
}

window.addEventListener('pagehide', flushAll);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
});

function updatePageTitle() {
    const nomVal = (document.getElementById('nom')?.value || '').trim();
    const titleEl = document.getElementById('fiche-page-title');
    if (titleEl) {
        titleEl.textContent = nomVal || 'Fiche de Personnage';
    }
    document.title = nomVal ? `${nomVal} — Fiche de Personnage` : "Fiche de Personnage — L'Ennemi Intérieur";
}

function updateCharacterPortrait() {
    const portraitEl = document.getElementById('fiche-portrait');
    if (!portraitEl) return;

    // Resolve key: first try URL param, then lowercase stripped name input
    let charKey = (_charParam || '').toLowerCase().trim();
    if (!PORTRAIT_KEYS.includes(charKey)) {
        const nomVal = (document.getElementById('nom')?.value || '').toLowerCase().trim();
        const nomClean = stripAccents(nomVal);
        charKey = nomClean;
    }

    const portrait = PORTRAITS[charKey];
    if (portrait) {
        portraitEl.classList.remove('character-portrait--placeholder');
        portraitEl.innerHTML = `<img src="${portrait.src}" alt="${esc(portrait.alt)}" loading="lazy">`;
    } else {
        portraitEl.classList.add('character-portrait--placeholder');
        portraitEl.innerHTML = '📜';
    }
}

function resetState() {
    invalidateCareerCache();
    CARACS.forEach(c => { state.carac[c] = { base: 0, adv: 0 }; });
    state.skillsBasic    = {};
    state.skillsAdvanced.length = 0;
    state.careers.length        = 0;
    state.talentsAcq.length     = 0;
    state.talentsAvail.length   = 0;
    state.sorts.length          = 0;
    state.prieres.length        = 0;
    state.xpLog.length          = 0;
    state.customSpecs           = {};
    state.customTalents         = {};
    state.chosenVariants        = {};
    state.careerOverrides       = {};
    Object.keys(state.optVisible).forEach(k => { state.optVisible[k] = false; });
}

function applyData(d) {
    if (!d) return;
    invalidateCareerCache();
    setVal('nom',           d.nom);
    setVal('race',          d.race);
    setVal('carriere',      d.carriere);
    setVal('rang',          d.rang);
    setVal('blessures-act', d.blessuresAct);
    setVal('resilience',    d.resilience);
    setVal('determination', d.determination);
    setVal('chance',        d.chance);
    setVal('destin',        d.destin);
    setVal('corruption',    d.corruption);
    setVal('possessions',   d.possessions);

    if (d.carac) {
        CARACS.forEach(c => {
            state.carac[c] = { base: d.carac[c]?.base ?? 0, adv: d.carac[c]?.adv ?? 0 };
            setVal(`base-${c}`, state.carac[c].base);
            setVal(`adv-${c}`,  state.carac[c].adv);
        });
    }
    if (d.skillsBasic)    Object.assign(state.skillsBasic, d.skillsBasic);
    if (d.skillsAdvanced) state.skillsAdvanced.push(...d.skillsAdvanced);
    if (d.careers)        state.careers.push(...d.careers);
    if (d.talentsAcq)     state.talentsAcq.push(...d.talentsAcq);
    if (d.talentsAvail)   state.talentsAvail.push(...d.talentsAvail);
    if (d.sorts)          state.sorts.push(...d.sorts);
    if (d.prieres)        state.prieres.push(...d.prieres);
    if (d.xpLog)          state.xpLog.push(...d.xpLog);
    // Migration : ancien xpTotal manuel → entrée gain si aucun gain dans le journal
    if (d.xpTotal && +d.xpTotal > 0 && !state.xpLog.some(e => e.kind === 'gain')) {
        state.xpLog.unshift({ kind: 'gain', raison: 'XP initial (migré)', montant: +d.xpTotal });
    }
    if (d.customSpecs)     Object.assign(state.customSpecs, d.customSpecs);
    if (d.customTalents)   Object.assign(state.customTalents, d.customTalents);
    if (d.chosenVariants)  Object.assign(state.chosenVariants, d.chosenVariants);
    if (d.careerOverrides) Object.assign(state.careerOverrides, d.careerOverrides);
    if (d.optVisible)      Object.assign(state.optVisible, d.optVisible);
    updatePageTitle();
    updateCharacterPortrait();
}

// Re-rendu complet de la fiche depuis `state`. Appelée après tout
// remplacement global de l'état : chargement cloud, chargement local, import.
function renderAll() {
    buildBasicSkills();
    renderCareerDetail();
    renderAdvancedSkills();
    renderCareers();
    renderTalents();
    renderSorts();
    renderPrieres();
    renderXpLog();
    applyOptVisible();
}

function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        applyData(JSON.parse(raw));
    } catch (err) {
        // localStorage corrompu (crash navigateur, extension capricieuse) :
        // fallback sur un état neuf plutôt que planter le boot de la fiche.
        console.warn('[fiche] localStorage illisible, reset', err);
        resetState();
    }
}

// Appelée par fiche-cloud.js quand la fiche Firestore est disponible
// cloudMillis : timestamp Firestore en ms (updatedAt.toMillis())
export async function ficheLoadCloud(data, cloudMillis) {
    await dbLoadingPromise;

    // Le cloud est la source de vérité, à une exception près : une copie locale
    // portant des modifications qui ne l'ont jamais atteint (`_dirty`). On ne
    // compare plus `_savedAt` à `updatedAt` — deux horloges différentes, dont l'une
    // était stampée par la simple ouverture de la fiche.
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            const local = JSON.parse(raw);
            if (local._dirty === true) {
                console.warn('[fiche] modifications locales non synchronisées : envoi au cloud');
                cloudSave?.(exportData());
                isCloudLoaded = true;
                return;
            }
        } catch { /* cache illisible : le cloud fait foi */ }
    }

    // Le rendu appelle recalc(), donc save() : le neutraliser, sinon charger une
    // fiche la marquerait aussitôt comme modifiée.
    withoutSaving(() => {
        resetState();
        applyData(data);
        renderAll();
        recalc();
    });
    isCloudLoaded = true;
    // Miroir local propre : il reflète le cloud, il n'a rien en attente.
    localStorage.setItem(STORAGE_KEY,
        JSON.stringify({ _savedAt: cloudMillis || Date.now(), _dirty: false, ...data }));
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
    ['carriere','rang','blessures-act','resilience','determination','chance','destin','corruption','possessions']
        .forEach(id => document.getElementById(id)?.addEventListener('input', save));

    document.getElementById('nom')?.addEventListener('input', () => {
        updatePageTitle();
        updateCharacterPortrait();
        save();
    });

    // Panneau référence carrière
    // Le changement de carrière ou de rang change le set "dans la carrière" :
    // invalider AVANT le re-render, sinon renderCareerDetail lit le cache obsolète.
    ['carriere','rang'].forEach(id =>
        document.getElementById(id)?.addEventListener('input', () => {
            invalidateCareerCache();
            renderCareerDetail();
        }));
    ['race'].forEach(id => document.getElementById(id)?.addEventListener('input', recalc));

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
        renderTalents(); save();
    });
    document.getElementById('btn-add-sort')?.addEventListener('click', () => {
        state.sorts.push({ nom:'', vent:'Aqshy', cn:0, portee:'', duree:'', resume:'' });
        renderSorts(); save();
    });
    document.getElementById('btn-add-priere')?.addEventListener('click', () => {
        state.prieres.push({ nom:'', type:'Bénédiction', resume:'' });
        renderPrieres(); save();
    });
    document.getElementById('btn-add-xp-gain')?.addEventListener('click', showXpGainForm);
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

    // Sauvegarde locale & Export / Import
    document.getElementById('btn-export-fiche')?.addEventListener('click', exportToFile);
    document.getElementById('btn-import-fiche')?.addEventListener('click',
        () => document.getElementById('file-import-fiche')?.click());
    document.getElementById('file-import-fiche')?.addEventListener('change', e => {
        const f = e.target.files?.[0];
        if (f) importFromFile(f);
        e.target.value = '';   // permet de réimporter le même fichier
    });
}

// ── Init ──────────────────────────────────────────────

// Chargement paresseux de la base de carrières (JSON ~280 KB).
// On l'attache à window pour rester compatible avec tout le code qui lit
// directement window.WFRP_CAREERS.
async function loadCareersData() {
    if (window.WFRP_CAREERS) return;
    try {
        const res = await fetch('js/data/careers.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        window.WFRP_CAREERS = await res.json();
    } catch (e) {
        console.error('Impossible de charger careers.json :', e);
        window.WFRP_CAREERS = [];
    }
}

// Idem pour la base de compétences (~20 KB). Migré de skills.js (script
// classique) vers skills.json pour homogénéité avec careers.json et
// validation JSON.parse en CI.
async function loadSkillsData() {
    if (window.WFRP_SKILLS) return;
    try {
        const res = await fetch('js/data/skills.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        window.WFRP_SKILLS = await res.json();
        // Dérivé : liste des groupes ayant au moins une spécialisation.
        window.WFRP_SKILL_GROUPS_WITH_SPECS = [...new Set(
            window.WFRP_SKILLS.filter(s => s.spec).map(s => s.group)
        )];
    } catch (e) {
        console.error('Impossible de charger skills.json :', e);
        window.WFRP_SKILLS = [];
        window.WFRP_SKILL_GROUPS_WITH_SPECS = [];
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await dbLoadingPromise;
    buildCareerDatalist();
    // Rendu initial neutralisé côté sauvegarde : afficher une fiche n'est pas la
    // modifier. C'est ce qui marquait le cache local comme plus frais que le cloud.
    withoutSaving(() => {
        if (!isCloudLoaded) {
            load();             // charger l'état en premier
            renderAll();        // puis rendre avec les valeurs restaurées
        }
        bindAll();
        recalc();
    });
    updatePageTitle();
    updateCharacterPortrait();
});

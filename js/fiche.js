import { esc, stripAccents, parseCSV } from './utils.js';
import { cloudSave, stageFicheDraft } from './fiche-client-bridge.js';
import { confirmTextAction } from './ui-confirm.js';
import { activeCareerRank, findCareerByName, getActiveVariantForRang as getActiveVariantForRangModel, getCareerCaracs as getCareerCaracsModel, getCareerSkillSets, getCareerTalentSets, getEffectiveCaracs as getEffectiveCareerCaracs, getEffectiveSkills as getEffectiveCareerSkills, getRangVariants, getVariantsToConsider as getVariantsToConsiderModel } from './fiche/career-model.js';
import { BASIC_SKILLS, basicRowFor as findBasicRow, basicSkillNom as resolveBasicSkillNom } from './fiche/basic-skills.js';
import { canonicalSkillNom as legacyCanonicalSkillNom, expandChoiceSkill, isOpenCareerSlot, OPEN_SPEC_PATTERN, sameSkill as legacySameSkill, skillBaseNom } from './fiche/skill-names.js';
import { CARAC_XP_BANDS, SKILL_XP_BANDS, careerRankXpCost, miracleXpCost as calculateMiracleXpCost, spellXpCost as calculateSpellXpCost, talentXpCost, xpBandCost } from './fiche/xp.js';
import { createPublishedCatalogueEngine } from './fiche/published-catalogue-engine.js';
import { publishedSkillRows, primarySkillLabel } from './catalogue/skill-forms.js';
import { createCareerViewer } from './fiche/career-viewer.js';
import { migrateFicheDocument } from './fiche-schema.js';
import { talentChoices } from './mobile/fiche-aptitudes-model.js';
import { talentNameKey as talentNomKey } from './fiche/career-model.js';

// Promesse de chargement des bases de données JSON et statut du cloud
let _ruleCatalog = null;
let _publishedCatalogue = null;
let _talentSheetSnapshot = null;
let _equipmentCatalogue = null;
let _activeFicheRole = 'joueur';
let _localCommandEngine = null;
let _serverBaselineData = null;
let _correctionDraftItems = [];
let _correctionConflicts = [];
let _correctionReasonDraft = '';
let _canImportFiche = false;
let _careerViewer = null;
export const dbLoadingPromise = Promise.all([loadCareersData(), loadSkillsData(), loadRuleCatalog()]);
export let isCloudLoaded = false;


// ── Constantes ────────────────────────────────────────

const CARACS = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const CARAC_LABELS = { cc:'CC', ct:'CT', f:'F', e:'E', i:'I', ag:'Ag', dex:'Dex', int:'Int', fm:'FM', soc:'Soc' };
const MOUVEMENT = {
    humain:4, 'elfe-sylvain':5, 'haut-elfe':5, halfelin:4, ogre:6,
    elfe:5, halfling:4, nain:3, // rétrocompat anciennes sauvegardes
};
const _charParam = new URLSearchParams(window.location.search).get('char');

const PORTRAITS = {
    bhelgi:  { src: 'img/Bhelgi.webp',  alt: 'Bhelgi'  },
    caelel:  { src: 'img/Caelel.webp',  alt: 'Caelel'  },
    elysia:  { src: 'img/Elysia.webp',  alt: 'Elysia'  },
    hellaya: { src: 'img/Hellaya.webp', alt: 'Hellaya' },
    wren:    { src: 'img/Wren.webp',    alt: 'Wren'    },
};
const PORTRAIT_KEYS = Object.keys(PORTRAITS);

// Slot de carrière ouvert : "(au choix)" ou catégorie générique à choisir

const VENTS = ['Aqshy','Azyr','Chamon','Ghur','Ghyran','Hysh','Shyish','Ulgu','Qhaysh','Magie Commune','Autre'];

async function loadRuleCatalog() {
    try {
        const [rulesResponse, catalogueResponse, talentResponse, equipmentResponse] = await Promise.all([
            fetch('js/data/fiche-catalog.json'),
            fetch('js/catalogue/referentiel-public.json'),
            fetch('js/catalogue/talents-sheet-snapshot.json'),
            fetch('js/data/equipment-catalog.json'),
        ]);
        if (!rulesResponse.ok || !catalogueResponse.ok || !talentResponse.ok || !equipmentResponse.ok) return null;
        [_ruleCatalog, _publishedCatalogue, _talentSheetSnapshot, _equipmentCatalogue] = await Promise.all([
            rulesResponse.json(), catalogueResponse.json(), talentResponse.json(), equipmentResponse.json(),
        ]);
        _publishedCatalogue = window.FICHE_PUBLIC_CATALOGUE || _publishedCatalogue;
        window.FICHE_CATALOG = _ruleCatalog;
        window.FICHE_PUBLIC_CATALOGUE = _publishedCatalogue;
        _spellCache = Array.isArray(_ruleCatalog.spells) ? _ruleCatalog.spells : [];
        _miracleCache = Array.isArray(_ruleCatalog.miracles) ? _ruleCatalog.miracles : [];
        _localCommandEngine = null;
        window.FICHE_CATALOG_VERSION = `skills:${_publishedCatalogue.catalogVersion}|rules:${_ruleCatalog.catalogVersion}`;
        return _ruleCatalog;
    } catch { return null; }
}

function getLocalCommandEngine() {
    if (!_ruleCatalog?.catalogVersion || !_publishedCatalogue?.catalogVersion || !_talentSheetSnapshot
        || !Array.isArray(window.WFRP_CAREERS) || !Array.isArray(window.WFRP_SKILLS)) return null;
    _localCommandEngine ??= createPublishedCatalogueEngine({
        catalogue: _publishedCatalogue,
        careers: window.WFRP_CAREERS,
        skills: window.WFRP_SKILLS,
        spells: _ruleCatalog,
        talentSheetSnapshot: _talentSheetSnapshot,
        equipmentCatalogue: _equipmentCatalogue,
    });
    return _localCommandEngine;
}

export function setPublishedFicheCatalogue(catalogue) {
    if (!catalogue || typeof catalogue.catalogVersion !== 'string') return false;
    let nextEngine;
    try {
        nextEngine = createPublishedCatalogueEngine({
            catalogue,
            careers: window.WFRP_CAREERS,
            skills: window.WFRP_SKILLS,
            spells: _ruleCatalog,
            talentSheetSnapshot: _talentSheetSnapshot,
            equipmentCatalogue: _equipmentCatalogue,
        });
    } catch { return false; }
    _publishedCatalogue = catalogue;
    window.FICHE_PUBLIC_CATALOGUE = catalogue;
    _localCommandEngine = nextEngine;
    if (_ruleCatalog?.catalogVersion) window.FICHE_CATALOG_VERSION = `skills:${catalogue.catalogVersion}|rules:${_ruleCatalog.catalogVersion}`;
    invalidateCareerCache();
    buildBasicSkills();
    renderAdvancedSkills();
    applyCareerHighlights();
    renderCareerAdvGhosts();
    if (document.getElementById('xf-group')) updateXfTarget();
    withoutSaving(recalc);
    renderCareerDetail();
    _careerViewer?.update();
    setFicheRole(_activeFicheRole, { allowImport: _canImportFiche });
    return true;
}

// ── Moteur XP ─────────────────────────────────────────

// Barème officiel par tranche de 5 avances (0–5, 6–10, … 66–70) ; même table
// pour les compétences de base et avancées. Hors carrière : coût ×2.
// ── Carrière active ────────────────────────────────────

function getActiveCareerData() {
    if (!window.WFRP_CAREERS) return null;
    return findCareerByName(WFRP_CAREERS, getVal('carriere'));
}

function getActiveRang() {
    // Le rang max dépend de la carrière (Mage HE va jusqu'à 5, les autres à 4).
    const career = getActiveCareerData();
    return activeCareerRank(career, getVal('rang'));
}

// ── Variantes de rang ──────────────────────────────────
// Certains rangs ont plusieurs entrées (variantes par race / supplément).
// L'utilisateur peut en choisir une dans le panneau de référence ;
// le choix est persisté dans state.chosenVariants[careerId][rang].

function setChosenVariantTitre(careerId, rang, titre) {
    if (!state.chosenVariants[careerId]) state.chosenVariants[careerId] = {};
    if (titre) state.chosenVariants[careerId][rang] = titre;
    else delete state.chosenVariants[careerId][rang];
    invalidateCareerCache();
}

// Renvoie la variante choisie pour ce rang, ou null si l'utilisateur n'a pas choisi
// (ou s'il n'y a qu'une variante — pas besoin de choix).
function getActiveVariantForRang(career, rang) {
    return getActiveVariantForRangModel(career, rang, state.chosenVariants);
}

// Variantes à considérer comme "dans la carrière" : la choisie si choix, sinon toutes.
// Comportement généreux par défaut — évite les faux négatifs pendant que la joueuse
// achète des compétences avant d'avoir formalisé la variante avec le MJ.
function getVariantsToConsider(career, rang) {
    return getVariantsToConsiderModel(career, rang, state.chosenVariants);
}

// ── Overrides par-fiche ────────────────────────────────
// Le MJ peut retirer ou ajouter manuellement une compétence/talent sur un rang
// donné de la carrière, sans modifier la DB globale. Stocké dans
// state.careerOverrides[careerId][rang] = { skillsRemoved, skillsAdded, talentsRemoved, talentsAdded,
// caracs? } — `caracs`, s'il est présent, remplace la liste des caractéristiques du rang.

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
        && !o.talentsRemoved.length && !o.talentsAdded.length && !o.caracs) {
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
                 || o.talentsRemoved.length || o.talentsAdded.length || o.caracs));
}

// Caractéristiques du rang : celles de la variante, sauf si la fiche les a remplacées.
function getEffectiveCaracs(career, rang, variant) {
    return getEffectiveCareerCaracs(career, rang, variant, state.careerOverrides);
}

// Listes effectives : (skills/talents de la variante) − retirées + ajoutées.
// Les overrides s'appliquent au rang, indépendamment de la variante choisie.
function getEffectiveSkills(career, rang, variant) {
    return getEffectiveCareerSkills(career, rang, variant, state.careerOverrides);
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
    return getCareerSkillSets(career, rang, state.chosenVariants, state.careerOverrides, getLocalCommandEngine()?.skillResolver);
}

function _buildCareerTalentSets(career, rang) {
    return getCareerTalentSets(career, rang, state.chosenVariants, state.careerOverrides, getLocalCommandEngine()?.talentResolver);
}

function _buildCareerCaracs(career, rang) {
    return getCareerCaracsModel(career, rang, state.chosenVariants, state.careerOverrides);
}

// Caracs de carrière cumulées du rang 1 au rang donné.
function getCareerCaracs(career, rang) {
    return _memo(_careerCache.caracs, _careerKey(career.id, rang),
                 () => _buildCareerCaracs(career, rang));
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
    // Résolution par le référentiel, comme le serveur : une forme fusionnée par le MJ vaut son nom principal.
    const resolved = getLocalCommandEngine()?.skillResolver.resolve(nom);
    const canon = resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(nom);
    if (sets.exact.has(canon.toLowerCase())) return true;
    return sets.openBases.has(skillBaseNom(canon));
}

function isCaracInCareer(carac) {
    const career = getActiveCareerData();
    if (!career) return false;
    return getCareerCaracs(career, getActiveRang()).has(carac);
}

function isTalentInCareer(talentNom) {
    const career = getActiveCareerData();
    if (!career) return false;
    const sets = _memo(_careerCache.talents, _careerKey(career.id, getActiveRang()),
                       () => _buildCareerTalentSets(career, getActiveRang()));
    const match = getLocalCommandEngine()?.resolveTalent(talentNom);
    const nom = talentNomKey(match?.purchaseName || talentNom);
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
                    <option value="sort">Sort</option>
                    <option value="miracle">Miracle</option>
                    <option value="rang">Rang de carrière</option>
                    ${_activeFicheRole === 'mj' ? '<option value="libre">Dépense libre</option>' : ''}
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

function canonicalSkillNom(label) {
    const match = getLocalCommandEngine()?.skillResolver.resolve(label);
    return match?.status === 'resolved' ? match.entry.nom : legacyCanonicalSkillNom(label);
}

function sameSkill(left, right) {
    const resolver = getLocalCommandEngine()?.skillResolver;
    const a = resolver?.resolve(left), b = resolver?.resolve(right);
    return a?.entry && b?.entry ? a.entry.id === b.entry.id : legacySameSkill(left, right);
}

function publishedSkills() {
    const resolver = getLocalCommandEngine()?.skillResolver;
    return resolver ? publishedSkillRows(resolver) : (window.WFRP_SKILLS || []);
}

// Retourne les groupes uniques (triés) pour le type donné ('basic' | 'adv' | 'all')
function getSkillGroups(filter) {
    if (!window.WFRP_SKILLS) return [];
    const rows = publishedSkills();
    const filtered = filter === 'all' ? rows
        : rows.filter(s => filter === 'basic' ? s.basic : !s.basic);
    return [...new Set(filtered.map(s => s.group))].sort((a, b) => a.localeCompare(b, 'fr'));
}

// Retourne les spécialisations connues pour un groupe (basic + advanced) + '' si sans-spec
function getSpecsForGroup(group) {
    if (!window.WFRP_SKILLS) return [];
    return [...new Set(publishedSkills().filter(s => s.group === group && s.spec).map(s => s.spec))];
}

// Carac d'un groupe de compétence
// Nom complet sélectionné dans le formulaire XP
function getXfSkillFullNom() {
    const group = document.getElementById('xf-group')?.value || '';
    if (!group) return '';
    const specSel = document.getElementById('xf-spec-sel');
    if (!specSel) return group;
    const specVal = specSel.value;
    if (specVal === '_custom') {
        const custom = document.getElementById('xf-spec-custom')?.value?.trim() || '';
        return canonicalSkillNom(custom ? `${group} (${custom})` : group);
    }
    return canonicalSkillNom(specVal ? `${group} (${specVal})` : group);
}

// Avances actuelles du skill sélectionné dans le formulaire
function getXfSkillCurrentAdv(fullNom) {
    if (!fullNom) return 0;
    const row = basicRowFor(fullNom);
    if (row) return state.skillsBasic[row] || 0;
    return state.skillsAdvanced.find(s => sameSkill(s.nom, fullNom))?.adv || 0;
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
function buildTalentsDatalistHtml(purchases = false) {
    const base = getCareerTalentsBase();
    if (!base) return null;
    const engine = getLocalCommandEngine();
    const data = exportData();
    const sig = JSON.stringify([state.customTalents || {}, purchases, purchases ? [data.talentsAcq, data.carac, data.race, engine?.catalogVersion] : null]);
    if (_talentsDatalistCache.sig === sig) return _talentsDatalistCache.html;
    const set = new Set(purchases && engine?.talentResolver ? engine.talentResolver.entries.map(row => row.nom) : base);
    Object.entries(state.customTalents || {}).forEach(([baseName, specs]) =>
        specs.forEach(spec => set.add(`${baseName} (${spec})`))
    );
    const html = [...set].filter(name => {
        const status = purchases && engine?.talentResolver?.purchaseStatus?.(data, name);
        return !status || (status.known && !status.reached);
    }).map(name => engine?.resolveTalent(name)?.displayedName || name).sort((a, b) => a.localeCompare(b, 'fr'))
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
    const choice = talentChoices(window.WFRP_CAREERS, exportData(), groupBase, getLocalCommandEngine());
    const allSpecs = choice?.specs || [...new Set([...knownSpecs, ...customSpecs])];

    const specSel = document.createElement('select');
    specSel.id = 'xf-talent-spec-sel';
    specSel.className = 'xf-spec-sel';
    specSel.innerHTML =
        allSpecs.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('') +
        (choice?.free === false ? '' : '<option value="_custom">Autre (personnalisé)…</option>');
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
    const match = getLocalCommandEngine()?.resolveTalent(inp.value);
    const base = match?.sourceRule && match.open ? match.entry.nom : inp.value.trim().replace(OPEN_SPEC_PATTERN, '').trim();
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
    // La spé qui retombe sur la compétence de base (Chevaucher → Cheval) passe en tête.
    allSpecs.sort((a, b) => (canonicalSkillNom(`${group} (${b})`) === group)
                          - (canonicalSkillNom(`${group} (${a})`) === group));
    // La spécialité associée sur la fiche à la compétence de base passe devant.
    const basicSpec = state.basicSpecs[group];
    if (basicSpec) {
        const exact = allSpecs.findIndex(s => s.toLowerCase() === basicSpec.toLowerCase());
        const i = exact >= 0 ? exact
            : allSpecs.findIndex(s => sameSkill(`${group} (${s})`, `${group} (${basicSpec})`));
        allSpecs.unshift(i >= 0 ? allSpecs.splice(i, 1)[0] : basicSpec);
    }

    const specSel = document.createElement('select');
    specSel.id = 'xf-spec-sel';
    specSel.className = 'xf-spec-sel';
    specSel.innerHTML =
        (publishedSkills().some(row => row.group === group && !row.spec) ? '<option value="">Sans spécialité</option>' : '') +
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

// Titre du rang `rang` de la carrière active (variante choisie, sinon la première).
function getRangTitre(career, rang) {
    if (!career) return '';
    return (getActiveVariantForRang(career, rang) || getRangVariants(career, rang)[0])?.titre || '';
}

function buildXfRangPicker(wrap) {
    const career  = getActiveCareerData();
    const rang    = getActiveRang();
    const maxRang = career ? Math.max(...career.rangs.map(r => r.rang)) : 4;
    const canNext = rang < maxRang;
    const nextTitre = getRangTitre(career, rang + 1);

    const modeSel = document.createElement('select');
    modeSel.id = 'xf-rang-mode';
    modeSel.innerHTML =
        (canNext ? `<option value="next">Rang ${rang + 1}${nextTitre ? ` — ${esc(nextTitre)}` : ''}</option>` : '') +
        '<option value="new">Nouvelle carrière…</option>';
    wrap.appendChild(modeSel);

    const newWrap = document.createElement('span');
    newWrap.className = 'xf-target-wrap';
    newWrap.innerHTML = `
        <input type="text" id="xf-new-career" class="xf-talent-input" placeholder="Carrière…"
               list="career-names-list" autocomplete="off" aria-label="Nouvelle carrière">
        <label>Rang&nbsp;<input type="number" id="xf-new-rang" min="1" max="5" value="1" style="width:50px"></label>`;
    newWrap.style.display = canNext ? 'none' : '';
    wrap.appendChild(newWrap);

    modeSel.addEventListener('change', () => {
        newWrap.style.display = modeSel.value === 'new' ? '' : 'none';
        computeXfCost();
    });
}

function updateXfTarget() {
    const type = document.getElementById('xf-type').value;
    const wrap = document.getElementById('xf-target-wrap');
    wrap.innerHTML = '';
    const avLabel = document.querySelector('.xf-avances-label');
    if (avLabel) avLabel.style.display = ['rang', 'libre', 'sort', 'miracle'].includes(type) ? 'none' : '';

    if (type === 'rang') {
        buildXfRangPicker(wrap);

    } else if (type === 'sort') {
        wrap.innerHTML = `
            <input type="text" id="xf-sort" class="xf-talent-input" placeholder="Nom du sort…"
                   list="spell-names-list" autocomplete="off" aria-label="Sort à apprendre">
            <span id="xf-sort-info" class="xf-sort-info" aria-live="polite"></span>`;
        document.getElementById('xf-sort').addEventListener('input', computeXfCost);
        ensureSpellDatalist().then(computeXfCost);

    } else if (type === 'miracle') {
        wrap.innerHTML = `
            <input type="text" id="xf-miracle" class="xf-talent-input" placeholder="Nom du miracle…"
                   list="miracle-names-list" autocomplete="off" aria-label="Miracle à apprendre">
            <span id="xf-miracle-info" class="xf-sort-info" aria-live="polite"></span>`;
        document.getElementById('xf-miracle').addEventListener('input', computeXfCost);
        ensureMiracleDatalist().then(computeXfCost);

    } else if (type === 'libre') {
        // Saisie directe d'un libellé et d'un coût, sans effet sur la fiche.
        wrap.innerHTML = `
            <input type="text" id="xf-libre-achat" class="xf-talent-input" placeholder="Libellé (ex : dépenses séances 0 à 15)…" aria-label="Libellé de la dépense">
            <input type="number" id="xf-libre-cout" min="1" placeholder="XP" style="width:80px" aria-label="Coût en XP">`;
        document.getElementById('xf-libre-cout').addEventListener('input', computeXfCost);

    } else if (type === 'carac') {
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
        const html = buildTalentsDatalistHtml(true);
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
            const match = getLocalCommandEngine()?.resolveTalent(inp.value);
            const val = match?.sourceRule && match.open ? match.entry.nom : inp.value.trim().replace(OPEN_SPEC_PATTERN, '').trim();
            if (val && (match?.open || isTalentGroupOpen(val))) {
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
        if (!nom) return false;
        const row = basicRowFor(nom);
        return isSkillInCareer(nom) || (!!row && isSkillInCareer(basicSkillNom(row)));
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
            const currAdv = getXfSkillCurrentAdv(fullNom);
            cost = xpBandCost(SKILL_XP_BANDS, currAdv, avances, inCareer);
        }

    } else if (type === 'talent') {
        const nom = getXfTalentFullNom();
        const status = nom ? getLocalCommandEngine()?.talentResolver?.purchaseStatus?.(exportData(), nom) : null;
        cost = nom && status?.allowed !== false ? talentXpCost(inCareer) : 0;
        let notice = document.getElementById('xf-talent-info');
        if (!notice) {
            notice = document.createElement('p');
            notice.id = 'xf-talent-info';
            notice.className = 'xf-sort-info';
            notice.setAttribute('aria-live', 'polite');
            document.getElementById('xf-target-wrap')?.appendChild(notice);
        }
        notice.textContent = status ? [status.reason, `Limite d’achat : ${status.limitText || 'inconnue'}.`, status.warning].filter(Boolean).join(' ') : '';

    } else if (type === 'rang') {
        // Aperçu calculé à partir de l’état de fiche. Le serveur revalide toutes
        // les conditions et le tarif au moment de la commande.
        const career = getActiveCareerData();
        const engine = getLocalCommandEngine();
        const completion = career && engine?.evaluateCareerCompletion(exportData(), career, getActiveRang());
        cost = careerRankXpCost(!!completion?.complete);

    } else if (type === 'libre') {
        cost = Math.max(0, +document.getElementById('xf-libre-cout')?.value || 0);

    } else if (type === 'sort') {
        const nom  = document.getElementById('xf-sort')?.value || '';
        const sp   = findSpell(nom);
        const info = document.getElementById('xf-sort-info');
        const known = sp && state.sorts.some(s => sameSpellNom(findSpell(s.nom)?.nom || s.nom, sp.nom));
        if (sp && !sp.retired && !known) cost = calculateSpellXpCost(sp, state.sorts.map(s => findSpell(s.nom)).filter(Boolean));
        if (info) {
            info.textContent = !nom.trim() ? ''
                : !_spellCache ? 'Chargement de la liste des sorts…'
                : !sp ? 'Sort introuvable dans l\'aide de jeu'
                : sp.retired ? 'Sort retiré des nouveaux achats'
                : known ? 'Sort déjà connu'
                : `${sp.type} — NI ${sp.cn}`;
        }

    } else if (type === 'miracle') {
        // Nom libre : l'aide de jeu ne liste qu'une partie des miracles.
        const nom   = document.getElementById('xf-miracle')?.value?.trim() || '';
        const info  = document.getElementById('xf-miracle-info');
        const known = nom && state.prieres.some(p => sameSpellNom(p.nom, nom));
        if (nom && !known && findMiracle(nom)) cost = calculateMiracleXpCost(state.prieres);
        if (info) {
            info.textContent = !nom ? ''
                : known ? 'Déjà connu'
                : findMiracle(nom) ? 'Repris de l\'aide de jeu'
                : 'Absent du catalogue versionné — achat indisponible';
        }
    }

    costEl.textContent = cost > 0 ? cost : '—';
    const validate = document.getElementById('xf-validate');
    if (validate) validate.disabled = cost <= 0;

    // Badge carrière informatif
    const badge = document.getElementById('xf-career-badge');
    if (badge && type) {
        const career = getActiveCareerData();
        if (!career || ['rang', 'libre', 'sort', 'miracle'].includes(type)) {
            badge.textContent = '';
        } else {
            badge.textContent    = inCareer ? '✓ dans la carrière' : '✗ hors carrière';
            badge.dataset.career = inCareer ? 'yes' : 'no';
        }
    }

    return cost;
}

function ficheCommandStatus(message, error = false) {
    const status = document.getElementById('fiche-cloud-status') || document.getElementById('fiche-qa-state');
    if (status) {
        status.textContent = message;
        if (status.dataset) status.dataset.state = error ? 'error' : 'saving';
    }
}

async function executeFicheCommand(type, payload) {
    const controller = globalThis.ficheController;
    if (!controller?.executeOnlineCommand) {
        ficheCommandStatus('Les commandes serveur ne sont pas disponibles.', true);
        return null;
    }
    try {
        const result = await controller.executeOnlineCommand(type, payload);
        if (result.status === 'confirmed') {
            ficheCommandStatus('Commande confirmée par le serveur.');
            return result;
        }
        ficheCommandStatus(result.status === 'awaiting-snapshot'
            ? 'Commande envoyée — confirmation serveur en attente. Réessayez si nécessaire.'
            : 'Commande en attente — utilisez l’action de réessai avant toute nouvelle commande.', true);
        return null;
    } catch (error) {
        const kind = error?.details?.kind || error?.code || 'command-failed';
        const reason = typeof error?.details?.reason === 'string' && error.details.reason ? error.details.reason
            : kind === 'cancel-talent-limit' ? 'annulation bloquée par le plafond d’un talent'
                : kind === 'talent-limit' ? 'limite d’achat de ce talent atteinte' : kind;
        ficheCommandStatus('Commande refusée : ' + reason, true);
        return null;
    }
}

async function validateXpPurchase() {
    if (!['joueur', 'mj'].includes(_activeFicheRole)) return;
    const type = document.getElementById('xf-type')?.value || '';
    const count = Math.max(1, +document.getElementById('xf-avances')?.value || 1);
    const cost = computeXfCost();
    if (!type || cost <= 0) return;
    const payload = { count, expectedCost: cost, catalogVersion: getLocalCommandEngine()?.catalogVersion };
    let commandType = 'purchase';

    if (type === 'libre') {
        if (_activeFicheRole !== 'mj') return;
        const reason = document.getElementById('xf-libre-achat')?.value?.trim() || '';
        if (!reason) return;
        commandType = 'correct';
        Object.assign(payload, { kind: 'xp', amount: -cost, reason });
        delete payload.count;
        delete payload.expectedCost;
        delete payload.catalogVersion;
    } else if (type === 'carac') {
        const name = document.getElementById('xf-target')?.value;
        if (!name) return;
        Object.assign(payload, { kind: 'carac', name });
    } else if (type === 'skill-basic' || type === 'skill-adv') {
        const name = getXfSkillFullNom();
        if (!name) return;
        const basicRow = basicRowFor(name);
        const advancedMatches = state.skillsAdvanced.filter(row => sameSkill(row.nom, name));
        if (!basicRow && advancedMatches.length > 1) {
            ficheCommandStatus('Plusieurs lignes correspondent à cette compétence; correction MJ nécessaire.', true);
            return;
        }
        Object.assign(payload, {
            kind: 'skill',
            name,
            ...(basicRow ? { targetId: basicRow } : advancedMatches[0]?.id ? { targetId: advancedMatches[0].id } : {}),
        });
    } else if (type === 'talent') {
        const name = getXfTalentFullNom();
        if (!name) return;
        Object.assign(payload, { kind: 'talent', name, count: 1 });
    } else if (type === 'sort') {
        const spell = findSpell(document.getElementById('xf-sort')?.value || '');
        if (!spell) return;
        Object.assign(payload, { kind: 'sort', name: spell.nom, count: 1 });
    } else if (type === 'miracle') {
        const miracle = findMiracle(document.getElementById('xf-miracle')?.value || '');
        if (!miracle) return;
        Object.assign(payload, { kind: 'miracle', name: miracle.nom, count: 1 });
    } else if (type === 'rang') {
        const mode = document.getElementById('xf-rang-mode')?.value;
        let targetCareer = getActiveCareerData();
        let targetRank = getActiveRang() + 1;
        if (mode === 'new') {
            const careerName = document.getElementById('xf-new-career')?.value?.trim() || '';
            targetCareer = findCareerByName(window.WFRP_CAREERS || [], careerName);
            targetRank = Math.max(1, +document.getElementById('xf-new-rang')?.value || 1);
            if (!targetCareer) {
                ficheCommandStatus('Carrière cible absente du catalogue.', true);
                return;
            }
            payload.rankMode = 'changeCareer';
            payload.careerId = targetCareer.id;
        } else {
            if (!targetCareer || !getRangVariants(targetCareer, targetRank).length) return;
            payload.rankMode = 'advanceRank';
        }
        const currentCareer = getActiveCareerData();
        const completion = currentCareer && getLocalCommandEngine()?.evaluateCareerCompletion(
            exportData(), currentCareer, getActiveRang()
        );
        if (!completion) {
            ficheCommandStatus('Calcul de complétion indisponible; achat bloqué.', true);
            return;
        }
        payload.kind = 'rank';
        payload.targetRank = targetRank;
        payload.expectedCost = careerRankXpCost(completion.complete);
        payload.count = 1;
    } else return;

    const result = await executeFicheCommand(commandType, payload);
    if (result?.status === 'confirmed') document.getElementById('xp-add-form').style.display = 'none';
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
    basicSpecs:     {},   // { 'Divertissement': 'Chant' } — spécialité d'une compétence de base
    customTalents:  {},   // { 'Maître artisan': ['Apothicaire', 'Forgeron'], ... }
    chosenVariants: {},   // { careerId: { rang: variantTitre, ... }, ... }
    careerOverrides:{},   // { careerId: { rang: { skillsRemoved, skillsAdded, talentsRemoved, talentsAdded } } }
    optVisible:     { 'section-sorts': false, 'section-prieres': false },
    equipment: [],
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

// Chaque acquisition de « Dur à cuire » ajoute le Bonus d'Endurance.
function countTalent(nom) {
    const cible = stripAccents(nom).toLowerCase();
    return state.talentsAcq.filter(t => stripAccents(t.nom || '').trim().toLowerCase() === cible).length;
}

// Les Halfelins n'ajoutent pas leur Bonus de Force.
function updateBlessuresMax() {
    const race = document.getElementById('race')?.value || 'humain';
    const bf   = ['halfelin', 'halfling'].includes(race) ? 0 : getBonus('f');
    const be   = getBonus('e');
    setText('blessures-max', bf + 2 * be + getBonus('fm') + countTalent('Dur à cuire') * be);
}

function recalc() {
    // Totaux carac
    CARACS.forEach(c => setText(`total-${c}`, getCaracTotal(c)));

    // Dérivées
    const race = document.getElementById('race')?.value || 'humain';
    setText('mouvement', MOUVEMENT[race] ?? 4);
    updateBlessuresMax();

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

// Spécialité associée sur la fiche à une compétence de base (state.basicSpecs) :
// « Divertissement » + « Chant » se compare comme « Divertissement (Chant) ».
function basicSkillNom(nom) {
    return resolveBasicSkillNom(nom, state.basicSpecs);
}

// Ligne de compétence de base correspondant à un nom complet, ou null.
function basicRowFor(fullNom) {
    const entry = getLocalCommandEngine()?.skillResolver.resolve(fullNom)?.entry;
    if (entry && !entry.basic) return null;
    if (entry?.basic) return BASIC_SKILLS.find(skill => skill.nom === entry.group || skill.nom === entry.nom
        || skill.nom === `${entry.group} (Base)`)?.nom || findBasicRow(fullNom, state.basicSpecs);
    return findBasicRow(fullNom, state.basicSpecs);
}

// Spécialités connues d'une compétence de base (vide si elle n'en a pas).
function basicSpecOptions(nom) {
    if (nom.includes('(') || !window.WFRP_SKILLS) return [];
    const resolver = getLocalCommandEngine()?.skillResolver;
    if (!resolver) return WFRP_SKILLS.filter(s => s.basic && s.group === nom && s.spec).map(s => s.spec);
    return [...new Set(resolver.primaryEntries.filter(entry => entry.basic && entry.group === nom && entry.specialization)
        .map(entry => entry.nom.match(/\(([^()]+)\)$/u)?.[1] || entry.specialization))];
}

let _basicSkillsBound = false;
function buildBasicSkills() {
    const tbody = document.getElementById('tbody-skills-basic');
    if (!tbody) return;
    const resolver = getLocalCommandEngine()?.skillResolver;
    const shown = new Set();
    const basicRows = BASIC_SKILLS.filter(sk => {
        const match = resolver?.resolve(basicSkillNom(sk.nom));
        if (!match?.entry) return true;
        if (!match.entry.basic) return false;
        const canonicalRow = BASIC_SKILLS.find(row => row.nom === match.entry.group || row.nom === match.entry.nom
            || row.nom === `${match.entry.group} (Base)`);
        if (canonicalRow && canonicalRow.nom !== sk.nom) return false;
        if (shown.has(match.entry.id)) return false;
        shown.add(match.entry.id); return true;
    });
    tbody.innerHTML = basicRows.map(sk => {
        const displayName = canonicalSkillNom(sk.nom);
        const s     = sid(sk.nom);
        const adv   = state.skillsBasic[sk.nom] ?? 0;
        const specs = basicSpecOptions(sk.nom);
        const specH = specs.length ? `
                <input class="sk-basic-spec" type="text" data-skill="${sk.nom}" list="basic-spec-${s}"
                       value="${esc(state.basicSpecs[sk.nom] || '')}" placeholder="Spécialité…" autocomplete="off"
                       aria-label="Spécialité de ${esc(sk.nom)}">
                <datalist id="basic-spec-${s}">${specs.map(v => `<option value="${esc(v)}">`).join('')}</datalist>` : '';
        return `<tr data-skill="${sk.nom}">
            <td class="sk-nom">${esc(displayName)}${specH}</td>
            <td class="sk-carac-lbl" data-label="Carac.">${CARAC_LABELS[sk.carac]}</td>
            <td class="sk-carac-val" data-label="Valeur" id="sk-carac-${s}">0</td>
            <td data-label="Avances"><input class="sk-adv" type="number" data-skill="${sk.nom}" min="0" max="30" value="${esc(adv)}" aria-label="Avances en ${esc(sk.nom)}"></td>
            <td class="sk-total" data-label="Total" id="sk-total-${s}">0</td>
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
        tbody.addEventListener('change', e => {
            const t = e.target;
            if (!t.classList.contains('sk-basic-spec')) return;
            const spec = t.value.trim();
            if (spec) state.basicSpecs[t.dataset.skill] = spec;
            else delete state.basicSpecs[t.dataset.skill];
            applyCareerHighlights();
            save();
        });
        _basicSkillsBound = true;
    }
}

// ── Compétences avancées ──────────────────────────────

function ensureSkillsDatalist() {
    const dl = document.getElementById('wfrp-skills-list') || document.createElement('datalist');
    dl.id = 'wfrp-skills-list';
    if (window.WFRP_SKILLS) {
        dl.innerHTML = publishedSkills().map(s => `<option value="${esc(s.nom)}">`).join('');
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
                       data-idx="${i}" value="${esc(canonicalSkillNom(sk.nom))}" placeholder="Nom ou Groupe (Spécialisation)"
                       aria-label="Nom de la compétence, ligne ${i + 1}"></td>
            <td data-label="Carac."><select class="sk-carac-sel" data-idx="${i}" aria-label="Caractéristique, ligne ${i + 1}">
                ${CARACS.map(c => `<option value="${c}" ${sk.carac===c?'selected':''}>${CARAC_LABELS[c]}</option>`).join('')}
            </select></td>
            <td class="sk-carac-val" data-label="Valeur" id="adv-carac-val-${i}">0</td>
            <td data-label="Avances"><input class="sk-adv sk-adv-adv" type="number" data-idx="${i}" min="0" max="30" value="${esc(sk.adv ?? 0)}" aria-label="Avances, ligne ${i + 1}"></td>
            <td class="sk-total" data-label="Total" id="adv-total-${i}">0</td>
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
            const found = publishedSkills().find(s => s.nom === t.value);
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
let _talentModalRequestId = 0;

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
    const dialog = document.createElement('dialog');
    dialog.id = 'talent-modal';
    dialog.className = 'talent-modal-box';
    dialog.setAttribute('aria-label', 'Description du talent');
    dialog.innerHTML = `
        <button class="talent-modal-close" id="talent-modal-close" title="Fermer" aria-label="Fermer">×</button>
        <div id="talent-modal-body"></div>`;
    dialog.addEventListener('click', e => {
        if (e.target === dialog || e.target.id === 'talent-modal-close') dialog.close();
    });
    dialog.addEventListener('cancel', e => {
        e.preventDefault();
        dialog.close();
    });
    document.body.appendChild(dialog);
}

async function showTalentModal(nom) {
    ensureTalentModal();
    const modal = document.getElementById('talent-modal');
    const body  = document.getElementById('talent-modal-body');
    const requestId = ++_talentModalRequestId;
    body.innerHTML = '<p class="talent-modal-loading">Chargement…</p>';
    if (!modal.open) modal.showModal();

    const result = getLocalCommandEngine()?.resolveTalent(nom);
    if (requestId !== _talentModalRequestId || !modal.open) return;
    const _e = esc;
    if (result?.status === 'resolved') {
        const title = result.displayedName || result.entry?.nom || nom;
        const sourceLabel = result.descriptionSource === 'site' ? 'Description locale'
            : result.descriptionSource === 'sheet' ? 'Référentiel publié' : '';
        if (result.descriptionStatus === 'available') {
            body.innerHTML = `<h3 class="talent-modal-title">${_e(title)}</h3>
                <div class="talent-modal-field"><span class="talent-modal-value">${_e(result.description).replace(/\n/g, '<br>')}</span></div>
                ${result.limitText ? `<p>Limite d’achat : ${_e(result.limitText)}</p>` : ''}
                ${sourceLabel ? `<p class="talent-modal-source">${_e(sourceLabel)}</p>` : ''}`;
            return;
        }
        const message = result.descriptionStatus === 'source-unavailable'
            ? 'Le référentiel des descriptions est momentanément indisponible.'
            : result.descriptionStatus === 'empty-local' || result.descriptionStatus === 'empty-reference'
                ? 'Aucune description n’est renseignée pour ce talent.'
                : 'Aucune description publiée pour ce talent.';
        body.innerHTML = `<h3 class="talent-modal-title">${_e(title)}</h3><p><em>${_e(message)}</em></p>`;
        return;
    }
    if (result?.status === 'ambiguous') {
        body.innerHTML = `<h3 class="talent-modal-title">${_e(nom)}</h3><p><em>Ce nom correspond à plusieurs talents dans le référentiel.</em></p>`;
        return;
    }

    if (!_talentSheetSnapshot) {
        const td = await fetchTalentData();
        if (requestId !== _talentModalRequestId || !modal.open) return;
        if (td) {
            const nomIdx = td.headers.findIndex(h => h.toLowerCase() === 'nom');
            const titleIdx = nomIdx >= 0 ? nomIdx : 0;
            const row = td.data.find(r => (r[titleIdx] || '').toLowerCase() === nom.toLowerCase());
            if (row) {
                body.innerHTML = `<h3 class="talent-modal-title">${_e(row[titleIdx])}</h3>${td.headers.map((header, index) => {
                    if (index === titleIdx || !row[index]) return '';
                    return `<div class="talent-modal-field"><span class="talent-modal-label">${_e(header)}</span><span class="talent-modal-value">${_e(row[index]).replace(/\n/g, '<br>')}</span></div>`;
                }).join('')}`;
                return;
            }
            body.innerHTML = `<h3 class="talent-modal-title">${_e(nom)}</h3><p><em>Aucune description publiée pour ce talent.</em></p>`;
            return;
        }
        body.innerHTML = `<h3 class="talent-modal-title">${_e(nom)}</h3><p><em>Le référentiel des descriptions est momentanément indisponible.</em></p>`;
        return;
    }
    body.innerHTML = `<h3 class="talent-modal-title">${_e(nom)}</h3><p><em>Aucune description publiée pour ce talent.</em></p>`;
}

// ── Carrière — highlights & ghosts ────────────────────

function getCareerAllSkills(career, rang) {
    return _memo(_careerCache.allSkills, _careerKey(career.id, rang), () => {
        const seen = new Set(), noms = [];
        for (let r = 1; r <= rang; r++) {
            for (const rd of getVariantsToConsider(career, r)) {
                getEffectiveSkills(career, r, rd).forEach(s => {
                    const resolver = getLocalCommandEngine()?.skillResolver;
                    const slot = resolver?.resolveCareerSlot(s);
                    const labels = slot?.status === 'resolved' && slot.alternatives
                        ? slot.alternatives.map(item => item.entry.nom) : [primarySkillLabel(resolver, s, true)];
                    for (const label of labels) if (!seen.has(label.toLowerCase())) { seen.add(label.toLowerCase()); noms.push(label); }
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

    getCareerCaracs(career, rang).forEach(c => {
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
            return expandChoiceSkill(s, canonicalSkillNom).some(opt => {
                if (sameSkill(opt, basicSkillNom(nom))) return true;
                return isOpenCareerSlot(opt) && skillBaseNom(opt) === base;
            });
        });
        if (match || (state.basicSpecs[nom] && isSkillInCareer(basicSkillNom(nom)))) {
            tr.classList.add('skill-in-career');
        }
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
    const basicBaseNoms     = new Set(publishedSkills().filter(row => row.basic).map(row => skillBaseNom(row.nom)));
    const purchasedNoms     = new Set(state.skillsAdvanced.map(s => canonicalSkillNom(s.nom).toLowerCase()));
    const purchasedBaseNoms = new Set(state.skillsAdvanced.map(s => skillBaseNom(canonicalSkillNom(s.nom))));

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
        const found    = publishedSkills().find(s => skillBaseNom(s.nom) === base || skillBaseNom(s.group || '') === base);
        const carac    = found?.carac || 'int';
        const caracVal = getCaracTotal(carac);
        const cls      = `sk-ghost-row${isOpen ? ' sk-ghost-open' : ''}`;
        const title    = isOpen
            ? 'Slot ouvert — cliquez pour choisir une spécialisation dans le journal XP'
            : 'Non achetée — cliquez pour l\'ouvrir dans le journal XP';
        return `<tr class="${cls}" data-ghost-nom="${esc(nom)}" data-ghost-open="${isOpen}" title="${title}" role="button" tabindex="0">
            <td class="sk-nom">${esc(nom)}</td>
            <td class="sk-carac-lbl" data-label="Carac.">${CARAC_LABELS[carac]}</td>
            <td class="sk-carac-val" data-label="Valeur">${caracVal}</td>
            <td data-label="Avances"><input class="sk-adv" type="number" disabled value="0" tabindex="-1"></td>
            <td class="sk-total" data-label="Total">${caracVal}</td>
            <td></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.sk-ghost-row').forEach(tr => {
        const handler = () => {
            const careerNom = tr.dataset.ghostNom;
            const isOpen    = tr.dataset.ghostOpen === 'true';
            const base      = careerNom.split('(')[0].trim();
            // Trouver le nom de groupe exact dans WFRP_SKILLS (casse correcte)
            const wfrpGroup = publishedSkills().find(s =>
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
    const displayed = new Set();
    const displayLabel = item => isTalent ? item : primarySkillLabel(getLocalCommandEngine()?.skillResolver, item, true);

    // Chips officielles (non retirées en mode normal ; retirées affichées barrées en édition)
    baseItems.forEach(item => {
        const isRem = removedSet.has(item.toLowerCase());
        if (isRem && !editing) return;
        const label = displayLabel(item);
        if (!editing && displayed.has(label)) return;
        displayed.add(label);
        const baseCls = `career-tag${isTalent ? ' career-tag-talent' : ''}${isRem ? ' career-tag-removed' : ''}`;
        const talAttr = isTalent && !isRem
            ? ` data-talent="${esc(item)}" role="button" tabindex="0" title="Voir la description"` : '';
        const actionBtn = editing
            ? `<button class="career-tag-action" data-rang="${rang}" data-kind="${kind}" data-action="${isRem ? 'restore' : 'remove'}" data-name="${esc(item)}" title="${isRem ? 'Restaurer' : 'Retirer'}">${isRem ? '↺' : '×'}</button>`
            : '';
        chips.push(`<span class="${baseCls}"${talAttr}>${esc(label)}${actionBtn}</span>`);
    });

    // Chips ajoutées (★)
    added.forEach(item => {
        const label = displayLabel(item);
        if (!editing && displayed.has(label)) return;
        displayed.add(label);
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

// Caractéristiques d'un rang. En édition : une case par carac, cochée si elle
// fait partie du rang ; revenir à la liste officielle efface la personnalisation.
function renderCareerCaracs(career, rang, variant, editing) {
    const current  = getEffectiveCaracs(career, rang, variant);
    const modified = !!getOverrides(career.id, rang)?.caracs;
    if (!editing) {
        const labels = current.map(c => esc(CARAC_LABELS[c] || c)).join(', ') || '—';
        return `<span class="career-detail-carac-vals">${modified ? '<span class="career-tag-added-mark" title="Modifié sur cette fiche">★</span> ' : ''}${labels}</span>`;
    }
    return CARACS.map(c => `
        <label class="career-carac-toggle">
            <input type="checkbox" class="career-carac-cb" data-rang="${rang}" data-carac="${c}" ${current.includes(c) ? 'checked' : ''}>
            ${CARAC_LABELS[c]}
        </label>`).join('');
}

function renderCareerDetail() {
    const panel = document.getElementById('career-detail-panel');
    if (!panel) return;
    const viewerHost = document.getElementById('career-viewer-host');

    const career = getActiveCareerData();
    if (!career) {
        panel.style.display = 'none';
        if (viewerHost) viewerHost.style.display = 'none';
        applyCareerHighlights();
        renderCareerAdvGhosts();
        return;
    }

    const rang = getActiveRang();
    const variantsCurrent = getRangVariants(career, rang);
    const currentVariant  = getActiveVariantForRang(career, rang) || variantsCurrent[0];
    if (!currentVariant) {
        panel.style.display = 'none';
        if (viewerHost) viewerHost.style.display = 'none';
        applyCareerHighlights();
        renderCareerAdvGhosts();
        return;
    }

    ensureSkillsDatalist();
    ensureTalentsDatalist();

    const caracLabels = [...getCareerCaracs(career, rang)].map(c => CARAC_LABELS[c] || c).join(', ') || '—';

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

        const caracsH  = renderCareerCaracs(career, r, displayed, editing);
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
            <div class="career-rang-caracs">
                <span class="career-detail-label">Caractéristiques :</span>
                ${caracsH}
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

    if (viewerHost) viewerHost.style.display = '';
    if (!_careerViewer && viewerHost) _careerViewer = createCareerViewer({
        container: viewerHost,
        getContext: () => ({
            careers: Array.isArray(window.WFRP_CAREERS) ? window.WFRP_CAREERS : [],
            careerName: getVal('carriere'),
            rank: getActiveRang(),
            chosenVariants: state.chosenVariants,
            careerOverrides: state.careerOverrides,
            skillResolver: getLocalCommandEngine()?.skillResolver,
            resolveSkill: name => getLocalCommandEngine()?.resolveSkill(name),
            resolveTalent: name => getLocalCommandEngine()?.resolveTalent(name),
        }),
        onTalent: name => showTalentModal(name),
    });
    else _careerViewer?.update();

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

    // Cases des caractéristiques d'un rang en édition
    panel.querySelectorAll('.career-carac-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            const r       = +cb.dataset.rang;
            const variant = getActiveVariantForRang(career, r) || getRangVariants(career, r)[0];
            const picked  = [...panel.querySelectorAll(`.career-carac-cb[data-rang="${r}"]:checked`)]
                .map(x => x.dataset.carac);
            const base    = variant?.caracs || [];
            const o       = ensureOverrides(career.id, r);
            const same    = picked.length === base.length && picked.every(c => base.includes(c));
            if (same) delete o.caracs; else o.caracs = picked;
            cleanupOverrides(career.id, r);
            invalidateCareerCache();
            save();
            renderCareerDetail();
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
        : state.careers.map((c, i) => `<tr data-row-id="${esc(c.id ?? '')}">
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
                        title="Cliquer pour voir la description">${esc(getLocalCommandEngine()?.resolveTalent(t.nom)?.displayedName || t.nom)}${hors}</button>
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

    updateBlessuresMax(); // « Dur à cuire » modifie les Blessures max
}

// ── Sorts ─────────────────────────────────────────────

// Premier paragraphe d'un texte, ramené à une ligne et coupé à `max` caractères.
function firstParagraph(text, max = 200) {
    const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

// Onglet Magie : Nom, Type, NI, Portée, Cible, Durée, Description.
let _spellCache = null;

function spellKey(nom) { return stripAccents(String(nom || '').toLowerCase()).replace(/[’']/g, "'").trim(); }
function sameSpellNom(a, b) { return !!a && spellKey(a) === spellKey(b); }

async function fetchSpellData() {
    if (_spellCache) return _spellCache;
    const catalog = await loadRuleCatalog();
    return catalog && Array.isArray(catalog.spells) ? (_spellCache = catalog.spells) : null;
}

function findSpell(nom) {
    if (!_spellCache || !nom?.trim()) return null;
    return _spellCache.find(s => sameSpellNom(s.nom, nom) || (s.aliases || []).some(alias => sameSpellNom(alias, nom))) || null;
}

function spellVent(type) {
    const first = type.split(/\s[-–]\s/)[0].trim();
    const vent  = first === 'Uglu' ? 'Ulgu' : first;
    if (VENTS.includes(vent)) return vent;
    if (/haute magie|elfique/i.test(type)) return 'Qhaysh';
    return 'Magie Commune';
}

function spellEntry(sp) {
    return { nom: sp.nom, vent: spellVent(sp.type), cn: sp.cn, portee: sp.portee, duree: sp.duree,
             resume: firstParagraph(sp.desc) };
}

async function ensureSpellDatalist() {
    const spells = await fetchSpellData();
    if (!spells || document.getElementById('spell-names-list')) return;
    const dl = document.createElement('datalist');
    dl.id = 'spell-names-list';
    dl.innerHTML = spells.filter(s => !s.retired).map(s => `<option value="${esc(s.nom)}">${esc(s.type)}</option>`).join('');
    document.body.appendChild(dl);
}

let _sortsBound = false;
function renderSorts() {
    const tbody = document.getElementById('tbody-sorts');
    if (!tbody) return;
    tbody.innerHTML = state.sorts.length === 0
        ? `<tr class="empty-row"><td colspan="7">Aucun sort</td></tr>`
        : state.sorts.map((s, i) => `<tr>
            <td><input class="sort-input" type="text" data-idx="${i}" data-field="nom" value="${esc(s.nom)}" placeholder="Nom du sort" list="spell-names-list" autocomplete="off" aria-label="Nom du sort, ligne ${i + 1}"></td>
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
        ensureSpellDatalist();
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
            // Nom reconnu dans l'aide de jeu : on remplit le reste de la ligne.
            if (t.matches('.sort-input[data-field="nom"]')) {
                const entry = state.sorts[+t.dataset.idx];
                const sp    = findSpell(t.value);
                if (!entry || !sp) return;
                Object.assign(entry, spellEntry(sp));
                renderSorts();
                save();
                return;
            }
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

// Onglet Miracles : Nom, Portée, Cible, Durée, Effet (sans le dieu associé).
let _miracleCache = null;

async function fetchMiracleData() {
    if (_miracleCache) return _miracleCache;
    const catalog = await loadRuleCatalog();
    return catalog && Array.isArray(catalog.miracles) ? (_miracleCache = catalog.miracles) : null;
}

function findMiracle(nom) {
    if (!_miracleCache || !nom?.trim()) return null;
    return _miracleCache.find(m => sameSpellNom(m.nom, nom)) || null;
}

// Le tableau des prières n'a qu'une colonne de texte : portée, cible et durée y passent.
function miracleEntry(m) {
    const meta = [['Portée', m.portee], ['Cible', m.cible], ['Durée', m.duree]]
        .filter(([, v]) => v).map(([k, v]) => `${k} : ${v}`).join(' · ');
    const effet = firstParagraph(m.effet);
    return { nom: m.nom, type: 'Miracle', resume: [meta, effet].filter(Boolean).join(' — ') };
}

async function ensureMiracleDatalist() {
    const miracles = await fetchMiracleData();
    if (!miracles || document.getElementById('miracle-names-list')) return;
    const dl = document.createElement('datalist');
    dl.id = 'miracle-names-list';
    dl.innerHTML = miracles.map(m => `<option value="${esc(m.nom)}">`).join('');
    document.body.appendChild(dl);
}

let _prieresBound = false;
function renderPrieres() {
    const tbody = document.getElementById('tbody-prieres');
    if (!tbody) return;
    tbody.innerHTML = state.prieres.length === 0
        ? `<tr class="empty-row"><td colspan="4">Aucune prière / miracle</td></tr>`
        : state.prieres.map((p, i) => `<tr>
            <td><input class="priere-input" type="text" data-idx="${i}" data-field="nom" value="${esc(p.nom)}" placeholder="Nom" list="miracle-names-list" autocomplete="off" aria-label="Nom de la prière, ligne ${i + 1}"></td>
            <td><select class="priere-type" data-idx="${i}" aria-label="Type, ligne ${i + 1}">
                <option value="Bénédiction" ${p.type==='Bénédiction'?'selected':''}>Bénédiction</option>
                <option value="Miracle"     ${p.type==='Miracle'?'selected':''}>Miracle</option>
            </select></td>
            <td><input class="priere-input sort-wide" type="text" data-idx="${i}" data-field="resume" value="${esc(p.resume)}" placeholder="Résumé des effets" aria-label="Résumé des effets, ligne ${i + 1}"></td>
            <td><button class="btn-rm" data-type="priere" data-idx="${i}" title="Supprimer" aria-label="Supprimer la prière, ligne ${i + 1}">×</button></td>
        </tr>`).join('');
    if (!_prieresBound) {
        ensureMiracleDatalist();
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
            // Miracle reconnu dans l'aide de jeu : on remplit le reste de la ligne.
            if (t.matches('.priere-input[data-field="nom"]')) {
                const entry = state.prieres[+t.dataset.idx];
                const m     = findMiracle(t.value);
                if (!entry || !m) return;
                Object.assign(entry, miracleEntry(m));
                renderPrieres();
                save();
                return;
            }
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
            return `<tr class="xp-gain-row" data-row-id="${esc(e.id ?? '')}">
                <td><span class="xp-gain-badge">Gain</span></td>
                <td><span>${esc(e.raison ?? '')}</span></td>
                <td class="col-num">${esc(e.montant ?? 0)}</td>
                <td></td>
                <td></td>
            </tr>`;
        }
        if (e.applied) {
            return `<tr class="xp-applied-row" data-row-id="${esc(e.id ?? '')}">
                <td>${esc(e.type)}</td>
                <td>${esc(e.achat)} <span class="xp-applied-badge">✓</span></td>
                <td class="col-num">${esc(e.cout)}</td>
                <td>${esc(e.note ?? '')}</td>
                <td>${e.origin === 'command' && e.purchaseId && !e.cancelledByOperationId
                    ? `<button class="btn-rm" data-type="xp-cancel" data-purchase-id="${esc(e.purchaseId)}" title="Annuler cet achat" aria-label="Annuler l’achat ${esc(e.achat)}">×</button>` : ''}</td>
            </tr>`;
        }
        return `<tr data-row-id="${esc(e.id ?? '')}">
            <td>${esc(e.type ?? 'Autre')}</td>
            <td>${esc(e.achat ?? '')}</td>
            <td class="col-num">${esc(e.cout ?? 0)}</td>
            <td>${esc(e.note ?? '')}</td>
            <td></td>
        </tr>`;
    }

    tbody.innerHTML = state.xpLog.length === 0
        ? `<tr class="empty-row"><td colspan="5">Aucune entrée enregistrée</td></tr>`
        : state.xpLog.map(rowHtml).join('');

    if (!renderXpLog._bound) {
        tbody.addEventListener('click', e => {
            const btn = e.target.closest('.btn-rm[data-type="xp-cancel"]');
            if (!btn || !tbody.contains(btn)) return;
            if (_activeFicheRole !== 'mj' && _activeFicheRole !== 'joueur') return;
            void executeFicheCommand('cancel', { purchaseId: btn.dataset.purchaseId });
        });
        renderXpLog._bound = true;
    }
}

function showXpGainForm() {
    if (_activeFicheRole !== 'mj' && !_canImportFiche) return;
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
        if (!raison || !Number.isSafeInteger(montant) || montant < 1) return;
        void executeFicheCommand('gain', { amount: montant, reason: raison })
            .then(result => { if (result?.status === 'confirmed') form.style.display = 'none'; });
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
        basicSpecs:     state.basicSpecs,
        customTalents:  state.customTalents,
        chosenVariants: state.chosenVariants,
        careerOverrides:state.careerOverrides,
        optVisible:     state.optVisible,
        equipment:      state.equipment,
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
    if (_activeFicheRole !== 'mj' && !_canImportFiche) return;
    const reason = await confirmTextAction({
        titre: 'Importer une fiche',
        message: `Le contenu de « ${file.name} » sera transmis au serveur pour validation et remplacera la fiche actuelle.`,
        libelleAction: 'Importer',
        danger: true,
        input: { label: 'Motif de cet import MJ', placeholder: 'Motif requis', maxLength: 1000 },
    });
    if (typeof reason !== 'string' || !reason.trim()) return;
    const controller = globalThis.ficheController;
    const charId = controller?.getState()?.charId;
    if (!charId) return;

    const exportKeys = new Set([
        'nom', 'race', 'carriere', 'rang', 'blessuresAct', 'resilience', 'determination', 'chance',
        'destin', 'corruption', 'possessions', 'carac', 'skillsBasic', 'skillsAdvanced', 'careers',
        'talentsAcq', 'talentsAvail', 'sorts', 'prieres', 'xpLog', 'customSpecs', 'basicSpecs',
        'customTalents', 'chosenVariants', 'careerOverrides', 'optVisible', 'equipment',
    ]);
    const cleaned = Object.fromEntries(Object.entries(payload).filter(([key]) => exportKeys.has(key)));
    const migrated = await migrateFicheDocument({ schemaVersion: 1, revision: 1, data: cleaned }, { charId });
    if (!migrated.canApply || !migrated.document?.data) {
        alert('Import bloqué : le fichier comporte des anomalies à examiner avant migration.');
        return;
    }
    const importData = Object.fromEntries(Object.entries(migrated.document.data).filter(([key]) => exportKeys.has(key)));
    const result = await executeFicheCommand('import', { reason: reason.trim(), data: importData });
    if (result?.status === 'confirmed') ficheCommandStatus('Import confirmé par le serveur.');
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
    const data = exportData();
    // Enregistrer l’intention avant tout snapshot distant. Seul l’envoi réseau
    // est retardé; sinon une réponse reçue dans les 400 ms perd la frappe.
    stageFicheDraft?.(data);
    if (_activeFicheRole === 'mj') {
        syncCorrectionDraftFromForm();
        ensureCorrectionPanel();
    }
    clearTimeout(_saveLocalTimer);
    _saveLocalTimer = setTimeout(saveNow, 2000);
}

// `_dirty` remplace la comparaison d'horodatages entre `_savedAt` (horloge du
// client) et `updatedAt` (horloge du serveur), qui n'était pas fiable. Le drapeau
// dit une chose vérifiable : cette copie locale porte des modifications qui n'ont
// pas encore atteint le cloud. Il est posé à l'écriture locale et levé par
// markCloudSaved(), appelée par fiche-cloud.js après une écriture réussie.
function saveNow() {
    if (_saveLocalTimer) { clearTimeout(_saveLocalTimer); _saveLocalTimer = null; }
    const data = exportData();

    clearTimeout(saveNow._t);
    saveNow._t = null;
    void cloudSave?.(data);
}

// Vidage complet avant disparition de la page : local ET cloud. `beforeunload`
// seul ne suffisait pas — saveNow() y réarmait un minuteur cloud de 2 s qui ne se
// déclenchait jamais, donc la dernière modification n'atteignait jamais Firestore.
// `pagehide` et `visibilitychange` sont par ailleurs les seuls événements fiables
// sur mobile, où l'onglet peut être supprimé sans émettre `beforeunload`.
function flushAll() {
    const enAttente = _saveLocalTimer !== null || saveNow._t !== null;
    if (_saveLocalTimer) { clearTimeout(_saveLocalTimer); _saveLocalTimer = null; }
    const data = enAttente ? exportData() : undefined;

    // Rien à envoyer si aucune modification n'est en attente côté cloud.
    if (!enAttente && !saveNow._t) return;
    clearTimeout(saveNow._t);
    saveNow._t = null;
    cloudSave?.(data ?? exportData());
}
saveNow._t = null;

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
    state.basicSpecs            = {};
    state.customTalents         = {};
    state.chosenVariants        = {};
    state.careerOverrides       = {};
    state.equipment             = [];
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
    if (d.basicSpecs)      Object.assign(state.basicSpecs, d.basicSpecs);
    if (d.customTalents)   Object.assign(state.customTalents, d.customTalents);
    if (d.chosenVariants)  Object.assign(state.chosenVariants, d.chosenVariants);
    if (d.careerOverrides) Object.assign(state.careerOverrides, d.careerOverrides);
    if (d.optVisible)      Object.assign(state.optVisible, d.optVisible);
    if (Array.isArray(d.equipment)) state.equipment = globalThis.structuredClone(d.equipment);
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

// Le contrôleur fusionne explicitement les brouillons de champs avec le snapshot.
// Un ancien cache complet marqué dirty n'est jamais rejoué sur le serveur.
export async function ficheLoadCloud(data, isCurrent = () => true) {
    await dbLoadingPromise;
    if (!isCurrent()) return false;
    const focused = document.activeElement;
    const focusId = focused?.id || '';
    const focusRowId = focused?.closest?.('[data-row-id]')?.dataset.rowId || '';
    const focusClass = focused?.classList?.[0] || '';
    const focusField = focused?.dataset?.field || '';
    const selection = focused && typeof focused.selectionStart === 'number'
        ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
    if (_activeFicheRole === 'mj' && _serverBaselineData) syncCorrectionDraftFromForm();
    const remoteData = globalThis.structuredClone(data);
    _correctionDraftItems = _correctionDraftItems.filter(item =>
        JSON.stringify(readCorrectionPath(remoteData, item.pathParts)) !== JSON.stringify(item.value));
    _serverBaselineData = remoteData;
    _correctionConflicts = correctionDraftConflictsFor(remoteData);
    persistCorrectionDraft();
    const renderData = _activeFicheRole === 'mj' ? applyCorrectionOverlays(remoteData) : remoteData;

    // Le rendu appelle recalc(), donc save() : le neutraliser, sinon charger une
    // fiche la marquerait aussitôt comme modifiée.
    withoutSaving(() => {
        resetState();
        applyData(renderData);
        renderAll();
        recalc();
    });
    isCloudLoaded = true;
    let restore = focusId ? document.getElementById(focusId) : null;
    if (!restore && focusRowId && focusClass) {
        restore = [...document.querySelectorAll(`[data-row-id="${CSS.escape(focusRowId)}"] .${CSS.escape(focusClass)}`)]
            .find(element => !focusField || element.dataset.field === focusField);
    }
    restore?.focus({ preventScroll: true });
    if (selection && restore?.setSelectionRange) {
        try { restore.setSelectionRange(...selection); } catch { /* input type without selection */ }
    }
    return true;
}

export function clearFicheView() {
    _careerViewer?.destroy();
    _careerViewer = null;
    document.getElementById('fiche-correction-panel')?.remove();
    const viewerHost = document.getElementById('career-viewer-host');
    if (viewerHost) viewerHost.style.display = 'none';
    const talentModal = document.getElementById('talent-modal');
    if (talentModal?.open) talentModal.close();
    _serverBaselineData = null;
    _correctionDraftItems = [];
    _correctionConflicts = [];
    _correctionReasonDraft = '';
    withoutSaving(() => { resetState(); renderAll(); recalc(); });
    isCloudLoaded = false;
}

const _roleBaselineDisabled = new WeakMap();
function collectCorrectionBatchChanges() {
    if (!_serverBaselineData) return [];
    const base = _serverBaselineData;
    const next = exportData();
    const changes = [];
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    for (const key of ['carriere', 'rang']) {
        if (!same(base[key] ?? '', next[key] ?? '')) changes.push({ pathParts: [key], value: next[key] });
    }
    for (const carac of CARACS) {
        for (const field of ['base', 'adv']) {
            if (!same(base.carac?.[carac]?.[field], next.carac?.[carac]?.[field])) {
                changes.push({ pathParts: ['carac', carac, field], value: next.carac?.[carac]?.[field] });
            }
        }
    }
    const basicKeys = new Set([...Object.keys(base.skillsBasic || {}), ...Object.keys(next.skillsBasic || {})]);
    for (const key of basicKeys) {
        if (!same(base.skillsBasic?.[key] ?? 0, next.skillsBasic?.[key] ?? 0)) {
            changes.push({ pathParts: ['skillsBasic', key], value: next.skillsBasic?.[key] ?? 0 });
        }
    }
    const rowsById = (value, root) => {
        const oldRows = Array.isArray(base[root]) ? base[root] : [];
        const newRows = Array.isArray(value) ? value : [];
        const oldById = new Map(oldRows.filter(row => row?.id).map(row => [row.id, row]));
        const newById = new Map(newRows.filter(row => row?.id).map(row => [row.id, row]));
        for (const [id] of oldById) if (!newById.has(id)) changes.push({ pathParts: [root, id], value: null });
        for (const row of newRows) {
            if (!row?.id || String(row.id).startsWith('draft:')) {
                const withoutId = { ...row };
                delete withoutId.id;
                changes.push({ pathParts: [root, '@new'], value: withoutId });
                continue;
            }
            const old = oldById.get(row.id);
            if (!old) continue;
            const fields = {
                skillsAdvanced: ['nom', 'adv', 'carac'], careers: ['nom', 'rang'],
                talentsAcq: ['nom'], talentsAvail: ['nom'],
                sorts: ['nom', 'vent', 'cn', 'portee', 'duree', 'resume'],
                prieres: ['nom', 'type', 'resume'],
            }[root] || [];
            for (const field of fields) {
                if (!same(old[field] ?? null, row[field] ?? null)) {
                    changes.push({ pathParts: [root, row.id, field], value: row[field] ?? null });
                }
            }
        }
    };
    for (const root of ['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres']) rowsById(next[root], root);
    for (const key of new Set([...Object.keys(base.basicSpecs || {}), ...Object.keys(next.basicSpecs || {})])) {
        const before = base.basicSpecs?.[key] ?? null;
        const after = next.basicSpecs?.[key] ?? null;
        if (!same(before, after)) changes.push({ pathParts: ['basicSpecs', key], value: after });
    }
    for (const careerId of new Set([...Object.keys(base.chosenVariants || {}), ...Object.keys(next.chosenVariants || {})])) {
        for (const rank of new Set([...Object.keys(base.chosenVariants?.[careerId] || {}), ...Object.keys(next.chosenVariants?.[careerId] || {})])) {
            const before = base.chosenVariants?.[careerId]?.[rank] ?? null;
            const after = next.chosenVariants?.[careerId]?.[rank] ?? null;
            if (!same(before, after)) changes.push({ pathParts: ['chosenVariants', careerId, rank], value: after });
        }
    }
    for (const careerId of new Set([...Object.keys(base.careerOverrides || {}), ...Object.keys(next.careerOverrides || {})])) {
        for (const rank of new Set([...Object.keys(base.careerOverrides?.[careerId] || {}), ...Object.keys(next.careerOverrides?.[careerId] || {})])) {
            for (const field of ['caracs', 'skillsAdded', 'skillsRemoved', 'talentsAdded', 'talentsRemoved']) {
                const before = base.careerOverrides?.[careerId]?.[rank]?.[field] ?? null;
                const after = next.careerOverrides?.[careerId]?.[rank]?.[field] ?? null;
                if (!same(before, after)) changes.push({ pathParts: ['careerOverrides', careerId, rank, field], value: after });
            }
        }
    }
    return changes;
}

function correctionPathKey(pathParts) { return JSON.stringify(pathParts); }

function readCorrectionPath(data, pathParts) {
    const [root, id, field, nested] = pathParts;
    if (pathParts.length === 1) return data?.[root] ?? null;
    if (root === 'carac') return data?.carac?.[id]?.[field] ?? null;
    if (root === 'skillsBasic' || root === 'basicSpecs') return data?.[root]?.[id] ?? null;
    if (root === 'chosenVariants') return data?.chosenVariants?.[id]?.[field] ?? null;
    if (root === 'careerOverrides') return data?.careerOverrides?.[id]?.[field]?.[nested] ?? null;
    if (['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(root)) {
        const row = data?.[root]?.find(item => item?.id === id);
        return pathParts.length === 2 ? row ?? null : row?.[field] ?? null;
    }
    return null;
}

function applyCorrectionOverlays(data, items = _correctionDraftItems) {
    const next = globalThis.structuredClone(data);
    for (const item of items) {
        const [root, id, field, nested] = item.pathParts;
        if (item.value === null && ['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(root)
            && item.pathParts.length === 2) {
            next[root] = (next[root] || []).filter(row => row?.id !== id);
        } else if (['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(root)
            && item.pathParts.length === 2 && id === '@new') {
            next[root] = [...(next[root] || []), { ...item.value, id: `draft:${_correctionDraftItems.indexOf(item)}` }];
        } else if (['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(root)
            && item.pathParts.length === 2) {
            const rows = next[root] || [];
            const index = rows.findIndex(row => row?.id === id);
            if (index >= 0) rows[index] = { ...rows[index], ...item.value };
        } else if (['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(root)
            && item.pathParts.length === 3) {
            next[root] = (next[root] || []).map(row => row?.id === id ? { ...row, [field]: item.value } : row);
        } else if (root === 'carac') next.carac = { ...next.carac, [id]: { ...next.carac?.[id], [field]: item.value } };
        else if (root === 'skillsBasic' || root === 'basicSpecs') next[root] = { ...next[root], [id]: item.value };
        else if (root === 'chosenVariants') next.chosenVariants = { ...next.chosenVariants, [id]: { ...next.chosenVariants?.[id], [field]: item.value } };
        else if (root === 'careerOverrides') next.careerOverrides = {
            ...next.careerOverrides, [id]: { ...next.careerOverrides?.[id], [field]: { ...next.careerOverrides?.[id]?.[field], [nested]: item.value } },
        };
        else if (item.pathParts.length === 1) next[root] = item.value;
    }
    return next;
}

function syncCorrectionDraftFromForm() {
    if (!_serverBaselineData || _activeFicheRole !== 'mj') return;
    const detected = collectCorrectionBatchChanges();
    const byPath = new Map(_correctionDraftItems.map(item => [correctionPathKey(item.pathParts), item]));
    const next = [];
    for (const change of detected) {
        const key = correctionPathKey(change.pathParts);
        const previous = byPath.get(key);
        next.push({
            ...change,
            baseValue: previous?.baseValue ?? readCorrectionPath(_serverBaselineData, change.pathParts),
        });
    }
    _correctionDraftItems = next;
    _correctionConflicts = _correctionConflicts.filter(conflict => next.some(item => correctionPathKey(item.pathParts) === conflict.key));
    const reasonInput = document.getElementById('fiche-correction-reason');
    if (reasonInput) _correctionReasonDraft = reasonInput.value;
    persistCorrectionDraft();
}

function persistCorrectionDraft() {
    if (_activeFicheRole !== 'mj' || !globalThis.ficheController?.saveCorrectionDraft) return { ok: false, reason: 'not-authorized' };
    const result = !_correctionDraftItems.length && !_correctionReasonDraft
        ? (globalThis.ficheController.removeCorrectionDraft?.(), { ok: true })
        : globalThis.ficheController.saveCorrectionDraft({ reason: _correctionReasonDraft, items: _correctionDraftItems });
    const status = document.querySelector('#fiche-correction-panel .fiche-correction-persistence');
    if (status) status.textContent = result.ok
        ? (_correctionDraftItems.length || _correctionReasonDraft ? 'Brouillon de correction enregistré sur cet appareil.' : '')
        : result.reason === 'not-authorized' ? '' : 'Correction gardée en mémoire seulement — sauvegarde locale indisponible.';
    return result;
}

function correctionBatchChanges() {
    syncCorrectionDraftFromForm();
    return _correctionDraftItems.map(({ pathParts, value }) => ({ pathParts, value }));
}

function correctionDraftConflictsFor(remoteData) {
    const remaining = [];
    for (const item of _correctionDraftItems) {
        const remoteValue = readCorrectionPath(remoteData, item.pathParts);
        if (JSON.stringify(remoteValue) === JSON.stringify(item.value)) continue;
        if (JSON.stringify(remoteValue) !== JSON.stringify(item.baseValue)) {
            remaining.push({ key: correctionPathKey(item.pathParts), pathParts: item.pathParts,
                base: item.baseValue, local: item.value, server: remoteValue });
        }
    }
    return remaining;
}

function isSafePersistedCorrection(item) {
    if (!item || !Array.isArray(item.pathParts) || item.pathParts.length < 1 || item.pathParts.length > 4
        || item.pathParts.some(part => typeof part !== 'string' || !part || ['__proto__', 'constructor', 'prototype'].includes(part))) return false;
    return new Set([
        'carriere', 'rang', 'carac', 'skillsBasic', 'skillsAdvanced', 'careers', 'talentsAcq',
        'talentsAvail', 'sorts', 'prieres', 'basicSpecs', 'customSpecs', 'customTalents',
        'chosenVariants', 'careerOverrides', 'nom', 'race', 'blessuresAct', 'resilience',
        'determination', 'chance', 'destin', 'corruption', 'possessions', 'optVisible',
    ]).has(item.pathParts[0]) && Object.hasOwn(item, 'value') && Object.hasOwn(item, 'baseValue');
}

function renderCorrectionOverlay() {
    if (!_serverBaselineData || !_correctionDraftItems.length) return;
    const merged = applyCorrectionOverlays(_serverBaselineData);
    withoutSaving(() => { applyData(merged); renderAll(); recalc(); });
}

function ensureCorrectionPanel() {
    if (_activeFicheRole !== 'mj') return;
    const bar = document.getElementById('fiche-auth-bar') || document.querySelector('.fiche-page-header');
    if (!bar) return;
    let panel = document.getElementById('fiche-correction-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'fiche-correction-panel';
        panel.className = 'fiche-correction-panel';
        panel.innerHTML = '<label>Corrections MJ (motif requis) <input id="fiche-correction-reason" maxlength="1000" placeholder="Motif" autocomplete="off"></label><button type="button" id="fiche-correction-submit" class="fiche-auth-btn">Enregistrer les corrections</button>';
        const persistenceStatus = document.createElement('p');
        persistenceStatus.className = 'fiche-correction-persistence';
        persistenceStatus.setAttribute('aria-live', 'polite');
        panel.append(persistenceStatus);
        bar.append(panel);
        panel.querySelector('#fiche-correction-reason').value = _correctionReasonDraft;
        panel.querySelector('#fiche-correction-reason').addEventListener('input', event => {
            _correctionReasonDraft = event.target.value;
            persistCorrectionDraft();
        });
        panel.querySelector('#fiche-correction-submit').addEventListener('click', async () => {
            const reason = panel.querySelector('#fiche-correction-reason').value.trim();
            const changes = correctionBatchChanges();
            if (_correctionConflicts.length || !reason || !changes.length || changes.length > 50) {
                ficheCommandStatus(_correctionConflicts.length ? 'Résolvez les conflits de correction avant l’enregistrement.'
                    : changes.length > 50 ? 'Réduisez cette correction à 50 changements.' : 'Saisissez un motif et au moins une modification.', true);
                return;
            }
            const result = await executeFicheCommand('correct', { kind: 'batch', reason, changes });
            if (result?.status === 'confirmed') {
                _correctionDraftItems = [];
                _correctionConflicts = [];
                _correctionReasonDraft = '';
                globalThis.ficheController?.removeCorrectionDraft?.();
                panel.querySelector('#fiche-correction-reason').value = '';
                ensureCorrectionPanel();
            }
        });
    }
    let recovery = panel.querySelector('.fiche-correction-recovery');
    if (!recovery) {
        recovery = document.createElement('div');
        recovery.className = 'fiche-correction-recovery';
        panel.append(recovery);
    }
    recovery.replaceChildren();
    if (!_correctionDraftItems.length && !_correctionReasonDraft
        && typeof globalThis.ficheController?.listOtherCorrectionDraftSessions === 'function') {
        const sessions = globalThis.ficheController.listOtherCorrectionDraftSessions();
        if (sessions.length) {
            const label = document.createElement('span');
            label.textContent = 'Brouillon(s) de correction à restaurer explicitement :';
            recovery.append(label);
            for (const item of sessions) {
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'fiche-auth-btn';
                const date = item.savedAt ? new Date(item.savedAt).toLocaleString('fr-FR') : 'date inconnue';
                action.textContent = `Restaurer ${item.changeCount} correction(s) · ${date}`;
                action.addEventListener('click', () => {
                    const recovered = globalThis.ficheController?.loadCorrectionDraftSession?.(item.sessionId);
                    if (!recovered || !_serverBaselineData) return;
                    _correctionDraftItems = recovered.items.filter(isSafePersistedCorrection).map(entry => ({
                        pathParts: [...entry.pathParts],
                        value: globalThis.structuredClone(entry.value),
                        baseValue: globalThis.structuredClone(entry.baseValue),
                    }));
                    _correctionReasonDraft = recovered.reason;
                    const reasonInput = document.getElementById('fiche-correction-reason');
                    if (reasonInput) reasonInput.value = _correctionReasonDraft;
                    _correctionConflicts = correctionDraftConflictsFor(_serverBaselineData);
                    renderCorrectionOverlay();
                    const stored = persistCorrectionDraft();
                    if (stored.ok) globalThis.ficheController?.removeCorrectionDraftSession?.(item.sessionId);
                    ensureCorrectionPanel();
                });
                recovery.append(action);
            }
        }
    }
    const count = correctionBatchChanges().length;
    const button = panel.querySelector('#fiche-correction-submit');
    if (button) {
        button.disabled = count === 0 || count > 50 || _correctionConflicts.length > 0;
        button.textContent = _correctionConflicts.length ? 'Résoudre les conflits avant enregistrement'
            : count ? `Enregistrer ${count} correction(s)` : 'Aucune correction en attente';
    }
    let conflicts = panel.querySelector('.fiche-correction-conflicts');
    if (!conflicts) {
        conflicts = document.createElement('div');
        conflicts.className = 'fiche-correction-conflicts';
        panel.append(conflicts);
    }
    conflicts.replaceChildren();
    for (const conflict of _correctionConflicts) {
        const item = document.createElement('div');
        item.className = 'fiche-correction-conflict';
        const description = document.createElement('span');
        description.textContent = `${conflict.pathParts.join('.')} : base ${JSON.stringify(conflict.base)} · local ${JSON.stringify(conflict.local)} · serveur ${JSON.stringify(conflict.server)}`;
        item.append(description);
        for (const [choice, label] of [['server', 'Garder serveur'], ['local', 'Garder ma correction']]) {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'fiche-auth-btn';
            action.textContent = label;
            action.addEventListener('click', () => {
                const index = _correctionDraftItems.findIndex(draft => correctionPathKey(draft.pathParts) === conflict.key);
                if (index < 0) return;
                if (choice === 'server') _correctionDraftItems.splice(index, 1);
                else _correctionDraftItems[index].baseValue = conflict.server;
                _correctionConflicts = _correctionConflicts.filter(candidate => candidate.key !== conflict.key);
                renderCorrectionOverlay();
                persistCorrectionDraft();
                ensureCorrectionPanel();
            });
            item.append(action);
        }
        conflicts.append(item);
    }
}

export function setFicheRole(role, { allowImport = false } = {}) {
    _activeFicheRole = ['mj', 'joueur', 'readonly'].includes(role) ? role : 'readonly';
    _canImportFiche = allowImport === true;
    const content = document.getElementById('fiche-content-section');
    const controls = content?.querySelectorAll('input, select, textarea, button') || [];
    // Restaurer l’état intrinsèque avant d’appliquer le rôle : une transition
    // joueur → MJ ne doit pas laisser des contrôles statiques désactivés.
    controls.forEach(control => {
        if (!_roleBaselineDisabled.has(control)) _roleBaselineDisabled.set(control, control.disabled);
        control.disabled = _roleBaselineDisabled.get(control);
    });
    if (role === 'mj') {
        content?.querySelectorAll('.xp-note').forEach(control => { control.disabled = true; });
        ensureCorrectionPanel();
        return;
    }
    document.getElementById('fiche-correction-panel')?.remove();
    if (role === 'readonly') {
        controls.forEach(control => { control.disabled = true; });
        if (_canImportFiche) {
            const importButton = document.getElementById('btn-import-fiche');
            const importInput = document.getElementById('file-import-fiche');
            if (importButton) importButton.disabled = false;
            if (importInput) importInput.disabled = false;
        }
        return;
    }
    controls.forEach(control => { control.disabled = true; });
    content?.querySelectorAll(
        '#blessures-act, #resilience, #determination, #chance, #destin, #corruption, #possessions, '
        + '.career-note, .career-variant-sel, .skill-note, .talent-note, .sort-note, .priere-note, '
        + '.btn-toggle-opt, .btn-close-section, #btn-export-fiche, #btn-add-xp, .btn-rm[data-type="xp-cancel"], '
        + '.career-viewer-control select, .career-viewer-check input, .career-viewer-open, .career-viewer-talent, .career-viewer-modal button, .career-viewer-modal select'
    ).forEach(control => { control.disabled = false; });
    content?.querySelectorAll('.sk-basic-spec').forEach(control => {
        control.disabled = Number(state.skillsBasic?.[control.dataset.skill] || 0) > 0;
    });
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
    ['race'].forEach(id => document.getElementById(id)?.addEventListener('input', () => {
        recalc();
        if (document.getElementById('xf-type')?.value === 'talent') updateXfTarget();
    }));

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
        if (!isCloudLoaded) renderAll();
        bindAll();
        recalc();
    });
    updatePageTitle();
    updateCharacterPortrait();
});

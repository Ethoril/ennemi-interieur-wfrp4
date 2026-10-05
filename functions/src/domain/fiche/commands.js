import {
    activeCareerRank,
    findCareerByName,
    getCareerCaracs,
    getCareerSkillSets,
    getEffectiveTalents,
    getRangVariants,
    getVariantsToConsider,
    isCaracInCareer,
    isSkillInCareer,
    isTalentInCareer,
} from './career-model.js';
import { BASIC_SKILLS, basicRowFor, basicSkillNom, getCaracForGroup } from './basic-skills.js';
import { canonicalSkillNom, sameSkill } from './skill-names.js';
import {
    CARAC_XP_BANDS,
    SKILL_XP_BANDS,
    careerRankXpCost,
    miracleXpCost,
    spellXpCost,
    talentXpCost,
    xpBandCost,
} from './xp.js';

const CARACS = Object.freeze(['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc']);
const XP_BANDS_LIMIT = 100;
const TEXT_LIMIT = 200;
const EXPORT_KEYS = new Set([
    'nom', 'race', 'carriere', 'rang', 'blessuresAct', 'resilience', 'determination', 'chance',
    'destin', 'corruption', 'possessions', 'carac', 'skillsBasic', 'skillsAdvanced', 'careers',
    'talentsAcq', 'talentsAvail', 'sorts', 'prieres', 'xpLog', 'customSpecs', 'basicSpecs',
    'customTalents', 'chosenVariants', 'careerOverrides', 'optVisible',
]);

export class FicheCommandError extends Error {
    constructor(message, code = 'invalid-argument', details = undefined) {
        super(message);
        this.name = 'FicheCommandError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(message, code, details) {
    throw new FicheCommandError(message, code, details);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function safeInteger(value, label, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        fail(`${label} invalide`);
    }
    return value;
}

function cleanText(value, label, max = TEXT_LIMIT) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label} invalide`);
    return value.trim();
}

function checkPayloadKeys(payload, allowed) {
    if (!isRecord(payload) || Object.keys(payload).some(key => !allowed.includes(key))) fail('champs de commande non pris en charge');
}

function requireReason(payload) {
    return cleanText(payload.reason, 'motif', 1_000);
}

function operationId(command) {
    if (typeof command.operationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(command.operationId)) {
        fail('identifiant d’opération invalide');
    }
    return command.operationId;
}

function deterministicId(command, suffix) {
    return `${operationId(command)}:${suffix}`;
}

function normalizeRuleName(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[’']/g, "'").trim();
}

function spellKey(value) {
    return normalizeRuleName(value);
}

function uniqueRule(rules, name, kind) {
    if (!Array.isArray(rules)) fail(`catalogue ${kind} indisponible`, 'failed-precondition', { kind: 'catalog-version-unsupported' });
    const matches = rules.filter(rule => spellKey(rule?.nom) === spellKey(name));
    if (matches.length !== 1) fail(`${kind} absent ou ambigu dans le catalogue`, 'not-found', { kind: 'target-not-found' });
    return matches[0];
}

function firstParagraph(value) {
    const first = String(value || '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    return first.length > TEXT_LIMIT ? `${first.slice(0, TEXT_LIMIT - 1).trimEnd()}…` : first;
}

function spellVent(type) {
    const first = String(type || '').split(/\s[-–]\s/)[0].trim();
    const vent = first === 'Uglu' ? 'Ulgu' : first;
    const winds = ['Aqshy', 'Azyr', 'Chamon', 'Ghur', 'Ghyran', 'Hysh', 'Shyish', 'Ulgu', 'Qhaysh', 'Magie Commune', 'Autre'];
    if (winds.includes(vent)) return vent;
    if (/haute magie|elfique/i.test(type)) return 'Qhaysh';
    return 'Magie Commune';
}

function knownRuleCatalog(spellsOption) {
    if (Array.isArray(spellsOption)) return { spells: spellsOption, miracles: null };
    if (!isRecord(spellsOption)) return { spells: null, miracles: null };
    return {
        spells: Array.isArray(spellsOption.spells) ? spellsOption.spells : null,
        miracles: Array.isArray(spellsOption.miracles) ? spellsOption.miracles : null,
    };
}

function getCatalogSpell(rule) {
    const cn = Number(rule.cn ?? rule.ni);
    if (!Number.isSafeInteger(cn) || cn < 0) fail('coût ou définition de sort invalide', 'failed-precondition', { kind: 'catalog-version-unsupported' });
    const type = cleanText(rule.type, 'type de sort');
    return {
        nom: cleanText(rule.nom, 'nom de sort'),
        type,
        cn,
        portee: typeof rule.portee === 'string' ? rule.portee.slice(0, TEXT_LIMIT) : '',
        duree: typeof rule.duree === 'string' ? rule.duree.slice(0, TEXT_LIMIT) : '',
        desc: typeof rule.desc === 'string' ? rule.desc : typeof rule.description === 'string' ? rule.description : '',
    };
}

function getCatalogMiracle(rule) {
    for (const key of ['portee', 'cible', 'duree', 'effet']) {
        if (rule[key] !== undefined && typeof rule[key] !== 'string') fail('définition de miracle invalide', 'failed-precondition', { kind: 'catalog-version-unsupported' });
    }
    return {
        nom: cleanText(rule.nom, 'nom de miracle'),
        portee: String(rule.portee || '').slice(0, TEXT_LIMIT),
        cible: String(rule.cible || '').slice(0, TEXT_LIMIT),
        duree: String(rule.duree || '').slice(0, TEXT_LIMIT),
        effet: String(rule.effet || '').slice(0, 2_000),
    };
}

function miracleEntry(rule) {
    const meta = [['Portée', rule.portee], ['Cible', rule.cible], ['Durée', rule.duree]]
        .filter(([, value]) => value).map(([label, value]) => `${label} : ${value}`).join(' · ');
    return { nom: rule.nom, type: 'Miracle', resume: [meta, firstParagraph(rule.effet)].filter(Boolean).join(' — ') };
}

function spellEntry(rule) {
    return {
        nom: rule.nom,
        vent: spellVent(rule.type),
        cn: rule.cn,
        portee: rule.portee,
        duree: rule.duree,
        resume: firstParagraph(rule.desc),
    };
}

function currentCareer(data, careers) {
    return findCareerByName(careers, typeof data.carriere === 'string' ? data.carriere : '');
}

function currentRank(data, career) {
    return activeCareerRank(career, data.rang);
}

function careerOverrides(data) {
    return isRecord(data.careerOverrides) ? data.careerOverrides : {};
}

function chosenVariants(data) {
    return isRecord(data.chosenVariants) ? data.chosenVariants : {};
}

function xpBalance(data) {
    if (!Array.isArray(data.xpLog)) fail('journal XP invalide');
    let gained = 0;
    let spent = 0;
    for (const entry of data.xpLog) {
        if (!isRecord(entry)) fail('entrée de journal XP invalide');
        if (entry.kind === 'gain') {
            const amount = entry.montant === undefined ? 0 : Number(entry.montant);
            if (!Number.isSafeInteger(amount) || amount < 0) fail('gain XP historique invalide');
            gained += amount;
        } else {
            const cost = entry.cout === undefined ? 0 : Number(entry.cout);
            if (!Number.isSafeInteger(cost) || cost < 0) fail('dépense XP historique invalide');
            spent += cost;
        }
        if (!Number.isSafeInteger(gained) || !Number.isSafeInteger(spent)) fail('solde XP hors limite');
    }
    return gained - spent;
}

function effect(path, before, after, pathParts = null) {
    return { path, ...(pathParts ? { pathParts } : {}), before: clone(before), after: clone(after) };
}

function appendJournal(data, entry) {
    if (!Array.isArray(data.xpLog)) data.xpLog = [];
    if (data.xpLog.some(item => item?.id === entry.id
        || (entry.purchaseId !== undefined && item?.purchaseId === entry.purchaseId))) {
        fail('identifiant de commande déjà présent', 'already-exists', { kind: 'operation-id-reused' });
    }
    data.xpLog.push(entry);
}

function getCurrentAdvances(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} courant invalide`, 'failed-precondition', { kind: 'target-not-found' });
    return value;
}

function dataCareerSkills(data) {
    return {
        chosenVariants: chosenVariants(data),
        overrides: careerOverrides(data),
    };
}

function resolvedSkillTarget(data, payload, skills, skillResolver = null) {
    const name = cleanText(payload.name, 'nom de compétence');
    const resolved = skillResolver?.resolve(name);
    const entry = resolved?.status === 'resolved' ? resolved.entry : null;
    const basicEntry = entry?.basic === true ? entry : null;
    const rowForEntry = basicEntry ? BASIC_SKILLS.find(skill => skill.nom === basicEntry.nom
        || skill.nom === basicEntry.group || skill.nom === `${basicEntry.group} (Base)`
        || (basicEntry.group && skill.nom.startsWith(`${basicEntry.group} (`)))?.nom : null;
    const basicKey = rowForEntry || basicRowFor(name, data.basicSpecs || {});
    const advanced = Array.isArray(data.skillsAdvanced) ? data.skillsAdvanced : [];
    if (payload.targetId !== undefined) {
        if (typeof payload.targetId !== 'string' || !payload.targetId) fail('identifiant de compétence invalide');
        const targetEntry = skillResolver?.entries.find(skill => skill.id === payload.targetId);
        const targetBasicRow = targetEntry?.basic === true
            ? BASIC_SKILLS.find(skill => skill.nom === targetEntry.nom || skill.nom === targetEntry.group
                || skill.nom === `${targetEntry.group} (Base)`
                || (targetEntry.group && skill.nom.startsWith(`${targetEntry.group} (`)))?.nom
            : null;
        const physicalBasicRow = BASIC_SKILLS.find(skill => skill.nom === payload.targetId)?.nom;
        const row = targetBasicRow || physicalBasicRow;
        if (row && (targetEntry?.basic === true || Object.hasOwn(data.skillsBasic || {}, payload.targetId))) {
            if (!row || (basicKey !== row && row !== basicRowFor(name, data.basicSpecs || {}))) {
                fail('cible compétence de base incompatible', 'not-found', { kind: 'target-not-found' });
            }
            return { kind: 'basic', name, row, advances: data.skillsBasic?.[row] ?? 0 };
        }
        const matches = advanced.map((skill, index) => ({ skill, index }))
            .filter(({ skill }) => skill.id === payload.targetId);
        if (matches.length !== 1) fail('compétence avancée introuvable', 'not-found', { kind: 'target-not-found' });
        const { skill, index } = matches[0];
        const owned = skillResolver?.resolveOwnedSkill(skill.nom);
        if (!sameSkill(skill.nom, name) && !(entry && owned?.status === 'resolved' && owned.entry.id === entry.id)) {
            fail('cible compétence avancée incompatible', 'invalid-argument');
        }
        return { kind: 'advanced', name: canonicalSkillNom(skill.nom), skill, index, advances: skill.adv };
    }
    if (basicKey) return { kind: 'basic', name, row: basicKey, advances: data.skillsBasic?.[basicKey] ?? 0 };
    const matches = advanced.map((skill, index) => ({ skill, index }))
        .filter(({ skill }) => sameSkill(skill.nom, name));
    if (matches.length > 1) fail('identifiant requis pour une compétence en doublon');
    if (matches.length === 1) {
        const { skill, index } = matches[0];
        return { kind: 'advanced', name: canonicalSkillNom(skill.nom), skill, index, advances: skill.adv };
    }
    return { kind: 'new-advanced', name: canonicalSkillNom(name), advances: 0 };
}

function skillCarac(target, skills) {
    if (target.kind === 'basic') return BASIC_SKILLS.find(skill => skill.nom === target.row).carac;
    if (target.kind === 'advanced' && typeof target.skill.carac === 'string' && CARACS.includes(target.skill.carac)) return target.skill.carac;
    const group = target.name.split('(')[0].trim();
    return getCaracForGroup(group, skills);
}

function skillInCareer(data, career, rank, target, skillResolver = null) {
    if (!career) return false;
    const { chosenVariants: selected, overrides } = dataCareerSkills(data);
    return isSkillInCareer(career, rank, target.name, selected, overrides, skillResolver)
        || (target.kind === 'basic' && isSkillInCareer(career, rank, basicSkillNom(target.row, data.basicSpecs || {}), selected, overrides, skillResolver));
}

function availableCareerSkills(career, rank, selected, overrides, skillResolver = null) {
    const sets = getCareerSkillSets(career, rank, selected, overrides, skillResolver);
    return { exact: sets.exact, openBases: sets.openBases };
}

function hasAvailableSkill(sets, name, skillResolver = null) {
    const resolved = skillResolver?.resolve(name);
    const canonical = (resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(name)).toLowerCase();
    const base = canonical.split('(')[0].trim();
    return sets.exact.has(canonical) || (canonical.includes('(') && sets.openBases.has(base));
}

function ownedSkillAdvances(data, skillResolver = null) {
    const owned = new Map();
    for (const basic of BASIC_SKILLS) {
        const raw = data.skillsBasic?.[basic.nom] ?? 0;
        const advances = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
        const name = basicSkillNom(basic.nom, data.basicSpecs || {});
        const resolved = skillResolver?.resolve(name);
        const key = (resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(name)).toLowerCase();
        owned.set(key, Math.max(owned.get(key) || 0, advances));
    }
    for (const skill of Array.isArray(data.skillsAdvanced) ? data.skillsAdvanced : []) {
        if (!isRecord(skill) || typeof skill.nom !== 'string') continue;
        const advances = Number.isSafeInteger(skill.adv) && skill.adv >= 0 ? skill.adv : 0;
        const resolved = skillResolver?.resolve(skill.nom);
        const key = (resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(skill.nom)).toLowerCase();
        owned.set(key, Math.max(owned.get(key) || 0, advances));
    }
    return owned;
}

function requirementForPath(data, career, rank, chosen, overrides, skillResolver = null, talentResolver = null) {
    const threshold = rank * 5;
    const caracs = getCareerCaracs(career, rank, chosen, overrides);
    const missingCaracs = [...caracs].filter(carac => {
        const advances = data.carac?.[carac]?.adv;
        return !Number.isSafeInteger(advances) || advances < threshold;
    }).map(carac => ({ name: carac, advances: data.carac?.[carac]?.adv ?? 0, required: threshold }));
    const available = availableCareerSkills(career, rank, chosen, overrides, skillResolver);
    const skillAdvances = ownedSkillAdvances(data, skillResolver);
    const qualifiedSkills = [...skillAdvances.entries()]
        .filter(([name, advances]) => advances >= threshold && hasAvailableSkill(available, name, skillResolver));
    const currentRankVariants = getVariantsToConsider(career, rank, chosen);
    const currentRankTalents = currentRankVariants.flatMap(variant => getEffectiveTalents(career, rank, variant, overrides));
    const talentNames = new Set(currentRankTalents.map(name => {
        const resolved = talentResolver?.resolve(name);
        return (resolved?.status === 'resolved' ? resolved.entry.nom : name).toLowerCase().trim();
    }));
    const hasTalent = (Array.isArray(data.talentsAcq) ? data.talentsAcq : []).some(entry => {
        const name = typeof entry === 'string' ? entry : entry?.nom;
        if (typeof name !== 'string') return false;
        const resolved = talentResolver?.resolve(name);
        const normalized = (resolved?.status === 'resolved' ? resolved.entry.nom : name).toLowerCase().trim();
        return talentNames.has(normalized)
            || (currentRankTalents.some(talent => /\((?:.*?\bchoix\b|n'importe quelle|celle du lanceur).*?\)$/i.test(talent)
                && talent.split('(')[0].trim().toLowerCase() === normalized.split('(')[0].trim()));
    });
    return {
        complete: missingCaracs.length === 0 && qualifiedSkills.length >= 8 && hasTalent,
        threshold,
        missingCaracs,
        qualifiedSkills: qualifiedSkills.map(([name, advances]) => ({ name, advances })),
        skillsRequired: 8,
        missingSkills: Math.max(0, 8 - qualifiedSkills.length),
        hasTalent,
        currentRankTalents: [...new Set(currentRankTalents)],
    };
}

function careerVariantPaths(career, rank, chosen) {
    let paths = [{}];
    for (let current = 1; current <= rank; current++) {
        const variants = getVariantsToConsider(career, current, chosen);
        paths = paths.flatMap(path => variants.map(variant => ({ ...path, [current]: variant })));
        if (!paths.length) return [{ ...chosen }];
    }
    return paths;
}

export function evaluateCareerCompletion(data, career, rank, selectedVariants = chosenVariants(data), overrides = careerOverrides(data),
    skillResolver = null, talentResolver = null) {
    if (!career) fail('carrière active introuvable', 'not-found', { kind: 'target-not-found' });
    safeInteger(rank, 'rang', 1, 5);
    const paths = careerVariantPaths(career, rank, selectedVariants);
    const evaluations = paths.map(path => {
        const selections = Object.fromEntries(Object.entries(path).map(([key, variant]) => [key, variant?.titre]));
        const careerSelections = { ...selectedVariants, [career.id]: selections };
        return { selections, ...requirementForPath(data, career, rank, careerSelections, overrides, skillResolver, talentResolver) };
    });
    const complete = evaluations.find(evaluation => evaluation.complete);
    if (complete) return complete;
    return evaluations.sort((left, right) => (
        left.missingCaracs.length + left.missingSkills + Number(!left.hasTalent)
    ) - (
        right.missingCaracs.length + right.missingSkills + Number(!right.hasTalent)
    ))[0];
}

function checkCatalogVersion(payload, catalogVersion) {
    if (typeof catalogVersion !== 'string' || !catalogVersion
        || payload.catalogVersion !== catalogVersion) {
        fail('version du catalogue absente ou périmée', 'failed-precondition', { kind: 'catalog-version-unsupported' });
    }
}

function purchaseContext(data, careers) {
    const career = currentCareer(data, careers);
    const rank = currentRank(data, career);
    return { career, rank, chosen: chosenVariants(data), overrides: careerOverrides(data) };
}

function checkBalance(data, cost) {
    const balance = xpBalance(data);
    if (balance < cost) fail('XP insuffisants', 'failed-precondition', { kind: 'insufficient-xp', balance, cost });
}

function checkPrice(payload, cost) {
    const expected = safeInteger(payload.expectedCost, 'coût confirmé');
    if (expected !== cost) {
        fail('le prix a changé depuis la prévisualisation', 'failed-precondition', {
            kind: 'price-changed', expectedCost: expected, currentCost: cost,
        });
    }
}

function checkPurchaseIdAvailable(data, command) {
    const purchaseId = deterministicId(command, 'purchase');
    if ((Array.isArray(data.xpLog) ? data.xpLog : []).some(entry => entry?.purchaseId === purchaseId)) {
        fail('identifiant d’achat déjà présent', 'already-exists', { kind: 'operation-id-reused' });
    }
    return purchaseId;
}

function addPurchaseJournal(data, command, context, { kind, label, target, cost, advances = 1, targetType, targetStorage, effects, prevCareer }) {
    const purchaseId = checkPurchaseIdAvailable(data, command);
    const entry = {
        id: deterministicId(command, 'xp'),
        operationId: command.operationId,
        purchaseId,
        origin: 'command',
        actorUid: context.uid,
        kind: 'purchase',
        type: ({ carac: 'Caractéristique', skill: 'Compétence', talent: 'Talent', sort: 'Sort', miracle: 'Miracle', rank: 'Carrière' })[kind],
        achat: label,
        cout: cost,
        applied: true,
        targetNom: target,
        targetType,
        targetStorage,
        avances: advances,
        effects: effects.slice(0, 8),
        ...(prevCareer ? { prevCareer } : {}),
    };
    appendJournal(data, entry);
    return purchaseId;
}

function purchase(data, command, context, options) {
    const payload = command.payload;
    if (!isRecord(payload)) fail('achat invalide');
    checkPayloadKeys(payload, ['kind', 'name', 'targetId', 'count', 'expectedCost', 'catalogVersion', 'careerId', 'rankMode', 'targetRank', 'currentRankDone']);
    checkCatalogVersion(payload, options.catalogVersion);
    const count = safeInteger(payload.count, 'nombre d’avances', 1, XP_BANDS_LIMIT);
    const { career, rank, chosen, overrides } = purchaseContext(data, options.careers);
    let cost, kind, label, target, targetType, targetStorage, advances = count;
    const effects = [];

    if (payload.kind === 'carac') {
        const name = cleanText(payload.name ?? payload.targetId, 'caractéristique', 10);
        if (!CARACS.includes(name) || !isRecord(data.carac?.[name])) fail('caractéristique inconnue', 'not-found', { kind: 'target-not-found' });
        const previous = getCurrentAdvances(data.carac[name].adv, 'avances de caractéristique');
        const after = previous + count;
        safeInteger(after, 'avances de caractéristique');
        const inCareer = career ? isCaracInCareer(career, rank, name, chosen, overrides) : false;
        cost = xpBandCost(CARAC_XP_BANDS, previous, count, inCareer);
        kind = 'carac'; target = name; targetType = 'carac'; targetStorage = 'carac';
        effects.push(effect(`carac.${name}.adv`, previous, after));
        data.carac = { ...data.carac, [name]: { ...data.carac[name], adv: after } };
        label = `${name} +${count}`;
    } else if (payload.kind === 'skill') {
        const targetSkill = resolvedSkillTarget(data, payload, options.skills || [], options.skillResolver);
        const previous = getCurrentAdvances(targetSkill.advances, 'avances de compétence');
        const after = previous + count;
        safeInteger(after, 'avances de compétence');
        const inCareer = skillInCareer(data, career, rank, targetSkill, options.skillResolver);
        cost = xpBandCost(SKILL_XP_BANDS, previous, count, inCareer);
        kind = 'skill'; target = targetSkill.name; targetType = targetSkill.kind === 'basic' ? 'skill-basic' : 'skill-adv';
        if (targetSkill.kind === 'basic') {
            targetStorage = 'skillsBasic';
            data.skillsBasic = { ...(data.skillsBasic || {}), [targetSkill.row]: after };
            effects.push(effect(`skillsBasic.${targetSkill.row}`, previous, after));
        } else if (targetSkill.kind === 'advanced') {
            targetStorage = 'skillsAdvanced';
            const rows = data.skillsAdvanced.slice();
            rows[targetSkill.index] = { ...targetSkill.skill, adv: after };
            data.skillsAdvanced = rows;
            effects.push(effect(`skillsAdvanced.${targetSkill.skill.id}.adv`, previous, after, ['skillsAdvanced', targetSkill.skill.id, 'adv']));
        } else {
            targetStorage = 'skillsAdvanced';
            const carac = skillCarac(targetSkill, options.skills || []);
            const row = { id: deterministicId(command, 'skill'), nom: targetSkill.name, carac, adv: after };
            data.skillsAdvanced = [...(data.skillsAdvanced || []), row];
            effects.push(effect(`skillsAdvanced.${row.id}`, null, row, ['skillsAdvanced', row.id]));
        }
        label = `${targetSkill.name} +${count}`;
    } else if (payload.kind === 'talent') {
        const name = cleanText(payload.name, 'nom de talent');
        const resolvedTalent = options.talentResolver?.resolve(name);
        const canonicalName = resolvedTalent?.status === 'resolved' ? resolvedTalent.entry.nom : name;
        kind = 'talent'; target = canonicalName; targetType = 'talent'; targetStorage = 'talent'; advances = 1;
        const inCareer = career ? isTalentInCareer(career, rank, canonicalName, chosen, overrides, options.talentResolver) : false;
        cost = talentXpCost(inCareer);
        const row = { id: deterministicId(command, 'talent'), nom: canonicalName, note: inCareer ? '' : 'hors carrière' };
        data.talentsAcq = [...(Array.isArray(data.talentsAcq) ? data.talentsAcq : []), row];
        effects.push(effect(`talentsAcq.${row.id}`, null, row, ['talentsAcq', row.id]));
        label = canonicalName;
    } else if (payload.kind === 'sort') {
        const name = cleanText(payload.name, 'nom de sort');
        if (data.sorts?.some(known => spellKey(known.nom) === spellKey(name))) fail('sort déjà connu', 'failed-precondition', { kind: 'target-not-found' });
        const rules = uniqueRule(options.ruleCatalog.spells, name, 'sort');
        const spell = getCatalogSpell(rules);
        const knownSpells = (Array.isArray(data.sorts) ? data.sorts : [])
            .map(known => options.ruleCatalog.spells.find(rule => spellKey(rule?.nom) === spellKey(known.nom)))
            .filter(Boolean).map(getCatalogSpell);
        cost = spellXpCost(spell, knownSpells);
        kind = 'sort'; target = spell.nom; targetType = 'sort'; targetStorage = 'sort'; advances = 1;
        const row = { id: deterministicId(command, 'sort'), ...spellEntry(spell) };
        data.sorts = [...(Array.isArray(data.sorts) ? data.sorts : []), row];
        effects.push(effect(`sorts.${row.id}`, null, row, ['sorts', row.id]));
        label = spell.nom;
    } else if (payload.kind === 'miracle') {
        const name = cleanText(payload.name, 'nom de miracle');
        if (data.prieres?.some(known => spellKey(known.nom) === spellKey(name))) fail('miracle déjà connu', 'failed-precondition', { kind: 'target-not-found' });
        const rules = uniqueRule(options.ruleCatalog.miracles, name, 'miracle');
        const miracle = miracleEntry(getCatalogMiracle(rules));
        cost = miracleXpCost(Array.isArray(data.prieres) ? data.prieres : []);
        kind = 'miracle'; target = miracle.nom; targetType = 'miracle'; targetStorage = 'miracle'; advances = 1;
        const row = { id: deterministicId(command, 'miracle'), ...miracle };
        data.prieres = [...(Array.isArray(data.prieres) ? data.prieres : []), row];
        effects.push(effect(`prieres.${row.id}`, null, row, ['prieres', row.id]));
        label = miracle.nom;
    } else if (payload.kind === 'rank') {
        if (options.rankCompletionPolicy === 'pending') fail('la règle de complétion de carrière reste à valider', 'failed-precondition', { kind: 'rank-policy-pending' });
        const current = currentCareer(data, options.careers);
        if (!current) fail('carrière active introuvable', 'not-found', { kind: 'target-not-found' });
        const currentRankValue = currentRank(data, current);
        const completion = evaluateCareerCompletion(data, current, currentRankValue, chosen, overrides,
            options.skillResolver, options.talentResolver);
        const mode = payload.rankMode;
        const targetCareer = mode === 'changeCareer'
            ? options.careers.find(entry => entry.id === payload.careerId) : current;
        if (!targetCareer) fail('carrière cible introuvable', 'not-found', { kind: 'target-not-found' });
        if (!['advanceRank', 'changeCareer'].includes(mode)) fail('mode de changement de carrière invalide');
        const targetRank = safeInteger(payload.targetRank, 'rang cible', 1, 5);
        if (!getRangVariants(targetCareer, targetRank).length) fail('rang cible absent', 'not-found', { kind: 'target-not-found' });
        if (mode === 'advanceRank' && (targetCareer.id !== current.id || targetRank !== currentRankValue + 1)) {
            fail('le rang cible doit être le rang suivant de la carrière active');
        }
        if (mode === 'changeCareer' && targetCareer.id === current.id && targetRank === currentRankValue) {
            fail('la nouvelle carrière doit changer le rang ou la carrière');
        }
        if (mode === 'changeCareer' && targetCareer.prereq) {
            const prerequisite = options.careers.find(entry => normalizeRuleName(entry.nom) === normalizeRuleName(targetCareer.prereq.career));
            const minimumRank = safeInteger(targetCareer.prereq.minRang, 'rang minimum requis', 1, 5);
            const activeQualifies = current.id === prerequisite?.id && currentRankValue >= minimumRank;
            const archivedQualifies = (Array.isArray(data.careers) ? data.careers : []).some(entry => (
                normalizeRuleName(entry.nom) === normalizeRuleName(targetCareer.prereq.career)
                && Number.isSafeInteger(entry.rang) && entry.rang >= minimumRank
            ));
            if (!activeQualifies && !archivedQualifies) fail('prérequis de carrière non atteint', 'failed-precondition', { kind: 'career-prerequisite' });
        }
        cost = careerRankXpCost(completion.complete);
        checkPrice(payload, cost);
        checkBalance(data, cost);
        kind = 'rank'; target = `${targetCareer.nom} (rang ${targetRank})`; targetType = 'rang'; targetStorage = 'career'; advances = 1;
        const previousCareer = { carriere: data.carriere || '', rang: data.rang ?? 1 };
        const oldCareerRows = Array.isArray(data.careers) ? data.careers : [];
        let archived = null;
        if (mode === 'changeCareer' && previousCareer.carriere) {
            archived = { id: deterministicId(command, 'career'), nom: previousCareer.carriere, rang: +previousCareer.rang || 1, note: '' };
            data.careers = [...oldCareerRows, archived];
            effects.push(effect(`careers.${archived.id}`, null, archived, ['careers', archived.id]));
        }
        data.carriere = targetCareer.nom;
        data.rang = String(targetRank);
        effects.push(effect('carriere', previousCareer.carriere, data.carriere));
        effects.push(effect('rang', previousCareer.rang, data.rang));
        label = mode === 'advanceRank' ? `Rang ${targetRank}` : `${targetCareer.nom} (rang ${targetRank})`;
        const purchaseId = addPurchaseJournal(data, command, context, {
            kind, label, target, cost, advances, targetType, targetStorage, effects,
            prevCareer: { ...previousCareer, archivedCareerId: archived?.id || null },
        });
        data.xpLog.at(-1).completion = {
            complete: completion.complete,
            threshold: completion.threshold,
            missingCaracs: completion.missingCaracs,
            missingSkills: completion.missingSkills,
            hasTalent: completion.hasTalent,
            variantSelections: completion.selections,
        };
        return commandResult(data, { kind, target, cost, purchaseId, completion });
    } else {
        fail('type d’achat non pris en charge');
    }

    checkPrice(payload, cost);
    checkBalance(data, cost);
    const purchaseId = addPurchaseJournal(data, command, context, {
        kind, label, target, cost, advances, targetType, targetStorage, effects,
    });
    return commandResult(data, { kind, target, cost, purchaseId });
}

function commandResult(data, receipt) {
    return {
        data,
        result: { ...receipt, ...(receipt.completion ? { completion: receipt.completion } : {}) },
        summary: {
            kind: receipt.kind,
            target: receipt.target,
            cost: receipt.cost,
            purchaseId: receipt.purchaseId,
        },
    };
}

function gain(data, command, context) {
    if (context.role !== 'mj') fail('commande réservée au MJ', 'permission-denied');
    checkPayloadKeys(command.payload, ['amount', 'reason']);
    const reason = requireReason(command.payload);
    const amount = safeInteger(command.payload.amount, 'montant XP', 1);
    const entry = {
        id: deterministicId(command, 'xp'), operationId: command.operationId,
        origin: 'command', actorUid: context.uid, kind: 'gain', raison: reason, montant: amount,
        effects: [effect('xpBalance', xpBalance(data), xpBalance(data) + amount)],
    };
    appendJournal(data, entry);
    return { data, result: { amount, reason }, summary: { kind: 'gain', cost: amount } };
}

function correct(data, command, context, options) {
    if (context.role !== 'mj') fail('commande réservée au MJ', 'permission-denied');
    checkPayloadKeys(command.payload, ['kind', 'name', 'targetId', 'advances', 'base', 'adv', 'amount', 'reason', 'changes']);
    const reason = requireReason(command.payload);
    const payload = command.payload;
    if (payload.kind === 'batch') return correctBatch(data, command, context, reason, payload.changes, options);
    const effects = [];
    let label = reason;
    if (payload.kind === 'xp') {
        const delta = payload.amount;
        if (!Number.isSafeInteger(delta) || delta === 0) fail('correction XP invalide');
        const before = xpBalance(data);
        if (delta > 0) {
            const entry = {
                id: deterministicId(command, 'xp'), operationId: command.operationId,
                origin: 'command', actorUid: context.uid, kind: 'gain', raison: reason, montant: delta,
                correction: true, effects: [effect('xpBalance', before, before + delta)],
            };
            appendJournal(data, entry);
        } else {
            const entry = {
                id: deterministicId(command, 'xp'), operationId: command.operationId,
                origin: 'command', actorUid: context.uid, kind: 'correction', type: 'Autre',
                achat: reason, cout: -delta, applied: false,
                effects: [effect('xpBalance', before, before + delta)],
            };
            appendJournal(data, entry);
        }
        return { data, result: { kind: 'xp', amount: delta }, summary: { kind: 'correction', cost: Math.abs(delta) } };
    }
    if (payload.kind === 'carac') {
        const name = cleanText(payload.name, 'caractéristique', 10);
        if (!CARACS.includes(name) || !isRecord(data.carac?.[name])) fail('caractéristique inconnue', 'not-found', { kind: 'target-not-found' });
        const before = data.carac[name];
        const next = { ...before };
        for (const field of ['base', 'adv']) {
            if (Object.hasOwn(payload, field)) next[field] = safeInteger(payload[field], `valeur ${field}`);
        }
        if (next.base === before.base && next.adv === before.adv) fail('correction sans changement');
        data.carac = { ...data.carac, [name]: next };
        effects.push(effect(`carac.${name}`, before, next));
        label = `${name}: ${reason}`;
    } else if (payload.kind === 'skill-basic') {
        const name = cleanText(payload.name, 'compétence de base');
        const row = basicRowFor(name, data.basicSpecs || {}) || BASIC_SKILLS.find(skill => skill.nom === payload.targetId)?.nom;
        if (!row) fail('compétence de base inconnue', 'not-found', { kind: 'target-not-found' });
        const before = getCurrentAdvances(data.skillsBasic?.[row] ?? 0, 'avances de compétence');
        const after = safeInteger(payload.advances, 'avances de compétence');
        if (before === after) fail('correction sans changement');
        data.skillsBasic = { ...(data.skillsBasic || {}), [row]: after };
        effects.push(effect(`skillsBasic.${row}`, before, after));
        label = `${row}: ${reason}`;
    } else if (payload.kind === 'skill-adv') {
        const targetId = cleanText(payload.targetId, 'identifiant de compétence');
        const rows = Array.isArray(data.skillsAdvanced) ? data.skillsAdvanced : [];
        const index = rows.findIndex(skill => skill.id === targetId);
        if (index < 0) fail('compétence avancée introuvable', 'not-found', { kind: 'target-not-found' });
        const before = getCurrentAdvances(rows[index].adv, 'avances de compétence');
        const after = safeInteger(payload.advances, 'avances de compétence');
        if (before === after) fail('correction sans changement');
        data.skillsAdvanced = rows.map((skill, i) => i === index ? { ...skill, adv: after } : skill);
        effects.push(effect(`skillsAdvanced.${targetId}.adv`, before, after));
        label = `${rows[index].nom}: ${reason}`;
    } else {
        fail('type de correction non pris en charge');
    }
    const entry = {
        id: deterministicId(command, 'xp'), operationId: command.operationId,
        origin: 'command', actorUid: context.uid, kind: 'correction', type: 'Autre',
        achat: label, cout: 0, applied: true, reason, effects: effects.slice(0, 8),
    };
    appendJournal(data, entry);
    return { data, result: { kind: payload.kind, reason }, summary: { kind: 'correction', target: label, fields: effects.map(item => item.path) } };
}

const BATCH_ROWS = new Set(['skillsAdvanced', 'talentsAcq', 'talentsAvail', 'careers', 'sorts', 'prieres']);
const BASIC_FIELDS = new Set(['nom', 'race', 'blessuresAct', 'resilience', 'determination', 'chance', 'destin', 'corruption', 'possessions']);

function validateBatchRow(root, row, id, ruleCatalog) {
    if (!isRecord(row)) fail('ligne MJ invalide');
    const next = { ...row, id };
    if (root === 'skillsAdvanced') {
        cleanText(next.nom, 'nom de compétence');
        safeInteger(next.adv, 'avances de compétence');
        if (!CARACS.includes(next.carac)) fail('caractéristique de compétence invalide');
        if (Object.keys(next).some(key => !['id', 'nom', 'adv', 'carac', 'note'].includes(key))) fail('champs de compétence non pris en charge');
    } else if (root === 'careers') {
        cleanText(next.nom, 'nom de carrière');
        safeInteger(next.rang, 'rang de carrière', 1, 5);
        if (next.note !== undefined && typeof next.note !== 'string') fail('note de carrière invalide');
        if (Object.keys(next).some(key => !['id', 'nom', 'rang', 'note'].includes(key))) fail('champs de carrière non pris en charge');
    } else if (root === 'talentsAcq' || root === 'talentsAvail') {
        cleanText(next.nom, 'nom de talent');
        if (next.note !== undefined && typeof next.note !== 'string') fail('note de talent invalide');
        if (Object.keys(next).some(key => !['id', 'nom', 'note'].includes(key))) fail('champs de talent non pris en charge');
    } else if (root === 'sorts') {
        cleanText(next.nom, 'nom de sort');
        if (typeof next.vent !== 'string' || !Number.isSafeInteger(next.cn) || next.cn < 0) fail('métadonnées de sort invalides');
        getCatalogSpell(uniqueRule(ruleCatalog.spells, next.nom, 'sort'));
        for (const key of ['portee', 'duree', 'resume']) if (next[key] !== undefined && typeof next[key] !== 'string') fail(`champ ${key} invalide`);
        if (Object.keys(next).some(key => !['id', 'nom', 'vent', 'cn', 'portee', 'duree', 'resume', 'type'].includes(key))) fail('champs de sort non pris en charge');
    } else if (root === 'prieres') {
        cleanText(next.nom, 'nom de prière');
        if (next.type !== undefined && !['Miracle', 'Bénédiction'].includes(next.type)) fail('type de prière invalide');
        if (next.resume !== undefined && typeof next.resume !== 'string') fail('résumé de prière invalide');
        if (next.type === 'Miracle') uniqueRule(ruleCatalog.miracles, next.nom, 'miracle');
        if (Object.keys(next).some(key => !['id', 'nom', 'type', 'resume'].includes(key))) fail('champs de prière non pris en charge');
    }
    return next;
}

function changeBasicSpec(data, parts, value) {
    if (parts.length !== 2) fail('chemin de spécialisation de base invalide');
    const basic = BASIC_SKILLS.find(row => row.nom === parts[1]);
    if (!basic) fail('compétence de base inconnue', 'not-found', { kind: 'target-not-found' });
    const advances = data.skillsBasic?.[basic.nom] ?? 0;
    if (safeInteger(advances, 'avances de compétence') !== 0) fail('la spécialisation ne peut changer qu’à zéro avance');
    if (value !== null) cleanText(value, 'spécialisation');
    const currentName = basicSkillNom(basic.nom, data.basicSpecs || {});
    const nextName = value === null ? basic.nom : basicSkillNom(basic.nom, { ...data.basicSpecs, [basic.nom]: value.trim() });
    if ((data.skillsAdvanced || []).some(row => row && Number.isSafeInteger(row.adv) && row.adv > 0
        && (sameSkill(row.nom, currentName) || sameSkill(row.nom, nextName)))) fail('une compétence avancée utilise cette spécialisation');
    const specs = { ...(data.basicSpecs || {}) };
    if (value === null) delete specs[basic.nom]; else specs[basic.nom] = value.trim();
    data.basicSpecs = specs;
    return { path: `basicSpecs.${basic.nom}`, before: data.basicSpecs?.[basic.nom] ?? null, after: value };
}

function applyBatchChange(data, change, command, index, options) {
    if (!isRecord(change) || !Array.isArray(change.pathParts)
        || !change.pathParts.length || change.pathParts.some(part => typeof part !== 'string' || !part)) fail('chemin de correction invalide');
    const parts = change.pathParts;
    const [root, id, field] = parts;
    const displayPath = parts.join('.');
    if (root === 'basicSpecs') {
        const before = data.basicSpecs?.[id] ?? null;
        changeBasicSpec(data, parts, change.value);
        return effect(displayPath, before, change.value, parts);
    }
    if (root === 'carac' && parts.length === 3 && CARACS.includes(id) && ['base', 'adv'].includes(field)) {
        const before = data.carac?.[id]?.[field];
        if (!isRecord(data.carac?.[id]) || before === undefined) fail('caractéristique introuvable', 'not-found', { kind: 'target-not-found' });
        const after = safeInteger(change.value, `valeur ${field}`);
        if (Object.is(before, after)) fail('correction sans changement');
        data.carac = { ...data.carac, [id]: { ...data.carac[id], [field]: after } };
        return effect(displayPath, before, after, parts);
    }
    if (BASIC_FIELDS.has(root) && parts.length === 1) {
        const after = cleanText(change.value, root);
        const before = data[root] ?? '';
        if (before === after) fail('correction sans changement');
        data[root] = after;
        return effect(root, before, after, parts);
    }
    if (root === 'skillsBasic' && parts.length === 2 && BASIC_SKILLS.some(row => row.nom === id)) {
        const before = data.skillsBasic?.[id] ?? 0;
        const after = safeInteger(change.value, 'avances de compétence');
        if (before === after) fail('correction sans changement');
        data.skillsBasic = { ...(data.skillsBasic || {}), [id]: after };
        return effect(displayPath, before, after, parts);
    }
    if (BATCH_ROWS.has(root) && parts.length === 3) {
        const rows = Array.isArray(data[root]) ? data[root] : [];
        const index = rows.findIndex(row => row?.id === id);
        if (index < 0) fail('ligne à modifier introuvable', 'not-found', { kind: 'target-not-found' });
        const row = rows[index];
        const allowedFields = {
            skillsAdvanced: new Set(['nom', 'adv', 'carac', 'note']), careers: new Set(['nom', 'rang', 'note']),
            talentsAcq: new Set(['nom', 'note']), talentsAvail: new Set(['nom', 'note']),
            sorts: new Set(['nom', 'vent', 'cn', 'portee', 'duree', 'resume']),
            prieres: new Set(['nom', 'type', 'resume']),
        }[root];
        if (!allowedFields.has(field)) fail('champ de ligne non modifiable');
        const updated = { ...row, [field]: change.value };
        const next = validateBatchRow(root, updated, id, options.ruleCatalog);
        if (deepEqual(row, next)) fail('correction sans changement');
        data[root] = rows.map((item, rowIndex) => rowIndex === index ? next : item);
        return effect(displayPath, row[field] ?? null, next[field] ?? null, parts);
    }
    if (BATCH_ROWS.has(root) && parts.length === 2) {
        const rows = Array.isArray(data[root]) ? data[root].slice() : [];
        const insertion = id === '@new';
        const rowId = insertion ? deterministicId(command, `batch-${index}`) : id;
        if (!/^[A-Za-z0-9_.:-]{1,200}$/u.test(rowId)) fail('identifiant de ligne invalide');
        const foundIndex = rows.findIndex(row => row?.id === rowId);
        const before = foundIndex < 0 ? null : rows[foundIndex];
        if (change.value === null) {
            if (insertion || foundIndex < 0) fail('ligne à supprimer introuvable', 'not-found', { kind: 'target-not-found' });
            rows.splice(foundIndex, 1);
        } else {
            if (insertion && foundIndex >= 0) fail('identifiant déterministe déjà utilisé', 'already-exists');
            if (insertion && Object.hasOwn(change.value, 'id')) fail('un nouvel identifiant de ligne est attribué par le serveur');
            if (!insertion && foundIndex < 0) fail('ligne à modifier introuvable', 'not-found', { kind: 'target-not-found' });
            const next = validateBatchRow(root, change.value, rowId, options.ruleCatalog);
            if (before && deepEqual(before, next)) fail('correction sans changement');
            if (foundIndex < 0) rows.push(next); else rows[foundIndex] = next;
        }
        data[root] = rows;
        return effect(insertion ? `${root}.${rowId}` : displayPath, before, change.value === null ? null : { ...change.value, id: rowId }, [root, rowId]);
    }
    if ((root === 'carriere' || root === 'rang') && parts.length === 1) {
        const before = data[root] ?? (root === 'rang' ? '1' : '');
        const after = root === 'carriere' ? cleanText(change.value, 'carrière') : String(safeInteger(Number(change.value), 'rang', 1, 5));
        if (before === after) fail('correction sans changement');
        data[root] = after;
        return effect(root, before, after, parts);
    }
    if (root === 'chosenVariants' && parts.length === 3) {
        const career = options.careers.find(entry => entry.id === id);
        const rank = safeInteger(Number(field), 'rang', 1, 5);
        const variants = getRangVariants(career, rank);
        const before = data.chosenVariants?.[id]?.[rank] ?? null;
        if (!career || !variants.length || (change.value !== null && !variants.some(variant => variant.titre === change.value))) fail('variante de carrière inconnue');
        if (before === change.value) fail('correction sans changement');
        data.chosenVariants = { ...(data.chosenVariants || {}), [id]: { ...(data.chosenVariants?.[id] || {}) } };
        if (change.value === null) delete data.chosenVariants[id][rank];
        else data.chosenVariants[id][rank] = cleanText(change.value, 'variante');
        return effect(displayPath, before, change.value, parts);
    }
    if (root === 'careerOverrides' && parts.length === 4) {
        const career = options.careers.find(entry => entry.id === id);
        const rank = safeInteger(Number(parts[2]), 'rang', 1, 5);
        const fieldName = parts[3];
        const allowed = { caracs: 'carac', skillsAdded: 'skill', skillsRemoved: 'skill', talentsAdded: 'talent', talentsRemoved: 'talent' };
        if (!career || !getRangVariants(career, rank).length || !allowed[fieldName]) fail('chemin d’adaptation de carrière invalide');
        if (change.value !== null && (!Array.isArray(change.value) || change.value.some(item => typeof item !== 'string' || !item.trim()))) fail('liste d’adaptation invalide');
        if (Array.isArray(change.value) && new Set(change.value).size !== change.value.length) fail('doublon dans l’adaptation');
        if (fieldName === 'caracs' && Array.isArray(change.value) && change.value.some(carac => !CARACS.includes(carac))) fail('caractéristique d’adaptation invalide');
        const before = data.careerOverrides?.[id]?.[rank]?.[fieldName] ?? null;
        if (deepEqual(before, change.value)) fail('correction sans changement');
        const all = { ...(data.careerOverrides || {}) };
        all[id] = { ...(all[id] || {}) };
        all[id][rank] = { ...(all[id][rank] || {}) };
        if (change.value === null) delete all[id][rank][fieldName]; else all[id][rank][fieldName] = change.value.slice();
        data.careerOverrides = all;
        return effect(displayPath, before, change.value, parts);
    }
    fail('chemin de correction MJ non autorisé');
}

function validateCareerState(data, careers) {
    if (!data.carriere) return;
    const career = findCareerByName(careers, data.carriere);
    const rank = Number(data.rang || 1);
    if (!career || !Number.isSafeInteger(rank) || rank < 1 || rank > 5 || !getRangVariants(career, rank).length) {
        fail('carrière et rang incohérents', 'failed-precondition', { kind: 'target-not-found' });
    }
}

function correctBatch(data, command, context, reason, changes, options) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 50) fail('lot de corrections invalide');
    const effects = changes.map((change, index) => applyBatchChange(data, change, command, index, options));
    validateCareerState(data, options.careers);
    const entry = {
        id: deterministicId(command, 'xp'), operationId: command.operationId,
        origin: 'command', actorUid: context.uid, kind: 'correction', type: 'Autre',
        achat: reason, cout: 0, applied: true, reason, effects,
    };
    appendJournal(data, entry);
    const fields = effects.map(item => item.path);
    return { data, result: { kind: 'batch', reason, fields }, summary: { kind: 'correction', target: reason, fields } };
}

function cancel(data, command, context) {
    checkPayloadKeys(command.payload, ['purchaseId']);
    const purchaseId = cleanText(command.payload.purchaseId, 'identifiant d’achat', 200);
    const rows = Array.isArray(data.xpLog) ? data.xpLog : [];
    const index = rows.findIndex(entry => entry.purchaseId === purchaseId);
    if (index < 0) fail('achat annulable introuvable', 'failed-precondition', { kind: 'purchase-not-reversible' });
    const original = rows[index];
    if (original.origin !== 'command' || original.kind !== 'purchase' || !Array.isArray(original.effects)) {
        fail('un achat historique ne peut pas être annulé automatiquement', 'failed-precondition', { kind: 'purchase-not-reversible' });
    }
    const migrationBarrier = (Array.isArray(data.catalogueMigrationBarriers) ? data.catalogueMigrationBarriers : [])
        .some(barrier => Array.isArray(barrier?.purchaseIds) && barrier.purchaseIds.includes(purchaseId));
    if (migrationBarrier) fail('une migration de référentiel a modifié le contexte de cet achat', 'failed-precondition', { kind: 'purchase-not-reversible' });
    if (original.cancelledByOperationId) fail('achat déjà remboursé', 'failed-precondition', { kind: 'purchase-not-reversible' });
    if (context.role !== 'mj') {
        if (original.actorUid !== context.uid) fail('achat appartenant à une autre personne', 'permission-denied');
        const latestOwn = rows.findLast(entry => entry?.kind === 'purchase' && entry?.origin === 'command'
            && entry?.actorUid === context.uid && !entry.cancelledByOperationId);
        if (latestOwn?.purchaseId !== purchaseId) fail('seul le dernier achat peut être annulé', 'failed-precondition', { kind: 'purchase-not-reversible' });
    }
    ensureNoLaterDependencies(rows, index, original);
    for (const item of original.effects) {
        if (!isRecord(item) || typeof item.path !== 'string') fail('effets d’achat incomplets', 'failed-precondition', { kind: 'purchase-not-reversible' });
        if (!matchesCurrentEffect(data, item)) fail('la donnée achetée a changé depuis l’achat', 'failed-precondition', { kind: 'purchase-not-reversible' });
    }
    const reversed = clone(data);
    for (const item of original.effects) applyBeforeEffect(reversed, item);
    const refund = safeInteger(original.cout, 'coût d’achat', 1);
    const compensation = {
        id: deterministicId(command, 'xp'), operationId: command.operationId,
        origin: 'command', actorUid: context.uid, kind: 'gain', raison: `Annulation de ${original.achat || original.targetNom || 'l’achat'}`,
        montant: refund, cancelledPurchaseId: purchaseId,
        effects: [effect('xpBalance', xpBalance(data), xpBalance(data) + refund)],
    };
    const cancelEntry = {
        id: deterministicId(command, 'cancel'), operationId: command.operationId,
        origin: 'command', actorUid: context.uid, kind: 'cancel', cancelledPurchaseId: purchaseId,
        reason: 'Annulation contrôlée', effects: original.effects.map(item => effect(item.path, item.after, item.before)).slice(0, 8),
    };
    reversed.xpLog = reversed.xpLog.map((entry, i) => i === index
        ? { ...entry, cancelledByOperationId: command.operationId }
        : entry);
    appendJournal(reversed, cancelEntry);
    appendJournal(reversed, compensation);
    return {
        data: reversed,
        result: { cancelledPurchaseId: purchaseId, refunded: refund },
        summary: { kind: 'cancel', undoOf: purchaseId, cost: refund },
    };
}

function matchesCurrentEffect(data, item) {
    const [root, id, field] = effectPathParts(item);
    if (root === 'carriere' || root === 'rang') return Object.is(data[root], item.after);
    if (root === 'carac' && field) return Object.is(data.carac?.[id]?.[field], item.after);
    if (root === 'skillsBasic' && !field) return Object.is(data.skillsBasic?.[id] ?? 0, item.after);
    if (root === 'skillsAdvanced' && id) {
        const skill = data.skillsAdvanced?.find(entry => entry.id === id);
        if (!field) return JSON.stringify(skill ?? null) === JSON.stringify(item.after);
        return Object.is(skill?.[field], item.after);
    }
    for (const name of ['talentsAcq', 'sorts', 'prieres', 'careers']) {
        if (root === name && id) {
            const row = data[name]?.find(entry => entry.id === id);
            return deepEqual(row ?? null, item.after);
        }
    }
    return false;
}

function deepEqual(left, right) {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function applyBeforeEffect(data, item) {
    const [root, id, field] = effectPathParts(item);
    if (root === 'carriere' || root === 'rang') {
        data[root] = clone(item.before);
        return;
    }
    if (root === 'carac' && field) {
        data.carac = { ...data.carac, [id]: { ...data.carac[id], [field]: clone(item.before) } };
    } else if (root === 'skillsBasic' && !field) {
        data.skillsBasic = { ...data.skillsBasic, [id]: clone(item.before) };
    } else if (root === 'skillsAdvanced' && id) {
        if (field) {
            data.skillsAdvanced = data.skillsAdvanced.map(skill => skill.id === id ? { ...skill, [field]: clone(item.before) } : skill);
        } else {
            data.skillsAdvanced = data.skillsAdvanced.filter(skill => skill.id !== id);
        }
    } else {
        const rootName = root;
        if (!['talentsAcq', 'sorts', 'prieres', 'careers'].includes(rootName)) fail('effet d’achat non annulable');
        data[rootName] = (data[rootName] || []).filter(row => row.id !== id);
    }
}

function effectPathParts(item) {
    if (Array.isArray(item.pathParts) && item.pathParts.every(part => typeof part === 'string')) return item.pathParts;
    return typeof item.path === 'string' ? item.path.split('.') : [];
}

function ensureNoLaterDependencies(rows, index, original) {
    if (rows.slice(index + 1).some(entry => entry?.importBarrier === true)) {
        fail('un import ultérieur sépare cet achat de son état courant', 'failed-precondition', { kind: 'purchase-not-reversible' });
    }
    const later = rows.slice(index + 1).filter(entry => entry?.kind === 'purchase'
        && entry.origin === 'command' && !entry.cancelledByOperationId);
    if (!later.length) return;
    const targetType = original.targetType;
    const blocksAll = targetType === 'rang';
    const blocksRank = ['carac', 'skill-basic', 'skill-adv', 'talent'].includes(targetType);
    const blocksMagicTier = ['sort', 'miracle'].includes(targetType);
    const dependent = later.some(entry => blocksAll
        || (blocksRank && entry.targetType === 'rang')
        || (blocksMagicTier && entry.targetType === targetType));
    if (dependent) fail('un achat ultérieur dépend de cet achat', 'failed-precondition', { kind: 'purchase-not-reversible' });
}

function validateImportData(imported) {
    if (!isRecord(imported) || Object.keys(imported).some(key => !EXPORT_KEYS.has(key))) fail('format d’import non pris en charge');
    for (const key of ['nom', 'race', 'carriere', 'rang', 'blessuresAct', 'resilience', 'determination', 'chance', 'destin', 'corruption', 'possessions']) {
        if (Object.hasOwn(imported, key) && typeof imported[key] !== 'string') fail(`champ d’import invalide: ${key}`);
    }
    if (Object.hasOwn(imported, 'carac')) {
        if (!isRecord(imported.carac) || Object.keys(imported.carac).some(key => !CARACS.includes(key))) fail('caractéristiques d’import invalides');
        for (const value of Object.values(imported.carac)) {
            if (!isRecord(value) || !Number.isSafeInteger(value.base) || value.base < 0
                || !Number.isSafeInteger(value.adv) || value.adv < 0) fail('valeurs de caractéristiques d’import invalides');
        }
    }
    for (const key of ['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres', 'xpLog']) {
        if (Object.hasOwn(imported, key) && (!Array.isArray(imported[key]) || imported[key].length > 2_000 || imported[key].some(row => !isRecord(row)))) {
            fail(`tableau d’import invalide: ${key}`);
        }
    }
    for (const key of ['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres']) {
        const rows = imported[key] || [];
        const ids = new Set();
        for (const row of rows) {
            if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) fail(`identifiant d’import invalide: ${key}`);
            ids.add(row.id);
            if (['skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(key)
                && (typeof row.nom !== 'string' || !row.nom.trim())) fail(`nom d’import invalide: ${key}`);
            if (key === 'skillsAdvanced' && (!Number.isSafeInteger(row.adv) || row.adv < 0)) fail('avances de compétence importées invalides');
            if (key === 'careers' && (!Number.isSafeInteger(row.rang) || row.rang < 1 || row.rang > 5)) fail('rang de carrière importé invalide');
        }
    }
    if (Object.hasOwn(imported, 'skillsBasic')) {
        for (const [name, advances] of Object.entries(imported.skillsBasic)) {
            if (typeof name !== 'string' || !Number.isSafeInteger(advances) || advances < 0) fail('avances de compétence importées invalides');
        }
    }
    if (Object.hasOwn(imported, 'xpLog')) {
        const ids = new Set();
        for (const entry of imported.xpLog) {
            if (typeof entry.id !== 'string' || !entry.id.trim() || ids.has(entry.id)) fail('identifiant de journal importé invalide');
            ids.add(entry.id);
            if (entry.kind === 'gain' && (!Number.isSafeInteger(Number(entry.montant)) || Number(entry.montant) < 0)) fail('gain XP importé invalide');
            if (entry.kind !== 'gain' && entry.cout !== undefined && (!Number.isSafeInteger(Number(entry.cout)) || Number(entry.cout) < 0)) fail('coût XP importé invalide');
        }
    }
    for (const key of ['skillsBasic', 'customSpecs', 'basicSpecs', 'customTalents', 'chosenVariants', 'careerOverrides', 'optVisible']) {
        if (Object.hasOwn(imported, key) && !isRecord(imported[key])) fail(`objet d’import invalide: ${key}`);
    }
}

function importData(data, command, context) {
    if (context.role !== 'mj') fail('commande réservée au MJ', 'permission-denied');
    checkPayloadKeys(command.payload, ['reason', 'data']);
    const reason = requireReason(command.payload);
    validateImportData(command.payload.data);
    const imported = clone(command.payload.data);
    imported.xpLog = (Array.isArray(imported.xpLog) ? imported.xpLog : []).map(entry => {
        const protectedFields = new Set(['operationId', 'origin', 'actorUid', 'purchaseId', 'cancelledByOperationId', 'cancelledPurchaseId', 'effects']);
        const legacy = Object.fromEntries(Object.entries(entry).filter(([key]) => !protectedFields.has(key)));
        return { ...legacy, origin: 'legacy' };
    });
    const event = {
        id: deterministicId(command, 'import'), operationId: command.operationId,
        origin: 'command', actorUid: context.uid, kind: 'correction', type: 'Autre',
        achat: `Import MJ: ${reason}`, cout: 0, applied: false, reason,
        importBarrier: true,
        effects: [{ path: 'data', before: Object.keys(data), after: Object.keys(imported) }],
    };
    imported.xpLog.push(event);
    return { data: imported, result: { kind: 'import' }, summary: { kind: 'import', label: reason } };
}

export function createFicheCommandEngine({ careers, skills, spells, catalogVersion, rankCompletionPolicy = 'automatic',
    skillResolver = null, talentResolver = null } = {}) {
    const ruleCatalog = knownRuleCatalog(spells);
    const options = { careers: Array.isArray(careers) ? careers : [], skills: Array.isArray(skills) ? skills : [],
        ruleCatalog, catalogVersion, rankCompletionPolicy, skillResolver, talentResolver };
    function applyCommand(data, command, context = {}) {
        if (!isRecord(data) || !isRecord(command) || !isRecord(command.payload)) fail('commande métier invalide');
        const nextData = clone(data);
        const commandContext = { uid: cleanText(context.uid, 'acteur uid', 200), role: context.role, operationId: operationId(command) };
        if (command.type === 'purchase') return purchase(nextData, command, commandContext, options);
        if (command.type === 'cancel') return cancel(nextData, command, commandContext);
        if (command.type === 'gain') return gain(nextData, command, commandContext);
        if (command.type === 'correct') return correct(nextData, command, commandContext, options);
        if (command.type === 'import') return importData(nextData, command, commandContext);
        fail('commande non prise en charge par le moteur XP');
    }
    return Object.freeze({ applyCommand, evaluateCareerCompletion: (data, career, rank) => evaluateCareerCompletion(
        data, career, rank, chosenVariants(data), careerOverrides(data), skillResolver, talentResolver,
    ) });
}

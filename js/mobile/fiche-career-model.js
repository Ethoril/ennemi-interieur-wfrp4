import { primarySkillLabel } from '../catalogue/skill-forms.js';
import {
    activeCareerRank, findCareerByName, getCareerCaracs, getCareerSkillSets, getEffectiveCaracs, getEffectiveSkills,
    getEffectiveTalents, getRangVariants, getVariantsToConsider, isTalentInCareer,
} from '../fiche/career-model.js';
import { canonicalSkillNom } from '../fiche/skill-names.js';
import { careerRankXpCost } from '../fiche/xp.js';
import { stripAccents } from '../utils.js';
import { CARACS, ficheIdentity, skillRows } from './fiche-model.js';

const fold = text => stripAccents(String(text ?? '')).toLowerCase();
const abbr = key => CARACS.find(carac => carac.key === key)?.abbr || key;
const unique = values => [...new Set(values)];
const talentLabel = (engine, nom) => engine.resolveTalent?.(nom)?.displayedName || nom;

// Même normalisation que commands.js (normalizeRuleName, non exporté : le fichier est synchronisé vers functions).
const ruleName = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’']/g, "'").trim();

/**
 * Raison pour laquelle on ne peut pas passer à `target` au rang `targetRank`, ou '' si c'est permis.
 * ponytail: rejoue les contrôles de commands.js (rang cible présent, changement réel, career.prereq) ;
 * tools/fiche-mobile-carriere.test.mjs échoue si le serveur et ce filtre divergent.
 */
export function careerChangeBlock(data, career, rank, target, targetRank) {
    if (!getRangVariants(target, targetRank).length) return `Pas de rang ${targetRank}`;
    if (target.id === career.id && targetRank === rank) return 'Carrière et rang actuels';
    const prereq = target.prereq;
    if (!prereq) return '';
    const minimum = prereq.minRang;
    if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > 5) return 'Prérequis invalide';
    const wanted = ruleName(prereq.career);
    const reason = `Prérequis : ${prereq.career}, rang ${minimum} minimum`;
    const active = ruleName(career.nom) === wanted && rank >= minimum;
    const archived = (Array.isArray(data?.careers) ? data.careers : []).some(entry => (
        ruleName(entry?.nom) === wanted && Number.isSafeInteger(entry.rang) && entry.rang >= minimum));
    return active || archived ? '' : reason;
}

/**
 * Carrières proposées pour un changement (recherche multi-mots sans accents ni casse, ordre alphabétique) :
 * { id, nom, source, reason, ok }. Une carrière inaccessible reste listée avec sa raison.
 */
export function careerChangeOptions(data, careers = [], { query = '', targetRank = 1 } = {}) {
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    if (!career) return [];
    const rank = activeCareerRank(career, data?.rang);
    const words = fold(query).split(/\s+/u).filter(Boolean);
    return careers
        .filter(item => { const text = fold([item.nom, ...item.rangs.map(({ titre }) => titre)].join(' ')); return words.every(word => text.includes(word)); })
        .map(item => {
            const reason = careerChangeBlock(data, career, rank, item, targetRank);
            return { id: item.id, nom: item.nom, source: item.source || '', reason, ok: !reason };
        })
        .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * État de la carrière : rang, trois jauges d'achèvement, coût du rang suivant, aperçu, historique ; null sans carrière ni moteur.
 * Jauge : { label, done, total, detail }. Les caractéristiques et compétences exigées suivent la variante retenue par le moteur
 * (completion.selections), comme le serveur.
 */
export function careerProgress(data, engine, careers = []) {
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    if (!career || !engine) return null;
    const { titreRang, statut } = ficheIdentity(data, careers);
    const rank = activeCareerRank(career, data.rang);
    const overrides = data.careerOverrides || {};
    const resolver = engine.skillResolver;
    const completion = engine.evaluateCareerCompletion(data, career, rank);
    const chosen = { ...(data.chosenVariants || {}), [career.id]: completion.selections };
    const threshold = completion.threshold;

    const caracs = [...getCareerCaracs(career, rank, chosen, overrides)];
    const gap = new Map(completion.missingCaracs.map(({ name, advances }) => [name, advances]));
    const caracGauge = {
        label: `Caractéristiques à +${threshold}`, done: caracs.length - gap.size, total: caracs.length,
        detail: caracs.map(key => (gap.has(key) ? `${abbr(key)} +${gap.get(key)} sur ${threshold}` : `${abbr(key)} ✓`)).join(' · '),
    };

    // Avances par nom principal, la plus haute l'emporte (comme ownedSkillAdvances du moteur).
    const owned = new Map();
    for (const row of skillRows(data, engine, careers)) {
        const resolved = resolver?.resolve(row.serverName);
        const key = (resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(row.serverName)).toLowerCase();
        owned.set(key, Math.max(owned.get(key) || 0, row.adv));
    }
    const slots = new Map();
    for (let step = 1; step <= rank; step += 1) {
        for (const variant of getVariantsToConsider(career, step, chosen)) {
            for (const item of getEffectiveSkills(career, step, variant, overrides)) {
                const label = primarySkillLabel(resolver, item, true);
                if (!slots.has(label)) slots.set(label, item);
            }
        }
    }
    const missing = [];
    for (const [label, item] of slots) {
        // Un emplacement évalué seul avec le code du moteur : mêmes alternatives, mêmes choix ouverts.
        const { exact, openBases } = getCareerSkillSets({ id: 'slot', rangs: [{ rang: 1, skills: [item] }] }, 1, {}, {}, resolver);
        const advances = [...owned].filter(([name]) => exact.has(name) || (name.includes('(') && openBases.has(name.split('(')[0].trim())))
            .map(([, adv]) => adv);
        const best = Math.max(0, ...advances);
        if (best < threshold) missing.push(best ? `${label} +${best}` : label);
    }
    const skillTotal = completion.skillsRequired;
    const skillsDone = Math.min(skillTotal, completion.qualifiedSkills.length);
    const skillGauge = {
        label: `Compétences à +${threshold}`, done: skillsDone, total: skillTotal,
        detail: skillsDone >= skillTotal ? 'Objectif atteint' : `Manquent : ${missing.join(' · ')}`,
    };

    const rankTalents = { id: 'talents', rangs: [{ rang: 1, talents: completion.currentRankTalents }] };
    const taken = unique((data.talentsAcq || []).map(row => (typeof row === 'string' ? row : row?.nom))
        .filter(nom => typeof nom === 'string' && isTalentInCareer(rankTalents, 1, nom, {}, {}, engine.talentResolver))
        .map(nom => talentLabel(engine, nom)));
    const talentGauge = {
        label: 'Talent du rang', done: completion.hasTalent ? 1 : 0, total: 1,
        detail: completion.hasTalent ? `${taken.join(' · ') || 'Talent acquis'} ✓`
            : `À acquérir : ${completion.currentRankTalents.map(nom => talentLabel(engine, nom)).join(' · ')}`,
    };

    const next = getRangVariants(career, rank + 1).map(variant => ({
        title: variant.titre, statut: variant.statut || '',
        caracs: getEffectiveCaracs(career, rank + 1, variant, overrides).map(abbr),
        skills: getEffectiveSkills(career, rank + 1, variant, overrides).map(item => primarySkillLabel(resolver, item, true)),
        talents: getEffectiveTalents(career, rank + 1, variant, overrides).map(nom => talentLabel(engine, nom)),
    }));
    const archived = (Array.isArray(data.careers) ? data.careers : []).filter(row => typeof row?.nom === 'string')
        .map(row => ({ nom: row.nom, rang: Math.max(1, +row.rang || 1), current: false }));

    return {
        career: career.nom, title: titreRang, statut, rank, complete: completion.complete,
        gauges: [caracGauge, skillGauge, talentGauge],
        hasNext: next.length > 0, nextRank: rank + 1, nextCost: careerRankXpCost(completion.complete), next,
        history: [...archived, { nom: career.nom, rang: rank, current: true }],
    };
}

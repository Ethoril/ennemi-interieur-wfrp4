import { canonicalSkillNom, expandChoiceSkill, isOpenCareerSlot, skillBaseNom } from './skill-names.js';

export function findCareerByName(careers, name) {
    if (!name) return null;
    const normalized = name.toLowerCase().trim();
    return careers.find(career =>
        career.nom.toLowerCase() === normalized ||
        career.rangs.some(rank => rank.titre.toLowerCase() === normalized)
    ) || null;
}

export function activeCareerRank(career, requestedRank) {
    const maxRank = maxCareerRank(career);
    return Math.min(maxRank, Math.max(1, +requestedRank || 1));
}

export function maxCareerRank(career, minimum = 4) {
    return career ? Math.max(minimum, ...career.rangs.map(rank => rank.rang)) : minimum;
}

export function getRangVariants(career, rang) {
    return career.rangs.filter(rank => rank.rang === rang);
}

export function getActiveVariantForRang(career, rang, chosenVariants = {}) {
    const variants = getRangVariants(career, rang);
    if (variants.length === 1) return variants[0];
    if (variants.length === 0) return null;
    const chosen = chosenVariants?.[career.id]?.[rang] || null;
    return chosen ? variants.find(variant => variant.titre === chosen) || null : null;
}

// Sans choix enregistré, toutes les variantes restent admissibles au calcul XP.
export function getVariantsToConsider(career, rang, chosenVariants = {}) {
    const active = getActiveVariantForRang(career, rang, chosenVariants);
    return active ? [active] : getRangVariants(career, rang);
}

export function getEffectiveCaracs(career, rang, variant, careerOverrides = {}) {
    return careerOverrides?.[career.id]?.[rang]?.caracs || variant?.caracs || [];
}

export function getEffectiveSkills(career, rang, variant, careerOverrides = {}) {
    const base = (variant?.skills || []).slice();
    const overrides = careerOverrides?.[career.id]?.[rang];
    if (!overrides) return base;
    const removed = new Set((overrides.skillsRemoved || []).map(skill => skill.toLowerCase()));
    return [
        ...base.filter(skill => !removed.has(skill.toLowerCase())),
        ...(overrides.skillsAdded || []),
    ];
}

export function getEffectiveTalents(career, rang, variant, careerOverrides = {}) {
    const base = (variant?.talents || []).slice();
    const overrides = careerOverrides?.[career.id]?.[rang];
    if (!overrides) return base;
    const removed = new Set((overrides.talentsRemoved || []).map(talent => talent.toLowerCase()));
    return [
        ...base.filter(talent => !removed.has(talent.toLowerCase())),
        ...(overrides.talentsAdded || []),
    ];
}

export function getCareerSkillSets(career, rang, chosenVariants = {}, careerOverrides = {}, skillResolver = null) {
    const exact = new Set(), openBases = new Set();
    for (let currentRank = 1; currentRank <= rang; currentRank++) {
        for (const variant of getVariantsToConsider(career, currentRank, chosenVariants)) {
            for (const skill of getEffectiveSkills(career, currentRank, variant, careerOverrides)) {
                for (const expanded of expandChoiceSkill(skill)) {
                    const resolved = skillResolver?.resolveCareerSlot(expanded);
                    if (resolved?.status === 'resolved' && resolved.open) {
                        const base = resolved.base?.group || resolved.base?.nom;
                        if (base) openBases.add(skillBaseNom(base));
                        exact.add(expanded.toLowerCase());
                    } else if (resolved?.status === 'resolved' && resolved.entry) {
                        exact.add(resolved.entry.nom.toLowerCase());
                    } else {
                        exact.add(expanded.toLowerCase());
                        if (isOpenCareerSlot(expanded)) openBases.add(skillBaseNom(expanded));
                    }
                }
            }
        }
    }
    return { exact, openBases };
}

export function getCareerTalentSets(career, rang, chosenVariants = {}, careerOverrides = {}, talentResolver = null) {
    const exact = new Set(), openBases = new Set();
    for (let currentRank = 1; currentRank <= rang; currentRank++) {
        for (const variant of getVariantsToConsider(career, currentRank, chosenVariants)) {
            for (const talent of getEffectiveTalents(career, currentRank, variant, careerOverrides)) {
                const resolved = talentResolver?.resolve(talent);
                exact.add((resolved?.status === 'resolved' ? resolved.entry.nom : talent).toLowerCase());
                if (/\((?:.*?\bchoix\b|n'importe quelle|celle du lanceur).*?\)$/i.test(talent)) {
                    openBases.add(talent.split('(')[0].trim().toLowerCase());
                }
            }
        }
    }
    return { exact, openBases };
}

export function getCareerCaracs(career, rang, chosenVariants = {}, careerOverrides = {}) {
    if (!(career.rangs || []).some(rank => Array.isArray(rank.caracs))
        && !Object.values(careerOverrides?.[career.id] || {}).some(override => override.caracs)) {
        return new Set(career.carac || []);
    }
    const caracs = new Set();
    for (let currentRank = 1; currentRank <= rang; currentRank++) {
        for (const variant of getVariantsToConsider(career, currentRank, chosenVariants)) {
            getEffectiveCaracs(career, currentRank, variant, careerOverrides).forEach(carac => caracs.add(carac));
        }
    }
    return caracs;
}

export function isSkillInCareer(career, rang, name, chosenVariants = {}, careerOverrides = {}, skillResolver = null) {
    const sets = getCareerSkillSets(career, rang, chosenVariants, careerOverrides, skillResolver);
    const resolved = skillResolver?.resolve(name);
    const canonical = resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(name);
    return sets.exact.has(canonical.toLowerCase()) || sets.openBases.has(skillBaseNom(canonical));
}

export function isTalentInCareer(career, rang, name, chosenVariants = {}, careerOverrides = {}, talentResolver = null) {
    const sets = getCareerTalentSets(career, rang, chosenVariants, careerOverrides, talentResolver);
    const resolved = talentResolver?.resolve(name);
    const normalized = (resolved?.status === 'resolved' ? resolved.entry.nom : name).toLowerCase().trim();
    return sets.exact.has(normalized) || sets.openBases.has(normalized.split('(')[0].trim());
}

export function isCaracInCareer(career, rang, carac, chosenVariants = {}, careerOverrides = {}) {
    return getCareerCaracs(career, rang, chosenVariants, careerOverrides).has(carac);
}

import { basicSkillNom } from '../fiche/basic-skills.js';

function addOccurrence(target, occurrence) {
    const key = `${occurrence.kind}\u0000${occurrence.name}`;
    const current = target.get(key) || { kind: occurrence.kind, name: occurrence.name, resolved: null, occurrences: [] };
    if (!current.resolved && occurrence.resolved) current.resolved = occurrence.resolved;
    current.occurrences.push(occurrence);
    target.set(key, current);
}

function skillMatch(resolver, name, careerSlot = false) {
    return careerSlot ? resolver.resolveCareerSlot(name) : resolver.resolveOwnedSkill(name);
}

/** Inventorie les références touchées sans décider des fusions ni modifier les données. */
export function buildCatalogueImpactReport({ skillResolver, talentResolver, careers = [], characters = [] } = {}) {
    if (!skillResolver || typeof skillResolver.resolve !== 'function'
        || !talentResolver || typeof talentResolver.resolve !== 'function'
        || !Array.isArray(careers) || !Array.isArray(characters)) throw new TypeError('Sources d’audit invalides.');
    const skillOccurrences = new Map();
    const talentOccurrences = new Map();
    const openCareerSlots = [];
    for (const career of careers) {
        for (const rank of career?.rangs || []) {
            for (const name of Array.isArray(rank.skills) ? rank.skills : []) {
                if (typeof name !== 'string') continue;
                const resolved = skillMatch(skillResolver, name, true);
                addOccurrence(skillOccurrences, { kind: 'career', name, careerId: career.id,
                    careerName: career.nom, rank: rank.rang, rankTitle: rank.titre, resolved });
                if (resolved.open) openCareerSlots.push({ careerId: career.id, careerName: career.nom,
                    rank: rank.rang, rankTitle: rank.titre, label: name, baseId: resolved.base?.id || null });
            }
            for (const name of Array.isArray(rank.talents) ? rank.talents : []) {
                if (typeof name === 'string') addOccurrence(talentOccurrences, {
                    kind: 'career', name, careerId: career.id, careerName: career.nom, rank: rank.rang,
                    resolved: talentResolver.resolve(name),
                });
            }
        }
    }
    for (const character of characters) {
        const data = character?.data || {};
        const scopeId = character?.charId || 'fiche-inconnue';
        for (const [name, advances] of Object.entries(data.skillsBasic || {})) {
            if (!Number.isSafeInteger(advances) || advances < 0) continue;
            const effectiveName = basicSkillNom(name, data.basicSpecs || {});
            addOccurrence(skillOccurrences, { kind: 'owned-basic', name: effectiveName, scopeId,
                collection: 'skillsBasic', id: name, advances, resolved: skillMatch(skillResolver, effectiveName) });
        }
        for (const skill of Array.isArray(data.skillsAdvanced) ? data.skillsAdvanced : []) {
            if (typeof skill?.nom !== 'string') continue;
            addOccurrence(skillOccurrences, { kind: 'owned-advanced', name: skill.nom, scopeId,
                collection: 'skillsAdvanced', id: typeof skill.id === 'string' ? skill.id : null,
                advances: Number.isSafeInteger(skill.adv) ? skill.adv : null, resolved: skillMatch(skillResolver, skill.nom) });
        }
        for (const [careerId, ranks] of Object.entries(data.careerOverrides || {})) {
            if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks)) continue;
            for (const [rank, override] of Object.entries(ranks)) {
                for (const field of ['skillsAdded', 'skillsRemoved']) {
                    for (const name of Array.isArray(override?.[field]) ? override[field] : []) {
                        if (typeof name === 'string') addOccurrence(skillOccurrences, {
                            kind: 'career-override', name, scopeId, careerId, rank, field,
                            resolved: skillMatch(skillResolver, name),
                        });
                    }
                }
            }
        }
        for (const [kind, rows] of [['owned', data.talentsAcq], ['available', data.talentsAvail]]) {
            for (const entry of Array.isArray(rows) ? rows : []) {
                const name = typeof entry === 'string' ? entry : entry?.nom;
                if (typeof name === 'string' && name.trim()) addOccurrence(talentOccurrences, {
                    kind, name, scopeId, resolved: talentResolver.resolve(name),
                });
            }
        }
        for (const [name, description] of Object.entries(data.customTalents || {})) {
            if (typeof description === 'string') addOccurrence(talentOccurrences, {
                kind: 'local-description', name, scopeId, descriptionPresent: Boolean(description.trim()),
                resolved: talentResolver.resolve(name),
            });
        }
        for (const item of Array.isArray(data.xpLog) ? data.xpLog : []) {
            if (typeof item?.targetNom !== 'string') continue;
            const kind = item.targetType === 'talent' ? 'talent-purchase-history'
                : ['skill', 'skill-basic', 'skill-adv'].includes(item.targetType) ? 'skill-purchase-history' : null;
            if (!kind) continue;
            const target = kind.startsWith('talent') ? talentOccurrences : skillOccurrences;
            addOccurrence(target, { kind, name: item.targetNom, scopeId,
                id: item.purchaseId || item.id || null, historical: true,
                resolved: kind.startsWith('talent') ? talentResolver.resolve(item.targetNom) : skillMatch(skillResolver, item.targetNom) });
        }
    }
    const summarize = items => [...items.values()].map(item => ({
        ...item,
        occurrences: item.occurrences,
        status: item.occurrences.some(occurrence => occurrence.resolved?.status === 'ambiguous') ? 'ambiguous'
            : item.occurrences.some(occurrence => occurrence.resolved?.status === 'unknown') ? 'unresolved'
                : item.occurrences.some(occurrence => occurrence.resolved?.status === 'custom-specialization') ? 'custom-specialization' : 'resolved',
    })).sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name, 'fr'));
    const skillLabels = summarize(skillOccurrences);
    const talentLabels = summarize(talentOccurrences);
    return Object.freeze({
        skills: Object.freeze(skillLabels),
        talents: Object.freeze(talentLabels),
        openCareerSlots: Object.freeze(openCareerSlots),
        counts: Object.freeze({
            skillLabels: skillLabels.length,
            skillOccurrences: skillLabels.reduce((sum, item) => sum + item.occurrences.length, 0),
            skillCollisions: skillLabels.filter(item => item.status === 'ambiguous').length,
            customSpecializations: skillLabels.filter(item => item.status === 'custom-specialization').length,
            unresolvedSkills: skillLabels.filter(item => item.status === 'unresolved').length,
            talentLabels: talentLabels.length,
            talentMissingDescriptions: talentLabels.filter(item => item.occurrences.some(occurrence => (
                ['missing-reference', 'empty-reference'].includes(occurrence.resolved?.descriptionStatus)
            ))).length,
            unresolvedTalentLabels: talentLabels.filter(item => item.status === 'unresolved').length,
            talentSourceUnavailable: talentLabels.some(item => item.occurrences.some(occurrence => (
                occurrence.resolved?.descriptionStatus === 'source-unavailable'
            ))),
        }),
    });
}

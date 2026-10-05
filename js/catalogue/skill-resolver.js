import { canonicalSkillNom, expandChoiceSkill, isOpenCareerSlot } from '../fiche/skill-names.js';
import { BASIC_SKILLS } from '../fiche/basic-skills.js';

function exactKey(value) {
    return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
}

function suggestionKey(value) {
    return exactKey(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[’']/gu, "'");
}

function stablePart(value) {
    return Array.from(String(value), character => character.codePointAt(0).toString(16)).join('_') || 'empty';
}

function makeResult(status, extra = {}) {
    return { status, ...extra };
}

function asTargetId(value, entriesById, aliasesByKey, visiting = new Set()) {
    if (entriesById.has(value)) {
        const entry = entriesById.get(value);
        const redirected = aliasesByKey.get(exactKey(entry.nom));
        if (!redirected?.length || (redirected.length === 1 && redirected[0] === value)) return { status: 'resolved', id: value };
        value = entry.nom;
    }
    const key = exactKey(value);
    if (visiting.has(key)) return { status: 'cycle' };
    const targets = aliasesByKey.get(key);
    if (!targets?.length) return { status: 'unknown' };
    if (targets.length !== 1) return { status: 'ambiguous' };
    visiting.add(key);
    const result = asTargetId(targets[0], entriesById, aliasesByKey, visiting);
    visiting.delete(key);
    return result;
}

/** Construit des identités stables distinctes pour chaque compétence spécialisée. */
export function buildSkillEntries(skillRows, basicSkills = BASIC_SKILLS) {
    if (!Array.isArray(skillRows)) throw new TypeError('La source de compétences doit être un tableau.');
    const entries = new Map();
    for (const row of skillRows) {
        if (!row || typeof row.group !== 'string' || typeof row.nom !== 'string') continue;
        const group = row.group.trim();
        const specialization = typeof row.spec === 'string' && row.spec.trim() ? row.spec.trim() : null;
        const groupId = `skill-group-${stablePart(group)}`;
        const specializationId = specialization ? `skill-spec-${stablePart(group)}-${stablePart(specialization)}` : null;
        const id = `skill-${stablePart(group)}-${specialization ? stablePart(specialization) : 'base'}`;
        const candidate = {
            id,
            groupId,
            group,
            specializationId,
            specialization,
            nom: row.nom.trim(),
            carac: typeof row.carac === 'string' ? row.carac : '',
            basic: row.basic === true,
            aliases: [],
        };
        const existing = entries.get(exactKey(candidate.nom));
        if (existing && (existing.id !== candidate.id || existing.carac !== candidate.carac || existing.basic !== candidate.basic)) {
            throw new TypeError(`Libellé de compétence ambigu dans la source : ${candidate.nom}`);
        }
        entries.set(exactKey(candidate.nom), candidate);
    }
    for (const basic of basicSkills) {
        const name = typeof basic === 'string' ? basic : basic?.nom;
        if (typeof name !== 'string' || !name.trim() || entries.has(exactKey(name))) continue;
        const group = name.trim().split('(')[0].trim();
        const candidate = {
            id: `skill-${stablePart(group)}-base`,
            groupId: `skill-group-${stablePart(group)}`,
            group,
            specializationId: null,
            specialization: null,
            nom: group,
            carac: typeof basic?.carac === 'string' ? basic.carac : '',
            basic: true,
            aliases: [],
        };
        entries.set(exactKey(candidate.nom), candidate);
    }
    return [...entries.values()].sort((left, right) => exactKey(left.nom).localeCompare(exactKey(right.nom), 'fr'));
}

/** Reprend seulement les équivalences déjà codées et les relie à une identité existante. */
export function collectLegacySkillAliases(labels, entries) {
    const entriesByName = new Map();
    for (const entry of entries) {
        const key = exactKey(entry.nom);
        entriesByName.set(key, [...(entriesByName.get(key) || []), entry]);
    }
    const aliases = new Map();
    for (const label of labels || []) {
        if (typeof label !== 'string' || !label.trim()) continue;
        const canonical = canonicalSkillNom(label);
        if (exactKey(canonical) === exactKey(label)) continue;
        const targets = entriesByName.get(exactKey(canonical)) || [];
        if (targets.length !== 1) continue;
        aliases.set(exactKey(label), { label: label.trim(), targetId: targets[0].id, provenance: 'alias-historique-du-site' });
    }
    return [...aliases.values()].sort((left, right) => exactKey(left.label).localeCompare(exactKey(right.label), 'fr'));
}

/** Crée un résolveur strict : seules les formes canoniques et les alias déclarés sont acceptés. */
export function createSkillResolver({ version, entries, aliases = [] } = {}) {
    if (typeof version !== 'string' || !version.trim()) throw new TypeError('Version de référentiel invalide.');
    if (!Array.isArray(entries) || !Array.isArray(aliases)) throw new TypeError('Référentiel invalide.');
    const entriesById = new Map();
    const names = new Map();
    const groupsByName = new Map();
    const groupsById = new Map();
    for (const raw of entries) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.nom !== 'string' || !raw.nom.trim()) {
            throw new TypeError('Identité de compétence invalide.');
        }
        if (entriesById.has(raw.id)) throw new TypeError(`Identifiant de compétence dupliqué : ${raw.id}`);
        const entry = Object.freeze({ ...raw, aliases: Object.freeze([...(raw.aliases || [])]) });
        entriesById.set(entry.id, entry);
        const key = exactKey(entry.nom);
        names.set(key, [...(names.get(key) || []), entry.id]);
        if (typeof entry.group === 'string' && entry.group.trim() && typeof entry.groupId === 'string') {
            const groupKey = exactKey(entry.group);
            groupsByName.set(groupKey, [...new Set([...(groupsByName.get(groupKey) || []), entry.groupId])]);
            const groupData = groupsById.get(entry.groupId) || { id: entry.groupId, nom: entry.group, caracs: new Set() };
            if (typeof entry.carac === 'string' && entry.carac) groupData.caracs.add(entry.carac);
            groupsById.set(entry.groupId, groupData);
        }
    }
    const aliasesByKey = new Map();
    const aliasMetadata = new Map();
    for (const alias of aliases) {
        if (!alias || typeof alias.label !== 'string' || !alias.label.trim() || typeof alias.targetId !== 'string') {
            throw new TypeError('Alias de compétence invalide.');
        }
        const key = exactKey(alias.label);
        aliasesByKey.set(key, [...new Set([...(aliasesByKey.get(key) || []), alias.targetId])]);
        aliasMetadata.set(key, [...(aliasMetadata.get(key) || []), alias]);
    }
    const aliasErrors = [];
    for (const key of aliasesByKey.keys()) {
        const target = asTargetId(key, entriesById, aliasesByKey, new Set());
        if (target.status !== 'resolved') aliasErrors.push({ alias: key, reason: target.status });
    }
    const lookup = value => {
        const label = typeof value === 'string' ? value.trim() : '';
        if (!label) return makeResult('unknown', { label });
        const key = exactKey(label);
        const direct = names.get(key) || [];
        const aliasTarget = asTargetId(label, entriesById, aliasesByKey);
        if (aliasTarget.status === 'resolved') {
            const source = aliasMetadata.get(key)?.[0];
            return makeResult('resolved', { label, alias: true,
                ...(source?.provenance ? { aliasProvenance: source.provenance } : {}),
                entry: entriesById.get(aliasTarget.id) });
        }
        if (aliasTarget.status === 'ambiguous' || aliasTarget.status === 'cycle') return makeResult('ambiguous', { label, reason: aliasTarget.status });
        if (direct.length === 1) return makeResult('resolved', { label, entry: entriesById.get(direct[0]) });
        if (direct.length > 1) return makeResult('ambiguous', { label, candidates: direct.map(id => entriesById.get(id)) });
        return makeResult('unknown', { label });
    };
    const primaryEntries = [...entriesById.values()].filter(entry => lookup(entry.nom).entry?.id === entry.id);
    const allNames = primaryEntries.map(entry => entry.nom);
    const allAliases = [...aliasesByKey.keys()];
    return Object.freeze({
        version,
        entries: Object.freeze([...entriesById.values()]),
        primaryEntries: Object.freeze(primaryEntries),
        aliasErrors: Object.freeze(aliasErrors),
        resolve: lookup,
        resolveOwnedSkill(value) {
            const match = lookup(value);
            if (match.status !== 'unknown' || typeof value !== 'string' || isOpenCareerSlot(value)
                || expandChoiceSkill(value).length > 1) return match;
            const parts = value.trim().match(/^(.+?)\s+\(([^()]+)\)$/u);
            if (!parts) return match;
            const [, group, specialization] = parts;
            const groupId = (groupsByName.get(exactKey(group)) || [])[0];
            if (!groupId || !specialization.trim()) return match;
            const groupData = groupsById.get(groupId);
            return makeResult('custom-specialization', { label: value,
                entry: Object.freeze({
                    id: `skill-${stablePart(group)}-${stablePart(specialization.trim())}`,
                    groupId,
                    group,
                    specializationId: `skill-spec-${stablePart(group)}-${stablePart(specialization.trim())}`,
                    specialization: specialization.trim(),
                    nom: value.trim(),
                    carac: groupData?.caracs.size === 1 ? [...groupData.caracs][0] : '',
                    basic: false,
                    custom: true,
                }) });
        },
        suggest(value, limit = 8) {
            const key = suggestionKey(value);
            if (!key) return [];
            return [...new Set([...allNames, ...allAliases])]
                .map(label => ({ label, distance: levenshtein(key, suggestionKey(label)) }))
                .sort((left, right) => left.distance - right.distance || left.label.localeCompare(right.label, 'fr'))
                .slice(0, Math.max(0, Math.min(limit, 20)));
        },
        resolveCareerSlot(value) {
            if (typeof value !== 'string' || !value.trim()) return makeResult('unknown', { label: value });
            if (isOpenCareerSlot(value)) {
                const base = value.split('(')[0].trim();
                const resolvedBase = lookup(base);
                const groups = groupsByName.get(exactKey(base)) || [];
                if (resolvedBase.status !== 'resolved' && groups.length === 1) {
                    return makeResult('resolved', { label: value, slot: true, open: true,
                        base: { id: groups[0], nom: base, group: base, groupId: groups[0], specializationId: null } });
                }
                return makeResult(resolvedBase.status, {
                    label: value,
                    slot: true,
                    open: true,
                    base: resolvedBase.status === 'resolved' ? resolvedBase.entry : null,
                });
            }
            const alternatives = expandChoiceSkill(value, label => label);
            if (alternatives.length > 1) {
                const resolved = alternatives.map(label => ({ label, ...lookup(label) }));
                return makeResult(resolved.every(item => item.status === 'resolved') ? 'resolved' : 'incomplete', {
                    label: value,
                    slot: true,
                    alternatives: resolved,
                });
            }
            return lookup(alternatives[0]);
        },
    });
}

function levenshtein(left, right) {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= right.length; j++) {
            const old = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
            previous = old;
        }
    }
    return row[right.length];
}

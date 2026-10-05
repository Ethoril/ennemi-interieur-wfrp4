import { buildSkillEntries, createSkillResolver } from './skill-resolver.js';
import { canonicalSkillNom, expandChoiceSkill, isOpenCareerSlot } from '../fiche/skill-names.js';

const key = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
const shortId = value => {
    let hash = 2166136261;
    let second = 5381;
    for (const character of key(value)) {
        hash = Math.imul(hash ^ character.codePointAt(0), 16777619);
        second = Math.imul(second, 33) ^ character.codePointAt(0);
    }
    return (hash >>> 0).toString(16) + '-' + (second >>> 0).toString(16);
};
export const skillFormsResolver = skills => createSkillResolver({ version: 'editor', ...skills });

/** All spellings, including usages absent from the catalogue, without changing any source. */
export function buildSkillForms(skills, report = null) {
    const resolver = skillFormsResolver(skills);
    const forms = new Map();
    const add = (label, source, occurrence = null) => {
        if (typeof label !== 'string' || !label.trim()) return;
        const normalized = key(label);
        const row = forms.get(normalized) || { label: label.trim(), sources: [], occurrences: [] };
        if (!row.sources.includes(source)) row.sources.push(source);
        if (occurrence) row.occurrences.push(occurrence);
        forms.set(normalized, row);
    };
    skills.entries.forEach(entry => add(entry.nom, 'Catalogue'));
    skills.aliases.forEach(alias => add(alias.label, 'Variante'));
    for (const item of report?.skills || []) {
        for (const occurrence of item.occurrences || []) {
            const source = occurrence.kind === 'career' ? 'Carrière' : occurrence.historical ? 'Historique XP' : 'Fiche';
            if (occurrence.kind === 'career' && (isOpenCareerSlot(item.name) || expandChoiceSkill(item.name).length > 1)) {
                if (!isOpenCareerSlot(item.name)) expandChoiceSkill(item.name).forEach(label => add(label, source, occurrence));
                continue;
            }
            add(item.name, source, occurrence);
        }
    }
    return [...forms.values()].map(row => {
        const resolved = resolver.resolve(row.label);
        return { ...row, targetId: resolved.entry?.id || null, primary: resolved.entry?.nom || null,
            status: resolved.status, isPrimary: resolved.status === 'resolved' && key(row.label) === key(resolved.entry.nom) };
    }).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

/** Group whole existing equivalence classes and promote the chosen spelling. IDs stay stable. */
export function linkSkillForms(skills, labels, primaryLabel, { newSkill = null } = {}) {
    const clean = String(primaryLabel || '').trim().replace(/\s+/gu, ' ');
    if (!clean || !labels.some(label => key(label) === key(clean))) throw new Error('Choisissez une forme principale parmi les formes sélectionnées.');
    const resolver = skillFormsResolver(skills);
    const matches = labels.map(label => resolver.resolve(label));
    if (matches.some(match => match.status === 'ambiguous')) throw new Error('Une forme sélectionnée est ambiguë. Corrigez ses liens avant le regroupement.');
    const targetIds = new Set(matches.filter(match => match.status === 'resolved').map(match => match.entry.id));
    if (!targetIds.size) {
        if (!newSkill || !['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'].includes(newSkill.carac)) {
            throw new Error('Choisissez la caractéristique de cette nouvelle compétence, ou un nom principal existant.');
        }
        const canonical = canonicalSkillNom(clean);
        const parts = canonical.match(/^(.+?)\s+\(([^()]+)\)$/u);
        const candidate = buildSkillEntries([{ nom: clean, group: parts ? parts[1] : canonical,
            spec: parts ? parts[2] : '', carac: newSkill.carac, basic: false }], [])[0];
        if (candidate.id.length > 180 || skills.entries.some(entry => entry.id === candidate.id)) candidate.id = 'skill-mj-' + shortId(clean);
        if (candidate.groupId.length > 180) candidate.groupId = 'skill-group-mj-' + shortId(candidate.group);
        if (candidate.specializationId?.length > 180) candidate.specializationId = 'skill-spec-mj-' + shortId(clean);
        if (skills.entries.some(entry => entry.id === candidate.id)) throw new Error('Cette compétence existe déjà sous un autre nom. Choisissez-la dans la liste.');
        return linkSkillForms({ ...skills, entries: [...skills.entries, candidate] }, labels, clean);
    }
    const direct = skills.entries.find(entry => key(entry.nom) === key(clean));
    if (direct) targetIds.add(direct.id);
    const principalMatch = resolver.resolve(clean);
    const targetId = direct?.id || principalMatch.entry?.id || [...targetIds][0];
    const linkedLabels = new Map(labels.map(label => [key(label), label.trim()]));
    for (const entry of skills.entries) {
        const match = resolver.resolve(entry.nom);
        if (targetIds.has(match.entry?.id) || entry.id === targetId) linkedLabels.set(key(entry.nom), entry.nom);
    }
    for (const alias of skills.aliases) {
        if (targetIds.has(resolver.resolve(alias.label).entry?.id)) linkedLabels.set(key(alias.label), alias.label);
    }
    const next = globalThis.structuredClone(skills);
    next.entries.find(entry => entry.id === targetId).nom = clean;
    next.aliases = next.aliases.filter(alias => !linkedLabels.has(key(alias.label)));
    for (const label of linkedLabels.values()) {
        if (key(label) !== key(clean)) next.aliases.push({ label, targetId, provenance: 'regroupement-mj' });
    }
    const check = skillFormsResolver(next);
    if (check.aliasErrors.length || [...linkedLabels.values()].some(label => check.resolve(label).entry?.id !== targetId)) {
        throw new Error('Ce regroupement créerait des liens incohérents.');
    }
    return { skills: next, targetId, primary: clean, labels: [...linkedLabels.values()] };
}

export function publishedSkillRows(resolver) {
    return (resolver?.primaryEntries || []).map(entry => {
        const parts = entry.nom.match(/^(.+?)\s+\(([^()]+)\)$/u);
        return { ...entry, group: parts ? parts[1] : entry.nom, spec: parts ? parts[2] : '' };
    });
}

export function primarySkillLabel(resolver, label, careerSlot = false) {
    const match = careerSlot ? resolver?.resolveCareerSlot(label) : resolver?.resolve(label);
    if (match?.entry) return match.entry.nom;
    if (match?.alternatives && match.status === 'resolved') return [...new Set(match.alternatives.map(item => item.entry.nom))].join(' ou ');
    if (match?.open && match.base) {
        const suffix = String(label).match(/\([^()]+\)$/u)?.[0] || '(au choix)';
        return `${match.base.nom} ${suffix}`;
    }
    return label;
}

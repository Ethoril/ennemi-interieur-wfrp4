import { createSourceTalentResolver } from './talent-source.js';

function exactKey(value) {
    return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
}

function suggestionKey(value) {
    return exactKey(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[’']/gu, "'");
}

function stablePart(value) {
    return Array.from(String(value), character => character.codePointAt(0).toString(16)).join('_') || 'empty';
}

function levenshtein(left, right) {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const old = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
            previous = old;
        }
    }
    return row[right.length];
}

function templateExpression(pattern) {
    const token = '{specialization}';
    const index = pattern.indexOf(token);
    if (index < 0 || pattern.indexOf(token, index + token.length) >= 0) return null;
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(`^${escaped.replace('\\{specialization\\}', '(.+?)')}$`, 'iu');
}

/** Crée des identités pour les talents publiés et ceux seulement référencés en carrière. */
export function buildTalentEntries({ sheetSnapshot, careers = [] } = {}) {
    if (sheetSnapshot !== null && sheetSnapshot !== undefined && !Array.isArray(sheetSnapshot.entries)) {
        throw new TypeError('Instantané des descriptions invalide.');
    }
    if (!Array.isArray(careers)) throw new TypeError('Liste des carrières invalide.');
    const labels = new Map();
    for (const row of sheetSnapshot?.entries || []) {
        if (typeof row?.nom === 'string' && row.nom.trim()) labels.set(exactKey(row.nom), { nom: row.nom.trim(), sources: new Set(['sheet']) });
    }
    for (const career of careers) {
        for (const rank of career?.rangs || []) {
            for (const name of rank?.talents || []) {
                if (typeof name !== 'string' || !name.trim()) continue;
                const key = exactKey(name);
                const existing = labels.get(key);
                if (existing) existing.sources.add('career');
                else labels.set(key, { nom: name.trim(), sources: new Set(['career']) });
            }
        }
    }
    return [...labels.entries()].map(([key, value]) => ({
        id: `talent-${stablePart(value.nom)}`,
        key,
        nom: value.nom,
        sources: [...value.sources].sort(),
    })).sort((left, right) => left.key.localeCompare(right.key, 'fr'));
}

/** Le résolveur n'applique que les alias publiés et les modèles de spécialisations déclarés. */
export function createTalentResolver({
    version,
    entries,
    aliases = [],
    localDescriptions = [],
    sheetSnapshot,
    templates = [],
} = {}) {
    if (sheetSnapshot?.schemaVersion === 2) {
        const legacyResolver = createTalentResolver({ version, entries, aliases, localDescriptions, templates,
            sheetSnapshot: { ...sheetSnapshot, schemaVersion: 1 } });
        return createSourceTalentResolver({ sheetSnapshot, legacyResolver });
    }
    if (typeof version !== 'string' || !version.trim() || !Array.isArray(entries)
        || !Array.isArray(aliases) || !Array.isArray(localDescriptions) || !Array.isArray(templates)) {
        throw new TypeError('Référentiel de talents invalide.');
    }
    const entriesById = new Map();
    const names = new Map();
    for (const raw of entries) {
        if (!raw || typeof raw.id !== 'string' || !raw.id || typeof raw.nom !== 'string' || !raw.nom.trim()) {
            throw new TypeError('Identité de talent invalide.');
        }
        if (entriesById.has(raw.id)) throw new TypeError(`Identifiant de talent dupliqué : ${raw.id}`);
        const entry = Object.freeze({ ...raw });
        entriesById.set(entry.id, entry);
        const key = exactKey(entry.nom);
        names.set(key, [...(names.get(key) || []), entry.id]);
    }
    const aliasTargets = new Map();
    const aliasMetadata = new Map();
    for (const alias of aliases) {
        if (!alias || typeof alias.label !== 'string' || !alias.label.trim() || typeof alias.targetId !== 'string') {
            throw new TypeError('Alias de talent invalide.');
        }
        const key = exactKey(alias.label);
        aliasTargets.set(key, [...new Set([...(aliasTargets.get(key) || []), alias.targetId])]);
        aliasMetadata.set(key, [...(aliasMetadata.get(key) || []), alias]);
    }
    const aliasErrors = [];
    const resolveAlias = (key, visiting = new Set()) => {
        if (entriesById.has(key)) return { status: 'resolved', id: key };
        if (visiting.has(key)) return { status: 'cycle' };
        const targets = aliasTargets.get(key);
        if (!targets?.length) return { status: 'unknown' };
        if (targets.length !== 1) return { status: 'ambiguous' };
        visiting.add(key);
        const target = entriesById.has(targets[0]) ? { status: 'resolved', id: targets[0] } : resolveAlias(exactKey(targets[0]), visiting);
        visiting.delete(key);
        return target;
    };
    for (const key of aliasTargets.keys()) {
        const target = resolveAlias(key);
        if (target.status !== 'resolved') aliasErrors.push({ alias: key, reason: target.status });
    }
    const localById = new Map();
    for (const local of localDescriptions) {
        if (!local || typeof local.talentId !== 'string' || !entriesById.has(local.talentId)
            || typeof local.description !== 'string' || localById.has(local.talentId)) throw new TypeError('Description locale publiée invalide.');
        localById.set(local.talentId, local.description);
    }
    const sheetAvailable = Boolean(sheetSnapshot && Array.isArray(sheetSnapshot.entries));
    const sheetByName = new Map();
    for (const row of sheetSnapshot?.entries || []) if (typeof row?.nom === 'string') sheetByName.set(exactKey(row.nom), row);
    const preparedTemplates = templates.map(template => {
        if (!template || typeof template.id !== 'string' || !template.id
            || typeof template.pattern !== 'string' || typeof template.descriptionTalentId !== 'string'
            || !entriesById.has(template.descriptionTalentId)) throw new TypeError('Modèle de spécialisation invalide.');
        const expression = templateExpression(template.pattern);
        if (!expression) throw new TypeError('Le modèle doit déclarer exactement une spécialisation.');
        return { ...template, expression };
    });
    const describe = (talentId, displayedName, specialization = null, template = false) => {
        let description;
        let source;
        let status;
        if (localById.has(talentId)) {
            description = localById.get(talentId);
            source = 'site';
            status = description.trim() ? 'available' : 'empty-local';
        } else if (!sheetAvailable) {
            description = '';
            source = null;
            status = 'source-unavailable';
        } else {
            const row = sheetByName.get(exactKey(entriesById.get(talentId).nom));
            if (!row) {
                description = '';
                source = null;
                status = 'missing-reference';
            } else {
                description = typeof row.description === 'string' ? row.description : '';
                source = 'sheet';
                status = description.trim() ? 'available' : 'empty-reference';
            }
        }
        if (template && specialization && description.includes('{specialization}')) {
            description = description.replaceAll('{specialization}', specialization);
        }
        return { description, descriptionStatus: status, descriptionSource: source, displayedName,
            ...(specialization ? { specialization } : {}) };
    };
    const lookup = value => {
        const label = typeof value === 'string' ? value.trim() : '';
        if (!label) return { status: 'unknown', label };
        const key = exactKey(label);
        const direct = names.get(key) || [];
        const alias = resolveAlias(key);
        if (alias.status === 'resolved') {
            const entry = entriesById.get(alias.id);
            return { status: 'resolved', label, alias: true,
                ...(aliasMetadata.has(key) ? { aliasProvenance: aliasMetadata.get(key)[0].provenance || aliasMetadata.get(key)[0].origin || null } : {}),
                entry, ...describe(entry.id, label) };
        }
        if (alias.status === 'ambiguous' || alias.status === 'cycle') return { status: 'ambiguous', label, reason: alias.status };
        if (direct.length > 1) return { status: 'ambiguous', label, candidates: direct.map(id => entriesById.get(id)) };
        if (direct.length === 1) {
            const entry = entriesById.get(direct[0]);
            return { status: 'resolved', label, entry, ...describe(entry.id, label) };
        }
        const templateMatches = preparedTemplates.flatMap(template => {
            const match = label.match(template.expression);
            return match ? [{ template, specialization: match[1].trim() }] : [];
        });
        if (templateMatches.length === 1) {
            const { template, specialization } = templateMatches[0];
            const entry = entriesById.get(template.descriptionTalentId);
            return { status: 'resolved', label, template: true, entry, ...describe(entry.id, label, specialization, true) };
        }
        if (templateMatches.length > 1) return { status: 'ambiguous', label, reason: 'template-collision' };
        return { status: 'unknown', label };
    };
    const allNames = [...entriesById.values()].map(entry => entry.nom);
    const allAliases = [...aliasTargets.keys()];
    return Object.freeze({
        version,
        entries: Object.freeze([...entriesById.values()]),
        aliasErrors: Object.freeze(aliasErrors),
        resolve: lookup,
        suggest(value, limit = 8) {
            const key = suggestionKey(value);
            if (!key) return [];
            return [...new Set([...allNames, ...allAliases])]
                .map(label => ({ label, distance: levenshtein(key, suggestionKey(label)) }))
                .sort((left, right) => left.distance - right.distance || left.label.localeCompare(right.label, 'fr'))
                .slice(0, Math.max(0, Math.min(limit, 20)));
        },
    });
}

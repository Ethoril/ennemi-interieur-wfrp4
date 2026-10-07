const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '')
    .replace(/[’']/gu, "'").replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
const openChoice = (value, sourceMarker) => {
    const normalized = key(value).replace(/\s+au choix$/u, '');
    return normalized === key(sourceMarker)
        || /^(?:au choix|any(?: one)?|choice|sens|terrain|ennemi|menace|domaine|savoir divin|forme d'art|metier|savoir|don|groupe|cause|vent|rune|rune majeure|groupe social|cible)$/u.test(normalized);
};
export const ARCANE_WINDS = Object.freeze(['Aqshy', 'Azyr', 'Chamon', 'Ghur', 'Ghyran', 'Hysh', 'Shyish', 'Ulgu']);
const ARCANE_DOMAIN_NAMES = Object.freeze({
    fire: 'Aqshy', feu: 'Aqshy', heavens: 'Azyr', cieux: 'Azyr', metal: 'Chamon',
    beasts: 'Ghur', betes: 'Ghur', life: 'Ghyran', vie: 'Ghyran', light: 'Hysh', lumiere: 'Hysh',
    death: 'Shyish', mort: 'Shyish', shadows: 'Ulgu', ombres: 'Ulgu',
    'haute magie': 'Qhaysh', 'high magic': 'Qhaysh', 'the great maw': 'Grande Gueule',
});

export function parseTalentSourceRows(headers, rows) {
    const headerKey = value => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().replace(/[^a-z]/gu, '');
    const indexes = headers.map(headerKey);
    const columns = ['nomdutalent', 'resumeprecisdeleffet', 'limitedachat', 'sources'].map(name => indexes.indexOf(name));
    if (columns.some(index => index < 0)) throw new Error('Colonnes du tableau Talents inattendues.');
    const entries = rows.filter(row => row[columns[0]]).map(row => {
        const [sourceLabel, description, limitText, source] = columns.map(index => String(row[index] || '').trim());
        const separator = sourceLabel.indexOf(' (');
        if (separator < 0 || !sourceLabel.endsWith(')')) throw new Error(`Nom bilingue manquant : ${sourceLabel}`);
        const french = sourceLabel.slice(0, separator);
        const englishName = sourceLabel.slice(separator + 2, -1);
        const specializationLabel = french.match(/\[([^\]]+)\]/u)?.[1] || null;
        const nom = englishName === 'Demolisher' ? 'Démolisseur' : french.replace(/\s*\[[^\]]+\]/u, '').trim();
        const rule = parseTalentLimit(limitText);
        return { id: `talent-${englishName.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '')}`,
            nom, englishName, sourceLabel, description, limitText, source, specializationLabel,
            ...(specializationLabel && rule.kind === 'unlimited' ? { perSpecializationLimit: 1 } : {}) };
    });
    if (entries.length < 100 || new Set(entries.map(row => row.id)).size !== entries.length
        || entries.some(row => !row.description || !row.source)) throw new Error('Snapshot de talents incomplet ou ambigu.');
    return entries;
}

export function parseTalentLimit(value) {
    const text = key(value);
    if (/^[1-9]\d*$/u.test(text)) return { kind: 'fixed', value: Number(text) };
    if (text === 'sans limitation') return { kind: 'unlimited' };
    const bonuses = {
        'bonus de capacite de combat': 'cc', 'bonus de capacite de tir': 'ct', 'bonus de force': 'f',
        "bonus d'endurance": 'e', "bonus d'initiative": 'i', "bonus d'agilite": 'ag',
        'bonus de dexterite': 'dex', "bonus d'intelligence": 'int', 'bonus de force mentale': 'fm',
        'bonus de sociabilite': 'soc',
    };
    const caracs = text.split(/\s*\+\s*/u).map(part => bonuses[part]);
    if (caracs.length && caracs.every(Boolean)) return { kind: 'bonus', caracs };
    throw new TypeError(`Limite de talent non reconnue : ${value}`);
}

/** Le tableau bilingue est la règle ; les noms historiques servent uniquement d'alias. */
export function createSourceTalentResolver({ sheetSnapshot, legacyResolver }) {
    const byName = new Map();
    const entries = sheetSnapshot.entries.map(row => Object.freeze({
        ...row, id: row.id, sources: ['sheet'],
    }));
    const byEnglish = new Map(entries.map(entry => [key(entry.englishName), entry]));
    const add = (label, entry) => {
        const normalized = key(label);
        if (!normalized) return;
        const existing = byName.get(normalized);
        if (existing && existing.id !== entry.id) throw new TypeError(`Alias de talent ambigu : ${label}`);
        byName.set(normalized, entry);
    };
    for (const entry of entries) {
        if (!entry.id || !entry.nom || !entry.englishName || !entry.description?.trim()) throw new TypeError('Talent source incomplet.');
        parseTalentLimit(entry.limitText);
        for (const label of [entry.nom, entry.englishName, entry.sourceLabel]) add(label, entry);
    }
    for (const alias of sheetSnapshot.legacyAliases || []) {
        const entry = byEnglish.get(key(alias.englishName));
        if (!entry) throw new TypeError(`Cible d'alias de talent absente : ${alias.label}`);
        add(alias.label, entry);
    }
    const translations = new Map(Object.entries(sheetSnapshot.specializationTranslations || {}).map(([from, to]) => [key(from), to]));
    function resolve(value) {
        const label = typeof value === 'string' ? value.trim().replace(/\*+$/u, '').trim() : '';
        const direct = byName.get(key(label));
        const parts = label.match(/^(.*?)\s*(?:\(([^()]*)\)|\[([^\[\]]*)\])$/u);
        const base = parts ? byName.get(key(parts[1])) : byName.get(key(label.replace(/\s*\[[^\]]+\]$/u, '')));
        let entry = direct || base;
        let legacy;
        if (!entry) {
            legacy = legacyResolver.resolve(label);
            if (legacy.status === 'resolved') entry = byName.get(key(legacy.entry.nom));
            if (!entry) return legacy;
        }
        const rawSpec = !direct && parts && entry.specializationLabel ? (parts[2] || parts[3]).trim() : '';
        const translated = translations.get(key(rawSpec)) || rawSpec;
        let specialization = translated && !openChoice(translated, entry.specializationLabel) ? translated : null;
        if (entry.englishName === 'Fearless' && key(specialization) === 'tout') specialization = 'Tous';
        if (entry.englishName === 'Arcane Magic' && specialization) {
            specialization = ['wind', 'any arcane lore', 'domaine au choix'].includes(key(specialization)) ? null
                : specialization.split(/\s+(?:or|ou)\s+/iu).map(domain => {
                    const domainKey = key(domain).replace(/^lore of /u, '');
                    return ARCANE_DOMAIN_NAMES[domainKey]
                        || [...ARCANE_WINDS, 'Qhaysh'].find(wind => key(domain).startsWith(key(wind))) || domain;
                }).join(' ou ');
        }
        const open = Boolean(entry.specializationLabel && !specialization);
        const displayedName = specialization ? `${entry.nom} [${specialization}]`
            : entry.specializationLabel ? `${entry.nom} [${entry.specializationLabel}]` : entry.nom;
        const purchaseName = specialization ? `${entry.nom} (${specialization})` : entry.nom;
        const local = legacyResolver.resolve(entry.nom);
        const description = local.descriptionSource === 'site' ? local.description : entry.description;
        return {
            status: 'resolved', label, entry, sourceRule: true, alias: key(label) !== key(displayedName),
            template: Boolean(specialization), specialization, open, displayedName, purchaseName,
            description, descriptionStatus: local.descriptionSource === 'site' ? local.descriptionStatus
                : description?.trim() ? 'available' : 'empty-reference',
            descriptionSource: local.descriptionSource === 'site' ? 'site' : 'sheet',
            limitText: entry.limitText,
        };
    }
    return Object.freeze({ version: legacyResolver.version, entries: Object.freeze(entries),
        aliasErrors: legacyResolver.aliasErrors, resolve,
        purchaseStatus: (data, name) => talentPurchaseStatus(data, { resolve }, name),
        suggest: (...args) => legacyResolver.suggest(...args) });
}

export function talentPurchaseStatus(data, resolver, name) {
    const match = resolver?.resolve(name);
    if (match?.status !== 'resolved' || !match.sourceRule) return {
        allowed: false, known: false, taken: 0, reason: 'Talent absent du référentiel : limite inconnue.',
    };
    const entry = match.entry;
    const rule = parseTalentLimit(entry.limitText);
    const elf = ['elfe', 'haut-elfe', 'elfe-sylvain'].includes(data?.race);
    const arcane = entry.englishName === 'Arcane Magic';
    const qhaysh = arcane && elf && match.specialization === 'Qhaysh';
    const max = qhaysh ? 1 : arcane && elf ? (match.open ? 9 : 8) : rule.kind === 'unlimited' ? Infinity : rule.kind === 'fixed' ? rule.value
        : rule.caracs.reduce((sum, carac) => sum + Math.max(0, Math.floor(((Number(data?.carac?.[carac]?.base) || 0)
            + (Number(data?.carac?.[carac]?.adv) || 0)) / 10)), 0);
    const rows = (data?.talentsAcq || []).map(row => resolver.resolve(row?.nom));
    const same = rows.filter(row => row.status === 'resolved' && row.entry.id === entry.id);
    const taken = match.specialization ? same.filter(row => key(row.specialization) === key(match.specialization)).length : same.length;
    const totalTaken = arcane && elf && !match.open
        ? same.filter(row => qhaysh ? row.specialization === 'Qhaysh' : row.specialization !== 'Qhaysh').length : same.length;
    const perChoice = arcane ? 1 : entry.perSpecializationLimit;
    const missingChoice = Boolean(match.open || /\sou\s/u.test(match.specialization || ''));
    const choiceReached = Boolean(match.specialization && perChoice && taken >= perChoice);
    const reached = totalTaken >= max || choiceReached;
    const overLimit = totalTaken > max || Boolean(match.specialization && perChoice && taken > perChoice);
    const unknownDomains = arcane && same.some(row => row.open);
    const invalidWind = arcane && match.specialization && !missingChoice && (elf
        ? ![...ARCANE_WINDS, 'Qhaysh'].includes(match.specialization) : match.specialization === 'Qhaysh');
    const reason = unknownDomains ? 'Des domaines acquis ne sont pas précisés : le MJ doit les renseigner avant un nouvel achat.'
        : invalidWind ? 'Ce domaine nécessite une intervention du MJ.'
        : totalTaken >= max ? `Limite atteinte : ${totalTaken}/${max}.`
        : choiceReached ? 'Cette spécialité a déjà été acquise.' : missingChoice ? 'Choisissez une spécialité.' : '';
    return { known: true, allowed: !reached && !missingChoice && !unknownDomains && !invalidWind,
        reached, missingChoice, taken, totalTaken, max,
        overLimit, limitText: qhaysh ? '1 pour Qhaysh, en dehors des huit Vents'
            : arcane && elf ? '8 Vents pour les Elfes ; une acquisition par Vent ; Qhaysh à part (1)' : entry.limitText,
        specializationLabel: entry.specializationLabel, reason,
        warning: entry.englishName === 'Hardy'
            ? 'Les blessures de Dur à cuire sont déjà prises en compte dans le maximum calculé. Le MJ ne doit pas ajouter ce bonus une seconde fois.'
            : 'Les effets de ce talent ne sont pas appliqués automatiquement. Le MJ doit appliquer les nouveaux bonus et vérifier ceux déjà pris en compte.',
    };
}

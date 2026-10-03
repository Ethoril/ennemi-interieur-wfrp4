export const MAX_GROUPS = 20;
export const MAX_GROUP_LENGTH = 200;

function cleanGroup(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
}

export function groupKey(text) {
    return cleanGroup(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function normalizeGroups(array, catalog = []) {
    if (!Array.isArray(array)) return [];
    const spellings = new Map();
    for (const item of Array.isArray(catalog) ? catalog : []) {
        const label = cleanGroup(item);
        const key = groupKey(label);
        if (key && !spellings.has(key)) spellings.set(key, label);
    }
    const seen = new Set();
    const groups = [];
    for (const item of array) {
        const label = cleanGroup(item);
        const key = groupKey(label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        groups.push(spellings.get(key) ?? label);
    }
    return groups;
}

export function pnjGroups(pnj) {
    if (Array.isArray(pnj?.groupes)) return normalizeGroups(pnj.groupes);
    return normalizeGroups(Array.isArray(pnj?.groupe) ? pnj.groupe : [pnj?.groupe]);
}

export function groupCatalog(nodes) {
    const groups = normalizeGroups((Array.isArray(nodes) ? nodes : []).flatMap(pnjGroups));
    return groups.sort((left, right) => left.localeCompare(right, 'fr', { sensitivity: 'base' }) || left.localeCompare(right));
}

export function groupLabel(pnj) {
    return pnjGroups(pnj).join(', ');
}

export function matchesGroupFilter(pnj, selected) {
    const keys = new Set(Array.from(selected ?? [], groupKey));
    return keys.size === 0 || pnjGroups(pnj).some(group => keys.has(groupKey(group)));
}

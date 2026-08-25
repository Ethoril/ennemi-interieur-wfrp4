import { foldEnqueteSearch, validId } from './enquete-list-model.js';

function text(value, maximum = 30000) { return typeof value === 'string' ? value.trim().slice(0, maximum) : ''; }

function fold(value) { return text(value, 30000).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim(); }

function compare(left, right) {
    const leftOrder = typeof left.ordre === 'number' && Number.isFinite(left.ordre) ? left.ordre : null;
    const rightOrder = typeof right.ordre === 'number' && Number.isFinite(right.ordre) ? right.ordre : null;
    if (leftOrder === null && rightOrder !== null) return 1;
    if (leftOrder !== null && rightOrder === null) return -1;
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    const a = fold(left.titre), b = fold(right.titre);
    return a < b ? -1 : a > b ? 1 : String(left.id).localeCompare(String(right.id));
}

function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)])));
    return value;
}

export function createEnquetesAdminListModel({ items = [], search = '', filter = 'all' } = {}) {
    const normalized = (Array.isArray(items) ? items : []).filter(item => validId(item?.id)
        && (!Array.isArray(item.issues) || item.issues.length === 0)
        && typeof item.titre === 'string' && item.titre.trim()).map(item => ({
        id: item.id,
        titre: text(item.titre, 200),
        description: text(item.description),
        decouvert: item.decouvert === true,
        ordre: typeof item.ordre === 'number' && Number.isFinite(item.ordre) ? item.ordre : null,
        pnjsLies: [...new Set(Array.isArray(item.pnjsLies) ? item.pnjsLies.filter(id => validId(id)) : [])],
        image: item.image && typeof item.image === 'object' ? { path: item.image.path ?? null, legacy: item.image.legacy === true, invalid: item.image.invalid === true } : { path: null, legacy: false, invalid: false },
        updatedAt: item.updatedAt ?? null,
    })).sort(compare);
    const needle = fold(search);
    const result = normalized.filter(item => {
        if (filter === 'discovered' && !item.decouvert) return false;
        if (filter === 'secret' && item.decouvert) return false;
        return !needle || fold(`${item.titre} ${item.description}`).includes(needle);
    });
    return freeze({ items: normalized, results: result, search: text(search, 120), filter: ['all', 'discovered', 'secret'].includes(filter) ? filter : 'all', counts: {
        all: normalized.length, discovered: normalized.filter(item => item.decouvert).length, secret: normalized.filter(item => !item.decouvert).length,
    }, emptyState: normalized.length === 0 ? 'none' : result.length === 0 ? 'no-results' : null });
}

export { foldEnqueteSearch };

import { statutKey } from '../seal.js';
import { pnjGroups, groupCatalog, groupKey } from '../pnj-groups.js';

const FILTER_DIMENSIONS = Object.freeze(['groupe', 'statut', 'lieu']);
// Puces rapides : un critère distinct de la feuille de filtres, combiné avec elle en ET.
const QUICK_FILTERS = Object.freeze(['tous', 'allie', 'neutre', 'ennemi', 'decede']);
const DEFAULT_QUICK = 'tous';
const UNKNOWN_LIEU_LABEL = 'Lieu inconnu';
const SEARCH_FIELDS = Object.freeze([
    'nom', 'surnom', 'role', 'rôle', 'profession', 'statut', 'vivant', 'lieu', 'groupe', 'groupes',
]);
const PUBLIC_ID = /^[A-Za-z0-9_-]{1,150}$/u;

function freezeValue(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeValue(item)])));
    }
    return value;
}

function safeText(value, maximum = 200) {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

/** Retourne une clé de recherche stable entre Node et navigateur. */
export function foldSearchText(value) {
    const text = safeText(value, 5000);
    if (!text) return '';
    return text.normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/[’ʻʼ`']/gu, '')
        .toLowerCase()
        .replace(/\s+/gu, ' ')
        .trim();
}

function valuesFor(item, field) {
    const value = item?.[field];
    if (Array.isArray(value)) return value.filter(entry => typeof entry === 'string').map(entry => safeText(entry));
    return typeof value === 'string' ? [safeText(value)] : [];
}

function dimensionValues(item, dimension) {
    if (dimension === 'groupe') return pnjGroups(item);
    return valuesFor(item, dimension).filter(Boolean);
}

function sortText(left, right) {
    const leftFolded = foldSearchText(left);
    const rightFolded = foldSearchText(right);
    const folded = leftFolded < rightFolded ? -1 : leftFolded > rightFolded ? 1 : 0;
    if (folded) return folded;
    const leftRaw = safeText(left);
    const rightRaw = safeText(right);
    return leftRaw < rightRaw ? -1 : leftRaw > rightRaw ? 1 : 0;
}

function comparePnj(left, right) {
    const leftOrder = typeof left?.ordre === 'number' && Number.isFinite(left.ordre) ? left.ordre : null;
    const rightOrder = typeof right?.ordre === 'number' && Number.isFinite(right.ordre) ? right.ordre : null;
    if (leftOrder === null && rightOrder !== null) return 1;
    if (leftOrder !== null && rightOrder === null) return -1;
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    return sortText(left?.nom, right?.nom) || sortText(left?.id, right?.id);
}

export function sortPnjs(items) {
    return Object.freeze((Array.isArray(items) ? items : []).slice().sort(comparePnj).map(freezeValue));
}

function normalizeItem(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const output = { ...item };
    if (typeof output.id !== 'string' || !PUBLIC_ID.test(output.id)) return null;
    return output;
}

function normalizedItems(items) {
    const seen = new Set();
    return sortPnjs((Array.isArray(items) ? items : []).map(normalizeItem).filter(item => {
        if (!item || seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    }));
}

function uniqueSorted(values) {
    const unique = [...new Set(values.filter(Boolean))];
    return Object.freeze(unique.sort(sortText));
}

export function buildPnjFacets(items) {
    const source = Array.isArray(items) ? items : [];
    return freezeValue(Object.fromEntries(FILTER_DIMENSIONS.map(dimension => [dimension, dimension === 'groupe'
        ? groupCatalog(source)
        : uniqueSorted(source.flatMap(item => dimensionValues(item, dimension)))])));
}

function normalizeFilterValues(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(entry => typeof entry === 'string').map(entry => safeText(entry)).filter(Boolean))];
}

export function reconcilePnjFilters(filters, facets) {
    const input = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
    return freezeValue(Object.fromEntries(FILTER_DIMENSIONS.map(dimension => {
        const allowed = Array.isArray(facets?.[dimension]) ? facets[dimension] : [];
        if (dimension === 'groupe') {
            const byKey = new Map(allowed.map(value => [groupKey(value), value]));
            return [dimension, [...new Set(normalizeFilterValues(input[dimension]).map(value => byKey.get(groupKey(value))).filter(Boolean))]];
        }
        const allowedSet = new Set(allowed);
        return [dimension, normalizeFilterValues(input[dimension]).filter(value => allowedSet.has(value))];
    })));
}

function matchesSearch(item, query) {
    const folded = foldSearchText(query);
    if (!folded) return true;
    return SEARCH_FIELDS.some(field => valuesFor(item, field).some(value => foldSearchText(value).includes(folded)));
}

function matchesFilters(item, filters) {
    return FILTER_DIMENSIONS.every(dimension => {
        const selected = Array.isArray(filters?.[dimension]) ? filters[dimension] : [];
        if (!selected.length) return true;
        const values = new Set(dimensionValues(item, dimension).map(value => dimension === 'groupe' ? groupKey(value) : value));
        return selected.some(value => values.has(dimension === 'groupe' ? groupKey(value) : value));
    });
}

export function filterPnjs(items, { search = '', filters = {} } = {}) {
    const source = Array.isArray(items) ? items : [];
    return Object.freeze(source.filter(item => matchesSearch(item, search) && matchesFilters(item, filters)));
}

/** Clé d'état vital (vivant, decede, inconnu) ; chaîne vide hors du vocabulaire du dépôt. */
export function vivantKey(vivant) {
    const value = typeof vivant === 'string' ? vivant.trim().toLowerCase() : '';
    return value === 'oui' ? 'vivant' : value === 'non' ? 'decede' : value === 'inconnu' ? 'inconnu' : '';
}

export function normalizeQuickFilter(value) {
    return QUICK_FILTERS.includes(value) ? value : DEFAULT_QUICK;
}

export function matchesQuickFilter(item, quick) {
    const key = normalizeQuickFilter(quick);
    if (key === 'tous') return true;
    if (key === 'decede') return vivantKey(item?.vivant) === 'decede';
    return statutKey(item?.statut) === key;
}

/** Regroupe par lieu (tri plié, « Lieu inconnu » en dernier) sans changer l'ordre des PNJs d'un lieu. */
export function groupPnjsByLieu(items) {
    const groups = new Map();
    const unknown = [];
    for (const item of Array.isArray(items) ? items : []) {
        const lieu = valuesFor(item, 'lieu')[0] || '';
        if (!lieu) { unknown.push(item); continue; }
        if (!groups.has(lieu)) groups.set(lieu, []);
        groups.get(lieu).push(item);
    }
    const output = [...groups.keys()].sort(sortText)
        .map(lieu => ({ key: lieu, label: lieu, items: groups.get(lieu) }));
    if (unknown.length) output.push({ key: '', label: UNKNOWN_LIEU_LABEL, items: unknown });
    return freezeValue(output.map(group => ({ ...group, count: group.items.length })));
}

function viewState(items, search, requestedFilters, requestedQuick) {
    const facets = buildPnjFacets(items);
    const filters = reconcilePnjFilters(requestedFilters, facets);
    const quick = normalizeQuickFilter(requestedQuick);
    const safeSearch = safeText(search, 120);
    // L'effectif d'une puce est celui qu'elle donnerait avec la recherche et la feuille actuelles.
    const filtered = filterPnjs(items, { search, filters });
    const quickCounts = Object.fromEntries(QUICK_FILTERS.map(key => [key,
        filtered.filter(item => matchesQuickFilter(item, key)).length]));
    const results = filtered.filter(item => matchesQuickFilter(item, quick));
    const activeFilterCount = FILTER_DIMENSIONS.reduce((count, dimension) => count + filters[dimension].length, 0);
    return freezeValue({
        items,
        results,
        groups: groupPnjsByLieu(results),
        search: safeSearch,
        facets,
        filters,
        quick,
        quickCounts,
        activeFilterCount,
        criteriaActive: Boolean(foldSearchText(safeSearch)) || activeFilterCount > 0 || quick !== DEFAULT_QUICK,
        emptyState: items.length === 0 ? 'no-published' : results.length === 0 ? 'no-results' : null,
    });
}

export function createPnjListModel({ items = [], search = '', filters = {}, quick = DEFAULT_QUICK } = {}) {
    let current = viewState(normalizedItems(items), search, filters, quick);
    const update = (nextItems = current.items, nextSearch = current.search, nextFilters = current.filters, nextQuick = current.quick) => {
        current = viewState(normalizedItems(nextItems), nextSearch, nextFilters, nextQuick);
        return current;
    };
    return Object.freeze({
        getState: () => current,
        setItems: nextItems => update(nextItems),
        setSearch: nextSearch => update(current.items, nextSearch),
        setFilters: nextFilters => update(current.items, current.search, nextFilters),
        setQuick: nextQuick => update(current.items, current.search, current.filters, nextQuick),
        clearFilters: () => update(current.items, current.search, {}),
    });
}

export { DEFAULT_QUICK, FILTER_DIMENSIONS, QUICK_FILTERS, SEARCH_FIELDS, UNKNOWN_LIEU_LABEL };

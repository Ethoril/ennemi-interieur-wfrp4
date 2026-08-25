const FILTER_DIMENSIONS = Object.freeze(['groupe', 'statut', 'lieu']);
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
    if (dimension === 'groupe') return [...valuesFor(item, 'groupe'), ...valuesFor(item, 'groupes')].filter(Boolean);
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
    return freezeValue(Object.fromEntries(FILTER_DIMENSIONS.map(dimension => [dimension,
        uniqueSorted(source.flatMap(item => dimensionValues(item, dimension)))])));
}

function normalizeFilterValues(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(entry => typeof entry === 'string').map(entry => safeText(entry)).filter(Boolean))];
}

export function reconcilePnjFilters(filters, facets) {
    const input = filters && typeof filters === 'object' && !Array.isArray(filters) ? filters : {};
    return freezeValue(Object.fromEntries(FILTER_DIMENSIONS.map(dimension => {
        const allowed = new Set(Array.isArray(facets?.[dimension]) ? facets[dimension] : []);
        return [dimension, normalizeFilterValues(input[dimension]).filter(value => allowed.has(value))];
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
        const values = new Set(dimensionValues(item, dimension));
        return selected.some(value => values.has(value));
    });
}

export function filterPnjs(items, { search = '', filters = {} } = {}) {
    const source = Array.isArray(items) ? items : [];
    return Object.freeze(source.filter(item => matchesSearch(item, search) && matchesFilters(item, filters)));
}

function viewState(items, search, requestedFilters) {
    const facets = buildPnjFacets(items);
    const filters = reconcilePnjFilters(requestedFilters, facets);
    const results = filterPnjs(items, { search, filters });
    return freezeValue({
        items,
        results,
        search: safeText(search, 120),
        facets,
        filters,
        activeFilterCount: FILTER_DIMENSIONS.reduce((count, dimension) => count + filters[dimension].length, 0),
        emptyState: items.length === 0 ? 'no-published' : results.length === 0 ? 'no-results' : null,
    });
}

export function createPnjListModel({ items = [], search = '', filters = {} } = {}) {
    let current = viewState(normalizedItems(items), search, filters);
    const update = (nextItems = current.items, nextSearch = current.search, nextFilters = current.filters) => {
        current = viewState(normalizedItems(nextItems), nextSearch, nextFilters);
        return current;
    };
    return Object.freeze({
        getState: () => current,
        setItems: nextItems => update(nextItems),
        setSearch: nextSearch => update(current.items, nextSearch),
        setFilters: nextFilters => update(current.items, current.search, nextFilters),
        clearFilters: () => update(current.items, current.search, {}),
    });
}

export { FILTER_DIMENSIONS, SEARCH_FIELDS };

const PUBLIC_ID = /^[A-Za-z0-9_-]{1,150}$/u;

function text(value, maximum = 30000) {
    return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function validId(value) { return typeof value === 'string' && PUBLIC_ID.test(value); }

function fold(value) {
    return text(value, 30000).normalize('NFKD').replace(/\p{M}/gu, '')
        .replace(/[’ʻʼ`']/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function compareText(left, right) {
    const a = fold(left), b = fold(right);
    return a < b ? -1 : a > b ? 1 : text(left) < text(right) ? -1 : text(left) > text(right) ? 1 : 0;
}

function timestampValue(value) {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
    if (typeof value?.toMillis === 'function') {
        try {
            const result = value.toMillis();
            return Number.isFinite(result) && Math.abs(result) <= 8640000000000000 ? result : null;
        } catch {
            return null;
        }
    }
    if (typeof value?.seconds === 'number' && Number.isSafeInteger(value.seconds)
        && Math.abs(value.seconds) <= 8640000000000
        && typeof value.nanoseconds === 'number'
        && Number.isInteger(value.nanoseconds) && value.nanoseconds >= 0 && value.nanoseconds <= 999999999) {
        return value.seconds * 1000 + value.nanoseconds / 1e6;
    }
    return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8640000000000000 ? value : null;
}

function compareIndice(left, right) {
    const leftOrder = typeof left?.ordre === 'number' && Number.isFinite(left.ordre) ? left.ordre : null;
    const rightOrder = typeof right?.ordre === 'number' && Number.isFinite(right.ordre) ? right.ordre : null;
    if (leftOrder === null && rightOrder !== null) return 1;
    if (leftOrder !== null && rightOrder === null) return -1;
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftDate = timestampValue(left?.dateDecouverte);
    const rightDate = timestampValue(right?.dateDecouverte);
    if (leftDate === null && rightDate !== null) return 1;
    if (leftDate !== null && rightDate === null) return -1;
    if (leftDate !== null && rightDate !== null && leftDate !== rightDate) return rightDate - leftDate;
    return compareText(left?.titre, right?.titre) || compareText(left?.id, right?.id);
}

function freeze(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freeze));
    if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freeze(child)])));
    }
    return value;
}

function visiblePnjs(items) {
    return new Map((Array.isArray(items) ? items : [])
        .filter(item => validId(item?.id) && item.visibleJoueurs === true && item.suppressionEnCours !== true)
        .filter(item => !Array.isArray(item.issues) || item.issues.length === 0)
        .map(item => [item.id, { id: item.id, nom: text(item.nom, 200) || 'PNJ sans nom' }]));
}

function project(item, pnjMap) {
    if (!item || !validId(item.id) || item.decouvert !== true
        || (Array.isArray(item.issues) && item.issues.length > 0)
        || typeof item.titre !== 'string' || !item.titre.trim()) return null;
    const linkedPnjs = [...new Set(Array.isArray(item.pnjsLies) ? item.pnjsLies : [])]
        .filter(id => validId(id) && pnjMap.has(id)).map(id => pnjMap.get(id));
    return {
        id: item.id,
        titre: text(item.titre, 200) || 'Indice sans titre',
        description: text(item.description),
        pnjs: linkedPnjs,
        image: item.image && typeof item.image === 'object' ? {
            path: typeof item.image.path === 'string' ? item.image.path : null,
            legacy: item.image.legacy === true,
            invalid: item.image.invalid === true,
        } : { path: null, legacy: false, invalid: false },
        ordre: typeof item.ordre === 'number' && Number.isFinite(item.ordre) ? item.ordre : null,
        dateDecouverte: item.dateDecouverte ?? null,
    };
}

function matches(item, query) {
    const needle = fold(query);
    if (!needle) return true;
    return [item.titre, item.description, ...item.pnjs.map(pnj => pnj.nom)].some(value => fold(value).includes(needle));
}

export function sortEnquetes(items) { return Object.freeze((Array.isArray(items) ? items : []).slice().sort(compareIndice).map(freeze)); }

export function createEnquetesListModel({ items = [], pnjs = [], search = '' } = {}) {
    let current;
    let sourceItems = items;
    let sourcePnjs = pnjs;
    const update = (nextItems = sourceItems, nextPnjs = sourcePnjs, nextSearch = search) => {
        sourceItems = nextItems;
        sourcePnjs = nextPnjs;
        const pnjMap = visiblePnjs(nextPnjs);
        const projected = (Array.isArray(nextItems) ? nextItems : []).map(item => project(item, pnjMap)).filter(Boolean);
        const normalizedSearch = text(nextSearch, 120);
        const ordered = sortEnquetes(projected);
        const results = Object.freeze(ordered.filter(item => matches(item, normalizedSearch)));
        current = freeze({ items: ordered, results, search: normalizedSearch,
            emptyState: ordered.length === 0 ? 'none-discovered' : results.length === 0 ? 'no-results' : null });
        return current;
    };
    update();
    return Object.freeze({ getState: () => current, setItems: value => update(value, sourcePnjs, current.search), setPnjs: value => update(sourceItems, value, current.search), setSearch: value => update(sourceItems, sourcePnjs, value) });
}

export const createEnqueteListModel = createEnquetesListModel;

export function selectEnquetesListModel(state, search = state?.preferences?.enqueteSearch ?? '') {
    const indices = state?.resources?.indices ?? { status: 'loading', items: [] };
    const pnjs = state?.resources?.pnjs ?? { items: [] };
    if (state?.connection?.phase === 'offline-empty') return freeze({ kind: 'offline-empty', retry: true, message: 'Une première connexion est nécessaire pour charger les enquêtes.' });
    if (state?.error) return freeze({ kind: 'error', retry: true, message: 'Les données publiques ne peuvent pas être chargées.' });
    if (indices.status === 'loading') return freeze({ kind: 'loading', retry: false, message: 'Chargement du carnet d’enquêtes…' });
    if (indices.status === 'error' && !indices.items?.length) return freeze({ kind: 'error', retry: true, message: 'Les enquêtes découvertes ne peuvent pas être chargées.' });
    const model = createEnquetesListModel({ items: indices.items, pnjs: pnjs.items, search }).getState();
    return freeze({ kind: 'ready', list: model, warning: indices.status === 'error' ? 'Mise à jour impossible : les dernières enquêtes reçues restent consultables.' : '' });
}

export const selectEnqueteListModel = selectEnquetesListModel;

export { fold as foldEnqueteSearch, validId };

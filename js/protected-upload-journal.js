const STORAGE_KEY = 'wfrp:protected-upload-cleanup:v1';
const COLLECTIONS = new Set(['pnjs', 'indices']);
// Seuls les chemins protégés, liés au bon propriétaire, sont supprimables en reprise.
// Les anciens chemins plats restent du ressort de l'inventaire opérateur M1-03/M1-04.
const PATH_PATTERN = /^(?:portraits|indices)\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9._-]{1,200}$/u;
const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const prefixFor = collection => collection === 'pnjs' ? 'portraits' : 'indices';
const validJournalPath = (collection, ownerId, path) => typeof ownerId === 'string'
    && OWNER_PATTERN.test(ownerId) && PATH_PATTERN.test(path)
    && path.split('/').every(segment => segment !== '.' && segment !== '..')
    && path.split('/')[0] === prefixFor(collection) && path.split('/')[1] === ownerId;

function read(storage = globalThis.localStorage) {
    try {
        const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => item && COLLECTIONS.has(item.collection)
            && validJournalPath(item.collection, item.ownerId, item.path)
            && Number.isFinite(item.createdAt)) : [];
    } catch { return []; }
}

function write(items, storage = globalThis.localStorage) {
    try {
        if (!storage) return false;
        storage.setItem(STORAGE_KEY, JSON.stringify(items));
        return true;
    } catch { return false; }
}

export function rememberProtectedUpload(entry, storage = globalThis.localStorage, now = Date.now()) {
    if (!COLLECTIONS.has(entry?.collection) || typeof entry.ownerId !== 'string'
        || !validJournalPath(entry.collection, entry.ownerId, entry?.path ?? '')) return false;
    const items = read(storage).filter(item => item.path !== entry.path);
    items.push({ collection: entry.collection, ownerId: entry.ownerId, path: entry.path, createdAt: now });
    return write(items, storage);
}

export function forgetProtectedUpload(path, storage = globalThis.localStorage) {
    return write(read(storage).filter(item => item.path !== path), storage);
}

export function pendingProtectedUploads(storage = globalThis.localStorage) {
    return read(storage);
}

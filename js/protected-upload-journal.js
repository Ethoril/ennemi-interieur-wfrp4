const STORAGE_KEY = 'wfrp:protected-upload-cleanup:v1';
const COLLECTIONS = new Set(['pnjs', 'indices']);
const PATH_PATTERN = /^(?:portraits|indices)\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9._-]{1,200}$/u;

function read(storage = globalThis.localStorage) {
    try {
        const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(item => item && COLLECTIONS.has(item.collection)
            && typeof item.ownerId === 'string' && PATH_PATTERN.test(item.path)
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
        || !PATH_PATTERN.test(entry?.path ?? '')) return false;
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

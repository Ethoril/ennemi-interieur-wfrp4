import { ref } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// Transforme une ancienne référence en chemin local sans accepter une cible externe.
function validStoragePath(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 512
        && /^(?:portraits|indices)\/[^/]+(?:\/[^/]+)?$/u.test(path)
        && path.split('/').every(segment => segment !== '.' && segment !== '..');
}

function expectedBucket(storage) {
    return storage?.app?.options?.storageBucket || null;
}

export function safeStorageReference(storage, value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
    if (validStoragePath(value)) return ref(storage, value);
    let url;
    try {
        if (value.startsWith('gs://')) {
            const slash = value.indexOf('/', 5);
            if (slash < 0 || value.slice(5, slash) !== expectedBucket(storage)) return null;
            const path = value.slice(slash + 1);
            return validStoragePath(path) ? ref(storage, path) : null;
        }
        url = new URL(value);
    } catch { return null; }
    if (url.hostname === 'storage.googleapis.com') {
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length < 2 || segments[0] !== expectedBucket(storage)) return null;
        try {
            const path = decodeURIComponent(segments.slice(1).join('/'));
            return validStoragePath(path) ? ref(storage, path) : null;
        } catch { return null; }
    }
    if (url.hostname !== 'firebasestorage.googleapis.com' && !url.hostname.endsWith('.firebasestorage.app')) return null;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/u);
    if (!match || match[1] !== expectedBucket(storage)) return null;
    try {
        const path = decodeURIComponent(match[2]);
        return validStoragePath(path) ? ref(storage, path) : null;
    } catch { return null; }
}

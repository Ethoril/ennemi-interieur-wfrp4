const MAX_ID_LENGTH = 150;
const MAX_IMAGE_FILE_LENGTH = 128;
const STORAGE_BUCKETS = new Set(['campagne-wrpg.firebasestorage.app', 'campagne-wrpg.appspot.com']);

function issue(field, code) {
    return { field, code };
}

function readSnapshot(snapshot) {
    const id = typeof snapshot?.id === 'string' ? snapshot.id : '';
    const data = typeof snapshot?.data === 'function' ? snapshot.data() : snapshot?.data ?? snapshot;
    return { id, data: data && typeof data === 'object' && !Array.isArray(data) ? data : {} };
}

function base(id, issues) {
    return { id, issues };
}

function text(data, field, issues, { defaultValue = '', max = Infinity } = {}) {
    const value = data[field];
    if (typeof value === 'string' && value.length <= max) return value;
    if (value !== undefined && value !== null) issues.push(issue(field, 'invalid-type'));
    return defaultValue;
}

function boolean(data, field, issues) {
    if (typeof data[field] === 'boolean') return data[field];
    issues.push(issue(field, data[field] === undefined ? 'missing' : 'invalid-type'));
    return false;
}

function number(data, field, issues) {
    if (data[field] === null || data[field] === undefined) return null;
    if (typeof data[field] === 'number' && Number.isFinite(data[field])) return data[field];
    issues.push(issue(field, 'invalid-type'));
    return null;
}

export function normalizeTimestamp(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        const milliseconds = value.getTime();
        const seconds = Math.floor(milliseconds / 1000);
        return { seconds, nanoseconds: (milliseconds - seconds * 1000) * 1e6 };
    }
    if (typeof value?.toMillis === 'function') return normalizeTimestamp(new Date(value.toMillis()));
    if (typeof value?.seconds === 'number' && Number.isSafeInteger(value.seconds)
        && typeof (value.nanoseconds ?? 0) === 'number' && Number.isInteger(value.nanoseconds ?? 0)
        && (value.nanoseconds ?? 0) >= 0 && (value.nanoseconds ?? 0) < 1e9) {
        return { seconds: value.seconds, nanoseconds: value.nanoseconds ?? 0 };
    }
    return null;
}

function timestamp(data, field, issues) {
    if (data[field] === undefined || data[field] === null) return null;
    const value = normalizeTimestamp(data[field]);
    if (!value) issues.push(issue(field, 'invalid-timestamp'));
    return value;
}

function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
        && /^[A-Za-z0-9_-]+$/u.test(value);
}

function imagePath(data, field, prefix, id, issues) {
    const value = data[field];
    if (value === undefined || value === null || value === '') return null;
    const parts = typeof value === 'string' ? value.split('/') : [];
    if (parts.length === 3 && parts[0] === prefix && parts[1] === id
        && parts[2].length > 0 && parts[2].length <= MAX_IMAGE_FILE_LENGTH
        && !['.', '..'].includes(parts[2])) return value;
    issues.push(issue(field, 'invalid-reference'));
    return null;
}

function validLegacyImageReference(value) {
    if (value.startsWith('gs://')) {
        const slash = value.indexOf('/', 5);
        const bucket = slash >= 0 ? value.slice(5, slash) : '';
        const path = slash >= 0 ? value.slice(slash + 1) : '';
        return STORAGE_BUCKETS.has(bucket) && path.length > 0 && !path.split('/').includes('..');
    }
    try {
        const url = new URL(value);
        let bucket = null;
        let path = '';
        if (url.hostname === 'storage.googleapis.com') {
            const parts = url.pathname.split('/').filter(Boolean);
            bucket = parts.shift() ?? null;
            path = parts.join('/');
        } else if (url.hostname === 'firebasestorage.googleapis.com') {
            const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/u);
            bucket = match?.[1] ?? null;
            path = match?.[2] ?? '';
        } else if (STORAGE_BUCKETS.has(url.hostname)) {
            bucket = url.hostname;
            path = url.pathname.slice(1);
        }
        const decodedPath = path ? decodeURIComponent(path) : '';
        return STORAGE_BUCKETS.has(bucket) && decodedPath.length > 0 && !decodedPath.split('/').includes('..');
    } catch {
        return false;
    }
}

function legacyImageUrl(data, issues) {
    const value = data.imageUrl;
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string' && value.length <= 2048
        && /^(?:https?:\/\/|gs:\/\/)/u.test(value) && validLegacyImageReference(value)) return value;
    issues.push(issue('imageUrl', 'invalid-reference'));
    return null;
}

function relatedIds(data, issues) {
    if (data.pnjsLies === undefined || data.pnjsLies === null) return [];
    if (!Array.isArray(data.pnjsLies)) {
        issues.push(issue('pnjsLies', 'invalid-type'));
        return [];
    }
    const seen = new Set();
    const values = data.pnjsLies.length > 100 ? data.pnjsLies.slice(0, 100) : data.pnjsLies;
    if (data.pnjsLies.length > 100) issues.push(issue('pnjsLies', 'too-many-references'));
    return values.filter(value => {
        if (!validId(value)) {
            issues.push(issue('pnjsLies', 'invalid-reference'));
            return false;
        }
        if (seen.has(value)) {
            issues.push(issue('pnjsLies', 'duplicate-reference'));
            return false;
        }
        seen.add(value);
        return true;
    });
}

function finish(value, id, issues) {
    return { ...value, ...base(id, issues) };
}

export function normalizePnjPublic(snapshot) {
    const { id, data } = readSnapshot(snapshot);
    const issues = [];
    if (!validId(id)) issues.push(issue('id', 'invalid-id'));
    const suppressionEnCours = data.suppressionEnCours;
    if (suppressionEnCours === true) issues.push(issue('suppressionEnCours', 'suppression-in-progress'));
    else if (suppressionEnCours !== undefined && typeof suppressionEnCours !== 'boolean') {
        issues.push(issue('suppressionEnCours', 'invalid-type'));
    }
    const visibleJoueurs = boolean(data, 'visibleJoueurs', issues);
    return finish({
        nom: text(data, 'nom', issues, { max: 200 }),
        statut: text(data, 'statut', issues, { max: 64 }),
        vivant: text(data, 'vivant', issues, { max: 32 }),
        lieu: text(data, 'lieu', issues, { max: 200 }),
        groupe: text(data, 'groupe', issues, { max: 200 }),
        description: text(data, 'description', issues, { max: 20000 }),
        visibleJoueurs: suppressionEnCours === undefined || suppressionEnCours === false ? visibleJoueurs : false,
        suppressionEnCours: suppressionEnCours === true,
        imagePath: imagePath(data, 'imagePath', 'portraits', id, issues),
        imageUrl: legacyImageUrl(data, issues),
        ordre: number(data, 'ordre', issues),
        createdAt: timestamp(data, 'createdAt', issues),
        updatedAt: timestamp(data, 'updatedAt', issues),
    }, id, issues);
}

export function normalizePnjPrivate(snapshot) {
    const { id, data } = readSnapshot(snapshot);
    const issues = [];
    if (!validId(id)) issues.push(issue('id', 'invalid-id'));
    return finish({
        notes: text(data, 'notes', issues, { max: 30000 }),
        updatedAt: timestamp(data, 'updatedAt', issues),
    }, id, issues);
}

export function normalizeRelation(snapshot) {
    const { id, data } = readSnapshot(snapshot);
    const issues = [];
    const source = text(data, 'source', issues, { max: MAX_ID_LENGTH });
    const cible = text(data, 'cible', issues, { max: MAX_ID_LENGTH });
    if (!validId(id)) issues.push(issue('id', 'invalid-id'));
    if (!validId(source)) issues.push(issue('source', 'invalid-reference'));
    if (!validId(cible)) issues.push(issue('cible', 'invalid-reference'));
    if (source && source === cible) issues.push(issue('cible', 'self-reference'));
    const style = data.style === 'solid' || data.style === 'dashed' ? data.style : '';
    const color = data.color === null || data.color === undefined ? null : text(data, 'color', issues, { max: 32 });
    const safeColor = /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu.test(color) ? color : null;
    if (color && !safeColor) issues.push(issue('color', 'invalid-css-color'));
    if (data.style !== undefined && style === '') issues.push(issue('style', 'invalid-value'));
    return finish({
        source: validId(source) ? source : '',
        cible: validId(cible) ? cible : '',
        type: text(data, 'type', issues, { max: 100 }),
        label: text(data, 'label', issues, { max: 300 }),
        color: safeColor,
        style,
        visibleJoueurs: boolean(data, 'visibleJoueurs', issues),
        createdAt: timestamp(data, 'createdAt', issues),
        updatedAt: timestamp(data, 'updatedAt', issues),
    }, id, issues);
}

export function normalizeIndice(snapshot) {
    const { id, data } = readSnapshot(snapshot);
    const issues = [];
    if (!validId(id)) issues.push(issue('id', 'invalid-id'));
    return finish({
        titre: text(data, 'titre', issues, { max: 200 }),
        description: text(data, 'description', issues, { max: 30000 }),
        decouvert: boolean(data, 'decouvert', issues),
        pnjsLies: relatedIds(data, issues),
        imagePath: imagePath(data, 'imagePath', 'indices', id, issues),
        imageUrl: legacyImageUrl(data, issues),
        dateDecouverte: timestamp(data, 'dateDecouverte', issues),
        source: text(data, 'source', issues, { max: 150 }),
        type: text(data, 'type', issues, { max: 100 }),
        ordre: number(data, 'ordre', issues),
        createdAt: timestamp(data, 'createdAt', issues),
        updatedAt: timestamp(data, 'updatedAt', issues),
    }, id, issues);
}

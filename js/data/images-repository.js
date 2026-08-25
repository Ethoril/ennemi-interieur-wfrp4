import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';

const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const FILE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif',
});
const MAX_BYTES = Object.freeze({ portrait: 2 * 1024 * 1024, indice: 5 * 1024 * 1024 });

function fail(operation, kind = ERROR_KINDS.VALIDATION) {
    throw new FirebaseClientError(kind, { operation });
}

function normalizeError(error, operation) {
    return error instanceof FirebaseClientError ? error : normalizeFirebaseError(error, { operation });
}

function prefixFor(kind) {
    if (kind === 'portrait') return 'portraits';
    if (kind === 'indice') return 'indices';
    fail('image-kind');
}

function protectedPathKind(path) {
    if (typeof path !== 'string') return null;
    const parts = path.split('/');
    const kind = parts[0] === 'portraits' ? 'portrait' : parts[0] === 'indices' ? 'indice' : null;
    if (!kind || parts.length !== 3) return null;
    try { return path === imagePathFor(kind, parts[1], parts[2]) ? kind : null; }
    catch { return null; }
}

export function imagePathFor(kind, ownerId, fileName) {
    const prefix = prefixFor(kind);
    if (!OWNER_PATTERN.test(ownerId ?? '') || !FILE_PATTERN.test(fileName ?? '')
        || fileName === '.' || fileName === '..') fail('image-path');
    return `${prefix}/${ownerId}/${fileName}`;
}

export function validateImageFile(kind, file) {
    prefixFor(kind);
    if (!(file instanceof Blob) || !Object.hasOwn(EXTENSIONS, file.type)) fail('image-file');
    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_BYTES[kind]) fail('image-size');
    return { contentType: file.type, extension: EXTENSIONS[file.type], size: file.size };
}

function validLegacyImageUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || !/^(?:https?:\/\/|gs:\/\/)/u.test(value)) return false;
    try {
        const isGs = value.startsWith('gs://');
        const parsed = isGs ? null : new URL(value);
        if (parsed && (parsed.username || parsed.password)) return false;
        const rawPath = isGs ? value.slice(5).split(/[?#]/u)[0] : parsed.pathname;
        const path = decodeURIComponent(rawPath);
        const segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
        return segments.length >= (isGs ? 2 : 1) && !segments.some(segment => segment === '.' || segment === '..');
    } catch { return false; }
}

export function canonicalLegacyImageUrl(value) {
    if (!validLegacyImageUrl(value)) return null;
    try {
        if (value.startsWith('gs://')) return value.split(/[?#]/u)[0];
        const url = new URL(value);
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch { return null; }
}

export function describeImage(data = {}, ownerId = null, kind = null) {
    const modernIssue = Array.isArray(data.issues) && data.issues.some(item => item?.field === 'imagePath');
    const legacyIssue = Array.isArray(data.issues) && data.issues.some(item => item?.field === 'imageUrl');
    if (modernIssue) return { path: null, legacy: false, invalid: true, reason: 'protected-error' };
    if (typeof data.imagePath === 'string' && data.imagePath) {
        const value = data.imagePath;
        const rawParts = value.split('/');
        if (rawParts.length !== 3 || !['portraits', 'indices'].includes(rawParts[0])
            || !OWNER_PATTERN.test(rawParts[1]) || !FILE_PATTERN.test(rawParts[2])
            || rawParts[2] === '.' || rawParts[2] === '..') {
            return { path: null, legacy: false, invalid: true, reason: 'protected-error' };
        }
        if (ownerId && kind) {
            try {
                if (value !== imagePathFor(kind, ownerId, rawParts[2] ?? '')) return { path: null, legacy: false, invalid: true };
            } catch { return { path: null, legacy: false, invalid: true }; }
        }
        return { path: value, legacy: false, invalid: false };
    }
    if (legacyIssue) return { path: null, legacy: true, invalid: true, reason: 'legacy-invalid' };
    if (typeof data.imageUrl === 'string' && data.imageUrl) {
        const path = canonicalLegacyImageUrl(data.imageUrl);
        if (!path) return { path: null, legacy: true, invalid: true, reason: 'legacy-invalid' };
        return { path, legacy: true, invalid: false };
    }
    return { path: null, legacy: false, invalid: false };
}

function makeStorageScope({ storageSdk, storage, createObjectUrl = globalThis.URL?.createObjectURL, revokeObjectUrl = globalThis.URL?.revokeObjectURL } = {}) {
    if (!storageSdk || typeof storageSdk.ref !== 'function' || typeof storageSdk.getBlob !== 'function'
        || typeof createObjectUrl !== 'function' || typeof revokeObjectUrl !== 'function') fail('image-storage');
    const entries = new Map();

    function releaseEntry(path, entry, handle) {
        if (handle.released) return;
        handle.released = true;
        if (entry.closed) return;
        entry.refs = Math.max(0, entry.refs - 1);
        if (entry.refs !== 0 || !entry.settled) return;
        if (entry.url) revokeObjectUrl(entry.url);
        if (entries.get(path) === entry) entries.delete(path);
    }

    function loadObjectUrl(path) {
        if (typeof path !== 'string' || !path) fail('image-load-path');
        const parts = path.split('/');
        if (parts.length !== 3 || !['portraits', 'indices'].includes(parts[0])
            || !OWNER_PATTERN.test(parts[1]) || !FILE_PATTERN.test(parts[2])
            || parts[2] === '.' || parts[2] === '..') fail('image-load-path');
        let entry = entries.get(path);
        if (!entry) {
            entry = { refs: 0, settled: false, url: null };
            entry.promise = (async () => {
                const blob = await storageSdk.getBlob(storageSdk.ref(storage, path));
                const url = createObjectUrl(blob);
                entry.url = url;
                entry.settled = true;
                if (entry.closed || entry.refs === 0) {
                    revokeObjectUrl(url);
                    if (entries.get(path) === entry) entries.delete(path);
                }
                return url;
            })().catch(error => {
                entry.settled = true;
                if (entries.get(path) === entry) entries.delete(path);
                throw normalizeError(error, 'image-load');
            });
            entries.set(path, entry);
        }
        entry.refs += 1;
        const handle = { released: false };
        const release = () => releaseEntry(path, entry, handle);
        const result = entry.promise.then(url => ({ url, release })).catch(error => {
            release();
            throw error;
        });
        result.release = release;
        return result;
    }
    function revokeAll() {
        for (const entry of entries.values()) {
            if (entry.url) revokeObjectUrl(entry.url);
            entry.closed = true;
        }
        entries.clear();
    }
    return { loadObjectUrl, revokeAll, close: revokeAll };
}

function createRepository({ storageSdk, storage, uploader, journal = {}, cleanup = {}, role,
    createObjectUrl, revokeObjectUrl } = {}) {
    const scope = makeStorageScope({ storageSdk, storage, createObjectUrl, revokeObjectUrl });
    const isMj = role === 'mj';

    async function upload(kind, ownerId, file, options = {}) {
        if (!isMj) fail('image-upload', ERROR_KINDS.PERMISSION);
        if (!OWNER_PATTERN.test(ownerId ?? '')) fail('image-owner');
        const fileInfo = validateImageFile(kind, file);
        if (typeof uploader !== 'function' || typeof journal.remember !== 'function') fail('image-uploader');
        let uploadedPath = null;
        try {
            // The callable contract is deliberately narrow: do not forward UI
            // options such as commit callbacks or imageOptions. Validated identity
            // and content information are the only values it receives.
            const payload = { kind, ownerId, contentType: fileInfo.contentType };
            // The injected callable adapter has one stable signature. Do not
            // infer it from Function.length: defaults/rest parameters make that
            // value unreliable and could send an object where a Blob is required.
            const result = await uploader(file, payload);
            const path = result?.imagePath ?? result?.path;
            const parts = typeof path === 'string' ? path.split('/') : [];
            // Only a path already proven to belong to this owner may be used for
            // automatic compensation. A malformed/foreign response is reported
            // for operator recovery, never passed to a broad Storage delete.
            if (typeof path === 'string' && parts.length === 3
                && protectedPathKind(path) === kind && parts[1] === ownerId) uploadedPath = path;
            if (parts.length !== 3 || path !== imagePathFor(kind, ownerId, parts[2])
                || !parts[2].endsWith(`.${fileInfo.extension}`)) {
                const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'image-upload-response' });
                if (typeof path === 'string' && !uploadedPath) {
                    const responsePathReason = /^(?:https?:\/\/|gs:\/\/)/u.test(path)
                        ? 'external-reference'
                        : (parts.length === 3 && ['portraits', 'indices'].includes(parts[0]) ? 'owner-mismatch' : 'invalid-response');
                    error.state = { responsePathInvalid: true, compensationSkipped: true, responsePathReason };
                }
                throw error;
            }
            uploadedPath = path;
            if (!await journal.remember({ collection: kind === 'portrait' ? 'pnjs' : 'indices', ownerId, path })) fail('image-journal');
            return { imagePath: path, contentType: fileInfo.contentType };
        } catch (error) {
            if (uploadedPath) {
                try {
                    if (typeof cleanup.unreferenced !== 'function') fail('image-compensation');
                    await cleanup.unreferenced(uploadedPath, { collection: kind === 'portrait' ? 'pnjs' : 'indices', ownerId, skipJournal: true });
                } catch (compensationError) {
                    const normalized = normalizeError(compensationError, 'image-compensation');
                    normalized.state = { uploadedPath, journalPending: true, commitNotStarted: true };
                    throw normalized;
                }
            }
            throw normalizeError(error, 'image-upload');
        }
    }

    async function remove(path, options = {}) {
        if (!isMj) fail('image-remove', ERROR_KINDS.PERMISSION);
        if (typeof path !== 'string') fail('image-remove-path');
        if (/^(?:https?:\/\/|gs:\/\/)/u.test(path)) {
            const canonical = canonicalLegacyImageUrl(path);
            return { skipped: true, reason: 'reference-externe', path: canonical,
                legacyImageSkipped: true, legacyImageInvalid: !canonical };
        }
        const kind = protectedPathKind(path);
        const parts = path.split('/');
        if (!kind) fail('image-remove-path');
        const expectedKind = options.kind ?? (options.collection === 'pnjs' ? 'portrait' : options.collection === 'indices' ? 'indice' : null);
        if (expectedKind !== kind || options.ownerId !== parts[1]) fail('image-remove-owner');
        if (typeof cleanup.unreferenced !== 'function') fail('image-remove-service');
        try { return await cleanup.unreferenced(path, { collection: kind === 'portrait' ? 'pnjs' : 'indices', ownerId: parts[1] }); }
        catch (error) { throw normalizeError(error, 'image-remove'); }
    }

    async function replace(oldPath, newOwner, file, options = {}) {
        const kind = typeof newOwner === 'object' ? newOwner.kind : options.kind;
        const ownerId = typeof newOwner === 'object' ? newOwner.ownerId : newOwner;
        if (typeof options.commit !== 'function') fail('image-replace-commit');
        const oldKind = protectedPathKind(oldPath);
        const oldParts = typeof oldPath === 'string' ? oldPath.split('/') : [];
        // A protected-looking path belonging to another owner is treated as a
        // legacy/mismatch reference: it is surfaced, never journaled or deleted.
        const oldProtected = Boolean(oldKind && oldKind === kind && oldParts[1] === ownerId);
        const oldExternal = typeof oldPath === 'string' && /^(?:https?:\/\/|gs:\/\/)/u.test(oldPath);
        const skippedOldPath = oldExternal ? canonicalLegacyImageUrl(oldPath) : null;
        const ownerMismatch = Boolean(oldKind && !oldProtected);
        const skippedOldPathInvalid = ownerMismatch || (oldExternal && !skippedOldPath);
        const skippedOldPathReason = ownerMismatch ? 'owner-mismatch' : (oldExternal && !skippedOldPath ? 'legacy-invalid' : null);
        const safeOldPath = oldProtected ? oldPath : skippedOldPath;
        if (oldProtected && typeof journal.remember !== 'function') fail('image-replace-journal');
        if (oldProtected && !await journal.remember({ collection: oldPath.startsWith('portraits/') ? 'pnjs' : 'indices', ownerId: oldPath.split('/')[1], path: oldPath })) fail('image-replace-journal');
        let uploaded;
        try {
            uploaded = await upload(kind, ownerId, file, options);
        } catch (error) {
            // The old entry was journaled before upload so a crash is safe; when
            // upload fails the old image remains the committed source of truth.
            if (oldProtected && typeof journal.forget === 'function') journal.forget(oldPath);
            throw error;
        }
        const newPath = uploaded.imagePath;
        try {
            await options.commit(newPath);
        } catch (error) {
            let compensationPending = false;
            try {
                if (typeof cleanup.unreferenced !== 'function') fail('image-replace-compensation');
                await cleanup.unreferenced(newPath, { collection: kind === 'portrait' ? 'pnjs' : 'indices', ownerId, skipJournal: true });
                if (newPath !== oldPath && typeof journal.forget === 'function') journal.forget(newPath);
            } catch { compensationPending = true; /* Le journal/reprise garde le nouveau fichier. */ }
            // Keep the old entry until source-of-truth reconciliation. The old
            // image is still the committed reference when commit was rejected.
            const normalized = normalizeError(error, 'image-replace-commit');
            normalized.state = { commitUnknown: true, cleanupPending: compensationPending, newPath, oldPath: safeOldPath,
                skippedOldPath, skippedOldPathInvalid, skippedOldPathReason };
            throw normalized;
        }
        if (oldPath && oldPath !== newPath) {
            try {
                if (!oldProtected) {
                    if (typeof journal.forget === 'function') journal.forget(newPath);
                    return { imagePath: newPath, commitDone: true, cleanupPending: false, skippedOldPath,
                        skippedOldPathInvalid, skippedOldPathReason };
                }
                if (typeof cleanup.unreferenced !== 'function') fail('image-replace-cleanup-service');
                await cleanup.unreferenced(oldPath, { collection: kind === 'portrait' ? 'pnjs' : 'indices', ownerId });
                if (typeof journal.forget === 'function') journal.forget(oldPath);
            } catch (error) {
                const normalized = normalizeError(error, 'image-replace-cleanup');
                normalized.state = { commitDone: true, cleanupPending: true, newPath, oldPath: safeOldPath,
                    skippedOldPath, skippedOldPathInvalid, skippedOldPathReason };
                throw normalized;
            }
        }
        // Keep the new upload journaled until the old protected image has either
        // been cleaned up or the replacement has no old protected image. This
        // makes a crash after commit resumable from either journal entry.
        if (typeof journal.forget === 'function') journal.forget(newPath);
        return { imagePath: newPath, commitDone: true, cleanupPending: false, skippedOldPath,
            skippedOldPathInvalid, skippedOldPathReason };
    }

    async function recover() {
        if (typeof cleanup.recover !== 'function') fail('image-recovery-service');
        try { return await cleanup.recover(); }
        catch (error) { throw normalizeError(error, 'image-recovery'); }
    }

    async function cleanupImage(path, options = {}) {
        if (!isMj) fail('image-cleanup', ERROR_KINDS.PERMISSION);
        const kind = protectedPathKind(path);
        const parts = typeof path === 'string' ? path.split('/') : [];
        const expectedKind = options.kind ?? (options.collection === 'pnjs' ? 'portrait' : options.collection === 'indices' ? 'indice' : null);
        if (!kind || expectedKind !== kind || options.ownerId !== parts[1]) fail('image-cleanup-path');
        if (typeof cleanup.unreferenced !== 'function') fail('image-cleanup-service');
        try {
            return await cleanup.unreferenced(path, { collection: kind === 'portrait' ? 'pnjs' : 'indices', ownerId: parts[1], skipJournal: options.skipJournal === true });
        }
        catch (error) { throw normalizeError(error, 'image-cleanup'); }
    }

    function ackUpload(path) {
        if (typeof journal.forget !== 'function') return false;
        return journal.forget(path);
    }

    const repository = Object.freeze({ loadObjectUrl: scope.loadObjectUrl, revokeAll: scope.revokeAll, close: scope.close });
    if (!isMj) return repository;
    return Object.freeze({ ...repository, uploadPortrait: (id, file, options) => upload('portrait', id, file, options),
        uploadClueImage: (id, file, options) => upload('indice', id, file, options), replace, remove, recover, cleanupImage, ackUpload });
}

export function createPublicImagesRepository(options = {}) { return createRepository({ ...options, role: 'public' }); }
export function createMjImagesRepository(options = {}) { return createRepository({ ...options, role: 'mj' }); }
export const createPublicImageRepository = createPublicImagesRepository;
export const createMjImageRepository = createMjImagesRepository;

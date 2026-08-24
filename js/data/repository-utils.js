import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { normalizeTimestamp } from './firebase-normalizers.js';

export function requireRepository(sdk, client, operation) {
    if (!sdk || !client?.db) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    return client.db;
}

export function collectionRef(sdk, db, name) {
    if (typeof sdk.collection !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'collection' });
    return sdk.collection(db, name);
}

export function documentRef(sdk, db, collection, id) {
    if (typeof sdk.doc !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'document' });
    return sdk.doc(db, collection, id);
}

export function queryRef(sdk, collection, constraints = []) {
    if (!constraints.length) return collection;
    if (typeof sdk.query !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'query' });
    return sdk.query(collection, ...constraints);
}

export function whereConstraint(sdk, field, operator, value) {
    if (typeof sdk.where !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'query-filter' });
    return sdk.where(field, operator, value);
}

export function documentIdConstraint(sdk) {
    if (typeof sdk.documentId !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'document-id-filter' });
    return sdk.documentId();
}

export function snapshotData(snapshot) {
    const data = typeof snapshot?.data === 'function' ? snapshot.data() : snapshot?.data;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

export function snapshotId(snapshot) {
    return typeof snapshot?.id === 'string' ? snapshot.id : '';
}

export function snapshotMetadata(snapshot) {
    return Object.freeze({
        fromCache: snapshot?.metadata?.fromCache === true,
        hasPendingWrites: snapshot?.metadata?.hasPendingWrites === true,
    });
}

export function normalizeRepositoryError(error, operation) {
    return normalizeFirebaseError(error, { operation });
}

export function serverTimestamp(sdk) {
    if (typeof sdk.serverTimestamp !== 'function') {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'server-timestamp' });
    }
    return sdk.serverTimestamp();
}

export function timestampEqual(left, right) {
    const a = normalizeTimestamp(left);
    const b = normalizeTimestamp(right);
    return Boolean(a && b && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds);
}

export function valueKey(value) {
    try {
        return JSON.stringify(value, (_, item) => {
            if (item && typeof item === 'object' && !Array.isArray(item)) {
                return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
            }
            return item;
        });
    } catch {
        return '';
    }
}

export function sortedBy(items, comparator) {
    return [...items].sort(comparator);
}

export function compareUnicode(left, right) {
    const fold = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    const a = fold(left);
    const b = fold(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

export function compareOrder(left, right) {
    const a = typeof left === 'number' && Number.isFinite(left) ? left : null;
    const b = typeof right === 'number' && Number.isFinite(right) ? right : null;
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    return a === null || b === null ? 0 : a - b;
}

export function subscribeSnapshot(sdk, target, onNext, onError, listen = null) {
    const subscribe = typeof listen === 'function' ? listen : sdk?.onSnapshot;
    if (typeof subscribe !== 'function') {
        const error = new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'subscribe' });
        if (typeof onError === 'function') onError(error);
        return () => {};
    }
    let active = true;
    let unsubscribe = () => {};
    const safeNext = value => {
        if (active && typeof onNext === 'function') onNext(value);
    };
    const safeError = error => {
        if (active && typeof onError === 'function') onError(normalizeRepositoryError(error, 'subscribe'));
    };
    try {
        unsubscribe = subscribe(target, safeNext, safeError);
    } catch (error) {
        safeError(error);
    }
    let closed = false;
    return () => {
        if (closed) return;
        closed = true;
        active = false;
        try { if (typeof unsubscribe === 'function') unsubscribe(); } catch { /* Le désabonnement reste idempotent côté dépôt. */ }
    };
}

export async function getDocument(sdk, ref) {
    if (typeof sdk.getDoc !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'get-document' });
    return sdk.getDoc(ref);
}

export async function getDocuments(sdk, target) {
    if (typeof sdk.getDocs !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'get-documents' });
    return sdk.getDocs(target);
}

export function ensureMutationApi(sdk, operation) {
    if (typeof sdk.runTransaction !== 'function' && typeof sdk.writeBatch !== 'function') {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    }
}

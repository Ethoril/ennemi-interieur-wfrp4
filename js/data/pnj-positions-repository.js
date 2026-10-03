import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { collectionRef, documentRef, requireRepository, serverTimestamp, snapshotData, snapshotId, snapshotMetadata, subscribeSnapshot, whereConstraint } from './repository-utils.js';

const MAX_ID_LENGTH = 150;
const MAX_COORDINATE = 1_000_000;
// Deux accès aux PNJs par position dans les règles : cinq IDs respectent la
// limite des dix accès par requête, vérifiée sur l'émulateur.
const IDS_PER_QUERY = 5;

function validId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH && /^[A-Za-z0-9_-]+$/u.test(id);
}

function validPoint(point) {
    return point !== null && typeof point === 'object' && !Array.isArray(point)
        && Number.isFinite(point.x) && Math.abs(point.x) <= MAX_COORDINATE
        && Number.isFinite(point.y) && Math.abs(point.y) <= MAX_COORDINATE;
}

function normalizePosition(snapshot) {
    const id = snapshotId(snapshot);
    const data = snapshotData(snapshot);
    if (!validId(id) || !validPoint(data)) return null;
    return { id, x: data.x, y: data.y, updatedAt: data.updatedAt ?? null };
}

function chunks(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}

export function createPnjPositionsRepository({ sdk, client, role = 'public' } = {}) {
    const db = requireRepository(sdk, client, 'pnj-positions-repository');
    const isMj = role === 'mj';
    const activeSubscriptions = new Set();

    async function save(id, point) {
        if (!validId(id) || !validPoint(point)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-pnj-position' });
        try {
            const ref = documentRef(sdk, db, 'pnj_positions', id);
            if (typeof sdk.writeBatch !== 'function') {
                throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-pnj-position' });
            }
            const batch = sdk.writeBatch(db);
            batch.set(ref, { x: point.x, y: point.y, updatedAt: serverTimestamp(sdk) });
            await batch.commit();
        } catch (error) {
            throw error instanceof FirebaseClientError ? error : normalizeFirebaseError(error, { operation: 'save-pnj-position' });
        }
    }

    function subscribeForIds(ids, onNext, onError) {
        const uniqueIds = [...new Set(Array.from(ids ?? []).filter(validId))];
        if (!uniqueIds.length) {
            onNext?.([]);
            return () => {};
        }
        const snapshots = new Map();
        const unsubscribers = [];
        const batchCount = Math.ceil(uniqueIds.length / IDS_PER_QUERY);
        let active = true;
        let lastSignature = null;
        const emit = () => {
            if (!active || snapshots.size < batchCount) return;
            const positions = [];
            for (const snapshot of snapshots.values()) {
                for (const doc of snapshot.docs ?? []) {
                    const position = normalizePosition(doc);
                    if (position) positions.push(position);
                }
            }
            positions.sort((a, b) => a.id.localeCompare(b.id));
            const metadata = {
                fromCache: [...snapshots.values()].some(snapshot => snapshot.metadata?.fromCache === true),
                hasPendingWrites: [...snapshots.values()].some(snapshot => snapshot.metadata?.hasPendingWrites === true),
            };
            const signature = JSON.stringify([positions, metadata]);
            if (signature === lastSignature) return;
            lastSignature = signature;
            onNext?.(positions, metadata);
        };
        try {
            for (const [index, idChunk] of chunks(uniqueIds, IDS_PER_QUERY).entries()) {
                if (typeof sdk.documentId !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'subscribe-pnj-positions' });
                const target = sdk.query(collectionRef(sdk, db, 'pnj_positions'),
                    whereConstraint(sdk, sdk.documentId(), 'in', idChunk));
                const unsubscribe = subscribeSnapshot(sdk, target, snapshot => {
                    snapshots.set(index, snapshot);
                    emit();
                }, error => { if (active) onError?.(error); }, client?.listen);
                unsubscribers.push(unsubscribe);
            }
        } catch (error) {
            active = false;
            unsubscribers.forEach(unsubscribe => unsubscribe());
            onError?.(error instanceof FirebaseClientError ? error : normalizeFirebaseError(error, { operation: 'subscribe-pnj-positions' }));
        }
        const close = () => {
            if (active) {
                active = false;
                unsubscribers.forEach(unsubscribe => unsubscribe());
            }
            activeSubscriptions.delete(close);
        };
        activeSubscriptions.add(close);
        return close;
    }

    function subscribeAll(onNext, onError) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'subscribe-all-pnj-positions' });
        const unsubscribe = subscribeSnapshot(sdk, collectionRef(sdk, db, 'pnj_positions'), snapshot => {
            const positions = (snapshot.docs ?? []).map(normalizePosition).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
            onNext?.(positions, snapshotMetadata(snapshot));
        }, onError, client?.listen);
        activeSubscriptions.add(unsubscribe);
        return () => { unsubscribe(); activeSubscriptions.delete(unsubscribe); };
    }

    function close() {
        for (const unsubscribe of activeSubscriptions) unsubscribe();
        activeSubscriptions.clear();
    }

    return Object.freeze({ save, subscribeForIds, subscribeAll, close });
}

export { normalizePosition as normalizePnjGraphPosition };

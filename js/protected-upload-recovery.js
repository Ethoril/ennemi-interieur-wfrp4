import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { pendingProtectedUploads } from './protected-upload-journal.js';
import { cleanupUnreferencedImage } from './image-lifecycle.js';

const SETTLE_DELAY_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;
let recoveryRunning = false;
let retryTimer = null;

async function durableImageLocks(db) {
    const entries = [];
    for (const ownerCollection of ['pnjs', 'indices']) {
        const snapshot = await getDocs(collection(db, 'integrity_locks', 'images', ownerCollection));
        snapshot.docs.forEach(lock => {
            const data = lock.data() || {};
            entries.push({
                collection: ownerCollection,
                ownerId: lock.id,
                path: data.path,
                createdAt: Number(data.createdAt?.toMillis?.() ?? 0),
                durable: true,
            });
        });
    }
    return entries;
}

export async function recoverPendingProtectedUploads(db, storage) {
    if (recoveryRunning) return { status: 'busy', retryNeeded: true, processed: 0 };
    recoveryRunning = true;
    let nextDelay = null;
    let retryNeeded = false;
    let processed = 0;
    try {
        const durable = await durableImageLocks(db);
        const byKey = new Map(durable.map(item => [`${item.collection}/${item.ownerId}/${item.path}`, item]));
        for (const item of pendingProtectedUploads()) {
            const key = `${item.collection}/${item.ownerId}/${item.path}`;
            if (!byKey.has(key)) byKey.set(key, item);
        }
        const now = Date.now();
        for (const item of byKey.values()) {
            const remaining = item.durable ? 0 : SETTLE_DELAY_MS - (now - item.createdAt);
            if (remaining > 0) {
                retryNeeded = true;
                nextDelay = nextDelay === null ? remaining : Math.min(nextDelay, remaining);
                continue;
            }
            try {
                await cleanupUnreferencedImage({
                    db, storage, reference: item.path,
                    ownerCollection: item.collection, ownerId: item.ownerId, skipJournal: item.durable === true,
                });
                processed += 1;
            } catch (error) {
                retryNeeded = true;
                console.warn('Nettoyage d’image protégé à reprendre.', {
                    collection: item.collection, ownerId: item.ownerId,
                    path: item.path, code: error?.code ?? null, message: error?.message,
                });
            }
        }
    } catch (error) {
        retryNeeded = true;
        console.warn('Récupération des images protégées différée.', { code: error?.code ?? null, message: error?.message });
    } finally {
        recoveryRunning = false;
        if (retryNeeded) nextDelay = nextDelay === null ? RETRY_DELAY_MS : Math.min(nextDelay, RETRY_DELAY_MS);
        if (nextDelay !== null && !retryTimer) {
            retryTimer = globalThis.setTimeout(() => {
                retryTimer = null;
                void recoverPendingProtectedUploads(db, storage);
            }, Math.max(0, nextDelay));
        }
        return { status: retryNeeded ? 'retry-pending' : 'completed', retryNeeded, processed };
    }
}

export { durableImageLocks };

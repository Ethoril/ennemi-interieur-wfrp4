import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { deleteObject, ref } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { forgetProtectedUpload, pendingProtectedUploads } from './protected-upload-journal.js';

const SETTLE_DELAY_MS = 5 * 60 * 1000;
let recoveryRunning = false;
let retryTimer = null;

export async function recoverPendingProtectedUploads(db, storage) {
    if (recoveryRunning) return;
    recoveryRunning = true;
    let nextDelay = null;
    try {
        const now = Date.now();
        for (const item of pendingProtectedUploads()) {
            const remaining = SETTLE_DELAY_MS - (now - item.createdAt);
            if (remaining > 0) {
                nextDelay = nextDelay === null ? remaining : Math.min(nextDelay, remaining);
                continue;
            }
            try {
                const owner = await getDoc(doc(db, item.collection, item.ownerId));
                if (owner.exists() && owner.data()?.imagePath === item.path) {
                    forgetProtectedUpload(item.path);
                    continue;
                }
                await deleteObject(ref(storage, item.path));
                forgetProtectedUpload(item.path);
            } catch (error) {
                if (error?.code === 'storage/object-not-found') forgetProtectedUpload(item.path);
                else console.warn('Nettoyage d’image protégée à reprendre.', { path: item.path, code: error?.code ?? null });
            }
        }
    } finally {
        recoveryRunning = false;
        if (nextDelay !== null && !retryTimer) {
            retryTimer = globalThis.setTimeout(() => {
                retryTimer = null;
                void recoverPendingProtectedUploads(db, storage);
            }, Math.max(0, nextDelay));
        }
    }
}

import { collection, doc, getDocs, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { forgetProtectedUpload, rememberProtectedUpload } from './protected-upload-journal.js';
import { safeStorageReference } from './storage-reference.js';

const COLLECTIONS = new Set(['pnjs', 'indices']);
const OWNER_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const prefixFor = collectionName => collectionName === 'pnjs' ? 'portraits' : 'indices';

export function imageCleanupLockPath(ownerCollection, ownerId) {
    return `integrity_locks/images/${ownerCollection}/${ownerId}`;
}

function collectDocuments(pnjs, indices) {
    return [...pnjs.docs.map(snapshot => ({ collection: 'pnjs', id: snapshot.id, ...snapshot.data() })),
        ...indices.docs.map(snapshot => ({ collection: 'indices', id: snapshot.id, ...snapshot.data() }))];
}

function referencesPath(documents, storage, path, excludedOwner = null) {
    return documents.some(item => (item.collection !== excludedOwner?.collection || item.id !== excludedOwner?.id)
        && [item.imagePath, item.imageUrl]
        .some(value => safeStorageReference(storage, value)?.fullPath === path));
}

function ownerPath(storage, reference, ownerCollection, ownerId) {
    const storageRef = safeStorageReference(storage, reference);
    if (!storageRef) return null;
    const prefix = `${prefixFor(ownerCollection)}/${ownerId}/`;
    if (!storageRef.fullPath.startsWith(prefix)) {
        throw new Error(`Image non liée au propriétaire ${ownerCollection}/${ownerId} : ${storageRef.fullPath}`);
    }
    return storageRef;
}

async function releaseImageLock(db, lockRef, path) {
    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(lockRef);
        if (snapshot.exists() && snapshot.data()?.path === path) transaction.delete(lockRef);
    });
}

// Le verrou serveur par propriétaire ferme la course entre l’inventaire et une
// réintroduction de imagePath/imageUrl. Le journal local reste un filet de reprise.
export async function cleanupUnreferencedImage({
    db, storage, reference, ownerCollection, ownerId, skipJournal = false,
}) {
    if (!COLLECTIONS.has(ownerCollection) || !OWNER_PATTERN.test(ownerId ?? '')) {
        throw new Error('Propriétaire d’image invalide.');
    }
    const storageRef = ownerPath(storage, reference, ownerCollection, ownerId);
    if (!storageRef) return { skipped: true, reason: 'reference-externe' };
    const path = storageRef.fullPath;
    if (path.split('/').length === 2) {
        throw new Error(`Image legacy plate à traiter par l’inventaire administratif : ${path}`);
    }
    if (!skipJournal && !rememberProtectedUpload({ collection: ownerCollection, ownerId, path })) {
        throw new Error(`Nettoyage annulé : impossible de journaliser ${path}.`);
    }

    const lockRef = doc(db, 'integrity_locks', 'images', ownerCollection, ownerId);
    const ownerRef = doc(db, ownerCollection, ownerId);
    const [initialPnjs, initialIndices] = await Promise.all([
        getDocs(collection(db, 'pnjs')), getDocs(collection(db, 'indices')),
    ]);
    const initiallyReferenced = referencesPath(
        collectDocuments(initialPnjs, initialIndices), storage, path,
        { collection: ownerCollection, id: ownerId },
    );
    const decision = await runTransaction(db, async transaction => {
        const lockSnapshot = await transaction.get(lockRef);
        const ownerSnapshot = await transaction.get(ownerRef);
        const ownerData = ownerSnapshot.exists() ? ownerSnapshot.data() : {};
        const ownerReferences = [ownerData.imagePath, ownerData.imageUrl]
            .some(value => safeStorageReference(storage, value)?.fullPath === path);
        if (initiallyReferenced || ownerReferences) {
            if (lockSnapshot.exists() && lockSnapshot.data()?.path === path) transaction.delete(lockRef);
            return { skipped: true, reason: 'reference-conservee', path };
        }
        if (lockSnapshot.exists()) {
            if (lockSnapshot.data()?.path !== path
                || lockSnapshot.data()?.ownerCollection !== ownerCollection
                || lockSnapshot.data()?.ownerId !== ownerId) {
                throw new Error(`Nettoyage déjà verrouillé pour ${ownerCollection}/${ownerId}.`);
            }
        } else {
            transaction.set(lockRef, {
                ownerCollection, ownerId, path,
                createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
            });
        }
        return { locked: true, path };
    });
    if (decision?.skipped) {
        forgetProtectedUpload(path);
        return decision;
    }

    const [pnjsAgain, indicesAgain] = await Promise.all([
        getDocs(collection(db, 'pnjs')), getDocs(collection(db, 'indices')),
    ]);
    if (referencesPath(collectDocuments(pnjsAgain, indicesAgain), storage, path)) {
        await releaseImageLock(db, lockRef, path);
        forgetProtectedUpload(path);
        return { skipped: true, reason: 'reference-apparue', path };
    }

    let missing = false;
    try {
        await deleteObject(storageRef);
    } catch (error) {
        if (error?.code === 'storage/object-not-found') missing = true;
        else throw new Error(`Image à nettoyer : ${path} (${error?.code || error?.message || 'erreur Storage'}).`);
    }
    await releaseImageLock(db, lockRef, path);
    forgetProtectedUpload(path);
    return missing ? { deleted: false, missing: true, path } : { deleted: true, path };
}

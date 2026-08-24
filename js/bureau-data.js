/*
 * Composition du client bureau.
 *
 * Les pages historiques restent responsables du rendu et de leurs modales ; ce
 * module est le seul endroit où elles obtiennent les dépôts et leurs services.
 * Cela évite qu'une reconnexion laisse un dépôt ou une URL Storage du rôle
 * précédent attaché à la page.
 */
import { app, auth, db, storage, functions } from './firebase-init.js';
import { createBureauClient } from './data/firebase-clients.js';
import { createMjPnjRepository, createPublicPnjRepository } from './data/pnjs-repository.js';
import { createMjRelationsRepository, createPublicRelationsRepository } from './data/relations-repository.js';
import { createMjIndicesRepository, createPublicIndicesRepository } from './data/indices-repository.js';
import { createMjImagesRepository, createPublicImagesRepository } from './data/images-repository.js';
import { collection, doc, query, where, getDoc, getDocs, updateDoc, deleteDoc, writeBatch,
    deleteField, serverTimestamp, arrayRemove, runTransaction, onSnapshot } from
    'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, getBlob } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { uploadProtectedImage } from './protected-upload.js';
import { rememberProtectedUpload, forgetProtectedUpload } from './protected-upload-journal.js';
import { cleanupUnreferencedImage } from './image-lifecycle.js';
import { recoverPendingProtectedUploads } from './protected-upload-recovery.js';

const firestoreSdk = Object.freeze({
    collection, doc, query, where, getDoc, getDocs, updateDoc, deleteDoc, writeBatch,
    deleteField, serverTimestamp, arrayRemove, runTransaction, onSnapshot,
});
const storageSdk = Object.freeze({ ref, getBlob });

function createImageService() {
    const journal = {
        remember: rememberProtectedUpload,
        forget: forgetProtectedUpload,
    };
    const cleanup = {
        unreferenced: async (path, options = {}) => cleanupUnreferencedImage({
            db, storage, reference: path, ownerCollection: options.collection,
            ownerId: options.ownerId, skipJournal: options.skipJournal === true,
        }),
        recover: () => recoverPendingProtectedUploads(db, storage),
    };
    const uploader = (file, payload) => uploadProtectedImage(file, payload);
    const images = {
        ...createMjImagesRepository({
            storageSdk, storage, uploader, journal, cleanup,
        }),
    };
    return Object.freeze({
        ...images,
        cleanupPnjImages: async ({ pnjId, imagePaths = [] } = {}) => {
            for (const path of imagePaths) await images.cleanupImage(path, {
                collection: 'pnjs', ownerId: pnjId, skipJournal: true,
            });
            return { status: 'completed' };
        },
    });
}

export function createBureauData({ isAdmin = false } = {}) {
    const client = createBureauClient({ sdk: firestoreSdk, app, auth, db, storage, functions });
    const imageService = isAdmin ? createImageService() : createPublicImagesRepository({ storageSdk, storage });
    const pnjs = isAdmin
        ? createMjPnjRepository({ sdk: firestoreSdk, client, imageService })
        : createPublicPnjRepository({ sdk: firestoreSdk, client });
    const relations = isAdmin
        ? createMjRelationsRepository({ sdk: firestoreSdk, client })
        : createPublicRelationsRepository({ sdk: firestoreSdk, client });
    const indices = isAdmin
        ? createMjIndicesRepository({ sdk: firestoreSdk, client, imageService })
        : createPublicIndicesRepository({ sdk: firestoreSdk, client });

    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        imageService.close?.();
        await client.close();
    };
    // Les primitives Firebase restent privées à cette composition : les pages
    // ne reçoivent que des dépôts et le cycle de vie.
    return Object.freeze({ pnjs, relations, indices, images: imageService, close });
}

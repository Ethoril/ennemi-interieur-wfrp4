import { createMjMobileClient } from '../data/firebase-clients.js';
import { createMjIndicesRepository } from '../data/indices-repository.js';
import { createMjImagesRepository } from '../data/images-repository.js';
import { createMjPnjRepository } from '../data/pnjs-repository.js';
import { createMjRelationsRepository } from '../data/relations-repository.js';
import { createMjSession } from './session.js';
import { createProtectedImageUploader } from '../protected-upload.js';
import { rememberProtectedUpload, forgetProtectedUpload } from '../protected-upload-journal.js';

const DEFAULT_BUILDERS = Object.freeze({
    client: createMjMobileClient,
    pnjs: createMjPnjRepository,
    relations: createMjRelationsRepository,
    indices: createMjIndicesRepository,
    images: createMjImagesRepository,
});

/**
 * Composition privée : elle reçoit un SDK Auth/Firestore explicite et ne peut
 * donc pas réutiliser accidentellement le client public ou son cache disque.
 */
export function createMjSessionComposition({
    sdk,
    storageSdk = sdk,
    config,
    options = {},
    builders = DEFAULT_BUILDERS,
} = {}) {
    if (!sdk || !config || !sdk.auth || typeof builders.client !== 'function') {
        throw new TypeError('sdk, sdk.auth, config et fabrique MJ requis');
    }
    const privateFactory = async ({ user, signal } = {}) => {
        if (signal?.aborted) throw Object.assign(new Error('session cancelled'), { code: 'auth/cancelled' });
        const client = await builders.client({ sdk, config, deleteApplicationOnClose: false, signOutOnClose: false });
        if (signal?.aborted) {
            await client?.close?.();
            throw Object.assign(new Error('session cancelled'), { code: 'auth/cancelled' });
        }
        try {
            const imageServiceOptions = options.imageServiceFactory?.({ client, user }) ?? {
                uploader: client.functions ? createProtectedImageUploader({ functions: client.functions, httpsCallable: sdk.httpsCallable }) : null,
                journal: { remember: rememberProtectedUpload, forget: forgetProtectedUpload },
                cleanup: {
                    unreferenced: async (path, cleanupOptions = {}) => {
                        const { cleanupUnreferencedImage } = await import('../image-lifecycle.js');
                        return cleanupUnreferencedImage({
                            db: client.db, storage: client.storage, reference: path,
                            ownerCollection: cleanupOptions.collection, ownerId: cleanupOptions.ownerId,
                            skipJournal: cleanupOptions.skipJournal === true,
                        });
                    },
                    recover: async () => {
                        const { recoverPendingProtectedUploads } = await import('../protected-upload-recovery.js');
                        return recoverPendingProtectedUploads(client.db, client.storage);
                    },
                },
            };
            const repositories = {};
            if (typeof builders.images === 'function') {
                const baseImages = builders.images({ storageSdk, storage: client.storage, client, user, ...imageServiceOptions });
                repositories.images = baseImages && typeof baseImages.cleanupPnjImages !== 'function'
                    && typeof baseImages.cleanupImage === 'function' ? Object.freeze({ ...baseImages,
                    cleanupPnjImages: async ({ pnjId, imagePaths = [] } = {}) => {
                        for (const path of imagePaths) await repositories.images.cleanupImage(path, {
                            collection: 'pnjs', ownerId: pnjId, skipJournal: true,
                        });
                        return { status: 'completed' };
                    },
                }) : baseImages;
            }
            repositories.pnjs = builders.pnjs({ sdk, client, user, imageService: repositories.images });
            repositories.relations = builders.relations({ sdk, client, user });
            repositories.indices = builders.indices({ sdk, client, user, imageService: repositories.images });
            return Object.freeze({ client, repositories, images: repositories.images });
        } catch (error) {
            await client?.close?.();
            throw error;
        }
    };
    return createMjSession({
        ...options,
        auth: sdk.auth,
        authSdk: sdk,
        privateFactory,
    });
}

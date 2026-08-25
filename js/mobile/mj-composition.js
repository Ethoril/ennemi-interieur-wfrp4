import { createMjMobileClient } from '../data/firebase-clients.js';
import { createMjIndicesRepository } from '../data/indices-repository.js';
import { createMjImagesRepository } from '../data/images-repository.js';
import { createMjPnjRepository } from '../data/pnjs-repository.js';
import { createMjRelationsRepository } from '../data/relations-repository.js';
import { createMjSession } from './session.js';

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
            const repositories = {
                pnjs: builders.pnjs({ sdk, client, user }),
                relations: builders.relations({ sdk, client, user }),
                indices: builders.indices({ sdk, client, user }),
            };
            if (typeof builders.images === 'function') {
                repositories.images = builders.images({ storageSdk, storage: client.storage, client, user });
            }
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

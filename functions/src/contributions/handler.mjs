import { HttpsError } from 'firebase-functions/v2/https';
import {
    ContributionError,
    getCampaignCapabilities,
    getContentEditContext,
    getContentHistory,
    getContentPnjChoices,
    listContentTrash,
    listPendingPurgeCleanups,
    mutatePublicContent,
    mutateMjContent,
    purgePublicContent,
    restorePublicContent,
    setTrashVisibility,
    trashPublicContent,
    uploadContributionImage,
} from './service.mjs';

const EXPOSED_CODES = new Set([
    'unauthenticated', 'permission-denied', 'invalid-argument', 'not-found', 'already-exists',
    'failed-precondition', 'aborted', 'resource-exhausted',
]);

export function toContributionHttpsError(error) {
    if (error instanceof HttpsError) return error;
    if (error instanceof ContributionError && EXPOSED_CODES.has(error.code)) {
        return new HttpsError(error.code, error.message, error.details);
    }
    const code = error?.code;
    if (EXPOSED_CODES.has(code)) return new HttpsError(code, error.message || 'opération impossible', error.details);
    return new HttpsError('internal', 'opération de contribution impossible');
}

function wrap(action, dependencies) {
    return async request => {
        try {
            const resolved = typeof dependencies === 'function' ? dependencies() : dependencies;
            return await action(request, resolved);
        } catch (error) {
            throw toContributionHttpsError(error);
        }
    };
}

/** Create callable handlers; index.js remains the sole place that sets App Check options. */
export function createContributionHandlers(dependencies) {
    return {
        getCampaignCapabilities: wrap(getCampaignCapabilities, dependencies),
        getContentEditContext: wrap(getContentEditContext, dependencies),
        getContentHistory: wrap(getContentHistory, dependencies),
        getContentPnjChoices: wrap(getContentPnjChoices, dependencies),
        mutatePublicContent: wrap((request, deps) => mutatePublicContent(request?.data, request, deps), dependencies),
        mutateMjContent: wrap((request, deps) => mutateMjContent(request?.data, request, deps), dependencies),
        listContentTrash: wrap(listContentTrash, dependencies),
        listPendingPurgeCleanups: wrap(listPendingPurgeCleanups, dependencies),
        trashPublicContent: wrap((request, deps) => trashPublicContent(request?.data, request, deps), dependencies),
        restorePublicContent: wrap((request, deps) => restorePublicContent(request?.data, request, deps), dependencies),
        purgePublicContent: wrap((request, deps) => purgePublicContent(request?.data, request, deps), dependencies),
        setTrashVisibility: wrap((request, deps) => setTrashVisibility(request?.data, request, deps), dependencies),
        uploadContributionImage: wrap(uploadContributionImage, dependencies),
    };
}

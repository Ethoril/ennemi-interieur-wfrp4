import { guardPnjVisibility } from '../enquetes/service.mjs';
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

function legacyEnqueteWrite(action){
    return async (request,deps)=>{
        if(request?.data?.kind==='indice'){
            const access=await deps.db.doc('campagne/acces').get();
            if(access.exists&&access.data().enqEnabled===true)throw new HttpsError('failed-precondition','Utiliser le nouvel espace Documents et enquêtes.');
        }
        return action(request,deps);
    };
}

/** Create callable handlers; index.js remains the sole place that sets App Check options. */
export function createContributionHandlers(dependencies) {
    return {
        getCampaignCapabilities: wrap(getCampaignCapabilities, dependencies),
        getContentEditContext: wrap(getContentEditContext, dependencies),
        getContentHistory: wrap(getContentHistory, dependencies),
        getContentPnjChoices: wrap(getContentPnjChoices, dependencies),
        mutatePublicContent: wrap(legacyEnqueteWrite((request, deps) => mutatePublicContent(request?.data, request, deps)), dependencies),
        mutateMjContent: wrap(legacyEnqueteWrite((request, deps) => guardPnjVisibility(request?.data, request, deps, mutateMjContent)), dependencies),
        listContentTrash: wrap(listContentTrash, dependencies),
        listPendingPurgeCleanups: wrap(listPendingPurgeCleanups, dependencies),
        trashPublicContent: wrap(legacyEnqueteWrite((request, deps) => guardPnjVisibility(request?.data, request, deps, trashPublicContent, 'trash')), dependencies),
        restorePublicContent: wrap(legacyEnqueteWrite((request, deps) => guardPnjVisibility(request?.data, request, deps, restorePublicContent, 'restore')), dependencies),
        purgePublicContent: wrap(legacyEnqueteWrite((request, deps) => purgePublicContent(request?.data, request, deps)), dependencies),
        setTrashVisibility: wrap(legacyEnqueteWrite((request, deps) => setTrashVisibility(request?.data, request, deps)), dependencies),
        uploadContributionImage: wrap(legacyEnqueteWrite(uploadContributionImage), dependencies),
    };
}




import { HttpsError } from 'firebase-functions/v2/https';
import { CatalogueCommandError } from './service.mjs';

const CODES = new Set(['aborted', 'already-exists', 'failed-precondition', 'invalid-argument',
    'permission-denied', 'resource-exhausted', 'unauthenticated', 'unavailable']);

export function toCatalogueHttpsError(error) {
    if (!(error instanceof CatalogueCommandError) || !CODES.has(error.code)) {
        return new HttpsError('internal', 'commande de référentiel impossible');
    }
    const details = error.details && typeof error.details === 'object' ? error.details : undefined;
    return new HttpsError(error.code, error.message || 'commande refusée', details);
}

export function createCatalogueCommandHandler(dependencies) {
    return async request => {
        try {
            const resolved = typeof dependencies === 'function' ? dependencies() : dependencies;
            if (typeof resolved?.executeCatalogueCommand !== 'function') throw new TypeError('service de référentiel indisponible');
            return await resolved.executeCatalogueCommand(request?.data, request);
        } catch (error) {
            throw toCatalogueHttpsError(error);
        }
    };
}

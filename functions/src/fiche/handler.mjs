import { HttpsError } from 'firebase-functions/v2/https';
import { executeFicheCommand } from './service.mjs';

const CALLABLE_CODES = new Set([
    'aborted', 'already-exists', 'failed-precondition', 'internal', 'invalid-argument',
    'not-found', 'permission-denied', 'resource-exhausted', 'unauthenticated', 'unavailable',
]);

function safeDetails(code, details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
    if (code === 'permission-denied' || code === 'unauthenticated') return undefined;
    const kind = typeof details.kind === 'string' ? details.kind : undefined;
    if (kind === 'conflict') {
        return {
            kind,
            ...(Number.isSafeInteger(details.revision) ? { revision: details.revision } : {}),
            ...(Array.isArray(details.fields) ? { fields: details.fields.filter(field => typeof field === 'string').slice(0, 40) } : {}),
        };
    }
    if (kind === 'price-changed') {
        return {
            kind,
            ...(Number.isFinite(details.expectedCost) ? { expectedCost: details.expectedCost } : {}),
            ...(Number.isFinite(details.currentCost) ? { currentCost: details.currentCost } : {}),
        };
    }
    if (kind === 'migration-needed') return { kind };
    if (kind === 'talent-limit' || kind === 'cancel-talent-limit') {
        return { kind, ...(typeof details.reason === 'string' ? { reason: details.reason.slice(0, 300) } : {}) };
    }
    if (kind === 'field-forbidden') return { kind, ...(typeof details.path === 'string' ? { path: details.path } : {}) };
    return kind ? { kind } : undefined;
}

export function toFicheHttpsError(error) {
    if (!CALLABLE_CODES.has(error?.code)) return new HttpsError('internal', 'commande de fiche impossible');
    return new HttpsError(error.code, error.message || 'commande refusée', safeDetails(error.code, error.details));
}

export function createFicheCommandHandler(dependencies) {
    return async request => {
        try {
            const resolved = typeof dependencies === 'function' ? dependencies() : dependencies;
            return await executeFicheCommand(request?.data, request, resolved);
        } catch (error) {
            throw toFicheHttpsError(error);
        }
    };
}

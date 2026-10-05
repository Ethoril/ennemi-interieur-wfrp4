import { HttpsError } from 'firebase-functions/v2/https';
import { migrateFicheCallable } from './migration.mjs';

const CALLABLE_CODES = new Set([
    'aborted', 'already-exists', 'failed-precondition', 'internal', 'invalid-argument',
    'not-found', 'permission-denied', 'resource-exhausted', 'unauthenticated', 'unavailable',
]);

function safeDetails(error) {
    const kind = error?.details?.kind;
    if (kind === 'source-changed') return { kind, currentSourceFingerprint: error.details.currentSourceFingerprint };
    if (kind === 'migration-blocked') return { kind, report: error.details.report };
    return kind ? { kind } : undefined;
}

export function createFicheMigrationHandler(dependencies) {
    return async request => {
        try {
            const resolved = typeof dependencies === 'function' ? dependencies() : dependencies;
            return await migrateFicheCallable(request, resolved);
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            if (!CALLABLE_CODES.has(error?.code)) throw new HttpsError('internal', 'migration de fiche impossible');
            throw new HttpsError(error.code, error.message || 'migration refusée', safeDetails(error));
        }
    };
}

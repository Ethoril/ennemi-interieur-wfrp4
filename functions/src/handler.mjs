import { HttpsError } from 'firebase-functions/v2/https';
import { uploadProtectedImage } from './core.mjs';

export function toHttpsError(error) {
    const exposedCodes = new Set(['permission-denied', 'already-exists', 'failed-precondition', 'invalid-argument']);
    if (exposedCodes.has(error?.code)) return new HttpsError(error.code, error.message);
    return new HttpsError('internal', 'upload protégé impossible');
}

export function createUploadHandler(dependencies) {
    return async request => {
        try {
            const resolved = typeof dependencies === 'function' ? dependencies() : dependencies;
            return await uploadProtectedImage(request.data, request, resolved);
        } catch (error) {
            throw toHttpsError(error);
        }
    };
}

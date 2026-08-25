import { protectedUploadOperationId } from './protected-upload-id.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;
const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' });
const MAX_BYTES = Object.freeze({ portrait: 2 * 1024 * 1024, indice: 5 * 1024 * 1024 });
let defaultFunctionsPromise = null;
async function defaultFunctions() {
    defaultFunctionsPromise ??= import('./firebase-init.js').then(module => module.functions);
    return defaultFunctionsPromise;
}

async function blobToBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let result = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        result += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return globalThis.btoa(result);
}

export function createProtectedImageUploader({ functions: functionsInstance = null, httpsCallable: callableFactory = null } = {}) {
    return async function uploadWithFunctions(blob, { kind, ownerId, contentType }) {
        if (!(blob instanceof Blob) || !['portrait', 'indice'].includes(kind) || !ID_PATTERN.test(ownerId ?? '')
            || !Object.hasOwn(EXTENSIONS, contentType)) throw new Error('Paramètres image protégée invalides.');
        if (blob.size <= 0 || blob.size > MAX_BYTES[kind]) throw new Error('Image vide ou trop volumineuse.');
        const operationId = await protectedUploadOperationId(blob);
        const functions = functionsInstance ?? await defaultFunctions();
        const httpsCallable = callableFactory ?? (await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js')).httpsCallable;
        const callable = httpsCallable(functions, 'uploadProtectedImage');
        const result = await callable({ kind, ownerId, operationId, contentType, base64: await blobToBase64(blob) });
        const prefix = kind === 'portrait' ? 'portraits' : 'indices';
        const stem = kind === 'portrait' ? 'portrait' : 'image';
        const expected = `${prefix}/${ownerId}/${stem}-${operationId}.${EXTENSIONS[contentType]}`;
        if (!result.data || Object.keys(result.data).length !== 1 || result.data.imagePath !== expected) throw new Error('Réponse image protégée invalide.');
        return { imagePath: result.data.imagePath };
    };
}

export const uploadProtectedImage = createProtectedImageUploader();

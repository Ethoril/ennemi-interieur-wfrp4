import { createHash } from 'node:crypto';

export const MAX_BYTES = Object.freeze({ portrait: 2 * 1024 * 1024, indice: 5 * 1024 * 1024 });
export const MIME_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
});
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/u;

export class UploadValidationError extends Error {
    constructor(message, code = 'invalid-argument') { super(message); this.code = code; }
}

export function isAuthorized(auth) {
    return auth?.token?.email === 'ethoril@gmail.com' && auth.token.email_verified === true;
}

function decodeBase64(value, maximum) {
    if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0
        || value.length > 4 * Math.ceil(maximum / 3) || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
        throw new UploadValidationError('base64 invalide ou trop volumineux');
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length === 0 || decoded.length > maximum || decoded.toString('base64') !== value) {
        throw new UploadValidationError('base64 invalide ou taille hors limites');
    }
    return decoded;
}

export function hasMatchingMagic(bytes, contentType) {
    if (contentType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (contentType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (contentType === 'image/webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (contentType === 'image/gif') return bytes.subarray(0, 6).toString() === 'GIF87a' || bytes.subarray(0, 6).toString() === 'GIF89a';
    if (contentType === 'image/avif') return bytes.length >= 12 && bytes.subarray(4, 8).toString() === 'ftyp'
        && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString());
    return false;
}

export function validateUpload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UploadValidationError('payload invalide');
    const { kind, ownerId, operationId, contentType } = data;
    if (!['portrait', 'indice'].includes(kind) || !ID_PATTERN.test(ownerId ?? '') || !ID_PATTERN.test(operationId ?? '')) {
        throw new UploadValidationError('identifiant ou type invalide');
    }
    if (!Object.hasOwn(MIME_EXTENSIONS, contentType)) throw new UploadValidationError('MIME raster invalide');
    const bytes = decodeBase64(data.base64, MAX_BYTES[kind]);
    if (!hasMatchingMagic(bytes, contentType)) throw new UploadValidationError('signature image incohérente avec le MIME');
    const prefix = kind === 'portrait' ? 'portraits' : 'indices';
    const stem = kind === 'portrait' ? 'portrait' : 'image';
    const imagePath = `${prefix}/${ownerId}/${stem}-${operationId}.${MIME_EXTENSIONS[contentType]}`;
    return { kind, ownerId, operationId, contentType, bytes, imagePath,
        md5Hash: createHash('md5').update(bytes).digest('base64') };
}

export function hasExploitableToken(metadata) {
    return Object.entries(metadata?.metadata ?? {}).some(([key, value]) => key.toLowerCase() === 'firebasestoragedownloadtokens'
        && ((typeof value === 'string' && value.length > 0) || (Array.isArray(value) && value.length > 0)));
}

function sameContent(metadata, upload) {
    return metadata?.contentType === upload.contentType && Number(metadata?.size) === upload.bytes.length
        && metadata?.md5Hash === upload.md5Hash;
}

export async function uploadProtectedImage(data, context, deps) {
    if (!isAuthorized(context?.auth)) throw new UploadValidationError('authentification MJ vérifiée obligatoire', 'permission-denied');
    const upload = validateUpload(data);
    const file = deps.bucket.file(upload.imagePath);
    let existing = null;
    try { [existing] = await file.getMetadata(); } catch (error) { if (error.code !== 404 && error.code !== 5) throw error; }
    if (existing) {
        if (!sameContent(existing, upload)) throw new UploadValidationError('operationId déjà utilisé avec un contenu différent', 'already-exists');
        if (hasExploitableToken(existing)) throw new UploadValidationError('objet existant avec token exploitable', 'failed-precondition');
        if (existing.cacheControl !== 'no-store') throw new UploadValidationError('objet existant avec cache persistant', 'failed-precondition');
        return { imagePath: upload.imagePath };
    }
    try {
        await file.save(upload.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: {
            contentType: upload.contentType, cacheControl: 'no-store', metadata: {},
        } });
    } catch (error) {
        try {
            const [afterRace] = await file.getMetadata();
            if (sameContent(afterRace, upload) && afterRace.cacheControl === 'no-store' && !hasExploitableToken(afterRace)) return { imagePath: upload.imagePath };
        } catch { /* La première erreur reste la cause visible. */ }
        throw error;
    }
    try {
        const [metadata] = await file.getMetadata();
        if (!sameContent(metadata, upload) || metadata.cacheControl !== 'no-store' || hasExploitableToken(metadata)) {
            throw new UploadValidationError('métadonnées Storage non conformes', 'failed-precondition');
        }
    } catch (error) {
        try { await file.delete({ ignoreNotFound: true }); }
        catch (cleanupError) {
            try { await deps.onCleanupFailure?.({ imagePath: upload.imagePath, error: cleanupError }); }
            catch { /* La journalisation ne doit jamais masquer la cause initiale. */ }
        }
        throw error;
    }
    return { imagePath: upload.imagePath };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { hasExploitableToken, uploadProtectedImage, validateUpload } from '../src/core.mjs';
import { createUploadHandler } from '../src/handler.mjs';

const auth = { auth: { token: { email: 'ethoril@gmail.com', email_verified: true } } };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const payload = (overrides = {}) => ({ kind: 'portrait', ownerId: 'pnj-1', operationId: 'op-1', contentType: 'image/png', base64: png.toString('base64'), ...overrides });

function fakeBucket({ injectToken = false } = {}) {
    const objects = new Map();
    return { objects, file(path) {
        return {
            async getMetadata() { if (!objects.has(path)) { const error = new Error('absent'); error.code = 404; throw error; } return [objects.get(path)]; },
            async save(bytes, options) {
                if (objects.has(path) && options.preconditionOpts?.ifGenerationMatch === 0) { const error = new Error('exists'); error.code = 412; throw error; }
                objects.set(path, { size: bytes.length, contentType: options.metadata.contentType, cacheControl: options.metadata.cacheControl,
                    md5Hash: createHash('md5').update(bytes).digest('base64'), metadata: injectToken ? { firebaseStorageDownloadTokens: 'generated' } : options.metadata.metadata });
            },
            async delete() { objects.delete(path); },
        };
    } };
}

test('validateUpload impose auth du contenu, limites, MIME et signature', () => {
    assert.equal(validateUpload(payload()).imagePath, 'portraits/pnj-1/portrait-op-1.png');
    assert.equal(validateUpload(payload({ kind: 'indice', contentType: 'image/jpeg', base64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') })).imagePath, 'indices/pnj-1/image-op-1.jpg');
    assert.throws(() => validateUpload(payload({ ownerId: '../x' })), /identifiant/u);
    assert.throws(() => validateUpload(payload({ contentType: 'image/svg+xml' })), /MIME/u);
    assert.throws(() => validateUpload(payload({ contentType: 'image/jpeg' })), /signature/u);
    assert.throws(() => validateUpload(payload({ base64: Buffer.from('not an image').toString('base64') })), /signature/u);
    assert.throws(() => validateUpload(payload({ base64: '' })), /base64/u);
});

test('uploadProtectedImage est idempotent, refuse les conflits et ne renvoie que le chemin', async () => {
    const bucket = fakeBucket();
    const deps = { bucket };
    const first = await uploadProtectedImage(payload(), auth, deps);
    assert.deepEqual(first, { imagePath: 'portraits/pnj-1/portrait-op-1.png' });
    assert.deepEqual(await uploadProtectedImage(payload(), auth, deps), first);
    await assert.rejects(uploadProtectedImage(payload({ base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]).toString('base64') }), auth, deps), /contenu différent/u);
    await assert.rejects(uploadProtectedImage(payload(), {}, deps), /authentification/u);
    await assert.rejects(uploadProtectedImage(payload(), { auth: { token: { email: 'joueur@example.test', email_verified: true } } }, deps), /authentification/u);
    await assert.rejects(uploadProtectedImage(payload(), { auth: { token: { email: 'ethoril@gmail.com', email_verified: false } } }, deps), /authentification/u);
    assert.equal(hasExploitableToken({ metadata: { firebaseStorageDownloadTokens: '' } }), false);
    assert.equal(hasExploitableToken({ metadata: { firebaseStorageDownloadTokens: 'x' } }), true);
    bucket.objects.set('portraits/pnj-2/portrait-op-2.png', {
        size: png.length, contentType: 'image/png', cacheControl: 'no-store',
        md5Hash: createHash('md5').update(png).digest('base64'), metadata: { firebaseStorageDownloadTokens: 'present' },
    });
    await assert.rejects(uploadProtectedImage(payload({ ownerId: 'pnj-2', operationId: 'op-2' }), auth, deps), /token exploitable/u);
    bucket.objects.set('portraits/pnj-4/portrait-op-4.png', {
        size: png.length, contentType: 'image/png', cacheControl: 'public, max-age=3600',
        md5Hash: createHash('md5').update(png).digest('base64'), metadata: {},
    });
    await assert.rejects(uploadProtectedImage(payload({ ownerId: 'pnj-4', operationId: 'op-4' }), auth, deps), /cache persistant/u);
    const tokenBucket = fakeBucket({ injectToken: true });
    await assert.rejects(uploadProtectedImage(payload({ ownerId: 'pnj-3', operationId: 'op-3' }), auth, { bucket: tokenBucket }), /métadonnées/u);
    assert.equal(tokenBucket.objects.size, 0);
    let cleanupSignal = null;
    const cleanupFailureBucket = fakeBucket({ injectToken: true });
    const originalFile = cleanupFailureBucket.file.bind(cleanupFailureBucket);
    cleanupFailureBucket.file = path => ({ ...originalFile(path), async delete() { throw Object.assign(new Error('delete failed'), { code: 503 }); } });
    await assert.rejects(uploadProtectedImage(payload({ ownerId: 'pnj-5', operationId: 'op-5' }), auth, {
        bucket: cleanupFailureBucket,
        onCleanupFailure: signal => { cleanupSignal = signal; },
    }), /métadonnées/u);
    assert.equal(cleanupSignal.imagePath, 'portraits/pnj-5/portrait-op-5.png');
    assert.equal(cleanupSignal.error.code, 503);
});

test('limite indice et taille encodée sont refusées avant décodage complet', () => {
    const exact = Buffer.alloc(5 * 1024 * 1024, 0);
    exact[0] = 0xff; exact[1] = 0xd8; exact[2] = 0xff;
    assert.equal(validateUpload(payload({ kind: 'indice', operationId: 'exact', contentType: 'image/jpeg', base64: exact.toString('base64') })).bytes.length, exact.length);
    const large = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    assert.throws(() => validateUpload(payload({ kind: 'indice', operationId: 'large', base64: large.toString('base64') })), /taille|base64/u);
    assert.throws(() => validateUpload(payload({ base64: `${png.toString('base64')}!!!!` })), /base64/u);
});

test('le handler callable traduit les erreurs attendues et masque les erreurs internes', async () => {
    const bucket = fakeBucket();
    const handler = createUploadHandler({ bucket });
    assert.deepEqual(await handler({ ...auth, data: payload() }), { imagePath: 'portraits/pnj-1/portrait-op-1.png' });
    await assert.rejects(handler({ data: payload() }), error => error.code === 'permission-denied');
    const broken = createUploadHandler({ bucket: { file: () => ({
        async getMetadata() { const error = new Error('absent'); error.code = 404; throw error; },
        async save() { throw new Error('secret backend detail'); },
    }) } });
    await assert.rejects(broken({ ...auth, data: payload({ operationId: 'broken' }) }), error => (
        error.code === 'internal' && error.message === 'upload protégé impossible'
    ));
});

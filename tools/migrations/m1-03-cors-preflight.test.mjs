import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCors, validateCorsConfig, validateTarget } from './m1-03-cors-preflight.mjs';

test('préflight CORS valide uniquement la configuration raster locale', () => {
    assert.deepEqual(validateCorsConfig([{ origin: ['http://localhost:8000', 'http://127.0.0.1:8000', 'https://ethoril.github.io'], method: ['GET', 'HEAD'], responseHeader: ['Content-Type', 'Content-Length', 'ETag'], maxAgeSeconds: 300 }]), []);
    assert.ok(validateCorsConfig([{ origin: [], method: ['GET'], responseHeader: [], maxAgeSeconds: -1 }]).length >= 3);
});

test('préflight CORS refuse une écriture et garde la production', () => {
    assert.ok(validateTarget({ project: 'demo', bucket: 'demo.appspot.com', execute: true }).some(error => error.includes('lecture')));
    assert.ok(validateTarget({ project: 'demo', bucket: 'demo.appspot.com', mode: 'apply', execute: true, confirmCors: 'wrong', env: { FIRESTORE_EMULATOR_HOST: 'x', STORAGE_EMULATOR_HOST: 'y' } }).some(error => error.includes('confirm-cors')));
    assert.ok(validateTarget({ project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', mode: 'apply', execute: true, confirmProduction: 'campagne-wrpg', confirmCors: 'campagne-wrpg', env: { FIRESTORE_EMULATOR_HOST: 'x' } }).some(error => error.includes('émulateur')));
    assert.ok(validateTarget({ project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app' }).some(error => error.includes('confirm-production')));
    assert.deepEqual(validateTarget({ project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', confirmProduction: 'campagne-wrpg' }), []);
});

test('inspection CORS compare les tableaux sans dépendre de leur ordre', async () => {
    const client = { bucket: { getMetadata: async () => [{ cors: [{ method: ['HEAD', 'GET'], origin: ['https://ethoril.github.io', 'http://localhost:8000'], responseHeader: ['ETag', 'Content-Type'], maxAgeSeconds: 300 }] }] } };
    assert.equal(await inspectCors(client, [{ origin: ['http://localhost:8000', 'https://ethoril.github.io'], method: ['GET', 'HEAD'], responseHeader: ['Content-Type', 'ETag'], maxAgeSeconds: 300 }]), true);
});

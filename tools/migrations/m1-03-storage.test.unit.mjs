import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMigrationState, hasDownloadToken, metadataIdentity, parseStorageReference, persistState, planMigration, parseArgs, recordMigrationPhase, runMigration, validateMigrationState, validateOptions, verifyMetadata } from './m1-03-storage.mjs';

const png = { path: 'portraits/legacy.png', size: '3', contentType: 'image/png', md5Hash: 'abc' };

test('plan M1-03 est idempotent, signale orphelin et références multiples', () => {
    const plan = planMigration({
        pnjs: [
            { id: 'a', data: { imageUrl: 'portraits/legacy.png' } },
            { id: 'b', data: { imageUrl: 'portraits/legacy.png' } },
        ],
        indices: [], files: [png, { path: 'indices/orphan.png', size: '1', contentType: 'image/png' }],
    });
    assert.equal(plan.entries.length, 2);
    assert.ok(plan.signals.some(signal => signal.endsWith('references-multiples')));
    assert.ok(plan.signals.some(signal => signal.includes('indices/orphan.png:orphelin')));
    const second = planMigration({ pnjs: [{ id: 'a', data: { imagePath: 'portraits/a/legacy.png' } }], files: [{ ...png, path: 'portraits/a/legacy.png', cacheControl: 'no-store' }] });
    assert.equal(second.signals.length, 0);
});

test('imagePath protégé n est jamais source ni cible de cleanup', () => {
    const plan = planMigration({
        pnjs: [{ id: 'a', data: { imagePath: 'portraits/a/new.png', imageUrl: 'portraits/legacy.png' } }],
        files: [{ ...png }, { ...png, path: 'portraits/a/new.png', cacheControl: 'no-store' }],
    });
    assert.equal(plan.entries.length, 1);
    assert.equal(plan.entries[0].source, 'portraits/legacy.png');
    assert.equal(plan.entries[0].target, 'portraits/a/new.png');
    const protectedOnly = planMigration({ pnjs: [{ id: 'a', data: { imagePath: 'portraits/a/new.png' } }], files: [{ ...png, path: 'portraits/a/new.png', cacheControl: 'no-store' }] });
    assert.equal(protectedOnly.entries.length, 0);
    const missingProtected = planMigration({ pnjs: [{ id: 'a', data: { imagePath: 'portraits/a/missing.png' } }], files: [] });
    assert.ok(missingProtected.signals.some(signal => signal.endsWith('cible-absente')));
    const cachedProtected = planMigration({ pnjs: [{ id: 'a', data: { imagePath: 'portraits/a/cached.png' } }], files: [{ ...png, path: 'portraits/a/cached.png', cacheControl: 'public, max-age=3600' }] });
    assert.ok(cachedProtected.signals.some(signal => signal.endsWith('cible-cache-persistant')));
});

test('source legacy imbriquée ou identique à la cible est bloquée et protégée orpheline signalée', () => {
    const nested = planMigration({ pnjs: [{ id: 'a', data: { imageUrl: 'portraits/a/new.png' } }], files: [{ ...png, path: 'portraits/a/new.png' }] });
    assert.equal(nested.entries.length, 0);
    assert.ok(nested.signals.some(signal => signal.endsWith('source-legacy-non-plat')));
    const orphanProtected = planMigration({ pnjs: [{ id: 'a', data: { visibleJoueurs: true } }], files: [{ ...png, path: 'portraits/a/unreferenced.png' }] });
    assert.ok(orphanProtected.signals.some(signal => signal.endsWith('orphelin-protege')));
});

test('validation de métadonnées exige taille, MIME et empreinte concordantes', () => {
    assert.equal(verifyMetadata(png, png), true);
    assert.equal(verifyMetadata(png, { ...png, size: '4' }), false);
    assert.equal(verifyMetadata(png, { ...png, contentType: 'image/jpeg' }), false);
    assert.equal(verifyMetadata(png, { ...png, md5Hash: 'different' }), false);
    assert.equal(hasDownloadToken({ metadata: { firebaseStorageDownloadTokens: 'secret' } }), true);
    assert.equal(hasDownloadToken({ metadata: { firebaseStorageDownloadTokens: '' } }), false);
    assert.equal(hasDownloadToken({ metadata: { firebaseStorageDownloadTokens: null } }), false);
    assert.equal(hasDownloadToken({ metadata: { safe: 'value' } }), false);
});

test('références URL non parsables ou bucket incohérent sont signalées', () => {
    assert.equal(parseStorageReference('https://example.invalid/v0/b/demo/o/portraits/a.png', 'demo').valid, false);
    assert.equal(parseStorageReference('gs://other/portraits/a.png', 'demo').valid, false);
    const plan = planMigration({ bucket: 'demo', pnjs: [{ id: 'a', data: { imageUrl: 'https://example.invalid/image.png' } }], files: [] });
    assert.ok(plan.signals.some(signal => signal.endsWith('imageUrl-invalide')));
});

test('plan bloque les médias non raster ou au-delà de la taille maximale', () => {
    const plan = planMigration({
        pnjs: [{ id: 'a', data: { imageUrl: 'portraits/old.svg' } }],
        files: [{ path: 'portraits/old.svg', size: String(2 * 1024 * 1024 + 1), contentType: 'image/svg+xml' }],
    });
    assert.ok(plan.signals.some(signal => signal.endsWith('media-invalide')));
    const empty = planMigration({ pnjs: [{ id: 'a', data: { imageUrl: 'portraits/empty.png' } }], files: [{ path: 'portraits/empty.png', size: '0', contentType: 'image/png' }] });
    assert.ok(empty.signals.some(signal => signal.endsWith('media-invalide')));
});

test('gardes migration: dry-run emulator, production et cleanup explicite', () => {
    const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', STORAGE_EMULATOR_HOST: '127.0.0.1:9199' };
    assert.deepEqual(validateOptions({ phase: 'inventory', project: 'demo', bucket: 'demo.appspot.com', execute: false }, { env }), []);
    assert.ok(validateOptions({ phase: 'inventory', project: 'demo', bucket: 'demo.appspot.com', execute: false }, { env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } }).some(error => error.includes('Firestore et Storage')));
    assert.ok(validateOptions({ phase: 'inventory', project: 'demo', bucket: 'demo.appspot.com', execute: false }, { env: { STORAGE_EMULATOR_HOST: '127.0.0.1:9199' } }).some(error => error.includes('Firestore et Storage')));
    assert.ok(validateOptions({ phase: 'copy-verify', project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', execute: true, state: 'C:\\tmp\\state.json' }, { env: {} }).some(error => error.includes('confirm-production')));
    assert.ok(validateOptions({ phase: 'inventory', project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', execute: false, confirmProduction: 'campagne-wrpg', manifest: 'C:\\tmp\\manifest.json' }, { env }).some(error => error.includes('cible production')));
    assert.ok(validateOptions({ phase: 'cleanup', project: 'demo', bucket: 'demo.appspot.com', execute: true, state: 'C:\\tmp\\state.json' }, { env }).some(error => error.includes('confirm-cleanup')));
    assert.deepEqual(parseArgs(['inventory', '--project=demo', '--bucket=demo.appspot.com']).phase, 'inventory');
});

test('empreinte de plan stable pendant les phases et état séparé', () => {
    const plan = planMigration({ pnjs: [{ id: 'a', data: { imageUrl: 'portraits/legacy.png' } }], files: [png] });
    const state = createMigrationState(plan, 'demo', 'demo.appspot.com');
    assert.equal(validateMigrationState(state, plan, 'demo', 'demo.appspot.com'), true);
    assert.equal(Object.hasOwn(state.entries[0], 'expectedImageUrlValue'), false);
    assert.equal(JSON.stringify(state).includes('https://'), false);
    recordMigrationPhase(state, 'copied', plan.entries[0].target, { source: plan.entries[0].source, identity: metadataIdentity(png) });
    assert.equal(state.referenced[plan.entries[0].target], undefined);
    recordMigrationPhase(state, 'referenced', plan.entries[0].target, { source: plan.entries[0].source, identity: metadataIdentity(png) });
    assert.equal(state.cleaned[plan.entries[0].source], undefined);
    recordMigrationPhase(state, 'cleaned', plan.entries[0].source, { target: plan.entries[0].target, identity: metadataIdentity(png) });
    assert.equal(Object.keys(state.copied).length, 1);
    assert.equal(Object.keys(state.referenced).length, 1);
    assert.equal(Object.keys(state.cleaned).length, 1);
});

test('persistState crée le dossier hors dépôt avant écriture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'm1-03-state-'));
    try {
        const statePath = join(directory, 'nested', 'state.json');
        await persistState(statePath, { format: 'm1-03-storage-state' });
        assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), { format: 'm1-03-storage-state' });
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('runMigration refuse ses options avant toute connexion Admin', async () => {
    await assert.rejects(runMigration({ phase: 'inventory', project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', execute: false }), /confirm-production|backup-manifest/u);
});

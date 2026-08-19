import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
    PRODUCTION_PROJECT,
    PRODUCTION_BUCKET,
    REPO_ROOT,
    backup,
    deserializeFirestoreValue,
    resolveBackupPath,
    sanitizeStorageMetadata,
    storageMetadataForUpload,
    serializeFirestoreValue,
    validateRestoreDocuments,
    validateCollectionManifest,
    validateEmulatorRunnerOptions,
    validateStorageManifest,
    validateOptions,
    verifyFileIntegrity,
} from './mobile-backup.mjs';

const outside = resolve(REPO_ROOT, '..', 'm0-backup-test-output');
const baseBackup = {
    command: 'backup', project: 'demo-mobile', bucket: 'demo-mobile.appspot.com', out: outside, execute: false,
};

test('le dry-run de backup ne demande aucune connexion', async () => {
    assert.deepEqual(validateOptions(baseBackup), []);
    const result = await backup(baseBackup);
    assert.equal(result.dryRun, true);
});

test('la production exige la confirmation exacte', () => {
    const errors = validateOptions({ ...baseBackup, project: PRODUCTION_PROJECT });
    assert.match(errors.join('\n'), /confirm-production=campagne-wrpg/);
    assert.deepEqual(validateOptions({
        ...baseBackup, project: PRODUCTION_PROJECT, bucket: PRODUCTION_BUCKET,
        confirmProduction: PRODUCTION_PROJECT,
    }), []);
});

test('le bucket de production est protégé même avec un faux projet', () => {
    const fakeProject = { ...baseBackup, bucket: PRODUCTION_BUCKET };
    assert.match(validateOptions(fakeProject).join('\n'), /bucket de production/);
    assert.match(validateOptions({ ...fakeProject, command: 'restore', execute: true }, {
        env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
    }).join('\n'), /restauration de production/);
});

test('la sortie relative ou dans le dépôt est refusée', () => {
    assert.match(validateOptions({ ...baseBackup, out: 'backup' }).join('\n'), /chemin absolu/);
    assert.match(validateOptions({ ...baseBackup, out: resolve(REPO_ROOT, 'backup') }).join('\n'), /hors du dépôt/);
});

test('la restauration hors émulateur exige une garde explicite', () => {
    const options = {
        command: 'restore', project: 'demo-mobile', bucket: 'demo-mobile.appspot.com',
        input: outside, execute: true,
    };
    assert.match(validateOptions(options, { env: {} }).join('\n'), /hors émulateur/);
    assert.deepEqual(validateOptions({ ...options, allowNonEmulatorRestore: true, confirmRestore: 'demo-mobile' }, { env: {} }), []);
});

test('les runners exigent les deux émulateurs et refusent toute cible de production', () => {
    assert.match(validateEmulatorRunnerOptions({
        project: 'demo-mobile', bucket: 'demo-mobile.appspot.com', env: {},
    }).join('\n'), /émulateurs Firestore et Storage/);
    assert.match(validateEmulatorRunnerOptions({
        project: PRODUCTION_PROJECT, bucket: PRODUCTION_BUCKET,
        env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
    }).join('\n'), /production/);
    assert.match(validateEmulatorRunnerOptions({
        project: 'demo-mobile', bucket: PRODUCTION_BUCKET,
        env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
    }).join('\n'), /production/);
    assert.deepEqual(validateEmulatorRunnerOptions({
        project: 'demo-mobile', bucket: 'demo-mobile.appspot.com',
        env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
    }), []);
});

test('les valeurs Firestore spéciales se sérialisent puis se restaurent', () => {
    const timestamp = { seconds: 123, nanoseconds: 987654321, toDate: () => new Date('2026-01-02T03:04:05.000Z') };
    const reference = { path: 'pnjs/fixture-alrik', firestore: {} };
    const bytes = { toBase64: () => 'AQI=' };
    const source = {
        timestamp, reference, bytes, nested: [{ value: 4 }],
        notANumber: Number.NaN, positiveInfinity: Number.POSITIVE_INFINITY, negativeInfinity: Number.NEGATIVE_INFINITY,
    };
    const serialized = serializeFirestoreValue(source);
    assert.equal(serialized.timestamp.__type, 'timestamp');
    assert.equal(serialized.timestamp.nanoseconds, 987654321);
    assert.equal(serialized.reference.path, 'pnjs/fixture-alrik');
    assert.equal(serialized.bytes.value, 'AQI=');
    assert.equal(serialized.notANumber.value, 'NaN');
    assert.equal(serialized.positiveInfinity.value, 'Infinity');
    assert.equal(serialized.negativeInfinity.value, '-Infinity');
    class FakeTimestamp {
        constructor(seconds, nanoseconds) { this.kind = 'timestamp'; this.seconds = seconds; this.nanoseconds = nanoseconds; }
    }
    class FakeGeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
    class FakeBytes { static fromBase64String(value) { return { kind: 'bytes', value }; } }
    const fakeFirestore = { doc: path => ({ kind: 'reference', path }) };
    const restored = deserializeFirestoreValue(serialized, {
        Timestamp: FakeTimestamp, GeoPoint: FakeGeoPoint, Bytes: FakeBytes, firestore: fakeFirestore,
    });
    assert.equal(restored.timestamp.kind, 'timestamp');
    assert.equal(restored.timestamp.seconds, 123);
    assert.equal(restored.timestamp.nanoseconds, 987654321);
    assert.equal(restored.reference.path, 'pnjs/fixture-alrik');
    assert.equal(restored.bytes.value, 'AQI=');
    assert.equal(Number.isNaN(restored.notANumber), true);
    assert.equal(restored.positiveInfinity, Number.POSITIVE_INFINITY);
    assert.equal(restored.negativeInfinity, Number.NEGATIVE_INFINITY);
    assert.deepEqual(restored.nested, [{ value: 4 }]);
});

test('les maps utilisateur possédant __type ne sont pas interprétées comme des wrappers', () => {
    const source = {
        timestampLike: { __type: 'timestamp', seconds: 7, nanoseconds: 8 },
        mapLike: { __type: 'map', value: 'littéral' },
    };
    const serialized = serializeFirestoreValue(source);
    assert.equal(serialized.timestampLike.__type, 'map');
    assert.equal(serialized.mapLike.__type, 'map');
    const restored = deserializeFirestoreValue(serialized, {
        Timestamp: class FakeTimestamp {
            constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
        },
        GeoPoint: class FakeGeoPoint {},
        Bytes: class FakeBytes {},
        firestore: { doc: path => ({ path }) },
    });
    assert.deepEqual(restored, source);
});

test('une empreinte JSON incorrecte est refusée avant restauration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wfrp-backup-unit-'));
    try {
        const path = join(root, 'collection.json');
        await writeFile(path, '[{}]\n', 'utf8');
        await assert.rejects(verifyFileIntegrity(path, {
            bytes: Buffer.byteLength('[{}]\n'), sha256: 'empreinte-invalide',
        }, 'collection'), /empreinte invalide/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('un chemin absolu ou traversant est refusé', () => {
    assert.equal(resolveBackupPath(outside, 'firestore/pnjs.json'), resolve(outside, 'firestore/pnjs.json'));
    assert.throws(() => resolveBackupPath(outside, '../escape.json'), /hors dossier/);
    assert.throws(() => resolveBackupPath(outside, 'C:\\escape.json'), /chemin de backup invalide|hors dossier/);
});

test('les documents de restauration exigent des ids et données valides', () => {
    const errors = validateRestoreDocuments('pnjs', [
        { id: 'ok', data: {} },
        { id: 'ok', data: {} },
        { id: 'bad/id', data: {} },
        { id: 'null-data', data: null },
    ]);
    assert.match(errors.join('\n'), /id dupliqué/);
    assert.match(errors.join('\n'), /id invalide/);
    assert.match(errors.join('\n'), /data invalide/);
});

test('le manifeste Firestore doit aussi couvrir les identifiants déclarés', () => {
    assert.deepEqual(validateCollectionManifest('pnjs', { count: 1, ids: ['a'] }, [{ id: 'a', data: {} }]), []);
    assert.match(validateCollectionManifest('pnjs', { count: 1, ids: ['b'] }, [{ id: 'a', data: {} }]).join('\n'), /identifiants JSON invalides/);
});

test('le manifeste Storage doit concorder avec ses fichiers', () => {
    assert.deepEqual(validateStorageManifest({ count: 1, totalBytes: 3, files: [{ path: 'indices/a/a.webp', size: 3 }] }), []);
    assert.match(validateStorageManifest({ count: 2, totalBytes: 4, files: [{ size: 3 }] }).join('\n'), /incohérent/);
    assert.match(validateStorageManifest({ count: 1, totalBytes: 4, files: [{ size: 3 }] }).join('\n'), /taille totale/);
    assert.match(validateStorageManifest({
        count: 2, totalBytes: 6, files: [{ path: 'indices/a/a.webp', size: 3 }, { path: 'indices/a/a.webp', size: 3 }],
    }).join('\n'), /chemins Storage dupliqués/);
    assert.match(validateStorageManifest({
        count: 1, totalBytes: 3, files: [{ path: '../escape.webp', size: 3 }],
    }).join('\n'), /préfixe Storage invalide/);
});

test('les métadonnées Storage utiles sont conservées sans token Firebase', () => {
    const metadata = sanitizeStorageMetadata({
        contentType: 'image/webp',
        cacheControl: 'public,max-age=60',
        metadata: { source: 'fixture', firebaseStorageDownloadTokens: 'secret' },
    });
    assert.equal(metadata.contentType, 'image/webp');
    assert.equal(metadata.metadata.source, 'fixture');
    assert.equal(Object.hasOwn(metadata.metadata, 'firebaseStorageDownloadTokens'), false);
    const upload = storageMetadataForUpload({ ...metadata, md5Hash: 'hash', generation: '1' });
    assert.equal(upload.contentType, 'image/webp');
    assert.equal(upload.md5Hash, undefined);
    assert.equal(upload.generation, undefined);
});

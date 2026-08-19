import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
    PRODUCTION_BUCKET,
    createAdminClient,
    resolveBackupPath,
    restore,
    serializeFirestoreValue,
    validateEmulatorRunnerOptions,
    validateStorageManifest,
} from './mobile-backup.mjs';

const input = process.env.MOBILE_BACKUP_INPUT;
const project = process.env.MOBILE_TEST_PROJECT ?? 'demo-mobile';
const bucket = process.env.MOBILE_TEST_BUCKET ?? `${project}.appspot.com`;
const runnerErrors = validateEmulatorRunnerOptions({ project, bucket });
if (runnerErrors.length) throw new Error('Runner émulateur refusé : cible ou environnement invalide.');
if (!input) throw new Error('MOBILE_BACKUP_INPUT est obligatoire');
if (project === 'campagne-wrpg' || bucket === PRODUCTION_BUCKET) throw new Error('cible de production interdite');

const manifest = JSON.parse(await readFile(resolveBackupPath(input, 'manifest.json'), 'utf8'));
assert.equal(manifest.complete, true);
assert.deepEqual(validateStorageManifest(manifest.storage), []);
const expected = {};
for (const collection of ['pnjs', 'pnjs_prives', 'relations', 'indices']) {
    const details = manifest.collections[collection];
    const documents = JSON.parse(await readFile(resolveBackupPath(input, details.file), 'utf8'));
    expected[collection] = { count: documents.length, ids: new Set(documents.map(document => document.id)) };
    expected[collection].data = new Map(documents.map(document => [document.id, document.data]));
}

const client = await createAdminClient({ project, bucket });
try {
    for (const collection of Object.keys(expected)) {
        const snapshot = await client.db.collection(collection).get();
        await Promise.all(snapshot.docs.map(document => document.ref.delete()));
    }
    const [objects] = await client.bucket.getFiles({ autoPaginate: true });
    await Promise.all(objects.map(object => object.delete().catch(error => {
        if (error.code !== 404) throw error;
    })));
} finally {
    await client.app.delete();
}

await restore({ command: 'restore', project, bucket, input, execute: true });
const verifyClient = await createAdminClient({ project, bucket });
try {
    for (const [collection, expectation] of Object.entries(expected)) {
        const snapshot = await verifyClient.db.collection(collection).get();
        assert.equal(snapshot.size, expectation.count, `${collection} count`);
        assert.deepEqual(new Set(snapshot.docs.map(document => document.id)), expectation.ids, `${collection} ids`);
        assert.ok(snapshot.docs.every(document => document.data() && typeof document.data() === 'object'
            && !Array.isArray(document.data())), `${collection} structure`);
        assert.ok(snapshot.docs.every(document => isDeepStrictEqual(
            serializeFirestoreValue(document.data()), expectation.data.get(document.id),
        )), `${collection} values`);
    }
    const expectedFiles = new Map(manifest.storage.files.map(file => [file.path, file]));
    const [objects] = await verifyClient.bucket.getFiles({ autoPaginate: true });
    assert.equal(objects.length, expectedFiles.size, 'Storage count');
    for (const object of objects) {
        const expectedFile = expectedFiles.get(object.name);
        assert.ok(expectedFile, 'Storage path');
        assert.equal(Number(object.metadata.size), Number(expectedFile.size), 'Storage size');
        assert.equal(object.metadata.contentType ?? null, expectedFile.contentType ?? null, 'Storage type');
        const [buffer] = await object.download();
        const hash = createHash('sha256').update(buffer).digest('hex');
        assert.equal(hash, expectedFile.sha256, 'Storage hash');
    }
} finally {
    await verifyClient.app.delete();
}
console.log(`✓ Restauration additive vérifiée : ${Object.values(expected).reduce((total, item) => total + item.count, 0)} documents, ${manifest.storage.count} fichiers.`);

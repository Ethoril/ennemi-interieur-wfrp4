import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
    backup,
    createAdminClient,
    restore,
    serializeFirestoreValue,
    validateEmulatorRunnerOptions,
} from './mobile-backup.mjs';
import { loadMobileFixture, validateMobileFixture } from './mobile-fixture.mjs';

const project = process.env.MOBILE_TEST_PROJECT ?? 'demo-mobile';
const bucketName = process.env.MOBILE_TEST_BUCKET ?? `${project}.appspot.com`;
const runnerErrors = validateEmulatorRunnerOptions({ project, bucket: bucketName });
if (runnerErrors.length) throw new Error('Runner émulateur refusé : cible ou environnement invalide.');
const output = process.env.MOBILE_TEST_BACKUP;
if (!output) throw new Error('MOBILE_TEST_BACKUP est obligatoire');

const fixture = await loadMobileFixture();
assert.deepEqual(validateMobileFixture(fixture), []);
const client = await createAdminClient({ project, bucket: bucketName });
try {
    for (const document of fixture.pnjs) {
        const { id, ...data } = document;
        await client.db.collection('pnjs').doc(id).set(data);
    }
    for (const document of fixture.pnjs_prives) {
        const { id, ...data } = document;
        await client.db.collection('pnjs_prives').doc(id).set(data);
    }
    for (const document of fixture.relations) {
        const { id, ...data } = document;
        await client.db.collection('relations').doc(id).set(data);
    }
    for (const document of fixture.indices) {
        const { id, ...data } = document;
        await client.db.collection('indices').doc(id).set(data);
    }
    for (const file of fixture.storage) {
        await client.bucket.file(file.path).save(Buffer.from(`fixture:${file.path}`, 'utf8'), {
            resumable: false,
            metadata: { contentType: 'image/webp' },
        });
    }
} finally {
    await client.app.delete();
}

const manifest = await backup({
    command: 'backup', project, bucket: bucketName, out: output, execute: true,
});
const expectedCollections = {};
for (const collection of ['pnjs', 'pnjs_prives', 'relations', 'indices']) {
    const exported = JSON.parse(await readFile(`${output}/${manifest.collections[collection].file}`, 'utf8'));
    expectedCollections[collection] = new Map(exported.map(document => [document.id, document.data]));
}
assert.deepEqual(Object.fromEntries(Object.entries(manifest.collections).map(([name, item]) => [name, item.count])), {
    pnjs: 5, pnjs_prives: 2, relations: 4, indices: 4,
});
assert.equal(manifest.storage.count, fixture.storage.length);
assert.ok(manifest.storage.totalBytes > 0);
assert.equal(JSON.stringify(manifest).includes('firebaseStorageDownloadTokens'), false);
for (const collection of ['pnjs', 'pnjs_prives', 'relations', 'indices']) {
    const exported = JSON.parse(await readFile(`${output}/${manifest.collections[collection].file}`, 'utf8'));
    assert.ok(exported.every(document => !Object.hasOwn(document.data, 'id')), `${collection} export id parasite`);
}

const cleanupClient = await createAdminClient({ project, bucket: bucketName });
try {
    for (const collection of ['pnjs', 'pnjs_prives', 'relations', 'indices']) {
        const snapshot = await cleanupClient.db.collection(collection).get();
        await Promise.all(snapshot.docs.map(document => document.ref.delete()));
    }
    const [objects] = await cleanupClient.bucket.getFiles({ autoPaginate: true });
    await Promise.all(objects.map(object => object.delete().catch(error => {
        if (error.code !== 404) throw error;
    })));
} finally {
    await cleanupClient.app.delete();
}

await restore({
    command: 'restore', project, bucket: bucketName, input: output, execute: true,
});
const verifyClient = await createAdminClient({ project, bucket: bucketName });
try {
    for (const collection of ['pnjs', 'pnjs_prives', 'relations', 'indices']) {
        const snapshot = await verifyClient.db.collection(collection).get();
        assert.equal(snapshot.size, manifest.collections[collection].count, collection);
        assert.ok(snapshot.docs.every(document => !Object.hasOwn(document.data(), 'id')), `${collection} structure`);
        for (const document of snapshot.docs) {
            assert.ok(isDeepStrictEqual(serializeFirestoreValue(document.data()), expectedCollections[collection].get(document.id)), `${collection} values`);
        }
    }
    const restoredPrivate = await verifyClient.db.collection('pnjs_prives').get();
    assert.deepEqual(restoredPrivate.docs.map(document => document.id).sort(), ['fixture-alrik', 'fixture-masque']);
    const restoredRelations = await verifyClient.db.collection('relations').get();
    assert.ok(restoredRelations.docs.some(document => document.data().fixtureCase === 'broken-reference'));
    const expectedFiles = new Map(manifest.storage.files.map(file => [file.path, file]));
    const [objects] = await verifyClient.bucket.getFiles({ autoPaginate: true });
    assert.equal(objects.length, expectedFiles.size, 'Storage count');
    for (const object of objects) {
        const expectedFile = expectedFiles.get(object.name);
        assert.ok(expectedFile, 'Storage structure');
        assert.equal(Number(object.metadata.size), Number(expectedFile.size), 'Storage size');
        for (const key of ['contentType', 'cacheControl', 'contentDisposition', 'contentEncoding', 'contentLanguage']) {
            if (expectedFile[key] !== undefined) assert.equal(object.metadata[key], expectedFile[key], 'Storage metadata');
        }
        for (const [key, value] of Object.entries(expectedFile.metadata ?? {})) {
            assert.equal(object.metadata.metadata?.[key], value, 'Storage custom metadata');
        }
        const [buffer] = await object.download();
        const hash = createHash('sha256').update(buffer).digest('hex');
        assert.equal(hash, expectedFile.sha256, 'Storage hash');
    }
} finally {
    await verifyClient.app.delete();
}

console.log(`✓ Intégration émulateur : ${manifest.storage.count} fichiers et ${manifest.collections.pnjs.count} PNJs restaurés.`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateFicheDocument } from '../src/domain/fiche-schema.js';
import { migrateFicheCallable } from '../src/fiche/migration.mjs';

const adminRequest = data => ({
    data,
    auth: { uid: 'mj-test', token: { email: 'ethoril@gmail.com', email_verified: true } },
});

function ref(path) {
    return {
        path,
        collection(name) {
            const parent = path;
            return { doc: id => ref(`${parent}/${name}/${id}`) };
        },
    };
}

function fakeDb(initial) {
    const documents = new Map(Object.entries(initial));
    const db = {
        documents,
        doc: path => ref(path),
        async runTransaction(callback) {
            const transaction = {
                async get(documentRef) {
                    const value = documents.get(documentRef.path);
                    return { exists: value !== undefined, data: () => structuredClone(value) };
                },
                create(documentRef, value) {
                    if (documents.has(documentRef.path)) throw new Error('already exists');
                    documents.set(documentRef.path, structuredClone(value));
                },
                set(documentRef, value) { documents.set(documentRef.path, structuredClone(value)); },
            };
            return callback(transaction);
        },
    };
    return db;
}

function deps(db) {
    return { db, timestamp: () => 'SERVER_TIMESTAMP' };
}

test('migrateFiche est réservée au MJ vérifié et exige une confirmation explicite', async () => {
    const db = fakeDb({ 'fiches/test': { data: {} } });
    const sourceFingerprint = (await migrateFicheDocument({ data: {} }, { charId: 'test' })).report.sourceFingerprint;
    const data = { charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: sourceFingerprint };

    await assert.rejects(migrateFicheCallable({ ...adminRequest(data), auth: { uid: 'p', token: { email: 'player@example.test', email_verified: true } } }, deps(db)), { code: 'permission-denied' });
    await assert.rejects(migrateFicheCallable({ ...adminRequest(data), data: { ...data, confirmCharId: 'other' } }, deps(db)), { code: 'invalid-argument' });
    assert.equal(db.documents.size, 1);
});

test('migrateFiche valide empreinte, sauvegarde la source et marque schema/history dans une transaction', async () => {
    const source = { data: { xpLog: [{ kind: 'gain', montant: 55 }] }, revision: 7, updatedAt: 'legacy-time' };
    const db = fakeDb({ 'fiches/test': source });
    const sourceFingerprint = (await migrateFicheDocument(source, { charId: 'test' })).report.sourceFingerprint;
    const result = await migrateFicheCallable(adminRequest({
        charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: sourceFingerprint,
    }), deps(db));

    assert.deepEqual(result, { charId: 'test', sourceFingerprint, schemaVersion: 2, revision: 7, status: 'migrated' });
    const hash = sourceFingerprint;
    const migrated = db.documents.get('fiches/test');
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.revision, 7);
    assert.equal(migrated.migration.sourceFingerprint, sourceFingerprint);
    assert.equal(migrated.updatedAt, 'SERVER_TIMESTAMP');
    assert.deepEqual(db.documents.get(`fiches/test/migration_backups/${hash}`).sourceDocument, source);
    assert.equal(db.documents.get(`fiches/test/history/migration_${hash}`).type, 'migration');

    const retry = await migrateFicheCallable(adminRequest({
        charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: sourceFingerprint,
    }), deps(db));
    assert.equal(retry.status, 'already-migrated');
    assert.equal(db.documents.size, 3);
});

test('migrateFiche refuse une empreinte périmée ou une source bloquée sans écrire', async () => {
    const db = fakeDb({ 'fiches/test': { data: { xpLog: null }, revision: 3 } });
    const fakeFingerprint = 'a'.repeat(64);
    await assert.rejects(migrateFicheCallable(adminRequest({
        charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: fakeFingerprint,
    }), deps(db)), error => error.code === 'failed-precondition' && error.details.kind === 'migration-blocked');
    assert.equal(db.documents.size, 1);

    const validLegacy = { data: {}, revision: 3 };
    db.documents.set('fiches/test', validLegacy);
    const staleHash = 'b'.repeat(64);
    await assert.rejects(migrateFicheCallable(adminRequest({
        charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: staleHash,
    }), deps(db)), error => error.code === 'aborted' && error.details.kind === 'source-changed');
    assert.equal(db.documents.size, 1);
});

test('un marqueur V2 valide reste idempotent après édition, mais un marqueur corrompu est refusé', async () => {
    const legacy = { data: { skillsAdvanced: [] }, revision: 4 };
    const sourceFingerprint = (await migrateFicheDocument(legacy, { charId: 'test' })).report.sourceFingerprint;
    const migrated = await migrateFicheDocument(legacy, { charId: 'test' });
    const edited = structuredClone(migrated.document);
    edited.data.nom = 'État V2 édité';
    const db = fakeDb({ 'fiches/test': edited });
    const command = { charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: sourceFingerprint };
    const result = await migrateFicheCallable(adminRequest(command), deps(db));
    assert.equal(result.status, 'already-migrated');

    const corrupt = structuredClone(edited);
    corrupt.revision = -1;
    db.documents.set('fiches/test', corrupt);
    await assert.rejects(migrateFicheCallable(adminRequest(command), deps(db)), error => (
        error.code === 'failed-precondition' && error.details.report.blocked.includes('revision:revision-invalid')
    ));
    assert.deepEqual(db.documents.get('fiches/test'), corrupt);
});

test('une enveloppe trop volumineuse ne crée ni sauvegarde ni marqueur', async () => {
    const source = { data: { possessions: 'x'.repeat(910 * 1024) }, revision: 2 };
    const db = fakeDb({ 'fiches/test': source });
    const sourceFingerprint = (await migrateFicheDocument(source, { charId: 'test' })).report.sourceFingerprint;
    await assert.rejects(migrateFicheCallable(adminRequest({
        charId: 'test', confirmCharId: 'test', expectedSourceFingerprint: sourceFingerprint,
    }), deps(db)), error => error.code === 'resource-exhausted' && error.details.kind === 'backup-too-large');
    assert.equal(db.documents.size, 1);
});

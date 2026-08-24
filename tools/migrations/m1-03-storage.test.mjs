import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayRemove, deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { createAdminClient } from '../mobile-backup.mjs';
import { hasDownloadToken, runMigration } from './m1-03-storage.mjs';

const project = process.env.M1_TEST_PROJECT ?? 'demo-m1-03';
const host = process.env.FIRESTORE_EMULATOR_HOST && (process.env.STORAGE_EMULATOR_HOST || process.env.FIREBASE_STORAGE_EMULATOR_HOST);
const skip = !host;
let env;

test('Storage M1-03: propriétaire, visibilité, identité vérifiée et contraintes de fichier', { skip }, async () => {
    env = await initializeTestEnvironment({
        projectId: project,
        firestore: { rules: await readFile(resolve('firestore.rules'), 'utf8') },
        storage: { rules: await readFile(resolve('storage.rules'), 'utf8') },
    });
    await env.withSecurityRulesDisabled(async context => {
        const firestore = context.firestore();
        await firestore.doc('pnjs/public').set({ visibleJoueurs: true });
        await firestore.doc('pnjs/hidden').set({ visibleJoueurs: false });
        await firestore.doc('indices/discovered').set({ decouvert: true });
        await firestore.doc('indices/secret').set({ decouvert: false });
        await context.storage().ref('portraits/public/p.png').put(Buffer.from('png'), { contentType: 'image/png' });
        await context.storage().ref('portraits/public/delete.png').put(Buffer.from('png'), { contentType: 'image/png' });
        await context.storage().ref('portraits/hidden/h.png').put(Buffer.from('png'), { contentType: 'image/png' });
        await context.storage().ref('indices/discovered/i.png').put(Buffer.from('png'), { contentType: 'image/png' });
        await context.storage().ref('indices/discovered/delete.jpg').put(Buffer.from('jpg'), { contentType: 'image/jpeg' });
        await context.storage().ref('indices/secret/s.png').put(Buffer.from('png'), { contentType: 'image/png' });
        await context.storage().ref('portraits/legacy.png').put(Buffer.from('png'), { contentType: 'image/png' });
    });
    const visitor = env.unauthenticatedContext();
    await assertSucceeds(visitor.storage().ref('portraits/public/p.png').getMetadata());
    await assertFails(visitor.storage().ref('portraits/hidden/h.png').getMetadata());
    await assertSucceeds(visitor.storage().ref('indices/discovered/i.png').getMetadata());
    await assertFails(visitor.storage().ref('indices/secret/s.png').getMetadata());
    await assertFails(visitor.storage().ref('portraits/missing/m.png').getMetadata());
    await assertFails(visitor.storage().ref('portraits/legacy.png').getMetadata());
    const player = env.authenticatedContext('player', { email: 'joueur@example.test', email_verified: true });
    await assertSucceeds(player.storage().ref('portraits/public/p.png').getMetadata());
    await assertFails(player.storage().ref('portraits/hidden/h.png').getMetadata());

    const unverified = env.authenticatedContext('unverified', { email: 'ethoril@gmail.com', email_verified: false });
    const verified = env.authenticatedContext('gm', { email: 'ethoril@gmail.com', email_verified: true });
    await assertFails(unverified.storage().ref('indices/secret/s.png').getMetadata());
    await assertSucceeds(verified.storage().ref('indices/secret/s.png').getMetadata());
    await assertSucceeds(verified.storage().ref('portraits/legacy.png').getMetadata());
    await assertFails(verified.storage().ref('portraits/legacy-new.png').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('portraits/legacy.png').put(Buffer.from('replacement'), { contentType: 'image/png' }));
    await assertSucceeds(verified.storage().ref('portraits/legacy.png').delete());
    await assertFails(unverified.storage().ref('portraits/public/new.png').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assertFails(unverified.storage().ref('portraits/public/new.png').delete());
    await assertFails(player.storage().ref('portraits/public/player.png').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assertFails(player.storage().ref('portraits/public/p.png').delete());
    await assertFails(verified.storage().ref('portraits/public/bad.svg').put(Buffer.from('x'), { contentType: 'image/svg+xml' }));
    await assertFails(verified.storage().ref('portraits/public/bad.txt').put(Buffer.from('x'), { contentType: 'text/plain' }));
    await assertFails(verified.storage().ref('portraits/public/mismatch.txt').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('portraits/public/bad name.png').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('portraits/public/empty.png').put(Buffer.alloc(0), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('portraits/public/too-large.png').put(Buffer.alloc(2 * 1024 * 1024 + 1), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('portraits/public/direct.png').put(Buffer.from('x'), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('indices/discovered/new.jpg').put(Buffer.from('x'), { contentType: 'image/jpeg' }));
    await assertFails(verified.storage().ref('indices/discovered/too-large.png').put(Buffer.alloc(5 * 1024 * 1024 + 1), { contentType: 'image/png' }));
    await assertFails(verified.storage().ref('indices/discovered/i.png').put(Buffer.from('updated'), { contentType: 'image/png' }));
    await assertSucceeds(verified.storage().ref('indices/discovered/delete.jpg').delete());
    await assertSucceeds(verified.storage().ref('portraits/public/delete.png').delete());

    await env.withSecurityRulesDisabled(async context => {
        await context.firestore().doc('pnjs/public').update({ visibleJoueurs: false });
    });
    await assertFails(visitor.storage().ref('portraits/public/p.png').getMetadata());
    await env.withSecurityRulesDisabled(async context => {
        await context.firestore().doc('pnjs/public').update({ visibleJoueurs: true });
    });
    await assertSucceeds(visitor.storage().ref('portraits/public/p.png').getMetadata());
    await env.withSecurityRulesDisabled(async context => {
        await context.firestore().doc('indices/discovered').update({ decouvert: false });
    });
    await assertFails(visitor.storage().ref('indices/discovered/i.png').getMetadata());
    await env.withSecurityRulesDisabled(async context => {
        await context.firestore().doc('indices/discovered').update({ decouvert: true });
    });
    await assertSucceeds(visitor.storage().ref('indices/discovered/i.png').getMetadata());
});

test('Firestore M1-03: imageUrl legacy ne peut plus être créé ou modifié', { skip }, async () => {
    const gmDb = env.authenticatedContext('gm-firestore', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
    const owner = doc(gmDb, 'pnjs', 'image-contract');
    await assertSucceeds(setDoc(owner, {
        nom: 'Image contract', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(gmDb, 'pnjs', 'legacy-create'), {
        nom: 'Legacy create', visibleJoueurs: true, imageUrl: 'portraits/legacy.png', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(owner, { imagePath: 'portraits/another-owner/file.png', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(owner, { imagePath: 'portraits/image-contract/new.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(owner, { imageUrl: 'portraits/legacy.png', updatedAt: serverTimestamp() }));
    const indice = doc(gmDb, 'indices', 'image-contract');
    await assertSucceeds(setDoc(indice, { titre: 'Indice image', decouvert: true, pnjsLies: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(gmDb, 'indices', 'legacy-create'), {
        titre: 'Indice legacy', decouvert: true, pnjsLies: [], imageUrl: 'indices/legacy.png', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(indice, { imagePath: 'portraits/image-contract/wrong.png', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(indice, { imagePath: 'indices/image-contract/clue.png', updatedAt: serverTimestamp() }));
});

test('Firestore M1-03: une URL legacy existante reste stable ou peut être supprimée', { skip }, async () => {
    const gmDb = env.authenticatedContext('gm-firestore-legacy', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
    await env.withSecurityRulesDisabled(async context => {
        await context.firestore().doc('pnjs/legacy-existing').set({ nom: 'Legacy PNJ', visibleJoueurs: true,
            imageUrl: 'portraits/legacy-existing.png', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await context.firestore().doc('indices/legacy-existing').set({ titre: 'Legacy indice', decouvert: true, pnjsLies: [],
            imageUrl: 'indices/legacy-existing.png', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
    await assertSucceeds(updateDoc(doc(gmDb, 'pnjs', 'legacy-existing'), { nom: 'Legacy PNJ renommé', imageUrl: 'portraits/legacy-existing.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(gmDb, 'pnjs', 'legacy-existing'), { imageUrl: 'portraits/changed.png', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(gmDb, 'pnjs', 'legacy-existing'), { imageUrl: deleteField(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(gmDb, 'indices', 'legacy-existing'), { titre: 'Legacy indice renommé', imageUrl: 'indices/legacy-existing.png', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(gmDb, 'indices', 'legacy-existing'), { imageUrl: 'indices/changed.png', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(gmDb, 'indices', 'legacy-existing'), { imageUrl: deleteField(), updatedAt: serverTimestamp() }));
});

test('Firestore M1-04: le verrou PNJ bloque les écritures concurrentes et les demi-relations', { skip }, async () => {
    const gmDb = env.authenticatedContext('gm-integrity', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
    const pnj = id => doc(gmDb, 'pnjs', id);
    for (const id of ['lock-source', 'active-a', 'active-b']) {
        await assertSucceeds(setDoc(pnj(id), {
            nom: id, visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        }));
    }
    await assertSucceeds(setDoc(doc(gmDb, 'pnjs_prives', 'lock-source'), {
        notes: 'privé', updatedAt: serverTimestamp(),
    }));
    const linkedIndice = doc(gmDb, 'indices', 'locked-index');
    await assertSucceeds(setDoc(linkedIndice, {
        titre: 'Indice verrouillé', decouvert: true, pnjsLies: ['lock-source', 'active-a'],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(pnj('lock-source'), {
        suppressionEnCours: true, updatedAt: serverTimestamp(),
    }));
    const lockRef = doc(gmDb, 'integrity_locks', 'pnj-deletion');
    const startDeletion = writeBatch(gmDb);
    startDeletion.set(lockRef, {
        pnjId: 'lock-source', imagePaths: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    startDeletion.update(pnj('lock-source'), {
        suppressionEnCours: true, updatedAt: serverTimestamp(),
    });
    await assertSucceeds(startDeletion.commit());
    await assertFails(updateDoc(pnj('lock-source'), { nom: 'trop tard', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(pnj('active-a'), { nom: 'bloqué pendant la cascade', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(gmDb, 'pnjs_prives', 'lock-source'), {
        notes: 'trop tard', updatedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(gmDb, 'indices', 'late-index'), {
        titre: 'Trop tard', decouvert: true, pnjsLies: ['lock-source'],
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(linkedIndice, {
        titre: 'Écriture ancienne concurrente', updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(linkedIndice, {
        pnjsLies: arrayRemove('lock-source'), updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(pnj('active-a'), {
        suppressionEnCours: true, updatedAt: serverTimestamp(),
    }));
    const relation = (source, cible) => ({
        source, cible, type: 'allié', label: 'Allié', color: '#fff', style: 'solid',
        visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await assertFails(setDoc(doc(gmDb, 'relations', 'toward-lock'), relation('active-a', 'lock-source')));
    await assertFails(setDoc(doc(gmDb, 'relations', 'self'), relation('active-a', 'active-a')));
    const batch = writeBatch(gmDb);
    const first = doc(gmDb, 'relations', 'atomic-first');
    batch.set(first, relation('active-a', 'active-b'));
    batch.set(doc(gmDb, 'relations', 'atomic-invalid'), relation('active-a', 'missing'));
    await assertFails(batch.commit());
    assert.equal((await getDoc(first)).exists(), false);
    const finishDeletion = writeBatch(gmDb);
    finishDeletion.delete(doc(gmDb, 'pnjs_prives', 'lock-source'));
    finishDeletion.delete(pnj('lock-source'));
    finishDeletion.delete(lockRef);
    await assertSucceeds(finishDeletion.commit());
    assert.equal((await getDoc(pnj('lock-source'))).exists(), false);
    assert.equal((await getDoc(lockRef)).exists(), false);
    await assertSucceeds(updateDoc(pnj('active-a'), { nom: 'déverrouillé', updatedAt: serverTimestamp() }));
});

test('Migration M1-03: copy, référence, cleanup et reprise sont atomiques et sans token', { skip }, async () => {
    // Projet d’émulateur séparé : les fixtures de règles ont volontairement
    // une imagePath sans objet, ce qui doit bloquer une migration réelle.
    const projectId = `${project}-migration`;
    const bucketName = `${projectId}.appspot.com`;
    const admin = await createAdminClient({ project: projectId, bucket: bucketName });
    const stateDir = await mkdtemp(join(tmpdir(), 'm1-03-integration-'));
    const statePath = join(stateDir, 'state.json');
    const legacyPath = 'portraits/m1-03-integration.png';
    const nestedPath = 'portraits/migration-e2e/nested.png';
    const concurrentPath = 'portraits/m1-03-concurrent.png';
    try {
        const content = Buffer.from('migration-payload');
        await admin.bucket.file(legacyPath).save(content, { resumable: false, metadata: {
            contentType: 'image/png', metadata: { firebaseStorageDownloadTokens: 'legacy-token' },
        } });
        await admin.bucket.file(nestedPath).save(content, { resumable: false, metadata: { contentType: 'image/png' } });
        await admin.db.collection('pnjs').doc('migration-e2e').set({ nom: 'Migration', visibleJoueurs: true, imageUrl: legacyPath });

        const common = { project: projectId, bucket: bucketName, execute: true, state: statePath };
        await runMigration({ ...common, phase: 'copy-verify' });
        const targetPath = 'portraits/migration-e2e/m1-03-integration.png';
        const [targetMetadata] = await admin.bucket.file(targetPath).getMetadata();
        assert.equal(hasDownloadToken(targetMetadata), false);
        assert.ok((await admin.bucket.file(legacyPath).exists())[0]);
        await runMigration({ ...common, phase: 'reference' });
        const referenced = (await admin.db.collection('pnjs').doc('migration-e2e').get()).data();
        assert.equal(referenced.imagePath, targetPath);
        assert.equal(referenced.imageUrl, legacyPath);
        await runMigration({ ...common, phase: 'cleanup', confirmCleanup: projectId });
        const cleaned = (await admin.db.collection('pnjs').doc('migration-e2e').get()).data();
        assert.equal(cleaned.imagePath, targetPath);
        assert.equal(Object.hasOwn(cleaned, 'imageUrl'), false);
        assert.equal((await admin.bucket.file(legacyPath).exists())[0], false);
        assert.equal((await admin.bucket.file(targetPath).exists())[0], true);
        await admin.bucket.file(targetPath).save(Buffer.from('tampered'), { resumable: false, metadata: { contentType: 'image/png', cacheControl: 'no-store' } });
        await assert.rejects(runMigration({ ...common, phase: 'cleanup', confirmCleanup: projectId }), /destination modifiée/u);
        await admin.bucket.file(targetPath).save(content, { resumable: false, metadata: { contentType: 'image/png', cacheControl: 'no-store' } });
        await runMigration({ ...common, phase: 'cleanup', confirmCleanup: projectId });
        assert.equal((await admin.bucket.file(targetPath).exists())[0], true);
        assert.equal((await admin.bucket.file(nestedPath).exists())[0], true);

        await admin.bucket.file(concurrentPath).save(content, { resumable: false, metadata: { contentType: 'image/png' } });
        await admin.db.collection('pnjs').doc('migration-concurrent').set({ nom: 'Concurrent', visibleJoueurs: true, imageUrl: concurrentPath });
        const concurrentState = join(stateDir, 'concurrent.json');
        const concurrent = { project: projectId, bucket: bucketName, execute: true, state: concurrentState };
        await runMigration({ ...concurrent, phase: 'copy-verify' });
        // Même une représentation canonique équivalente modifie la valeur brute
        // : l’empreinte d’état la refuse pour éviter une course silencieuse.
        await admin.db.collection('pnjs').doc('migration-concurrent').update({ imageUrl: `gs://${bucketName}/${concurrentPath}` });
        await assert.rejects(runMigration({ ...concurrent, phase: 'reference' }), /état de reprise incompatible/u);
        await admin.db.collection('pnjs').doc('migration-concurrent').update({ imageUrl: concurrentPath });
        await runMigration({ ...concurrent, phase: 'reference' });

        const pathChange = 'portraits/m1-03-path-change.png';
        await admin.bucket.file(pathChange).save(content, { resumable: false, metadata: { contentType: 'image/png' } });
        await admin.db.collection('pnjs').doc('migration-path-change').set({ nom: 'Path change', visibleJoueurs: true, imageUrl: pathChange });
        const pathState = join(stateDir, 'path-change.json');
        const pathOptions = { project: projectId, bucket: bucketName, execute: true, state: pathState };
        await runMigration({ ...pathOptions, phase: 'copy-verify' });
        await admin.db.collection('pnjs').doc('migration-path-change').update({ imageUrl: 'portraits/m1-03-other-path.png' });
        await assert.rejects(runMigration({ ...pathOptions, phase: 'reference' }), /état de reprise incompatible/u);
    } finally {
        await admin.app.delete();
        await rm(stateDir, { recursive: true, force: true });
    }
});

test.after(async () => { if (env) await env.cleanup(); });

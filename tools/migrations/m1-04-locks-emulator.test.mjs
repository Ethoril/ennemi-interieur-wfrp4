import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
    collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.M1_TEST_PROJECT ?? 'demo-m1-04-locks';
const emulatorReady = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
let env;

before(async () => {
    if (!emulatorReady) return;
    env = await initializeTestEnvironment({
        projectId: project,
        firestore: { rules: await readFile(resolve(root, 'firestore.rules'), 'utf8') },
    });
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        for (const id of ['locked', 'img-owner', 'other-owner']) {
            await deleteDoc(doc(db, 'pnjs', id));
        }
        await deleteDoc(doc(db, 'integrity_locks', 'pnj-deletion'));
        for (const ownerId of ['img-owner', 'other-owner']) {
            await deleteDoc(doc(db, 'integrity_locks', 'images', 'pnjs', ownerId));
        }
        await setDoc(doc(db, 'pnjs', 'locked'), {
            nom: 'Verrouillé', visibleJoueurs: true, description: '',
            imagePath: 'portraits/locked/portrait.webp',
        });
        await setDoc(doc(db, 'pnjs', 'img-owner'), {
            nom: 'Image', visibleJoueurs: true, description: '',
            imagePath: 'portraits/img-owner/portrait.webp',
        });
        await setDoc(doc(db, 'pnjs', 'other-owner'), {
            nom: 'Autre', visibleJoueurs: true, description: '',
            imagePath: 'portraits/other-owner/portrait.webp',
        });
    });
});

after(async () => { if (env) await env.cleanup(); });

function gmDb() {
    return env.authenticatedContext('gm', {
        email: 'ethoril@gmail.com', email_verified: true,
    }).firestore();
}

async function denied(operation) {
    await assert.rejects(operation, error => error?.code === 'permission-denied');
}

function secured(name, fn) {
    return test(name, { skip: !emulatorReady }, fn);
}

secured('le verrou PNJ persiste après le batch final et bloque la recréation', async () => {
    const db = gmDb();
    const lockRef = doc(db, 'integrity_locks', 'pnj-deletion');
    await runTransaction(db, async transaction => {
        const lock = await transaction.get(lockRef);
        const pnj = await transaction.get(doc(db, 'pnjs', 'locked'));
        assert.equal(lock.exists(), false);
        assert.equal(pnj.exists(), true);
        transaction.update(doc(db, 'pnjs', 'locked'), { suppressionEnCours: true, updatedAt: serverTimestamp() });
        transaction.set(lockRef, {
            pnjId: 'locked', imagePaths: ['portraits/locked/portrait.webp'],
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
    });
    const finalBatch = writeBatch(db);
    finalBatch.delete(doc(db, 'pnjs', 'locked'));
    await finalBatch.commit();
    assert.equal((await getDoc(lockRef)).exists(), true);
    await denied(setDoc(doc(db, 'pnjs', 'locked'), {
        nom: 'Recréation', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await deleteDoc(lockRef);
    await setDoc(doc(db, 'pnjs', 'locked'), {
        nom: 'Recréation', visibleJoueurs: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
});

secured('le verrou image bloque imagePath, autorise texte et se libère proprement', async () => {
    const db = gmDb();
    const lockRef = doc(db, 'integrity_locks', 'images', 'pnjs', 'img-owner');
    await setDoc(lockRef, {
        ownerCollection: 'pnjs', ownerId: 'img-owner', path: 'portraits/img-owner/portrait.webp',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'pnjs', 'img-owner'), { description: 'texte autorisé', updatedAt: serverTimestamp() });
    await denied(updateDoc(doc(db, 'pnjs', 'img-owner'), {
        imagePath: 'portraits/img-owner/autre.webp', updatedAt: serverTimestamp(),
    }));
    await denied(setDoc(doc(db, 'integrity_locks', 'images', 'pnjs', 'other-owner'), {
        ownerCollection: 'pnjs', ownerId: 'other-owner', path: 'portraits/img-owner/portrait.webp',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await denied(setDoc(doc(db, 'integrity_locks', 'images', 'pnjs', 'bad.owner'), {
        ownerCollection: 'pnjs', ownerId: 'bad.owner', path: 'portraits/bad.owner/portrait.webp',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await deleteDoc(lockRef);
    await updateDoc(doc(db, 'pnjs', 'img-owner'), {
        imagePath: 'portraits/img-owner/autre.webp', updatedAt: serverTimestamp(),
    });
    assert.equal((await getDocs(collection(db, 'pnjs'))).size >= 2, true);
});

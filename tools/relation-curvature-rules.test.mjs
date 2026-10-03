import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, Timestamp } from 'firebase/firestore';

const project = 'demo-relation-curvature';
let env;
let player;
let gm;

before(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '').split(':');
    if (!host || !port) throw new Error('Ce test exige un émulateur Firestore local.');
    env = await initializeTestEnvironment({ projectId: project, firestore: {
        host, port: Number(port), rules: await readFile(resolve('firestore.rules'), 'utf8'),
    } });
    gm = env.authenticatedContext('gm', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
    player = env.authenticatedContext('player', { email: 'player@example.test', email_verified: true }).firestore();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, 'pnjs', 'a'), { nom: 'Ada', visibleJoueurs: true });
        await setDoc(doc(db, 'pnjs', 'b'), { nom: 'Bob', visibleJoueurs: true });
        await setDoc(doc(db, 'pnjs', 'hidden'), { nom: 'Secret', visibleJoueurs: false });
        const data = { source: 'a', cible: 'b', type: 'allié', label: 'allié', visibleJoueurs: true, curvature: null };
        await setDoc(doc(db, 'relations', 'public'), data);
        await setDoc(doc(db, 'relations', 'hidden'), { ...data, cible: 'hidden', visibleJoueurs: false });
    });
});

after(async () => { if (env) await env.cleanup(); });

test('un joueur peut modifier seulement la courbure bornée d’une relation publique', async () => {
    await updateDoc(doc(gm, 'relations', 'public'), { curvature: 1, updatedAt: serverTimestamp() });
    const target = doc(player, 'relations', 'public');
    await updateDoc(target, { curvature: -6, updatedAt: serverTimestamp() });
    assert.equal((await getDoc(target)).data().curvature, -6);
    await updateDoc(target, { curvature: 6, updatedAt: serverTimestamp() });
    await updateDoc(target, { curvature: null, updatedAt: serverTimestamp() });
    await updateDoc(target, { curvature: 0, updatedAt: serverTimestamp() });
});

test('les modifications de contenu, relations cachées et endpoints révoqués sont refusés', async () => {
    const target = doc(player, 'relations', 'public');
    await assert.rejects(updateDoc(target, { label: 'altéré', curvature: 1, updatedAt: serverTimestamp() }));
    await assert.rejects(updateDoc(doc(player, 'relations', 'hidden'), { curvature: 1, updatedAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(async context => {
        await updateDoc(doc(context.firestore(), 'pnjs', 'b'), { visibleJoueurs: false });
    });
    await assert.rejects(updateDoc(target, { curvature: 2, updatedAt: serverTimestamp() }));
});

test('les bornes, NaN, timestamp client et changement de visibilité sont refusés', async () => {
    const target = doc(player, 'relations', 'public');
    await env.withSecurityRulesDisabled(async context => {
        await updateDoc(doc(context.firestore(), 'pnjs', 'b'), { visibleJoueurs: true });
    });
    for (const curvature of [-6.01, 6.01, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assert.rejects(updateDoc(target, { curvature, updatedAt: serverTimestamp() }));
    }
    await assert.rejects(updateDoc(target, { curvature: 2, updatedAt: Timestamp.fromMillis(1) }));
    await assert.rejects(updateDoc(target, { curvature: 2, visibleJoueurs: false, updatedAt: serverTimestamp() }));
    await assert.rejects(updateDoc(doc(player, 'relations', 'missing'), { curvature: 2, updatedAt: serverTimestamp() }));
    await assert.rejects(updateDoc(doc(gm, 'relations', 'public'), { curvature: 7, updatedAt: serverTimestamp() }));
});

test('un visiteur partage le tracé sans pouvoir créer, supprimer ni toucher les fiches', async () => {
    const guest = env.unauthenticatedContext().firestore();
    const target = doc(guest, 'relations', 'public');
    await updateDoc(target, { curvature: 1.25, updatedAt: serverTimestamp() });
    assert.equal((await getDoc(target)).data().curvature, 1.25);
    await assert.rejects(deleteDoc(target));
    await assert.rejects(setDoc(doc(guest, 'relations', 'new'), {
        source: 'a', cible: 'b', type: 'allié', visibleJoueurs: true,
        curvature: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await assert.rejects(updateDoc(doc(guest, 'pnjs', 'a'), { nom: 'Altéré', updatedAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(async context => {
        await updateDoc(doc(context.firestore(), 'pnjs', 'b'), { suppressionEnCours: true });
    });
    await assert.rejects(updateDoc(target, { curvature: 2, updatedAt: serverTimestamp() }));
});

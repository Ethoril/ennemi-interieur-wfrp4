import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp, setLogLevel } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(localhost|127\.0\.0\.1):\d+$/u.test(host)) throw new Error('Ce test exige un émulateur Firestore local.');
const [hostname, port] = host.split(':');
setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-carnaval', firestore: {
    host: hostname, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
} });
const gm = env.authenticatedContext('gm', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
const player = env.authenticatedContext('player', { email: 'joueur@example.test', email_verified: true }).firestore();
const unverified = env.authenticatedContext('unverified', { email: 'ethoril@gmail.com', email_verified: false }).firestore();
const guest = env.unauthenticatedContext().firestore();
const pnj = db => doc(db, 'pnjs', 'groupes');
const hiddenPnj = db => doc(db, 'pnjs', 'hidden');
const payload = overrides => ({ nom: 'PNJ', visibleJoueurs: true, groupe: 'Guilde', groupes: ['Guilde', 'École'], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides });

try {
    await test('le MJ peut écrire une liste cohérente bornée et les joueurs gardent la visibilité existante', async () => {
        await assertSucceeds(setDoc(pnj(gm), payload({})));
        const twentyGroups = Array.from({ length: 20 }, (_, index) => `Groupe ${index}`);
        await assertSucceeds(setDoc(doc(gm, 'pnjs', 'twenty'), payload({ groupes: twentyGroups, groupe: twentyGroups[0] })));
        await assertSucceeds(setDoc(hiddenPnj(gm), payload({ visibleJoueurs: false })));
        await assertSucceeds(getDoc(pnj(player)));
        await assertSucceeds(getDoc(pnj(guest)));
        await assertSucceeds(updateDoc(pnj(gm), { groupes: [], groupe: '', updatedAt: serverTimestamp() }));
        await assertSucceeds(getDoc(hiddenPnj(gm)));
        await assertFails(getDoc(hiddenPnj(player)));
        await assertFails(getDoc(hiddenPnj(guest)));
    });

    await test('les listes malformées, hors limites ou sans miroir cohérent sont refusées', async () => {
        await assertFails(setDoc(pnj(gm), payload({ groupes: 'Guilde' })));
        await assertFails(setDoc(pnj(gm), payload({ groupes: Array(21).fill('G') })));
        await assertFails(setDoc(pnj(gm), payload({ groupes: [''] })));
        await assertFails(setDoc(pnj(gm), payload({ groupes: [...Array(19).fill('G'), 1] })));
        await assertFails(setDoc(pnj(gm), payload({ groupes: ['x'.repeat(201)], groupe: 'x'.repeat(201) })));
        await assertFails(setDoc(pnj(gm), payload({ groupes: ['Guilde'], groupe: 'Autre' })));
        await assertFails(setDoc(pnj(gm), payload({ groupes: ['Guilde'], groupe: 'Guilde', extra: true })));
        await assertFails(setDoc(pnj(player), payload({})));
        await assertFails(setDoc(doc(unverified, 'pnjs', 'unverified'), payload({})));
        await assertFails(setDoc(doc(guest, 'pnjs', 'guest'), payload({})));
    });
} finally { await env.cleanup(); }

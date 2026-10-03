import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, Timestamp, runTransaction, onSnapshot, setLogLevel } from 'firebase/firestore';
import assert from 'node:assert/strict';
import { createCarnavalRepository } from '../js/data/carnaval-repository.js';
import { initialCampaign } from '../js/carnaval-model.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(localhost|127\.0\.0\.1):\d+$/u.test(host)) throw new Error('Ce test exige un émulateur Firestore local.');
const [hostname, port] = host.split(':');
setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-carnaval', firestore: {
    host: hostname, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
} });
const gm = env.authenticatedContext('gm-test', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
const player = env.authenticatedContext('player-test', { email: 'fixture@example.test', email_verified: true }).firestore();
const unverified = env.authenticatedContext('gm-unverified', { email: 'ethoril@gmail.com', email_verified: false }).firestore();
const guest = env.unauthenticatedContext().firestore();
const ref = (db, collection) => doc(db, collection, 'current');
const source = () => ({ version: 1, days: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Jour ${i + 1}` })), places: [], characters: [], events: [], updatedAt: serverTimestamp() });
const campaign = () => ({ version: 1, revision: 0, clock: { day: 1, minute: 480 }, links: {}, overrides: {}, customEvents: [], notes: {}, updatedAt: serverTimestamp() });

try {
    await test('les données Carnaval sont exclusivement MJ vérifié', async () => {
        const batch = writeBatch(gm);
        batch.set(ref(gm, 'carnaval_sources'), source());
        batch.set(ref(gm, 'carnaval_campaigns'), campaign());
        await assertSucceeds(batch.commit());
        for (const collection of ['carnaval_sources', 'carnaval_campaigns']) {
            await assertSucceeds(getDoc(ref(gm, collection)));
            for (const db of [guest, player, unverified]) {
                await assertFails(getDoc(ref(db, collection)));
                await assertFails(setDoc(ref(db, collection), collection === 'carnaval_sources' ? source() : campaign()));
            }
        }
    });
    await test('la source est immuable, même pour le MJ', async () => {
        await assertFails(updateDoc(ref(gm, 'carnaval_sources'), { events: [], updatedAt: serverTimestamp() }));
        await assertFails(deleteDoc(ref(gm, 'carnaval_sources')));
        await assertFails(setDoc(doc(gm, 'carnaval_sources', 'other'), source()));
    });
    await test('les révisions, horaires, clés et timestamps sont contrôlés côté serveur', async () => {
        const target = ref(gm, 'carnaval_campaigns');
        await assertFails(updateDoc(target, { revision: 0, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(target, { revision: 2, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(target, { revision: 1, clock: { day: 9, minute: 0 }, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(target, { revision: 1, clock: { day: 8, minute: 1801 }, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(target, { revision: 1, extra: 'unexpected', updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(target, { revision: 1, updatedAt: Timestamp.fromMillis(1) }));
        await assertSucceeds(updateDoc(target, { revision: 1, clock: { day: 8, minute: 1440 }, updatedAt: serverTimestamp() }));
        await assertFails(updateDoc(target, { revision: 1, updatedAt: serverTimestamp() }));
        await assertFails(deleteDoc(target));
    });
    await test('le dépôt réel importe une seule fois et protège deux sessions concurrentes', async () => {
        await env.clearFirestore();
        const sdk = { doc, serverTimestamp, runTransaction, onSnapshot };
        const repository = createCarnavalRepository({ sdk, client: { db: gm, isGM: true } });
        try {
            const fixture = source(); delete fixture.updatedAt;
            await repository.importSource(fixture);
            await assert.rejects(repository.importSource(fixture), error => error.code === 'source-exists');
            const writes = [600, 630].map(minute => repository.saveCampaign({ ...initialCampaign(), clock: { day: 2, minute } }, { expectedRevision: 0 }));
            const results = await Promise.allSettled(writes);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            const rejected = results.find(result => result.status === 'rejected');
            assert.equal(rejected.reason.code, 'revision-conflict');
            assert.equal(rejected.reason.latest.revision, 1);
            const saved = (await getDoc(ref(gm, 'carnaval_campaigns'))).data();
            assert.equal(saved.revision, 1);
            assert.ok([600, 630].includes(saved.clock.minute));
        } finally { repository.close(); }
    });
} finally { await env.cleanup(); }

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
    await test('les dossiers PNJ importés ne sont lisibles que par le MJ vérifié', async () => {
        const data = { version: 1, characters: { a: { summary: '<p>Résumé</p>', story: '<p>Secret</p>' } } };
        const dossier = db => doc(db, 'carnaval_sources', 'dossiers');
        await env.withSecurityRulesDisabled(ctx => setDoc(dossier(ctx.firestore()), data));
        assert.deepEqual((await assertSucceeds(getDoc(dossier(gm)))).data(), data);
        for (const db of [guest, player, unverified]) await assertFails(getDoc(dossier(db)));
        for (const db of [gm, player]) {
            await assertFails(setDoc(dossier(db), data));
            await assertFails(deleteDoc(dossier(db)));
        }
    });
    await test('les pistes et déplacements sont privés, avec révision obligatoire pour le MJ', async () => {
        const hints = db => doc(db, 'carnaval_sources', 'locations');
        const movements = db => doc(db, 'carnaval_campaigns', 'locations');
        await env.withSecurityRulesDisabled(ctx => setDoc(hints(ctx.firestore()), { version: 1, hints: [] }));
        const data = { version: 1, revision: 1, movements: [], updatedAt: serverTimestamp() };
        await assertSucceeds(getDoc(hints(gm)));
        await assertFails(setDoc(hints(gm), { version: 1, hints: [] }));
        for (const db of [guest, player, unverified]) {
            await assertFails(getDoc(hints(db)));
            await assertFails(getDoc(movements(db)));
            await assertFails(setDoc(movements(db), data));
        }
        await assertFails(setDoc(movements(gm), { ...data, revision: 2 }));
        await assertSucceeds(setDoc(movements(gm), data));
        await assertSucceeds(getDoc(movements(gm)));
        await assertFails(setDoc(movements(gm), data));
        await assertFails(setDoc(movements(gm), { ...data, revision: 2, movements: Array(301).fill({}) }));
        await assertSucceeds(setDoc(movements(gm), { ...data, revision: 2 }));
        const calendar = { ...source(), characters: [{ id: 'char-a', name: 'Ada', aliases: [] }] };
        await env.withSecurityRulesDisabled(ctx => setDoc(ref(ctx.firestore(), 'carnaval_sources'), calendar));
        const sdk = { doc, serverTimestamp, runTransaction, onSnapshot };
        const repository = createCarnavalRepository({ sdk, client: { db: gm, isGM: true } });
        try {
            const move = { id: 'm1', characterId: 'char-a', day: 1, start: 780, end: 810, place: 'Auberge', note: '' };
            const writes = await Promise.allSettled([
                repository.saveMovements([move], 2),
                repository.saveMovements([{ ...move, place: 'Parc' }], 2),
            ]);
            assert.equal(writes.filter(write => write.status === 'fulfilled').length, 1);
            const rejected = writes.find(write => write.status === 'rejected');
            assert.equal(rejected.reason.code, 'revision-conflict');
            assert.equal(rejected.reason.latest.revision, 3);
        } finally { repository.close(); }
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
    // Champs facultatifs du suivi : lieux perso, porteurs, suivi, présentations (données fictives).
    const liste = n => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));
    const extras = () => ({ customPlaces: liste(2), holders: liste(2), tracking: { a: { etat: 'x' } }, introductions: { b: true } });
    const seedCampaign = async data => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async ctx => { await setDoc(ref(ctx.firestore(), 'carnaval_campaigns'), data); });
    };
    const maj = fields => updateDoc(ref(gm, 'carnaval_campaigns'), { revision: 1, updatedAt: serverTimestamp(), ...fields });
    await test('le MJ ajoute les quatre champs facultatifs au suivi', async () => {
        await seedCampaign(campaign());
        await assertSucceeds(maj(extras()));
    });
    await test('le MJ met toujours à jour un suivi à l\'ancienne forme', async () => {
        await seedCampaign(campaign());
        await assertSucceeds(maj({ clock: { day: 2, minute: 600 } }));
    });
    await test('les champs facultatifs invalides sont refusés au MJ', async () => {
        await seedCampaign(campaign());
        await assertFails(maj({ holders: liste(51) }));
        await assertFails(maj({ customPlaces: liste(51) }));
        await assertFails(maj({ holders: { a: 1 } }));
        await assertFails(maj({ customPlaces: 'x' }));
        await assertFails(maj({ tracking: [] }));
        await assertFails(maj({ introductions: [] }));
        await assertFails(maj({ tracking: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, 1])) }));
        await assertFails(maj({ introductions: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, 1])) }));
        await assertFails(maj({ ...extras(), inconnu: 1 }));
    });
    await test('un suivi portant ces champs reste fermé aux non-MJ', async () => {
        await seedCampaign({ ...campaign(), ...extras() });
        for (const db of [guest, player, unverified]) {
            await assertFails(getDoc(ref(db, 'carnaval_campaigns')));
            await assertFails(setDoc(ref(db, 'carnaval_campaigns'), { ...campaign(), ...extras() }));
            await assertFails(updateDoc(ref(db, 'carnaval_campaigns'), { revision: 1, ...extras(), updatedAt: serverTimestamp() }));
        }
    });
} finally { await env.cleanup(); }

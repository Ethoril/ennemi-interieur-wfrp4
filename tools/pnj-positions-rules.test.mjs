import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, documentId, getDoc, getDocs, query, serverTimestamp, setDoc, setLogLevel, Timestamp, where } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(localhost|127\.0\.0\.1):\d+$/u.test(host)) throw new Error('Ce test exige un émulateur Firestore local.');
const [hostname, port] = host.split(':');
setLogLevel('silent');
const env = await initializeTestEnvironment({ projectId: 'demo-carnaval', firestore: {
    host: hostname, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
} });
const gm = env.authenticatedContext('gm', { email: 'ethoril@gmail.com', email_verified: true }).firestore();
const player = env.authenticatedContext('player', { email: 'player@example.test', email_verified: true }).firestore();
const guest = env.unauthenticatedContext().firestore();
const position = (db, id) => doc(db, 'pnj_positions', id);
const pnj = (db, id) => doc(db, 'pnjs', id);
const point = (x = 120, y = -30, updatedAt = serverTimestamp()) => ({ x, y, updatedAt });
const chunks = (ids, size) => Array.from({ length: Math.ceil(ids.length / size) }, (_, index) => ids.slice(index * size, (index + 1) * size));

try {
    await test('les positions restent séparées et joueurs ou invités peuvent les partager pour un PNJ visible', async () => {
        await env.withSecurityRulesDisabled(async context => {
            await setDoc(pnj(context.firestore(), 'visible'), { nom: 'Visible', visibleJoueurs: true });
            await setDoc(pnj(context.firestore(), 'hidden'), { nom: 'Secret', visibleJoueurs: false });
        });
        await assertSucceeds(setDoc(position(player, 'visible'), point()));
        await assertSucceeds(getDoc(position(guest, 'visible')));
        await assertSucceeds(setDoc(position(guest, 'visible'), point(200, 400)));
        await assertSucceeds(getDoc(position(gm, 'visible')));
        await assertFails(getDoc(position(player, 'hidden')));
        await assertFails(setDoc(position(player, 'hidden'), point()));
        await assertFails(setDoc(position(guest, 'unknown'), point()));
        await assertSucceeds(setDoc(position(gm, 'hidden'), point(-1000000, 1000000)));
        await assertFails(setDoc(position(gm, 'unknown'), point()));
    });

    await test('les documents refusent coordonnées invalides, champs supplémentaires et horodatages client', async () => {
        await assertFails(setDoc(position(player, 'visible'), point(1000001, 0)));
        await assertFails(setDoc(position(player, 'visible'), point(0, -1000001)));
        await assertFails(setDoc(position(player, 'visible'), point(Number.NaN, 0)));
        await assertFails(setDoc(position(player, 'visible'), { ...point(), nom: 'secret' }));
        await assertFails(setDoc(position(player, 'visible'), { x: 1, y: 2, updatedAt: Timestamp.now() }));
        await assertFails(setDoc(position(player, 'visible'), { x: 1, y: 2, updatedAt: serverTimestamp(), flags: {} }));
    });

    await test('les requêtes publiques par petits groupes ne lisent que les positions des PNJ visibles', async () => {
        const ids = Array.from({ length: 23 }, (_, index) => `query-${index}`);
        await env.withSecurityRulesDisabled(async context => {
            for (const [index, id] of ids.entries()) {
                await setDoc(pnj(context.firestore(), id), {
                    nom: id,
                    visibleJoueurs: index < 21,
                    ...(index === 20 ? { suppressionEnCours: true } : {}),
                });
                await setDoc(position(context.firestore(), id), { x: index, y: index, updatedAt: Timestamp.now() });
            }
            await setDoc(position(context.firestore(), 'orphan'), { x: 1, y: 2, updatedAt: Timestamp.now() });
        });

        // Les règles font un accès au document PNJ pour chaque position : la
        // limite de 10 appels de règles impose des lots plus petits que la
        // limite Firestore de 10 IDs par in-query.
        const batches = chunks(ids.slice(0, 20), 5);
        const visibleRows = [];
        for (const batch of batches) {
            const result = await getDocs(query(collection(player, 'pnj_positions'), where(documentId(), 'in', batch)));
            visibleRows.push(...result.docs.map(snapshot => snapshot.id));
        }
        assert.deepEqual(visibleRows.sort(), ids.slice(0, 20).sort());

        // Un seul ID caché, en suppression, ou orphelin invalide toute la requête.
        for (const badId of ['query-21', 'query-20', 'orphan']) {
            await assertFails(getDocs(query(collection(player, 'pnj_positions'), where(documentId(), 'in', [badId]))));
            await assertFails(getDocs(query(collection(guest, 'pnj_positions'), where(documentId(), 'in', [badId]))));
        }

        // La règle est aussi réévaluée aux écritures après révocation de la visibilité.
        await env.withSecurityRulesDisabled(async context => {
            await setDoc(pnj(context.firestore(), 'query-0'), { nom: 'query-0', visibleJoueurs: false });
        });
        await assertFails(getDoc(position(player, 'query-0')));
        await assertFails(setDoc(position(guest, 'query-0'), point(3, 4)));
        await assertSucceeds(getDoc(position(gm, 'query-0')));
    });
} finally { await env.cleanup(); }

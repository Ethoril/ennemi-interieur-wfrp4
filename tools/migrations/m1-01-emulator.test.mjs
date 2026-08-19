import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue } from 'firebase-admin/firestore';
import { createAdminClient } from '../mobile-backup.mjs';
import { runPhase, validateEmulatorRunner } from './m1-01-visibility.mjs';

const project = process.env.M1_TEST_PROJECT ?? 'demo-m1-01';
const bucket = process.env.M1_TEST_BUCKET ?? `${project}.appspot.com`;
const emulatorErrors = validateEmulatorRunner({ project, bucket });

test('migration M1-01 sur Emulator Suite', { skip: emulatorErrors.length > 0 }, async () => {
    const client = await createAdminClient({ project, bucket });
    const ids = ['m1-01-visible', 'm1-01-hidden', 'm1-01-conflict', 'm1-01-orphan'];
    try {
        await client.db.collection('pnjs').doc(ids[0]).set({
            nom: 'Fixture migration', description: 'description publique', notesMJ: 'note fixture',
        });
        await client.db.collection('pnjs').doc(ids[1]).set({
            nom: 'Fixture masqué', visibleJoueurs: false,
        });
        await client.db.collection('pnjs').doc(ids[2]).set({
            nom: 'Fixture conflit', description: 'description intacte', notes: 42,
        });
        await client.db.collection('relations').doc('m1-01-relation').set({
            source: ids[0], cible: ids[1], type: 'test', label: 'test',
        });
        await client.db.collection('pnjs_prives').doc(ids[3]).set({ notes: 'orphelin fixture' });

        const beforeDryRun = await client.db.collection('pnjs').doc(ids[0]).get();
        const dryRun = await runPhase({ phase: 'prepare', db: client.db, Timestamp: client.Timestamp,
            FieldValue, batchSize: 400, dryRun: true, stateData: { phase: 'prepare', cursors: {} } });
        assert.ok(dryRun.modifies > 0);
        assert.deepEqual((await client.db.collection('pnjs').doc(ids[0]).get()).data(), beforeDryRun.data());

        const state = { phase: 'prepare', cursors: {} };
        const prepare = await runPhase({ phase: 'prepare', db: client.db, Timestamp: client.Timestamp,
            FieldValue, batchSize: 400, dryRun: false, stateData: state });
        assert.equal(prepare.erreurs, 0);
        const prepareSecond = await runPhase({ phase: 'prepare', db: client.db, Timestamp: client.Timestamp,
            FieldValue, batchSize: 400, dryRun: false, stateData: { phase: 'prepare', cursors: {} } });
        assert.equal(prepareSecond.modifies, 0);
        state.phase = 'copy-private';
        state.cursors = {};
        const copy = await runPhase({ phase: 'copy-private', db: client.db, Timestamp: client.Timestamp,
            FieldValue, batchSize: 400, dryRun: false, stateData: state });
        assert.equal(copy.conflits, 1);
        assert.ok(copy.signaux.includes('pnjs_prives/m1-01-orphan:orphelin'));
        const copied = await client.db.collection('pnjs_prives').doc(ids[0]).get();
        assert.equal(copied.data().notes, 'note fixture');
        const copySecond = await runPhase({ phase: 'copy-private', db: client.db, Timestamp: client.Timestamp,
            FieldValue, batchSize: 400, dryRun: false, stateData: { phase: 'copy-private', cursors: {} } });
        assert.equal(copySecond.modifies, 0);
        state.phase = 'cleanup';
        state.cursors = {};
        const cleanup = await runPhase({ phase: 'cleanup', db: client.db, Timestamp: client.Timestamp,
            FieldValue, batchSize: 400, dryRun: false, stateData: state });
        assert.ok(cleanup.erreurs > 0);
        assert.ok(cleanup.conflits > 0);
        const cleaned = await client.db.collection('pnjs').doc(ids[0]).get();
        assert.equal(Object.hasOwn(cleaned.data(), 'notesMJ'), false);
        assert.equal(Object.hasOwn(cleaned.data(), 'description'), true);
        const conflict = await client.db.collection('pnjs').doc(ids[2]).get();
        assert.equal(conflict.data().notes, 42);
    } finally {
        for (const collection of ['pnjs', 'pnjs_prives', 'relations']) {
            const snapshot = await client.db.collection(collection).get();
            await Promise.all(snapshot.docs.filter(document => document.id.startsWith('m1-01-'))
                .map(document => document.ref.delete()));
        }
        await client.app.delete();
    }
});

if (emulatorErrors.length) {
    console.log(`○ Emulator Suite non lancée : ${emulatorErrors.join('; ')}`);
}

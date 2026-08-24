import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    LEGACY_PRIVATE_KEYS,
    MAX_BATCH_SIZE,
    planCleanup,
    planPrivateCopy,
    planPrepare,
    runPhase,
    validateBackupManifest,
    validateTarget,
} from './m1-01-visibility.mjs';
import { visiblePourJoueurs } from '../../js/visibility.js';
import { legacyPrivateNoteInfo, privateLoadCanApply } from '../../js/private-notes.js';
import { isCurrentGeneration, isCurrentLoad, isCurrentPanel } from '../../js/load-generation.js';

const now = { seconds: 1, nanoseconds: 0 };
const Timestamp = { now: () => now };
const DELETE = Symbol('delete');
const FieldValue = { delete: () => DELETE };
const clone = value => JSON.parse(JSON.stringify(value));

function makeDb(initial, { failCommitAt = Infinity, failTransactionAt = Infinity } = {}) {
    const collections = new Map(Object.entries(initial).map(([name, docs]) => [name, new Map(
        docs.map(([id, data]) => [id, clone(data)]),
    )]));
    let commits = 0;
    let transactions = 0;
    let writes = 0;
    const ref = (name, id) => ({
        id,
        __collection: name,
        async delete() {
            collections.get(name)?.delete(id);
        },
        async get() {
            const data = collections.get(name)?.get(id);
            return { exists: data !== undefined, data: () => data, id };
        },
    });
    const collection = name => ({
        async get() {
            const docs = [...(collections.get(name) ?? new Map())].map(([id, data]) => ({ id, ref: ref(name, id), data: () => data }));
            return { docs };
        },
        doc(id) { return ref(name, id); },
    });
    return {
        collection,
        batch() {
            const operations = [];
            return {
                set(target, data) { operations.push(() => {
                    const current = collections.get(target.__collection)?.get(target.id) ?? {};
                    const entry = collections.get(target.__collection) ?? new Map();
                    collections.set(target.__collection, entry);
                    entry.set(target.id, { ...current, ...clone(data) });
                    writes += 1;
                }); },
                update(target, data) { operations.push(() => {
                    const entry = collections.get(target.__collection);
                    const current = entry.get(target.id);
                    for (const [key, value] of Object.entries(data)) {
                        if (value === DELETE) delete current[key]; else current[key] = value;
                    }
                    writes += 1;
                }); },
                async commit() {
                    commits += 1;
                    if (commits === failCommitAt) throw new Error('interruption simulée');
                    operations.forEach(operation => operation());
                },
            };
        },
        async runTransaction(callback) {
            transactions += 1;
            if (transactions === failTransactionAt) {
                failTransactionAt = Infinity;
                throw new Error('interruption transactionnelle simulée');
            }
            const transaction = {
                async getAll(...refs) { return Promise.all(refs.map(item => item.get())); },
                update(target, data) {
                    const entry = collections.get(target.__collection);
                    const current = entry.get(target.id);
                    Object.entries(data).forEach(([key, value]) => value === DELETE ? delete current[key] : current[key] = value);
                    writes += 1;
                },
            };
            return callback(transaction);
        },
        get writes() { return writes; },
        data(name) { return Object.fromEntries(collections.get(name) ?? []); },
    };
}

test('les clés legacy autorisées sont exactement celles du contrat', () => {
    assert.deepEqual(LEGACY_PRIVATE_KEYS, ['notes', 'notesMJ', 'notesPrivees', 'privateNotes']);
});

test('le filtrage visiteur est fail-closed sur les valeurs atypiques', () => {
    assert.equal(visiblePourJoueurs({}), true);
    assert.equal(visiblePourJoueurs({ visibleJoueurs: true }), true);
    assert.equal(visiblePourJoueurs({ visibleJoueurs: false }), false);
    assert.equal(visiblePourJoueurs({ visibleJoueurs: 'true' }), false);
    assert.equal(visiblePourJoueurs({ visibleJoueurs: null }), false);
    assert.equal(visiblePourJoueurs({ visibleJoueurs: true, suppressionEnCours: true }), false);
});

test('les legacy privées contradictoires sont bloquées, les valeurs identiques admises', () => {
    assert.equal(legacyPrivateNoteInfo({ notes: 'x', notesMJ: 'x' }).usable, true);
    assert.equal(legacyPrivateNoteInfo({ notes: 'x', notesMJ: 'y' }).conflict, true);
    assert.equal(legacyPrivateNoteInfo({ notes: 42 }).invalid, true);
});

test('une réponse privée obsolète ne peut pas remplir le formulaire courant', () => {
    assert.equal(privateLoadCanApply(3, 3, true), true);
    assert.equal(privateLoadCanApply(2, 3, true), false);
    assert.equal(privateLoadCanApply(3, 3, false), false);
});

test('une réponse PNJ d une génération précédente est ignorée', () => {
    assert.equal(isCurrentLoad(4, 4), true);
    assert.equal(isCurrentLoad(3, 4), false);
});

test('un panneau accepte uniquement la génération, le PNJ et le rôle courants', () => {
    assert.equal(isCurrentPanel(4, 4, 'p1', 'p1', false, false, true), true);
    assert.equal(isCurrentPanel(3, 4, 'p1', 'p1', false, false, true), false);
    assert.equal(isCurrentPanel(4, 4, 'p1', 'p2', false, false, true), false);
    assert.equal(isCurrentPanel(4, 4, 'p1', 'p1', true, false, true), false);
    assert.equal(isCurrentPanel(4, 4, 'p1', 'p1', false, false, false), false);
});

test('un callback de recadrage obsolète est ignoré', () => {
    assert.equal(isCurrentGeneration(7, 7), true);
    assert.equal(isCurrentGeneration(6, 7), false);
});

test('prepare ajoute les valeurs manquantes sans écraser les valeurs atypiques', () => {
    const result = planPrepare({ visibleJoueurs: 'oui', createdAt: 'ancien' }, now);
    assert.deepEqual(result.updates, { updatedAt: now });
    assert.deepEqual(result.signals, ['visibleJoueurs-non-booléen', 'createdAt-atypique']);
});

test('description publique et clés inconnues ne sont jamais une note', () => {
    assert.equal(planPrivateCopy({ description: 'texte public', noteInterne: 'inconnu' }, null).action, 'none');
    assert.equal(planPrivateCopy({ notesMJ: 'privé' }, null).action, 'copy');
});

test('copy préserve une copie privée et signale les conflits', () => {
    assert.equal(planPrivateCopy({ notes: 'x' }, { notes: 'x', updatedAt: now }).action, 'unchanged');
    assert.equal(planPrivateCopy({ notes: 'x' }, { notes: 'y' }).action, 'conflict');
    assert.equal(planPrivateCopy({ notes: 'x' }, {}).action, 'copy');
    assert.equal(planPrivateCopy({ notes: 'x' }, { updatedAt: now }).needsTimestamp, false);
    assert.equal(planPrivateCopy({ notes: 'x' }, { notes: 'x' }).action, 'touch');
    assert.equal(planPrivateCopy({ notes: 'x', notesMJ: 'y' }, null).action, 'conflict');
    assert.equal(planPrivateCopy({ notes: 42 }, null).action, 'conflict');
    assert.equal(planCleanup({ notes: 42 }, { notes: 42 }).action, 'blocked');
});

test('cleanup est bloqué sans comparaison exacte', () => {
    assert.equal(planCleanup({ notes: 'x' }, null).action, 'blocked');
    assert.equal(planCleanup({ notes: 'x' }, { notes: 'y' }).action, 'blocked');
    assert.equal(planCleanup({ notes: 'x' }, { notes: 'x' }).action, 'delete');
});

test('dry-run ne prépare aucune écriture', async () => {
    const db = makeDb({ pnjs: [['p1', { notes: 'x' }]], relations: [], pnjs_prives: [] });
    const root = await mkdtemp(join(tmpdir(), 'm1-01-dry-'));
    try {
        const result = await runPhase({ phase: 'prepare', db, Timestamp, batchSize: MAX_BATCH_SIZE,
            dryRun: true, stateData: { phase: 'prepare', cursors: {} }, statePath: join(root, 'state.json') });
        assert.equal(result.modifies, 1);
        assert.equal(db.writes, 0);
        await assert.rejects(readFile(join(root, 'state.json')));
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('aucune valeur de note ne passe dans les journaux', async () => {
    const db = makeDb({ pnjs: [['p1', { notes: 'VALEUR-QUI-NE-DOIT-PAS-SORTIR' }]], relations: [], pnjs_prives: [] });
    const output = [];
    const originalLog = console.log;
    console.log = (...args) => output.push(args.join(' '));
    try {
        await runPhase({ phase: 'copy-private', db, Timestamp, batchSize: MAX_BATCH_SIZE,
            dryRun: true, stateData: { cursors: {} } });
    } finally {
        console.log = originalLog;
    }
    assert.equal(output.join('\n').includes('VALEUR-QUI-NE-DOIT-PAS-SORTIR'), false);
});

test('un second passage prepare est sans modification', async () => {
    const db = makeDb({ pnjs: [['p1', {}]], relations: [], pnjs_prives: [] });
    const stateData = { phase: 'prepare', cursors: {} };
    await runPhase({ phase: 'prepare', db, Timestamp, FieldValue, batchSize: 1, dryRun: false, stateData });
    const writesAfterFirst = db.writes;
    const second = await runPhase({ phase: 'prepare', db, Timestamp, FieldValue, batchSize: 1,
        dryRun: false, stateData: { phase: 'prepare', cursors: {} } });
    assert.equal(second.modifies, 0);
    assert.equal(second.inchanges, 1);
    assert.equal(db.writes, writesAfterFirst);
});

test('copy puis second passage zéro, conflit et orphelin restent sûrs', async () => {
    const db = makeDb({
        pnjs: [
            ['p1', { description: 'public', notes: 'secret' }],
            ['p2', { notes: 'nouvelle' }],
        ],
        relations: [],
        pnjs_prives: [
            ['p2', { notes: 'ancienne' }],
            ['orphelin', { notes: 'orphelin' }],
        ],
    });
    const firstState = { phase: 'copy-private', cursors: {} };
    const first = await runPhase({ phase: 'copy-private', db, Timestamp, FieldValue,
        batchSize: 400, dryRun: false, stateData: firstState });
    assert.equal(first.modifies, 1);
    assert.equal(first.conflits, 1);
    // p1 est copié ; p2 est en conflit ; l'orphelin est seulement signalé.
    assert.equal(db.data('pnjs_prives').p1.notes, 'secret');
    // Le scénario conflit vérifie qu'aucune valeur existante n'est remplacée.
    assert.equal(db.data('pnjs_prives').p2.notes, 'ancienne');
    const second = await runPhase({ phase: 'copy-private', db, Timestamp, FieldValue,
        batchSize: 400, dryRun: false, stateData: { phase: 'copy-private', cursors: {} } });
    assert.equal(second.modifies, 0);
    assert.equal(second.inchanges, 1);
});

test('cleanup transactionnel supprime uniquement une copie égale', async () => {
    const db = makeDb({
        pnjs: [['p1', { notesMJ: 'secret', description: 'public' }], ['p2', { notes: 'autre' }]],
        relations: [], pnjs_prives: [['p1', { notes: 'secret' }], ['p2', { notes: 'différente' }]],
    });
    const result = await runPhase({ phase: 'cleanup', db, Timestamp, FieldValue,
        batchSize: 400, dryRun: false, stateData: { phase: 'cleanup', cursors: {} } });
    assert.equal(result.modifies, 1);
    assert.equal(Object.hasOwn(db.data('pnjs').p1, 'notesMJ'), false);
    assert.equal(Object.hasOwn(db.data('pnjs').p1, 'description'), true);
    assert.equal(db.data('pnjs').p2.notes, 'autre');
});

test('une interruption conserve un curseur de reprise après le lot validé', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm1-01-state-'));
    const statePath = join(root, 'nested', 'resume.json');
    try {
        const db = makeDb({ pnjs: [['a', {}], ['b', {}]], relations: [], pnjs_prives: [] }, { failCommitAt: 2 });
        const stateData = { phase: 'prepare', cursors: {} };
        await assert.rejects(runPhase({ phase: 'prepare', db, Timestamp, batchSize: 1, dryRun: false,
            stateData, statePath }), /interruption/);
        assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')).cursors, { pnjs: 'a' });
        await runPhase({ phase: 'prepare', db, Timestamp, batchSize: 1, dryRun: false,
            stateData: JSON.parse(await readFile(statePath, 'utf8')), statePath });
        assert.equal(db.data('pnjs').b.visibleJoueurs, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('une erreur transactionnelle cleanup ne fait pas avancer le curseur', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm1-01-cleanup-state-'));
    const statePath = join(root, 'resume.json');
    try {
        const db = makeDb({
            pnjs: [['a', { notes: 'a' }], ['b', { notes: 'b' }]], relations: [],
            pnjs_prives: [['a', { notes: 'a' }], ['b', { notes: 'b' }]],
        }, { failTransactionAt: 1 });
        await assert.rejects(runPhase({ phase: 'cleanup', db, Timestamp, FieldValue, batchSize: 2,
            dryRun: false, stateData: { phase: 'cleanup', cursors: {} }, statePath }), /transactionnel/);
        await assert.rejects(readFile(statePath));
        await runPhase({ phase: 'cleanup', db, Timestamp, FieldValue, batchSize: 2, dryRun: false,
            stateData: { phase: 'cleanup', cursors: {} }, statePath });
        assert.equal(Object.hasOwn(db.data('pnjs').a, 'notes'), false);
        assert.equal(Object.hasOwn(db.data('pnjs').b, 'notes'), false);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('la cible production exige projet, bucket et manifeste M0', () => {
    const base = { phase: 'prepare', project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', batchSize: 400, dryRun: false };
    assert.match(validateTarget(base).join('\n'), /confirmation|manifeste/);
    assert.deepEqual(validateTarget({ ...base, dryRun: true, confirmProduction: 'campagne-wrpg' }), []);
});

test('un manifeste M0 incomplet est refusé', async () => {
    await assert.rejects(validateBackupManifest('C:\\hors-depot\\absent\\manifest.json', {
        project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app',
    }), /manifeste M0/);
});

test('la vérification M0 détecte un fichier falsifié', async () => {
    const root = await mkdtemp(join(tmpdir(), 'm1-01-manifest-'));
    try {
        const collections = {};
        await mkdir(join(root, 'firestore'), { recursive: true });
        for (const name of ['pnjs', 'pnjs_prives', 'relations', 'indices']) {
            const relative = `firestore/${name}.json`;
            const content = `${JSON.stringify([{ id: `${name}-1`, data: {} }])}\n`;
            await writeFile(join(root, relative), content, 'utf8');
            collections[name] = {
                count: 1, file: relative, bytes: Buffer.byteLength(content),
                sha256: createHash('sha256').update(content).digest('hex'), ids: [`${name}-1`],
            };
        }
        const manifestPath = join(root, 'manifest.json');
        await writeFile(manifestPath, `${JSON.stringify({
            format: 'mobile-baseline-backup', version: 1, complete: true,
            projectId: 'demo-mobile', bucket: 'demo-mobile.appspot.com', collections,
            storage: { count: 0, totalBytes: 0, files: [] },
        })}\n`, 'utf8');
        await validateBackupManifest(manifestPath, { project: 'demo-mobile', bucket: 'demo-mobile.appspot.com' });
        await writeFile(join(root, collections.pnjs.file), 'falsifie', 'utf8');
        await assert.rejects(validateBackupManifest(manifestPath, {
            project: 'demo-mobile', bucket: 'demo-mobile.appspot.com',
        }), /manifeste M0/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

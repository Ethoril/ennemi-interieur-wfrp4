// Chantier H, T1 : commande `outil-mj` (écriture en retour de l'outil MJ vers la fiche).
// Contrat : plan.md §1 du cadrage (dépôt Outil MJ). Changes couverts ici : counter, carac, skill-adv, suivi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { executeFicheCommand, FICHE_COMMAND_TYPES } from '../src/fiche/service.mjs';
import { createFicheCommandHandler } from '../src/fiche/handler.mjs';
import { createFicheCommandEngine } from '../src/domain/fiche/commands.js';
import { FICHE_EXPORT_KEYS } from '../../js/fiche/export-import.js';

const PLAYER = { auth: { uid: 'player-1', token: { email: 'player@example.test', email_verified: true } } };
const MJ = { auth: { uid: 'mj-1', token: { email: 'ethoril@gmail.com', email_verified: true } } };

const PENITENCE = { id: 'outil:pen-1', categorie: 'penitence', libelle: 'Jeûne de Sigmar', detail: 'Pas de viande pendant 7 jours.', depuis: '06/11' };

function initialFiche() {
    return {
        schemaVersion: 2,
        revision: 3,
        data: {
            nom: 'Bhelgi', race: 'Nain', destin: '2', fortune: '1', peche: '0', corruption: '3',
            carac: { ag: { base: 30, adv: 5 }, f: { base: 35, adv: 0 } },
            skillsAdvanced: [{ id: 'priere', nom: 'Prière', carac: 'fm', adv: 10 }],
        },
    };
}

function reference(path) {
    return { path, collection(name) { return { doc: id => reference(`${path}/${name}/${id}`) }; } };
}

// Magasin simulé, même modèle que fiche-service.test.mjs (lectures avant écritures, transaction rejouée).
function createStore(seed) {
    const documents = new Map(Object.entries(seed).map(([path, value]) => [path, structuredClone(value)]));
    const db = {
        doc: reference,
        async runTransaction(callback) {
            const writes = new Map();
            let writeStarted = false;
            const transaction = {
                async get(ref) {
                    if (writeStarted) throw new Error('lecture après écriture');
                    const value = documents.get(ref.path);
                    return { exists: value !== undefined, data: () => structuredClone(value) };
                },
                set(ref, value) { writeStarted = true; writes.set(ref.path, structuredClone(value)); },
            };
            const result = await callback(transaction);
            for (const [path, value] of writes) documents.set(path, value);
            return structuredClone(result);
        },
    };
    return { db, documents };
}

function setup() {
    const store = createStore({ 'campagne/acces': { bhelgi: ['player@example.test'] }, 'fiches/bhelgi': initialFiche() });
    const engine = createFicheCommandEngine({ careers: [], skills: [], spells: {} });
    let timestamp = 0;
    const services = { db: store.db, applyCommand: engine.applyCommand, timestamp: () => ({ serverTime: ++timestamp }) };
    return { store, services, fiche: () => store.documents.get('fiches/bhelgi') };
}

function outilMj(changes, { sendId = 'send-1', baseRevision = 3, reason = 'Fin de séance du 06/11 (outil MJ)', undoOf, charId = 'bhelgi', operationId } = {}) {
    return {
        charId,
        operationId: operationId ?? `outilmj-${sendId}-${charId}`,
        baseRevision,
        type: 'outil-mj',
        payload: { reason, sendId, ...(undoOf ? { undoOf } : {}), changes },
    };
}

const SEND_CHANGES = [
    { op: 'counter', field: 'destin', base: '2', value: '1', label: 'Création du familier' },
    { op: 'counter', field: 'fortune', base: '1', value: '2', label: 'Fortune gagnée en séance' },
    { op: 'counter', field: 'peche', base: '0', value: '1', label: 'Péché' },
    { op: 'counter', field: 'corruption', base: '3', value: '5', label: 'Corruption' },
    { op: 'carac', carac: 'ag', base: 30, value: 25, label: 'Séquelle : pied perdu' },
    { op: 'skill-adv', id: 'priere', base: 10, value: 0, label: 'Excommunication' },
    { op: 'suivi', id: PENITENCE.id, base: null, value: PENITENCE, label: 'Pénitence imposée' },
];

function invert(changes) {
    return changes.map(change => ({ ...change, base: change.value, value: change.base }));
}

async function rejects(promise, code, kind) {
    let caught;
    await assert.rejects(promise, error => { caught = error; return error.code === code && (kind === undefined || error.details?.kind === kind); });
    return caught;
}

test('outil-mj fait partie des types de commande', () => {
    assert.ok(FICHE_COMMAND_TYPES.includes('outil-mj'));
});

test('CA8 : un joueur est refusé, même sur sa fiche ; le MJ doit donner un motif', async () => {
    const { services, fiche } = setup();
    await rejects(executeFicheCommand(outilMj(SEND_CHANGES), PLAYER, services), 'permission-denied');
    await rejects(executeFicheCommand(outilMj(SEND_CHANGES, { reason: ' ' }), MJ, services), 'invalid-argument');
    assert.equal(fiche().revision, 3);
});

test('CA16, CA17, CA9, CA6 : compteurs, Base de caractéristique, Prière, suivi ; historique ; rejeu sans réapplication', async () => {
    const { store, services, fiche } = setup();
    // baseRevision 1 < révision 3 : pas d'égalité exigée, la résolution se fait change par change.
    const request = outilMj(SEND_CHANGES, { baseRevision: 1 });
    const receipt = await executeFicheCommand(request, MJ, services);
    assert.deepEqual(receipt, { operationId: 'outilmj-send-1-bhelgi', charId: 'bhelgi', revision: 4 });
    const data = fiche().data;
    assert.equal(data.destin, '1');
    assert.equal(data.fortune, '2');
    assert.equal(data.peche, '1');
    assert.equal(data.corruption, '5');
    assert.deepEqual(data.carac.ag, { base: 25, adv: 5 }, 'Base seulement : les Avances ne bougent pas (Q8)');
    assert.deepEqual(data.carac.f, { base: 35, adv: 0 });
    assert.equal(data.skillsAdvanced[0].adv, 0);
    assert.equal(data.skillsAdvanced[0].nom, 'Prière');
    assert.deepEqual(data.suiviMj, [PENITENCE]);

    const history = store.documents.get('fiches/bhelgi/history/outilmj-send-1-bhelgi');
    assert.equal(history.type, 'outil-mj');
    assert.equal(history.role, 'mj');
    assert.equal(history.reason, 'Fin de séance du 06/11 (outil MJ)');
    assert.equal(history.summary.kind, 'outil-mj');
    assert.equal(typeof history.summary.label, 'string');
    assert.equal(history.summary.undoOf, undefined);
    assert.deepEqual(history.changes['counter:destin'], { before: '2', after: '1', label: 'Création du familier' });
    assert.deepEqual(history.changes['carac:ag'], { before: 30, after: 25, label: 'Séquelle : pied perdu' });
    assert.deepEqual(history.changes['skill-adv:priere'], { before: 10, after: 0, label: 'Excommunication' });
    assert.deepEqual(history.changes['suivi:outil:pen-1'], { before: null, after: PENITENCE, label: 'Pénitence imposée' });
    assert.equal(Object.keys(history.changes).length, 7);

    // CA6 : même identifiant, même contenu → le reçu, rien n'est réappliqué.
    assert.deepEqual(await executeFicheCommand(request, MJ, services), receipt);
    assert.equal(fiche().revision, 4);
    assert.deepEqual(fiche().data.suiviMj, [PENITENCE]);
    // Même identifiant, contenu différent → refus.
    await rejects(executeFicheCommand(outilMj([SEND_CHANGES[0]], { baseRevision: 1 }), MJ, services), 'already-exists');
});

test('CA10 : un seul change en conflit refuse toute la commande, sans rien écrire', async () => {
    const { store, services, fiche } = setup();
    const changes = [
        { op: 'counter', field: 'destin', base: '2', value: '1', label: 'Destin' },
        { op: 'counter', field: 'fortune', base: '0', value: '2', label: 'Fortune' },
        { op: 'carac', carac: 'f', base: 40, value: 35, label: 'Force' },
        { op: 'carac', carac: 'ag', base: 31, value: 25, label: 'Agilité' },
        { op: 'skill-adv', id: 'inconnue', base: 0, value: 0, label: 'Prière' },
    ];
    const error = await rejects(executeFicheCommand(outilMj(changes), MJ, services), 'aborted', 'conflict');
    // fortune : fiche 1, base 0, voulu 2 → conflit ; Force : déjà à 35 → pas un conflit (CA12) ;
    // Agilité : fiche 30 ≠ base 31 ≠ voulu 25 → conflit ; ligne absente : conflit (absente ≠ 0).
    assert.deepEqual(error.details, { kind: 'conflict', fields: ['counter:fortune', 'carac:ag', 'skill-adv:inconnue'], revision: 3 });
    assert.equal(fiche().revision, 3);
    assert.equal(fiche().data.destin, '2');
    assert.equal(store.documents.has('fiches/bhelgi/operations/outilmj-send-1-bhelgi'), false);

    // Le détail du conflit traverse le gestionnaire callable.
    const handler = createFicheCommandHandler(services);
    await assert.rejects(handler({ ...MJ, data: outilMj(changes) }), httpsError => httpsError.code === 'aborted'
        && httpsError.details?.kind === 'conflict' && httpsError.details.fields.length === 3 && httpsError.details.revision === 3);
});

test('CA12 : une valeur déjà égale à la cible n’est pas un conflit et n’est pas réécrite', async () => {
    const { store, services, fiche } = setup();
    await executeFicheCommand(outilMj([
        { op: 'counter', field: 'fortune', base: '0', value: '1', label: 'Fortune corrigée à la main' },
        { op: 'carac', carac: 'f', base: 40, value: 35, label: 'Perte déjà reportée' },
        { op: 'counter', field: 'destin', base: '2', value: '3', label: 'Destin' },
    ]), MJ, services);
    assert.equal(fiche().data.fortune, '1');
    assert.equal(fiche().data.destin, '3');
    assert.deepEqual(Object.keys(store.documents.get('fiches/bhelgi/history/outilmj-send-1-bhelgi').changes), ['counter:destin']);
});

test('baseRevision supérieure à la révision de la fiche : refus', async () => {
    const { services } = setup();
    await rejects(executeFicheCommand(outilMj(SEND_CHANGES, { baseRevision: 4 }), MJ, services), 'aborted', 'conflict');
});

test('suivi : remplacement et retrait d’une entrée (value null)', async () => {
    const { services, fiche } = setup();
    await executeFicheCommand(outilMj([SEND_CHANGES[6]]), MJ, services);
    const updated = { ...PENITENCE, detail: 'Encore 3 jours.' };
    await executeFicheCommand(outilMj([{ op: 'suivi', id: PENITENCE.id, base: PENITENCE, value: updated, label: 'Pénitence' }], { sendId: 'send-2', baseRevision: 4 }), MJ, services);
    assert.deepEqual(fiche().data.suiviMj, [updated]);
    await executeFicheCommand(outilMj([{ op: 'suivi', id: PENITENCE.id, base: updated, value: null, label: 'Pénitence close' }], { sendId: 'send-3', baseRevision: 5 }), MJ, services);
    assert.deepEqual(fiche().data.suiviMj, []);
});

test('CA21 : suiviMj ne s’écrit pas par une modification simple, ni du joueur ni du MJ', async () => {
    const { services, fiche } = setup();
    const patch = (operationId) => ({
        charId: 'bhelgi', operationId, baseRevision: 3, type: 'patch',
        payload: { changes: { suiviMj: [PENITENCE] }, baseValues: { suiviMj: null } },
    });
    await rejects(executeFicheCommand(patch('patch-joueur'), PLAYER, services), 'permission-denied', 'field-forbidden');
    await rejects(executeFicheCommand(patch('patch-mj'), MJ, services), 'permission-denied', 'field-forbidden');
    assert.equal(fiche().data.suiviMj, undefined);
});

test('CA23 : toute clé hors de la liste fermée est refusée', async () => {
    const { services, fiche } = setup();
    const refused = [
        outilMj([{ ...SEND_CHANGES[0], secret: 'délai de mutation' }]),
        outilMj([{ op: 'carac', carac: 'ag', base: 5, value: 4, label: 'Avances', adv: true }]),
        outilMj([{ op: 'counter', field: 'blessuresAct', base: '0', value: '3', label: 'Blessures' }]),
        outilMj([{ op: 'carac', carac: 'm', base: 4, value: 3, label: 'Mouvement' }]),
        outilMj([{ op: 'suivi', id: 'outil:mut-1', base: null, value: { id: 'outil:mut-1', categorie: 'mutation', libelle: 'Œil', detail: '', delaiSecret: 3 }, label: 'Mutation' }]),
        outilMj([{ op: 'suivi', id: 'outil:x', base: null, value: { id: 'outil:x', categorie: 'mutation-en-attente', libelle: 'X', detail: '' }, label: 'X' }]),
        outilMj([{ op: 'suivi', id: 'outil:a', base: null, value: { ...PENITENCE, id: 'outil:b' }, label: 'Identifiant différent' }]),
        outilMj([{ op: 'row', collection: 'talentsAcq', id: 't1', base: { id: 't1' }, value: null, label: 'Talent' }]),
        outilMj([{ op: 'counter', field: 'fortune', base: '1', value: '12345', label: 'Trop grand' }]),
        outilMj([{ op: 'carac', carac: 'ag', base: 30, value: -1, label: 'Négatif' }]),
        outilMj([{ op: 'skill-adv', id: 'priere', base: 10, value: 1.5, label: 'Décimal' }]),
        outilMj([SEND_CHANGES[0], SEND_CHANGES[0]]),
        outilMj([]),
        outilMj(Array.from({ length: 41 }, () => SEND_CHANGES[0])),
        outilMj([{ ...SEND_CHANGES[0], label: 'x'.repeat(201) }]),
        outilMj(SEND_CHANGES, { sendId: 'pas valide !' }),
        { ...outilMj(SEND_CHANGES), payload: { ...outilMj(SEND_CHANGES).payload, perteArbitrer: true } },
        { ...outilMj(SEND_CHANGES), operationId: 'autre-identifiant' },
    ];
    for (const [index, request] of refused.entries()) {
        await assert.rejects(executeFicheCommand(request, MJ, services), error => ['invalid-argument', 'permission-denied'].includes(error.code),
            `requête ${index} acceptée à tort`);
    }
    assert.equal(fiche().revision, 3);
});

test('CA13–CA15 : annulation par commande inverse, conflit après modification, pas d’annulation d’annulation', async () => {
    const { store, services, fiche } = setup();
    await executeFicheCommand(outilMj(SEND_CHANGES), MJ, services);
    const undo = outilMj(invert(SEND_CHANGES), { sendId: 'undo-1', baseRevision: 4, undoOf: 'outilmj-send-1-bhelgi' });
    await executeFicheCommand(undo, MJ, services);
    const data = fiche().data;
    assert.equal(data.destin, '2');
    assert.equal(data.fortune, '1');
    assert.deepEqual(data.carac.ag, { base: 30, adv: 5 });
    assert.equal(data.skillsAdvanced[0].adv, 10);
    assert.deepEqual(data.suiviMj, []);
    const history = store.documents.get('fiches/bhelgi/history/outilmj-undo-1-bhelgi');
    assert.equal(history.summary.undoOf, 'outilmj-send-1-bhelgi');

    // Une annulation ne s'annule pas.
    await rejects(executeFicheCommand(outilMj(SEND_CHANGES, { sendId: 'undo-2', baseRevision: 5, undoOf: 'outilmj-undo-1-bhelgi' }), MJ, services),
        'failed-precondition', 'undo-invalid');
    // undoOf inconnu, ou opération d'un autre type.
    await rejects(executeFicheCommand(outilMj(SEND_CHANGES, { sendId: 'undo-3', baseRevision: 5, undoOf: 'inconnue' }), MJ, services),
        'failed-precondition', 'undo-invalid');
    await executeFicheCommand({ charId: 'bhelgi', operationId: 'patch-1', baseRevision: 5, type: 'patch',
        payload: { changes: { fortune: '4' }, baseValues: { fortune: '1' } } }, PLAYER, services);
    await rejects(executeFicheCommand(outilMj(SEND_CHANGES, { sendId: 'undo-4', baseRevision: 6, undoOf: 'patch-1' }), MJ, services),
        'failed-precondition', 'undo-invalid');
    assert.equal(fiche().revision, 6);

    // CA14 : nouvel envoi, le joueur modifie la Fortune, l'annulation tombe en conflit sur ce champ.
    const send2 = [{ op: 'counter', field: 'fortune', base: '4', value: '5', label: 'Fortune' }, { op: 'counter', field: 'destin', base: '2', value: '1', label: 'Destin' }];
    await executeFicheCommand(outilMj(send2, { sendId: 'send-5', baseRevision: 6 }), MJ, services);
    await executeFicheCommand({ charId: 'bhelgi', operationId: 'patch-2', baseRevision: 7, type: 'patch',
        payload: { changes: { fortune: '3' }, baseValues: { fortune: '5' } } }, PLAYER, services);
    const error = await rejects(executeFicheCommand(outilMj(invert(send2), { sendId: 'undo-5', baseRevision: 8, undoOf: 'outilmj-send-5-bhelgi' }), MJ, services),
        'aborted', 'conflict');
    assert.deepEqual(error.details.fields, ['counter:fortune']);
    assert.equal(fiche().data.destin, '1');
});

test('suiviMj fait partie des clés d’export et d’import JSON', async () => {
    assert.ok(FICHE_EXPORT_KEYS.includes('suiviMj'));
    const source = await readFile(new URL('../../js/fiche/commands.js', import.meta.url), 'utf8');
    const serverKeys = source.match(/const EXPORT_KEYS = new Set\(\[([\s\S]*?)\]\);/u)[1];
    assert.ok(serverKeys.includes("'suiviMj'"));

    const { services, fiche } = setup();
    const importCommand = (operationId, suiviMj) => ({ charId: 'bhelgi', operationId, baseRevision: 3, type: 'import',
        payload: { reason: 'Réimport', data: { nom: 'Bhelgi', suiviMj } } });
    await assert.rejects(executeFicheCommand(importCommand('import-bad', [{ ...PENITENCE, secret: 1 }]), MJ, services));
    await executeFicheCommand(importCommand('import-ok', [PENITENCE]), MJ, services);
    assert.deepEqual(fiche().data.suiviMj, [PENITENCE]);
});

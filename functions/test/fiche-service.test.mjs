import test from 'node:test';
import assert from 'node:assert/strict';
import { executeFicheCommand, FicheCommandError } from '../src/fiche/service.mjs';
import { createFicheCommandHandler } from '../src/fiche/handler.mjs';

const PLAYER = { auth: { uid: 'player-1', token: { email: 'PLAYER@example.test', email_verified: true } } };
const MJ = { auth: { uid: 'mj-1', token: { email: 'ethoril@gmail.com', email_verified: true } } };
const ANONYMOUS = {};
const INITIAL = {
    schemaVersion: 2,
    revision: 0,
    data: { nom: 'Bhelgi', race: 'Nain', possessions: 'hache', optVisible: { 'section-sorts': false, 'section-prieres': false } },
};

function reference(path) {
    return {
        path,
        collection(name) { return { doc: id => reference(`${path}/${name}/${id}`) }; },
    };
}

function createStore(seed = {}) {
    const documents = new Map(Object.entries(seed).map(([path, value]) => [path, structuredClone(value)]));
    const versions = new Map([...documents.keys()].map(path => [path, 1]));
    let versionCounter = 1;
    const db = {
        doc: reference,
        async runTransaction(callback) {
            for (let attempt = 0; attempt < 8; attempt++) {
                const readVersions = new Map();
                const writes = new Map();
                let writeStarted = false;
                const transaction = {
                    async get(ref) {
                        if (writeStarted) throw new Error('lecture après écriture');
                        await Promise.resolve();
                        if (!readVersions.has(ref.path)) readVersions.set(ref.path, versions.get(ref.path) ?? 0);
                        const value = documents.get(ref.path);
                        return { exists: value !== undefined, data: () => structuredClone(value) };
                    },
                    set(ref, value) {
                        writeStarted = true;
                        writes.set(ref.path, structuredClone(value));
                    },
                };
                const result = await callback(transaction);
                const changed = [...readVersions].some(([path, version]) => (versions.get(path) ?? 0) !== version);
                if (changed) continue;
                for (const [path, value] of writes) {
                    documents.set(path, value);
                    versions.set(path, ++versionCounter);
                }
                return structuredClone(result);
            }
            throw Object.assign(new Error('too many retries'), { code: 'aborted' });
        },
    };
    return { db, documents };
}

function deps(store, applyCommand = async data => ({ data: { ...data } })) {
    let timestamp = 0;
    return { db: store.db, applyCommand, timestamp: () => ({ serverTime: ++timestamp }) };
}

function seed() {
    return {
        'campagne/acces': { bhelgi: ['player@example.test'] },
        'fiches/bhelgi': INITIAL,
    };
}

function command(type, payload = {}, overrides = {}) {
    return { charId: 'bhelgi', operationId: 'operation-1', baseRevision: 0, type, payload, ...overrides };
}

async function rejectCode(promise, code, kind) {
    await assert.rejects(promise, error => error.code === code && (kind === undefined || error.details?.kind === kind));
}

test('purchase écrit fiche, reçu et historique ensemble avec rôle et révision', async () => {
    const store = createStore(seed());
    let domainCalls = 0;
    let receivedContext;
    const result = await executeFicheCommand(command('purchase', { kind: 'skill', name: 'Esquive', confirmedCost: 20 }), PLAYER, deps(store, async (data, cmd, context) => {
        domainCalls++;
        receivedContext = context;
        assert.equal(cmd.type, 'purchase');
        return {
            data: { ...data, xpLog: [{ operationId: cmd.operationId, effects: [{ path: 'skillsAdvanced.row.adv', before: 0, after: 1 }] }] },
            result: { cost: 20, data: { possessions: 'ne doit pas sortir' } },
            summary: { kind: 'purchase', target: 'Esquive', cost: 20, privateState: { possessions: 'ne doit pas sortir' } },
        };
    }));
    assert.deepEqual(result, { operationId: 'operation-1', charId: 'bhelgi', revision: 1, result: { cost: 20 } });
    assert.equal(domainCalls, 1);
    assert.deepEqual(receivedContext, { role: 'joueur', uid: 'player-1', charId: 'bhelgi', revision: 0, baseRevision: 0 });
    assert.equal(store.documents.get('fiches/bhelgi').revision, 1);
    assert.equal(store.documents.get('fiches/bhelgi').updatedBy, 'player-1');
    assert.equal(store.documents.get('fiches/bhelgi/operations/operation-1').response.revision, 1);
    const history = store.documents.get('fiches/bhelgi/history/operation-1');
    assert.equal(history.type, 'purchase');
    assert.deepEqual(history.summary, { kind: 'purchase', target: 'Esquive', cost: 20 });
    assert.deepEqual(history.effects, [{ path: 'skillsAdvanced.row.adv', before: 0, after: 1 }]);
});

test('répéter la même opération retourne son reçu sans rappeler le domaine', async () => {
    const store = createStore(seed());
    let calls = 0;
    const services = deps(store, async data => { calls++; return { data: { ...data, change: true }, result: { ok: true } }; });
    const request = command('purchase', { kind: 'talent', name: 'Robuste' });
    const first = await executeFicheCommand(request, PLAYER, services);
    const second = await executeFicheCommand(request, PLAYER, services);
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    assert.equal(store.documents.get('fiches/bhelgi').revision, 1);
});

test('un identifiant rejoué avec une commande différente est refusé', async () => {
    const store = createStore(seed());
    const services = deps(store, async data => ({ data: { ...data } }));
    await executeFicheCommand(command('purchase', { kind: 'talent', name: 'Robuste' }), PLAYER, services);
    await rejectCode(executeFicheCommand(command('purchase', { kind: 'talent', name: 'Dur à cuire' }), PLAYER, services), 'already-exists');
});

test('l’accès est revérifié avant de retourner un reçu antérieur', async () => {
    const store = createStore(seed());
    const services = deps(store, async data => ({ data: { ...data } }));
    const request = command('purchase', { kind: 'talent', name: 'Robuste' });
    const first = await executeFicheCommand(request, PLAYER, services);
    store.documents.set('campagne/acces', { bhelgi: [] });
    await rejectCode(executeFicheCommand(request, PLAYER, services), 'permission-denied');
    assert.equal(first.revision, 1);
});

test('les champs simples fusionnent quand deux clients changent des champs distincts', async () => {
    const store = createStore(seed());
    const services = deps(store);
    const first = command('patch', { changes: { nom: 'Bhelgi Main-de-Fer' }, baseValues: { nom: 'Bhelgi' } }, { operationId: 'patch-a' });
    const second = command('patch', { changes: { race: 'Nain des Montagnes' }, baseValues: { race: 'Nain' } }, { operationId: 'patch-b' });
    const [left, right] = await Promise.all([
        executeFicheCommand(first, MJ, services),
        executeFicheCommand(second, MJ, services),
    ]);
    assert.equal(left.revision, 1);
    assert.equal(right.revision, 2);
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, {
        ...INITIAL.data,
        nom: 'Bhelgi Main-de-Fer',
        race: 'Nain des Montagnes',
    });
});

test('nom et race sont réservés au MJ : refus joueur en bloc, sans écriture', async () => {
    const store = createStore(seed());
    const services = deps(store);
    await rejectCode(executeFicheCommand(command('patch', { changes: { nom: 'x' }, baseValues: { nom: 'Bhelgi' } }), PLAYER, services), 'permission-denied', 'field-forbidden');
    await rejectCode(executeFicheCommand(command('patch', { changes: { race: 'x' }, baseValues: { race: 'Nain' } }), PLAYER, services), 'permission-denied', 'field-forbidden');
    await rejectCode(executeFicheCommand(command('patch', {
        changes: { nom: 'x', possessions: 'épée' }, baseValues: { nom: 'Bhelgi', possessions: 'hache' },
    }), PLAYER, services), 'permission-denied', 'field-forbidden');
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, INITIAL.data);
    assert.equal(store.documents.get('fiches/bhelgi').revision, 0);
});

test('le MJ modifie nom et race, le joueur modifie encore possessions', async () => {
    const store = createStore(seed());
    const services = deps(store);
    await executeFicheCommand(command('patch', {
        changes: { nom: 'Nouveau', race: 'Humain' }, baseValues: { nom: 'Bhelgi', race: 'Nain' },
    }, { operationId: 'mj-1' }), MJ, services);
    await executeFicheCommand(command('patch', {
        changes: { possessions: 'épée' }, baseValues: { possessions: 'hache' },
    }, { operationId: 'player-1', baseRevision: 1 }), PLAYER, services);
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, { ...INITIAL.data, nom: 'Nouveau', race: 'Humain', possessions: 'épée' });
});

test('les cases d’affichage fusionnent séparément au sein de optVisible', async () => {
    const store = createStore(seed());
    const services = deps(store);
    const first = command('patch', {
        changes: { 'optVisible.section-sorts': true },
        baseValues: { 'optVisible.section-sorts': false },
    }, { operationId: 'visible-a' });
    const second = command('patch', {
        changes: { 'optVisible.section-prieres': true },
        baseValues: { 'optVisible.section-prieres': false },
    }, { operationId: 'visible-b' });
    await Promise.all([executeFicheCommand(first, PLAYER, services), executeFicheCommand(second, PLAYER, services)]);
    assert.deepEqual(store.documents.get('fiches/bhelgi').data.optVisible, {
        'section-sorts': true,
        'section-prieres': true,
    });
});

test('un patch met à jour plusieurs clés optVisible sans perdre la première', async () => {
    const store = createStore(seed());
    const patchRequest = command('patch', {
        changes: { 'optVisible.section-sorts': true, 'optVisible.section-prieres': true },
        baseValues: { 'optVisible.section-sorts': false, 'optVisible.section-prieres': false },
    });
    await executeFicheCommand(patchRequest, PLAYER, deps(store));
    assert.deepEqual(store.documents.get('fiches/bhelgi').data.optVisible, {
        'section-sorts': true,
        'section-prieres': true,
    });
    assert.deepEqual(store.documents.get('fiches/bhelgi/history/operation-1').changes, {
        'optVisible.section-sorts': { before: false, after: true },
        'optVisible.section-prieres': { before: false, after: true },
    });
});

test('un patch sur un champ absent de fiche legacy utilise null comme base et journalise un delta Firestore valide', async () => {
    const store = createStore({
        'campagne/acces': { bhelgi: ['player@example.test'] },
        'fiches/bhelgi': { schemaVersion: 2, revision: 0, data: {} },
    });
    const request = command('patch', {
        changes: { nom: 'Bhelgi', 'optVisible.section-sorts': true },
        baseValues: { nom: null, 'optVisible.section-sorts': null },
    });
    await executeFicheCommand(request, MJ, deps(store));
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, { nom: 'Bhelgi', optVisible: { 'section-sorts': true } });
    assert.deepEqual(store.documents.get('fiches/bhelgi/history/operation-1').changes, {
        nom: { before: null, beforeExists: false, after: 'Bhelgi' },
        'optVisible.section-sorts': { before: null, beforeExists: false, after: true },
    });
});

test('un patch refuse null comme nouvelle valeur au lieu de confondre suppression et champ absent', async () => {
    const store = createStore(seed());
    await rejectCode(executeFicheCommand(command('patch', {
        changes: { nom: null }, baseValues: { nom: 'Bhelgi' },
    }), PLAYER, deps(store)), 'invalid-argument');
});

test('patch écrit une note par ID stable encodé et conserve les changements distants non conflictuels', async () => {
    const store = createStore({
        ...seed(),
        'fiches/bhelgi': { ...INITIAL, data: { ...INITIAL.data, careers: [{ id: 'career.row:1', nom: 'Gardien', note: 'avant' }], chance: '2' } },
    });
    const request = command('patch', {
        changes: { 'careers.career%2Erow%3A1.note': 'note locale' },
        baseValues: { 'careers.career%2Erow%3A1.note': 'avant' },
    });
    const result = await executeFicheCommand(request, PLAYER, deps(store));
    const data = store.documents.get('fiches/bhelgi').data;
    assert.equal(result.revision, 1);
    assert.equal(data.careers[0].note, 'note locale');
    assert.equal(data.chance, '2');
    assert.deepEqual(store.documents.get('fiches/bhelgi/history/operation-1').fields, ['careers.career%2Erow%3A1.note']);
});

test('basicSpecs et variantes choisies requièrent une validation catalogue serveur', async () => {
    const store = createStore(seed());
    await rejectCode(executeFicheCommand(command('patch', {
        changes: { 'basicSpecs.Divertissement': 'Chant' }, baseValues: { 'basicSpecs.Divertissement': null },
    }), PLAYER, deps(store)), 'failed-precondition', 'catalog-validation-required');

    const services = deps(store);
    services.validatePatch = async (data, payload) => {
        assert.equal(data.skillsBasic, undefined);
        assert.equal(payload.changes['basicSpecs.Divertissement'], 'Chant');
    };
    const request = command('patch', {
        changes: { 'basicSpecs.Divertissement': 'Chant', 'chosenVariants.agitateur.1': 'Pamphlétaire' },
        baseValues: { 'basicSpecs.Divertissement': null, 'chosenVariants.agitateur.1': null },
    });
    const result = await executeFicheCommand(request, PLAYER, services);
    assert.equal(result.revision, 1);
    assert.equal(store.documents.get('fiches/bhelgi').data.basicSpecs.Divertissement, 'Chant');
    assert.equal(store.documents.get('fiches/bhelgi').data.chosenVariants.agitateur[1], 'Pamphlétaire');
});

test('un changement concurrent du même champ bloque sans exposer la fiche', async () => {
    const store = createStore(seed());
    const services = deps(store);
    const requests = [
        command('patch', { changes: { nom: 'Bhelgi A' }, baseValues: { nom: 'Bhelgi' } }, { operationId: 'same-a' }),
        command('patch', { changes: { nom: 'Bhelgi B' }, baseValues: { nom: 'Bhelgi' } }, { operationId: 'same-b' }),
    ];
    const results = await Promise.allSettled(requests.map(item => executeFicheCommand(item, MJ, services)));
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    const rejected = results.find(item => item.status === 'rejected').reason;
    assert.equal(rejected.code, 'aborted');
    assert.equal(rejected.details.kind, 'conflict');
    assert.deepEqual(rejected.details.fields, ['nom']);
    assert.equal(JSON.stringify(rejected).includes('possessions'), false);
});

test('les patches refusent carrière, XP, avances, clés inconnues et pollution de prototype', async () => {
    const store = createStore(seed());
    const services = deps(store);
    for (const path of ['carriere', 'rang', 'xpLog', 'carac.f.base', 'skillsBasic.Esquive']) {
        await rejectCode(executeFicheCommand(command('patch', {
            changes: { [path]: '1' }, baseValues: { [path]: '' },
        }), PLAYER, services), 'permission-denied', 'field-forbidden');
    }
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}');
    await rejectCode(executeFicheCommand(command('patch', { changes: { nom: 'x' }, baseValues: { nom: 'Bhelgi' }, ...unsafe }), PLAYER, services), 'invalid-argument');
    assert.equal({}.polluted, undefined);
});

test('les visiteurs, comptes non autorisés et comptes sans email vérifié sont refusés', async () => {
    const store = createStore(seed());
    const services = deps(store);
    const request = command('patch', { changes: { nom: 'x' }, baseValues: { nom: 'Bhelgi' } });
    await rejectCode(executeFicheCommand(request, ANONYMOUS, services), 'unauthenticated');
    await rejectCode(executeFicheCommand(request, { auth: { uid: 'outside', token: { email: 'outside@example.test', email_verified: true } } }, services), 'permission-denied');
    await rejectCode(executeFicheCommand(request, { auth: { uid: 'unverified', token: { email: 'player@example.test', email_verified: false } } }, services), 'unauthenticated');
});

test('la fiche test reste réservée au MJ et un joueur ne peut pas lancer de commande serveur', async () => {
    const store = createStore({ ...seed(), 'fiches/test': INITIAL });
    const services = deps(store, async data => ({ data: { ...data } }));
    await rejectCode(executeFicheCommand(command('patch', { changes: { nom: 'x' }, baseValues: { nom: 'Bhelgi' } }, { charId: 'test' }), PLAYER, services), 'permission-denied');
    await rejectCode(executeFicheCommand(command('purchase', {}, { type: 'correct', payload: { reason: 'Correction' } }), PLAYER, services), 'permission-denied');
    const result = await executeFicheCommand(command('correct', { reason: 'Correction MJ', marker: 'ok' }, { charId: 'test' }), MJ, services);
    assert.equal(result.revision, 1);
});

test('les entrées de campagne suivent les minuscules exigées par les règles Firestore', async () => {
    const store = createStore({ 'campagne/acces': { bhelgi: ['PLAYER@example.test'] }, 'fiches/bhelgi': INITIAL });
    const request = command('patch', { changes: { nom: 'Nom changé' }, baseValues: { nom: 'Bhelgi' } });
    await rejectCode(executeFicheCommand(request, PLAYER, deps(store)), 'permission-denied');
});

test('un changement de prix fourni par le moteur conserve son code et ses détails sûrs', async () => {
    const store = createStore(seed());
    const services = deps(store, async () => { throw new FicheCommandError('prix modifié', 'failed-precondition', { kind: 'price-changed', expectedCost: 20, currentCost: 30 }); });
    await assert.rejects(executeFicheCommand(command('purchase', { kind: 'skill', confirmedCost: 20 }), PLAYER, services), error => (
        error.code === 'failed-precondition' && error.details.kind === 'price-changed'
    ));
    assert.equal(store.documents.get('fiches/bhelgi').revision, 0);
    assert.equal(store.documents.has('fiches/bhelgi/operations/operation-1'), false);
});

test('correct, import et reset exigent un motif MJ et la révision exacte', async () => {
    const store = createStore(seed());
    const services = deps(store, async data => ({ data: { ...data } }));
    await rejectCode(executeFicheCommand(command('correct', { reason: 'ok', marker: true }), PLAYER, services), 'permission-denied');
    await rejectCode(executeFicheCommand(command('correct', { marker: true }), MJ, services), 'invalid-argument');
    await rejectCode(executeFicheCommand(command('import', { reason: 'import validé', data: {} }, { baseRevision: 1 }), MJ, services), 'aborted', 'conflict');
    const unsafeImport = command('import', JSON.parse('{"reason":"Import validé","data":{"__proto__":{"polluted":true}}}'));
    await rejectCode(executeFicheCommand(unsafeImport, MJ, services), 'invalid-argument');
    assert.equal({}.polluted, undefined);
});

test('reset conserve la fiche en tombstone et son reçu, sans remise à zéro de révision', async () => {
    const store = createStore(seed());
    const services = deps(store);
    const reset = command('reset', { reason: 'réinitialisation demandée' });
    const first = await executeFicheCommand(reset, MJ, services);
    assert.equal(first.revision, 1);
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, {});
    assert.equal(store.documents.get('fiches/bhelgi').tombstone, true);
    assert.equal(store.documents.has('fiches/bhelgi/operations/operation-1'), true);
    assert.deepEqual(store.documents.get('fiches/bhelgi/command_backups/operation-1').sourceEnvelope, INITIAL);
    assert.equal(store.documents.get('fiches/bhelgi/history/operation-1').backupPath,
        'fiches/bhelgi/command_backups/operation-1');
    assert.deepEqual(await executeFicheCommand(reset, MJ, services), first);
});

test('import MJ sauvegarde l’enveloppe remplacée et l’historique privé pointe vers la sauvegarde', async () => {
    const store = createStore(seed());
    const imported = { nom: 'Nom importé', xpLog: [] };
    const services = deps(store, async (_data, cmd) => ({ data: cmd.payload.data, summary: { kind: 'import' } }));
    await executeFicheCommand(command('import', { reason: 'Restauration motivée', data: imported }), MJ, services);
    const backup = store.documents.get('fiches/bhelgi/command_backups/operation-1');
    assert.equal(backup.type, 'import');
    assert.equal(backup.sourceRevision, INITIAL.revision);
    assert.deepEqual(backup.sourceEnvelope, INITIAL);
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, imported);
    assert.equal(store.documents.get('fiches/bhelgi/history/operation-1').backupPath,
        'fiches/bhelgi/command_backups/operation-1');
});

test('reset refuse une sauvegarde source supérieure à 900 KiB avant toute écriture', async () => {
    const large = { ...INITIAL, data: { memo: 'x'.repeat(900 * 1024) } };
    const store = createStore({ ...seed(), 'fiches/bhelgi': large });
    await rejectCode(executeFicheCommand(command('reset', { reason: 'Trop volumineux' }), MJ, deps(store)),
        'resource-exhausted', 'backup-too-large');
    assert.equal(store.documents.get('fiches/bhelgi').revision, INITIAL.revision);
    assert.equal(store.documents.has('fiches/bhelgi/command_backups/operation-1'), false);
    assert.equal(store.documents.has('fiches/bhelgi/operations/operation-1'), false);
});

test('reset préserve les métadonnées de migration et de catalogue', async () => {
    const initial = { ...INITIAL, migration: { id: 'm-2', status: 'done' }, catalogVersion: 7 };
    const store = createStore({ 'campagne/acces': { bhelgi: ['player@example.test'] }, 'fiches/bhelgi': initial });
    await executeFicheCommand(command('reset', { reason: 'reset validé' }), MJ, deps(store));
    const envelope = store.documents.get('fiches/bhelgi');
    assert.deepEqual(envelope.migration, initial.migration);
    assert.equal(envelope.catalogVersion, 7);
});

test('les fiches héritées ne sont jamais initialisées à l’aveugle', async () => {
    const store = createStore({ 'campagne/acces': { bhelgi: ['player@example.test'] }, 'fiches/bhelgi': { data: { nom: 'Bhelgi' } } });
    await rejectCode(executeFicheCommand(command('patch', { changes: { nom: 'Nouveau' }, baseValues: { nom: 'Bhelgi' } }), MJ, deps(store)), 'failed-precondition', 'migration-needed');
    assert.equal(store.documents.get('fiches/bhelgi').data.nom, 'Bhelgi');
});

test('un import MJ motivé initialise une fiche absente en révision 1', async () => {
    const store = createStore({ 'campagne/acces': { bhelgi: ['player@example.test'] } });
    const applyCommand = async (_data, cmd) => ({ data: { nom: cmd.payload.data.nom, xpLog: [] }, summary: { kind: 'import' } });
    const result = await executeFicheCommand(command('import', { reason: 'Création initiale', data: { nom: 'Témoin' } }), MJ, deps(store, applyCommand));
    assert.equal(result.revision, 1);
    assert.deepEqual(store.documents.get('fiches/bhelgi').data, { nom: 'Témoin', xpLog: [] });
    assert.equal(store.documents.get('fiches/bhelgi').schemaVersion, 2);
    assert.equal(store.documents.get('fiches/bhelgi/history/operation-1').type, 'import');
});

test('le handler callable conserve les erreurs métier sans exposer de données de fiche', async () => {
    const store = createStore(seed());
    const handler = createFicheCommandHandler(deps(store, async () => {
        throw new FicheCommandError('conflit sur le champ nom', 'aborted', {
            kind: 'conflict', revision: 4, fields: ['nom'], data: { possessions: 'secret' },
        });
    }));
    await assert.rejects(handler({ data: command('purchase', {}), ...PLAYER }), error => (
        error.code === 'aborted'
        && error.details.kind === 'conflict'
        && error.details.revision === 4
        && error.details.fields[0] === 'nom'
        && !JSON.stringify(error.details).includes('possessions')
    ));
});

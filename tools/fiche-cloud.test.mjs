import test from 'node:test';
import assert from 'node:assert/strict';
import { createFicheController } from '../js/fiche-controller.js';
import { createFicheDraftStore } from '../js/fiche-draft-store.js';
import { createFicheRepository } from '../js/fiche-repository.js';
import { createFichePatchAdapter } from '../js/fiche-client-bridge.js';

const envelope = (revision = 1, data = {}) => ({ schemaVersion: 2, revision, tombstone: false, data });
const fixture = (revision = 1, overrides = {}) => envelope(revision, {
    nom: 'Albrecht', race: 'Humain', xpLog: [], skillsAdvanced: [{ id: 'row-id', nom: 'Dressage', adv: 0, note: '' }],
    ...overrides,
});

function memoryStorage() {
    const values = new Map();
    return {
        values,
        get length() { return values.size; },
        key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
}

function fakeRepository(initialEnvelope = fixture()) {
    const listeners = [];
    const commands = [];
    let currentEnvelope = initialEnvelope;
    let failNext = false;
    return {
        listeners,
        commands,
        setFailNext() { failNext = true; },
        subscribe(charId, next, error) {
            const item = { charId, next, error, active: true };
            listeners.push(item);
            return () => { item.active = false; };
        },
        publish(envelopeValue = currentEnvelope) {
            currentEnvelope = envelopeValue;
            for (const item of listeners) if (item.active) item.next({ exists: !!envelopeValue, envelope: envelopeValue });
        },
        async execute(command) {
            commands.push(globalThis.structuredClone(command));
            if (failNext) { failNext = false; throw Object.assign(new Error('network'), { code: 'unavailable' }); }
            if (command.type === 'patch') {
                const data = globalThis.structuredClone(currentEnvelope.data);
                for (const [path, value] of Object.entries(command.payload.changes)) {
                    const [root, encodedId, field] = path.split('.');
                    const id = decodeURIComponent(encodedId || '');
                    if (field) data[root] = data[root].map(row => row.id === id ? { ...row, [field]: value } : row);
                    else data[root] = value;
                }
                currentEnvelope = envelope(currentEnvelope.revision + 1, data);
                this.publish(currentEnvelope);
            } else {
                currentEnvelope = envelope(currentEnvelope.revision + 1, currentEnvelope.data);
                this.publish(currentEnvelope);
            }
            return { charId: command.charId, operationId: command.operationId, revision: currentEnvelope.revision };
        },
        async migrate(payload) { return { ...payload, status: 'migrated' }; },
    };
}

test('draft store is namespaced by UID, character, tab session and schema with explicit cross-session recovery', () => {
    const storage = memoryStorage();
    const store = createFicheDraftStore({ storage, now: () => 42, makeSessionId: () => 'tab-a' });
    const secondTab = createFicheDraftStore({ storage, now: () => 43, makeSessionId: () => 'tab-b' });
    const draft = { schemaVersion: 2, charId: 'bhelgi', baseRevision: 3, baseData: {}, localData: {}, changes: { nom: { base: '', local: 'A' } } };
    assert.deepEqual(store.save('uid-a', 'bhelgi', draft), { ok: true });
    assert.equal(secondTab.load('uid-a', 'bhelgi'), null);
    assert.equal(secondTab.listOtherSessions('uid-a', 'bhelgi')[0].sessionId, 'tab-a');
    assert.equal(secondTab.loadSession('uid-a', 'bhelgi', 'tab-a').savedAt, 42);
    assert.equal(secondTab.load('uid-b', 'bhelgi'), null);
    assert.equal(secondTab.load('uid-a', 'caelel'), null);
    storage.setItem('wfrp4-fiche-bhelgi', JSON.stringify({ _dirty: true, nom: 'legacy' }));
    assert.equal(store.load('uid-a', 'bhelgi').localData.nom, undefined);
    assert.equal(store.remove('uid-a', 'bhelgi'), true);
});

test('brouillons de corrections MJ sont isolés et récupérables explicitement', () => {
    const storage = memoryStorage();
    const oldSession = createFicheDraftStore({ storage, now: () => 10, makeSessionId: () => 'session-000000000001' });
    const newSession = createFicheDraftStore({ storage, now: () => 20, makeSessionId: () => 'session-000000000002' });
    const value = { schemaVersion: 2, charId: 'bhelgi', baseRevision: 4, reason: 'Révision à examiner', items: [{ pathParts: ['carac', 'cc', 'base'], baseValue: 30, value: 31 }] };
    assert.deepEqual(oldSession.saveCorrection('uid-a', 'bhelgi', value), { ok: true });
    assert.equal(newSession.loadCorrection('uid-a', 'bhelgi'), null);
    assert.deepEqual(newSession.listOtherCorrectionSessions('uid-a', 'bhelgi'), [{ sessionId: 'session-000000000001', savedAt: 10, changeCount: 1 }]);
    assert.equal(newSession.loadCorrectionSession('uid-b', 'bhelgi', 'session-000000000001'), null);
    assert.equal(newSession.loadCorrectionSession('uid-a', 'caelel', 'session-000000000001'), null);
    assert.equal(newSession.loadCorrectionSession('uid-a', 'bhelgi', 'session-000000000001').reason, value.reason);
});

test('draft store refuse compte ou taille hors limites et signale un quota local', () => {
    const storage = memoryStorage();
    const session = createFicheDraftStore({ storage, makeSessionId: () => 'session-000000000001' });
    const base = { schemaVersion: 2, charId: 'bhelgi', baseRevision: 1, baseData: {}, localData: {}, changes: {} };
    assert.deepEqual(session.save('uid-a', 'bhelgi', { ...base, changes: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`x${i}`, { base: '', local: '' }])) }), { ok: false, reason: 'too-many-changes' });
    const tooLarge = { schemaVersion: 2, charId: 'bhelgi', baseRevision: 1, reason: 'motif', items: [{ pathParts: ['carac', 'cc', 'base'], baseValue: 1, value: 'x'.repeat(140_000) }] };
    assert.deepEqual(session.saveCorrection('uid-a', 'bhelgi', tooLarge), { ok: false, reason: 'draft-too-large' });
    const quotaStorage = { length: 0, setItem() { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); } };
    const quotaStore = createFicheDraftStore({ storage: quotaStorage });
    assert.deepEqual(quotaStore.save('uid-a', 'bhelgi', { ...base, changes: { nom: { base: 'A', local: 'B' } } }), { ok: false, reason: 'quota-exceeded' });
});

test('échec de stockage garde la saisie en mémoire et expose son indisponibilité sans bloquer l’envoi', async () => {
    const quotaStorage = { length: 0, setItem() { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); } };
    const repository = fakeRepository(fixture(1));
    const controller = createFicheController({
        repository, draftStore: createFicheDraftStore({ storage: quotaStorage }), isOnline: () => false,
    });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    assert.deepEqual(controller.stagePatch({ nom: 'Gardé en mémoire' }), {
        ok: true, hasDraft: true, persistence: 'memory-only', persistenceReason: 'quota-exceeded',
    });
    assert.equal(controller.getState().data.nom, 'Gardé en mémoire');
    assert.equal(controller.getState().draftPersistenceUnavailable, true);
    assert.deepEqual(await controller.submitPatch(), { status: 'blocked', reason: 'offline' });
    assert.equal(controller.getState().data.nom, 'Gardé en mémoire');
    controller.close();
    assert.equal(controller.getState().draftPersistenceUnavailable, false);
});

test('le contrôleur protège les brouillons de correction au MJ et laisse leur restauration explicite', () => {
    const storage = memoryStorage();
    const firstRepo = fakeRepository(fixture(1));
    const source = createFicheController({ repository: firstRepo, draftStore: createFicheDraftStore({ storage, makeSessionId: () => 'session-mj-0000000002' }) });
    source.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'mj' });
    firstRepo.publish();
    const saved = source.saveCorrectionDraft({ reason: 'Motif durable', items: [{ pathParts: ['carac', 'cc', 'base'], baseValue: 30, value: 31 }] });
    assert.deepEqual(saved, { ok: true });

    const playerRepo = fakeRepository(fixture(1));
    const player = createFicheController({ repository: playerRepo, draftStore: createFicheDraftStore({ storage, makeSessionId: () => 'session-joueur-00000001' }) });
    player.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'joueur' });
    playerRepo.publish();
    assert.deepEqual(player.listOtherCorrectionDraftSessions(), []);
    assert.deepEqual(player.saveCorrectionDraft({ reason: 'forgé', items: [] }), { ok: false, reason: 'not-authorized' });

    const targetRepo = fakeRepository(fixture(2));
    const target = createFicheController({ repository: targetRepo, draftStore: createFicheDraftStore({ storage, makeSessionId: () => 'session-mj-0000000003' }) });
    target.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'mj' });
    targetRepo.publish();
    const available = target.listOtherCorrectionDraftSessions();
    assert.equal(available.length, 1);
    assert.equal(target.getState().data.carac?.cc, undefined, 'la découverte d’un brouillon ne l’applique pas');
    const restored = target.loadCorrectionDraftSession(available[0].sessionId);
    assert.equal(restored.reason, 'Motif durable');
    assert.deepEqual(restored.items[0], { pathParts: ['carac', 'cc', 'base'], baseValue: 30, value: 31 });
    assert.deepEqual(target.getState().data, fixture(2).data, 'la lecture explicite du brouillon ne déclenche pas son application');
});

test('repository ne propose que snapshot et callable, jamais une écriture Firestore directe', async () => {
    const ref = { path: 'fiches/bhelgi' };
    let subscribed;
    const commandCalls = [];
    const repository = createFicheRepository({
        db: {}, doc: (_db, collection, id) => ({ path: `${collection}/${id}` }),
        onSnapshot: (target, next) => { subscribed = { target, next }; return () => {}; },
        callCommand: async command => { commandCalls.push(command); return { data: { revision: 2 } }; },
        callMigration: async payload => ({ data: payload }),
    });
    const values = [];
    repository.subscribe('bhelgi', value => values.push(value));
    assert.equal(subscribed.target.path, ref.path);
    subscribed.next({ exists: () => true, data: () => fixture() });
    assert.equal(values[0].envelope.schemaVersion, 2);
    await repository.execute({ type: 'purchase' });
    assert.equal(commandCalls.length, 1);
    assert.throws(() => repository.subscribe('../other', () => {}), /Personnage invalide/u);
});

test('repository lit historique et présence, et les heartbeats ne ciblent que le document de session', async () => {
    const subscriptions = [];
    const writes = [];
    const repository = createFicheRepository({
        db: {}, doc: (_db, name, id) => id === undefined
            ? { path: `${_db.path}/${name}` } : { path: `${name}/${id}` },
        collection: (parent, name) => ({ path: `${parent.path}/${name}` }),
        query: (target, ...constraints) => ({ target, constraints }),
        orderBy: (...args) => ({ orderBy: args }), limit: count => ({ limit: count }),
        onSnapshot: (target, next) => { subscriptions.push({ target, next }); return () => {}; },
        callCommand: async () => ({ data: {} }),
        setDoc: async (...args) => writes.push(args), deleteDoc: async (...args) => writes.push(['delete', ...args]),
        serverTimestamp: () => 'SERVER_TIMESTAMP',
    });
    let history;
    repository.subscribeHistory('bhelgi', value => { history = value; });
    assert.equal(subscriptions[0].target.target.path, 'fiches/bhelgi/history');
    assert.deepEqual(subscriptions[0].target.constraints.at(-1), { limit: 30 });
    subscriptions[0].next({ docs: [{ id: 'op-1', data: () => ({ revision: 2, type: 'purchase' }) }] });
    assert.deepEqual(history, [{ id: 'op-1', revision: 2, type: 'purchase' }]);

    let presence;
    repository.subscribePresence('bhelgi', value => { presence = value; });
    subscriptions[1].next({ docs: [{ id: 'session-a', data: () => ({ role: 'joueur' }) }] });
    assert.deepEqual(presence, [{ id: 'session-a', role: 'joueur' }]);
    await repository.heartbeatPresence('bhelgi', 'session-a', { uid: 'u1', displayName: 'Test', role: 'joueur' });
    assert.equal(writes[0][0].path, 'fiches/bhelgi/presence/session-a');
    assert.deepEqual(writes[0][1], { uid: 'u1', displayName: 'Test', role: 'joueur', lastSeenAt: 'SERVER_TIMESTAMP' });
    await repository.removePresence('bhelgi', 'session-a');
    assert.deepEqual(writes[1], ['delete', { path: 'fiches/bhelgi/presence/session-a' }]);
});

test('repository observe la version publiée du catalogue sans exposer un chemin d’écriture', () => {
    const subscriptions = [];
    const repository = createFicheRepository({
        db: {}, doc: (_db, collection, id) => ({ path: `${collection}/${id}` }),
        onSnapshot: (target, next) => { subscriptions.push({ target, next }); return () => {}; },
        callCommand: async () => ({ data: {} }),
    });
    let published;
    repository.subscribePublicCatalogue(value => { published = value; });
    assert.equal(subscriptions[0].target.path, 'referentiels/public');
    subscriptions[0].next({ exists: () => true, data: () => ({ revision: 3, catalogue: { catalogVersion: 'sha256:current' } }) });
    assert.deepEqual(published, { catalogVersion: 'sha256:current' });
    subscriptions[0].next({ exists: () => false, data: () => null });
    assert.equal(published, null);
    assert.equal('publishCatalogue' in repository, false);
});

test('auth generation ignore les snapshots d’une session précédente et les fiches V1 sont lecture seule', () => {
    const repository = fakeRepository();
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }), makeOperationId: () => 'op' });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    const stale = repository.listeners[0];
    controller.setSession({ uid: 'uid-b', charId: 'caelel', role: 'joueur' });
    stale.next({ exists: true, envelope: fixture(4, { nom: 'stale' }) });
    assert.equal(controller.getState().phase, 'loading');
    repository.publish(fixture(2, { nom: 'current' }));
    assert.equal(controller.getState().data.nom, 'current');

    repository.publish({ data: { nom: 'legacy' }, revision: 2 });
    assert.equal(controller.getState().phase, 'legacy-readonly');
    assert.deepEqual(controller.stagePatch({ nom: 'change' }), { ok: false, reason: 'not-editable' });
});

test('patch merge les champs sans conflit, mais bloque les collisions jusqu’au choix explicite', async () => {
    const repository = fakeRepository(fixture(1));
    const controller = createFicheController({
        repository,
        draftStore: createFicheDraftStore({ storage: memoryStorage() }),
        makeOperationId: () => 'patch-op',
        receiptTimeoutMs: 20,
    });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    assert.deepEqual(controller.stagePatch({ nom: 'Local' }), { ok: true, hasDraft: true });
    repository.publish(fixture(2, { race: 'Nain' }));
    assert.deepEqual(controller.getState().conflicts, []);
    assert.equal(controller.getState().data.race, 'Nain', 'les champs distants propres sont repris pendant le brouillon');
    const saved = await controller.submitPatch();
    assert.equal(saved.status, 'saved');
    assert.equal(repository.commands[0].baseRevision, 1);
    assert.equal(repository.commands[0].payload.baseValues.nom, 'Albrecht');
    assert.equal(controller.getState().hasDraft, false);

    assert.deepEqual(controller.stagePatch({ nom: 'Autre' }), { ok: true, hasDraft: true });
    repository.publish(fixture(4, { nom: 'Serveur' }));
    assert.equal(controller.getState().conflicts[0].path, 'nom');
    assert.deepEqual(await controller.submitPatch(), { status: 'blocked', reason: 'conflict' });
    assert.equal(controller.resolveConflict('nom', 'local'), true);
    assert.equal(controller.getState().conflicts.length, 0);
    const rebased = await controller.submitPatch();
    assert.equal(rebased.status, 'saved');
    assert.equal(repository.commands.at(-1).payload.baseValues.nom, 'Serveur');
});

test('patch encodé prend en charge les noms de compétence et IDs stables ponctués sans renommer les lignes', () => {
    const storage = memoryStorage();
    const repository = fakeRepository(fixture(1, { skillsAdvanced: [{ id: 'row.id:1', nom: 'Dressage', adv: 0, note: '' }] }));
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage }), makeOperationId: () => 'patch-op' });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    const encodedRowPath = 'skillsAdvanced.row%2Eid%3A1.note';
    assert.deepEqual(controller.stagePatch({ [encodedRowPath]: 'ancien détour' }), { ok: true, hasDraft: true });
    assert.equal(controller.getState().data.skillsAdvanced[0].note, 'ancien détour');
    assert.deepEqual(controller.stagePatch({ 'basicSpecs.Divertissement%20%28Chant%29': 'Chant' }), { ok: true, hasDraft: true });
    assert.deepEqual(controller.stagePatch({ 'basicSpecs.%5F%5Fproto%5F%5F': 'pollué' }), { ok: false, reason: 'field-forbidden' });
    assert.deepEqual(controller.stagePatch({ 'favoriteSkills.3': 'basic:Esquive' }), { ok: true, hasDraft: true });
    assert.equal(controller.getState().data.favoriteSkills['3'], 'basic:Esquive');
    assert.deepEqual(controller.stagePatch({ 'favoriteSkills.6': 'basic:Esquive' }), { ok: false, reason: 'field-forbidden' });
});

test('un nouveau champ prend la valeur serveur récente comme base et les segments prototype sont refusés', () => {
    const repository = fakeRepository(fixture(1));
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }) });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    controller.stagePatch({ nom: 'Local' });
    repository.publish(fixture(2, { race: 'Nain' }));
    controller.stagePatch({ race: 'Elfe' });
    assert.equal(controller.getState().conflicts.length, 0);
    assert.equal(controller.getState().data.race, 'Elfe');
    const paths = ['nom', 'race'];
    assert.deepEqual(paths.map(path => controller.getState().data[path]), ['Local', 'Elfe']);
});

test('une session par onglet empêche les écrasements et propose la récupération uniquement sur demande', () => {
    const storage = memoryStorage();
    const storeA = createFicheDraftStore({ storage, makeSessionId: () => 'tab-a' });
    const storeB = createFicheDraftStore({ storage, makeSessionId: () => 'tab-b' });
    const repoA = fakeRepository(fixture(1));
    const controllerA = createFicheController({ repository: repoA, draftStore: storeA });
    controllerA.setSession({ uid: 'uid-shared', charId: 'bhelgi', role: 'joueur' });
    repoA.publish();
    controllerA.stagePatch({ nom: 'Brouillon onglet A' });

    const repoB = fakeRepository(fixture(2, { race: 'Nain' }));
    const controllerB = createFicheController({ repository: repoB, draftStore: storeB });
    controllerB.setSession({ uid: 'uid-shared', charId: 'bhelgi', role: 'joueur' });
    repoB.publish();
    assert.equal(controllerB.getState().data.nom, 'Albrecht');
    assert.equal(controllerB.listOtherDraftSessions()[0].sessionId, 'tab-a');
    assert.equal(controllerB.restoreDraftSession('tab-a'), true);
    assert.equal(controllerB.getState().data.nom, 'Brouillon onglet A');
    assert.equal(controllerB.getState().conflicts.length, 0);
    assert.equal(controllerB.getState().data.race, 'Nain');
});

test('achats restent en ligne, sans mutation optimiste, et retry réutilise le même operationId', async () => {
    let online = true;
    const repository = fakeRepository(fixture(1));
    const controller = createFicheController({
        repository,
        draftStore: createFicheDraftStore({ storage: memoryStorage() }),
        makeOperationId: () => 'purchase-op',
        isOnline: () => online,
        receiptTimeoutMs: 20,
    });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    online = false;
    await assert.rejects(controller.executeOnlineCommand('purchase', { kind: 'skill' }), /connexion/u);
    online = true;
    repository.setFailNext();
    await assert.rejects(controller.executeOnlineCommand('purchase', { kind: 'skill' }), { code: 'unavailable' });
    assert.equal(repository.commands[0].operationId, 'purchase-op');
    assert.equal(controller.getState().data.xpLog.length, 0);
    const result = await controller.retryPendingCommand();
    assert.equal(result.status, 'confirmed');
    assert.equal(repository.commands[1].operationId, 'purchase-op');
    assert.equal(controller.getState().data.xpLog.length, 0);
});

test('reset conserve le tombstone quand le snapshot arrive avant ou après le reçu', async () => {
    for (const delivery of ['before-receipt', 'after-receipt']) {
        const listeners = [];
        let current = { ...fixture(1), tombstone: false };
        const repository = {
            subscribe(_charId, next) { listeners.push(next); next({ exists: true, envelope: current }); return () => {}; },
            async execute(command) {
                assert.equal(command.type, 'reset');
                const tombstone = { schemaVersion: 2, revision: 2, tombstone: true, data: {} };
                const publish = () => { current = tombstone; for (const listener of listeners) listener({ exists: true, envelope: current }); };
                if (delivery === 'before-receipt') publish();
                else globalThis.setTimeout(publish, 0);
                return { operationId: command.operationId, revision: 2 };
            },
        };
        const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }),
            makeOperationId: () => `reset-${delivery}`, receiptTimeoutMs: 100 });
        controller.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'mj' });
        const result = await controller.executeOnlineCommand('reset', { reason: 'Test fixture reset' });
        assert.equal(result.status, 'confirmed');
        assert.equal(controller.getState().phase, 'tombstone');
        assert.equal(controller.getState().data?.nom, undefined);
        controller.close();
    }
});

test('un import échoué depuis une fiche absente ou réinitialisée garde sa phase verrouillée', async () => {
    for (const initial of [null, { schemaVersion: 2, revision: 4, tombstone: true, data: {} }]) {
        const repository = {
            subscribe(_charId, next) { next(initial
                ? { exists: true, envelope: initial }
                : { exists: false, envelope: null }); return () => {}; },
            async execute() { throw Object.assign(new Error('Import refusé'), { code: 'permission-denied' }); },
        };
        const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }) });
        controller.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'mj' });
        await assert.rejects(controller.executeOnlineCommand('import', { reason: 'Test fixture import', data: { nom: 'Test' } }), { code: 'permission-denied' });
        assert.equal(controller.getState().phase, initial ? 'tombstone' : 'missing');
        controller.close();
    }
});

test('un import confirmé depuis un tombstone revient à la phase prête du nouveau snapshot', async () => {
    const listeners = [];
    const tombstone = { schemaVersion: 2, revision: 4, tombstone: true, data: {} };
    const restored = fixture(5, { nom: 'Import confirmé' });
    const repository = {
        subscribe(_charId, next) { listeners.push(next); next({ exists: true, envelope: tombstone }); return () => {}; },
        async execute(command) {
            assert.equal(command.type, 'import');
            for (const listener of listeners) listener({ exists: true, envelope: restored });
            return { operationId: command.operationId, revision: 5 };
        },
    };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }) });
    controller.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'mj' });
    const result = await controller.executeOnlineCommand('import', { reason: 'Test fixture import', data: { nom: 'Import confirmé' } });
    assert.equal(result.status, 'confirmed');
    assert.equal(controller.getState().phase, 'ready');
    assert.equal(controller.getState().data.nom, 'Import confirmé');
    controller.close();
});

test('un reçu reset arrivé après déconnexion ne rétablit pas la fiche ni le tombstone', async () => {
    let listener;
    let resolveCommand;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const repository = {
        subscribe(_charId, next) { listener = next; next({ exists: true, envelope: fixture(1) }); return () => {}; },
        execute(command) {
            markStarted();
            return new Promise(resolve => { resolveCommand = () => resolve({ operationId: command.operationId, revision: 2 }); });
        },
    };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }) });
    controller.setSession({ uid: 'uid-mj', charId: 'bhelgi', role: 'mj' });
    const pending = controller.executeOnlineCommand('reset', { reason: 'Test fixture reset' });
    await started;
    controller.setSession(null);
    listener({ exists: true, envelope: { schemaVersion: 2, revision: 2, tombstone: true, data: {} } });
    resolveCommand();
    assert.deepEqual(await pending, { status: 'stale' });
    assert.equal(controller.getState().phase, 'signed-out');
    assert.equal(controller.getState().data, null);
    controller.close();
});

test('un patch incertain garde son opération, accepte de nouvelles saisies et exige un retry explicite', async () => {
    const repository = fakeRepository(fixture(1));
    const controller = createFicheController({
        repository,
        draftStore: createFicheDraftStore({ storage: memoryStorage() }),
        makeOperationId: () => 'patch-retry-op',
        receiptTimeoutMs: 20,
    });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    controller.stagePatch({ nom: 'Premier' });
    repository.setFailNext();
    await assert.rejects(controller.submitPatch(), { code: 'unavailable' });
    controller.stagePatch({ race: 'Nain' });
    assert.deepEqual(await controller.submitPatch(), { status: 'retry-required', operationId: 'patch-retry-op' });
    const receipt = await controller.retryPendingPatch();
    assert.equal(receipt.status, 'saved');
    assert.equal(repository.commands[0].operationId, 'patch-retry-op');
    assert.equal(repository.commands[1].operationId, 'patch-retry-op');
    assert.equal(controller.getState().data.nom, 'Premier');
    assert.equal(controller.getState().data.race, 'Nain');
});

test('une intention égale à la base reste en attente si elle contredit un patch déjà en vol', async () => {
    const listeners = [];
    let current = fixture(1, { nom: 'A' });
    let release;
    let started;
    let executionCount = 0;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const repository = {
        subscribe(_charId, next) { listeners.push(next); return () => {}; },
        publish(value) { current = value; for (const next of listeners) next({ exists: true, envelope: value }); },
        async execute(command) {
            started(command);
            if (++executionCount === 1) await new Promise(resolve => { release = resolve; });
            current = envelope(current.revision + 1, { ...current.data, nom: command.payload.changes.nom });
            this.publish(current);
            return { operationId: command.operationId, revision: current.revision };
        },
    };
    let id = 0;
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }), makeOperationId: () => `in-flight-${++id}`, receiptTimeoutMs: 20 });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish(current);
    controller.stagePatch({ nom: 'B' });
    const sending = controller.submitPatch();
    await startedPromise;
    controller.stagePatch({ nom: 'A' });
    assert.equal(controller.getState().data.nom, 'A');
    release();
    assert.equal((await sending).status, 'saved');
    assert.equal(controller.getState().data.nom, 'A');
    assert.equal(controller.getState().hasDraft, true);
    assert.equal((await controller.submitPatch()).status, 'saved');
    assert.equal(controller.getState().data.nom, 'A');
});

test('un écrit distant postérieur à l’acquittement révèle le conflit B/C/D', async () => {
    const listeners = [];
    let current = fixture(1, { nom: 'A' });
    let release;
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const repository = {
        subscribe(_charId, next) { listeners.push(next); return () => {}; },
        publish(value) { current = value; for (const next of listeners) next({ exists: true, envelope: value }); },
        async execute(command) {
            started(command);
            await new Promise(resolve => { release = resolve; });
            current = envelope(2, { ...current.data, nom: 'B' });
            this.publish(current);
            current = envelope(3, { ...current.data, nom: 'D' });
            this.publish(current);
            return { operationId: command.operationId, revision: 2 };
        },
    };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }), makeOperationId: () => 'bcd', receiptTimeoutMs: 20 });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish(current);
    controller.stagePatch({ nom: 'B' });
    const sending = controller.submitPatch();
    await startedPromise;
    controller.stagePatch({ nom: 'C' });
    release();
    assert.equal((await sending).status, 'saved');
    assert.deepEqual(controller.getState().conflicts[0], { path: 'nom', base: 'B', local: 'C', server: 'D' });
});

test('l’adaptateur propage le retour à la base pour effacer une frappe encore en brouillon', () => {
    const repository = fakeRepository(fixture(1, { nom: 'A' }));
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }) });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    repository.publish();
    const adapter = createFichePatchAdapter(controller);
    adapter.stageData({ ...controller.getState().data, nom: 'B' });
    assert.equal(controller.getState().data.nom, 'B');
    adapter.stageData({ ...controller.getState().data, nom: 'A' });
    assert.equal(controller.getState().hasDraft, false);
    assert.equal(controller.getState().data.nom, 'A');
});

test('l’adaptateur conserve le retour à A pendant B en vol puis le rebase sur l’acquittement B', async () => {
    const listeners = [];
    let release;
    let calls = 0;
    const repository = {
        subscribe(_charId, next) { listeners.push(next); next({ exists: true, envelope: fixture(1, { nom: 'A' }) }); return () => {}; },
        execute(command) {
            calls += 1;
            if (calls === 1) return new Promise(resolve => { release = () => {
                const updated = fixture(2, { nom: 'B' });
                for (const listener of listeners) listener({ exists: true, envelope: updated });
                resolve({ operationId: command.operationId, revision: 2 });
            }; });
            const updated = fixture(3, { nom: command.payload.changes.nom });
            for (const listener of listeners) listener({ exists: true, envelope: updated });
            return Promise.resolve({ operationId: command.operationId, revision: 3 });
        },
    };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage: memoryStorage() }),
        makeOperationId: () => 'patch-op', receiptTimeoutMs: 20 });
    controller.setSession({ uid: 'uid-a', charId: 'bhelgi', role: 'joueur' });
    const adapter = createFichePatchAdapter(controller);
    adapter.stageData({ ...controller.getState().data, nom: 'B' });
    const saving = controller.submitPatch();
    await Promise.resolve();
    adapter.stageData({ ...controller.getState().data, nom: 'A' });
    assert.equal(controller.getState().data.nom, 'A');
    release();
    assert.equal((await saving).status, 'saved');
    assert.equal(controller.getState().data.nom, 'A');
    assert.equal(controller.getState().hasDraft, true);
    assert.equal(controller.getState().conflicts.length, 0);
    assert.equal((await controller.submitPatch()).status, 'saved');
    assert.equal(controller.getState().data.nom, 'A');
});

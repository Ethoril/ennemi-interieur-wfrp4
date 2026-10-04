import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPnjPositionsRepository } from '../js/data/pnj-positions-repository.js';

function fixture() {
    const listeners = [];
    const writes = [];
    const queries = [];
    const sdk = {
        collection: (_db, name) => ({ name }),
        doc: (_db, collection, id) => ({ collection, id }),
        documentId: () => '__name__',
        where: (field, op, value) => ({ field, op, value }),
        query: (collection, ...constraints) => {
            const query = { collection, constraints };
            queries.push(query);
            return query;
        },
        writeBatch: () => ({
            set: (ref, data) => writes.push({ ref, data }),
            commit: async () => {},
        }),
        serverTimestamp: () => 'SERVER_TIME',
        onSnapshot: (target, _options, onNext, onError) => {
            const listener = { target, onNext, onError, stopped: false };
            listeners.push(listener);
            return () => { listener.stopped = true; };
        },
    };
    return { sdk, listeners, writes, queries, client: { db: {} } };
}

async function pageFixture() {
    const source = await readFile('js/pnjs.js', 'utf8');
    const status = { textContent: '', dataset: {}, hidden: true };
    const timers = new Map();
    const subscriptions = [];
    const repository = { subscribeForIds(ids, onNext, onError) {
        const subscription = { ids, onNext, onError, stopped: false };
        subscriptions.push(subscription);
        return () => { subscription.stopped = true; };
    } };
    const context = {
        state: { nodes: [{ id: 'a' }, { id: 'b' }], isAdmin: false },
        bureauData: { positions: repository },
        positionsGeneration: 0, positionSaveSequence: 0, positionsSubscriptionKey: null,
        unsubscribePositions: null, positionReadErrorTimer: null,
        sharedGraphPositions: new Map(), graphNodeMemory: new Map(), draggingNodes: new Set(),
        document: { getElementById: () => status },
        globalThis: { setTimeout(fn) { const id = {}; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } },
        applySharedGraphPositions: () => false, resetCurveControls: () => {},
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function graphPositionStatus('), source.indexOf('async function saveGraphPosition(')), context);
    context.subscribeGraphPositions();
    const flushTimers = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
    return { context, status, subscriptions, flushTimers, timers };
}

test('masquer un PNJ annule le refus transitoire de son ancien abonnement aux positions', async () => {
    const f = await pageFixture();
    const old = f.subscriptions[0];
    old.onError({ kind: 'permission', code: 'permission-denied' });
    assert.equal(f.status.hidden, true);
    assert.equal(f.timers.size, 1);
    f.context.state.nodes = [{ id: 'b' }];
    f.context.subscribeGraphPositions();
    assert.equal(old.stopped, true);
    assert.deepEqual(Array.from(f.subscriptions[1].ids), ['b']);
    f.subscriptions[1].onNext([{ id: 'b', x: 10, y: 20 }], { fromCache: false });
    f.flushTimers();
    old.onError({ kind: 'permission' });
    f.flushTimers();
    assert.equal(f.status.hidden, true);
    assert.equal(f.context.sharedGraphPositions.get('b').x, 10);
});

test('un véritable échec de lecture reste signalé puis disparaît après reprise', async () => {
    const f = await pageFixture();
    f.subscriptions[0].onError({ kind: 'offline' });
    assert.equal(f.status.dataset.kind, 'read-error');
    assert.equal(f.status.hidden, false);
    f.subscriptions[0].onNext([], { fromCache: false, hasPendingWrites: false });
    assert.equal(f.status.hidden, true);
    f.subscriptions[0].onError({ kind: 'permission' });
    f.flushTimers();
    assert.equal(f.status.dataset.kind, 'read-error');
    f.context.state.nodes = [{ id: 'b' }];
    f.context.subscribeGraphPositions();
    f.subscriptions[1].onNext([], { fromCache: false });
    assert.equal(f.status.hidden, true);
});

test('la lecture ne masque pas une erreur de sauvegarde et la déconnexion annule le message différé', async () => {
    const f = await pageFixture();
    f.context.graphPositionStatus('Position non enregistrée.', 'error');
    f.subscriptions[0].onNext([], { fromCache: false });
    assert.equal(f.status.textContent, 'Position non enregistrée.');
    f.subscriptions[0].onError({ kind: 'permission' });
    f.context.resetPositionSubscriptions();
    f.flushTimers();
    assert.equal(f.status.hidden, true);
    assert.equal(f.timers.size, 0);
});

test('save ne persiste que les coordonnées, avec horodatage serveur, et valide les entrées', async () => {
    const f = fixture();
    const repository = createPnjPositionsRepository({ ...f, role: 'public' });
    await repository.save('npc-1', { x: 1000000, y: -25 });
    assert.deepEqual(f.writes, [{
        ref: { collection: 'pnj_positions', id: 'npc-1' },
        data: { x: 1000000, y: -25, updatedAt: 'SERVER_TIME' },
    }]);
    await assert.rejects(repository.save('bad/id', { x: 1, y: 2 }), { kind: 'validation' });
    await assert.rejects(repository.save('npc-1', { x: Infinity, y: 2 }), { kind: 'validation' });
    await assert.rejects(repository.save('npc-1', { x: 1000001, y: 2 }), { kind: 'validation' });
    assert.equal(f.writes.length, 1);
    repository.close();
});

test('abonnement public cible uniquement les IDs visibles par lots compatibles avec les règles', () => {
    const f = fixture();
    const repository = createPnjPositionsRepository({ ...f, role: 'public' });
    const ids = Array.from({ length: 23 }, (_, index) => `npc-${index}`);
    const received = [];
    const stop = repository.subscribeForIds(ids, (rows, metadata) => received.push({ rows, metadata }));
    assert.deepEqual(f.queries.map(query => query.constraints.at(-1).value.length), [5, 5, 5, 5, 3]);
    assert.ok(f.queries.every(query => query.collection.name === 'pnj_positions'));
    assert.ok(f.queries.every(query => query.constraints.at(-1).field === '__name__' && query.constraints.at(-1).op === 'in'));
    f.listeners.forEach((listener, index) => listener.onNext({
        docs: [{ id: ids[index * 5], data: () => ({ x: index, y: 4, updatedAt: 'ts', nom: 'ignored' }) }],
        metadata: { fromCache: true, hasPendingWrites: index === 1 },
    }));
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].rows.map(({ id, x, y, updatedAt }) => ({ id, x, y, updatedAt })), [
        { id: 'npc-0', x: 0, y: 4, updatedAt: 'ts' },
        { id: 'npc-10', x: 2, y: 4, updatedAt: 'ts' },
        { id: 'npc-15', x: 3, y: 4, updatedAt: 'ts' },
        { id: 'npc-20', x: 4, y: 4, updatedAt: 'ts' },
        { id: 'npc-5', x: 1, y: 4, updatedAt: 'ts' },
    ]);
    assert.deepEqual(received[0].metadata, { fromCache: true, hasPendingWrites: true });
    stop();
    assert.ok(f.listeners.every(listener => listener.stopped));
    repository.close();
});

test('MJ seul peut écouter tous les documents de position', () => {
    const f = fixture();
    const publicRepository = createPnjPositionsRepository({ ...f, role: 'public' });
    assert.throws(() => publicRepository.subscribeAll(() => {}), { kind: 'permission' });
    const mj = createPnjPositionsRepository({ ...f, role: 'mj' });
    const values = [];
    const stop = mj.subscribeAll(rows => values.push(rows));
    f.listeners.at(-1).onNext({ docs: [
        { id: 'b', data: () => ({ x: 2, y: 3, updatedAt: null }) },
        { id: 'a', data: () => ({ x: NaN, y: 1 }) },
    ] });
    assert.deepEqual(values, [[{ id: 'b', x: 2, y: 3, updatedAt: null }]]);
    stop();
    publicRepository.close();
    mj.close();
});

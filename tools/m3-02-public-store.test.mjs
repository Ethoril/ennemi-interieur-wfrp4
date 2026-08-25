import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicStore, createPreferenceStore } from '../js/mobile/store.js';
import { createAppLifecycle } from '../js/mobile/lifecycle.js';
import { createPublicSessionComposition } from '../js/mobile/public-composition.js';
import { publicStatusMessage } from '../js/mobile/ui.js';
import { selectPnjDetailModel } from '../js/mobile/views/pnj-detail.js';
import { selectPnjsListModel } from '../js/mobile/views/pnjs-list.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function makeNavigator(online = true) {
    const listeners = new Map();
    return {
        onLine: online,
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); },
        emit: name => listeners.get(name)?.(),
        listenerCount: () => listeners.size,
    };
}

function makeRun({ online = true, cache = { mode: 'persistent', persistent: true, fallback: false }, repositoryFactory = null } = {}) {
    const navigatorRef = makeNavigator(online);
    const clients = [];
    const subscriptions = [];
    const visibleIds = [];
    const clientFactory = async () => {
        const client = { cache, closed: false, close: async () => { client.closed = true; } };
        clients.push(client);
        return client;
    };
    const makeRepository = name => ({
        subscribeVisible: (next, error, options) => {
            const subscription = { name, next, error, options, closed: false };
            subscriptions.push(subscription);
            return () => { subscription.closed = true; };
        },
        subscribeDiscovered: (next, error) => {
            const subscription = { name, next, error, closed: false };
            subscriptions.push(subscription);
            return () => { subscription.closed = true; };
        },
        setVisiblePnjIds: ids => { visibleIds.push([...ids]); },
    });
    const repositoryFactories = async context => repositoryFactory
        ? repositoryFactory({ context, makeRepository, subscriptions })
        : { pnjs: makeRepository('pnjs'), relations: makeRepository('relations'), indices: makeRepository('indices') };
    return { navigatorRef, clients, subscriptions, visibleIds, clientFactory, repositoryFactories };
}

function snapshot(items, metadata = {}) { return [items, { fromCache: metadata.fromCache === true, hasPendingWrites: metadata.hasPendingWrites === true }]; }

test('cache → serveur conserve la dernière confirmation et gèle profondément les données', async () => {
    const fake = makeRun();
    const store = createPublicStore({ ...fake, clock: (() => { let tick = 100; return () => ++tick; })() });
    await store.start();
    const [pnj, relation, indice] = fake.subscriptions;
    pnj.next(...snapshot([{ id: 'p1', nom: 'Ada', tags: ['allié'] }], { fromCache: true }));
    relation.next(...snapshot([{ id: 'r1', source: 'p1', cible: 'p2' }], { fromCache: true }));
    indice.next(...snapshot([{ id: 'i1', titre: 'Indice' }], { fromCache: true }));
    assert.equal(store.getState().connection.sync, 'cache');
    pnj.next(...snapshot([{ id: 'p1', nom: 'Ada distante' }], { hasPendingWrites: true }));
    assert.equal(store.getState().resources.pnjs.lastServerAt, null);
    pnj.next(...snapshot([{ id: 'p1', nom: 'Ada distante' }]));
    relation.next(...snapshot([{ id: 'r1', source: 'p1', cible: 'p2' }]));
    indice.next(...snapshot([{ id: 'i1', titre: 'Indice' }]));
    const state = store.getState();
    assert.equal(state.connection.sync, 'server');
    assert.ok(state.connection.lastServerAt);
    assert.ok(state.resources.pnjs.lastServerAt);
    assert.ok(Object.isFrozen(state.resources.pnjs.items));
    assert.ok(Object.isFrozen(state.resources.pnjs.items[0]));
    assert.ok(Object.isFrozen(state.resources.pnjs.items[0].tags));
    assert.throws(() => { state.resources.pnjs.items[0].nom = 'muté'; }, TypeError);
    const confirmed = state.connection.lastServerAt;
    pnj.next(...snapshot([{ id: 'p1', nom: 'Copie locale' }], { fromCache: true }));
    assert.equal(store.getState().connection.lastServerAt, confirmed,
        'un snapshot cache ne doit pas effacer la dernière confirmation serveur');
    await store.stop();
});

test('premier lancement hors ligne puis cache reste explicitement hors ligne', async () => {
    const fake = makeRun({ online: false });
    const store = createPublicStore(fake);
    await store.start();
    const [pnj] = fake.subscriptions;
    pnj.error({ kind: 'offline', technicalCode: 'unavailable' });
    assert.equal(store.getState().connection.phase, 'offline-empty');
    pnj.next(...snapshot([{ id: 'p1', nom: 'Cache' }], { fromCache: true }));
    assert.equal(store.getState().connection.phase, 'offline-cache');
    fake.navigatorRef.onLine = true;
    fake.navigatorRef.emit('online');
    assert.equal(store.getState().connection.phase, 'syncing');
    await store.stop();
});

test('une erreur de collection isole la ressource et la permission reste identifiable', async () => {
    const fake = makeRun();
    const store = createPublicStore(fake);
    await store.start();
    const [pnj, relation, indice] = fake.subscriptions;
    pnj.next(...snapshot([{ id: 'p1' }]));
    relation.error({ kind: 'permission', technicalCode: 'permission-denied' });
    indice.next(...snapshot([{ id: 'i1' }]));
    assert.equal(store.getState().resources.pnjs.items.length, 1);
    assert.equal(store.getState().resources.indices.items.length, 1);
    assert.equal(store.getState().resources.relations.error.kind, 'permission');
    await store.stop();
});

test('dépublication propage la visibilité PNJ et ne conserve aucune liste publique ancienne', async () => {
    const fake = makeRun();
    const store = createPublicStore(fake);
    await store.start();
    const [pnj, relation] = fake.subscriptions;
    pnj.next(...snapshot([{ id: 'p1' }, { id: 'p2' }]));
    relation.next(...snapshot([{ id: 'r1', source: 'p1', cible: 'p2' }]));
    assert.equal(store.getState().resources.relations.items.length, 1);
    pnj.next(...snapshot([{ id: 'p1' }]));
    assert.deepEqual(store.getState().resources.pnjs.items.map(item => item.id), ['p1']);
    assert.deepEqual(store.getState().resources.relations.items, [],
        'le store doit filtrer la relation avant même une nouvelle émission du dépôt');
    assert.deepEqual(fake.visibleIds.at(-1), ['p1']);
    await store.stop();
});

test('trois cycles arrêt/reprise ferment les abonnements et ignorent les callbacks tardifs', async () => {
    const fake = makeRun();
    const store = createPublicStore(fake);
    for (let cycle = 0; cycle < 3; cycle += 1) {
        await store.start();
        const subscriptions = fake.subscriptions.slice(-3);
        await store.stop();
        assert.ok(subscriptions.every(subscription => subscription.closed));
        subscriptions[0].next([{ id: `stale-${cycle}` }], { fromCache: false });
        assert.equal(store.getState().resources.pnjs.items.length, 0);
    }
    assert.equal(fake.navigatorRef.listenerCount(), 0);
});

test('une souscription qui échoue annule immédiatement les précédentes', async () => {
    let firstUnsubscribed = false;
    const fake = makeRun({ repositoryFactory: ({ makeRepository }) => ({
        pnjs: { subscribeVisible: () => () => { firstUnsubscribed = true; } },
        relations: { subscribeVisible: () => { throw new Error('subscription failed'); } },
        indices: makeRepository('indices'),
    }) });
    const store = createPublicStore(fake);
    await store.start();
    assert.equal(firstUnsubscribed, true);
    assert.equal(store.getState().running, false);
    assert.equal(store.getState().error.kind, 'unknown');
});

test('arrêt et reprise pendant initialisation ne réutilisent pas le client obsolète', async () => {
    let resolveFirst;
    let calls = 0;
    let staleClosed = false;
    const fake = makeRun();
    const clientFactory = () => {
        calls += 1;
        if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
        return fake.clientFactory();
    };
    const store = createPublicStore({ ...fake, clientFactory });
    const first = store.start();
    await store.stop();
    const second = store.start();
    resolveFirst({ cache: { mode: 'persistent' }, close: async () => { staleClosed = true; } });
    await Promise.all([first, second]);
    assert.equal(store.getState().running, true);
    assert.equal(staleClosed, true);
    await store.stop();
});

test('un ancien stop lent ne remet pas une nouvelle génération à idle', async () => {
    let releaseClose;
    let clientNumber = 0;
    const fake = makeRun();
    const store = createPublicStore({
        ...fake,
        clientFactory: async () => {
            clientNumber += 1;
            if (clientNumber === 1) {
                return {
                    cache: { mode: 'persistent' },
                    close: () => new Promise(resolve => { releaseClose = resolve; }),
                };
            }
            return fake.clientFactory();
        },
    });
    await store.start();
    const stopping = store.stop();
    await store.start();
    assert.equal(store.getState().running, true);
    releaseClose();
    await stopping;
    assert.equal(store.getState().running, true);
    assert.notEqual(store.getState().connection.phase, 'idle');
    await store.stop();
});

test('un échec d’initialisation revient dans un état relançable', async () => {
    const fake = makeRun();
    let calls = 0;
    const store = createPublicStore({
        ...fake,
        clientFactory: async context => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error('indisponible'), { kind: 'offline' });
            return fake.clientFactory(context);
        },
    });
    await store.start();
    assert.equal(store.getState().running, false);
    assert.equal(store.getState().error.kind, 'offline');
    await store.restart();
    assert.equal(store.getState().running, true);
    await store.stop();
});

test('pagehide/pageshow bfcache arrêtent puis recréent une seule composition', async () => {
    const listeners = new Map();
    const windowRef = {
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: name => listeners.delete(name),
    };
    let mounts = 0;
    let stops = 0;
    const lifecycle = createAppLifecycle({ windowRef, startApp: () => { mounts += 1; return { stop: async () => { stops += 1; } }; } });
    assert.equal(mounts, 1);
    listeners.get('pagehide')();
    await Promise.resolve();
    assert.equal(stops, 1);
    listeners.get('pageshow')({ persisted: true });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(mounts, 2);
    listeners.get('pageshow')({ persisted: true });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(mounts, 2);
    await lifecycle.stop();
    assert.equal(stops, 2);
});

test('préférences hostiles, données privées et quota ne sortent pas de la allowlist', () => {
    let value = '{"version":1,"notes":"secret","blobUrl":"blob:private","theme":"invalid","filters":{"statut":["ok"]}}';
    const storage = { getItem: () => value, setItem: (_key, next) => { value = next; } };
    const preferences = createPreferenceStore({ storage });
    assert.deepEqual(preferences.read(), { version: 1, theme: 'dark', lastSection: 'pnjs', filters: { search: '', statut: ['ok'], groupe: [], lieu: [] } });
    const written = preferences.write({ version: 1, theme: 'parchment', notes: 'secret', token: 'private', filters: { lieu: ['Altdorf'], blob: ['blob:x'] } });
    assert.equal(written.theme, 'parchment');
    assert.doesNotMatch(value, /secret|blob:|token/iu);
    const quota = createPreferenceStore({ storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } } });
    assert.doesNotThrow(() => quota.write({ theme: 'parchment' }));
});

test('les modèles de vue distinguent hors-ligne, permission et cache avec reprise', () => {
    const resources = {
        pnjs: { status: 'error', items: [], error: { kind: 'permission' } },
        relations: { status: 'loading', items: [], error: null },
        indices: { status: 'loading', items: [], error: null },
    };
    const state = {
        resources,
        connection: { phase: 'error', sync: 'unknown', lastServerAt: null },
        preferences: { filters: { search: '' } },
    };
    assert.equal(selectPnjsListModel(state).kind, 'error');
    assert.equal(selectPnjsListModel(state).retry, true);
    assert.equal(selectPnjDetailModel(state, 'p1').kind, 'error');
    assert.match(publicStatusMessage(state), /refusé/iu);
    state.connection = { phase: 'offline-empty', sync: 'unknown', lastServerAt: null };
    assert.equal(selectPnjsListModel(state).kind, 'offline-empty');
    assert.equal(selectPnjDetailModel(state, 'p1').retry, true);
    state.error = null;
    state.resources.pnjs = { status: 'ready', items: [{ id: 'p1' }], error: null };
    state.connection = { phase: 'syncing', sync: 'cache', lastServerAt: 10 };
    assert.match(publicStatusMessage(state), /Données enregistrées/iu);
});

test('la composition injectable ne crée que les trois dépôts publics et ferme son client', async () => {
    const calls = [];
    let closed = false;
    const client = { cache: { mode: 'memory', fallback: true }, close: async () => { closed = true; } };
    const repository = method => ({ [method]: () => () => {} });
    const builders = {
        client: async input => { calls.push(['client', input]); return client; },
        pnjs: input => { calls.push(['pnjs', input]); return repository('subscribeVisible'); },
        relations: input => { calls.push(['relations', input]); return { ...repository('subscribeVisible'), setVisiblePnjIds() {} }; },
        indices: input => { calls.push(['indices', input]); return repository('subscribeDiscovered'); },
    };
    const sdk = Object.freeze({ public: true });
    const config = Object.freeze({ projectId: 'demo-public' });
    const session = createPublicSessionComposition({ sdk, config, builders, options: { navigatorRef: makeNavigator() } });
    await session.start();
    assert.deepEqual(calls.map(([name]) => name), ['client', 'pnjs', 'relations', 'indices']);
    assert.equal(calls[0][1].sdk, sdk);
    assert.equal(calls[0][1].config, config);
    assert.ok(calls.slice(1).every(([, input]) => input.client === client && input.sdk === sdk));
    await session.stop();
    assert.equal(closed, true);
});

test('la composition publique ne charge ni Auth ni écritures et la CSP reste minimale', () => {
    const runtime = read('js/mobile/public-runtime.js');
    assert.doesNotMatch(runtime, /getAuth|signIn|writeBatch|runTransaction|deleteField|arrayRemove/iu);
    assert.equal((runtime.match(/firebasejs\/10\.12\.0\//gu) || []).length, 3,
        'les trois modules CDN doivent partager la version Firebase validée par M2');
    const sdkBlock = runtime.match(/const firestoreSdk\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\);/u)?.[1];
    assert.ok(sdkBlock, 'la surface SDK publique doit rester inspectable');
    const sdkNames = sdkBlock.split(',').map(name => name.trim()).filter(Boolean).sort();
    assert.deepEqual(sdkNames, [
        'collection', 'deleteApp', 'doc', 'documentId', 'enableMultiTabIndexedDbPersistence',
        'enableNetwork', 'getApps', 'getFirestore', 'getStorage', 'initializeApp',
        'initializeFirestore', 'memoryLocalCache', 'onSnapshot', 'persistentLocalCache',
        'persistentMultipleTabManager', 'query', 'terminate', 'where',
    ].sort());
    assert.match(runtime, /createPublicSessionComposition/u);
    const html = read('app/index.html');
    assert.match(html, /script-src[^\n]*'self'[^\n]*https:\/\/www\.gstatic\.com/iu);
    assert.match(html, /connect-src[^\n]*https:\/\/firestore\.googleapis\.com/iu);
    assert.doesNotMatch(html, /connect-src[^\n]*\*\.googleapis\.com|firebasestorage|storage\.googleapis/iu);
});

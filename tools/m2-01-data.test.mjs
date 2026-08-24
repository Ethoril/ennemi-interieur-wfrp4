import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createMjMobileClient, createPublicMobileClient } from '../js/data/firebase-clients.js';
import { ERROR_KINDS, errorForUi, normalizeFirebaseError } from '../js/data/firebase-errors.js';
import {
    normalizeIndice, normalizePnjPrivate, normalizePnjPublic, normalizeRelation, normalizeTimestamp,
} from '../js/data/firebase-normalizers.js';

const config = { projectId: 'test-project', appId: 'test-app' };

function makeSdk({ persistent = true, probeFails = false } = {}) {
    const apps = [];
    const dbs = new Map();
    const calls = {
        initialize: 0, persistent: 0, memory: 0, terminate: 0, deleteApp: 0, signOut: 0, unsubscribe: 0, createdApps: [],
    };
    const sdk = {
        getApps: () => apps,
        initializeApp: (options, name) => {
            calls.initialize += 1;
            const app = { name, options: { ...options } };
            apps.push(app);
            calls.createdApps.push(app);
            return app;
        },
        initializeFirestore: (app, options) => {
            const db = { app, options };
            dbs.set(app, db);
            return db;
        },
        persistentLocalCache: options => {
            calls.persistent += 1;
            if (!persistent) throw Object.assign(new Error('quota'), { code: 'failed-precondition' });
            return { type: 'persistent', options };
        },
        persistentMultipleTabManager: () => ({ type: 'multi-tab' }),
        enableNetwork: async () => {
            if (probeFails) throw Object.assign(new Error('IndexedDB unavailable'), { code: 'unavailable' });
        },
        memoryLocalCache: () => {
            calls.memory += 1;
            return { type: 'memory' };
        },
        getFirestore: app => dbs.get(app) ?? sdk.initializeFirestore(app, { localCache: sdk.memoryLocalCache() }),
        getStorage: app => ({ app, kind: 'storage' }),
        getAuth: app => ({ app, kind: 'auth' }),
        onSnapshot: () => () => { calls.unsubscribe += 1; },
        signOut: async () => { calls.signOut += 1; },
        terminate: async () => { calls.terminate += 1; },
        deleteApp: async app => {
            calls.deleteApp += 1;
            const index = apps.indexOf(app);
            if (index >= 0) apps.splice(index, 1);
        },
    };
    return { sdk, calls, apps };
}

test('les normaliseurs imposent l’id du snapshot et échouent fermement sur les données risquées', () => {
    const pnj = normalizePnjPublic({ id: 'p-1', data: {
        id: 'falsifie', visibleJoueurs: 'oui', imagePath: 'portraits/p-1/../secret.webp',
        imageUrl: 'https://evil.example/image.webp', createdAt: 'hier', nom: 'Ada',
    } });
    assert.equal(pnj.id, 'p-1');
    assert.equal(pnj.visibleJoueurs, false);
    assert.equal(pnj.imagePath, null);
    assert.equal(pnj.imageUrl, null);
    assert.ok(pnj.issues.some(item => item.code === 'invalid-reference'));
    assert.equal(normalizePnjPrivate({ id: 'p-1', data: { notes: 4 } }).notes, '');

    const relation = normalizeRelation({ id: 'r-1', data: {
        source: 'p-1', cible: 'p-1', type: 'allié', color: 'red;url(javascript:1)', visibleJoueurs: true,
    } });
    assert.equal(relation.color, null);
    assert.equal(relation.visibleJoueurs, true);
    assert.ok(relation.issues.some(item => item.code === 'self-reference'));
    assert.ok(relation.issues.some(item => item.code === 'invalid-css-color'));

    const indice = normalizeIndice({ id: 'i-1', data: {
        titre: 'Indice', pnjsLies: Array.from({ length: 101 }, (_, index) => `p-${index}`), decouvert: 'true',
        imagePath: 'indices/i-1/image.webp',
    } });
    assert.equal(indice.decouvert, false);
    assert.equal(indice.pnjsLies.length, 100);
    assert.ok(indice.issues.some(item => item.code === 'too-many-references'));
});

test('les URLs legacy PNJ sont canoniques et ne relaient ni token ni userinfo', () => {
    const tokenized = normalizePnjPublic({ id: 'p-1', data: {
        visibleJoueurs: true,
        imageUrl: 'https://storage.googleapis.com/campagne-wrpg.firebasestorage.app/portraits/p-1/a.webp?alt=media&token=secret',
    } });
    assert.equal(tokenized.imageUrl, 'https://storage.googleapis.com/campagne-wrpg.firebasestorage.app/portraits/p-1/a.webp');
    assert.doesNotMatch(JSON.stringify(tokenized), /token=|secret/u);

    const userinfo = normalizePnjPublic({ id: 'p-1', data: {
        visibleJoueurs: true,
        imageUrl: 'https://user:secret@storage.googleapis.com/campagne-wrpg.firebasestorage.app/portraits/p-1/a.webp',
    } });
    assert.equal(userinfo.imageUrl, null);
    assert.ok(userinfo.issues.some(item => item.field === 'imageUrl'));
    assert.doesNotMatch(JSON.stringify(userinfo), /user:secret|secret/u);
});

test('un PNJ marqué en suppression est toujours masqué et signalé', () => {
    const marked = normalizePnjPublic({ id: 'p-1', data: { visibleJoueurs: true, suppressionEnCours: true } });
    assert.equal(marked.visibleJoueurs, false);
    assert.equal(marked.suppressionEnCours, true);
    assert.ok(marked.issues.some(item => item.code === 'suppression-in-progress'));

    const malformed = normalizePnjPublic({ id: 'p-2', data: { visibleJoueurs: true, suppressionEnCours: 'oui' } });
    assert.equal(malformed.visibleJoueurs, false);
    assert.equal(malformed.suppressionEnCours, false);
    assert.ok(malformed.issues.some(item => item.code === 'invalid-type' && item.field === 'suppressionEnCours'));
});

test('les timestamps normalisés sont comparables sans accepter une chaîne arbitraire', () => {
    assert.deepEqual(normalizeTimestamp(new Date(1700000000123)), { seconds: 1700000000, nanoseconds: 123000000 });
    assert.deepEqual(normalizeTimestamp({ seconds: 4, nanoseconds: 5 }), { seconds: 4, nanoseconds: 5 });
    assert.equal(normalizeTimestamp('2026-01-01'), null);
});

test('le client public utilise le cache persistant moderne, Storage, mais jamais Auth', async () => {
    const { sdk, calls } = makeSdk();
    sdk.getAuth = () => { throw new Error('Auth interdite au client public'); };
    const first = await createPublicMobileClient({ sdk, config });
    const second = await createPublicMobileClient({ sdk, config });
    assert.equal(first.auth, null);
    assert.equal(first.storage.kind, 'storage');
    assert.equal(first.cache.mode, 'persistent-multi-tab');
    assert.equal(calls.initialize, 1);
    assert.equal(calls.persistent, 1);
    await first.close();
    assert.equal(calls.terminate, 0);
    await second.close();
    assert.equal(calls.terminate, 1);
    assert.equal(calls.deleteApp, 1);
});

test('une configuration différente sous le même nom est refusée sans double initialisation', async () => {
    const { sdk, calls } = makeSdk();
    const client = await createPublicMobileClient({ sdk, config, appName: 'mobile-public-config-guard' });
    await assert.rejects(
        createPublicMobileClient({ sdk, config: { ...config, appId: 'other-app' }, appName: 'mobile-public-config-guard' }),
        error => error.kind === ERROR_KINDS.CONFLICT,
    );
    assert.equal(calls.initialize, 1);
    await client.close();
});

test('le client public retombe en mémoire et expose son état sans fuite technique dans le message', async () => {
    const { sdk, calls } = makeSdk({ persistent: false });
    const client = await createPublicMobileClient({ sdk, config, appName: 'mobile-public-fallback' });
    assert.equal(client.cache.mode, 'memory-fallback');
    assert.equal(client.cache.fallback, true);
    assert.equal(Object.hasOwn(client.cache, 'cause'), false);
    assert.doesNotThrow(() => JSON.stringify(client.cache));
    assert.equal(calls.memory, 1);
    assert.equal(calls.createdApps.length, 2);
    assert.equal(normalizeFirebaseError({ code: 'auth/network-request-failed' }).kind, ERROR_KINDS.OFFLINE);
    assert.equal(errorForUi({ code: 'permission-denied', message: 'secret backend detail' }).message.includes('secret'), false);
    await client.close();
});

test('close libère l’application même si la déconnexion Auth ou terminate échoue', async () => {
    const authDouble = makeSdk();
    authDouble.sdk.signOut = async () => {
        authDouble.calls.signOut += 1;
        throw Object.assign(new Error('offline'), { code: 'unavailable' });
    };
    const mj = await createMjMobileClient({ sdk: authDouble.sdk, config, appName: 'mobile-mj-close-auth-error' });
    await assert.rejects(mj.close(), error => error.kind === ERROR_KINDS.OFFLINE);
    assert.equal(authDouble.calls.terminate, 1);
    assert.equal(authDouble.calls.deleteApp, 1);

    const terminateDouble = makeSdk();
    terminateDouble.sdk.terminate = async () => {
        terminateDouble.calls.terminate += 1;
        throw Object.assign(new Error('shutdown failed'), { code: 'unavailable' });
    };
    const publicClient = await createPublicMobileClient({
        sdk: terminateDouble.sdk, config, appName: 'mobile-public-close-terminate-error',
    });
    await assert.rejects(publicClient.close(), error => error.kind === ERROR_KINDS.OFFLINE);
    assert.equal(terminateDouble.calls.deleteApp, 1);
});

test('une erreur Auth/Storage avant rendu nettoie une app MJ créée et permet un retry', async () => {
    const failing = makeSdk();
    const originalStorage = failing.sdk.getStorage;
    failing.sdk.getStorage = () => {
        throw Object.assign(new Error('storage offline'), { code: 'unavailable' });
    };
    await assert.rejects(
        createMjMobileClient({ sdk: failing.sdk, config, appName: 'mobile-mj-init-cleanup' }),
        error => error.kind === ERROR_KINDS.OFFLINE,
    );
    assert.equal(failing.apps.length, 0);
    assert.equal(failing.calls.deleteApp, 1);
    failing.sdk.getStorage = originalStorage;
    const retry = await createMjMobileClient({ sdk: failing.sdk, config, appName: 'mobile-mj-init-cleanup' });
    assert.equal(failing.apps.length, 1);
    await retry.close();
});

test('une app fournie par un autre propriétaire n’est pas supprimée si la fabrique échoue', async () => {
    const external = makeSdk();
    external.sdk.initializeApp(config, 'mobile-mj-external');
    external.sdk.getAuth = () => {
        throw Object.assign(new Error('auth unavailable'), { code: 'unavailable' });
    };
    await assert.rejects(
        createMjMobileClient({ sdk: external.sdk, config, appName: 'mobile-mj-external' }),
        error => error.kind === ERROR_KINDS.OFFLINE,
    );
    assert.equal(external.apps.length, 1);
    assert.equal(external.calls.deleteApp, 0);
});

test('une app publique externe ne reçoit pas de réinitialisation mémoire après échec persistant', async () => {
    const external = makeSdk();
    external.sdk.initializeApp(config, 'mobile-public-external');
    external.sdk.persistentLocalCache = () => {
        throw Object.assign(new Error('quota'), { code: 'failed-precondition' });
    };
    await assert.rejects(
        createPublicMobileClient({ sdk: external.sdk, config, appName: 'mobile-public-external' }),
        error => error.kind === ERROR_KINDS.CONFLICT,
    );
    assert.equal(external.apps.length, 1);
    assert.equal(external.calls.deleteApp, 0);
});

test('un échec Storage public nettoie l’app créée et permet un retry', async () => {
    const failing = makeSdk();
    const originalStorage = failing.sdk.getStorage;
    failing.sdk.getStorage = () => {
        throw Object.assign(new Error('storage unavailable'), { code: 'unavailable' });
    };
    await assert.rejects(
        createPublicMobileClient({ sdk: failing.sdk, config, appName: 'mobile-public-storage-cleanup' }),
        error => error.kind === ERROR_KINDS.OFFLINE,
    );
    assert.equal(failing.apps.length, 0);
    assert.equal(failing.calls.deleteApp, 1);
    failing.sdk.getStorage = originalStorage;
    const retry = await createPublicMobileClient({ sdk: failing.sdk, config, appName: 'mobile-public-storage-cleanup' });
    assert.equal(failing.apps.length, 1);
    await retry.close();
});

test('un fallback recréé peut devenir externe entre suppression et recréation sans le supprimer', async () => {
    const external = makeSdk({ persistent: false });
    const originalDelete = external.sdk.deleteApp;
    let injected = false;
    external.sdk.deleteApp = async app => {
        await originalDelete(app);
        if (!injected) {
            injected = true;
            external.sdk.initializeApp(config, 'mobile-public-injected-external');
        }
    };
    const originalStorage = external.sdk.getStorage;
    external.sdk.getStorage = app => {
        if (injected) throw Object.assign(new Error('storage unavailable'), { code: 'unavailable' });
        return originalStorage(app);
    };
    await assert.rejects(
        createPublicMobileClient({ sdk: external.sdk, config, appName: 'mobile-public-injected-external' }),
        error => error.kind === ERROR_KINDS.OFFLINE,
    );
    assert.equal(external.apps.length, 1);
    assert.equal(external.calls.deleteApp, 1);
    external.sdk.getStorage = originalStorage;
    const retry = await createPublicMobileClient({ sdk: external.sdk, config, appName: 'mobile-public-injected-external' });
    await retry.close();
});

test('un échec Storage du premier client ne supprime pas une base retenue par un second client', async () => {
    const shared = makeSdk();
    const originalStorage = shared.sdk.getStorage;
    let storageCalls = 0;
    shared.sdk.getStorage = app => {
        storageCalls += 1;
        if (storageCalls === 1) throw Object.assign(new Error('storage unavailable'), { code: 'unavailable' });
        return originalStorage(app);
    };
    const [failed, second] = await Promise.all([
        createPublicMobileClient({ sdk: shared.sdk, config, appName: 'mobile-public-shared-failure' })
            .then(value => ({ status: 'fulfilled', value }), error => ({ status: 'rejected', error })),
        createPublicMobileClient({ sdk: shared.sdk, config, appName: 'mobile-public-shared-failure' }),
    ]);
    assert.equal(failed.status, 'rejected');
    assert.equal(failed.error.kind, ERROR_KINDS.OFFLINE);
    assert.equal(shared.calls.deleteApp, 0);
    const third = await createPublicMobileClient({ sdk: shared.sdk, config, appName: 'mobile-public-shared-failure' });
    assert.equal(third.db, second.db);
    await second.close();
    assert.equal(shared.calls.deleteApp, 0);
    await third.close();
    assert.equal(shared.calls.deleteApp, 1);
});

test('deux handles MJ partagent la session et seul le dernier la ferme', async () => {
    const { sdk, calls } = makeSdk();
    const first = await createMjMobileClient({ sdk, config, appName: 'mobile-mj-shared' });
    const second = await createMjMobileClient({ sdk, config, appName: 'mobile-mj-shared' });
    await first.close();
    assert.equal(calls.signOut, 0);
    assert.equal(calls.terminate, 0);
    assert.equal(calls.deleteApp, 0);
    await second.close();
    assert.equal(calls.signOut, 1);
    assert.equal(calls.terminate, 1);
    assert.equal(calls.deleteApp, 1);
});

test('une recréation attend la fermeture lente et reçoit une nouvelle app et une nouvelle base', async () => {
    const { sdk, calls } = makeSdk();
    sdk.terminate = async () => {
        calls.terminate += 1;
        await delay(15);
    };
    const oldClient = await createPublicMobileClient({ sdk, config, appName: 'mobile-public-closing-race' });
    const oldApp = oldClient.app;
    const oldDb = oldClient.db;
    const closing = oldClient.close();
    const recreating = createPublicMobileClient({ sdk, config, appName: 'mobile-public-closing-race' });
    await delay(1);
    assert.equal(calls.initialize, 1);
    await closing;
    const newClient = await recreating;
    assert.equal(calls.initialize, 2);
    assert.notEqual(newClient.app, oldApp);
    assert.notEqual(newClient.db, oldDb);
    await newClient.close();
});

test('un échec de probe persistant recrée réellement le client en mémoire', async () => {
    const { sdk, calls } = makeSdk({ probeFails: true });
    const client = await createPublicMobileClient({ sdk, config, appName: 'mobile-public-probe-fallback' });
    assert.equal(client.cache.mode, 'memory-fallback');
    assert.equal(calls.terminate, 1);
    assert.equal(calls.deleteApp, 1);
    assert.equal(calls.memory, 1);
    assert.equal(calls.createdApps.length, 2);
    assert.notEqual(client.app, calls.createdApps[0]);
    await client.close();
});

test('un client moderne sans probe explicite ne se déclare pas persistant', async () => {
    const { sdk, calls } = makeSdk();
    sdk.enableNetwork = undefined;
    const client = await createPublicMobileClient({ sdk, config, appName: 'mobile-public-no-probe' });
    assert.equal(client.cache.mode, 'memory-fallback');
    assert.equal(calls.createdApps.length, 2);
    await client.close();
});

test('un fallback public qui échoue en mémoire ne laisse aucune app orpheline et peut reprendre', async () => {
    const failing = makeSdk({ persistent: false });
    const originalMemory = failing.sdk.memoryLocalCache;
    failing.sdk.memoryLocalCache = () => {
        failing.calls.memory += 1;
        throw Object.assign(new Error('memory unavailable'), { code: 'failed-precondition' });
    };
    await assert.rejects(
        createPublicMobileClient({ sdk: failing.sdk, config, appName: 'mobile-public-fallback-cleanup' }),
        error => error.kind === ERROR_KINDS.UNKNOWN,
    );
    assert.equal(failing.apps.length, 0);
    assert.equal(failing.calls.deleteApp, 2);
    failing.sdk.memoryLocalCache = originalMemory;
    const retry = await createPublicMobileClient({ sdk: failing.sdk, config, appName: 'mobile-public-fallback-cleanup' });
    assert.equal(retry.cache.mode, 'memory-fallback');
    await retry.close();
});

test('une suppression d’application échouée reste un blocage fail-closed', async () => {
    const failing = makeSdk();
    const originalDelete = failing.sdk.deleteApp;
    failing.sdk.deleteApp = async () => {
        failing.calls.deleteApp += 1;
        throw Object.assign(new Error('delete unavailable'), { code: 'unavailable' });
    };
    const client = await createPublicMobileClient({ sdk: failing.sdk, config, appName: 'mobile-public-delete-failure' });
    await assert.rejects(client.close(), error => error.kind === ERROR_KINDS.OFFLINE);
    await assert.rejects(
        createPublicMobileClient({ sdk: failing.sdk, config, appName: 'mobile-public-delete-failure' }),
        error => error.kind === ERROR_KINDS.OFFLINE,
    );
    assert.equal(failing.apps.length, 1);
    failing.sdk.deleteApp = originalDelete;
});

test('le client MJ et son fallback public refusent un SDK sans cache mémoire explicite', async () => {
    const mjDouble = makeSdk();
    mjDouble.sdk.initializeFirestore = undefined;
    mjDouble.sdk.memoryLocalCache = undefined;
    await assert.rejects(
        createMjMobileClient({ sdk: mjDouble.sdk, config, appName: 'mobile-mj-no-memory' }),
        error => error.kind === ERROR_KINDS.VALIDATION,
    );

    const publicDouble = makeSdk();
    publicDouble.sdk.initializeFirestore = undefined;
    publicDouble.sdk.memoryLocalCache = undefined;
    await assert.rejects(
        createPublicMobileClient({ sdk: publicDouble.sdk, config, appName: 'mobile-public-no-memory' }),
        error => error.kind === ERROR_KINDS.VALIDATION,
    );
});

test('deux créations publiques concurrentes partagent une seule initialisation Firestore', async () => {
    const { sdk, calls } = makeSdk();
    sdk.enableNetwork = async () => {
        await delay(1);
    };
    const [first, second] = await Promise.all([
        createPublicMobileClient({ sdk, config, appName: 'mobile-public-concurrent' }),
        createPublicMobileClient({ sdk, config, appName: 'mobile-public-concurrent' }),
    ]);
    assert.equal(calls.persistent, 1);
    assert.equal(first.db, second.db);
    await first.close();
    await second.close();
});

test('le client MJ utilise explicitement la mémoire et nettoie Auth, listeners et application', async () => {
    const { sdk, calls } = makeSdk();
    const client = await createMjMobileClient({ sdk, config });
    assert.equal(client.cache.mode, 'memory');
    const unsubscribe = client.listen({}, () => {});
    assert.equal(typeof unsubscribe, 'function');
    await client.close();
    assert.equal(calls.memory, 1);
    assert.equal(calls.signOut, 1);
    assert.equal(calls.unsubscribe, 1);
    assert.equal(calls.terminate, 1);
    assert.equal(calls.deleteApp, 1);
});

test('la fermeture du client invalide aussi les callbacks SDK déjà en file', async () => {
    const double = makeSdk();
    const subscriptions = [];
    double.sdk.onSnapshot = (target, next, error) => {
        const subscription = { target, next, error, closed: false };
        subscriptions.push(subscription);
        return () => { subscription.closed = true; double.calls.unsubscribe += 1; };
    };
    const client = await createPublicMobileClient({ sdk: double.sdk, config, appName: 'mobile-public-listener-close' });
    let callbacks = 0;
    const unsubscribe = client.listen({ name: 'query' }, () => { callbacks += 1; });
    subscriptions.at(-1).next({ value: 1 });
    await client.close();
    subscriptions.at(-1).next({ value: 2 });
    unsubscribe();
    assert.equal(callbacks, 1);
    assert.equal(double.calls.unsubscribe, 1);
});

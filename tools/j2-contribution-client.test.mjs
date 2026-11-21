import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRIBUTION_HANDLERS, createContributionClient } from '../js/contributions/client-core.js';

function harness(capabilitiesByCall = []) {
    let authCallback;
    const calls = [];
    const auth = { currentUser: null };
    const sdk = {
        onAuthStateChanged(_auth, next) { authCallback = next; return () => { authCallback = null; }; },
        httpsCallable(_functions, name) {
            calls.push(name);
            return async data => ({ data: name === 'getCampaignCapabilities'
                ? capabilitiesByCall.shift() ?? { role: 'public', contribution: false, characterIds: [] }
                : { name, data } });
        },
    };
    const client = createContributionClient({ auth, functions: {}, sdk });
    return { client, calls, emit(user) { auth.currentUser = user; return authCallback?.(user); } };
}

test('client builds only named callable endpoints and unwraps their results', async () => {
    const app = harness();
    assert.deepEqual(app.calls, [...CONTRIBUTION_HANDLERS]);
    assert.deepEqual(await app.client.getContentEditContext({ kind: 'pnj', id: 'x' }), {
        name: 'getContentEditContext', data: { kind: 'pnj', id: 'x' },
    });
    assert.deepEqual(await app.client.listPendingPurgeCleanups({ limit: 1 }), {
        name: 'listPendingPurgeCleanups', data: { limit: 1 },
    });
});

test('unauthenticated and non-contributor sessions never gain contribution UI capability', async () => {
    const app = harness();
    const values = [];
    app.client.watch(value => values.push(value));
    await app.emit(null);
    await app.emit({ uid: 'u1', displayName: 'Joueur', emailVerified: true });
    assert.equal(values[0].capabilities.contribution, false);
    assert.equal(values[1].capabilities.role, 'public');
    assert.equal(values[1].capabilities.contribution, false);
});

test('verified callable capabilities are normalized and stale identity responses are discarded', async () => {
    let resolveOld;
    let callback;
    const auth = {};
    const sdk = {
        onAuthStateChanged(_auth, next) { callback = next; return () => {}; },
        httpsCallable(_functions, name) {
            return async () => ({ data: name !== 'getCampaignCapabilities' ? null : new Promise(resolve => { resolveOld = resolve; }) });
        },
    };
    const client = createContributionClient({ auth, functions: {}, sdk });
    const values = [];
    client.watch(value => values.push(value));
    const pending = callback({ uid: 'old', emailVerified: true, reload: async () => {} });
    await callback(null);
    resolveOld({ role: 'joueur', contribution: true, characterIds: ['bhelgi', 42] });
    await pending;
    assert.deepEqual(values.map(value => value.user?.uid ?? null), [null]);
});

test('unsubscribing a contribution session suppresses pending capability results', async () => {
    let callback;
    let resolveCall;
    const sdk = {
        onAuthStateChanged(_auth, next) { callback = next; return () => {}; },
        httpsCallable(_functions, name) { return async () => ({ data: name === 'getCampaignCapabilities' ? new Promise(resolve => { resolveCall = resolve; }) : null }); },
    };
    const client = createContributionClient({ auth: {}, functions: {}, sdk });
    const values = [];
    const stop = client.watch(value => values.push(value));
    const pending = callback({ uid: 'u', emailVerified: true, reload: async () => {} });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    stop();
    resolveCall({ role: 'joueur', contribution: true, characterIds: ['wren'] });
    await pending;
    assert.deepEqual(values, []);
});

test('multiple concurrent watchers share one auth observer, deduplicate capabilities and replay cache across remounts', async () => {
    let authSubscriptions = 0;
    let authUnsubscriptions = 0;
    let capabilityCalls = 0;
    let authCallback = null;
    const auth = { currentUser: null };
    const sdk = {
        onAuthStateChanged(_auth, next) {
            authSubscriptions += 1;
            authCallback = next;
            return () => { authUnsubscriptions += 1; authCallback = null; };
        },
        httpsCallable(_functions, name) {
            return async () => {
                if (name === 'getCampaignCapabilities') {
                    capabilityCalls += 1;
                    return { data: { role: 'joueur', contribution: true, characterIds: ['bhelgi'] } };
                }
                return { data: null };
            };
        },
    };
    const client = createContributionClient({ auth, functions: {}, sdk });
    const received = [[], [], []];
    const stops = received.map(bucket => client.watch(value => bucket.push(value)));
    assert.equal(authSubscriptions, 1, 'un seul observer onAuthStateChanged doit être partagé');
    const user = { uid: 'p1', displayName: 'Bhelgi', emailVerified: true, reload: async () => { throw new Error('transient'); } };
    auth.currentUser = user;
    await authCallback(user);
    assert.equal(capabilityCalls, 1, 'trois watchers concurrents ne déclenchent qu’un seul appel getCampaignCapabilities');
    for (const bucket of received) {
        assert.equal(bucket.length, 1);
        assert.deepEqual(bucket[0].capabilities.characterIds, ['bhelgi']);
    }
    stops.forEach(stop => stop());
    assert.equal(authUnsubscriptions, 1);

    // Remontage sur l'écran suivant (ex. PNJs -> Fiches) : rejeu immédiat du cache sans nouvel appel réseau
    const nextScreen = [];
    const stopNext = client.watch(value => nextScreen.push(value));
    assert.equal(nextScreen.length, 1);
    assert.deepEqual(nextScreen[0].capabilities.characterIds, ['bhelgi']);
    await authCallback(user);
    assert.equal(capabilityCalls, 1, 'un écran suivant réutilise le cache frais sans rappeler getCampaignCapabilities');

    // Changement d'identité / déconnexion invalide immédiatement le cache
    auth.currentUser = null;
    await authCallback(null);
    assert.equal(nextScreen.at(-1).user, null);
    stopNext();
});

test('refreshCapabilities retries after a transient error without requiring a new login', async () => {
    let calls = 0;
    let authCallback = null;
    const user = { uid: 'p2', displayName: 'Wren', emailVerified: true };
    const auth = { currentUser: user };
    const sdk = {
        onAuthStateChanged(_auth, next) { authCallback = next; return () => { authCallback = null; }; },
        httpsCallable(_functions, name) {
            return async () => {
                if (name !== 'getCampaignCapabilities') return { data: null };
                calls += 1;
                if (calls === 1) throw Object.assign(new Error('network'), { code: 'unavailable' });
                return { data: { role: 'joueur', contribution: true, characterIds: ['wren'] } };
            };
        },
    };
    const client = createContributionClient({ auth, functions: {}, sdk });
    const values = [];
    const errors = [];
    const stop = client.watch(value => values.push(value), error => errors.push(error));
    await authCallback(user);
    assert.equal(errors.length, 1);
    assert.equal(values.length, 0);
    await client.refreshCapabilities();
    assert.equal(calls, 2);
    assert.equal(values.length, 1);
    assert.deepEqual(values[0].capabilities.characterIds, ['wren']);
    stop();
});

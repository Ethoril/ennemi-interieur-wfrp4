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

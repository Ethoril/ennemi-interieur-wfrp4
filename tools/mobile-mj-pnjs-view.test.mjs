import test from 'node:test';
import assert from 'node:assert/strict';
import { createMjPnjsView } from '../js/mobile/mj-pnjs-view.js';
import { setImmediate } from 'node:timers';
import { selectPnjsListModel } from '../js/mobile/views/pnjs-list.js';
import { selectPnjDetailModel } from '../js/mobile/pnj-detail-model.js';

const visible = { id: 'pnj-visible', nom: 'Visible', visibleJoueurs: true };
const masque = { id: 'pnj-masque', nom: 'Masqué', visibleJoueurs: false };

function fakeStore() {
    const listeners = new Set();
    let state = Object.freeze({
        generation: 1,
        connection: { phase: 'live' },
        preferences: { filters: { search: '', quick: 'tous' } },
        resources: {
            pnjs: { status: 'ready', items: [visible], error: null },
            relations: { status: 'empty', items: [], error: null },
            indices: { status: 'empty', items: [], error: null },
        },
    });
    return {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        setPreferences(value) { state = Object.freeze({ ...state, preferences: { ...state.preferences, ...value } }); for (const l of listeners) l(state); },
        restart: () => 'restarted',
    };
}

function fakeMjSession() {
    const listeners = new Set();
    const subscriptions = { pnjs: 0, closed: 0 };
    const repositories = {
        pnjs: {
            subscribeAll(onData) {
                subscriptions.pnjs += 1;
                Promise.resolve().then(() => onData([visible, masque, { id: 'pnj-supprime', nom: 'X', suppressionEnCours: true }], {}));
                return () => { subscriptions.closed += 1; };
            },
        },
    };
    let state = { status: 'anonymous', role: null, user: null, private: null };
    return {
        subscriptions,
        getState: () => state,
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        set(next) { state = next; for (const l of listeners) l(state); },
        login() { this.set({ status: 'gm', role: 'mj', user: { uid: 'mj-1' }, private: { repositories } }); },
        logout() { this.set({ status: 'anonymous', role: null, user: null, private: null }); },
    };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const listIds = state => selectPnjsListModel(state).list.items.map(item => item.id).sort();

test('hors session MJ, la liste et la fiche ne montrent que les PNJs visibles', () => {
    const view = createMjPnjsView({ store: fakeStore(), mjSession: fakeMjSession() });
    view.start();
    assert.deepEqual(listIds(view.getState()), ['pnj-visible']);
    assert.equal(selectPnjDetailModel(view.getState(), 'pnj-masque').kind, 'empty');
    view.stop();
});

test('en session MJ, la liste montre aussi les PNJs masqués et la fiche les ouvre', async () => {
    const session = fakeMjSession();
    const view = createMjPnjsView({ store: fakeStore(), mjSession: session });
    view.start();
    session.login();
    await flush();
    assert.deepEqual(listIds(view.getState()), ['pnj-masque', 'pnj-visible']);
    const detail = selectPnjDetailModel(view.getState(), 'pnj-masque');
    assert.equal(detail.kind, 'ready');
    assert.equal(detail.masque, true);
    assert.equal(selectPnjDetailModel(view.getState(), 'pnj-visible').masque, false);
    view.stop();
});

test('à la déconnexion MJ, les PNJs masqués disparaissent et l’abonnement est fermé', async () => {
    const session = fakeMjSession();
    const view = createMjPnjsView({ store: fakeStore(), mjSession: session });
    const seen = [];
    view.start();
    view.subscribe(state => seen.push(listIds(state)));
    session.login();
    await flush();
    session.logout();
    assert.deepEqual(seen.at(-1), ['pnj-visible']);
    assert.equal(session.subscriptions.closed, 1);
    view.stop();
});

test('préférences et relance passent au store public', () => {
    const store = fakeStore();
    const view = createMjPnjsView({ store, mjSession: fakeMjSession() });
    view.setPreferences({ filters: { search: 'abc', quick: 'tous' } });
    assert.equal(store.getState().preferences.filters.search, 'abc');
    assert.equal(view.restart(), 'restarted');
});

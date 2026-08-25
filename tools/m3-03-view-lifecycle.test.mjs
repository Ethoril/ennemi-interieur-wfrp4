import test from 'node:test';
import assert from 'node:assert/strict';
import { createPnjsListView } from '../js/mobile/views/pnjs-list.js';

class FakeElement {
    constructor(documentRef, tagName, fragment = false) {
        this.ownerDocument = documentRef;
        this.tagName = tagName.toUpperCase();
        this.fragment = fragment;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.checked = false;
        this.hidden = false;
        this.scrollTop = 0;
    }

    get childNodes() { return this.children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { this.ownerDocument.activeElement = this; }
    append(...nodes) {
        for (const node of nodes) {
            if (node?.fragment) { this.append(...node.children.splice(0)); continue; }
            node.parentNode?.removeChild(node);
            node.parentNode = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        this.append(...nodes);
    }
    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) this.children.splice(index, 1);
        node.parentNode = null;
    }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) {
        const list = this.listeners.get(type) || [];
        list.push(listener);
        this.listeners.set(type, list);
    }
    removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
    }
    dispatch(type) {
        for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, target: this });
    }
    querySelectorAll(selector) {
        const output = [];
        const visit = node => {
            for (const child of node.children) {
                if (selector.startsWith('.') && child.className.split(/\s+/u).includes(selector.slice(1))) output.push(child);
                else if (!selector.includes(':') && !selector.includes('[') && child.tagName === selector.toUpperCase()) output.push(child);
                visit(child);
            }
        };
        visit(this);
        return output;
    }
}

function makeDocument() {
    const timers = new Map();
    let timerId = 0;
    const documentRef = {
        activeElement: null,
        createElement: tag => new FakeElement(documentRef, tag),
        createDocumentFragment: () => new FakeElement(documentRef, '#fragment', true),
        addEventListener() {},
        removeEventListener() {},
        defaultView: {
            setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
            clearTimeout(id) { timers.delete(id); },
        },
        runTimers() {
            const callbacks = [...timers.values()];
            timers.clear();
            callbacks.forEach(callback => callback());
        },
    };
    documentRef.body = new FakeElement(documentRef, 'body');
    documentRef.body.classList = { add() {}, remove() {} };
    return documentRef;
}

function readyState(items, filters = {}) {
    return {
        resources: { pnjs: { status: 'ready', items, error: null } },
        connection: { phase: 'ready', sync: 'server', lastServerAt: 10 },
        cache: { persistent: true },
        preferences: {
            filters: { search: '', statut: [], groupe: [], lieu: [], ...filters },
        },
        error: null,
    };
}

function publicPnj(id, overrides = {}) {
    return {
        id,
        nom: `Nom ${id}`,
        groupe: 'Garde',
        lieu: 'Altdorf',
        statut: 'Vivant',
        image: { path: `portraits/${id}/portrait.webp`, legacy: false, invalid: false },
        ...overrides,
    };
}

function makeStore(initial) {
    let state = initial;
    const listeners = new Set();
    const writes = [];
    const emit = next => { state = next; [...listeners].forEach(listener => listener(state)); };
    return {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        setPreferences(value) {
            writes.push(value);
            state = { ...state, preferences: { ...state.preferences, ...value } };
            [...listeners].forEach(listener => listener(state));
        },
        restart() {},
        emit,
        writes,
        listenerCount: () => listeners.size,
    };
}

function blobService() {
    const calls = [];
    const releases = [];
    return {
        calls,
        releases,
        loadObjectUrl(path) {
            calls.push(path);
            const release = () => releases.push(path);
            return Object.assign(Promise.resolve({ url: `blob:${path}`, release }), { release });
        },
    };
}

test('la vue branche le store, préserve le scroll et ne recharge pas les portraits sur metadata seule', async () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const firstItem = publicPnj('a');
    const store = makeStore(readyState([firstItem]));
    const images = blobService();
    const view = createPnjsListView({ container, store, getImageService: () => images });
    view.mount({ signal: { aborted: false } });
    await Promise.resolve();
    assert.equal(store.listenerCount(), 1);
    assert.equal(container.querySelectorAll('ul').length, 1);
    assert.equal(container.querySelectorAll('li').length, 1);
    assert.equal(container.querySelectorAll('output')[0].textContent, '1 résultat');
    assert.equal(container.querySelectorAll('.m-sync-badge').length, 0,
        'la liste PNJ ne duplique pas le statut global de synchronisation');
    assert.equal(images.calls.length, 1);

    container.scrollTop = 73;
    store.emit({ ...store.getState(), connection: { ...store.getState().connection, lastServerAt: 20 } });
    assert.equal(images.calls.length, 1, 'metadata seule ne doit pas recréer les portraits');
    assert.equal(container.scrollTop, 73);
    store.emit(readyState([publicPnj('a', { nom: 'Nom modifié' })]));
    await Promise.resolve();
    assert.equal(images.calls.length, 2);
    assert.equal(images.releases.length, 1);
    assert.equal(container.scrollTop, 73);
    view.unmount();
    assert.equal(store.listenerCount(), 0);
    assert.equal(images.releases.length, 2);
    assert.equal(documentRef.body.children.length, 0);
});

test('la recherche est temporisée, sauf effacement immédiat, et les filtres invalides sont réconciliés', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(readyState([publicPnj('a')], { groupe: ['Disparu'] }));
    const view = createPnjsListView({ container, store });
    view.mount({ signal: { aborted: false } });
    assert.deepEqual(store.getState().preferences.filters.groupe, []);
    const search = container.querySelectorAll('input')[0];
    search.value = 'A';
    search.dispatch('input');
    search.value = 'Al';
    search.dispatch('input');
    const beforeTimer = store.writes.length;
    documentRef.runTimers();
    assert.equal(store.writes.length, beforeTimer + 1);
    assert.equal(store.getState().preferences.filters.search, 'Al');
    search.value = '';
    search.dispatch('input');
    assert.equal(store.getState().preferences.filters.search, '');
    view.unmount();
});

test('la feuille de filtres se ferme si la ressource publique devient indisponible', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(readyState([publicPnj('a')]));
    const view = createPnjsListView({ container, store });
    view.mount({ signal: { aborted: false } });
    container.querySelectorAll('.m-filter-button')[0].dispatch('click');
    const dialog = documentRef.body.querySelectorAll('dialog')[0];
    assert.equal(dialog.getAttribute('open'), '');

    store.emit({
        ...store.getState(),
        resources: { pnjs: { status: 'loading', items: [], error: null } },
        connection: { phase: 'loading', sync: 'unknown' },
    });
    assert.equal(dialog.getAttribute('open'), null);
    view.unmount();
});

test('trois montages et un portrait tardif ne laissent ni callback ni listener', async () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(readyState([publicPnj('a')]));
    let resolvePortrait;
    let releases = 0;
    const loading = new Promise(resolve => { resolvePortrait = resolve; });
    loading.release = () => { releases += 1; };
    for (let cycle = 0; cycle < 3; cycle += 1) {
        const view = createPnjsListView({
            container,
            store,
            getImageService: () => ({ loadObjectUrl: () => loading }),
        });
        view.mount({ signal: { aborted: false } });
        view.unmount();
        assert.equal(store.listenerCount(), 0);
        assert.equal(documentRef.body.children.length, 0);
    }
    resolvePortrait({ url: 'blob:late', release: loading.release });
    await Promise.resolve();
    assert.equal(container.children.length, 0);
    assert.equal(releases, 3);
});

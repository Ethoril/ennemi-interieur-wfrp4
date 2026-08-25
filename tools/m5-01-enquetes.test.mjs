import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnquetesListModel, foldEnqueteSearch, selectEnquetesListModel, sortEnquetes } from '../js/mobile/enquete-list-model.js';
import { selectEnqueteDetailModel } from '../js/mobile/enquete-detail-model.js';
import { ownedIndicePath } from '../js/mobile/components/indice-image.js';
import { createEnquetesListView } from '../js/mobile/views/enquetes-list.js';
import { createEnqueteDetailView } from '../js/mobile/views/enquete-detail.js';
import { mountIndiceImage } from '../js/mobile/components/indice-image.js';
import { createRouter, parseRoute, ROUTE_NAMES } from '../js/mobile/router.js';

class FakeElement {
    constructor(documentRef, tagName = 'div') {
        this.ownerDocument = documentRef;
        this.tagName = tagName.toLowerCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.hidden = false;
        this.scrollTop = 0;
    }
    get childNodes() { return this.children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...nodes) { nodes.forEach(node => { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, target: this, currentTarget: this, preventDefault() {} }); }
    querySelectorAll(selector) {
        const output = [];
        const visit = node => {
            for (const child of node.children || []) {
                const classes = child.className.split?.(/\s+/u) || [];
                if (selector.startsWith('.') && classes.includes(selector.slice(1))) output.push(child);
                else if (/^[a-z]+$/u.test(selector) && child.tagName === selector) output.push(child);
                visit(child);
            }
        };
        visit(this);
        return output;
    }
}

function fakeDocument() {
    const documentRef = {
        activeElement: null,
        defaultView: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout },
        createElement: tag => new FakeElement(documentRef, tag),
        createTextNode: text => ({ parentNode: null, textContent: text, remove() {} }),
    };
    return documentRef;
}

function fakeStore(initial) {
    let state = initial;
    const listeners = new Set();
    return {
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        emit(next) { state = next; [...listeners].forEach(listener => listener(state)); },
        getState: () => state,
        setPreferences(value) { state = { ...state, preferences: { ...state.preferences, ...value } }; [...listeners].forEach(listener => listener(state)); },
        restart() {},
        listenerCount: () => listeners.size,
    };
}

function deferredImage() {
    let resolve;
    let releases = 0;
    const promise = new Promise(done => { resolve = done; });
    promise.release = () => { releases += 1; };
    return { promise, resolve, releases: () => releases };
}

const state = (indices, pnjs = [], overrides = {}) => ({
    resources: {
        indices: { status: 'ready', items: indices },
        pnjs: { status: 'ready', items: pnjs },
        relations: { status: 'ready', items: [] },
    },
    connection: { phase: 'ready', sync: 'server' },
    preferences: { enqueteSearch: '' },
    ...overrides,
});

test('la recherche des enquêtes ignore casse et accents sur titre, texte et PNJ public', () => {
    const items = [{ id: 'lettre', titre: 'L’Épée d’Azur', description: 'Une piste ancienne', decouvert: true, pnjsLies: ['a'] }];
    const pnjs = [{ id: 'a', nom: 'Éléonore d’Argent', visibleJoueurs: true }];
    const model = createEnquetesListModel({ items, pnjs });
    assert.equal(foldEnqueteSearch('  EPEE  '), 'epee');
    assert.equal(model.setSearch('piste').results.length, 1);
    assert.equal(model.setSearch('eleonore').results.length, 1);
    assert.equal(model.setSearch('AZUR').results.length, 1);
});

test('les indices secrets, PNJs masqués et liens invalides sont exclus du modèle public', () => {
    const model = createEnquetesListModel({ items: [
        { id: 'public', titre: 'Publié', decouvert: true, pnjsLies: ['visible', 'hidden', 'unknown'] },
        { id: 'secret', titre: 'Secret', decouvert: false, pnjsLies: ['visible'] },
    ], pnjs: [
        { id: 'visible', nom: 'Visible', visibleJoueurs: true },
        { id: 'hidden', nom: 'Secret', visibleJoueurs: false },
    ] });
    assert.deepEqual(model.getState().items.map(item => item.id), ['public']);
    assert.deepEqual(model.getState().items[0].pnjs.map(item => item.id), ['visible']);
    assert.equal(model.setSearch('secret').results.length, 0);
});

test('les issues de normalisation ferment les cartes et les timestamps hostiles ne changent pas le tri', () => {
    const model = createEnquetesListModel({ items: [
        { id: 'bad', titre: 'Visible malgré erreur', decouvert: true, issues: [{ field: 'titre' }] },
        { id: 'empty', titre: '', decouvert: true },
        { id: 'good', titre: 'Valide', decouvert: true, dateDecouverte: { seconds: '20', nanoseconds: 0 } },
    ], pnjs: [{ id: 'p', nom: 'Masqué', visibleJoueurs: true, issues: [{ field: 'nom' }] }] });
    assert.deepEqual(model.getState().items.map(item => item.id), ['good']);
    assert.deepEqual(model.getState().items[0].pnjs, []);
});

test('le tri est ordre puis date décroissante puis titre et identifiant', () => {
    const sorted = sortEnquetes([
        { id: 'z', titre: 'Même', decouvert: true, ordre: 2 },
        { id: 'a', titre: 'Même', decouvert: true, ordre: 2 },
        { id: 'b', titre: 'Ancien', decouvert: true, dateDecouverte: { seconds: 10, nanoseconds: 0 } },
        { id: 'c', titre: 'Récent', decouvert: true, dateDecouverte: { seconds: 20, nanoseconds: 0 } },
        { id: 'd', titre: 'Ordonné', decouvert: true, ordre: 1 },
    ]);
    assert.deepEqual(sorted.map(item => item.id), ['d', 'a', 'z', 'c', 'b']);
});

test('les états liste distinguent chargement, hors connexion initiale, erreur et vide', () => {
    assert.equal(selectEnquetesListModel(state([], [], { resources: { indices: { status: 'loading', items: [] }, pnjs: { status: 'ready', items: [] } } })).kind, 'loading');
    assert.equal(selectEnquetesListModel(state([], [], { connection: { phase: 'offline-empty' } })).kind, 'offline-empty');
    assert.equal(selectEnquetesListModel(state([], [], { error: { kind: 'unknown' } })).kind, 'error');
    assert.equal(selectEnquetesListModel(state([])).list.emptyState, 'none-discovered');
});

test('la fiche rend un indice public mais un identifiant absent ou secret de façon identique', () => {
    const common = state([{ id: 'secret', titre: 'Inavouable', decouvert: false }]);
    const absent = selectEnqueteDetailModel(state([]), 'secret');
    const secret = selectEnqueteDetailModel(common, 'secret');
    assert.equal(absent.kind, 'empty');
    assert.deepEqual(absent, secret);
    const visible = selectEnqueteDetailModel(state([{ id: 'public', titre: '<Indice>', description: '<script>', decouvert: true, pnjsLies: ['a'], image: { path: 'indices/public/clue.webp' } }], [{ id: 'a', nom: 'A', visibleJoueurs: true }]), 'public');
    assert.equal(visible.kind, 'ready');
    assert.equal(visible.item.titre, '<Indice>');
    assert.deepEqual(visible.item.pnjs.map(item => item.id), ['a']);
});

test('une fiche ne propose jamais un PNJ masqué et conserve le texte sur erreur image', () => {
    const model = selectEnqueteDetailModel(state([{ id: 'x', titre: 'X', description: 'Texte', decouvert: true, pnjsLies: ['a', 'b'], image: { path: 'indices/x/x.webp', invalid: true } }], [
        { id: 'a', nom: 'A', visibleJoueurs: true }, { id: 'b', nom: 'B', visibleJoueurs: false },
    ]), 'x');
    assert.equal(model.item.description, 'Texte');
    assert.deepEqual(model.item.pnjs.map(item => item.id), ['a']);
    assert.equal(model.item.image.path, 'indices/x/x.webp');
});

test('le service illustration est fail-closed sur les chemins hérités, invalides ou étrangers', () => {
    assert.equal(ownedIndicePath({ id: 'x', image: { path: 'indices/x/a.webp' } }), 'indices/x/a.webp');
    assert.equal(ownedIndicePath({ id: 'x', image: { path: 'portraits/x/a.webp' } }), null);
    assert.equal(ownedIndicePath({ id: 'x', image: { path: 'indices/y/a.webp' } }), null);
    assert.equal(ownedIndicePath({ id: 'x', image: { path: 'https://example.test/a.webp', legacy: true } }), null);
});

test('la préférence de recherche enquête reste séparée des filtres PNJ', async () => {
    const { sanitizePreferences } = await import('../js/mobile/store.js');
    const preferences = sanitizePreferences({ version: 1, enqueteSearch: 'lettre', filters: { search: 'garde' } });
    assert.equal(preferences.enqueteSearch, 'lettre');
    assert.equal(preferences.filters.search, 'garde');
});

test('la recherche couvre la fin d’une description publique normalisée', () => {
    const description = `${'a'.repeat(6000)} terme-final`;
    const model = createEnquetesListModel({ items: [{ id: 'long', titre: 'Long', description, decouvert: true }] });
    assert.equal(model.setSearch('terme-final').results.length, 1);
});

test('la liste DOM est sûre, conserve le scroll et ne recharge pas une image sur metadata seule', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const initial = state([{ id: 'a', titre: '<Indice>', description: '<script>non</script>', decouvert: true, pnjsLies: ['p'], image: { path: 'indices/a/a.webp' } }], [{ id: 'p', nom: '<PNJ>', visibleJoueurs: true }]);
    const store = fakeStore(initial);
    const pending = deferredImage();
    let imageLoads = 0;
    const view = createEnquetesListView({ container, store, getImageService: () => ({ loadObjectUrl: () => { imageLoads += 1; return pending.promise; } }) });
    view.mount();
    container.scrollTop = 37;
    assert.equal(imageLoads, 1);
    assert.equal(container.querySelectorAll('strong')[0].textContent, '<Indice>');
    assert.equal(container.querySelectorAll('script').length, 0);
    store.emit({ ...initial, connection: { ...initial.connection, sync: 'cache' } });
    assert.equal(imageLoads, 1);
    assert.equal(container.scrollTop, 37);
    view.unmount();
    assert.equal(store.listenerCount(), 0);
    assert.equal(pending.releases(), 1);
});

test('la liste retire immédiatement un PNJ masqué et la recherche vide est effaçable', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const initial = state([{ id: 'a', titre: 'Indice', decouvert: true, pnjsLies: ['p'] }], [{ id: 'p', nom: 'Visible', visibleJoueurs: true }]);
    const store = fakeStore(initial);
    const view = createEnquetesListView({ container, store });
    view.mount();
    const search = container.querySelectorAll('input')[0];
    search.value = 'inexistant';
    search.dispatch('input');
    return new Promise(resolve => globalThis.setTimeout(() => {
        assert.equal(container.querySelectorAll('.m-state-card').length, 1);
        const clear = container.querySelectorAll('button').find(button => button.textContent === 'Effacer la recherche');
        assert.ok(clear);
        clear.dispatch('click');
        assert.equal(store.getState().preferences.enqueteSearch, '');
        store.emit({ ...initial, resources: { ...initial.resources, pnjs: { status: 'ready', items: [{ id: 'p', nom: 'Masqué', visibleJoueurs: false }] } } });
        assert.equal(container.querySelectorAll('a').length, 1, 'seul le lien de la carte reste, le PNJ masqué disparaît');
        view.unmount();
        resolve();
    }, 130));
});

test('la fiche DOM isole les sections, libère une image dépubliée et ignore son chargement tardif', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const ready = state([{ id: 'a', titre: '<Indice>', description: '<texte>', decouvert: true, pnjsLies: ['p'], image: { path: 'indices/a/a.webp' } }], [{ id: 'p', nom: 'Public', visibleJoueurs: true }]);
    const store = fakeStore(ready);
    const pending = deferredImage();
    let loads = 0;
    const view = createEnqueteDetailView({ container, id: 'a', store, getImageService: () => ({ loadObjectUrl: () => { loads += 1; return pending.promise; } }) });
    view.mount();
    assert.equal(loads, 1);
    const description = container.querySelectorAll('.m-detail-description')[0];
    store.emit({ ...ready, connection: { ...ready.connection, sync: 'cache' } });
    assert.equal(loads, 1);
    assert.equal(container.querySelectorAll('.m-detail-description')[0], description);
    store.emit({ ...ready, resources: { ...ready.resources, pnjs: { status: 'ready', items: [{ id: 'p', nom: 'Masqué', visibleJoueurs: false }] } } });
    assert.equal(container.querySelectorAll('.m-detail-links a').length, 0);
    assert.equal(loads, 1);
    store.emit({ ...ready, resources: { ...ready.resources, indices: { status: 'ready', items: [] } } });
    assert.equal(container.querySelectorAll('.m-state-card')[0].children[0].textContent, 'Indice indisponible');
    assert.equal(pending.releases(), 1);
    pending.resolve({ url: 'blob:late', release: pending.promise.release });
    await Promise.resolve();
    assert.equal(container.querySelectorAll('img').length, 0);
    view.unmount();
    assert.equal(store.listenerCount(), 0);
});

test('trois cycles détail et image en erreur ne laissent ni listener ni image persistante', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const ready = state([{ id: 'a', titre: 'A', decouvert: true, image: { path: 'indices/a/a.webp' } }]);
    const store = fakeStore(ready);
    let releases = 0;
    for (let cycle = 0; cycle < 3; cycle += 1) {
        const pending = deferredImage();
        pending.promise.release = () => { releases += 1; };
        const view = createEnqueteDetailView({ container, id: 'a', store, getImageService: () => ({ loadObjectUrl: () => pending.promise }) });
        view.mount();
        view.unmount();
        pending.resolve({ url: 'blob:late', release: pending.promise.release });
        await Promise.resolve();
    }
    assert.equal(store.listenerCount(), 0);
    assert.equal(releases, 3);
});

test('une erreur de chargement d’illustration conserve le placeholder et libère une seule fois', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'span');
    const pending = deferredImage();
    const handle = mountIndiceImage({ container, item: { id: 'a', image: { path: 'indices/a/a.webp' } }, imageService: { loadObjectUrl: () => pending.promise } });
    pending.resolve({ url: 'blob:a', release: pending.promise.release });
    await Promise.resolve();
    const image = container.querySelectorAll('img')[0];
    assert.ok(image);
    image.dispatch('error');
    assert.equal(container.querySelectorAll('img').length, 0);
    assert.equal(container.querySelectorAll('.m-indice-image-placeholder').length, 1);
    handle.dispose();
    assert.equal(pending.releases(), 1);
});

test('les miniatures attendent réellement IntersectionObserver et se déconnectent avant intersection', () => {
    const documentRef = fakeDocument();
    let callback;
    let observed = 0;
    let disconnected = 0;
    documentRef.defaultView.IntersectionObserver = class {
        constructor(next) { callback = next; }
        observe() { observed += 1; }
        disconnect() { disconnected += 1; }
    };
    const container = new FakeElement(documentRef, 'span');
    const pending = deferredImage();
    let loads = 0;
    const view = mountIndiceImage({ container, lazy: true, item: { id: 'a', image: { path: 'indices/a/a.webp' } }, imageService: { loadObjectUrl: () => { loads += 1; return pending.promise; } } });
    assert.equal(observed, 1);
    callback([{ isIntersecting: false, intersectionRatio: 0 }]);
    assert.equal(loads, 0);
    view.dispose();
    view.dispose();
    assert.equal(loads, 0);
    assert.equal(disconnected, 1);

    const secondContainer = new FakeElement(documentRef, 'span');
    const second = mountIndiceImage({ container: secondContainer, lazy: true, item: { id: 'b', image: { path: 'indices/b/b.webp' } }, imageService: { loadObjectUrl: () => { loads += 1; return pending.promise; } } });
    callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    assert.equal(loads, 1);
    second.dispose();
    assert.equal(disconnected, 2);
});

test('les routes enquêtes et leur scroll sont restaurés, avec section active distincte', () => {
    assert.deepEqual(parseRoute('#/enquetes'), { name: ROUTE_NAMES.ENQUETES });
    assert.deepEqual(parseRoute('#/enquetes/indice_1'), { name: ROUTE_NAMES.ENQUETE, id: 'indice_1' });
    const listeners = new Map();
    const windowRef = {
        location: { hash: '#/enquetes' },
        history: { pushState: (_state, _title, hash) => { windowRef.location.hash = hash; }, replaceState: (_state, _title, hash) => { windowRef.location.hash = hash; } },
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
        scrollY: 0,
    };
    let scroll = 12;
    const router = createRouter({ windowRef, mountRoute: () => ({ mount() {}, unmount() {} }), getScrollY: () => scroll, setScrollY: value => { scroll = value; } });
    router.start();
    scroll = 89;
    router.navigate({ name: ROUTE_NAMES.ENQUETE, id: 'a' });
    scroll = 4;
    router.back();
    assert.equal(scroll, 89);
    router.stop();
});

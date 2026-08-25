import test from 'node:test';
import assert from 'node:assert/strict';
import { selectPnjDetailModel } from '../js/mobile/pnj-detail-model.js';
import { createPnjDetailView } from '../js/mobile/views/pnj-detail.js';

const baseState = (pnjs, relations = [], indices = []) => ({
    generation: 4,
    resources: {
        pnjs: { status: 'ready', items: pnjs },
        relations: { status: 'ready', items: relations },
        indices: { status: 'ready', items: indices },
    },
    connection: { phase: 'ready', sync: 'server', lastServerAt: 1 },
    cache: { persistent: true },
});

test('la fiche masque pareil un identifiant absent, masqué ou dépublié', () => {
    const absent = selectPnjDetailModel(baseState([]), 'secret');
    const masked = selectPnjDetailModel(baseState([{ id: 'secret', nom: 'Secret', visibleJoueurs: false }]), 'secret');
    const deleting = selectPnjDetailModel(baseState([{
        id: 'secret', nom: 'Secret', visibleJoueurs: true, suppressionEnCours: true,
    }]), 'secret');
    const publicState = baseState([{ id: 'secret', nom: 'Secret', visibleJoueurs: true }]);
    const publicModel = selectPnjDetailModel(publicState, 'secret');
    assert.equal(absent.kind, 'empty');
    assert.deepEqual(absent, masked);
    assert.deepEqual(absent, deleting);
    assert.notDeepEqual(absent, publicModel);
    assert.equal(absent.message, 'Ce PNJ est indisponible.');
});

test('les relations miroir et les extrémités non publiques sont filtrées', () => {
    const model = selectPnjDetailModel(baseState([
        { id: 'a', nom: 'A', visibleJoueurs: true },
        { id: 'b', nom: 'B', visibleJoueurs: true },
        { id: 'hidden', nom: 'Secret', visibleJoueurs: false },
    ], [
        { id: 'ab', reciprocalId: 'ba', source: 'a', cible: 'b', type: 'allié', label: 'allié',
            color: null, style: 'solid', visibleJoueurs: true },
        { id: 'ba', reciprocalId: 'ab', source: 'b', cible: 'a', type: 'allié', label: 'allié',
            color: null, style: 'solid', visibleJoueurs: true },
        { id: 'ax', source: 'a', cible: 'hidden', label: 'secret', visibleJoueurs: true },
    ]), 'a');
    assert.deepEqual(model.relations.map(relation => relation.otherId), ['b']);
    assert.equal(model.relations[0].label, 'allié');
});

test('seuls les indices découverts liés au PNJ sont proposés', () => {
    const model = selectPnjDetailModel(baseState([{ id: 'a', nom: 'A', visibleJoueurs: true }], [], [
        { id: 'found', titre: 'Trouvé', decouvert: true, pnjsLies: ['a'] },
        { id: 'secret', titre: 'Secret', decouvert: false, pnjsLies: ['a'] },
        { id: 'other', titre: 'Autre', decouvert: true, pnjsLies: ['b'] },
    ]), 'a');
    assert.deepEqual(model.indices.map(indice => indice.id), ['found']);
});

test('le modèle de fiche ne projette pas les champs privés même si le store est contaminé', () => {
    const model = selectPnjDetailModel(baseState([{
        id: 'a', nom: 'A', visibleJoueurs: true, notes: 'MJ', suppressionEnCours: false,
        image: { path: 'https://user:secret@example.test/a.webp?token=secret', legacy: false,
            invalid: false, token: 'secret' },
    }]), 'a');
    assert.equal(model.item.notes, undefined);
    assert.equal(model.item.suppressionEnCours, undefined);
    assert.equal(model.item.image.token, undefined);
    assert.equal(model.item.image.path, null);
});

test('deux relations distinctes de même libellé ne sont pas confondues sans miroir exact', () => {
    const model = selectPnjDetailModel(baseState([
        { id: 'a', nom: 'A', visibleJoueurs: true },
        { id: 'b', nom: 'B', visibleJoueurs: true },
    ], [
        { id: 'ab-1', source: 'a', cible: 'b', type: 'allié', label: 'Contact', visibleJoueurs: true },
        { id: 'ab-2', source: 'a', cible: 'b', type: 'rival', label: 'Contact', visibleJoueurs: true },
    ]), 'a');
    assert.deepEqual(model.relations.map(relation => relation.id), ['ab-1', 'ab-2']);
});

class FakeElement {
    constructor(documentRef, tagName) {
        this.ownerDocument = documentRef;
        this.tagName = tagName;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.href = '';
    }
    get childNodes() { return this.children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, target: this }); }
    querySelectorAll(selector) {
        const output = [];
        const visit = node => {
            for (const child of node.children) {
                if (selector.startsWith('.') && child.className.split(/\s+/u).includes(selector.slice(1))) output.push(child);
                else if (!selector.includes(':') && !selector.includes('[')
                    && child.tagName === selector.toLowerCase()) output.push(child);
                visit(child);
            }
        };
        visit(this);
        return output;
    }
}

function fakeDocument() {
    const documentRef = { createElement: tag => new FakeElement(documentRef, tag), activeElement: null };
    return documentRef;
}

function makeStore(initial) {
    let state = initial;
    const listeners = new Set();
    return {
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        emit(next) { state = next; [...listeners].forEach(listener => listener(state)); },
        listenerCount: () => listeners.size,
        restart() {},
    };
}

function sectionBody(container, key) {
    return container.querySelectorAll('.m-detail-section')
        .find(section => section.dataset.section === key)?.children[1];
}

test('la vue rend des liens publics sûrs et ne remplace que la section liée qui change', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const pnjs = [
        { id: 'a', nom: '<Agnès>', description: '<script>privé</script>', visibleJoueurs: true },
        { id: 'b', nom: 'Berta', visibleJoueurs: true },
        { id: 'c', nom: 'Clara', visibleJoueurs: true },
    ];
    const first = baseState(pnjs, [
        { id: 'ab', source: 'a', cible: 'b', label: '<Alliée>', visibleJoueurs: true },
    ], [{ id: 'indice_1', titre: '<Lettre>', decouvert: true, pnjsLies: ['a'] }]);
    const store = makeStore(first);
    let backCalls = 0;
    const view = createPnjDetailView({ container, id: 'a', store, onBack: () => { backCalls += 1; } });
    view.mount();
    assert.equal(store.listenerCount(), 1);
    assert.equal(container.querySelectorAll('.m-detail-name')[0].textContent, '<Agnès>');
    assert.equal(sectionBody(container, 'description').children[0].textContent, '<script>privé</script>');
    assert.deepEqual(container.querySelectorAll('a').map(link => link.href), ['#/pnjs/b', '#/enquetes/indice_1']);
    const identityContent = sectionBody(container, 'identity').children[0];
    const relationContent = sectionBody(container, 'relations').children[0];
    const indiceContent = sectionBody(container, 'indices').children[0];
    const firstPortrait = container.querySelectorAll('.m-portrait-frame')[0];

    store.emit(baseState([{ ...pnjs[0], nom: 'Agnès renommée' }, ...pnjs.slice(1)], [
        { id: 'ab', source: 'a', cible: 'b', label: '<Alliée>', visibleJoueurs: true },
        { id: 'ac', source: 'a', cible: 'c', label: 'Contact', visibleJoueurs: true },
    ], [{ id: 'indice_1', titre: '<Lettre>', decouvert: true, pnjsLies: ['a'] }]));
    assert.equal(sectionBody(container, 'identity').children[0], identityContent);
    assert.notEqual(sectionBody(container, 'relations').children[0], relationContent);
    assert.equal(sectionBody(container, 'indices').children[0], indiceContent);
    assert.notEqual(container.querySelectorAll('.m-portrait-frame')[0], firstPortrait);
    assert.equal(container.querySelectorAll('.m-portrait-placeholder')[0].textContent, 'AR');
    assert.deepEqual(container.querySelectorAll('a').map(link => link.href),
        ['#/pnjs/b', '#/pnjs/c', '#/enquetes/indice_1']);
    container.querySelectorAll('button').at(-1).dispatch('click');
    assert.equal(backCalls, 1);
    view.unmount();
    assert.equal(store.listenerCount(), 0);
});

test('une dépublication ferme immédiatement la fiche, ses liens et son portrait en vol', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const ready = baseState([
        { id: 'a', nom: 'A', visibleJoueurs: true, image: { path: 'portraits/a/a.webp' } },
        { id: 'b', nom: 'B', visibleJoueurs: true },
    ], [{ id: 'ab', source: 'a', cible: 'b', label: 'Allié', visibleJoueurs: true }]);
    const store = makeStore(ready);
    let resolveImage;
    let releases = 0;
    const loading = new Promise(resolve => { resolveImage = resolve; });
    loading.release = () => { releases += 1; };
    const view = createPnjDetailView({ container, id: 'a', store,
        getImageService: () => ({ loadObjectUrl: () => loading }) });
    view.mount();
    assert.equal(container.querySelectorAll('a').length, 1);
    store.emit(baseState([{ id: 'a', nom: 'A', visibleJoueurs: false }]));
    assert.equal(container.querySelectorAll('a').length, 0);
    assert.equal(container.querySelectorAll('h2')[0].textContent, 'PNJ indisponible');
    assert.equal(releases, 1);
    resolveImage({ url: 'blob:late', release: loading.release });
    await Promise.resolve();
    assert.equal(releases, 1);
    assert.equal(container.querySelectorAll('img').length, 0);
    view.unmount();
});

test('la fiche en cache reste lisible pendant le chargement des données liées', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const state = baseState([{ id: 'a', nom: 'A', visibleJoueurs: true }]);
    state.resources.relations = { status: 'loading', items: [], error: null };
    state.resources.indices = { status: 'loading', items: [], error: null };
    state.connection = { phase: 'offline-cache', sync: 'cache', lastServerAt: 1 };
    const store = makeStore(state);
    const view = createPnjDetailView({ container, id: 'a', store });
    view.mount();
    assert.match(container.querySelectorAll('.m-sync-badge')[0].textContent, /Hors connexion/iu);
    assert.equal(sectionBody(container, 'relations').children[0].textContent, 'Chargement des relations visibles…');
    assert.equal(sectionBody(container, 'indices').children[0].textContent, 'Chargement des indices découverts…');
    view.unmount();
});

test('trois cycles libèrent le portrait asynchrone et empêchent son retour', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const state = baseState([{ id: 'a', nom: 'A', visibleJoueurs: true, image: { path: 'portraits/a/a.webp' } }]);
    const store = makeStore(state);
    let resolveImage;
    let releases = 0;
    const loading = new Promise(resolve => { resolveImage = resolve; });
    loading.release = () => { releases += 1; };
    for (let cycle = 0; cycle < 3; cycle += 1) {
        const view = createPnjDetailView({ container, id: 'a', store,
            getImageService: () => ({ loadObjectUrl: () => loading }) });
        view.mount({ signal: { aborted: false } });
        view.unmount();
        assert.equal(store.listenerCount(), 0);
    }
    resolveImage({ url: 'blob:late', release: loading.release });
    await Promise.resolve();
    assert.equal(releases, 3);
    assert.equal(container.children.length, 0);
});

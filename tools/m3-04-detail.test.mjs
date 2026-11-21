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
        this.hidden = false;
        this.disabled = false;
        this.multiple = false;
        this.selected = false;
        this.checked = false;
        this.files = [];
        this._value = '';
        this._type = '';
    }
    get childNodes() { return this.children; }
    get value() {
        if (this.tagName === 'select' && this.children.length) return this.children.find(option => option.selected)?.value ?? this._value;
        return this._value;
    }
    set value(value) {
        this._value = String(value ?? '');
        if (this.tagName === 'select' && !this.multiple) {
            for (const option of this.children) option.selected = option.value === this._value;
        }
    }
    get type() { return this._type; }
    set type(value) { this._type = value; }
    get selectedOptions() { return this.children.filter(option => option.selected); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    prepend(node) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.unshift(node); }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    closest(tag) {
        let node = this;
        while (node && node.tagName !== tag) node = node.parentNode;
        return node || null;
    }
    showModal() { this.open = true; }
    close() { this.open = false; }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    async dispatch(type) {
        await Promise.all([...(this.listeners.get(type) || [])].map(listener => listener({ type, target: this, preventDefault() {} })));
    }
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
    const documentRef = {
        defaultView: { crypto: { randomUUID: () => 'detail-op-1' }, confirm: () => true },
        createElement: tag => new FakeElement(documentRef, tag),
        createTextNode: value => { const node = new FakeElement(documentRef, '#text'); node.textContent = value; return node; },
        activeElement: null,
    };
    documentRef.body = new FakeElement(documentRef, 'body');
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
    assert.deepEqual(container.querySelectorAll('a').map(link => link.href), ['#/pnjs/b', '#/enquetes/a']);
    assert.equal(sectionBody(container, 'identity'), undefined, 'l’identification vit désormais dans le bandeau');
    const descriptionContent = sectionBody(container, 'description').children[0];
    const relationContent = sectionBody(container, 'relations').children[0];
    const indiceContent = sectionBody(container, 'indices').children[0];
    const firstPortrait = container.querySelectorAll('.m-portrait-frame')[0];

    store.emit(baseState([{ ...pnjs[0], nom: 'Agnès renommée' }, ...pnjs.slice(1)], [
        { id: 'ab', source: 'a', cible: 'b', label: '<Alliée>', visibleJoueurs: true },
        { id: 'ac', source: 'a', cible: 'c', label: 'Contact', visibleJoueurs: true },
    ], [{ id: 'indice_1', titre: '<Lettre>', decouvert: true, pnjsLies: ['a'] }]));
    assert.equal(sectionBody(container, 'description').children[0], descriptionContent);
    assert.notEqual(sectionBody(container, 'relations').children[0], relationContent);
    assert.equal(sectionBody(container, 'indices').children[0], indiceContent);
    assert.notEqual(container.querySelectorAll('.m-portrait-frame')[0], firstPortrait);
    assert.equal(container.querySelectorAll('.m-portrait-placeholder')[0].textContent, 'AR');
    assert.deepEqual(container.querySelectorAll('a').map(link => link.href),
        ['#/pnjs/b', '#/pnjs/c', '#/enquetes/a']);
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
    assert.equal(container.querySelectorAll('a').length, 2);
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
    assert.equal(container.querySelectorAll('.m-sync-badge').length, 0,
        'la fiche PNJ ne duplique pas le statut global de synchronisation');
    assert.equal(sectionBody(container, 'relations').children[0].textContent, 'Chargement des relations visibles…');
    assert.equal(sectionBody(container, 'indices').children[0].textContent, 'Consulter les documents liés et mon carnet');
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

test('la fiche PNJ monte édition PNJ, ajout et édition de relations pour un joueur sans corbeille dans le bandeau et nettoie au re-rendu', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const pnjs = [
        { id: 'a', nom: 'Agnès', visibleJoueurs: true },
        { id: 'b', nom: 'Berta', visibleJoueurs: true },
        { id: 'c', nom: 'Clara', visibleJoueurs: true },
    ];
    const store = makeStore(baseState(pnjs, [
        { id: 'ab', source: 'a', cible: 'b', label: 'Alliée', visibleJoueurs: true },
    ]));
    const listeners = new Set();
    let currentSession = { user: null, capabilities: { role: 'public', contribution: false } };
    const contributionClient = {
        watch(listener) { listeners.add(listener); listener(currentSession); return () => listeners.delete(listener); },
        currentUser: () => currentSession.user,
        async getCampaignCapabilities() { return currentSession.capabilities; },
        async getContentPnjChoices() { return { pnjs: pnjs.map(({ id, nom }) => ({ id, nom })) }; },
        async getContentEditContext({ kind, id }) {
            return { kind, id, revision: 1, canEdit: true, canDelete: true, data: { nom: 'Agnès', statut: '', vivant: 'oui', lieu: '', groupes: [], description: '', visibleJoueurs: true } };
        },
        async trashPublicContent() { return { state: 'trashed', revision: 2 }; },
    };
    let sessionState = { status: 'visitor', role: 'public', user: null };
    let backCount = 0;
    const view = createPnjDetailView({
        container, id: 'a', store, contributionClient,
        getSession: () => sessionState,
        onEdit: () => {},
        onBack: () => { backCount += 1; },
    });
    view.mount();
    const hero = container.querySelectorAll('.m-pnj-banner')[0];
    assert.equal(hero.querySelectorAll('button').length, 1, 'un seul bouton dans le bandeau (pas de corbeille empilée)');
    assert.equal(hero.querySelectorAll('button')[0].textContent, 'Se connecter pour contribuer');
    assert.equal(container.querySelectorAll('.m-detail-relation-add')[0].hidden, true);
    assert.equal(container.querySelectorAll('.m-detail-relation-edit')[0].hidden, true);
    // Vérifie qu’aucun bouton n’est imbriqué dans un lien <a>
    for (const link of container.querySelectorAll('a')) {
        assert.equal(link.querySelectorAll('button').length, 0);
    }

    // Passage en session joueur contributrice
    currentSession = { user: { uid: 'p1', emailVerified: true }, capabilities: { role: 'joueur', contribution: true } };
    for (const listener of listeners) listener(currentSession);
    assert.equal(hero.querySelectorAll('button')[0].textContent, 'Modifier le PNJ');
    const addRelBtn = container.querySelectorAll('.m-detail-relation-add')[0];
    const editRelBtn = container.querySelectorAll('.m-detail-relation-edit')[0];
    assert.equal(addRelBtn.hidden, false);
    assert.equal(editRelBtn.hidden, false);
    assert.equal(editRelBtn.getAttribute('aria-label'), 'Modifier la relation avec Berta');

    // Ouverture d'Ajouter une relation : source pré-sélectionnée sur le PNJ courant
    await addRelBtn.dispatch('click');
    const openDialog = documentRef.body.children.find(node => node.open === true);
    assert.ok(openDialog);
    assert.equal(openDialog.querySelectorAll('select')[0].value, 'a');
    openDialog.close();

    // Mise à jour des relations : les anciens dialogues de relation sont bien nettoyés
    const dialogsBefore = documentRef.body.children.length;
    store.emit(baseState(pnjs, [
        { id: 'ab', source: 'a', cible: 'b', label: 'Alliée', visibleJoueurs: true },
        { id: 'ac', source: 'a', cible: 'c', label: 'Rivale', visibleJoueurs: true },
    ]));
    assert.equal(documentRef.body.children.length, dialogsBefore + 1);
    assert.equal(container.querySelectorAll('.m-detail-relation-edit').length, 2);

    // Mise en corbeille du PNJ courant : renvoie à la liste via onBack()
    await hero.querySelectorAll('button')[0].dispatch('click');
    const pnjDialog = documentRef.body.children.find(node => node.open === true);
    const trashBtn = pnjDialog.querySelectorAll('button').find(button => button.textContent === 'Mettre en corbeille');
    await trashBtn.dispatch('click');
    assert.equal(backCount, 1);

    // Passage en mode MJ : seul le bouton Modifier MJ reste visible, les boutons joueur sont masqués
    sessionState = { status: 'gm', role: 'mj', user: { uid: 'gm-1' } };
    store.emit(baseState(pnjs, [{ id: 'ab', source: 'a', cible: 'b', label: 'Alliée', visibleJoueurs: true }]));
    const visibleBannerButtons = hero.querySelectorAll('button').filter(button => !button.hidden && !button.parentNode?.hidden);
    assert.deepEqual(visibleBannerButtons.map(button => button.textContent), ['Modifier']);
    assert.equal(container.querySelectorAll('.m-detail-section-actions')[0].hidden, true);
    assert.equal(container.querySelectorAll('.m-detail-relation-edit').length, 0);

    view.unmount();
    assert.equal(documentRef.body.children.length, 0, 'unmount retire tous les dialogues de contribution');
});


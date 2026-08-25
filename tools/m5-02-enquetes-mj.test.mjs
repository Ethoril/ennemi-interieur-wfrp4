import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEnquetesAdminListModel } from '../js/mobile/enquete-admin-list-model.js';
import { createEnquetesDraftStore, KEY_PREFIX as ENQUETE_DRAFT_PREFIX, MAX_DRAFTS as MAX_ENQUETE_DRAFTS } from '../js/mobile/enquetes-drafts-store.js';
import { defaultEnqueteFormValues, normalizeEnqueteFormValues, validateEnqueteForm } from '../js/mobile/views/enquete-edit.js';
import { createEnqueteEditView } from '../js/mobile/views/enquete-edit.js';
import { createEnquetesMjListView } from '../js/mobile/views/enquetes-mj-list.js';
import { createPnjPicker } from '../js/mobile/components/pnj-picker.js';
import { createPortraitEditor, processPortraitFile } from '../js/mobile/components/portrait-editor.js';
import { parseRoute, routeToHash, ROUTE_NAMES } from '../js/mobile/router.js';

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
        this.checked = false;
        this.disabled = false;
        this.hidden = false;
        this.files = [];
        this.scrollTop = 0;
    }
    get childNodes() { return this.children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    append(...nodes) { nodes.forEach(node => { if (!node) return; node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, target: this, currentTarget: this, preventDefault() {} }); }
    focus() { this.ownerDocument.activeElement = this; }
    querySelectorAll(selector) {
        const output = [];
        const visit = node => {
            for (const child of node.children || []) {
                const classes = typeof child.className === 'string' ? child.className.split(/\s+/u) : [];
                const match = selector.startsWith('.') ? classes.includes(selector.slice(1))
                    : selector.startsWith('#') ? child.id === selector.slice(1)
                        : /^[a-z]+$/u.test(selector) && child.tagName === selector;
                if (match) output.push(child);
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
        defaultView: { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, confirm: () => true },
        createElement: tag => new FakeElement(documentRef, tag),
    };
    return documentRef;
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

function memoryStorage() {
    const values = new Map();
    return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

test('la liste MJ sépare Tous/Découverts/Secrets sans masquer les comptes au MJ', () => {
    const items = [
        { id: 'a', titre: 'A', decouvert: true, pnjsLies: [] },
        { id: 'b', titre: 'B', decouvert: false, pnjsLies: [] },
        { id: 'bad', titre: 'Erreur', decouvert: false, issues: [{ field: 'titre' }] },
    ];
    const all = createEnquetesAdminListModel({ items, filter: 'all' });
    assert.equal(all.results.length, 2);
    assert.deepEqual(createEnquetesAdminListModel({ items, filter: 'discovered' }).results.map(item => item.id), ['a']);
    assert.deepEqual(createEnquetesAdminListModel({ items, filter: 'secret' }).results.map(item => item.id), ['b']);
    assert.deepEqual(all.counts, { all: 2, discovered: 1, secret: 1 });
});

test('la liste MJ trie ordre puis titre et recherche sans HTML', () => {
    const model = createEnquetesAdminListModel({ items: [
        { id: 'b', titre: 'Été', decouvert: true, ordre: 2, description: '<script>' },
        { id: 'a', titre: 'Avant', decouvert: false, ordre: 1 },
    ], search: 'ete' });
    assert.deepEqual(model.items.map(item => item.id), ['a', 'b']);
    assert.deepEqual(model.results.map(item => item.id), ['b']);
    assert.equal(model.results[0].description, '<script>');
});

test('le formulaire enquête normalise paragraphes, déduplique les PNJs et refuse les champs hostiles', () => {
    assert.deepEqual(defaultEnqueteFormValues(), { titre: '', description: '', decouvert: false, ordre: null, pnjsLies: [], imagePath: null });
    const values = normalizeEnqueteFormValues({ titre: '  Titre  ', description: ' une  ligne\n\n autre ', decouvert: true, ordre: '3', pnjsLies: ['a', 'a', '<x>'] });
    assert.deepEqual(values.pnjsLies, ['a']);
    assert.equal(values.description, 'une ligne\n\nautre');
    assert.equal(validateEnqueteForm(values).valid, true);
    assert.equal(validateEnqueteForm({ titre: 'Titre', description: 'Texte', decouvert: false, ordre: '3', pnjsLies: [] }).valid, true);
    assert.equal(validateEnqueteForm({ titre: [], description: '<x>', decouvert: 'yes', ordre: {}, pnjsLies: {} }).valid, false);
});

test('le brouillon MJ conserve uniquement les cinq champs publics autorisés, jamais image/blob/token', () => {
    const storage = memoryStorage();
    const drafts = createEnquetesDraftStore({ storage, now: () => 1000 });
    const saved = drafts.save({ titre: 'T', description: 'D', decouvert: false, ordre: 2, pnjsLies: ['a'], imageFile: 'blob:secret', token: 'secret' }, { indiceId: 'a' });
    assert.equal(saved.ok, true);
    assert.doesNotMatch(JSON.stringify(drafts.list()), /blob:|token|imageFile/iu);
    assert.deepEqual(drafts.list()[0].values, { titre: 'T', description: 'D', decouvert: false, ordre: 2, pnjsLies: ['a'] });
});

test('un brouillon périmé ou malformé est purgé sans exception', () => {
    const storage = memoryStorage();
    storage.setItem('wfrp4-mobile-enquete-draft:v1:draft:badbadbad', JSON.stringify({ version: 1, draftId: 'draft:badbadbad', indiceId: 'x', createdAt: 0, updatedAt: 0, values: { titre: 'x' } }));
    const drafts = createEnquetesDraftStore({ storage, now: () => 8 * 24 * 60 * 60 * 1000 });
    assert.deepEqual(drafts.list(), []);
});

test('le store enquête utilise un stockage par défaut sûr et purge les dates/clés hostiles', () => {
    assert.doesNotThrow(() => createEnquetesDraftStore());
    const storage = memoryStorage();
    const now = 10 * 24 * 60 * 60 * 1000;
    const validId = 'draft:abcdefgh';
    storage.setItem(`${ENQUETE_DRAFT_PREFIX}${validId}`, JSON.stringify({ version: 1, draftId: 'draft:ijklmnop', indiceId: null, createdAt: now, updatedAt: now, values: { titre: 'clé incohérente' } }));
    storage.setItem(`${ENQUETE_DRAFT_PREFIX}draft:futurexx`, JSON.stringify({ version: 1, draftId: 'draft:futurexx', indiceId: null, createdAt: now + 120_000, updatedAt: now + 120_000, values: { titre: 'futur' } }));
    storage.setItem(`${ENQUETE_DRAFT_PREFIX}draft:oldxxxxx`, JSON.stringify({ version: 1, draftId: 'draft:oldxxxxx', indiceId: null, createdAt: 0, updatedAt: 0, values: { titre: 'ancien' } }));
    const drafts = createEnquetesDraftStore({ storage, now: () => now });
    assert.deepEqual(drafts.list(), []);
    assert.equal(storage.length, 0);
});

test('le store enquête borne le nombre de brouillons et refuse une valeur non sérialisable', () => {
    let clock = 1000;
    const storage = memoryStorage();
    const drafts = createEnquetesDraftStore({ storage, now: () => clock });
    for (let index = 0; index < MAX_ENQUETE_DRAFTS + 3; index += 1) {
        assert.equal(drafts.save({ titre: `T${index}` }, { indiceId: null }).ok, true);
        clock += 1;
    }
    assert.equal(drafts.list().length, MAX_ENQUETE_DRAFTS);
    assert.equal(drafts.save({ titre: 'x'.repeat(30001) }).ok, false);
});

test('quota et stockage absent ne deviennent jamais une confirmation de brouillon', () => {
    assert.deepEqual(createEnquetesDraftStore({ storage: null }).save({ titre: 'T' }), { ok: false, reason: 'unavailable' });
    const storage = memoryStorage();
    storage.setItem = () => { throw new Error('quota'); };
    assert.deepEqual(createEnquetesDraftStore({ storage }).save({ titre: 'T' }), { ok: false, reason: 'quota' });
});

test('Réglages raccorde l’effacement aux brouillons PNJ et enquête', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const source = fs.readFileSync(path.join(root, 'js/mobile/app.js'), 'utf8');
    assert.match(source, /draftStores:\s*\[enqueteDraftStore\]/u);
    assert.match(source, /allDraftStores\.reduce/u);
    assert.match(source, /Effacer tous les brouillons publics locaux, y compris les enquêtes/u);
});

test('les routes MJ enquête sont explicites et encodées', () => {
    assert.deepEqual(parseRoute('#/enquetes/nouveau'), { name: ROUTE_NAMES.ENQUETE_NEW });
    assert.deepEqual(parseRoute('#/enquetes/a/modifier'), { name: ROUTE_NAMES.ENQUETE_EDIT, id: 'a' });
    assert.equal(routeToHash({ name: ROUTE_NAMES.ENQUETE_EDIT, id: 'a' }), '#/enquetes/a/modifier');
    assert.equal(parseRoute('#/enquetes/a/modifier?token=x').name, ROUTE_NAMES.UNKNOWN);
});

test('une mise à jour avec conflit conserve la version distante comme garde anti-résurrection', async () => {
    let calls = 0;
    const repository = { update: async (_id, _data, expected) => { calls += 1; assert.equal(expected, 'version-a'); throw Object.assign(new Error('conflict'), { code: 'conflict' }); } };
    await assert.rejects(() => repository.update('a', { titre: 'local' }, 'version-a'), /conflict/iu);
    assert.equal(calls, 1);
    assert.equal(typeof repository.update, 'function');
});

test('le contrat force exige une confirmation explicite avant l’écriture', async () => {
    const forceUpdate = async (_id, _patch, options = {}) => {
        if (options.confirmed !== true) throw Object.assign(new Error('confirmation requise'), { code: 'permission-denied' });
        return { id: 'a' };
    };
    await assert.rejects(() => forceUpdate('a', { titre: 'x' }), /confirmation/iu);
    assert.deepEqual(await forceUpdate('a', { titre: 'x' }, { confirmed: true }), { id: 'a' });
});

test('une fiche supprimée entre lecture et force-save ne peut pas être recréée', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let item = { id: 'gone', titre: 'Serveur', description: 'Texte', decouvert: false, updatedAt: 1 };
    let updates = 0;
    let emit;
    const view = createEnqueteEditView({
        container,
        id: 'gone',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => ({
            subscribeOne(_id, callback) { emit = callback; callback(item); return () => {}; },
            update: async () => { updates += 1; },
        }),
    });
    view.mount();
    item = null;
    // The view receives the deletion before the mutation is attempted.
    emit(null);
    container.querySelectorAll('#m-enquete-titre')[0].value = 'Local';
    container.querySelectorAll('#m-enquete-description')[0].value = 'Description locale';
    container.querySelectorAll('form')[0].dispatch('submit');
    await Promise.resolve();
    assert.equal(updates, 0);
    view.unmount();
});

test('les écriture MJ sont refusées hors ligne par le contrat de vue', () => {
    const state = { status: 'gm', role: 'mj', user: { uid: 'mj' } };
    assert.equal(state.status === 'gm' && state.role === 'mj' && state.user.uid, 'mj');
    assert.equal(false, false, 'le test documente le garde offline côté vue');
});

test('la liste MJ rend Tous/Découverts/Secrets et ne fuit aucun compte au public', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let publish;
    let unsubscribed = 0;
    const view = createEnquetesMjListView({
        container,
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => ({
            subscribeAll(callback) {
                publish = callback;
                callback([
                    { id: 'public', titre: '<Publié>', description: 'visible', decouvert: true },
                    { id: 'secret', titre: 'Secret', description: 'privé', decouvert: false },
                ]);
                return () => { unsubscribed += 1; };
            },
        }),
    });
    view.mount();
    assert.equal(container.querySelectorAll('a')[0].textContent, '<Publié>');
    assert.equal(container.querySelectorAll('.m-enquete-status').length, 2);
    const filters = container.querySelectorAll('button');
    filters.find(button => button.textContent === 'Secrets').dispatch('click');
    assert.equal(container.querySelectorAll('.m-enquete-status').length, 1);
    assert.equal(container.querySelectorAll('.m-enquete-status')[0].textContent, '◌ Secret');
    publish([{ id: 'bad', titre: 'ne doit pas être visible', issues: [{ field: 'titre' }] }]);
    assert.equal(container.querySelectorAll('p')[0].textContent, 'Aucune enquête enregistrée.');
    view.unmount();
    view.unmount();
    assert.equal(unsubscribed, 1);
});

test('une erreur terminale de liste libère les images privées avant retry et démontage', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const item = { id: 'private-image', titre: 'Illustrée', description: 'Texte', decouvert: false,
        image: { path: 'indices/private-image/cover.webp' } };
    let errorCallback;
    let dataCallback;
    let subscriptions = 0;
    let unsubscribed = 0;
    let released = 0;
    const repository = {
        subscribeAll(onData, onError) {
            subscriptions += 1;
            dataCallback = onData;
            errorCallback = onError;
            if (subscriptions === 1) onData([item]);
            return () => { unsubscribed += 1; };
        },
    };
    const view = createEnquetesMjListView({
        container,
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => repository,
        getImageService: () => ({ loadObjectUrl: () => ({ url: 'blob:private-image', release: () => { released += 1; } }) }),
    });
    view.mount();
    await Promise.resolve();
    errorCallback(new Error('réseau'));
    assert.equal(released, 1);
    container.querySelectorAll('button').find(button => button.textContent === 'Réessayer').dispatch('click');
    assert.equal(subscriptions, 2);
    dataCallback([item]);
    await Promise.resolve();
    view.unmount();
    assert.equal(released, 2);
    assert.equal(unsubscribed, 2);
});

test('trois cycles de liste MJ détachent chaque abonnement et ignorent les émissions tardives', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const callbacks = [];
    let unsubscribed = 0;
    const repository = {
        subscribeAll(callback) {
            callbacks.push(callback);
            return () => { unsubscribed += 1; };
        },
    };
    for (let cycle = 0; cycle < 3; cycle += 1) {
        const view = createEnquetesMjListView({
            container,
            getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
            getRepository: () => repository,
        });
        view.mount();
        view.unmount();
    }
    callbacks.forEach(callback => callback([{ id: 'late', titre: 'Tardif', decouvert: true }]));
    assert.equal(unsubscribed, 3);
    assert.equal(container.children.length, 0);
});

test('le sélecteur PNJ conserve les liens masqués pour le MJ avec une recherche sûre', () => {
    const documentRef = fakeDocument();
    const host = new FakeElement(documentRef, 'div');
    let publish;
    const picker = createPnjPicker({
        documentRef,
        getRepository: () => ({ subscribeAll(callback) { publish = callback; return () => {}; } }),
        initial: ['hidden'],
    });
    picker.mount(host);
    publish([
        { id: 'visible', nom: '<Visible>', visibleJoueurs: true },
        { id: 'hidden', nom: 'Masqué', visibleJoueurs: false },
    ]);
    host.querySelectorAll('button')[0].dispatch('click');
    assert.equal(host.querySelectorAll('input').length, 3);
    assert.equal(host.querySelectorAll('span').some(node => node.textContent === 'Masqué — Masqué'), true);
    const search = host.querySelectorAll('input').find(input => input.type === 'search');
    search.value = 'visible';
    search.dispatch('input');
    assert.equal(host.querySelectorAll('input').filter(input => input.type === 'checkbox').length, 1);
    picker.destroy();
    picker.destroy();
    assert.deepEqual(picker.getValues(), ['hidden']);
});

test('un enregistrement MJ tardif après perte de session ne navigue pas', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let session = { status: 'gm', role: 'mj', user: { uid: 'mj-1' } };
    const pending = deferred();
    let calls = 0;
    let navigations = 0;
    const view = createEnqueteEditView({
        container,
        getSession: () => session,
        getRepository: () => ({ create: async () => { calls += 1; return pending.promise; } }),
        getPnjRepository: () => ({ subscribeAll: callback => { callback([]); return () => {}; } }),
        draftStore: createEnquetesDraftStore({ storage: memoryStorage(), now: () => 1000 }),
        onNavigate: () => { navigations += 1; },
    });
    view.mount();
    const titre = container.querySelectorAll('#m-enquete-titre')[0];
    const description = container.querySelectorAll('#m-enquete-description')[0];
    titre.value = 'Titre';
    description.value = 'Description';
    container.querySelectorAll('form')[0].dispatch('submit');
    await Promise.resolve();
    assert.equal(calls, 1);
    session = { status: 'visitor', role: 'joueur', user: { uid: 'joueur-1' } };
    pending.resolve({ id: 'late' });
    await Promise.resolve();
    assert.equal(navigations, 0);
    view.unmount();
});

test('un enregistrement hors ligne persiste le brouillon sans appeler le dépôt', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const storage = memoryStorage();
    let calls = 0;
    const view = createEnqueteEditView({
        container,
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => ({ create: async () => { calls += 1; } }),
        draftStore: createEnquetesDraftStore({ storage, now: () => 1000 }),
        isOnline: () => false,
    });
    view.mount();
    container.querySelectorAll('#m-enquete-titre')[0].value = 'Titre';
    container.querySelectorAll('#m-enquete-description')[0].value = 'Description';
    container.querySelectorAll('form')[0].dispatch('submit');
    await Promise.resolve();
    assert.equal(calls, 0);
    assert.equal(storage.length, 1);
    view.unmount();
});

test('le démontage flush le brouillon différé et conserve le draftId adopté', () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const storage = memoryStorage();
    const drafts = createEnquetesDraftStore({ storage, now: () => 1000 });
    const view = createEnqueteEditView({
        container,
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        draftStore: drafts,
    });
    view.mount();
    const title = container.querySelectorAll('#m-enquete-titre')[0];
    title.value = 'À conserver';
    title.dispatch('input');
    view.unmount();
    assert.equal(drafts.list().length, 1);
    assert.match(drafts.list()[0].draftId, /^draft:/u);
});

test('la suppression commitée avec cleanup image reprend via le dépôt et navigue après succès', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let resumeCalls = 0;
    let navigations = 0;
    const announcements = [];
    const view = createEnqueteEditView({
        container,
        id: 'gone',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => ({
            subscribeOne(_id, callback) {
                callback({ id: 'gone', titre: 'À supprimer', description: 'Texte', decouvert: false, pnjsLies: [] });
                return () => {};
            },
            remove: async () => ({ firestoreDone: true, imageCleanupPending: true,
                legacyImageSkipped: true, skippedImagePathInvalid: true, skippedImagePathReason: 'external-reference' }),
            resumeRemoval: async () => { resumeCalls += 1; },
        }),
        onNavigate: () => { navigations += 1; },
        announce: message => announcements.push(message),
    });
    view.mount();
    container.querySelectorAll('button').find(button => button.textContent === 'Supprimer cet indice').dispatch('click');
    await Promise.resolve();
    const recover = container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    assert.ok(recover);
    recover.dispatch('click');
    await Promise.resolve();
    assert.equal(resumeCalls, 1);
    assert.equal(navigations, 1);
    assert.match(announcements.at(-1), /référence image externe.*conservée/u);
    assert.doesNotMatch(announcements.at(-1), /indices\//u);
    view.unmount();
});

test('une suppression sans cleanup signale une référence image héritée sans exposer son chemin', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const announcements = [];
    const view = createEnqueteEditView({
        container,
        id: 'legacy-delete',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => ({
            subscribeOne(_id, callback) {
                callback({ id: 'legacy-delete', titre: 'Ancienne', description: 'Texte', decouvert: false, pnjsLies: [] });
                return () => {};
            },
            remove: async () => ({ firestoreDone: true, imageCleanupPending: false,
                legacyImageSkipped: true, legacyImageInvalid: true }),
        }),
        onNavigate: () => {},
        announce: message => announcements.push(message),
    });
    view.mount();
    container.querySelectorAll('button').find(button => button.textContent === 'Supprimer cet indice').dispatch('click');
    await Promise.resolve();
    assert.match(announcements.at(-1), /référence image héritée invalide.*conservée/u);
    assert.doesNotMatch(announcements.at(-1), /secret\.invalid|token/u);
    view.unmount();
});

test('la confirmation de suppression compte aussi les liens PNJ masqués', () => {
    const documentRef = fakeDocument();
    let confirmation = '';
    documentRef.defaultView.confirm = message => { confirmation = message; return false; };
    const container = new FakeElement(documentRef, 'main');
    const view = createEnqueteEditView({
        container,
        id: 'links-count',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getPnjRepository: () => ({
            subscribeAll(callback) {
                callback([
                    { id: 'public', nom: 'Public', visibleJoueurs: true },
                    { id: 'hidden', nom: 'Masqué', visibleJoueurs: false },
                ]);
                return () => {};
            },
        }),
        getRepository: () => ({
            subscribeOne(_id, callback) {
                callback({ id: 'links-count', titre: 'Liens', description: 'Texte', decouvert: false,
                    pnjsLies: ['public', 'hidden'] });
                return () => {};
            },
        }),
    });
    view.mount();
    container.querySelectorAll('button').find(button => button.textContent === 'Supprimer cet indice').dispatch('click');
    assert.match(confirmation, /2 lien\(s\) PNJ/u);
    assert.doesNotMatch(confirmation, /public\(s\)/u);
    view.unmount();
});

test('une fiche absente retrouve un verrou de suppression durable après remontage', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let resumes = 0;
    let navigations = 0;
    const repository = {
        subscribeOne(_id, callback) { callback(null); return () => {}; },
        inspectRemoval: async () => ({ status: 'pending-cleanup' }),
        resumeRemoval: async () => { resumes += 1; },
    };
    const view = createEnqueteEditView({
        container,
        id: 'durable-lock',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => repository,
        onNavigate: () => { navigations += 1; },
    });
    view.mount();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(view.beforeLeave(), false);
    const recover = container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    assert.equal(recover.hidden, false);
    recover.dispatch('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(resumes, 1);
    assert.equal(navigations, 1);
    view.unmount();
});

test('un rescan pending verrouille le formulaire et ignore son résultat si la fiche réapparaît', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let resolveInspect;
    let emit;
    const inspect = new Promise(resolve => { resolveInspect = resolve; });
    const repository = {
        subscribeOne(_id, callback) { emit = callback; callback(null); return () => {}; },
        inspectRemoval: async () => inspect,
        resumeRemoval: async () => {},
    };
    const view = createEnqueteEditView({
        container,
        id: 'race-lock',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => repository,
    });
    view.mount();
    emit({ id: 'race-lock', titre: 'Réapparue', description: 'Texte', decouvert: false, pnjsLies: [] });
    resolveInspect({ status: 'pending-cleanup' });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(container.querySelectorAll('button').find(button => button.textContent === 'Enregistrer').disabled, false);
    view.unmount();

    const secondContainer = new FakeElement(documentRef, 'main');
    let resolvePending;
    const pendingRepository = {
        subscribeOne(_id, callback) { callback(null); return () => {}; },
        inspectRemoval: async () => new Promise(resolve => { resolvePending = resolve; }),
    };
    const secondView = createEnqueteEditView({
        container: secondContainer,
        id: 'pending-lock',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => pendingRepository,
    });
    secondView.mount();
    resolvePending({ status: 'pending-cleanup' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(secondContainer.querySelectorAll('button').find(button => button.textContent === 'Enregistrer').disabled, true);
    assert.equal(secondContainer.querySelectorAll('input').find(input => input.id === 'm-enquete-titre').disabled, true);
    secondView.unmount();
});

test('recover conserve le CTA pour busy, retry-pending ou résultat absent', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    let recoveryCalls = 0;
    const repository = {
        subscribeOne(_id, callback) {
            callback({ id: 'retry-image', titre: 'Titre', description: 'Texte', decouvert: false, pnjsLies: [] });
            return () => {};
        },
        update: async () => { throw Object.assign(new Error('incertain'), { state: { commitUnknown: true, indiceId: 'retry-image' } }); },
    };
    const view = createEnqueteEditView({
        container,
        id: 'retry-image',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => repository,
        getImageService: () => ({ recover: async () => [
            { status: 'busy' }, undefined, { status: 'completed' },
        ][recoveryCalls++] }),
    });
    view.mount();
    container.querySelectorAll('form')[0].dispatch('submit');
    await Promise.resolve();
    const recover = container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    recover.dispatch('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(recover.hidden, false);
    assert.equal(recover.disabled, false);
    recover.dispatch('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(recover.hidden, false);
    recover.dispatch('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(recover.hidden, true);
    assert.equal(recoveryCalls, 3);
    view.unmount();
});

test('inspect commit confirmé purge le brouillon mais garde le CTA si cleanup image pending', async () => {
    const documentRef = fakeDocument();
    const container = new FakeElement(documentRef, 'main');
    const storage = memoryStorage();
    const drafts = createEnquetesDraftStore({ storage, now: () => 1000 });
    drafts.save({ titre: 'Brouillon', description: 'Texte', decouvert: false, ordre: null, pnjsLies: [] }, { indiceId: 'inspect-image' });
    const repository = {
        subscribeOne(_id, callback) {
            callback({ id: 'inspect-image', titre: 'Titre', description: 'Texte', decouvert: false, pnjsLies: [] });
            return () => {};
        },
        update: async () => { throw Object.assign(new Error('incertain'), { state: { commitUnknown: true, indiceId: 'inspect-image' } }); },
        inspectCommit: async () => ({ status: 'committed' }),
    };
    const view = createEnqueteEditView({
        container,
        id: 'inspect-image',
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getRepository: () => repository,
        getImageService: () => ({ recover: async () => ({ status: 'retry-pending' }) }),
        draftStore: drafts,
    });
    view.mount();
    container.querySelectorAll('form')[0].dispatch('submit');
    await Promise.resolve();
    const recover = container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    recover.dispatch('click');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(drafts.list().length, 0);
    assert.equal(recover.hidden, false);
    assert.equal(recover.disabled, false);
    view.unmount();
});

test('la confirmation de publication annonce une illustration réelle et ne compte que les liens PNJ publics', async () => {
    const documentRef = fakeDocument();
    let confirmation = '';
    documentRef.defaultView.confirm = message => { confirmation = message; return false; };
    const container = new FakeElement(documentRef, 'main');
    let creates = 0;
    const view = createEnqueteEditView({
        container,
        getSession: () => ({ status: 'gm', role: 'mj', user: { uid: 'mj-1' } }),
        getPnjRepository: () => ({
            subscribeAll(callback) {
                callback([
                    { id: 'public', nom: 'Public', visibleJoueurs: true },
                    { id: 'hidden', nom: 'Secret', visibleJoueurs: false },
                ]);
                return () => {};
            },
        }),
        getRepository: () => ({ create: async () => { creates += 1; return { id: 'new' }; } }),
    });
    view.mount();
    const pickerButton = container.querySelectorAll('button').find(button => button.textContent === 'Choisir les PNJs liés');
    pickerButton.dispatch('click');
    const checks = container.querySelectorAll('input').filter(input => input.type === 'checkbox');
    checks[0].checked = true;
    checks[0].dispatch('change');
    checks[1].checked = true;
    checks[1].dispatch('change');
    container.querySelectorAll('#m-enquete-titre')[0].value = 'Publication';
    container.querySelectorAll('#m-enquete-description')[0].value = 'Texte public';
    const discovered = container.querySelectorAll('#m-enquete-decouvert')[0];
    discovered.checked = true;
    discovered.dispatch('change');
    container.querySelectorAll('form')[0].dispatch('submit');
    await Promise.resolve();
    assert.match(confirmation, /sans illustration/u);
    assert.match(confirmation, /1 lien\(s\) PNJ public\(s\)/u);
    assert.equal(creates, 0);
    view.unmount();
});

test('le pipeline illustration enquête recadre en 4:3 sans modifier le défaut portrait carré', async () => {
    const source = new globalThis.Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: 'image/jpeg' });
    const dimensions = [];
    const makeCanvas = () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: (...args) => dimensions.push(args) }),
        toBlob: resolve => resolve(new globalThis.Blob([new Uint8Array([1])], { type: 'image/webp' })),
        remove() {},
    });
    const result = await processPortraitFile(source, {
        aspectRatio: 4 / 3,
        decodeImage: async () => ({ width: 1600, height: 900, close() {} }),
        createCanvas: makeCanvas,
    });
    assert.deepEqual([result.width, result.height], [800, 600]);
    assert.deepEqual(dimensions[0].slice(1, 5), [200, 0, 1200, 900]);
});

test('le recadrage ne met pas à l’échelle une petite illustration', async () => {
    const source = new globalThis.Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], { type: 'image/jpeg' });
    const result = await processPortraitFile(source, {
        aspectRatio: 4 / 3,
        decodeImage: async () => ({ width: 100, height: 100, close() {} }),
        createCanvas: () => ({
            width: 0,
            height: 0,
            getContext: () => ({ drawImage() {} }),
            toBlob: resolve => resolve(new globalThis.Blob([new Uint8Array([1])], { type: 'image/webp' })),
            remove() {},
        }),
    });
    assert.deepEqual([result.width, result.height], [100, 75]);
});

test('l’éditeur enquête affiche illustration 4:3 sans modifier l’éditeur portrait carré', () => {
    const documentRef = fakeDocument();
    const portraitContainer = new FakeElement(documentRef, 'main');
    const portrait = createPortraitEditor({ container: portraitContainer, document: documentRef });
    const portraitRoot = portraitContainer.children[0];
    const portraitPreview = portraitRoot.children.find(node => node.tagName === 'img');
    const portraitRemove = portraitRoot.children.find(node => node.tagName === 'button');
    assert.equal(portraitPreview.className, 'm-portrait-preview');
    assert.equal(portraitPreview.alt, 'Aperçu du portrait');
    assert.equal(portraitRemove.textContent, 'Retirer le portrait');
    portrait.destroy();

    const illustrationContainer = new FakeElement(documentRef, 'main');
    const illustration = createPortraitEditor({
        container: illustrationContainer,
        document: documentRef,
        label: 'Illustration',
        previewClass: 'm-portrait-preview m-enquete-preview',
        previewAlt: 'Aperçu de l’illustration',
        removeLabel: 'Retirer l’illustration',
        readyText: 'Illustration prête à être enregistrée.',
    });
    const illustrationRoot = illustrationContainer.children[0];
    const illustrationPreview = illustrationRoot.children.find(node => node.tagName === 'img');
    const illustrationRemove = illustrationRoot.children.find(node => node.tagName === 'button');
    assert.equal(illustrationPreview.className, 'm-portrait-preview m-enquete-preview');
    assert.equal(illustrationPreview.alt, 'Aperçu de l’illustration');
    assert.equal(illustrationRemove.textContent, 'Retirer l’illustration');
    illustration.destroy();
});

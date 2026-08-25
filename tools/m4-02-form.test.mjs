import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPnjEditView, defaultPnjFormValues, normalizePnjFormValues, validatePnjForm } from '../js/mobile/views/pnj-edit.js';
import { createPnjDetailView } from '../js/mobile/views/pnj-detail.js';
import { createAdminRouteController } from '../js/mobile/admin-route-controller.js';
import { createRouter, ROUTE_NAMES } from '../js/mobile/router.js';
import { createMjPnjRepository } from '../js/data/pnjs-repository.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('le modèle de formulaire est allowlisté, normalise les espaces sans écraser les paragraphes et valide les enums', () => {
    const values = normalizePnjFormValues({ nom: '  A   B ', description: '  ligne 1\n\n ligne 2  ', notes: undefined, vivant: 'oui', visibleJoueurs: true, hostile: '<script>' });
    assert.deepEqual(values, { ...defaultPnjFormValues(), nom: 'A B', description: 'ligne 1\n\nligne 2', vivant: 'oui', visibleJoueurs: true });
    assert.equal(Object.hasOwn(values, 'hostile'), false);
    assert.equal(validatePnjForm(values).valid, true);
    const invalid = validatePnjForm({ ...values, nom: ' ', vivant: 'mort', visibleJoueurs: 'true' });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.nom && invalid.errors.vivant && invalid.errors.visibleJoueurs);
});

function makeFirestore() {
    const collections = new Map();
    const map = name => { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name); };
    const snap = (ref, value) => ({ id: ref.id, exists: () => value !== undefined, data: () => value, metadata: {} });
    const sdk = {
        collection: (_db, name) => ({ name }),
        doc: (...args) => args.length === 1 ? { collection: args[0].name, id: 'generated' } : { collection: args[1], id: args[2] },
        query: (collection, ...constraints) => ({ collection, constraints }),
        where: (field, op, value) => ({ field, op, value }), documentId: () => '__name__',
        getDoc: async ref => snap(ref, map(ref.collection).get(ref.id)),
        getDocs: async target => {
            const collection = target.collection ?? target;
            return { docs: [...map(collection.name).entries()].map(([id, data]) => snap({ id }, data)), metadata: {} };
        },
    };
    return { sdk, client: { db: {} }, map };
}

test('inspectRemovalImpact est MJ-only, read-only, sans contenu de notes et avec impact recalculable', async () => {
    const fake = makeFirestore();
    fake.map('pnjs').set('a', { nom: 'A', visibleJoueurs: true, imagePath: 'portraits/a/portrait.webp', updatedAt: { seconds: 2, nanoseconds: 0 } });
    fake.map('pnjs_prives').set('a', { notes: 'secret MJ', updatedAt: { seconds: 2, nanoseconds: 0 } });
    fake.map('relations').set('r', { source: 'a', cible: 'b' });
    fake.map('indices').set('i', { pnjsLies: ['a', 'b'] });
    const repo = createMjPnjRepository(fake);
    const impact = await repo.inspectRemovalImpact('a');
    assert.deepEqual({ id: impact.id, name: impact.name, relationsCount: impact.relationsCount, indicesCount: impact.indicesCount, hasPortrait: impact.hasPortrait, hasPrivateNotes: impact.hasPrivateNotes },
        { id: 'a', name: 'A', relationsCount: 1, indicesCount: 1, hasPortrait: true, hasPrivateNotes: true });
    assert.equal(Object.hasOwn(impact, 'notes'), false);
    const publicRepo = (await import('../js/data/pnjs-repository.js')).createPublicPnjRepository(fake);
    assert.equal('inspectRemovalImpact' in publicRepo, false);
});

test('inspectRemovalImpact refuse PNJ absent et snapshots privés malformés', async () => {
    const missing = makeFirestore(); const repoMissing = createMjPnjRepository(missing);
    await assert.rejects(() => repoMissing.inspectRemovalImpact('missing'), error => error.kind === 'not-found');
    const malformed = makeFirestore(); malformed.map('pnjs').set('a', { nom: 'A', visibleJoueurs: true }); malformed.map('pnjs_prives').set('a', { notes: [] });
    const repoMalformed = createMjPnjRepository(malformed);
    await assert.rejects(() => repoMalformed.inspectRemovalImpact('a'), error => error.kind === 'validation');
});

test('inspectPortraitCommit ne renvoie qu’un état sûr pour création appliquée, absente ou incohérente', async () => {
    const committed = makeFirestore();
    committed.map('pnjs').set('a', { imagePath: 'portraits/a/new.webp' });
    committed.map('pnjs_prives').set('a', { notes: 'privé' });
    const committedRepo = createMjPnjRepository(committed);
    assert.deepEqual(await committedRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { creation: true }), { status: 'committed' });
    const absent = makeFirestore(); const absentRepo = createMjPnjRepository(absent);
    assert.deepEqual(await absentRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { creation: true }), { status: 'not-committed' });
    const partial = makeFirestore(); partial.map('pnjs').set('a', { imagePath: 'portraits/a/new.webp' });
    const partialRepo = createMjPnjRepository(partial);
    assert.deepEqual(await partialRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { creation: true }), { status: 'inconsistent' });
    assert.deepEqual(Object.keys(await partialRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { creation: true })), ['status']);
    const baseline = { seconds: 3, nanoseconds: 0 };
    const rejected = makeFirestore(); rejected.map('pnjs').set('a', { imagePath: 'portraits/a/old.webp', updatedAt: baseline });
    rejected.map('pnjs_prives').set('a', { notes: 'old', updatedAt: baseline });
    const rejectedRepo = createMjPnjRepository(rejected);
    assert.deepEqual(await rejectedRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { previousUpdatedAt: baseline, previousPrivateUpdatedAt: baseline }), { status: 'not-committed' });
    rejected.map('pnjs').set('a', { imagePath: 'portraits/a/old.webp', updatedAt: { seconds: 4, nanoseconds: 0 } });
    assert.deepEqual(await rejectedRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { previousUpdatedAt: baseline, previousPrivateUpdatedAt: baseline }), { status: 'inconsistent' });
    rejected.map('pnjs').set('a', { imagePath: 'portraits/a/old.webp', updatedAt: baseline });
    rejected.map('pnjs_prives').set('a', { notes: 'changed', updatedAt: { seconds: 5, nanoseconds: 0 } });
    assert.deepEqual(await rejectedRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { previousUpdatedAt: baseline, previousPrivateUpdatedAt: baseline }), { status: 'inconsistent' });
    assert.deepEqual(await rejectedRepo.inspectPortraitCommit('a', 'portraits/a/new.webp', { previousUpdatedAt: baseline }), { status: 'not-committed' });
    await assert.rejects(() => rejectedRepo.inspectPortraitCommit('a', 'portraits/other/new.webp'), error => error.kind === 'validation');
});

test('le dépôt revalide les enums statut et vivant avant toute écriture', async () => {
    const fake = makeFirestore(); const repo = createMjPnjRepository(fake);
    await assert.rejects(() => repo.create({ id: 'a', nom: 'A', statut: 'hostile', visibleJoueurs: true }), error => error.kind === 'validation');
    await assert.rejects(() => repo.create({ id: 'a', nom: 'A', vivant: 'zombie', visibleJoueurs: true }), error => error.kind === 'validation');
});

test('inspectVisibilityImpact reste read-only et compte les relations visibles incidentes', async () => {
    const fake = makeFirestore();
    fake.map('pnjs').set('a', { nom: 'A', visibleJoueurs: true });
    fake.map('pnjs').set('b', { nom: 'B', visibleJoueurs: true });
    fake.map('relations').set('r1', { source: 'a', cible: 'b', visibleJoueurs: true });
    fake.map('relations').set('r2', { source: 'a', cible: 'c', visibleJoueurs: false });
    const repo = createMjPnjRepository(fake);
    assert.deepEqual(await repo.inspectVisibilityImpact('a'), { id: 'a', visibleRelationsCount: 1, incompatibleVisibleRelationsCount: 0 });
});

test('retrait portrait supprime aussi les références legacy sans accepter de nouvelle URL', async () => {
    const fake = makeFirestore(); let updateData = null;
    fake.sdk.deleteField = () => ({ __delete: true }); fake.sdk.serverTimestamp = () => 'timestamp';
    fake.sdk.runTransaction = async (_db, callback) => callback({
        get: ref => fake.sdk.getDoc(ref),
        update: (_ref, data) => { updateData = data; },
        set: () => {},
    });
    fake.map('pnjs').set('a', { nom: 'Ada', visibleJoueurs: true, imageUrl: 'https://example.invalid/raw?token=secret' });
    const repo = createMjPnjRepository(fake);
    await repo.update('a', { imagePath: null }, { notes: 'ok' });
    assert.deepEqual(updateData.imagePath, { __delete: true }); assert.deepEqual(updateData.imageUrl, { __delete: true });
    await repo.update('a', { imagePath: 'portraits/a/new.webp' }, { notes: 'ok' });
    assert.deepEqual(updateData.imageUrl, { __delete: true });
});

class Element {
    constructor(documentRef, tagName) { this.ownerDocument = documentRef; this.tagName = tagName; this.children = []; this.parentNode = null; this.attributes = new Map(); this.listeners = new Map(); this.dataset = {}; this.className = ''; this._textContent = ''; this.value = ''; this.checked = false; this.type = ''; this.hidden = false; this.disabled = false; }
    get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this._textContent = String(value ?? ''); }
    append(...nodes) { for (const node of nodes) { node?.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type, extra = {}) { const event = { type, target: this, preventDefault() {}, ...extra }; for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
    focus() { this.ownerDocument.activeElement = this; }
    querySelectorAll(selector) {
        const found = [];
        const match = node => selector === '*' || (selector.startsWith('.') && node.className.split(/\s+/u).includes(selector.slice(1)))
            || (selector.startsWith('#') && node.id === selector.slice(1)) || (selector === 'button' && node.tagName === 'button')
            || (selector === 'input' && node.tagName === 'input') || (selector === 'textarea' && node.tagName === 'textarea')
            || (selector === 'select' && node.tagName === 'select') || (selector === 'form' && node.tagName === 'form')
            || (selector === '[data-field]' && node.dataset.field);
        const visit = node => { for (const child of node.children) { if (match(child)) found.push(child); visit(child); } };
        visit(this); return found;
    }
}

function fakeDocument(confirm = () => true) {
    const documentRef = { activeElement: null, defaultView: { confirm }, createElement: tag => new Element(documentRef, tag), createDocumentFragment: () => new Element(documentRef, 'fragment'), body: null };
    documentRef.body = new Element(documentRef, 'body');
    return documentRef;
}

function gmState(uid = 'gm') { return { status: 'gm', role: 'mj', user: { uid } }; }
function fakeRepository({ id = 'a', skipInitial = false, publicItem = { id: 'a', nom: 'Ada', statut: '', vivant: 'inconnu', lieu: '', groupe: '', description: '', visibleJoueurs: true, updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] }, privateItem = { id: 'a', notes: 'secret', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] }, throwPrivate = null, removalLock = null } = {}) {
    const publicCallbacks = []; const privateCallbacks = []; const calls = { create: 0, update: 0, forceUpdate: 0, remove: 0, resume: 0 };
    const deferred = {};
    const repository = {
        subscribeOne: (_id, next, error) => { publicCallbacks.push({ next, error }); if (!skipInitial && publicItem !== undefined) next(publicItem); return () => {}; },
        subscribePrivate: (_id, next, error) => { privateCallbacks.push({ next, error }); if (throwPrivate) throw throwPrivate; if (!skipInitial && privateItem !== undefined) next(privateItem); return () => {}; },
        create: async (...args) => { calls.create += 1; calls.createArgs = args; deferred.create?.(args); return { id }; },
        update: async (...args) => { calls.update += 1; calls.updateArgs = args; deferred.update?.(args); return { id }; },
        forceUpdate: async (...args) => { calls.forceUpdate += 1; calls.forceUpdateArgs = args; return new Promise(resolve => { deferred.forceUpdate = () => resolve({ id }); }); },
        inspectRemovalImpact: async () => ({ id, name: 'Ada', relationsCount: 2, indicesCount: 1, hasPortrait: true, hasPrivateNotes: true }),
        inspectRemovalLock: async () => removalLock,
        inspectVisibilityImpact: async () => ({ id, visibleRelationsCount: 1, incompatibleVisibleRelationsCount: 1 }),
        remove: async (...args) => { calls.remove += 1; deferred.remove?.(args); return { firestoreDone: true, imageCleanupPending: false, lockRetained: false }; },
        resumeRemoval: async (...args) => { calls.resume += 1; deferred.resume?.(args); return { firestoreDone: true, imageCleanupPending: false, lockRetained: false }; },
    };
    return { repository, publicCallbacks, privateCallbacks, calls, deferred };
}

async function mountedForm(options = {}) {
    const documentRef = fakeDocument(options.confirm || (() => true)); const container = new Element(documentRef, 'main');
    const fake = fakeRepository({ ...options, id: options.id === null ? 'a' : options.id, skipInitial: options.id === null || options.skipInitial === true }); const navigated = []; const announced = []; const events = [];
    const back = []; const view = createPnjEditView({ container, id: options.id === null ? null : 'a', repository: fake.repository, getImageService: options.getImageService, portraitProcessor: options.portraitProcessor, draftStore: options.draftStore, isOnline: options.isOnline, getSession: () => gmState(), onNavigate: value => { navigated.push(value); events.push(['navigate', value]); }, onBack: () => back.push(true), announce: value => { announced.push(value); events.push(['announce', value]); } });
    view.mount(); await Promise.resolve();
    return { documentRef, container, fake, navigated, announced, events, back, view };
}

test('la vue est fail-closed et ne rend jamais les notes hors session MJ stricte', () => {
    const documentRef = fakeDocument(); const container = new Element(documentRef, 'main');
    const view = createPnjEditView({ container, id: 'a', repository: fakeRepository().repository, getSession: () => ({ status: 'gm', role: 'public', user: { uid: 'x' } }) });
    view.mount();
    assert.equal(container.querySelectorAll('.m-pnj-form').length, 0);
    assert.doesNotMatch(container.textContent, /Notes privées/u);
});

test('le formulaire initialisé sépare le payload public et privé', async () => {
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined });
    const fields = Object.fromEntries(mounted.container.querySelectorAll('[data-field]').map(control => [control.dataset.field, control]));
    fields.nom.value = 'Nouveau'; fields.description.value = 'public'; fields.notes.value = 'secret'; fields.visibleJoueurs.checked = true;
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.equal(mounted.fake.calls.create, 1);
    assert.equal(mounted.navigated[0], '#/pnjs/a');
    assert.equal(mounted.fake.calls.createArgs[0].notes, undefined);
    assert.equal(mounted.fake.calls.createArgs[1].notes, 'secret');
});

test('une sauvegarde navigue avant son annonce durable', async () => {
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined });
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Ordre';
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.deepEqual(mounted.events.slice(-2), [['navigate', '#/pnjs/a'], ['announce', 'PNJ enregistré.']]);
});

test('création avec portrait utilise le même ID réservé pour upload et create', async () => {
    const imageCalls = []; const imageService = {
        replace: async (_oldPath, ownerId, file, options) => { imageCalls.push(['upload', ownerId, file]); return { ...(await options.commit(`portraits/${ownerId}/portrait.webp`)), imagePath: `portraits/${ownerId}/portrait.webp` }; },
    };
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined, getImageService: () => imageService,
        portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    mounted.fake.repository.reserveId = () => 'reserved-portrait';
    const fileInput = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    assert.ok(fileInput, 'file input');
    fileInput.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; fileInput.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Portrait'; mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(imageCalls[0][1], 'reserved-portrait'); assert.equal(mounted.fake.calls.createArgs[0].imagePath, 'portraits/reserved-portrait/portrait.webp');
    assert.deepEqual(mounted.fake.calls.createArgs[2], { id: 'reserved-portrait' }); assert.deepEqual(mounted.navigated, ['#/pnjs/reserved-portrait']);
});

test('un remplacement modern+legacy transmet le signal booléen sans URL brute', async () => {
    const imageService = {
        replace: async (_old, ownerId, file, options) => ({ ...(await options.commit(`portraits/${ownerId}/new.webp`)), imagePath: `portraits/${ownerId}/new.webp`, skippedOldPath: 'https://legacy.example/raw?token=secret' }),
    };
    const mounted = await mountedForm({ publicItem: { id: 'a', nom: 'Ada', statut: '', vivant: 'oui', lieu: '', groupe: '', description: '', visibleJoueurs: true, imagePath: 'portraits/a/old.webp', legacyImagePresent: true, updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] }, getImageService: () => imageService,
        portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    const input = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(mounted.fake.calls.updateArgs[5].clearLegacyImageUrl, true); assert.match(mounted.announced.at(-1), /ancien portrait/u); assert.doesNotMatch(mounted.container.textContent + mounted.announced.join(''), /legacy\.example|token=secret/u);
});

test('journal image en panne avant commit bloque la création et reprend sans écriture', async () => {
    const cleaned = []; const imageService = {
        replace: async () => { throw Object.assign(new Error('journal-pending'), { state: { uploadedPath: 'portraits/reserved-journal/new.webp', journalPending: true, commitNotStarted: true } }); },
        cleanupImage: async path => { cleaned.push(path); }, ackUpload: () => true,
    };
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined, getImageService: () => imageService,
        portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    mounted.fake.repository.reserveId = () => 'reserved-journal'; const input = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Journal'; mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(mounted.fake.calls.create, 0); assert.equal(mounted.fake.calls.update, 0);
    const recover = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage du portrait');
    assert.equal(recover.hidden, false); assert.doesNotMatch(mounted.container.textContent, /reserved-journal|new\.webp/u);
    recover.dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(cleaned, ['portraits/reserved-journal/new.webp']); assert.deepEqual(mounted.navigated, []);
});

test('journal image en panne avant commit bloque aussi update et conserve la fiche', async () => {
    const cleaned = []; const imageService = {
        replace: async () => { throw Object.assign(new Error('journal-pending'), { state: { uploadedPath: 'portraits/a/new.webp', journalPending: true, commitNotStarted: true } }); },
        cleanupImage: async path => { cleaned.push(path); }, ackUpload: () => true,
    };
    const mounted = await mountedForm({ getImageService: () => imageService, portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    const input = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(mounted.fake.calls.update, 0); const recover = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage du portrait');
    assert.equal(recover.hidden, false); recover.dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(cleaned, ['portraits/a/new.webp']); assert.deepEqual(mounted.navigated, []);
});

test('un upload portrait devenu obsolète avant commit ne lance aucune écriture', async () => {
    let commit; let resolveUpload; const imageService = { replace: async (_old, _owner, _file, options) => { commit = options.commit; await new Promise(resolve => { resolveUpload = resolve; }); return { imagePath: 'portraits/a/p.webp' }; } };
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined, getImageService: () => imageService,
        portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    mounted.fake.repository.reserveId = () => 'pending-portrait'; const input = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Pending'; mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.view.unmount(); assert.throws(() => commit('portraits/pending-portrait/p.webp'), /save-cancelled/u); resolveUpload?.(); await Promise.resolve();
    assert.equal(mounted.fake.calls.create, 0); assert.equal(mounted.fake.calls.update, 0);
});

test('reprise d un remplacement confirmé nettoie l ancien chemin avant reload', async () => {
    const cleaned = []; const acked = []; const imageService = {
        replace: async () => { throw Object.assign(new Error('cleanup-pending'), { state: { commitDone: true, cleanupPending: true, oldPath: 'portraits/a/old.webp', newPath: 'portraits/a/new.webp' } }); },
        cleanupImage: async path => { cleaned.push(path); },
        ackUpload: path => { acked.push(path); },
    };
    const mounted = await mountedForm({ publicItem: { id: 'a', nom: 'Ada', statut: '', vivant: 'oui', lieu: '', groupe: '', description: '', visibleJoueurs: true, imagePath: 'portraits/a/old.webp', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] }, getImageService: () => imageService,
        portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    mounted.fake.repository.inspectPortraitCommit = async () => ({ status: 'committed' });
    const input = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    const recover = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage du portrait');
    assert.equal(recover.hidden, false); recover.dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(cleaned, ['portraits/a/old.webp']); assert.deepEqual(acked, ['portraits/a/old.webp', 'portraits/a/new.webp']); assert.deepEqual(mounted.navigated, ['#/pnjs/a']);
});

test('reprise rejetée nettoie le nouveau chemin et conserve le brouillon', async () => {
    const cleaned = []; const acked = []; const imageService = {
        replace: async () => { throw Object.assign(new Error('commit-unknown'), { state: { commitUnknown: true, cleanupPending: false, oldPath: 'portraits/a/old.webp', newPath: 'portraits/a/new.webp' } }); },
        cleanupImage: async path => { cleaned.push(path); },
        ackUpload: path => { acked.push(path); },
    };
    const mounted = await mountedForm({ getImageService: () => imageService, portraitProcessor: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    mounted.fake.repository.inspectPortraitCommit = async () => ({ status: 'not-committed' });
    const input = mounted.container.querySelectorAll('input').find(control => control.type === 'file');
    input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage du portrait').dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(cleaned, ['portraits/a/new.webp']); assert.deepEqual(acked, ['portraits/a/old.webp', 'portraits/a/new.webp']); assert.deepEqual(mounted.navigated, []); assert.equal(mounted.container.querySelectorAll('#m-pnj-nom')[0].value, 'Ada');
});

test('retrait commitDone avec cleanup en panne expose une reprise immédiate de l ancien portrait', async () => {
    const cleaned = []; const imageService = {
        remove: async () => { throw new Error('cleanup-failed'); },
        cleanupImage: async path => { cleaned.push(path); },
        ackUpload: () => true,
    };
    const mounted = await mountedForm({ publicItem: { id: 'a', nom: 'Ada', statut: '', vivant: 'oui', lieu: '', groupe: '', description: '', visibleJoueurs: true, imagePath: 'portraits/a/old.webp', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] }, getImageService: () => imageService });
    mounted.container.querySelectorAll('button').find(button => button.textContent === 'Retirer le portrait').dispatch('click');
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve(); await Promise.resolve();
    const recover = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage du portrait');
    assert.equal(recover.hidden, false); recover.dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(cleaned, ['portraits/a/old.webp']); assert.deepEqual(mounted.navigated, ['#/pnjs']);
});

test('un double toucher ne lance qu’une création', async () => {
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined });
    const form = mounted.container.querySelectorAll('form')[0]; form.querySelectorAll('[data-field]')[0].value = 'A';
    form.dispatch('submit'); form.dispatch('submit'); await Promise.resolve();
    assert.equal(mounted.fake.calls.create, 1);
});

test('la validation hostile refuse tableaux, objets et undefined sans coercition', () => {
    const result = validatePnjForm({ nom: ['A'], description: {}, notes: undefined, visibleJoueurs: undefined, statut: '', vivant: 'inconnu' });
    assert.equal(result.valid, false); assert.ok(result.errors.nom); assert.ok(result.errors.description); assert.ok(result.errors.notes); assert.ok(result.errors.visibleJoueurs);
});

test('la première erreur reçoit le focus et la visibilité expose son erreur ARIA', async () => {
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined });
    const form = mounted.container.querySelectorAll('form')[0]; form.dispatch('submit');
    const nom = mounted.container.querySelectorAll('#m-pnj-nom')[0]; const visible = mounted.container.querySelectorAll('#m-pnj-visibleJoueurs')[0];
    assert.equal(mounted.documentRef.activeElement, nom); assert.match(nom.getAttribute('aria-describedby'), /m-pnj-nom-error/u); assert.match(visible.getAttribute('aria-describedby'), /m-pnj-visibleJoueurs-error/u);
});

test('le résumé d’erreurs place le focus sans modifier la route hash', async () => {
    const mounted = await mountedForm();
    const form = mounted.container.querySelectorAll('form')[0];
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = '';
    form.dispatch('submit');
    await Promise.resolve();
    const link = mounted.container.querySelectorAll('.m-form-summary')[0].children[1].children[0].children[0];
    let prevented = false;
    link.dispatch('click', { preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(mounted.container.ownerDocument.activeElement, mounted.container.querySelectorAll('#m-pnj-nom')[0]);
});

test('une émission distante après initialisation ne remplace pas le brouillon', async () => {
    const mounted = await mountedForm(); const nom = mounted.container.querySelectorAll('#m-pnj-nom')[0]; nom.value = 'Brouillon';
    mounted.fake.publicCallbacks[0].next({ ...fakeRepository().repository, id: 'a', nom: 'Distant', visibleJoueurs: true, issues: [], updatedAt: { seconds: 9, nanoseconds: 0 } });
    assert.equal(nom.value, 'Brouillon'); assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /changé ailleurs/u);
});

test('un snapshot privé strictement identique ne remplace pas une note brouillon', async () => {
    const mounted = await mountedForm();
    const notes = mounted.container.querySelectorAll('#m-pnj-notes')[0]; notes.value = 'note brouillon';
    mounted.fake.privateCallbacks[0].next({ id: 'a', notes: 'secret', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] });
    assert.equal(notes.value, 'note brouillon');
});

test('un snapshot privé malformé bloque l’initialisation et n’écrit jamais une note vide', async () => {
    const mounted = await mountedForm({ privateItem: { id: 'a', notes: [], issues: [{ field: 'notes' }] } });
    assert.equal(mounted.container.querySelectorAll('#m-pnj-notes')[0].value, '');
    assert.equal(mounted.fake.calls.update, 0);
});

test('un privé absent en édition reste fail-closed et ne recrée pas des notes vides', async () => {
    const mounted = await mountedForm({ privateItem: null });
    const save = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Enregistrer');
    assert.equal(save.disabled, true);
    assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /notes privées.*indisponibles/u);
    assert.equal(mounted.fake.calls.update, 0);
});

test('un privé orphelin ne remplit jamais le DOM sans public valide', async () => {
    const mounted = await mountedForm({ publicItem: null, privateItem: { id: 'a', notes: 'secret-orphelin', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] } });
    assert.equal(mounted.container.querySelectorAll('#m-pnj-notes')[0].value, '');
    assert.equal(mounted.container.querySelectorAll('button')[1].disabled, true);
});

test('un rechargement sans PNJ public retrouve le verrou et expose la reprise sans notes', async () => {
    const mounted = await mountedForm({ confirm: () => false, publicItem: null, privateItem: { id: 'a', notes: 'ne doit pas apparaître', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] }, removalLock: { pnjId: 'a', imagePaths: [] } });
    const resume = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    assert.equal(resume.hidden, false); assert.equal(mounted.container.querySelectorAll('#m-pnj-notes')[0].value, '');
    assert.equal(mounted.container.querySelectorAll('button').find(button => button.textContent === 'Enregistrer').disabled, true);
    assert.equal(mounted.view.beforeLeave(), false);
});

test('un marqueur public de suppression avec verrou reste en reprise fail-closed', async () => {
    const mounted = await mountedForm({ publicItem: { id: 'a', nom: 'Ada', suppressionEnCours: true, issues: [] }, removalLock: { pnjId: 'a', imagePaths: [] } });
    assert.equal(mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage').hidden, false);
    assert.equal(mounted.container.querySelectorAll('#m-pnj-notes')[0].value, '');
});

test('un verrou arrivé après logout est ignoré par la garde génération/UID', async () => {
    let resolveLock; let state = gmState('a');
    const documentRef = fakeDocument(); const container = new Element(documentRef, 'main'); const fake = fakeRepository();
    fake.repository.inspectRemovalLock = () => new Promise(resolve => { resolveLock = resolve; });
    const view = createPnjEditView({ container, id: 'a', repository: fake.repository, getSession: () => state });
    view.mount(); state = { status: 'visitor', role: 'public', user: null }; resolveLock({ pnjId: 'a' }); await Promise.resolve();
    assert.equal(container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage').hidden, true);
    view.unmount();
});

test('une saisie commencée pendant le chargement edit survit aux snapshots initiaux', async () => {
    const mounted = await mountedForm({ skipInitial: true });
    const nom = mounted.container.querySelectorAll('#m-pnj-nom')[0]; nom.value = 'Brouillon avant cache'; nom.dispatch('input');
    mounted.fake.publicCallbacks[0].next({ id: 'a', nom: 'Ada', statut: 'allié', vivant: 'non', lieu: 'Altdorf', groupe: 'Garde', description: 'Texte serveur', visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] });
    mounted.fake.privateCallbacks[0].next({ id: 'a', notes: 'notes serveur', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] });
    assert.equal(nom.value, 'Brouillon avant cache');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-statut')[0].value, 'allié');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-vivant')[0].value, 'non');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-lieu')[0].value, 'Altdorf');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-groupe')[0].value, 'Garde');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-description')[0].value, 'Texte serveur');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-visibleJoueurs')[0].checked, false);
    assert.equal(mounted.container.querySelectorAll('#m-pnj-notes')[0].value, 'notes serveur');
});

test('une note commencée pendant le chargement conserve seulement ce champ sale', async () => {
    const mounted = await mountedForm({ skipInitial: true });
    const notes = mounted.container.querySelectorAll('#m-pnj-notes')[0]; notes.value = 'note avant cache'; notes.dispatch('input');
    mounted.fake.publicCallbacks[0].next({ id: 'a', nom: 'Ada', statut: 'ennemi', vivant: 'oui', lieu: 'Middenheim', groupe: 'Cultistes', description: 'Description serveur', visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] });
    mounted.fake.privateCallbacks[0].next({ id: 'a', notes: 'note serveur', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] });
    assert.equal(notes.value, 'note avant cache');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-nom')[0].value, 'Ada');
    assert.equal(mounted.container.querySelectorAll('#m-pnj-description')[0].value, 'Description serveur');
});

test('un save obsolète après démontage ne navigue ni n’annonce', async () => {
    const mounted = await mountedForm({ id: null, publicItem: undefined, privateItem: undefined });
    let resolve; mounted.fake.repository.create = () => new Promise(done => { resolve = done; });
    const form = mounted.container.querySelectorAll('form')[0]; form.querySelectorAll('[data-field]')[0].value = 'A'; form.dispatch('submit');
    mounted.view.unmount(); resolve({ id: 'late' }); await Promise.resolve();
    assert.deepEqual(mounted.navigated, []); assert.deepEqual(mounted.announced, []);
});

test('l’aperçu d’impact précède la confirmation et conserve les comptes', async () => {
    const mounted = await mountedForm(); const remove = mounted.container.querySelectorAll('.m-button-danger')[0]; remove.dispatch('click'); await Promise.resolve();
    assert.equal(mounted.container.querySelectorAll('.m-removal-confirmation')[0].hidden, false); assert.match(mounted.container.textContent, /2 relations/u);
});

test('une suppression avec cleanup pending expose la reprise puis navigue en replace au succès', async () => {
    const mounted = await mountedForm(); mounted.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: true, lockRetained: true, legacyImageSkipped: true });
    const remove = mounted.container.querySelectorAll('.m-button-danger')[0]; remove.dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger')[1].dispatch('click'); await Promise.resolve();
    assert.equal(mounted.container.querySelectorAll('button').at(-1).textContent, 'Reprendre le nettoyage');
    assert.deepEqual(mounted.navigated, [], 'un cleanup en attente garde la vue et son CTA');
    mounted.container.querySelectorAll('button').at(-1).dispatch('click'); await Promise.resolve();
    assert.equal(mounted.fake.calls.resume, 1); assert.deepEqual(mounted.navigated, ['#/pnjs']);
    assert.deepEqual(mounted.events.slice(-2), [['navigate', '#/pnjs'], ['announce', 'Nettoyage du PNJ terminé.']]);
});

test('une suppression confirmée efface le draft retrouvé par PNJ, même sans draftId courant', async () => {
    let available = false; const removed = [];
    const draftStore = { find: () => available ? { draftId: 'draft:abcdefgh' } : null, remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) };
    const mounted = await mountedForm({ draftStore }); available = true;
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger')[1].dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);
});

test('cleanup pending confirmé efface le draft, tandis qu’un verrou avant Firestore le conserve', async () => {
    let available = false; const removed = [];
    const draftStore = { find: () => available ? { draftId: 'draft:abcdefgh' } : null, remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) };
    const mounted = await mountedForm({ draftStore }); available = true;
    mounted.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: true, lockRetained: false });
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger').find(button => button.textContent === 'Confirmer la suppression').dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);

    const second = await mountedForm({ draftStore: { find: () => ({ draftId: 'draft:abcdefgh' }), remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) } });
    second.fake.repository.remove = async () => ({ firestoreDone: false, imageCleanupPending: false, lockRetained: true });
    second.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    second.container.querySelectorAll('.m-button-danger').find(button => button.textContent === 'Confirmer la suppression').dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);
});

test('une erreur post-commit efface le draft, mais commitUnknown le conserve', async () => {
    const removed = []; let available = false;
    const draftStore = { find: () => available ? { draftId: 'draft:abcdefgh' } : null, remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) };
    const committed = await mountedForm({ draftStore }); available = true;
    committed.fake.repository.remove = async () => { throw Object.assign(new Error('cleanup'), { state: { commitDone: true, cleanupPending: true, firestoreDone: true } }); };
    committed.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    committed.container.querySelectorAll('.m-button-danger').find(button => button.textContent === 'Confirmer la suppression').dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);

    const uncertain = await mountedForm({ draftStore: { find: () => ({ draftId: 'draft:ijklmnop' }), remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) } });
    uncertain.fake.repository.remove = async () => { throw Object.assign(new Error('unknown'), { state: { commitUnknown: true, cleanupPending: true, firestoreDone: false } }); };
    uncertain.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    uncertain.container.querySelectorAll('.m-button-danger').find(button => button.textContent === 'Confirmer la suppression').dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);
});

test('une reprise avec erreur post-commit efface le draft et commitUnknown le conserve', async () => {
    const removed = [];
    const draftStore = { find: () => ({ draftId: 'draft:abcdefgh' }), remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) };
    const committed = await mountedForm({ draftStore });
    committed.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: true, lockRetained: true });
    committed.fake.repository.resumeRemoval = async () => { throw Object.assign(new Error('cleanup'), { state: { commitDone: true, cleanupPending: true, firestoreDone: true } }); };
    committed.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    committed.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage').dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);

    const uncertain = await mountedForm({ draftStore: { find: () => ({ draftId: 'draft:ijklmnop' }), remove: id => { removed.push(id); return true; }, save: () => ({ ok: false, reason: 'quota' }) } });
    uncertain.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: true, lockRetained: true });
    uncertain.fake.repository.resumeRemoval = async () => { throw Object.assign(new Error('unknown'), { state: { commitUnknown: true, cleanupPending: true, firestoreDone: false } }); };
    uncertain.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    uncertain.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage').dispatch('click'); await Promise.resolve();
    assert.deepEqual(removed, ['draft:abcdefgh']);
});

test('avant départ, un quota de draft n’annonce pas une conservation inexistante', async () => {
    let confirmation = '';
    const mounted = await mountedForm({ confirm: message => { confirmation = message; return false; }, draftStore: { find: () => null, save: () => ({ ok: false, reason: 'quota' }), remove: () => true } });
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Saisie non persistée';
    mounted.container.querySelectorAll('#m-pnj-nom')[0].dispatch('input');
    assert.equal(mounted.view.beforeLeave(), false); assert.match(confirmation, /échoué|perdre/u);
    assert.doesNotMatch(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /conservés localement/u);
});

test('un draft refusé est réutilisé puis tous les drafts du PNJ sont purgés après succès', async () => {
    const drafts = [{ draftId: 'draft:abcdefgh', pnjId: 'a' }, { draftId: 'draft:ijklmnop', pnjId: 'a' }]; const removed = [];
    const draftStore = {
        find: () => drafts[0] || null,
        list: () => drafts.slice(),
        save: (_values, options) => ({ ok: true, draft: { draftId: options.draftId || 'draft:abcdefgh', pnjId: 'a' } }),
        remove: id => { removed.push(id); const index = drafts.findIndex(item => item.draftId === id); if (index >= 0) drafts.splice(index, 1); return true; },
    };
    const mounted = await mountedForm({ confirm: () => false, draftStore });
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Après refus';
    mounted.container.querySelectorAll('#m-pnj-nom')[0].dispatch('input');
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.deepEqual(removed.sort(), ['draft:abcdefgh', 'draft:ijklmnop']); assert.equal(drafts.length, 0);
});

test('le force-save reste bloqué pendant un recovery et vérifie le draftVersion après await', () => {
    const source = fs.readFileSync(path.join(root, 'js/mobile/views/pnj-edit.js'), 'utf8');
    assert.match(source, /forceSaveConflict[\s\S]{0,300}recoveryLocked[\s\S]{0,80}imageRecoveryLocked[\s\S]{0,80}saving[\s\S]{0,80}removing/u);
    assert.match(source, /await getRepository\(\)\.forceUpdate[\s\S]{0,500}draftVersion !== operation\.draftVersion/u);
});

test('une suppression interrompue avant Firestore conserve le CTA de reprise sans faux succès', async () => {
    const mounted = await mountedForm();
    mounted.fake.repository.remove = async () => ({ firestoreDone: false, imageCleanupPending: false, lockRetained: true, legacyImageSkipped: true });
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger')[1].dispatch('click'); await Promise.resolve();
    const resume = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    assert.equal(resume.hidden, false); assert.equal(resume.disabled, false); assert.deepEqual(mounted.navigated, []);
    assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /interrompue/u);
});

test('un échec de déverrouillage conserve la reprise même après suppression Firestore', async () => {
    const mounted = await mountedForm();
    mounted.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: false, lockRetained: true });
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger')[1].dispatch('click'); await Promise.resolve();
    assert.equal(mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage').hidden, false);
    assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /enregistrée/u);
    assert.deepEqual(mounted.navigated, []);
});

test('un portrait legacy ignoré est signalé sans exposer son chemin et navigue en replace', async () => {
    const mounted = await mountedForm();
    mounted.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: false, lockRetained: false, legacyImageSkipped: true });
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger')[1].dispatch('click'); await Promise.resolve();
    const status = mounted.container.querySelectorAll('.m-form-status')[0].textContent;
    assert.doesNotMatch(status, /secret\.example|raw-token/u); assert.deepEqual(mounted.navigated, ['#/pnjs']);
    assert.deepEqual(mounted.events.slice(-2), [['navigate', '#/pnjs'], ['announce', 'PNJ supprimé ; un ancien portrait reste à traiter.']]);
});

test('une erreur de reprise conserve le CTA actif et ne navigue pas', async () => {
    const mounted = await mountedForm();
    mounted.fake.repository.remove = async () => ({ firestoreDone: true, imageCleanupPending: true, lockRetained: true });
    mounted.fake.repository.resumeRemoval = async () => { throw Object.assign(new Error('resume-raw'), { state: { firestoreDone: false, imageCleanupPending: false, lockRetained: true } }); };
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    mounted.container.querySelectorAll('.m-button-danger')[1].dispatch('click'); await Promise.resolve();
    const resume = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Reprendre le nettoyage');
    resume.dispatch('click'); await Promise.resolve();
    assert.equal(resume.hidden, false); assert.equal(resume.disabled, false); assert.deepEqual(mounted.navigated, []);
    assert.doesNotMatch(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /resume-raw/u);
});

test('un subscribe privé qui échoue ferme les listeners et ne permet pas au public tardif d initialiser', async () => {
    const mounted = await mountedForm({ throwPrivate: new Error('private-raw') });
    mounted.fake.publicCallbacks[0].next(fakeRepository().repository);
    const save = mounted.container.querySelectorAll('button').find(button => button.textContent === 'Enregistrer');
    assert.equal(save.disabled, true);
    assert.doesNotMatch(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /private-raw/u);
});

test('un portrait existant non éditable ne rend pas le formulaire dirty', async () => {
    const mounted = await mountedForm({ confirm: () => false, publicItem: { id: 'a', nom: 'Ada', statut: '', vivant: 'inconnu', lieu: '', groupe: '', description: '', visibleJoueurs: true, imagePath: 'portraits/a/a.webp', updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] } });
    mounted.container.querySelectorAll('button')[0].dispatch('click');
    assert.deepEqual(mounted.back, [true]);
});

test('une modification transmet expectedUpdatedAt initial au dépôt', async () => {
    const mounted = await mountedForm();
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Nouveau nom';
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.deepEqual(mounted.fake.calls.updateArgs[3], { seconds: 1, nanoseconds: 0 });
    assert.deepEqual(mounted.fake.calls.updateArgs[4], { seconds: 1, nanoseconds: 0 });
});

test('un conflit update conserve exactement le brouillon et ne navigue pas', async () => {
    const mounted = await mountedForm();
    mounted.fake.repository.update = async () => { throw Object.assign(new Error('raw-conflict'), { code: 'conflict' }); };
    const nom = mounted.container.querySelectorAll('#m-pnj-nom')[0]; nom.value = 'Brouillon conflit';
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.equal(nom.value, 'Brouillon conflit'); assert.deepEqual(mounted.navigated, []);
    assert.doesNotMatch(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /raw-conflict/u);
});

test('un force différé verrouille le panneau conflit et ignore Reload hostile', async () => {
    const mounted = await mountedForm();
    const nom = mounted.container.querySelectorAll('#m-pnj-nom')[0]; nom.value = 'Saisie locale'; nom.dispatch('input');
    mounted.fake.publicCallbacks[0].next({ id: 'a', nom: 'Version distante', statut: '', vivant: 'inconnu', lieu: '', groupe: '', description: '', visibleJoueurs: true, updatedAt: { seconds: 2, nanoseconds: 0 }, issues: [] });
    const panel = mounted.container.querySelectorAll('.m-form-conflict')[0]; const buttons = panel.querySelectorAll('button');
    assert.equal(buttons.length, 3); const force = buttons.find(button => button.textContent === 'Forcer après confirmation MJ');
    force.dispatch('click'); await Promise.resolve();
    assert.equal(mounted.fake.calls.forceUpdate, 1); assert.equal(buttons.every(button => button.disabled), true);
    const reload = buttons.find(button => button.textContent === 'Recharger le serveur'); reload.dispatch('click');
    assert.equal(nom.value, 'Saisie locale', 'Reload injecté pendant la mutation ne doit pas écraser la saisie');
    mounted.fake.deferred.forceUpdate(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(mounted.navigated, ['#/pnjs/a']);
});

test('une permission brute est convertie en message UI générique', async () => {
    const mounted = await mountedForm();
    mounted.fake.repository.update = async () => { throw Object.assign(new Error('permission-secret'), { code: 'permission-denied' }); };
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Nom';
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.doesNotMatch(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /permission-secret/u);
    assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /autorisée/u);
});

test('un aperçu d’impact tardif après démontage ne réécrit pas le DOM', async () => {
    const mounted = await mountedForm(); let resolve;
    mounted.fake.repository.inspectRemovalImpact = () => new Promise(done => { resolve = done; });
    mounted.container.querySelectorAll('.m-button-danger')[0].dispatch('click');
    mounted.view.unmount(); resolve({ id: 'a', name: 'late', relationsCount: 1, indicesCount: 0 }); await Promise.resolve();
    assert.equal(mounted.container.children.length, 0); assert.deepEqual(mounted.navigated, []);
});

test('une suppression tardive après changement d UID ne produit ni annonce ni navigation', async () => {
    let state = gmState('a'); let resolve; const documentRef = fakeDocument(); const container = new Element(documentRef, 'main');
    const fake = fakeRepository(); const navigated = []; const announced = [];
    fake.repository.remove = () => new Promise(done => { resolve = done; });
    const view = createPnjEditView({ container, id: 'a', repository: fake.repository, getSession: () => state, onNavigate: value => navigated.push(value), announce: value => announced.push(value) });
    view.mount(); await Promise.resolve();
    container.querySelectorAll('.m-button-danger')[0].dispatch('click'); await Promise.resolve();
    container.querySelectorAll('.m-button-danger')[1].dispatch('click'); state = gmState('b'); resolve({ firestoreDone: true, imageCleanupPending: false }); await Promise.resolve();
    assert.deepEqual(navigated, []); assert.deepEqual(announced, []);
});

test('le warning de dépublication passe par la capacité read-only du dépôt', async () => {
    const mounted = await mountedForm(); let resolve;
    mounted.fake.repository.inspectVisibilityImpact = () => new Promise(done => { resolve = done; });
    mounted.container.querySelectorAll('#m-pnj-visibleJoueurs')[0].checked = false;
    mounted.container.querySelectorAll('#m-pnj-nom')[0].value = 'Ada';
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /Dépublication/u);
    resolve({ visibleRelationsCount: 2 }); await Promise.resolve();
});

test('la republication avertit les relations visibles incompatibles', async () => {
    const mounted = await mountedForm({ publicItem: { id: 'a', nom: 'Ada', statut: '', vivant: 'oui', lieu: '', groupe: '', description: '', visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, issues: [] } });
    mounted.container.querySelectorAll('#m-pnj-visibleJoueurs')[0].checked = true;
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /PNJ masqué|incompatible/u);
});

test('une saisie hostile pendant l’inspection visibilité annule le commit et verrouille les contrôles', async () => {
    const mounted = await mountedForm(); let resolveImpact;
    mounted.fake.repository.inspectVisibilityImpact = () => new Promise(resolve => { resolveImpact = resolve; });
    const visible = mounted.container.querySelectorAll('#m-pnj-visibleJoueurs')[0]; visible.checked = false; visible.dispatch('change');
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    const description = mounted.container.querySelectorAll('#m-pnj-description')[0];
    assert.equal(description.disabled, true);
    description.value = 'mutation hostile'; description.dispatch('input'); resolveImpact({ visibleRelationsCount: 0, incompatibleVisibleRelationsCount: 0 }); await Promise.resolve();
    assert.equal(mounted.fake.calls.update, 0); assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /changé pendant/u);
});

test('les contrôles restent verrouillés pendant update et un draftVersion changé ne navigue pas', async () => {
    const mounted = await mountedForm(); let resolveUpdate;
    mounted.fake.repository.update = () => new Promise(resolve => { resolveUpdate = resolve; });
    const nom = mounted.container.querySelectorAll('#m-pnj-nom')[0]; nom.value = 'Nom sauvegardé'; nom.dispatch('input');
    mounted.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    const description = mounted.container.querySelectorAll('#m-pnj-description')[0]; assert.equal(description.disabled, true);
    description.value = 'mutation hostile'; description.dispatch('input'); resolveUpdate({ id: 'a' }); await Promise.resolve();
    assert.deepEqual(mounted.navigated, []); assert.equal(description.disabled, false); assert.match(mounted.container.querySelectorAll('.m-form-status')[0].textContent, /changé pendant/u);
});

test('les transitions Auth protègent les routes et réactivent les actions administratives', () => {
    const source = fs.readFileSync(path.join(root, 'js/mobile/app.js'), 'utf8');
    const controllerSource = fs.readFileSync(path.join(root, 'js/mobile/admin-route-controller.js'), 'utf8');
    assert.match(source, /ROUTE_NAMES\.PNJ_NEW/u); assert.match(source, /ROUTE_NAMES\.PNJ_EDIT/u);
    assert.match(source, /router\.navigate\(\{ name: ROUTE_NAMES\.PNJS \}, \{ replace: true, skipGuard: true \}\)/u);
    assert.match(controllerSource, /status === 'gm' && role === 'mj'/u);
    const list = fs.readFileSync(path.join(root, 'js/mobile/views/pnjs-list.js'), 'utf8');
    assert.match(list, /Nouveau PNJ/u); assert.match(list, /state\?\.status === 'gm' && state\?\.role === 'mj'/u);
});

test('le contrôleur Auth remonte new/edit, bloque checking, et remplace après logout', () => {
    const calls = []; const routeNames = { PNJS: 'pnjs-list', PNJ: 'pnj-detail', PNJ_NEW: 'pnj-new', PNJ_EDIT: 'pnj-edit' };
    const controller = createAdminRouteController({ routeNames, onRefresh: () => calls.push('refresh'), onNavigatePublic: () => calls.push('public'), onAnnounce: () => calls.push('announce') });
    assert.equal(controller.transition({ routeName: 'pnj-new', status: 'checking', role: 'public', uid: '' }), 'refresh-checking');
    assert.equal(controller.transition({ routeName: 'pnj-new', status: 'gm', role: 'mj', uid: 'a' }), 'refresh-admin');
    assert.equal(controller.transition({ routeName: 'pnj-edit', status: 'signing-out', role: 'public', uid: 'a' }), 'refresh-checking');
    assert.equal(controller.transition({ routeName: 'pnj-edit', status: 'visitor', role: 'public', uid: '' }), 'navigate-public');
    assert.deepEqual(calls, ['refresh', 'refresh', 'refresh', 'public', 'announce']);
});

test('le bouton Modifier du détail suit la session et disparaît au logout', () => {
    const documentRef = fakeDocument(); const container = new Element(documentRef, 'main');
    let state = gmState(); const listeners = new Set();
    const ready = () => ({ generation: 1, resources: {
        pnjs: { status: 'ready', items: [{ id: 'a', nom: 'Ada', visibleJoueurs: true }] },
        relations: { status: 'ready', items: [] }, indices: { status: 'ready', items: [] },
    }, connection: { phase: 'ready', sync: 'server' }, cache: { persistent: true } });
    const store = { subscribe(listener) { listeners.add(listener); listener(ready()); return () => listeners.delete(listener); }, restart() {} };
    const view = createPnjDetailView({ container, id: 'a', store, getSession: () => state, onEdit: () => {} });
    view.mount();
    assert.equal(container.querySelectorAll('button').filter(button => button.textContent === 'Modifier').length, 1);
    state = { status: 'visitor', role: 'public', user: null }; listeners.forEach(listener => listener(ready()));
    assert.equal(container.querySelectorAll('button').filter(button => button.textContent === 'Modifier').length, 0);
    view.unmount();
});

test('router.back respecte beforeLeave dirty puis accepte le retour', () => {
    const windowRef = { location: { hash: '#/pnjs/a/modifier' }, history: { replaceState: (_s, _t, hash) => { windowRef.location.hash = hash; } }, addEventListener() {}, removeEventListener() {} };
    let allow = false; let mounts = 0;
    const router = createRouter({ windowRef, mountRoute: () => ({ mount() { mounts += 1; }, unmount() {}, beforeLeave: () => allow }) });
    router.start(); assert.equal(mounts, 1); router.back(); assert.equal(router.getRoute().name, ROUTE_NAMES.PNJ_EDIT);
    allow = true; router.back(); assert.equal(router.getRoute().name, ROUTE_NAMES.PNJ);
    router.stop();
});

test('navigate, hashchange et popstate respectent beforeLeave et restaurent la route refusée', () => {
    const listeners = new Map();
    const windowRef = {
        location: { hash: '#/pnjs/a/modifier' },
        history: {
            pushState: (_s, _t, hash) => { windowRef.location.hash = hash; },
            replaceState: (_s, _t, hash) => { windowRef.location.hash = hash; },
        },
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: () => {},
    };
    let allow = false; let mounts = 0;
    const router = createRouter({ windowRef, mountRoute: () => ({ mount() { mounts += 1; }, unmount() {}, beforeLeave: () => allow }) });
    router.start(); assert.equal(mounts, 1);
    router.navigate({ name: ROUTE_NAMES.PNJS });
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJ_EDIT); assert.equal(windowRef.location.hash, '#/pnjs/a/modifier'); assert.equal(mounts, 1);
    windowRef.location.hash = '#/pnjs'; listeners.get('hashchange')();
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJ_EDIT); assert.equal(windowRef.location.hash, '#/pnjs/a/modifier');
    windowRef.location.hash = '#/pnjs'; listeners.get('popstate')();
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJ_EDIT); assert.equal(windowRef.location.hash, '#/pnjs/a/modifier');
    router.navigate({ name: ROUTE_NAMES.PNJS }, { skipGuard: true });
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJS); assert.equal(mounts, 2);
    router.stop();
});

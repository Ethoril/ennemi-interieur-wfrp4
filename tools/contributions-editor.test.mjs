import test from 'node:test';
import assert from 'node:assert/strict';
import { mountContentTrashPanel, mountContributionButton } from '../js/contributions/editor.js';
import {
    getCampaignCapabilities,
    getContentEditContext,
    getContentPnjChoices,
    listContentTrash,
    mutateMjContent,
    mutatePublicContent,
    restorePublicContent,
    trashPublicContent,
} from '../functions/src/contributions/service.mjs';

class FakeElement {
    constructor(documentRef, tagName) {
        this.ownerDocument = documentRef;
        this.tagName = tagName.toLowerCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.files = [];
        this.disabled = false;
        this.hidden = false;
        this.multiple = false;
        this.selected = false;
        this.checked = false;
        this._value = '';
        this._type = '';
        this.textContent = '';
    }
    append(...nodes) {
        for (const node of nodes) {
            node.parentNode?.removeChild(node);
            node.parentNode = this;
            this.children.push(node);
        }
    }
    prepend(node) { node.parentNode = this; this.children.unshift(node); }
    replaceChildren(...nodes) { this.children.forEach(node => { node.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { this.children = this.children.filter(child => child !== node); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    closest(tag) {
        let node = this;
        while (node && node.tagName !== tag) node = node.parentNode;
        return node || null;
    }
    get value() {
        if (this.tagName === 'select' && this.multiple) return this.selectedOptions[0]?.value || '';
        if (this.tagName === 'select' && this.children.length) return this.children.find(option => option.selected)?.value ?? this._value;
        return this._value;
    }
    get type() { return this._type; }
    set type(value) {
        if (this.tagName.toLowerCase() === 'select') throw new TypeError('select.type est en lecture seule');
        this._type = value;
    }
    set value(value) {
        this._value = String(value ?? '');
        if (this.tagName === 'select' && !this.multiple) {
            for (const option of this.children) option.selected = option.value === this._value;
        }
    }
    get selectedOptions() { return this.children.filter(option => option.selected); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    async dispatch(type) {
        const event = { type, target: this, currentTarget: this, preventDefault() {} };
        await Promise.all((this.listeners.get(type) || []).map(listener => listener(event)));
    }
    find(predicate) {
        for (const child of this.children) {
            if (predicate(child)) return child;
            const nested = child.find?.(predicate);
            if (nested) return nested;
        }
        return null;
    }
}

function makeDocument() {
    const documentRef = {
        defaultView: { crypto: { randomUUID: () => 'qa-operation-1' }, confirm: () => true, btoa: value => value },
        createElement(tag) { return new FakeElement(documentRef, tag); },
        createTextNode(value) { const node = new FakeElement(documentRef, '#text'); node.textContent = value; return node; },
    };
    documentRef.body = documentRef.createElement('body');
    return documentRef;
}

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('le formulaire relation utilise des libellés humains, masque les PNJ cachés du joueur et verrouille les champs pendant l’enregistrement', async () => {
    const documentRef = makeDocument();
    const container = documentRef.createElement('div');
    const request = deferred();
    let submitted = null;
    const client = {
        watch(listener) { listener({ user: { uid: 'player' }, capabilities: { role: 'joueur', contribution: true } }); return () => {}; },
        currentUser: () => ({ uid: 'player', emailVerified: true }),
        async getCampaignCapabilities() { return { role: 'joueur', contribution: true }; },
        async getContentPnjChoices() { return { pnjs: [{ id: 'visible', nom: 'Mara' }, { id: 'visible-2', nom: 'Jorik' }] }; },
        async mutatePublicContent(command) { submitted = command; return request.promise; },
    };
    mountContributionButton({ container, client, kind: 'relation', action: 'create', documentRef });
    const button = container.children[0];
    assert.equal(button.textContent, 'Créer une relation');
    await button.dispatch('click');
    const dialog = documentRef.body.children[0];
    const source = dialog.find(node => node.dataset?.field === 'source');
    const target = dialog.find(node => node.dataset?.field === 'cible');
    const style = dialog.find(node => node.dataset?.field === 'style');
    const label = dialog.find(node => node.dataset?.field === 'label');
    const submit = dialog.find(node => node.tagName === 'button' && node.textContent === 'Enregistrer');
    assert.deepEqual(source.children.map(option => option.textContent), ['Choisir un PNJ', 'Mara', 'Jorik']);
    assert.deepEqual(target.children.map(option => option.textContent), ['Choisir un PNJ', 'Mara', 'Jorik']);
    assert.deepEqual(style.children.map(option => option.textContent), ['Plein', 'Pointillé']);
    source.value = 'visible';
    target.value = 'visible-2';
    label.value = 'connaît';
    const submitting = dialog.find(node => node.tagName === 'form').dispatch('submit');
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(submit.disabled, true);
    assert.equal(source.disabled, true);
    assert.equal(target.disabled, true);
    request.resolve({ revision: 1 });
    await submitting;
    assert.equal(submitted.changes.source, 'visible');
    assert.equal(submitted.changes.cible, 'visible-2');
    assert.equal(submitted.changes.style, 'solid');
    assert.equal(dialog.open, false);
});

test('le formulaire d’indice sélectionne les PNJ par nom sans remplacer les identifiants envoyés', async () => {
    const documentRef = makeDocument();
    const container = documentRef.createElement('div');
    let submitted = null;
    const client = {
        watch(listener) { listener({ user: { uid: 'player' }, capabilities: { role: 'joueur', contribution: true } }); return () => {}; },
        currentUser: () => ({ uid: 'player', emailVerified: true }),
        async getCampaignCapabilities() { return { role: 'joueur', contribution: true }; },
        async getContentPnjChoices() { return { pnjs: [{ id: 'visible-id', nom: 'Mara Vif-Argent' }] }; },
        async mutatePublicContent(command) { submitted = command; return { revision: 1 }; },
    };
    mountContributionButton({ container, client, kind: 'indice', action: 'create', documentRef });
    await container.children[0].dispatch('click');
    const dialog = documentRef.body.children[0];
    const linked = dialog.find(node => node.dataset?.field === 'pnjsLies');
    const submit = dialog.find(node => node.tagName === 'form');
    assert.equal(linked.multiple, true);
    assert.equal(linked.children[0].textContent, 'Mara Vif-Argent');
    linked.children[0].selected = true;
    await submit.dispatch('submit');
    assert.deepEqual(submitted.changes.pnjsLies, ['visible-id']);
});

test('la corbeille indique la purge Storage en attente et reprend avec le même reçu', async () => {
    const documentRef = makeDocument();
    const container = documentRef.createElement('div');
    let purged = false;
    let purgeCalls = 0;
    const commands = [];
    let confirmations = 0;
    documentRef.defaultView.confirm = () => { confirmations += 1; return true; };
    const client = {
        watch(listener) { listener({ user: { uid: 'mj' }, capabilities: { role: 'mj', contribution: true } }); return () => {}; },
        currentUser: () => ({ uid: 'mj', emailVerified: true }),
        async getCampaignCapabilities() { return { role: 'mj', contribution: true }; },
        async listContentTrash() { return { entries: purged ? [] : [{ kind: 'pnj', id: 'a', revision: 3, summary: 'Aline', canRestore: true }], nextCursor: null }; },
        async purgePublicContent(command) {
            commands.push(command);
            purgeCalls += 1;
            purged = true;
            return purgeCalls === 1
                ? { state: 'purged', cleanup: { status: 'pending', candidates: 1, deleted: 0, missing: 0, retained: 0, pending: 1 } }
                : { state: 'purged', cleanup: { status: 'complete', candidates: 1, deleted: 1, missing: 0, retained: 0, pending: 0 } };
        },
    };
    mountContentTrashPanel({ container, client, documentRef });
    await container.children[0].dispatch('click');
    const purge = documentRef.body.find(node => node.tagName === 'button' && node.textContent === 'Purger définitivement');
    await purge.dispatch('click');
    assert.equal(confirmations, 1);
    assert.equal(purge.textContent, 'Reprendre le nettoyage des images');
    assert.equal(purge.disabled, false);
    assert.match(documentRef.body.find(node => node.className === 'contribution-status').textContent, /image\(s\) à reprendre/u);
    await purge.dispatch('click');
    assert.equal(confirmations, 1);
    assert.equal(purgeCalls, 2);
    assert.equal(commands[0].operationId, commands[1].operationId);
    assert.deepEqual(commands[0], { kind: 'pnj', id: 'a', operationId: 'qa-operation-1', baseRevision: 3 });
    assert.equal(documentRef.body.find(node => node.className === 'contribution-status').textContent, 'Contenu purgé. 1 image(s) nettoyée(s).');
});

test('les nettoyages restent reprenables après rechargement depuis une section MJ sans détails techniques', async () => {
    const documentRef = makeDocument();
    const container = documentRef.createElement('div');
    const commands = [];
    let listed = 0;
    let confirmations = 0;
    documentRef.defaultView.confirm = () => { confirmations += 1; return true; };
    const client = {
        watch(listener) { listener({ user: { uid: 'mj' }, capabilities: { role: 'mj', contribution: true } }); return () => {}; },
        currentUser: () => ({ uid: 'mj', emailVerified: true }),
        async getCampaignCapabilities() { return { role: 'mj', contribution: true }; },
        async listContentTrash() { return { entries: [], nextCursor: null }; },
        async listPendingPurgeCleanups() {
            listed += 1;
            return { entries: listed === 1 ? [{ operationId: 'private-op-42', kind: 'indice', id: 'private-record-7',
                summary: 'La lettre scellée', baseRevision: 8, cleanup: { status: 'pending', retryable: 2 },
                paths: ['indices/private-record-7/image.png'], actorUid: 'private-user' }] : [], nextCursor: null };
        },
        async purgePublicContent(command) {
            commands.push(command);
            return { cleanup: { status: 'complete', retryable: 0, deleted: 2 } };
        },
    };
    mountContentTrashPanel({ container, client, documentRef });
    await container.children[0].dispatch('click');
    const section = documentRef.body.find(node => node.className === 'contribution-cleanup-resume');
    assert.equal(section.hidden, false);
    assert.equal(section.find(node => node.tagName === 'h3').textContent, 'Nettoyages à reprendre');
    const article = section.find(node => node.tagName === 'article');
    const visibleText = article.children.map(node => node.textContent).join(' ');
    assert.match(visibleText, /Indice · La lettre scellée/u);
    assert.doesNotMatch(visibleText, /private-op|private-record|private-user|indices\//u);
    const retry = section.find(node => node.tagName === 'button');
    assert.equal(retry.textContent, 'Reprendre le nettoyage');
    await retry.dispatch('click');
    assert.equal(confirmations, 0);
    assert.deepEqual(commands, [{ kind: 'indice', id: 'private-record-7', operationId: 'private-op-42', baseRevision: 8 }]);
    assert.equal(listed, 2);
});

function createServerHarness(seed = {}, request = { auth: { uid: 'player-1', token: { email: 'player@example.test', email_verified: true } } }) {
    const clone = value => (value === undefined ? undefined : globalThis.structuredClone(value));
    const documents = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
    const snap = (path, value) => ({ id: path.split('/').at(-1), ref: docRef(path), exists: () => value !== undefined, data: () => clone(value) });
    const docRef = path => ({
        path,
        get: async () => snap(path, documents.get(path)),
        collection: name => makeQuery(`${path}/${name}`),
    });
    const makeQuery = (path, filters = [], options = {}) => ({
        path, filters, ...options,
        doc: id => docRef(`${path}/${id}`),
        where: (field, operator, value) => makeQuery(path, [...filters, { field, operator, value }], options),
        orderBy: (field, direction) => makeQuery(path, filters, { ...options, order: [field, direction] }),
        limit: value => makeQuery(path, filters, { ...options, limit: value }),
        startAfter: cursor => makeQuery(path, filters, { ...options, after: cursor?.id }),
        async get() {
            const prefix = `${path}/`;
            let docs = [...documents.entries()]
                .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .filter(([, value]) => filters.every(({ field, operator, value: expected }) => {
                    const actual = value[field];
                    return operator === '==' ? actual === expected
                        : operator === 'array-contains' ? Array.isArray(actual) && actual.includes(expected) : false;
                }))
                .map(([key, value]) => snap(key, value));
            if (options.order) {
                const [field, direction] = options.order;
                docs.sort((left, right) => {
                    const a = left.data()?.[field] ?? 0;
                    const b = right.data()?.[field] ?? 0;
                    if (a === b) return 0;
                    return (a < b ? -1 : 1) * (direction === 'desc' ? -1 : 1);
                });
            }
            if (options.after) {
                const index = docs.findIndex(doc => doc.id === options.after);
                if (index >= 0) docs = docs.slice(index + 1);
            }
            if (options.limit !== undefined) docs = docs.slice(0, options.limit);
            return { docs, size: docs.length, empty: docs.length === 0 };
        },
    });
    let tick = 1000;
    const db = {
        doc: docRef,
        collection: path => makeQuery(path),
        async runTransaction(callback) {
            const writes = new Map();
            const transaction = {
                async get(reference) {
                    if (typeof reference.get === 'function' && reference.filters) return reference.get();
                    return snap(reference.path, documents.get(reference.path));
                },
                set(reference, value) { writes.set(reference.path, ['set', clone(value)]); },
                update(reference, value) { writes.set(reference.path, ['update', clone(value)]); },
                delete(reference) { writes.set(reference.path, ['delete']); },
            };
            const result = await callback(transaction);
            for (const [path, [op, value]] of writes) {
                if (op === 'set') documents.set(path, value);
                else if (op === 'update') documents.set(path, { ...(documents.get(path) || {}), ...value });
                else if (op === 'delete') documents.delete(path);
            }
            return result;
        },
    };
    const deps = { db, timestamp: () => new Date(tick += 1000) };
    const authUser = request.auth ? { uid: request.auth.uid, displayName: 'Test', emailVerified: true } : null;
    const client = {
        watch(listener) {
            void getCampaignCapabilities(request, deps).then(capabilities => listener({ user: authUser, capabilities }));
            return () => {};
        },
        currentUser: () => authUser,
        getCampaignCapabilities: () => getCampaignCapabilities(request, deps),
        getContentEditContext: data => getContentEditContext({ ...request, data }, deps),
        getContentPnjChoices: data => getContentPnjChoices({ ...request, data }, deps),
        mutatePublicContent: command => mutatePublicContent(command, request, deps),
        mutateMjContent: command => mutateMjContent(command, request, deps),
        listContentTrash: data => listContentTrash({ ...request, data }, deps),
        trashPublicContent: command => trashPublicContent(command, request, deps),
        restorePublicContent: command => restorePublicContent(command, request, deps),
    };
    return { client, documents };
}

test('création et édition PNJ par un joueur passent le vrai service serveur (selects statut/vivant, textarea groupes et valeurs héritées)', async () => {
    const documentRef = makeDocument();
    let seq = 0;
    documentRef.defaultView.crypto.randomUUID = () => `op-pnj-${++seq}`;
    const container = documentRef.createElement('div');
    const server = createServerHarness({
        'campagne/acces': { bhelgi: ['player@example.test'] },
        'pnjs/legacy': { nom: 'Ancien', statut: 'Allié', vivant: '', lieu: 'Altdorf', groupes: ['Garde', 'Veilleurs'], description: 'Initial', visibleJoueurs: true },
    });
    const created = [];
    mountContributionButton({ container, client: server.client, kind: 'pnj', action: 'create', documentRef, onSaved: value => created.push(value) });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await container.children[0].dispatch('click');
    const createDialog = documentRef.body.children[0];
    const nom = createDialog.find(node => node.dataset?.field === 'nom');
    const statut = createDialog.find(node => node.dataset?.field === 'statut');
    const vivant = createDialog.find(node => node.dataset?.field === 'vivant');
    const groupes = createDialog.find(node => node.dataset?.field === 'groupes');
    assert.equal(statut.tagName, 'select');
    assert.equal(vivant.tagName, 'select');
    assert.equal(groupes.tagName, 'textarea');
    assert.equal(nom.required, true);
    assert.equal(vivant.value, 'oui', 'vivant vaut oui par défaut à la création');
    nom.value = 'Hans Weber';
    groupes.value = 'Marchands\nGarde';
    await createDialog.find(node => node.tagName === 'form').dispatch('submit');
    assert.equal(createDialog.open, false);
    assert.equal(created.length, 1);
    const stored = server.documents.get(`pnjs/${created[0].id}`);
    assert.equal(stored.nom, 'Hans Weber');
    assert.equal(stored.vivant, 'oui');
    assert.equal(stored.statut, '');
    assert.deepEqual(stored.groupes, ['Marchands', 'Garde']);
    assert.equal(stored.groupe, 'Marchands');

    // Édition d'un PNJ existant avec groupes en tableau et champs statut/vivant hérités
    const editContainer = documentRef.createElement('div');
    mountContributionButton({ container: editContainer, client: server.client, kind: 'pnj', id: 'legacy', action: 'update', documentRef });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await editContainer.children[0].dispatch('click');
    const editDialog = documentRef.body.children[1];
    const editStatut = editDialog.find(node => node.dataset?.field === 'statut');
    const editVivant = editDialog.find(node => node.dataset?.field === 'vivant');
    const editGroupes = editDialog.find(node => node.dataset?.field === 'groupes');
    const editDesc = editDialog.find(node => node.dataset?.field === 'description');
    assert.equal(editStatut.value, 'allié');
    assert.equal(editVivant.value, 'oui');
    assert.equal(editGroupes.value, 'Garde\nVeilleurs');
    editDesc.value = 'Description mise à jour';
    editVivant.value = 'non';
    await editDialog.find(node => node.tagName === 'form').dispatch('submit');
    assert.equal(editDialog.open, false);
    assert.equal(server.documents.get('pnjs/legacy').description, 'Description mise à jour');
    assert.equal(server.documents.get('pnjs/legacy').vivant, 'non');
    assert.deepEqual(server.documents.get('pnjs/legacy').groupes, ['Garde', 'Veilleurs']);
});

test('création et édition de relation gèrent defaultValues, couleur par défaut/null, paire réciproque et garde source !== cible', async () => {
    const documentRef = makeDocument();
    let seq = 0;
    documentRef.defaultView.crypto.randomUUID = () => `op-rel-${++seq}`;
    const server = createServerHarness({
        'campagne/acces': { bhelgi: ['player@example.test'] },
        'pnjs/p1': { nom: 'Mara', visibleJoueurs: true },
        'pnjs/p2': { nom: 'Jorik', visibleJoueurs: true },
        'relations/r-null': { source: 'p1', cible: 'p2', type: 'contact', label: 'connaît', color: null, visibleJoueurs: true },
    });
    const container = documentRef.createElement('div');
    mountContributionButton({
        container, client: server.client, kind: 'relation', action: 'create',
        defaultValues: { source: 'p1' }, documentRef,
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await container.children[0].dispatch('click');
    const dialog = documentRef.body.children[0];
    const source = dialog.find(node => node.dataset?.field === 'source');
    const target = dialog.find(node => node.dataset?.field === 'cible');
    const type = dialog.find(node => node.dataset?.field === 'type');
    const color = dialog.find(node => node.dataset?.field === 'color');
    const pair = dialog.find(node => node.dataset?.field === 'pair');
    assert.equal(source.value, 'p1');
    assert.equal(color.value, '#c9a84c');
    // Même PNJ source et cible bloqué proprement avant l'envoi serveur
    target.value = 'p1';
    type.value = 'rival';
    await dialog.find(node => node.tagName === 'form').dispatch('submit');
    assert.equal(dialog.open, true);
    assert.match(dialog.find(node => node.className === 'contribution-status').textContent, /deux PNJ distincts/u);

    target.value = 'p2';
    pair.checked = true;
    await dialog.find(node => node.tagName === 'form').dispatch('submit');
    assert.equal(dialog.open, false);
    const createdRelations = [...server.documents.entries()].filter(([key]) => key.startsWith('relations/') && key !== 'relations/r-null');
    assert.equal(createdRelations.length, 2, 'la paire réciproque crée les deux sens');

    // Édition d'une relation existante ayant color: null et style absent : aucun faux conflit
    const editContainer = documentRef.createElement('div');
    mountContributionButton({ container: editContainer, client: server.client, kind: 'relation', id: 'r-null', action: 'update', documentRef });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await editContainer.children[0].dispatch('click');
    const editDialog = documentRef.body.children[1];
    editDialog.find(node => node.dataset?.field === 'color').value = '#4caf7d';
    editDialog.find(node => node.dataset?.field === 'style').value = 'dashed';
    await editDialog.find(node => node.tagName === 'form').dispatch('submit');
    assert.equal(editDialog.open, false);
    assert.equal(server.documents.get('relations/r-null').color, '#4caf7d');
    assert.equal(server.documents.get('relations/r-null').style, 'dashed');
});

test('édition MJ via la modale de contribution appelle mutateMjContent sans propriété action', async () => {
    const documentRef = makeDocument();
    const mjRequest = { auth: { uid: 'mj-1', token: { email: 'ethoril@gmail.com', email_verified: true } } };
    const server = createServerHarness({
        'campagne/acces': {},
        'pnjs/p1': { nom: 'Mara', statut: '', vivant: 'oui', lieu: 'Altdorf', groupes: [], groupe: '', description: 'Init', visibleJoueurs: true },
    }, mjRequest);
    const container = documentRef.createElement('div');
    mountContributionButton({ container, client: server.client, kind: 'pnj', id: 'p1', action: 'update', documentRef });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await container.children[0].dispatch('click');
    const dialog = documentRef.body.children[0];
    dialog.find(node => node.dataset?.field === 'description').value = 'Modifié MJ';
    await dialog.find(node => node.tagName === 'form').dispatch('submit');
    assert.equal(dialog.open, false);
    assert.equal(server.documents.get('pnjs/p1').description, 'Modifié MJ');
});

test('la corbeille initialisée via getClient devient visible, affiche le nom du summary objet et restaure', async () => {
    const documentRef = makeDocument();
    let seq = 0;
    documentRef.defaultView.crypto.randomUUID = () => `op-trash-${++seq}`;
    const server = createServerHarness({
        'campagne/acces': { bhelgi: ['player@example.test'] },
        'pnjs/p1': { nom: 'Mara Vif-Argent', statut: '', vivant: 'oui', lieu: 'Altdorf', groupes: [], groupe: '', description: '', visibleJoueurs: true },
        'content_metadata/pnj_p1': { kind: 'pnj', contentId: 'p1', ownerUid: 'player-1', revision: 1, state: 'active' },
    });
    await server.client.trashPublicContent({ kind: 'pnj', id: 'p1', operationId: 'trash-1', baseRevision: 1 });
    assert.equal(server.documents.has('pnjs/p1'), false);

    const container = documentRef.createElement('div');
    const restored = [];
    mountContentTrashPanel({
        container,
        getClient: async () => server.client,
        documentRef,
        onRestored: entry => restored.push(entry),
    });
    await new Promise(resolve => globalThis.setTimeout(resolve, 10));
    const trashButton = container.children[0];
    assert.equal(trashButton.hidden, false, 'getClient initialise bien l’abonnement corbeille');
    assert.equal(trashButton.textContent, 'Ma corbeille');
    await trashButton.dispatch('click');
    const dialog = documentRef.body.children[0];
    const heading = dialog.find(node => node.tagName === 'h3' && node.parentNode?.className === 'contribution-trash-entry');
    assert.equal(heading.textContent, 'PNJ · Mara Vif-Argent');
    const restoreBtn = dialog.find(node => node.tagName === 'button' && node.textContent === 'Restaurer');
    await restoreBtn.dispatch('click');
    assert.equal(restored.length, 1);
    assert.equal(server.documents.get('pnjs/p1')?.nom, 'Mara Vif-Argent');
});

test('hideWithoutContribution masque les boutons secondaires tant que le compte ne contribue pas', async () => {
    const documentRef = makeDocument();
    const container = documentRef.createElement('div');
    let emitSession;
    const client = {
        watch(listener) { emitSession = listener; return () => {}; },
        currentUser: () => null,
    };
    const action = mountContributionButton({
        container, client, kind: 'relation', action: 'create', hideWithoutContribution: true, documentRef,
    });
    emitSession({ user: null, capabilities: { role: 'public', contribution: false } });
    assert.equal(action.button.hidden, true);
    emitSession({ user: { uid: 'p1' }, capabilities: { role: 'joueur', contribution: true } });
    assert.equal(action.button.hidden, false);
    assert.equal(action.button.textContent, 'Créer une relation');
    action.dispose();
});

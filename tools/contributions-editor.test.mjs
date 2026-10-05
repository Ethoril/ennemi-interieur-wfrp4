import test from 'node:test';
import assert from 'node:assert/strict';
import { mountContentTrashPanel, mountContributionButton } from '../js/contributions/editor.js';

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

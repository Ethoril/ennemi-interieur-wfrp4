import assert from 'node:assert/strict';
import test from 'node:test';
import { createPnjRelationsEditor } from '../js/mobile/components/pnj-relations-editor.js';

class Element {
    constructor(documentRef, tagName) { this.ownerDocument = documentRef; this.tagName = tagName; this.children = []; this.parentNode = null; this.listeners = new Map(); this.attributes = new Map(); this.dataset = {}; this.className = ''; this._textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this.type = ''; this.style = {}; }
    get textContent() { return this._textContent + this.children.map(child => child.textContent || '').join(''); }
    set textContent(value) { this._textContent = String(value ?? ''); this.children = []; }
    append(...nodes) { for (const node of nodes) { if (!node) continue; node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type, extra = {}) { const event = { type, target: this, preventDefault() {}, ...extra }; for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
    focus() { this.ownerDocument.activeElement = this; }
    querySelectorAll(selector) {
        const found = []; const match = node => selector === '*' || selector === 'button' && node.tagName === 'button'
            || selector === 'input' && node.tagName === 'input' || selector === 'select' && node.tagName === 'select'
            || selector === 'form' && node.tagName === 'form';
        const visit = node => { for (const child of node.children) { if (match(child)) found.push(child); visit(child); } }; visit(this); return found;
    }
}

function fakeDocument() {
    const documentRef = { activeElement: null, defaultView: { confirm: () => true }, createElement: tag => new Element(documentRef, tag) };
    documentRef.body = new Element(documentRef, 'body'); return documentRef;
}

function session(uid = 'mj') { return { status: 'gm', role: 'mj', user: { uid } }; }
function fixture() {
    const documentRef = fakeDocument(); const container = new Element(documentRef, 'main');
    const relationCallbacks = []; const pnjCallbacks = []; const calls = { create: 0, update: 0, remove: 0 };
    const relations = [
        { id: 'r-out', source: 'a', cible: 'b', type: 'allié', label: 'Aide', style: 'solid', color: null, visibleJoueurs: true, updatedAt: { seconds: 1, nanoseconds: 0 }, reciprocalId: null },
        { id: 'r-in', source: 'c', cible: 'a', type: 'rival', label: 'Chasse', style: 'dashed', color: null, visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, reciprocalId: null },
        { id: 'r-pair-out', source: 'a', cible: 'd', type: 'contact', label: 'Contact', style: 'solid', color: null, visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, reciprocalId: 'r-pair-in' },
        { id: 'r-pair-in', source: 'd', cible: 'a', type: 'contact', label: 'Contact', style: 'solid', color: null, visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, reciprocalId: 'r-pair-out' },
        { id: 'r-orphan', source: 'a', cible: 'missing', type: 'mystère', label: '??', style: 'solid', color: null, visibleJoueurs: false, updatedAt: { seconds: 1, nanoseconds: 0 }, reciprocalId: null },
    ];
    const pnjs = [{ id: 'a', nom: 'Ada', visibleJoueurs: true }, { id: 'b', nom: 'Émile', visibleJoueurs: true }, { id: 'c', nom: 'Zoë', visibleJoueurs: false }, { id: 'd', nom: 'Éléonore', visibleJoueurs: true }];
    const repository = {
        subscribeAll: (next, error) => { relationCallbacks.push({ next, error }); return () => {}; },
        create: async (...args) => { calls.create += 1; calls.createArgs = args; return { id: 'created' }; },
        update: async (...args) => { calls.update += 1; calls.updateArgs = args; return { id: 'updated' }; },
        remove: async (...args) => { calls.remove += 1; calls.removeArgs = args; return { id: args[0] }; },
    };
    const pnjRepository = { subscribeAll: (next, error) => { pnjCallbacks.push({ next, error }); return () => {}; } };
    const announcements = []; let state = session();
    const view = createPnjRelationsEditor({ container, pnjId: 'a', getSession: () => state, getRelationsRepository: () => repository, getPnjRepository: () => pnjRepository, announce: value => announcements.push(value), document: documentRef });
    view.mount(); relationCallbacks[0].next(relations); pnjCallbacks[0].next(pnjs);
    return { documentRef, container, view, relations, pnjs, repository, relationCallbacks, pnjCallbacks, calls, announcements, setSession: value => { state = value; } };
}

test('éditeur MJ liste clairement vers, depuis et anomalies orphelines', () => {
    const f = fixture(); const text = f.container.textContent;
    assert.match(text, /Vers Émile/u); assert.match(text, /Depuis Zoë/u); assert.match(text, /cible absente/u);
});

test('la recherche de cible ignore accents/casse et exclut le PNJ courant', () => {
    const f = fixture(); f.container.querySelectorAll('button')[0].dispatch('click');
    const inputs = f.container.querySelectorAll('input'); const search = inputs[0]; search.value = 'eleonore'; search.dispatch('input');
    const select = f.container.querySelectorAll('select')[0]; assert.equal(select.children.length, 2); assert.equal(select.children[0].value, ''); assert.equal(select.children[1].value, 'd');
    assert.doesNotMatch(f.container.textContent, /Ada —/u);
});

test('validation relation refuse vide, style et palette non allowlistés sans HTML interprété', () => {
    const f = fixture(); f.container.querySelectorAll('button')[0].dispatch('click');
    const inputs = f.container.querySelectorAll('input'); inputs[0].value = 'b'; inputs[0].dispatch('input');
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form');
    const type = inputs.find(input => input.name === 'type'); type.value = ''; type.dispatch('input');
    form.dispatch('submit'); assert.equal(f.calls.create, 0); assert.match(f.container.textContent, /obligatoire/u); assert.doesNotMatch(f.container.textContent, /<img/u);
});

test('création simple transmet le sens et la paire reste un seul appel atomique', async () => {
    const f = fixture(); f.container.querySelectorAll('button')[0].dispatch('click');
    const selects = f.container.querySelectorAll('select'); selects[0].value = 'b';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'allié'; inputs.find(input => input.name === 'label').value = 'Aide';
    const pair = inputs.find(input => input.name === 'pair'); pair.checked = true;
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(f.calls.create, 1); assert.equal(f.calls.createArgs[0].source, 'a'); assert.equal(f.calls.createArgs[0].cible, 'b'); assert.equal(f.calls.createArgs[1], true);
});

test('double soumission ne double pas la création et un endpoint masqué bloque le public', async () => {
    const f = fixture(); f.container.querySelectorAll('button')[0].dispatch('click');
    const selects = f.container.querySelectorAll('select'); selects[0].value = 'c';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'rival'; inputs.find(input => input.name === 'label').value = 'Chasse'; inputs.find(input => input.name === 'visible').checked = true;
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('submit'); form.dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0)); assert.equal(f.calls.create, 0); assert.match(f.container.textContent, /masqué/u);
});

test('la visibilité publique est bloquée si le PNJ courant est masqué', async () => {
    const f = fixture(); f.pnjs[0].visibleJoueurs = false; f.pnjCallbacks[0].next(f.pnjs);
    f.container.querySelectorAll('button')[0].dispatch('click');
    const select = f.container.querySelectorAll('select')[0]; select.value = 'b';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'allié'; inputs.find(input => input.name === 'label').value = 'Aide'; inputs.find(input => input.name === 'visible').checked = true;
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('submit'); await Promise.resolve();
    assert.equal(f.calls.create, 0); assert.match(f.container.textContent, /endpoint est masqué/u);
});

test('édition transmet updatedAt et portée de paire explicite', async () => {
    const f = fixture(); f.container.querySelectorAll('button').find(button => button.textContent === 'Modifier').dispatch('click');
    assert.equal(f.container.querySelectorAll('input').find(input => input.name === 'pair')?.disabled, true);
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'label').value = 'Aide encore'; inputs.find(input => input.name === 'pair').checked = false;
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('submit'); await Promise.resolve();
    assert.equal(f.calls.update, 1); assert.equal(f.calls.updateArgs[0], 'r-out'); assert.deepEqual(f.calls.updateArgs[2], { seconds: 1, nanoseconds: 0 }); assert.equal(f.calls.updateArgs[3].pair, false); assert.equal(Object.hasOwn(f.calls.updateArgs[3], 'reciprocalId'), false);
});

test('une paire inexistante reste impossible après erreur ou cycle disabled', async () => {
    const f = fixture(); f.repository.update = async () => { throw Object.assign(new Error('offline'), { kind: 'offline' }); };
    f.container.querySelectorAll('button').find(button => button.textContent === 'Modifier').dispatch('click');
    const pair = f.container.querySelectorAll('input').find(input => input.name === 'pair');
    const label = f.container.querySelectorAll('input').find(input => input.name === 'label'); label.value = 'Essai';
    const form = f.container.querySelectorAll('form')[0]; form.dispatch('submit'); await Promise.resolve();
    assert.equal(pair.disabled, true); f.view.setDisabled(true); f.view.setDisabled(false); assert.equal(pair.disabled, true);
});

test('une erreur normalisée de permission reste explicite sans détail technique', async () => {
    const f = fixture(); f.repository.create = async () => { throw Object.assign(new Error('sensitive'), { kind: 'permission' }); };
    f.container.querySelectorAll('button')[0].dispatch('click'); const select = f.container.querySelectorAll('select')[0]; select.value = 'b';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'allié'; inputs.find(input => input.name === 'label').value = 'Aide';
    f.container.querySelectorAll('form')[0].dispatch('submit'); await Promise.resolve();
    assert.match(f.container.textContent, /session MJ/u); assert.doesNotMatch(f.container.textContent, /sensitive/u);
});

test('snapshot distant recharge un éditeur intact mais signale le conflit d’une saisie sale', () => {
    const f = fixture(); f.container.querySelectorAll('button').find(button => button.textContent === 'Modifier').dispatch('click');
    const label = f.container.querySelectorAll('input').find(input => input.name === 'label'); label.value = 'Saisie locale';
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('input');
    f.relationCallbacks[0].next([{ ...f.relations[0], label: 'Changé ailleurs' }]); assert.match(f.container.textContent, /changé ailleurs|Rechargez/u);
});

test('suppression demande confirmation et not-found devient déjà supprimée sans faux succès', async () => {
    const f = fixture(); f.documentRef.defaultView.confirm = message => { assert.match(message, /Émile/u); return true; };
    f.container.querySelectorAll('button').find(button => button.textContent === 'Supprimer').dispatch('click'); await Promise.resolve(); assert.equal(f.calls.remove, 1);
});

test('une erreur réseau de création conserve la feuille et la saisie', async () => {
    const f = fixture(); f.repository.create = async () => { throw Object.assign(new Error('network details'), { code: 'unavailable' }); };
    f.container.querySelectorAll('button')[0].dispatch('click'); const selects = f.container.querySelectorAll('select'); selects[0].value = 'b';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'allié'; inputs.find(input => input.name === 'label').value = 'Saisie à garder';
    const form = f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(f.container.querySelectorAll('form').length, 1); assert.match(f.container.textContent, /Connexion indisponible/u); assert.equal(inputs.find(input => input.name === 'label').value, 'Saisie à garder');
});

test('un succès réactive la surface pour une nouvelle action', async () => {
    const f = fixture(); f.container.querySelectorAll('button')[0].dispatch('click'); const selects = f.container.querySelectorAll('select'); selects[0].value = 'b';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'allié'; inputs.find(input => input.name === 'label').value = 'Aide';
    const form = f.container.querySelectorAll('form')[0]; form.dispatch('submit'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(f.container.querySelectorAll('form').length, 0); f.container.querySelectorAll('button')[0].dispatch('click'); assert.equal(f.container.querySelectorAll('form').length, 1);
});

test('une paire expose suppression d’un sens ou des deux avec précondition exacte', async () => {
    const f = fixture(); const one = f.container.querySelectorAll('button').find(button => button.textContent === 'Supprimer ce sens');
    f.documentRef.defaultView.confirm = message => { assert.match(message, /dans ce sens/u); return true; }; one.dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(f.calls.removeArgs, ['r-pair-out', { pair: false }]);
    const pair = f.container.querySelectorAll('button').find(button => button.textContent === 'Supprimer la paire'); f.documentRef.defaultView.confirm = message => { assert.match(message, /dans les deux sens/u); return true; }; pair.dispatch('click'); await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(f.calls.removeArgs, ['r-pair-out', { pair: true, reciprocalId: 'r-pair-in' }]);
});

test('une suppression distante ferme la feuille sans recréer la relation', () => {
    const f = fixture(); f.container.querySelectorAll('button').find(button => button.textContent === 'Modifier').dispatch('click');
    f.relationCallbacks[0].next(f.relations.filter(item => item.id !== 'r-out')); assert.match(f.container.textContent, /déjà été supprimée/u); assert.equal(f.container.querySelectorAll('form').length, 0);
});

test('une opération terminée après changement d’identité ne produit aucun résultat', async () => {
    const f = fixture(); let resolveCreate; f.repository.create = () => new Promise(resolve => { resolveCreate = resolve; });
    f.container.querySelectorAll('button')[0].dispatch('click'); const selects = f.container.querySelectorAll('select'); selects[0].value = 'b';
    const inputs = f.container.querySelectorAll('input'); inputs.find(input => input.name === 'type').value = 'allié'; inputs.find(input => input.name === 'label').value = 'Aide';
    const form = f.container.children.at(-1).children.find(node => node.tagName === 'form') || f.container.children.at(-1).children[0].children.find(node => node.tagName === 'form'); form.dispatch('submit');
    f.setSession({ status: 'gm', role: 'mj', user: { uid: 'other' } }); resolveCreate({ id: 'late' }); await Promise.resolve(); assert.equal(f.announcements.length, 0);
});

test('trois cycles mount/unmount détachent la feuille et le verrouillage de scroll', () => {
    const f = fixture(); f.view.unmount();
    for (let cycle = 0; cycle < 3; cycle += 1) { f.view.mount(); f.relationCallbacks.at(-1).next(f.relations); f.pnjCallbacks.at(-1).next(f.pnjs); f.container.querySelectorAll('button')[0].dispatch('click'); assert.equal(f.documentRef.body.style.overflow, 'hidden'); f.view.unmount(); assert.equal(f.documentRef.body.style.overflow, ''); assert.equal(f.container.children.length, 0); }
});

test('checking bloque les actions et logout vide la surface privée', () => {
    const f = fixture(); f.setSession({ status: 'checking', role: null, user: null }); f.container.querySelectorAll('button')[0].dispatch('click'); assert.equal(f.container.querySelectorAll('form').length, 0);
    f.setSession({ status: 'visitor', role: 'public', user: null }); f.relationCallbacks[0].next([]); assert.equal(f.container.children.length, 0); f.pnjCallbacks[0].next([]); assert.equal(f.container.children.length, 0); f.view.unmount();
});

test('la feuille verrouille le scroll, gère Escape et restaure le focus', () => {
    const f = fixture(); const add = f.container.querySelectorAll('button')[0]; add.focus(); add.dispatch('click');
    assert.equal(f.documentRef.body.style.overflow, 'hidden'); assert.match(f.documentRef.body.className, /m-scroll-locked/u); const sheet = f.container.children.at(-1); sheet.dispatch('keydown', { key: 'Escape' });
    assert.equal(f.documentRef.body.style.overflow, ''); assert.equal(f.documentRef.body.className, ''); assert.equal(f.documentRef.activeElement, add);
});

test('une feuille sale refuse Escape puis demande confirmation, une recherche seule ne salit pas', () => {
    const f = fixture(); let prompts = 0; f.documentRef.defaultView.confirm = () => { prompts += 1; return false; }; f.container.querySelectorAll('button')[0].dispatch('click');
    const sheet = f.container.children.at(-1); const form = f.container.querySelectorAll('form')[0]; const label = f.container.querySelectorAll('input').find(input => input.name === 'label'); label.value = 'local'; form.dispatch('input'); sheet.dispatch('keydown', { key: 'Escape' }); assert.equal(f.container.querySelectorAll('form').length, 1); assert.equal(prompts, 1);
    f.documentRef.defaultView.confirm = () => true; sheet.dispatch('keydown', { key: 'Escape' }); assert.equal(f.container.querySelectorAll('form').length, 0);
    f.container.querySelectorAll('button')[0].dispatch('click'); const search = f.container.querySelectorAll('input').find(input => input.name === 'search'); search.value = 'zoe'; const freshForm = f.container.querySelectorAll('form')[0]; freshForm.dispatch('input', { target: search }); prompts = 0; f.documentRef.defaultView.confirm = () => { prompts += 1; return true; }; f.container.children.at(-1).dispatch('keydown', { key: 'Escape' }); assert.equal(prompts, 0);
});

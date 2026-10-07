import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { createBottomSheet } from '../js/mobile/components/bottom-sheet.js';
import { createPurchaseSheet } from '../js/mobile/views/fiche-purchase-sheet.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();

class FakeElement {
    constructor(documentRef, tagName) {
        Object.assign(this, {
            ownerDocument: documentRef, tagName, children: [], parentNode: null, attributes: new Map(), listeners: new Map(),
            className: '', textContent: '', hidden: false, disabled: false, open: false, style: {},
        });
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { this.ownerDocument.activeElement = this; }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    dispatch(type, extra = {}) {
        const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
        for (let node = this; node; node = node.parentNode) for (const listener of node.listeners.get(type) || []) listener(event);
        return event;
    }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    // Comme le sélecteur réel : boutons non désactivés, cachés compris (focusableElements doit les écarter).
    querySelectorAll() { return this.all().filter(node => node.tagName === 'button' && !node.disabled); }
    closest(selector) {
        const name = selector.slice(1, -1);
        for (let node = this; node; node = node.parentNode) if (node.attributes?.has(name)) return node;
        return null;
    }
    showModal() { this.open = true; }
    close() { this.open = false; }
    byClass(name) { return this.all().find(node => node.className.split(' ').includes(name)); }
}

function fakeDocument() {
    const listeners = new Map();
    const documentRef = {
        activeElement: null, defaultView: null,
        body: { classList: { add() {}, remove() {} } },
        createElement: tag => new FakeElement(documentRef, tag),
        addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) || []), listener]),
        removeEventListener: (type, listener) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)),
        press: (key, extra = {}) => {
            const event = { type: 'keydown', key, preventDefault() {}, ...extra };
            (listeners.get('keydown') || []).forEach(listener => listener(event));
        },
    };
    return documentRef;
}

test('volet bas : ouverture, Échap, retour du focus, clic sur le fond, fermeture glissée', () => {
    const documentRef = fakeDocument();
    const trigger = documentRef.createElement('button');
    const sheet = createBottomSheet({ documentRef, labelledBy: 't' });
    const dialog = sheet.element;
    const handle = dialog.byClass('m-sheet-handle');
    const render = body => { body.replaceChildren(documentRef.createElement('button')); };

    sheet.open({ trigger, render });
    assert.ok(sheet.isOpen() && dialog.open);
    assert.equal(dialog.getAttribute('aria-labelledby'), 't');
    assert.equal(documentRef.activeElement, dialog.byClass('m-sheet-body').children[0]);
    documentRef.press('Escape');
    assert.ok(!sheet.isOpen() && !dialog.open);
    assert.equal(documentRef.activeElement, trigger);

    sheet.open({ trigger, render });
    dialog.dispatch('click', { target: dialog });
    assert.ok(!sheet.isOpen());

    // Glissé trop court : le volet revient ; au-delà du seuil : il se ferme.
    sheet.open({ trigger, render });
    handle.dispatch('pointerdown', { clientY: 100, pointerId: 1 });
    dialog.dispatch('pointermove', { clientY: 140 });
    assert.equal(dialog.style.transform, 'translateY(40px)');
    dialog.dispatch('pointerup', {});
    assert.ok(sheet.isOpen());
    assert.equal(dialog.style.transform, '');
    handle.dispatch('pointerdown', { clientY: 100, pointerId: 1 });
    dialog.dispatch('pointermove', { clientY: 300 });
    dialog.dispatch('pointerup', {});
    assert.ok(!sheet.isOpen());

    // Un glissé qui ne part pas de la poignée ou de l'en-tête est ignoré.
    sheet.open({ trigger, render });
    dialog.byClass('m-sheet-body').children[0].dispatch('pointerdown', { clientY: 100, pointerId: 1 });
    dialog.dispatch('pointermove', { clientY: 400 });
    dialog.dispatch('pointerup', {});
    assert.ok(sheet.isOpen());
    sheet.destroy();
});

const keys = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const ficheData = (gain = 200) => ({
    carriere: 'Agitateur', rang: '1', basicSpecs: {}, chosenVariants: {}, careerOverrides: {},
    carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: 3 }])),
    skillsBasic: {}, skillsAdvanced: [], talentsAcq: [], xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: gain }],
});

function purchaseSetup({ online = true, gain = 200, pendingOperationId = null, execute, retry } = {}) {
    const documentRef = fakeDocument();
    const announces = [];
    const context = {
        state: { phase: 'ready', data: ficheData(gain), pendingOperationId }, careers: catalogue.careers, engine, online,
        controller: {
            executeOnlineCommand: execute || (async () => ({ status: 'confirmed' })),
            retryPendingCommand: retry || (async () => ({ status: 'confirmed' })),
        },
    };
    const sheet = createPurchaseSheet({ documentRef, getContext: () => context, announce: message => announces.push(message) });
    const trigger = documentRef.createElement('button');
    const text = name => sheet.element.byClass(name)?.textContent;
    const buttons = () => sheet.element.all().filter(node => node.tagName === 'button');
    const buy = () => buttons().find(node => /Acheter|Achat en cours/u.test(node.textContent));
    return { documentRef, announces, context, sheet, trigger, text, buy, buttons };
}

const flush = () => sleep(0);

test('une spécialité retirée pendant l’ouverture ne décale pas les actions des puces', async () => {
    const sent = [];
    const setup = purchaseSetup({ execute: async (_type, payload) => { sent.push(payload); return { status: 'confirmed' }; } });
    setup.context.state.data.race = 'haut-elfe';
    setup.sheet.open({ kind: 'talent', nom: 'Magie des Arcanes' }, setup.trigger);
    setup.buttons().find(button => button.textContent === 'Chamon').focus();
    setup.context.state.data.talentsAcq.push({ id: 'remote', nom: 'Magie des Arcanes (Aqshy)' });
    setup.sheet.update();
    assert.equal(setup.buttons().some(button => button.textContent === 'Aqshy'), false);
    assert.equal(setup.documentRef.activeElement.textContent, 'Chamon');
    setup.buttons().find(button => button.textContent === 'Chamon').dispatch('click');
    setup.buy().dispatch('click');
    await flush();
    assert.equal(sent[0].name, 'Magie des Arcanes (Chamon)');
});

test('talent : prises actuelles et résultat après achat distincts, plafond conservé', () => {
    const setup = purchaseSetup();
    setup.sheet.open({ kind: 'talent', nom: 'Sociable' }, setup.trigger);
    assert.equal(setup.text('m-purchase-taken'), 'Prises actuelles : 0 → Après cet achat : 1');
    setup.context.state.data.talentsAcq = [{ id: 'old', nom: 'Sociable' }];
    setup.sheet.update();
    assert.equal(setup.text('m-purchase-taken'), 'Prises actuelles : 1');
    assert.ok(setup.buy().hidden);
    assert.ok(setup.sheet.element.byClass('m-purchase-figures').children.at(-1).hidden);
    assert.match(setup.text('m-purchase-reason'), /Limite atteinte/u);
    setup.sheet.close();
    setup.context.state.data.talentsAcq = [{ id: 'lucky', nom: 'Chanceux' }];
    setup.sheet.open({ kind: 'talent', nom: 'Chanceux' }, setup.trigger);
    assert.equal(setup.text('m-purchase-taken'), 'Prises actuelles : 1 → Après cet achat : 2');
});

test('volet d’achat : coût affiché, achat envoyé avec le coût prévu, annonce et focus rendu', async () => {
    const sent = [];
    const setup = purchaseSetup({ execute: async (type, payload) => { sent.push([type, payload]); return { status: 'confirmed' }; } });
    setup.sheet.open({ kind: 'carac', key: 'soc' }, setup.trigger);
    assert.equal(setup.text('m-purchase-title'), 'Sociabilité');
    assert.equal(setup.text('m-purchase-formula'), 'Sociabilité 30 + 3 avances = 33');
    assert.equal(setup.buy().textContent, 'Acheter pour 25 XP');
    const more = setup.buttons().find(node => node.getAttribute('aria-label') === 'Une avance de plus');
    more.dispatch('click');
    more.dispatch('click');
    assert.equal(setup.buy().textContent, 'Acheter pour 80 XP');
    setup.buy().dispatch('click');
    assert.equal(setup.buy().textContent, 'Achat en cours…');
    assert.ok(setup.buy().disabled);
    await flush();
    assert.deepEqual(sent, [['purchase', {
        kind: 'carac', name: 'soc', count: 3, expectedCost: 80, catalogVersion: engine.catalogVersion,
    }]]);
    assert.ok(!setup.sheet.element.open);
    assert.deepEqual(setup.announces, ['Sociabilité : +3 avances achetées']);
    assert.equal(setup.documentRef.activeElement, setup.trigger);
});

test('volet d’achat : hors ligne et XP insuffisants désactivent le bouton avec la raison', () => {
    const offline = purchaseSetup({ online: false });
    offline.sheet.open({ kind: 'carac', key: 'soc' }, offline.trigger);
    assert.ok(offline.buy().disabled);
    assert.equal(offline.text('m-purchase-reason'), 'Achat possible une fois en ligne');

    const poor = purchaseSetup({ gain: 10 });
    poor.sheet.open({ kind: 'carac', key: 'soc' }, poor.trigger);
    assert.ok(poor.buy().disabled);
    assert.match(poor.text('m-purchase-reason'), /XP insuffisants : il manque 15 XP/u);
});

test('volet d’achat : refus du serveur affiché dans le volet, valeurs inchangées', async () => {
    const setup = purchaseSetup({ execute: async () => { throw Object.assign(new Error('x'), { code: 'failed-precondition', details: { kind: 'price-changed', currentCost: 30 } }); } });
    setup.sheet.open({ kind: 'talent', nom: 'Sociable' }, setup.trigger);
    assert.equal(setup.buy().textContent, 'Acheter pour 100 XP');
    setup.buy().dispatch('click');
    await flush();
    assert.ok(setup.sheet.element.open);
    assert.equal(setup.text('m-purchase-error'), 'Le coût a changé : 30 XP. Vérifiez et réessayez.');
    assert.equal(setup.buy().textContent, 'Acheter pour 100 XP');
    assert.equal(setup.documentRef.activeElement, setup.buy());
    assert.deepEqual(setup.announces, []);

    // Le bouton « Réessayer » caché ne compte pas dans le piège de focus : Tab sur le dernier bouton visible revient au premier.
    assert.ok(setup.buttons().at(-1).hidden);
    setup.buy().focus();
    let prevented = false;
    setup.documentRef.press('Tab', { preventDefault() { prevented = true; } });
    assert.ok(prevented);
    assert.equal(setup.documentRef.activeElement, setup.buy().parentNode.children.find(node => node.tagName === 'button' && !node.hidden && !node.disabled));
});

test('volet d’achat : réponse incertaine, « Réessayer » rejoue la commande en attente sans nouvel achat', async () => {
    let executed = 0;
    let retried = 0;
    const setup = purchaseSetup({
        execute: async () => { executed += 1; throw Object.assign(new Error('x'), { code: 'unavailable' }); },
        retry: async () => { retried += 1; return { status: 'confirmed' }; },
    });
    setup.sheet.open({ kind: 'carac', key: 'soc' }, setup.trigger);
    setup.buy().dispatch('click');
    await flush();
    setup.context.state = { ...setup.context.state, pendingOperationId: 'op-1' };
    setup.sheet.update();
    assert.match(setup.text('m-purchase-error'), /incertain/u);
    assert.ok(setup.buy().hidden);
    const retry = setup.buttons().find(node => node.textContent === 'Réessayer');
    assert.ok(!retry.hidden);
    retry.dispatch('click');
    await flush();
    assert.deepEqual([executed, retried], [1, 1]);
    assert.ok(!setup.sheet.element.open);
    assert.deepEqual(setup.announces, ['Achat confirmé']);
});

test('volet d’achat : « awaiting-snapshot » ne ferme ni n’annonce, puis le snapshot confirme', async () => {
    // Le contrôleur garde pendingOperationId pendant l'attente du snapshot.
    const setup = purchaseSetup({ execute: async () => {
        setup.context.state = { ...setup.context.state, pendingOperationId: 'op-1' };
        return { status: 'awaiting-snapshot' };
    } });
    setup.sheet.open({ kind: 'carac', key: 'soc' }, setup.trigger);
    setup.buy().dispatch('click');
    await flush();
    assert.ok(setup.sheet.element.open);
    assert.equal(setup.text('m-purchase-reason'), 'Achat en cours de confirmation…');
    assert.ok(!setup.buttons().find(node => node.textContent === 'Réessayer').hidden);
    assert.deepEqual(setup.announces, []);
    setup.context.state = { ...setup.context.state, pendingOperationId: null };
    setup.sheet.update();
    assert.ok(!setup.sheet.element.open);
    assert.deepEqual(setup.announces, ['Achat confirmé']);
});

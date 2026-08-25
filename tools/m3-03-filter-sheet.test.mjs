import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilterSheet } from '../js/mobile/components/filter-sheet.js';

class FakeElement {
    constructor(documentRef, tagName, isFragment = false) {
        this.ownerDocument = documentRef;
        this.tagName = tagName.toUpperCase();
        this.isFragment = isFragment;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.type = '';
        this.value = '';
        this.checked = false;
        this.disabled = false;
        this.open = false;
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }

    focus() { this.ownerDocument.activeElement = this; }

    append(...nodes) {
        for (const node of nodes) {
            if (node?.isFragment) {
                this.append(...node.children.splice(0));
                continue;
            }
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
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
    }

    dispatchEvent(event = {}) {
        const next = event;
        next.target ??= this;
        next.currentTarget = this;
        for (const listener of [...(this.listeners.get(next.type) ?? [])]) listener(next);
        if (next.bubbles && this.parentNode) this.parentNode.dispatchEvent(next);
        return true;
    }

    click() { this.dispatchEvent({ type: 'click', target: this, bubbles: true }); }

    matches(selector) {
        if (selector === 'input') return this.tagName === 'INPUT';
        if (selector.includes('input')) return this.tagName === 'INPUT' && !this.disabled;
        if (selector.includes('button')) return this.tagName === 'BUTTON' && !this.disabled;
        if (selector === '[href]') return this.hasAttribute('href');
        if (selector.includes('[tabindex]')) return this.hasAttribute('tabindex') && this.getAttribute('tabindex') !== '-1';
        if (selector.startsWith('.')) return this.className.split(/\s+/u).includes(selector.slice(1));
        return false;
    }

    querySelectorAll(selector) {
        const selectors = selector.split(',').map(item => item.trim());
        const result = [];
        const visit = node => {
            for (const child of node.children) {
                if (selectors.some(item => child.matches(item))) result.push(child);
                visit(child);
            }
        };
        visit(this);
        return result;
    }

    showModal() { this.open = true; }
    close() { this.open = false; }
}

function makeDocument() {
    const documentRef = {
        activeElement: null,
        listeners: new Map(),
        body: null,
        createElement: tagName => new FakeElement(documentRef, tagName),
        createDocumentFragment: () => new FakeElement(documentRef, '#fragment', true),
        addEventListener(type, listener) {
            if (!documentRef.listeners.has(type)) documentRef.listeners.set(type, []);
            documentRef.listeners.get(type).push(listener);
        },
        removeEventListener(type, listener) {
            const listeners = documentRef.listeners.get(type) ?? [];
            documentRef.listeners.set(type, listeners.filter(candidate => candidate !== listener));
        },
        dispatchEvent(event = {}) {
            for (const listener of [...(documentRef.listeners.get(event.type) ?? [])]) listener(event);
        },
    };
    documentRef.body = documentRef.createElement('body');
    documentRef.body.classList = {
        values: new Set(),
        add(value) { this.values.add(value); },
        remove(value) { this.values.delete(value); },
        contains(value) { return this.values.has(value); },
    };
    return documentRef;
}

function makeFixture() {
    const documentRef = makeDocument();
    const parent = documentRef.createElement('div');
    const trigger = documentRef.createElement('button');
    return { documentRef, parent, trigger };
}

const dimensions = [
    { key: 'statut', label: 'Statut' },
    { key: 'groupe', label: 'Groupe' },
];

function openFixture(options = {}) {
    const fixture = makeFixture();
    const applied = [];
    const sheet = createFilterSheet({
        documentRef: fixture.documentRef,
        dimensions,
        onApply: filters => applied.push(filters),
    });
    sheet.mount(fixture.parent);
    sheet.open({
        trigger: fixture.trigger,
        nextFacets: { statut: ['vivant', 'mort'], groupe: ['Nord', 'Sud'] },
        filters: { statut: ['vivant'], groupe: ['Nord'] },
        ...options,
    });
    return { ...fixture, sheet, applied, dialog: fixture.parent.children[0] };
}

function formOf(dialog) { return dialog.children[0].children.find(child => child.tagName === 'FORM'); }
function inputOf(form, key, value) {
    return form.querySelectorAll('input').find(input => input.dataset.filterKey === key && input.value === value);
}
function buttonNamed(dialog, label) {
    return dialog.querySelectorAll('button').find(button => button.textContent === label);
}

test('la feuille rend une option multiple par champ et applique seulement sur action explicite', () => {
    const { sheet, dialog, applied } = openFixture();
    const form = formOf(dialog);
    assert.equal(form.children.length, 2);
    assert.deepEqual(form.children.map(fieldset => fieldset.children[0].textContent), ['Statut', 'Groupe']);
    assert.equal(inputOf(form, 'statut', 'vivant').checked, true);
    assert.equal(inputOf(form, 'groupe', 'Nord').checked, true);

    const mort = inputOf(form, 'statut', 'mort');
    mort.checked = true;
    mort.dispatchEvent({ type: 'change', target: mort, bubbles: true });
    assert.deepEqual(applied, []);
    buttonNamed(dialog, 'Appliquer').click();
    assert.deepEqual(applied, [{ statut: ['vivant', 'mort'], groupe: ['Nord'] }]);
    assert.equal(sheet.isOpen(), false);
});

test('Tout effacer modifie le brouillon, puis Appliquer publie explicitement des sélections vides', () => {
    const { sheet, dialog, applied } = openFixture();
    buttonNamed(dialog, 'Tout effacer').click();
    assert.deepEqual(applied, []);
    assert.equal(inputOf(formOf(dialog), 'statut', 'vivant').checked, false);
    buttonNamed(dialog, 'Appliquer').click();
    assert.deepEqual(applied, [{ statut: [], groupe: [] }]);
    assert.equal(sheet.isOpen(), false);
});

test('update retire une option disparue mais conserve les choix encore valides du brouillon', () => {
    const { sheet, dialog } = openFixture();
    sheet.update({ nextFacets: { statut: ['vivant'], groupe: ['Nord', 'Sud'] }, filters: { statut: ['vivant', 'mort'], groupe: ['Nord'] } });
    const form = formOf(dialog);
    assert.deepEqual(form.querySelectorAll('input').map(input => input.value), ['vivant', 'Nord', 'Sud']);
    assert.equal(inputOf(form, 'statut', 'vivant').checked, true);
    assert.equal(inputOf(form, 'groupe', 'Nord').checked, true);
});

test('focus trap, Escape, backdrop, retour au déclencheur et scroll-lock sont opérants', () => {
    const { documentRef, sheet, dialog, trigger } = openFixture();
    const first = dialog.querySelectorAll('button')[0];
    const last = buttonNamed(dialog, 'Appliquer');
    assert.equal(documentRef.activeElement, first);
    assert.equal(documentRef.body.classList.contains('m-scroll-locked'), true);

    documentRef.activeElement = first;
    documentRef.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: true, preventDefault() {} });
    assert.equal(documentRef.activeElement, last);
    documentRef.dispatchEvent({ type: 'keydown', key: 'Tab', shiftKey: false, preventDefault() {} });
    assert.equal(documentRef.activeElement, first);

    let prevented = false;
    documentRef.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(sheet.isOpen(), false);
    assert.equal(dialog.open, false);
    assert.equal(documentRef.body.classList.contains('m-scroll-locked'), false);
    assert.equal(documentRef.activeElement, trigger);

    sheet.open({ trigger });
    dialog.dispatchEvent({ type: 'click', target: dialog });
    assert.equal(sheet.isOpen(), false);
    assert.equal(documentRef.activeElement, trigger);
});

test('destroy retire le dialogue et tous les listeners après trois cycles sans multiplication', () => {
    const fixture = makeFixture();
    let applies = 0;
    const sheet = createFilterSheet({ documentRef: fixture.documentRef, dimensions, onApply: () => { applies += 1; } });
    for (let cycle = 0; cycle < 3; cycle += 1) {
        sheet.mount(fixture.parent);
        sheet.open({ trigger: fixture.trigger, nextFacets: { statut: ['vivant'], groupe: [] }, filters: {} });
        const dialog = fixture.parent.children[0];
        buttonNamed(dialog, 'Appliquer').click();
        assert.equal(applies, cycle + 1);
        sheet.destroy();
        assert.equal(fixture.parent.children.length, 0);
        assert.equal(dialog.listeners.get('cancel')?.length ?? 0, 0);
        assert.equal(dialog.listeners.get('click')?.length ?? 0, 0);
        assert.equal(fixture.documentRef.listeners.get('keydown')?.length ?? 0, 0);
        assert.equal(fixture.documentRef.body.classList.contains('m-scroll-locked'), false);
    }
});

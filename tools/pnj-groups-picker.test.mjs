import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupPicker } from '../js/pnj-group-picker.js';

class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.value = ''; this.disabled = false; this.validityMessage = ''; }
    get firstChild() { return this.children[0] || null; }
    appendChild(child) { child.parentNode?.removeChild(child); this.children.push(child); child.parentNode = this; return child; }
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; return child; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
    removeEventListener(name, callback) { this.listeners.set(name, (this.listeners.get(name) || []).filter(item => item !== callback)); }
    fire(name, event = {}) { for (const callback of this.listeners.get(name) || []) callback({ preventDefault() {}, ...event }); }
    setCustomValidity(message) { this.validityMessage = message; }
    focus() { this.focused = true; }
    remove() { this.parentNode?.removeChild(this); }
    querySelectorAll(selector) { return selector === 'button' ? this.children.flatMap(child => [child, ...child.children].filter(item => item.tagName === 'button')) : []; }
}

function pickerFixture(options = {}) {
    const documentRef = { createElement: tag => new Element(tag) };
    const host = new Element('div');
    const input = new Element('input');
    input.id = 'group';
    input.setAttribute('aria-describedby', 'hint');
    input.parentNode = host;
    host.appendChild(input);
    const picker = createGroupPicker({ documentRef, input, ...options });
    return { documentRef, host, input, picker };
}

test('the picker retains pending input, reuses catalog spelling, and adds with Enter without submitting', () => {
    const changes = [];
    const { input, picker } = pickerFixture({ catalog: ['Garde'], onChange: groups => changes.push(groups) });
    assert.equal(changes.length, 0, 'initial catalog setup is silent');
    picker.setGroups(['Ligue']);
    assert.equal(changes.length, 0, 'programmatic group replacement is silent');
    picker.setGroups([]);
    input.value = ' GARDE ';
    assert.deepEqual(picker.getGroups(), ['Garde']);
    let prevented = false;
    input.fire('keydown', { key: 'Enter', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.deepEqual(picker.getGroups(), ['Garde']);
    assert.equal(input.value, '');
    assert.ok(changes.some(groups => groups.includes('Garde')));
    picker.destroy();
});

test('the picker blocks overlong and over-capacity pending groups and restores input attributes on destroy', () => {
    const originalDescription = 'hint';
    const { input, picker } = pickerFixture({ initialGroups: Array.from({ length: 20 }, (_, i) => `Groupe ${i}`) });
    input.value = '21e';
    input.fire('input');
    assert.match(input.validityMessage, /maximum 20/u);
    assert.equal(picker.getGroups().length, 21, 'pending input remains visible to the caller while native validity blocks submission');
    input.value = 'x'.repeat(201);
    input.fire('input');
    assert.match(input.validityMessage, /200 caractères/u);
    picker.setDisabled(true);
    assert.equal(input.disabled, true);
    picker.destroy();
    assert.equal(input.getAttribute('aria-describedby'), originalDescription);
    assert.equal(input.getAttribute('list'), null);
});

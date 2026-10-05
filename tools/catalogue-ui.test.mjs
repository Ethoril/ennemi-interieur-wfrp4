import { URL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createReferentielsUi } from '../js/catalogue/referentiels-ui.js';
import { skillFormsResolver } from '../js/catalogue/skill-forms.js';

class Element {
    constructor() { this.children = []; this.value = ''; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.scrollTop = 0; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; this.value = ''; }
    add(option) { this.children.push(option); if (this.children.length === 1) this.value = option.value; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    async dispatch(name, extra = {}) { await this.listeners[name]?.({ preventDefault() {}, ...extra }); }
}

async function editor(t) {
    const previousOption = globalThis.Option;
    globalThis.Option = class { constructor(label, value) { this.textContent = label; this.value = value; } };
    t.after(() => { globalThis.Option = previousOption; });
    const ids = [...fs.readFileSync(new URL('../referentiels.html', import.meta.url), 'utf8').matchAll(/id="([^"]+)"/gu)].map(match => match[1]);
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements['form-filter'].value = 'all';
    const skills = ['Chevaucher', 'Équitation', 'Natation'].map((nom, index) => ({ id: 'skill-' + index, nom, carac: 'ag', basic: true }));
    const draft = { skills: { entries: skills, aliases: [] }, talents: { entries: [], aliases: [], localDescriptions: [] } };
    const calls = [];
    let saved;
    let authCallback;
    createReferentielsUi({ documentRef: { getElementById: id => elements[id], createElement: () => new Element() },
        auth: { watchAuth(callback) { authCallback = callback; } },
        callable: async command => {
            calls.push(command);
            if (command.type === 'load') return { data: { draft, draftRevision: 1, publishedRevision: 1, catalogVersion: 'qa',
                report: { skills: [{ name: 'Nager ancien', occurrences: [{ kind: 'owned-advanced', scopeId: 'qa' }] }] } } };
            saved = command.payload.catalogue;
            return { data: { revision: 2, catalogVersion: 'qa-draft' } };
        },
    });
    await authCallback({ email: 'qa@example.invalid' }, true);
    const row = label => elements['entry-list'].children.find(item => item.children[1].children[0].textContent === label);
    const check = async label => { const checkbox = row(label).children[0]; checkbox.checked = true; await checkbox.dispatch('change'); };
    const apply = () => elements['entry-form'].dispatch('submit', { submitter: { value: 'rename' } });
    const save = () => elements['save-draft'].dispatch('click');
    return { elements, calls, row, check, apply, save, saved: () => saved };
}

test('cocher une nouvelle compétence actualise le panneau sans perdre les formes cochées ni le défilement', async t => {
    const ui = await editor(t);
    await ui.check('Chevaucher');
    assert.equal(ui.elements['display-name'].value, 'Chevaucher');
    ui.elements['entry-list'].scrollTop = 120;
    await ui.check('Natation');
    assert.equal(ui.elements['display-name'].value, 'Natation');
    assert.match(ui.elements['selection-summary'].textContent, /^Natation/u);
    assert.equal(ui.row('Chevaucher').children[0].checked, true);
    assert.equal(ui.elements['entry-list'].scrollTop, 120);
});

test('appliquer le nom déjà affiché regroupe les formes cochées dans le brouillon enregistré', async t => {
    const ui = await editor(t);
    await ui.check('Équitation');
    await ui.check('Chevaucher');
    await ui.apply();
    assert.match(ui.elements['entry-status'].textContent, /reliée.*Chevaucher/u);
    assert.equal(ui.elements['checked-summary'].textContent, 'Aucune forme cochée.');
    await ui.save();
    const resolver = skillFormsResolver(ui.saved().skills);
    assert.equal(resolver.resolve('Équitation').entry.nom, 'Chevaucher');
    assert.equal(resolver.resolve('Natation').entry.nom, 'Natation');
    assert.equal(resolver.primaryEntries.length, 2);
    assert.deepEqual(ui.calls.map(call => call.type), ['load', 'saveDraft']);
});

test('appliquer sans changement donne un retour explicite et ne crée aucun alias', async t => {
    const ui = await editor(t);
    await ui.row('Chevaucher').children[1].dispatch('click');
    await ui.apply();
    assert.match(ui.elements['entry-status'].textContent, /déjà le nom principal/u);
    await ui.save();
    assert.deepEqual(ui.saved().skills.aliases, []);
});

test('une forme inconnue cochée remplace la sélection précédente et reste regroupable', async t => {
    const ui = await editor(t);
    await ui.check('Chevaucher');
    await ui.check('Nager ancien');
    assert.equal(ui.elements['entry-form'].hidden, true);
    assert.match(ui.elements['selection-summary'].textContent, /^Nager ancien/u);
    assert.match(ui.elements['checked-summary'].textContent, /Chevaucher.*Nager ancien/u);
    assert.equal(ui.elements['link-forms'].disabled, false);
});

test('renommer sans regroupement conserve le nom ancien comme variante', async t => {
    const ui = await editor(t);
    await ui.row('Chevaucher').children[1].dispatch('click');
    ui.elements['display-name'].value = 'Monter à cheval';
    await ui.apply();
    await ui.save();
    const resolver = skillFormsResolver(ui.saved().skills);
    assert.equal(resolver.resolve('Chevaucher').entry.nom, 'Monter à cheval');
    assert.equal(resolver.resolve('Équitation').entry.nom, 'Équitation');
});


test('le choix de principale est également appliqué par le bouton du formulaire', async t => {
    const ui = await editor(t);
    await ui.check('Équitation');
    await ui.check('Chevaucher');
    ui.elements['primary-form'].value = 'Équitation';
    await ui.elements['primary-form'].dispatch('change');
    assert.equal(ui.elements['display-name'].value, 'Équitation');
    await ui.apply();
    await ui.save();
    assert.equal(skillFormsResolver(ui.saved().skills).resolve('Chevaucher').entry.nom, 'Équitation');
});

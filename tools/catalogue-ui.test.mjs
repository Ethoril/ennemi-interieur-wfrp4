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

async function editor(t, { theology = false } = {}) {
    const previousOption = globalThis.Option;
    globalThis.Option = class { constructor(label, value) { this.textContent = label; this.value = value; } };
    t.after(() => { globalThis.Option = previousOption; });
    const ids = [...fs.readFileSync(new URL('../referentiels.html', import.meta.url), 'utf8').matchAll(/id="([^"]+)"/gu)].map(match => match[1]);
    const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
    elements['form-filter'].value = 'all';
    const skills = ['Chevaucher', 'Équitation', 'Natation'].map((nom, index) => ({ id: 'skill-' + index, nom, carac: 'ag', basic: true }));
    if (theology) skills.push({ id: 'skill-theology', nom: 'Savoir (Théologie)', group: 'Savoir', groupId: 'group-savoir', specialization: 'Théologie', carac: 'int', basic: false });
    const draft = { skills: { entries: skills, aliases: [] }, talents: { entries: [], aliases: [], localDescriptions: [] } };
    const calls = [];
    let saved;
    let failSave = false;
    let authCallback;
    createReferentielsUi({ documentRef: { getElementById: id => elements[id], createElement: () => new Element() },
        auth: { watchAuth(callback) { authCallback = callback; } },
        callable: async command => {
            calls.push(command);
            if (command.type === 'load') return { data: { draft, draftRevision: 1, publishedRevision: 1, catalogVersion: 'qa',
                report: { skills: ['Nager ancien', 'Conn. (Théologie)', 'Conn. Théologie'].map(name => ({ name, occurrences: [{ kind: 'owned-advanced', scopeId: 'qa' }] })) } } };
            if (failSave) throw new Error('Connexion interrompue.');
            saved = command.payload.catalogue;
            return { data: { revision: 2, catalogVersion: 'qa-draft' } };
        },
    });
    await authCallback({ email: 'qa@example.invalid' }, true);
    const row = label => elements['entry-list'].children.find(item => item.children[1].children[0].textContent === label);
    const check = async label => { const checkbox = row(label).children[0]; checkbox.checked = true; await checkbox.dispatch('change'); };
    const apply = () => elements['skill-group-form'].dispatch('submit');
    const save = () => elements['save-draft'].dispatch('click');
    return { elements, calls, row, check, apply, save, saved: () => saved, failSave: value => { failSave = value; } };
}


test('nom et case sélectionnent les mêmes formes, persistantes pendant la recherche', async t => {
    const ui = await editor(t);
    await ui.row('Chevaucher').children[1].dispatch('click');
    await ui.check('Équitation');
    assert.equal(ui.elements['primary-name'].value, 'Chevaucher');
    ui.elements['catalogue-search'].value = 'Natation';
    await ui.elements['catalogue-search'].dispatch('input');
    assert.equal(ui.elements['selected-forms'].children.length, 2);
    assert.equal(ui.elements['entry-list'].children.length, 1);
});

test('un bouton enregistre le regroupement et réinitialise la sélection pour la compétence suivante', async t => {
    const ui = await editor(t);
    await ui.check('Chevaucher'); await ui.check('Équitation'); await ui.apply();
    const resolver = skillFormsResolver(ui.saved().skills);
    assert.equal(resolver.resolve('Équitation').entry.nom, 'Chevaucher');
    assert.equal(resolver.resolve('Natation').entry.nom, 'Natation');
    assert.equal(ui.elements['skill-group-form'].hidden, true);
    assert.equal(ui.elements['primary-name'].value, '');
    assert.match(ui.elements['entry-status'].textContent, /enregistré.*brouillon/u);
    assert.deepEqual(ui.calls.map(call => call.type), ['load', 'saveDraft']);
    await ui.check('Natation');
    assert.equal(ui.elements['primary-name'].value, 'Natation');
});

test('le cas de la capture crée une compétence avancée avec les deux formes et une caractéristique explicite', async t => {
    const ui = await editor(t);
    await ui.check('Conn. (Théologie)'); await ui.check('Conn. Théologie');
    assert.equal(ui.elements['new-skill-fields'].hidden, false);
    assert.equal(ui.elements['apply-group'].disabled, true);
    ui.elements['primary-name'].value = 'Conn. Théologie';
    ui.elements['new-skill-carac'].value = 'int';
    await ui.elements['new-skill-carac'].dispatch('change');
    assert.equal(ui.elements['apply-group'].disabled, false);
    await ui.apply();
    const resolver = skillFormsResolver(ui.saved().skills);
    const entry = resolver.resolve('Conn. (Théologie)').entry;
    assert.equal(entry.nom, 'Conn. Théologie'); assert.equal(entry.carac, 'int'); assert.equal(entry.basic, false);
    assert.equal(entry.id, resolver.resolve('Conn. Théologie').entry.id);
});

test('deux formes inconnues peuvent être reliées à un nom existant sans création', async t => {
    const ui = await editor(t);
    await ui.check('Conn. (Théologie)'); await ui.check('Conn. Théologie');
    ui.elements['primary-name'].value = 'Natation';
    await ui.elements['primary-name'].dispatch('input');
    assert.equal(ui.elements['new-skill-fields'].hidden, true);
    await ui.apply();
    assert.equal(ui.saved().skills.entries.length, 3);
    assert.equal(skillFormsResolver(ui.saved().skills).resolve('Conn. Théologie').entry.nom, 'Natation');
});

test('annuler restaure le brouillon enregistré avant le dernier regroupement', async t => {
    const ui = await editor(t);
    await ui.check('Chevaucher'); await ui.check('Équitation'); await ui.apply();
    await ui.elements['undo-change'].dispatch('click');
    assert.equal(skillFormsResolver(ui.saved().skills).resolve('Équitation').entry.nom, 'Équitation');
    assert.deepEqual(ui.saved().skills.aliases, []);
    assert.equal(ui.elements['undo-change'].disabled, true);
});

test('un échec réseau conserve le brouillon modifié et propose de réessayer sans annoncer une réussite', async t => {
    const ui = await editor(t); ui.failSave(true);
    await ui.check('Chevaucher'); await ui.check('Équitation'); await ui.apply();
    assert.equal(ui.elements['save-draft'].hidden, false);
    assert.equal(ui.elements['entry-status'].dataset.state, 'error');
    ui.failSave(false); await ui.save();
    assert.equal(skillFormsResolver(ui.saved().skills).resolve('Équitation').entry.nom, 'Chevaucher');
    assert.equal(ui.elements['save-draft'].hidden, true);
});

test('la liste entière est accessible sans pagination et la recherche ignore les accents', async t => {
    const ui = await editor(t);
    assert.equal(ui.elements['entry-list'].children.length, 6);
    ui.elements['catalogue-search'].value = 'theologie'; await ui.elements['catalogue-search'].dispatch('input');
    assert.equal(ui.elements['entry-list'].children.length, 2);
});


test('la suggestion du catalogue relie Théologie tout en conservant le nom principal choisi', async t => {
    const ui = await editor(t, { theology: true });
    await ui.check('Conn. Théologie'); await ui.check('Conn. (Théologie)');
    const suggestion = ui.elements['name-suggestions'].children[0];
    assert.match(suggestion.textContent, /Savoir \(Théologie\)/u);
    await suggestion.dispatch('click');
    assert.equal(ui.elements['primary-name'].value, 'Conn. Théologie');
    assert.equal(ui.elements['new-skill-fields'].hidden, true);
    await ui.apply();
    const resolver = skillFormsResolver(ui.saved().skills);
    assert.equal(resolver.resolve('Conn. (Théologie)').entry.id, 'skill-theology');
    assert.equal(resolver.resolve('Savoir (Théologie)').entry.nom, 'Conn. Théologie');
    assert.equal(ui.saved().skills.entries.length, 4);
});


test('les impacts restent bloqués tant que la sélection n’est pas enregistrée ou retirée', async t => {
    const ui = await editor(t);
    await ui.check('Chevaucher');
    assert.equal(ui.elements['preview-migration'].disabled, true);
    await ui.elements['clear-forms'].dispatch('click');
    assert.equal(ui.elements['preview-migration'].disabled, false);
});

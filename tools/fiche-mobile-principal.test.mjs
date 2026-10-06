import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { basicRowFor } from '../js/fiche/basic-skills.js';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { dotTarget, ficheCaracs, resourceChange, resourceTokens, topSkills } from '../js/mobile/fiche-model.js';
import { createPrincipalPanel } from '../js/mobile/views/fiche-principal.js';
import { submitDraft } from '../js/mobile/fiche-autosave.js';
import { createConflictNotice } from '../js/mobile/views/fiche-conflicts.js';
import { createResourceSheet } from '../js/mobile/views/fiche-resource-sheet.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();
const resolver = engine.skillResolver;

const caracs = Object.fromEntries(['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'].map(key => [key, { base: 30, adv: 0 }]));
const data = extra => ({ carac: globalThis.structuredClone(caracs), skillsBasic: {}, skillsAdvanced: [], basicSpecs: {}, ...extra });

test('topSkills : tri par total puis nom, compétences entraînées d’abord', () => {
    const d = data({ carac: { ...caracs, soc: { base: 40, adv: 0 } }, skillsBasic: { Charme: 5, Ragot: 5, Esquive: 1 } });
    assert.deepEqual(topSkills(d, engine, 3).map(s => [s.nom, s.total]), [['Charme', 45], ['Ragot', 45], ['Esquive', 31]]);
});

test('topSkills : les compétences sans avance ne comblent que les places libres', () => {
    const d = data({ skillsBasic: { Esquive: 1 } });
    const rows = topSkills(d, engine, 3);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].nom, 'Esquive');
    assert.equal(topSkills(d, engine, 1).length, 1);
});

test('topSkills : spécialité de base et compétence avancée', () => {
    const d = data({
        basicSpecs: { 'Corps à corps (Base)': 'Escrime' }, skillsBasic: { 'Corps à corps (Base)': 4 },
        skillsAdvanced: [{ nom: 'Savoir (Politique)', carac: 'int', adv: 9 }],
    });
    const rows = topSkills(d, engine, 2);
    assert.deepEqual(rows.map(s => [s.nom, s.carac, s.total]), [['Savoir (Politique)', 'Int', 39], ['Corps à corps (Escrime)', 'CC', 34]]);
});

test('topSkills : une forme reliée affiche le nom principal du référentiel', () => {
    const { aliases } = read('js/catalogue/referentiel-public.json').skills;
    const alias = aliases.find(({ label }) => resolver.resolve(label).entry && resolver.resolve(label).entry.nom !== label);
    assert.ok(alias);
    const [row] = topSkills(data({ skillsAdvanced: [{ id: 'a1', nom: alias.label, carac: 'int', adv: 5 }] }), engine, 1);
    assert.equal(row.nom, resolver.resolve(alias.label).entry.nom);
    assert.deepEqual([row.serverName, row.targetId], [alias.label, 'a1']);
});

test('topSkills : l’adressage d’une ligne de base avec spécialité retrouve sa ligne côté serveur', () => {
    const basicSpecs = { 'Corps à corps (Base)': 'Escrime' };
    const [row] = topSkills(data({ basicSpecs, skillsBasic: { 'Corps à corps (Base)': 4 } }), engine, 1);
    assert.equal(row.nom, 'Corps à corps (Escrime)');
    assert.equal(row.row, 'Corps à corps (Base)');
    assert.equal(basicRowFor(row.serverName, basicSpecs), row.row);
});

test('topSkills : données absentes sans exception', () => {
    assert.deepEqual(topSkills(null, null, 4).length, 4);
    assert.deepEqual(topSkills(data(), engine, 0), []);
});

test('caractéristiques : ordre, bonus et marqueur de carrière (variantes et surcharges comprises)', () => {
    const careers = read('js/data/careers.json');
    const rows = ficheCaracs(data({ carriere: 'Agitateur', rang: '1' }), careers);
    assert.deepEqual(rows.map(r => r.abbr), ['CC', 'CT', 'F', 'E', 'I', 'Ag', 'Dex', 'Int', 'FM', 'Soc']);
    assert.deepEqual(rows.filter(r => r.career).map(r => r.key), ['ct', 'int', 'soc']);
    assert.equal(rows[0].bonus, 3);
    const over = ficheCaracs(data({ carriere: 'Agitateur', rang: '1', careerOverrides: { agitateur: { 1: { caracs: ['f'] } } } }), careers);
    assert.deepEqual(over.filter(r => r.career).map(r => r.key), ['f']);
    assert.equal(ficheCaracs(data({ carriere: 'Inventée' }), careers).some(r => r.career), false);
});

test('jetons : valeurs absentes ou non numériques valent 0, la valeur courante est bornée', () => {
    assert.deepEqual(resourceTokens({ destin: '2', chance: '1' }, 'destin', 'chance'), { max: 2, current: 1 });
    assert.deepEqual(resourceTokens({ destin: 'x', chance: undefined }, 'destin', 'chance'), { max: 0, current: 0 });
    assert.deepEqual(resourceTokens({ destin: '1', chance: '3' }, 'destin', 'chance'), { max: 1, current: 1 });
});

class FakeElement {
    constructor(documentRef, tagName) {
        Object.assign(this, { ownerDocument: documentRef, tagName, children: [], parentNode: null, attributes: new Map(), listeners: new Map(),
            className: '', textContent: '', hidden: false, disabled: false, open: false, style: {}, id: '' });
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { this.ownerDocument.activeElement = this; }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    click() { for (const listener of this.listeners.get('click') || []) listener({ target: this }); }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    querySelectorAll() { return this.all().filter(node => node.tagName === 'button' && !node.disabled); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    byText(text) { return this.all().find(node => node.textContent === text); }
}
const fakeDocument = () => {
    const documentRef = { activeElement: null, defaultView: null, body: { classList: { add() {}, remove() {} } },
        createElement: tag => new FakeElement(documentRef, tag), addEventListener() {}, removeEventListener() {} };
    return documentRef;
};
const dotsOf = panel => panel.element.all().filter(node => node.className.startsWith('m-principal-dot'));

test('points : un point vide final, la valeur proposée et le patch avec Chance ramenée au maximum', () => {
    assert.deepEqual([0, 1, 2].map(index => dotTarget(2, index)), [0, 1, 3]);
    assert.equal(dotTarget(0, 0), 1);
    assert.deepEqual(resourceChange({ destin: '3', chance: '1' }, 'destin', 'chance', 2), { changes: { destin: '2' }, lowered: null });
    assert.deepEqual(resourceChange({ destin: '3', chance: '3' }, 'destin', 'chance', 1), { changes: { destin: '1', chance: '1' }, lowered: 3 });
    assert.deepEqual(resourceChange({ resilience: '1', determination: '0' }, 'resilience', 'determination', 0), { changes: { resilience: '0' }, lowered: null });
});

test('panneau : Destin et Résilience en points boutons, Chance et Détermination en nombres, focus conservé', () => {
    const documentRef = fakeDocument();
    const asked = [];
    const opened = [];
    const panel = createPrincipalPanel({ documentRef, aptitudesHref: '#/x', onOpenCarac: key => opened.push(key),
        onChangeResource: spec => asked.push([spec.maxKey, spec.value]) });
    const d = data({ carriere: 'Agitateur', rang: '1', destin: '2', chance: '1', resilience: '0', determination: '0', corruption: '3' });
    panel.update({ data: d, careers: read('js/data/careers.json'), engine });
    const nodes = panel.element.all();
    assert.deepEqual(nodes.filter(n => n.className === 'm-principal-max').map(n => n.textContent), ['Destin', 'Résilience']);
    assert.deepEqual(nodes.filter(n => n.className === 'm-principal-label').map(n => n.textContent), ['Chance 1', 'Détermination 0']);
    const groups = nodes.filter(n => n.getAttribute('role') === 'group');
    assert.deepEqual(groups.map(n => n.getAttribute('aria-label')), ['Destin', 'Résilience']);
    const dots = dotsOf(panel);
    assert.deepEqual(dots.map(n => [n.tagName, n.className.includes('is-full'), n.getAttribute('aria-label')]), [
        ['button', true, "Destin : 2. Brûler jusqu'à 0"], ['button', true, "Destin : 2. Brûler jusqu'à 1"],
        ['button', false, 'Ajouter un point de Destin'], ['button', false, 'Ajouter un point de Résilience']]);
    dots.forEach(dot => dot.click());
    assert.deepEqual(asked, [['destin', 0], ['destin', 1], ['destin', 3], ['resilience', 1]]);
    dots[1].focus();
    panel.update({ data: d, careers: [], engine });
    assert.equal(dotsOf(panel)[1], dots[1]);
    assert.equal(documentRef.activeElement, dots[1]);
    panel.update({ data: { ...d, destin: '3' }, careers: [], engine });
    assert.equal(dotsOf(panel).length, 5, 'quatre points de Destin (3 pleins + 1 vide) et un de Résilience');
    panel.update({ data: d, careers: [], engine, readonly: true });
    assert.ok(dotsOf(panel).every(dot => dot.disabled));
    panel.update({ data: d, careers: read('js/data/careers.json'), engine });
    const buttons = nodes.filter(n => n.tagName === 'button' && n.className.startsWith('m-principal-carac'));
    assert.equal(buttons.length, 10);
    assert.match(buttons[1].getAttribute('aria-label'), /, de carrière$/u);
    buttons[3].click();
    assert.deepEqual(opened, ['e']);
    assert.match(nodes.find(n => /^Mouvement/u.test(n.textContent)).textContent, /Corruption 3$/u);
});

function sheetSetup({ online = true, data = { destin: '3', chance: '3' } } = {}) {
    const documentRef = fakeDocument();
    const calls = [];
    const announces = [];
    const done = [];
    let draft = false;
    const context = { online, state: { phase: 'ready', data }, controller: {
        getState: () => ({ hasDraft: draft }),
        stagePatch: changes => { calls.push(['stage', changes]); draft = true; return { ok: true }; },
        submitPatch: async () => { calls.push(['submit']); draft = false; return { status: 'saved' }; },
        retryPendingPatch: async () => ({ status: 'saved' }),
    } };
    const sheet = createResourceSheet({ documentRef, getContext: () => context, announce: m => announces.push(m), onDone: key => done.push(key) });
    const trigger = documentRef.createElement('button');
    const open = value => sheet.open({ maxKey: 'destin', currentKey: 'chance', maxLabel: 'Destin', label: 'Chance', value }, trigger);
    const title = () => sheet.element.all().find(n => n.tagName === 'h2').textContent;
    return { documentRef, calls, announces, done, trigger, open, title, el: sheet.element, context, setDraft: value => { draft = value; } };
}

test('confirmation : rien n’est écrit à l’ouverture ni à l’annulation, focus initial sur Annuler puis retour au point', () => {
    const setup = sheetSetup();
    setup.open(1);
    assert.ok(setup.el.open);
    assert.equal(setup.documentRef.activeElement, setup.el.byText('Annuler'));
    assert.equal(setup.title(), 'Brûler 2 points de Destin ?');
    assert.ok(setup.el.byText("Ce n'est pas anodin : les points sont perdus définitivement."));
    assert.equal(setup.el.all().find(n => n.className === 'm-purchase-formula').textContent, 'La Chance sera aussi ramenée de 3 à 1.');
    setup.el.byText('Annuler').click();
    assert.deepEqual(setup.calls, []);
    assert.ok(!setup.el.open);
    assert.equal(setup.documentRef.activeElement, setup.trigger);
});

test('confirmation : stagePatch avec Chance ramenée puis envoi, focus rendu avant l’envoi ; ajout sans Chance', async () => {
    const setup = sheetSetup();
    setup.open(2);
    assert.equal(setup.title(), 'Brûler 1 point de Destin ?');
    setup.el.byText('Confirmer').click();
    assert.deepEqual(setup.done, ['destin'], 'le focus est rendu avant l’attente réseau');
    await sleep(0);
    assert.deepEqual(setup.calls, [['stage', { destin: '2', chance: '2' }], ['submit']]);
    assert.deepEqual(setup.announces, ['Destin : 2']);
    setup.open(4);
    assert.equal(setup.title(), 'Ajouter 1 point de Destin ?');
    assert.ok(setup.el.byText('(normalement accordé par le MJ)'));
    setup.el.byText('Confirmer').click();
    await sleep(0);
    assert.deepEqual(setup.calls.at(-2), ['stage', { destin: '4' }]);
});

test('confirmation : hors ligne le brouillon est protégé sans envoi, et l’état est annoncé', async () => {
    const setup = sheetSetup({ online: false, data: { destin: '1', chance: '0' } });
    setup.open(0);
    setup.el.byText('Confirmer').click();
    await sleep(0);
    assert.deepEqual(setup.calls, [['stage', { destin: '0' }]]);
    assert.deepEqual(setup.announces, ['Destin : 0, en attente de connexion']);
});

test('confirmation : conflit signalé par le résultat ou par une erreur du serveur', async () => {
    const setup = sheetSetup();
    setup.context.controller.submitPatch = async () => ({ status: 'blocked', reason: 'conflict' });
    setup.open(2);
    setup.el.byText('Confirmer').click();
    await sleep(0);
    assert.match(setup.announces[0], /^Conflit sur Destin/u);
    setup.context.controller.submitPatch = async () => { throw Object.assign(new Error('x'), { code: 'aborted' }); };
    setup.open(2);
    setup.el.byText('Confirmer').click();
    await sleep(0);
    assert.equal(setup.announces[1], 'Conflit : la valeur a changé ailleurs');
});

test('confirmation : la fiche a changé depuis l’ouverture, le texte est mis à jour et un second toucher est demandé', async () => {
    const setup = sheetSetup();
    setup.open(2);
    setup.context.state = { phase: 'ready', data: { destin: '4', chance: '1' } };
    setup.el.byText('Confirmer').click();
    await sleep(0);
    assert.deepEqual(setup.calls, [], 'rien d’envoyé');
    assert.ok(setup.el.open);
    assert.equal(setup.title(), 'Brûler 2 points de Destin ?');
    setup.el.byText('Confirmer').click();
    await sleep(0);
    assert.deepEqual(setup.calls[0], ['stage', { destin: '2' }]);
});

test('envois : un second envoi pendant le premier rejoue l’ancien puis envoie le nouveau brouillon, en file', async () => {
    const log = [];
    let pending = false;
    let draft = true;
    let calls = 0;
    const controller = {
        getState: () => ({ hasDraft: draft }),
        submitPatch: async () => {
            log.push('submit');
            if (pending) return { status: 'retry-required' };
            calls += 1;
            await sleep(5);
            // Le premier envoi laisse une modification faite pendant son vol.
            draft = calls === 1;
            return { status: 'saved' };
        },
        retryPendingPatch: async () => { log.push('retry'); pending = false; return { status: 'saved' }; },
    };
    const first = submitDraft(controller);
    await sleep(0);
    pending = true;
    const second = submitDraft(controller);
    assert.equal((await first).status, 'saved');
    await second;
    assert.deepEqual(log, ['submit', 'submit', 'retry', 'submit']);
    assert.equal(draft, false);
    assert.equal(await submitDraft({ getState: () => ({ hasDraft: false }) }), undefined);
});

test('conflits : liste lisible, Garder la mienne renvoie, Prendre celle du serveur résout, possessions exclues', async () => {
    const documentRef = fakeDocument();
    const calls = [];
    const announces = [];
    const context = { state: { conflicts: [
        { path: 'destin', server: '1', local: '2' }, { path: 'possessions', server: 'a', local: 'b' }, { path: 'chance', server: '0', local: '1' },
    ] }, controller: {
        getState: () => ({ hasDraft: calls.every(call => call[0] !== 'submit') }),
        resolveConflict: (path, choice) => { calls.push(['resolve', path, choice]); return true; },
        submitPatch: async () => { calls.push(['submit']); return { status: 'saved' }; },
    } };
    const notice = createConflictNotice({ documentRef, getContext: () => context, announce: m => announces.push(m) });
    assert.ok(notice.element.hidden);
    notice.update();
    assert.ok(!notice.element.hidden);
    const texts = notice.element.all().filter(n => n.tagName === 'p').map(n => n.textContent);
    assert.deepEqual(texts, ['Conflit sur Destin : le serveur a 1, vous avez 2.', 'Conflit sur Chance : le serveur a 0, vous avez 1.']);
    const buttons = notice.element.all().filter(n => n.tagName === 'button');
    assert.equal(buttons.length, 4);
    notice.update();
    assert.equal(notice.element.all().filter(n => n.tagName === 'button')[0], buttons[0], 'pas de reconstruction sans changement');
    buttons[0].click();
    buttons[3].click();
    await sleep(0);
    assert.deepEqual(calls, [['resolve', 'destin', 'local'], ['resolve', 'chance', 'server'], ['submit']]);
    context.state = { conflicts: [] };
    notice.update();
    assert.ok(notice.element.hidden);
});

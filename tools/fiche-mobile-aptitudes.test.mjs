import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createFicheController } from '../js/fiche-controller.js';
import { createFicheDraftStore } from '../js/fiche-draft-store.js';
import { BASIC_SKILLS } from '../js/fiche/basic-skills.js';
import {
    filterSkills, hasSpells, sortSkills, spellRows, talentChoices, talentRows, talentTaken,
} from '../js/mobile/fiche-aptitudes-model.js';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { skillRows } from '../js/mobile/fiche-model.js';
import { purchasePayload, purchasePreview, purchaseTarget } from '../js/mobile/fiche-purchase.js';
import { createAptitudesPanel } from '../js/mobile/views/fiche-aptitudes.js';
import { createPurchaseSheet } from '../js/mobile/views/fiche-purchase-sheet.js';
import { createSpecialtySection } from '../js/mobile/views/fiche-specialty.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();
const { careers } = catalogue;
const resolver = engine.skillResolver;

const keys = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const data = (extra = {}) => ({
    carriere: 'Agitateur', rang: '1', basicSpecs: {}, chosenVariants: {}, careerOverrides: {},
    carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: 0 }])),
    skillsBasic: {}, skillsAdvanced: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [],
    xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: 5000 }], ...extra,
});
const byNom = (rows, nom) => rows.find(row => row.nom === nom);

test('skillRows : une ligne par compétence de base, spécialité et nom affiché', () => {
    const d = data({ basicSpecs: { Art: 'Calligraphie' }, skillsBasic: { Charme: 4 } });
    const rows = skillRows(d, engine, careers);
    assert.equal(rows.filter(row => row.basic).length, BASIC_SKILLS.length);
    const charme = byNom(rows, 'Charme');
    assert.deepEqual([charme.caracKey, charme.caracAbbr, charme.caracTotal, charme.adv, charme.total, charme.inCareer],
        ['soc', 'Soc', 30, 4, 34, true]);
    const art = byNom(rows, 'Art (Calligraphie)');
    assert.deepEqual([art.row, art.group, art.spec, art.basic], ['Art', 'Art', 'Calligraphie', true]);
    assert.equal(byNom(rows, 'Esquive').inCareer, false);
    // Sans carrières fournies (onglet Principal), la ligne n'est jamais « de carrière ».
    assert.equal(byNom(skillRows(d, engine), 'Charme').inCareer, false);
});

test('skillRows : formes reliées affichées par leur nom principal, doublons gardés séparés', () => {
    const { aliases } = read('js/catalogue/referentiel-public.json').skills;
    const alias = aliases.find(({ label }) => {
        const match = resolver.resolve(label);
        return match.status === 'resolved' && match.entry.nom !== label && !match.entry.basic;
    });
    assert.ok(alias);
    const principal = resolver.resolve(alias.label).entry;
    const d = data({ skillsAdvanced: [
        { id: 'a1', nom: alias.label, carac: 'int', adv: 2 },
        { id: 'a2', nom: principal.nom, carac: 'int', adv: 5 },
    ] });
    const rows = skillRows(d, engine, careers).filter(row => !row.basic);
    assert.deepEqual(rows.map(row => [row.nom, row.targetId, row.serverName, row.adv]), [
        [principal.nom, 'a1', alias.label, 2], [principal.nom, 'a2', principal.nom, 5],
    ]);
    assert.equal(rows[0].group, principal.group);
});

test('filterSkills : recherche multi-mots sans accents ni casse, filtres combinables', () => {
    const rows = skillRows(data({ skillsBasic: { Charme: 5, Ragot: 2, Esquive: 1 } }), engine, careers);
    assert.deepEqual(filterSkills(rows, { query: 'resistance alc' }).map(row => row.nom), ["Résistance à l'alcool"]);
    assert.deepEqual(filterSkills(rows, { query: '  RÉSISTANCE  ' }).map(row => row.nom).sort(), ['Résistance', "Résistance à l'alcool"]);
    assert.equal(filterSkills(rows, { query: 'alcool resistance zzz' }).length, 0);
    assert.equal(filterSkills(rows, {}).length, rows.length);
    assert.deepEqual(filterSkills(rows, { trained: true }).map(row => row.nom).sort(), ['Charme', 'Esquive', 'Ragot']);
    assert.deepEqual(filterSkills(rows, { trained: true, career: true }).map(row => row.nom).sort(), ['Charme', 'Ragot']);
    assert.deepEqual(filterSkills(rows, { trained: true, career: true, carac: 'soc', query: 'rag' }).map(row => row.nom), ['Ragot']);
    assert.equal(filterSkills(rows, { carac: 'cc', career: true }).length, 0);
});

test('sortSkills : entraînées d’abord, alphabétique dans chaque groupe', () => {
    const rows = skillRows(data({ skillsBasic: { Ragot: 2, Charme: 5, Esquive: 1 } }), engine, careers);
    const sorted = sortSkills(rows).map(row => row.nom);
    assert.deepEqual(sorted.slice(0, 3), ['Charme', 'Esquive', 'Ragot']);
    const rest = sorted.slice(3);
    assert.deepEqual(rest, [...rest].sort((a, b) => a.localeCompare(b, 'fr')));
    assert.equal(sorted.length, rows.length);
});

test('talentRows : acquis avec prises, puis disponibles de la carrière non acquis', () => {
    const d = data({ talentsAcq: [
        { id: 't1', nom: 'Sociable' }, { id: 't2', nom: 'Sociable' }, { id: 't3', nom: 'Dur à cuire' },
    ] });
    const rows = talentRows(d, engine, careers);
    const acquired = rows.filter(row => row.acquired);
    assert.deepEqual(acquired.map(row => [row.nom, row.count]), [['Sociable', 2], ['Dur à cuire', 1]]);
    const available = rows.filter(row => !row.acquired);
    const rank1 = careers.find(career => career.nom === 'Agitateur').rangs[0].talents;
    assert.ok(available.length > 0);
    assert.ok(available.every(row => row.cost === 100 && row.count === 0));
    assert.ok(available.every(row => rank1.includes(row.nom)) && !available.some(row => row.nom === 'Sociable'));
    assert.deepEqual(rows.map(row => row.acquired), [...rows.map(row => row.acquired)].sort((a, b) => b - a));
    assert.equal(talentTaken(d, engine, 'Sociable'), 2);
    assert.equal(talentTaken(d, engine, 'Inconnu'), 0);
    assert.deepEqual(talentRows(data({ carriere: 'Inconnue' }), engine, careers), []);
});

test('sorts et miracles : lignes de consultation, onglet seulement si le personnage en possède', () => {
    assert.equal(hasSpells(data()), false);
    assert.equal(hasSpells(null), false);
    const d = data({
        sorts: [{ id: 's1', nom: 'Couronne de Flammes', vent: 'Aqshy', cn: 8, portee: 'Vous', duree: 'Rounds', resume: 'Feu.' }],
        prieres: [{ id: 'p1', nom: 'Appel', type: 'Miracle', resume: 'Fureur.' }],
    });
    assert.equal(hasSpells(d), true);
    assert.equal(hasSpells(data({ prieres: [{ id: 'p1', nom: 'Appel' }] })), true);
    const { spells, prayers } = spellRows(d);
    assert.deepEqual([spells[0].nom, spells[0].type, spells[0].ni, spells[0].details.map(([label]) => label)], ['Couronne de Flammes', 'Aqshy', '8', ['NI', 'Portée', 'Durée']]);
    assert.deepEqual([prayers[0].nom, prayers[0].type, prayers[0].prayer], ['Appel', 'Miracle', true]);
});

// Le coût prévu pour une nouvelle ligne avancée doit être celui que le moteur accepte.
function assertAccepted(d, spec, count = 1) {
    const target = purchaseTarget(d, engine, careers, spec);
    assert.ok(target);
    const payload = purchasePayload(target, count, engine);
    assert.equal(payload.expectedCost, purchasePreview(target, count, 5000).cost);
    const applied = engine.applyCommand(globalThis.structuredClone(d), { type: 'purchase', operationId: 'op-aptitudes', payload }, { uid: 'u', role: 'joueur' });
    assert.equal(applied.result.cost, payload.expectedCost);
    return { target, payload, applied };
}

test('achat d’une nouvelle spécialité : ligne neuve, ligne déjà possédée, spécialité de base refusée', () => {
    const d = data({ skillsAdvanced: [{ id: 'l1', nom: 'Langue (Reikspiel)', carac: 'int', adv: 3 }] });
    const { target, payload, applied } = assertAccepted(d, { kind: 'skill', newName: 'Langue (Tiléen)' }, 2);
    assert.deepEqual([target.title, target.adv, target.targetId, target.baseValue], ['Langue (Tiléen)', 0, undefined, 30]);
    assert.equal('targetId' in payload, false);
    const added = applied.data.skillsAdvanced.at(-1);
    assert.deepEqual([added.nom, added.carac, added.adv], ['Langue (Tiléen)', 'int', 2]);

    const owned = assertAccepted(d, { kind: 'skill', newName: 'Langue (Reikspiel)' }).target;
    assert.deepEqual([owned.adv, owned.targetId], [3, 'l1']);

    // Saisie libre : le serveur accepte un nom hors référentiel, avec la caractéristique du groupe.
    assert.equal(assertAccepted(d, { kind: 'skill', newName: 'Langue (Gobelin)' }).applied.data.skillsAdvanced.at(-1).carac, 'int');

    assert.equal(purchaseTarget(d, engine, careers, { kind: 'skill', newName: 'Art (Calligraphie)' }), null);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'skill', newName: '  ' }), null);
});

test('volet de compétence : spécialités de base verrouillées après avances, groupes avancés', () => {
    const d = data({ skillsAdvanced: [{ id: 'l1', nom: 'Langue (Reikspiel)', carac: 'int', adv: 3 }], skillsBasic: { Calme: 2 } });
    const rows = skillRows(d, engine, careers);
    const art = purchaseTarget(d, engine, careers, { kind: 'skill', ...byNom(rows, 'Art') }).specialty;
    assert.equal(art.kind, 'basic');
    assert.ok(art.options.includes('Calligraphie'));
    assert.deepEqual([art.row, art.value, art.locked], ['Art', '', false]);
    const trained = purchaseTarget(data({ skillsBasic: { Art: 1 }, basicSpecs: { Art: 'Peinture' } }), engine, careers,
        { kind: 'skill', ...byNom(skillRows(data({ skillsBasic: { Art: 1 }, basicSpecs: { Art: 'Peinture' } }), engine, careers), 'Art (Peinture)') });
    assert.deepEqual([trained.title, trained.specialty.locked, trained.specialty.value], ['Art (Peinture)', true, 'Peinture']);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'skill', ...byNom(rows, 'Calme') }).specialty, null);

    const langue = purchaseTarget(d, engine, careers, { kind: 'skill', ...byNom(rows, 'Langue (Reikspiel)') }).specialty;
    assert.equal(langue.kind, 'group');
    assert.ok(langue.options.some(({ nom, spec }) => nom === 'Langue (Tiléen)' && spec === 'Tiléen'));
    assert.ok(langue.options.every(({ nom }) => nom.startsWith('Langue (')));
});

test('volet de talent : description publiée sans réseau, prises, texte multi-lignes en paragraphes', () => {
    const d = data({ talentsAcq: [{ id: 't1', nom: 'Sociable' }] });
    const sociable = purchaseTarget(d, engine, careers, { kind: 'talent', nom: 'Sociable' });
    assert.equal(sociable.taken, 1);
    assert.ok(sociable.description.length > 0 && sociable.description.every(line => line === line.trim() && line));
    const unknown = purchaseTarget(d, engine, careers, { kind: 'talent', nom: 'Talent inventé' });
    assert.deepEqual([unknown.taken, unknown.description], [0, []]);
    const stubbed = purchaseTarget(d, { ...engine, resolveTalent: () => ({ description: 'Un.\n\n  Deux.\n' }) }, careers, { kind: 'talent', nom: 'Sociable' });
    assert.deepEqual(stubbed.description, ['Un.', 'Deux.']);
});

// ── Vues, sur un faux DOM minimal ─────────────────────────────────

class FakeElement {
    constructor(documentRef, tagName) {
        Object.assign(this, {
            ownerDocument: documentRef, tagName, children: [], parentNode: null, attributes: new Map(), listeners: new Map(),
            className: '', textContent: '', hidden: false, disabled: false, open: false, style: {}, value: '', id: '',
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
        const event = { type, target: this, preventDefault() {}, ...extra };
        for (let node = this; node; node = node.parentNode) for (const listener of node.listeners.get(type) || []) listener(event);
    }
    click() { this.dispatch('click'); }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    querySelectorAll() { return this.all().filter(node => node.tagName === 'button' && !node.disabled); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    byClass(name) { return this.all().find(node => node.className.split(' ').includes(name)); }
    allByClass(name) { return this.all().filter(node => node.className.split(' ').includes(name)); }
}

function fakeDocument() {
    const documentRef = {
        activeElement: null, defaultView: null,
        body: { classList: { add() {}, remove() {} } },
        createElement: tag => new FakeElement(documentRef, tag),
        addEventListener() {}, removeEventListener() {},
    };
    return documentRef;
}

const pane = (panel, index) => panel.element.allByClass('m-apt-pane')[index];
const names = panel => pane(panel, 0).allByClass('m-apt-row').map(row => row.all().find(node => node.className === 'm-apt-name').textContent);
const press = (panel, label) => panel.element.all().find(node => node.tagName === 'button' && node.textContent === label);

test('panneau : requête, filtres et bascule survivent aux mises à jour, sans reconstruire le champ ni les lignes', () => {
    const documentRef = fakeDocument();
    const opened = [];
    const panel = createAptitudesPanel({ documentRef, onOpenSkill: row => opened.push(row), onOpenTalent: nom => opened.push(nom) });
    const base = data({ skillsBasic: { Charme: 5 } });
    panel.update({ data: base, careers, engine });
    const search = panel.element.all().find(node => node.tagName === 'input');
    search.value = 'resistance alc';
    search.dispatch('input');
    assert.deepEqual(names(panel), ["Résistance à l'alcool"]);
    const rowButton = panel.element.allByClass('m-apt-row')[0];

    panel.update({ data: data({ skillsBasic: { Charme: 5, "Résistance à l'alcool": 1 } }), careers, engine });
    assert.equal(panel.element.all().find(node => node.tagName === 'input'), search);
    assert.equal(search.value, 'resistance alc');
    assert.equal(panel.element.allByClass('m-apt-row')[0], rowButton);
    assert.equal(panel.element.all().find(node => node.className === 'm-apt-total is-trained').textContent, '31');

    rowButton.click();
    assert.deepEqual([opened[0].row, opened[0].nom], ["Résistance à l'alcool", "Résistance à l'alcool"]);

    // Filtres : puce de caractéristique à choix unique, re-toucher désélectionne ; « Effacer » remet tout.
    const pressed = () => panel.element.allByClass('m-chip').filter(chip => chip.getAttribute('aria-pressed') === 'true').map(chip => chip.textContent);
    press(panel, 'E').click();
    press(panel, 'Soc').click();
    assert.deepEqual(pressed(), ['Soc']);
    assert.deepEqual(names(panel), []);
    const empty = panel.element.byClass('m-apt-empty');
    assert.equal(empty.hidden, false);
    assert.match(empty.children[0].textContent, /Aucune compétence ne correspond/u);
    press(panel, 'Effacer les filtres').click();
    assert.deepEqual(pressed(), []);
    assert.equal(search.value, '');
    assert.equal(names(panel).length, BASIC_SKILLS.length);
    assert.equal(documentRef.activeElement, search);
    press(panel, 'Soc').click();
    press(panel, 'Soc').click();
    assert.deepEqual(pressed(), []);

    // La bascule est mémorisée : on revient aux talents après une mise à jour.
    press(panel, 'Talents').click();
    panel.update({ data: base, careers, engine });
    assert.deepEqual([0, 1, 2].map(index => pane(panel, index).hidden), [true, false, true]);
    assert.equal(press(panel, 'Talents').getAttribute('aria-pressed'), 'true');
    pane(panel, 1).allByClass('m-apt-row')[0].click();
    assert.equal(typeof opened.at(-1), 'string');
});

test('panneau : l’onglet Sorts n’existe que s’il y a des sorts, et s’ouvre en consultation', () => {
    const documentRef = fakeDocument();
    const panel = createAptitudesPanel({ documentRef });
    panel.update({ data: data(), careers, engine });
    assert.equal(press(panel, 'Sorts').hidden, true);

    const withSpells = data({ sorts: [{ id: 's1', nom: 'Couronne de Flammes', vent: 'Aqshy', cn: 8, portee: 'Vous', duree: 'Rounds', resume: 'Feu.' }] });
    panel.update({ data: withSpells, careers, engine });
    assert.equal(press(panel, 'Sorts').hidden, false);
    press(panel, 'Sorts').click();
    assert.equal(press(panel, 'Sorts').getAttribute('aria-pressed'), 'true');
    pane(panel, 2).allByClass('m-apt-row')[0].click();
    assert.equal(panel.detailElement.open, true);
    assert.equal(panel.detailElement.byClass('m-purchase-title').textContent, 'Couronne de Flammes');

    // Le personnage perd ses sorts : retour aux compétences, sans onglet vide.
    panel.closeDetail();
    panel.update({ data: data(), careers, engine });
    assert.equal(press(panel, 'Sorts').hidden, true);
    assert.equal(press(panel, 'Compétences').getAttribute('aria-pressed'), 'true');
});

function specialtySetup({ stageOk = true, submit = async () => ({ status: 'saved' }), onChoose = () => true } = {}) {
    const documentRef = fakeDocument();
    const staged = [];
    const announces = [];
    const controller = {
        stagePatch: changes => { staged.push(changes); return { ok: stageOk }; },
        resolveConflict: (path, choice) => { staged.push([path, choice]); return true; },
        submitPatch: submit,
    };
    const section = createSpecialtySection({
        documentRef, getContext: () => ({ state: { data: data() }, engine, controller }), onChoose, announce: message => announces.push(message),
    });
    const button = label => section.element.all().find(node => node.tagName === 'button' && node.textContent === label);
    const note = () => section.element.all().filter(node => node.className === 'm-spec-note').map(node => node.textContent).join('');
    return { section, staged, announces, button, note, input: () => section.element.all().find(node => node.id === 'm-spec-input') };
}

test('spécialité de base : patch encodé validé par le moteur, valeur refusée jamais mise en brouillon', async () => {
    const setup = specialtySetup();
    const basic = { kind: 'basic', row: 'Art', value: '', options: ['Calligraphie'], locked: false };
    setup.section.update({ specialty: basic });
    assert.equal(setup.section.element.children.length, 1);
    setup.input().value = 'Calligraphie';
    setup.button('Enregistrer').click();
    await sleep(0);
    assert.deepEqual(setup.staged, [{ 'basicSpecs.Art': 'Calligraphie' }]);
    assert.deepEqual(setup.announces, ['Spécialité enregistrée']);

    setup.input().value = 'Zzzz';
    setup.button('Enregistrer').click();
    await sleep(0);
    assert.equal(setup.staged.length, 1);
    assert.match(setup.note(), /absente du référentiel publié/u);

    // Valeur inchangée : rien à enregistrer.
    const same = specialtySetup();
    same.section.update({ specialty: basic });
    same.button('Enregistrer').click();
    await sleep(0);
    assert.deepEqual(same.staged, []);

    // Verrou après avances : champ et bouton désactivés.
    const locked = specialtySetup();
    locked.section.update({ specialty: { ...basic, locked: true } });
    assert.ok(locked.input().disabled && locked.button('Enregistrer').disabled);
    assert.match(locked.note(), /aucune avance/u);
});

test('spécialité de base : un envoi refusé remet la valeur précédente', async () => {
    const setup = specialtySetup({ submit: async () => { throw Object.assign(new Error('x'), { details: { kind: 'specialization-has-advances' } }); } });
    setup.section.update({ specialty: { kind: 'basic', row: 'Art', value: 'Peinture', options: ['Peinture', 'Calligraphie'], locked: false } });
    setup.input().value = 'Calligraphie';
    setup.button('Enregistrer').click();
    await sleep(0);
    assert.deepEqual(setup.staged, [{ 'basicSpecs.Art': 'Calligraphie' }, ['basicSpecs.Art', 'server']]);
    assert.match(setup.note(), /après des avances/u);
    assert.deepEqual(setup.announces, []);

    const offline = specialtySetup({ submit: async () => ({ status: 'blocked', reason: 'offline' }) });
    offline.section.update({ specialty: { kind: 'basic', row: 'Art', value: '', options: ['Calligraphie'], locked: false } });
    offline.input().value = 'Calligraphie';
    offline.button('Enregistrer').click();
    await sleep(0);
    assert.match(offline.note(), /dès le retour en ligne/u);
});

test('spécialité avancée : le choix ouvre l’achat de la nouvelle ligne, le nom libre aussi', () => {
    const chosen = [];
    let accept = true;
    const setup = specialtySetup({ onChoose: name => { chosen.push(name); return accept; } });
    setup.section.update({ specialty: { kind: 'group', group: 'Langue', options: [{ nom: 'Langue (Tiléen)', spec: 'Tiléen' }] } });
    const picker = setup.section.element.byClass('m-spec-picker');
    assert.equal(picker.hidden, true);
    setup.button('Ajouter une spécialité').click();
    assert.equal(picker.hidden, false);
    assert.equal(setup.button('Ajouter une spécialité').getAttribute('aria-expanded'), 'true');
    setup.button('Tiléen').click();
    assert.deepEqual(chosen, ['Langue (Tiléen)']);
    assert.equal(picker.hidden, true);

    setup.button('Ajouter une spécialité').click();
    const free = setup.section.element.all().find(node => node.id === 'm-spec-free');
    free.value = ' Gobelin ';
    setup.button('Choisir').click();
    assert.deepEqual(chosen.at(-1), 'Langue (Gobelin)');

    setup.button('Ajouter une spécialité').click();
    accept = false;
    free.value = '';
    setup.button('Choisir').click();
    assert.equal(chosen.length, 2, 'un champ vide n’appelle pas onChoose');
    assert.match(setup.note(), /n’est pas disponible/u);
    assert.equal(picker.hidden, false);

    // Sans spécialité, le bloc quitte le DOM : ses boutons ne comptent pas dans le piège de focus du volet.
    setup.section.update({ specialty: null });
    assert.equal(setup.section.element.children.length, 0);
    assert.equal(setup.section.element.hidden, true);
});

test('volet d’achat : description et prises d’un talent, spécialité choisie qui re-cible le volet', () => {
    const documentRef = fakeDocument();
    const state = { phase: 'ready', data: data({ talentsAcq: [{ id: 't1', nom: 'Sociable' }], skillsAdvanced: [{ id: 'l1', nom: 'Langue (Reikspiel)', carac: 'int', adv: 3 }] }) };
    const sheet = createPurchaseSheet({
        documentRef, getContext: () => ({ state, careers, engine, online: true, controller: {} }),
    });
    const trigger = documentRef.createElement('button');
    sheet.open({ kind: 'talent', nom: 'Sociable' }, trigger);
    const paragraphs = sheet.element.byClass('m-purchase-description').children.map(node => node.textContent);
    assert.ok(paragraphs.length > 0 && paragraphs[0] !== 'Aucune description publiée');
    assert.equal(sheet.element.byClass('m-purchase-taken').textContent, 'Prises : 1');
    assert.equal(sheet.element.byClass('m-purchase-talent').hidden, false);
    sheet.close();

    sheet.open({ kind: 'talent', nom: 'Talent inventé' }, trigger);
    assert.deepEqual(sheet.element.byClass('m-purchase-description').children.map(node => node.textContent), ['Aucune description publiée']);
    assert.equal(sheet.element.byClass('m-purchase-taken').textContent, 'Pas encore acquis');
    sheet.close();

    sheet.open({ kind: 'skill', ...byNom(skillRows(state.data, engine, careers), 'Langue (Reikspiel)') }, trigger);
    assert.equal(sheet.element.byClass('m-purchase-title').textContent, 'Langue (Reikspiel)');
    assert.equal(sheet.element.byClass('m-purchase-talent').hidden, true);
    const toggle = sheet.element.all().find(node => node.textContent === 'Ajouter une spécialité');
    toggle.click();
    sheet.element.all().find(node => node.getAttribute('aria-label') === 'Ajouter Langue (Tiléen)').click();
    assert.equal(sheet.element.byClass('m-purchase-title').textContent, 'Langue (Tiléen)');
    assert.equal(sheet.element.byClass('m-purchase-formula').textContent, 'Intelligence 30 + 0 avances = 30');
    assert.equal(documentRef.activeElement, sheet.element.byClass('m-purchase-title'));
    sheet.destroy();
});

test('talents : emplacements à spécialité listés et ouvrables, même si leur groupe est déjà acquis', () => {
    const talents = ['Sociable', 'Savoir-vivre (au choix)', 'Sens aiguisé (Goût ou Toucher)', 'Artisan (Forgeron, Orfèvre ou Ingénieur)'];
    const custom = [{ id: 'c1', nom: 'Test', rangs: [{ rang: 1, titre: 'T', statut: '', skills: [], talents }] }];
    const rows = talentRows(data({ carriere: 'Test' }), engine, custom);
    assert.deepEqual(rows.map(row => [row.nom, row.open]), [
        ['Sociable', false], ['Savoir-vivre (au choix)', true], ['Sens aiguisé (Goût ou Toucher)', true],
        ['Artisan (Forgeron, Orfèvre ou Ingénieur)', true],
    ]);
    // Le serveur accepte plusieurs prises : un talent acquis du même groupe ne retire pas l'emplacement.
    const acquired = talentRows(data({ carriere: 'Test', talentsAcq: [{ id: 't1', nom: 'Savoir-vivre (Guilde)' }, { id: 't2', nom: 'Artisan (Forgeron)' }] }), engine, custom);
    assert.deepEqual(acquired.filter(row => !row.acquired).map(row => row.nom), talents);
    assert.deepEqual(acquired.filter(row => row.acquired).map(row => row.open), [false, false]);

    const opened = [];
    const panel = createAptitudesPanel({ documentRef: fakeDocument(), onOpenTalent: nom => opened.push(nom) });
    panel.update({ data: data({ carriere: 'Test' }), careers: custom, engine });
    press(panel, 'Talents').click();
    const rowsOf = pane(panel, 1).allByClass('m-apt-row');
    assert.deepEqual(rowsOf.map(row => row.disabled), [false, false, false, false]);
    assert.deepEqual(pane(panel, 1).allByClass('m-apt-detail').filter(node => !node.hidden), []);
    rowsOf[1].click();
    assert.deepEqual(opened, ['Savoir-vivre (au choix)']);
});

test('talentChoices : spécialités connues pour « au choix », alternatives listées pour « A ou B »', () => {
    assert.equal(talentChoices(careers, data(), 'Sociable'), null);
    const open = talentChoices(careers, data({ customTalents: { 'Savoir-vivre': ['Cour elfique'] } }), 'Savoir-vivre (au choix)');
    assert.deepEqual([open.base, open.free], ['Savoir-vivre', true]);
    assert.ok(open.specs.includes('guilde') && open.specs.at(-1) === 'Cour elfique');
    const known = open.specs.slice(0, -1);
    assert.deepEqual(known, [...known].sort((a, b) => a.localeCompare(b, 'fr')));
    // Graphies qui ne diffèrent que par la casse ou les accents : une seule puce, la graphie la plus fréquente des carrières (« guilde » : 9 contre 2) ; « Guildes » reste distinct.
    assert.ok(open.specs.includes('guilde') && !open.specs.includes('Guilde') && open.specs.includes('Guildes'));
    const folded = open.specs.map(spec => spec.normalize('NFD').replace(/[̀-ͯ]/gu, '').toLowerCase());
    assert.equal(new Set(folded).size, folded.length);
    const tied = [{ rangs: [{ talents: ['Savoir-vivre (guilde)', 'Savoir-vivre (Guilde)', 'Savoir-vivre (guilde)', 'Savoir-vivre (Érudit)', 'Savoir-vivre (erudit)'] }] }];
    assert.deepEqual(talentChoices(tied, data({ customTalents: { 'Savoir-vivre': ['GUILDE', 'Nobles'] } }), 'Savoir-vivre (au choix)').specs, ['Érudit', 'guilde', 'Nobles']);
    assert.ok(open.specs.every(spec => !/choix|sous/iu.test(spec)));
    assert.deepEqual(talentChoices(careers, data(), 'Sens aiguisé (Goût ou Toucher)'), { base: 'Sens aiguisé', free: false, specs: ['Goût', 'Toucher'] });
    assert.deepEqual(talentChoices(careers, data(), 'Artisan (Forgeron, Orfèvre ou Ingénieur)').specs, ['Forgeron', 'Orfèvre', 'Ingénieur']);
});

test('volet d’achat : talent à choisir, achat bloqué tant que la spécialité manque, liste puis texte libre', async () => {
    const documentRef = fakeDocument();
    const state = { phase: 'ready', data: data({ carriere: 'Agitateur', rang: '4', talentsAcq: [{ id: 't1', nom: 'Savoir-vivre (Guilde)' }] }) };
    const sent = [];
    const controller = { executeOnlineCommand: async (type, payload) => { sent.push([type, payload]); return { status: 'confirmed' }; } };
    const sheet = createPurchaseSheet({ documentRef, getContext: () => ({ state, careers, engine, online: true, controller }) });
    const trigger = documentRef.createElement('button');
    const buy = () => sheet.element.all().find(node => node.tagName === 'button' && /^Acheter/u.test(node.textContent));
    const chip = label => sheet.element.byClass('m-spec-choices').children.find(node => node.textContent === label);
    const reason = () => sheet.element.byClass('m-purchase-reason');

    sheet.open({ kind: 'talent', nom: 'Savoir-vivre (au choix)' }, trigger);
    assert.equal(sheet.element.byClass('m-spec-block').hidden, false);
    assert.equal(buy().disabled, true);
    assert.equal(reason().textContent, 'Choisissez une spécialité');
    assert.equal(sheet.element.allByClass('m-spec-choices')[0].children.at(-1).textContent, 'Autre…');
    assert.ok(chip('guilde · déjà acquis'), 'la spécialité déjà acquise est signalée');
    const free = sheet.element.all().find(node => node.tagName === 'input');
    assert.equal(free.hidden, true);

    chip('guilde · déjà acquis').click();
    assert.equal(chip('guilde · déjà acquis').getAttribute('aria-pressed'), 'true');
    assert.equal(buy().disabled, false);
    assert.equal(sheet.element.byClass('m-purchase-title').textContent, 'Savoir-vivre (guilde)');
    assert.equal(sheet.element.byClass('m-purchase-taken').textContent, 'Prises : 1');

    // Texte libre : « Autre… » affiche le champ, vide = pas de choix, parenthèses retirées.
    sheet.element.allByClass('m-spec-choices')[0].children.at(-1).click();
    assert.equal(free.hidden, false);
    assert.equal(buy().disabled, true);
    free.value = 'Cour (elfique)';
    free.dispatch('input');
    assert.equal(sheet.element.byClass('m-purchase-title').textContent, 'Savoir-vivre (Cour elfique)');
    assert.equal(buy().disabled, false);
    buy().click();
    await sleep(0);
    assert.deepEqual(sent.map(([type, payload]) => [type, payload.kind, payload.name, payload.count]), [['purchase', 'talent', 'Savoir-vivre (Cour elfique)', 1]]);
    assert.equal(sent[0][1].expectedCost, 100);
    sheet.destroy();
});

test('volet d’achat : « A ou B » sans saisie libre', () => {
    const documentRef = fakeDocument();
    const state = { phase: 'ready', data: data({ carriere: 'Artisan', rang: '4' }) };
    const sheet = createPurchaseSheet({ documentRef, getContext: () => ({ state, careers, engine, online: true, controller: {} }) });
    sheet.open({ kind: 'talent', nom: 'Sens aiguisé (Goût ou Toucher)' }, documentRef.createElement('button'));
    assert.deepEqual(sheet.element.byClass('m-spec-choices').children.map(node => node.textContent), ['Goût', 'Toucher']);
    assert.equal(sheet.element.all().find(node => node.tagName === 'input').hidden, true);
    sheet.element.byClass('m-spec-choices').children[1].click();
    assert.equal(sheet.element.byClass('m-purchase-title').textContent, 'Sens aiguisé (Toucher)');
    sheet.destroy();
});

test('spécialité de base : seuls « saved » et « awaiting-snapshot » annoncent un enregistrement', async () => {
    for (const status of ['saved', 'awaiting-snapshot']) {
        const ok = specialtySetup({ submit: async () => ({ status }) });
        ok.section.update({ specialty: { kind: 'basic', row: 'Art', value: '', options: ['Calligraphie'], locked: false } });
        ok.input().value = 'Calligraphie';
        ok.button('Enregistrer').click();
        await sleep(0);
        assert.deepEqual(ok.announces, ['Spécialité enregistrée'], status);
    }
    for (const result of [{ status: 'blocked', reason: 'conflict' }, { status: 'blocked', reason: 'command-pending' }, { status: 'retry-required' }]) {
        const waiting = specialtySetup({ submit: async () => result });
        waiting.section.update({ specialty: { kind: 'basic', row: 'Art', value: '', options: ['Calligraphie'], locked: false } });
        waiting.input().value = 'Calligraphie';
        waiting.button('Enregistrer').click();
        await sleep(0);
        assert.deepEqual(waiting.announces, [], result.status);
        assert.match(waiting.note(), /Enregistrement en attente/u);
    }
});

test('spécialité de base : un refus serveur sans spécialité préalable ne laisse aucun brouillon (vrai contrôleur)', async () => {
    const values = new Map();
    const storage = {
        get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
        getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key),
    };
    const listeners = [];
    const repository = {
        subscribe(_id, next) { listeners.push(next); return () => {}; },
        async execute() { throw Object.assign(new Error('refus'), { code: 'failed-precondition', details: { kind: 'specialization-has-advances' } }); },
    };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage }), isOnline: () => true });
    controller.setSession({ uid: 'u', charId: 'test', role: 'joueur' });
    for (const next of listeners) next({ exists: true, envelope: { schemaVersion: 2, revision: 1, tombstone: false, data: data() } });
    assert.equal(controller.getState().phase, 'ready');
    const section = createSpecialtySection({
        documentRef: fakeDocument(), onChoose: () => true,
        getContext: () => ({ state: controller.getState(), engine, controller }),
    });
    section.update({ specialty: { kind: 'basic', row: 'Art', value: '', options: ['Calligraphie'], locked: false } });
    section.element.all().find(node => node.id === 'm-spec-input').value = 'Calligraphie';
    section.element.all().find(node => node.textContent === 'Enregistrer').click();
    await sleep(10);
    const state = controller.getState();
    assert.deepEqual(controller.getDraftPaths(), []);
    assert.equal(state.hasDraft, false);
    assert.equal(state.data.basicSpecs.Art, undefined);
    assert.equal(values.size, 0, 'aucun brouillon persistant');
    assert.match(section.element.all().filter(node => node.className === 'm-spec-note').map(node => node.textContent).join(''), /après des avances/u);
    controller.close();
});

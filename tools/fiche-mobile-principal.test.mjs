import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { basicRowFor } from '../js/fiche/basic-skills.js';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { ficheCaracs, resourceTokens, topSkills } from '../js/mobile/fiche-model.js';
import { createPrincipalPanel } from '../js/mobile/views/fiche-principal.js';

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

test('panneau : jetons en lecture seule (span), caractéristiques en boutons, focus conservé', () => {
    const documentRef = { createElement: tag => ({ tagName: tag, children: [], attrs: {}, listeners: {}, className: '', textContent: '',
        setAttribute(k, v) { this.attrs[k] = v; }, append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
        addEventListener(t, l) { this.listeners[t] = l; } }) };
    const opened = [];
    const panel = createPrincipalPanel({ documentRef, aptitudesHref: '#/x', onOpenCarac: key => opened.push(key) });
    const d = data({ carriere: 'Agitateur', rang: '1', destin: '2', chance: '1', corruption: '3' });
    panel.update({ data: d, careers: read('js/data/careers.json'), engine });
    const walk = (node, out = []) => { out.push(node); node.children.forEach(c => walk(c, out)); return out; };
    const nodes = walk(panel.element);
    const tokens = nodes.filter(n => n.tagName === 'span' && n.className.startsWith('m-principal-token'));
    assert.deepEqual(tokens.map(n => [n.tagName, n.className.includes('is-full')]), [['span', true], ['span', false]]);
    assert.equal(nodes.find(n => n.attrs.role === 'group').attrs['aria-label'], 'Chance : 1 sur 2');
    const buttons = nodes.filter(n => n.tagName === 'button');
    assert.equal(buttons.length, 10);
    assert.match(buttons[1].attrs['aria-label'], /, de carrière$/u);
    assert.doesNotMatch(buttons[0].attrs['aria-label'], /carrière/u);
    panel.update({ data: d, careers: [], engine });
    assert.equal(walk(panel.element).filter(n => n.tagName === 'button')[0], buttons[0]);
    buttons[3].listeners.click();
    assert.deepEqual(opened, ['e']);
    assert.match(nodes.find(n => /^Mouvement/u.test(n.textContent)).textContent, /Corruption 3$/u);
});

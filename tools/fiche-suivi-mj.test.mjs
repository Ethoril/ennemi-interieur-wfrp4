// Chantier H, T4 : section « Suivi du MJ » (champ `suiviMj`, écrit par la seule commande `outil-mj`),
// en lecture seule sur la fiche bureau et la fiche mobile (CA20, CA21, CA22).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { renderSuiviMjHtml, suiviMjGroups } from '../js/fiche/suivi-mj.js';
import { createPrincipalPanel } from '../js/mobile/views/fiche-principal.js';

const source = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

const ENTRIES = [
    { id: 'outil:mut-1', categorie: 'mutation', libelle: 'Œil supplémentaire', detail: 'Au milieu du front.' },
    { id: 'outil:pen-1', categorie: 'penitence', libelle: 'Jeûne de Sigmar', detail: 'Sept jours sans viande.', depuis: '06/11' },
    { id: 'outil:seq-1', categorie: 'sequelle', libelle: 'Pied perdu', detail: 'Mouvement −1.' },
    { id: 'outil:pen-2', categorie: 'penitence', libelle: 'Pèlerinage', detail: '' },
    { id: 'outil:mal-1', categorie: 'maladie', libelle: 'Toux des égouts', detail: 'Endurance −10.' },
    { id: 'outil:cic-1', categorie: 'cicatrice', libelle: 'Balafre', detail: 'Joue gauche.' },
];

test('groupes : ordre fixe des catégories, ordre des entrées conservé, rien si absent ou vide', () => {
    assert.deepEqual(suiviMjGroups({}), []);
    assert.deepEqual(suiviMjGroups({ suiviMj: [] }), []);
    assert.deepEqual(suiviMjGroups(null), []);
    const groups = suiviMjGroups({ suiviMj: ENTRIES });
    assert.deepEqual(groups.map(group => group.titre), ['Pénitences', 'Séquelles', 'Cicatrices', 'Maladies', 'Mutations']);
    assert.deepEqual(groups[0].entries.map(entry => entry.libelle), ['Jeûne de Sigmar', 'Pèlerinage']);
    assert.equal(groups[0].entries[0].depuis, '06/11');
    // Une catégorie inconnue ou une entrée mal formée n'est pas affichée.
    assert.deepEqual(suiviMjGroups({ suiviMj: [{ id: 'x', categorie: 'secret', libelle: 'X', detail: '' }, 'ligne', null] }), []);
});

test('bureau : section en lecture seule, groupée, échappée ; absente si vide', () => {
    assert.equal(renderSuiviMjHtml({}), '');
    assert.equal(renderSuiviMjHtml({ suiviMj: [] }), '');
    const html = renderSuiviMjHtml({ suiviMj: [...ENTRIES, { id: 'outil:x', categorie: 'maladie', libelle: '<script>alert(1)</script>', detail: '"&' }] });
    assert.match(html, /Suivi du MJ/u);
    for (const text of ['Pénitences', 'Jeûne de Sigmar', 'Sept jours sans viande.', 'depuis 06/11', 'Séquelles', 'Pied perdu', 'Cicatrices', 'Maladies', 'Mutations', 'Œil supplémentaire']) {
        assert.ok(html.includes(text), text);
    }
    assert.ok(html.indexOf('Pénitences') < html.indexOf('Séquelles') && html.indexOf('Maladies') < html.indexOf('Mutations'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    // CA21 : aucune commande d'édition.
    assert.doesNotMatch(html, /<(button|input|select|textarea)\b|data-action|data-patch|contenteditable/u);
});

test('bureau : la fiche affiche la section, et aucune modification simple ne vise suiviMj', () => {
    const app = source('js/fiche-bureau/app.js');
    assert.match(app, /renderSuiviMjHtml\(data\)/u);
    assert.doesNotMatch(app, /suiviMj/u, 'le bureau ne manipule pas suiviMj directement');
    assert.doesNotMatch(source('js/fiche-controller.js'), /suiviMj/u, 'suiviMj hors des champs de modification simple du client');
});

class FakeElement {
    constructor(documentRef, tagName) {
        Object.assign(this, { ownerDocument: documentRef, tagName, children: [], parentNode: null, attributes: new Map(), listeners: new Map(),
            className: '', textContent: '', hidden: false, disabled: false, style: {}, id: '' });
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { this.ownerDocument.activeElement = this; }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
}
const fakeDocument = () => {
    const documentRef = { activeElement: null, createElement: tag => new FakeElement(documentRef, tag), addEventListener() {}, removeEventListener() {} };
    return documentRef;
};
const caracs = Object.fromEntries(['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'].map(key => [key, { base: 30, adv: 0 }]));

test('mobile : section du panneau Principal, en lecture seule, masquée si vide, mise à jour à chaque envoi (CA22)', () => {
    const panel = createPrincipalPanel({ documentRef: fakeDocument(), aptitudesHref: '#/x' });
    const section = () => panel.element.all().find(node => node.className.includes('m-suivi-mj'));
    const texts = () => section().all().map(node => node.textContent).filter(Boolean);
    const base = { carac: caracs, skillsBasic: {}, skillsAdvanced: [] };

    panel.update({ data: base, careers: [], engine: null });
    assert.ok(section(), 'section présente dans la structure');
    assert.equal(section().hidden, true);

    panel.update({ data: { ...base, suiviMj: ENTRIES }, careers: [], engine: null });
    assert.equal(section().hidden, false);
    for (const text of ['Suivi du MJ', 'Pénitences', 'Jeûne de Sigmar', 'Sept jours sans viande.', 'depuis 06/11', 'Mutations', 'Œil supplémentaire']) {
        assert.ok(texts().includes(text), text);
    }
    assert.deepEqual(section().all().filter(node => node.tagName === 'h4').map(node => node.textContent),
        ['Pénitences', 'Séquelles', 'Cicatrices', 'Maladies', 'Mutations']);
    assert.equal(section().all().some(node => ['button', 'input', 'select', 'textarea'].includes(node.tagName)), false, 'aucune commande d’édition');

    // Pénitence close et maladie guérie : elles disparaissent au prochain affichage.
    panel.update({ data: { ...base, suiviMj: ENTRIES.filter(entry => !['penitence', 'maladie'].includes(entry.categorie)) }, careers: [], engine: null });
    assert.ok(!texts().includes('Pénitences') && !texts().includes('Toux des égouts'));
    panel.update({ data: { ...base, suiviMj: [] }, careers: [], engine: null });
    assert.equal(section().hidden, true);
});

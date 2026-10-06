import test from 'node:test';
import assert from 'node:assert/strict';
import { createCareerViewer } from '../js/fiche/career-viewer.js';

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.listeners = new Map();
        this.attributes = {};
        this.value = '';
        this.checked = false;
        this.textContent = '';
        this.className = '';
        this.open = false;
    }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, listener) {
        const list = this.listeners.get(name) || [];
        list.push(listener);
        this.listeners.set(name, list);
    }
    dispatch(name, extra = {}) {
        for (const listener of this.listeners.get(name) || []) listener({ target: this, ...extra });
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch('close'); }
    focus() { this.focused = true; if (globalThis.document) globalThis.document.activeElement = this; }
}

function walk(node) {
    return [node, ...(node.children || []).flatMap(walk)];
}

function byTestId(root, id) {
    return walk(root).find(node => node.dataset?.testid === id);
}

function career(id, name, ranks) { return { id, nom: name, source: 'Livre', rangs: ranks }; }

const careers = [
    career('chasseur', 'Chasseur', [
        { rang: 1, titre: 'Pisteur', statut: 'Cuivre 1', caracs: ['ag'], skills: ['Pister'], talents: ['Éclaireur'] },
        { rang: 3, titre: 'Traqueur', statut: 'Argent 1', caracs: ['i'], skills: ['Survie'], talents: ['Vigilant'] },
        { rang: 3, titre: 'Chasseur de primes', statut: 'Argent 2', caracs: ['cc'], skills: ['Intimidation'], talents: ['Dur à cuire'] },
        { rang: 5, titre: 'Maître chasseur', skills: ['Commandement'], talents: ['Tireur d’élite'] },
    ]),
    career('batelier', 'Batelier', [
        { rang: 1, titre: 'Mousse', caracs: ['f'], skills: ['Ramer'], talents: ['Marin'] },
        { rang: 2, titre: 'Matelot', caracs: ['e'], skills: ['Navigation'], talents: ['Sens de l’orientation'] },
    ]),
];

function installDocument() {
    const previous = globalThis.document;
    globalThis.document = { createElement: tag => new FakeElement(tag), activeElement: null };
    return () => { globalThis.document = previous; };
}

test('preview démarre au prochain rang existant et ne crée pas de rang artificiel', () => {
    const restore = installDocument();
    try {
        const container = new FakeElement('div');
        createCareerViewer({ container, getContext: () => ({ careers, careerName: 'Chasseur', rank: 1 }) });
        const root = container.children[0];
        assert.equal(byTestId(root, 'mode-adapte').checked, true);
        assert.equal(byTestId(root, 'rang-apercu').value, '3');
        assert.equal(walk(root).filter(node => node.className === 'career-viewer-rank').length, 1);
        assert.ok(walk(root).some(node => node.textContent === 'Traqueur'));
        assert.ok(!walk(root).some(node => node.textContent === 'Rang 4'));
    } finally { restore(); }
});

test('choix de variante et cumul modifient seulement la vue locale', () => {
    const restore = installDocument();
    try {
        const container = new FakeElement('div');
        const context = { careers, careerName: 'Chasseur', rank: 1, chosenVariants: { chasseur: { 3: 'Traqueur' } } };
        createCareerViewer({ container, getContext: () => context });
        let root = container.children[0];
        const variant = byTestId(root, 'variante-du-rang');
        variant.value = 'Chasseur de primes';
        variant.dispatch('change');
        root = container.children[0];
        assert.ok(walk(root).some(node => node.textContent === 'Intimidation'));
        assert.ok(!walk(root).some(node => node.textContent === 'Survie'));
        const cumulative = byTestId(root, 'afficher-les-rangs-precedents');
        cumulative.checked = true;
        cumulative.dispatch('change');
        root = container.children[0];
        assert.equal(walk(root).filter(node => node.className === 'career-viewer-rank').length, 2);
        assert.deepEqual(context.chosenVariants, { chasseur: { 3: 'Traqueur' } });
    } finally { restore(); }
});

test('modal parcourt les carrières entières et la version adaptée sans écrire dans le contexte', () => {
    const restore = installDocument();
    try {
        const container = new FakeElement('div');
        const context = {
            careers, careerName: 'Chasseur', rank: 1,
            careerOverrides: { batelier: { 1: { skillsAdded: ['Nœud marin'] } } },
        };
        const clicked = [];
        createCareerViewer({ container, getContext: () => context, onTalent: value => clicked.push(value) });
        byTestId(container.children[0], 'open-modal').dispatch('click');
        let root = container.children[0];
        let dialog = walk(root).find(node => node.tagName === 'DIALOG');
        dialog.scrollTop = 84;
        const careerControlBefore = byTestId(root, 'carriere-modal');
        careerControlBefore.focus();
        const careerSelect = byTestId(root, 'carriere-modal');
        careerSelect.value = 'batelier';
        careerSelect.dispatch('change');
        root = container.children[0];
        dialog = walk(root).find(node => node.tagName === 'DIALOG');
        assert.equal(dialog.scrollTop, 84);
        assert.equal(globalThis.document.activeElement, byTestId(root, 'carriere-modal'));
        assert.equal(dialog.open, true);
        assert.ok(walk(root).some(node => node.textContent === 'Rang 2 · Matelot'));
        let adapted = byTestId(root, 'mode-adapte-modal');
        adapted.checked = false;
        adapted.dispatch('change');
        root = container.children[0];
        assert.ok(!walk(root).some(node => node.textContent === 'Nœud marin'));
        adapted = byTestId(root, 'mode-adapte-modal');
        adapted.checked = true;
        adapted.dispatch('change');
        root = container.children[0];
        assert.ok(walk(root).some(node => node.textContent === 'Nœud marin'));
        const talentButton = walk(root).find(node => node.className === 'career-viewer-talent' && node.textContent === 'Marin');
        talentButton.dispatch('click');
        assert.deepEqual(clicked, ['Marin']);
        assert.deepEqual(context.careerOverrides.batelier[1].skillsAdded, ['Nœud marin']);
        byTestId(root, 'close-modal').dispatch('click');
        assert.ok(!walk(container.children[0]).some(node => node.tagName === 'DIALOG'));
    } finally { restore(); }
});

test('les libellés publiés remplacent les alias reconnus et les inconnus restent inchangés', () => {
    const restore = installDocument();
    try {
        const container = new FakeElement('div');
        const resolveSkill = value => value === 'Pister'
            ? { status: 'resolved', entry: { id: 'pister', nom: 'Pistage' } }
            : { status: 'unknown' };
        const resolveTalent = value => value === 'Éclaireur'
            ? { status: 'resolved', entry: { id: 'eclaireur', nom: 'Éclaireur (catalogue)' } }
            : { status: 'ambiguous' };
        const testCareers = JSON.parse(JSON.stringify(careers));
        testCareers[0].rangs[0].skills.push('Compétence inconnue');
        createCareerViewer({
            container,
            getContext: () => ({ careers: testCareers, careerName: 'Chasseur', rank: 0, resolveSkill, resolveTalent }),
        });
        const root = container.children[0];
        assert.ok(walk(root).some(node => node.textContent === 'Pistage'));
        assert.ok(walk(root).some(node => node.textContent === 'Éclaireur (catalogue)'));
        assert.ok(walk(root).some(node => node.textContent === 'Compétence inconnue'));
    } finally { restore(); }
});

test('destroy retire la vue et désactive les rendus suivants', () => {
    const restore = installDocument();
    try {
        const container = new FakeElement('div');
        const viewer = createCareerViewer({ container, getContext: () => ({ careers, careerName: 'Chasseur', rank: 1 }) });
        viewer.destroy();
        viewer.update();
        assert.deepEqual(container.children, []);
    } finally { restore(); }
});

test('openModal ouvre la modale seule (mobile) et rend la main à la fermeture ; sans option le bureau garde son aperçu', () => {
    const restore = installDocument();
    try {
        const container = new FakeElement('div');
        let closed = 0;
        const viewer = createCareerViewer({
            container, modalOnly: true, onModalClose: () => { closed += 1; },
            getContext: () => ({ careers, careerName: 'Chasseur', rank: 1 }),
        });
        assert.deepEqual(container.children, []);
        viewer.openModal();
        assert.equal(container.children.length, 1);
        const dialog = container.children[0];
        assert.equal(dialog.tagName, 'DIALOG');
        assert.equal(dialog.open, true);
        assert.ok(walk(dialog).some(node => node.textContent === 'Rang 3 · Traqueur'));
        byTestId(dialog, 'close-modal').dispatch('click');
        assert.equal(closed, 1);
        assert.deepEqual(container.children, []);
        viewer.openModal();
        assert.equal(container.children[0].open, true);

        // Bureau : openModal ouvre la modale dans la section habituelle, le focus revient au bouton d'ouverture.
        const desktop = new FakeElement('div');
        const classic = createCareerViewer({ container: desktop, getContext: () => ({ careers, careerName: 'Chasseur', rank: 1 }) });
        assert.equal(desktop.children[0].className, 'career-viewer');
        classic.openModal();
        const modal = walk(desktop.children[0]).find(node => node.tagName === 'DIALOG');
        assert.equal(modal.open, true);
        byTestId(modal, 'close-modal').dispatch('click');
        assert.equal(globalThis.document.activeElement, byTestId(desktop.children[0], 'open-modal'));
    } finally { restore(); }
});

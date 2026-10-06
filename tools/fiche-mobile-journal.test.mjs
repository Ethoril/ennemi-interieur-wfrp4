import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { xpBalance } from '../js/fiche/derived.js';
import {
    buildFicheExport, FICHE_EXPORT_KEYS, ficheExportFilename, parseFicheImport,
} from '../js/fiche/export-import.js';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { xpLogRows } from '../js/mobile/fiche-model.js';
import { purchasePayload, purchaseTarget } from '../js/mobile/fiche-purchase.js';
import { createCancelSheet } from '../js/mobile/views/fiche-cancel-sheet.js';
import { createJournalPanel } from '../js/mobile/views/fiche-journal.js';
import { createImportSheet, downloadJson } from '../js/mobile/views/fiche-transfer.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const source = path => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();
const keys = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const PLAYER = { uid: 'u1', role: 'joueur' };

const sheet = () => ({
    carriere: 'Agitateur', rang: '1', basicSpecs: {}, chosenVariants: {}, careerOverrides: {}, possessions: 'Une plume',
    carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: 3 }])),
    skillsBasic: {}, skillsAdvanced: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [], careers: [],
    xpLog: [{ id: 'g', kind: 'gain', raison: 'Création', montant: 500 }],
});
const buy = (data, key, count, id, actor = PLAYER) => {
    const target = purchaseTarget(data, engine, catalogue.careers, { kind: 'carac', key });
    const command = { type: 'purchase', operationId: id, payload: purchasePayload(target, count, engine) };
    return engine.applyCommand(globalThis.structuredClone(data), command, actor).data;
};

test('journal : soldes, ordre antéchronologique, libellés, natures et achat annulable', () => {
    let data = buy(sheet(), 'soc', 2, 'op-1');
    data = buy(data, 'int', 3, 'op-2');
    let rows = xpLogRows(data, engine, 'u1');
    assert.deepEqual(rows.map(row => [row.label, row.nature, row.amount]), [
        ['int +3', 'Achat · Caractéristique', -80],
        ['soc +2', 'Achat · Caractéristique', -50],
        ['Création', 'Gain', 500],
    ]);
    assert.deepEqual(xpBalance(data), { gagne: 500, depense: 130, libre: 370 });
    assert.deepEqual(rows.map(row => !!row.purchaseId), [true, false, false], 'seul le dernier achat est annulable');
    assert.equal(xpLogRows(data, engine, 'autre')[0].purchaseId, '', 'ni celui d’un autre compte');

    const cancelled = engine.applyCommand(globalThis.structuredClone(data), {
        type: 'cancel', operationId: 'op-3', payload: { purchaseId: rows[0].purchaseId },
    }, PLAYER).data;
    rows = xpLogRows(cancelled, engine, 'u1');
    assert.deepEqual(rows.map(row => [row.label, row.nature, row.amount, row.cancelled]), [
        ['Annulation de int +3', 'Annulation', 80, false],
        ['int +3', 'Achat · Caractéristique', -80, true],
        ['soc +2', 'Achat · Caractéristique', -50, false],
        ['Création', 'Gain', 500, false],
    ], 'l’entrée technique « cancel » n’a pas de ligne');
    assert.deepEqual(xpBalance(cancelled), { gagne: 580, depense: 130, libre: 450 });
    assert.deepEqual(rows.map(row => !!row.purchaseId), [false, false, true, false], 'le dernier achat non annulé devient annulable');
});

test('journal : entrées historiques sans kind, corrections MJ, achat sans libellé, achat d’un autre', () => {
    const data = {
        xpLog: [
            { id: 'a', kind: 'gain', raison: 'Séance 1', montant: 150 },
            { id: 'b', type: 'Talent', achat: 'Sociable', cout: 100, note: 'ancien' },
            { id: 'c', kind: 'purchase', type: 'Compétence', targetNom: 'Charme', cout: 20, origin: 'command', actorUid: 'mj', purchaseId: 'p', effects: [] },
            { id: 'd', kind: 'correction', type: 'Autre', achat: 'Erreur de saisie', cout: 10, applied: false },
            { id: 'e', kind: 'gain', raison: 'Rattrapage', montant: 10, correction: true },
            { id: 'f', kind: 'cancel', cancelledPurchaseId: 'zz' },
            { kind: 'purchase', cout: 5 },
        ],
    };
    const rows = xpLogRows(data, engine, 'u1');
    assert.deepEqual(rows.map(row => [row.label, row.nature, row.amount]), [
        ['', 'Achat · Autre', -5],
        ['Rattrapage', 'Correction MJ', 10],
        ['Erreur de saisie', 'Correction MJ', -10],
        ['Charme', 'Achat · Compétence', -20],
        ['Sociable', 'Achat · Talent', -100],
        ['Séance 1', 'Gain', 150],
    ]);
    assert.ok(rows.every(row => !row.purchaseId));
    assert.deepEqual(xpLogRows({}, engine, 'u1'), []);
});

// Copie de la logique du bureau (js/fiche.js exportData + exportToFile), lue dans la source : fiche.js dépend du DOM.
test('export : même objet que le bureau, mêmes clés que le serveur, nom de fichier daté', () => {
    const desktop = source('js/fiche.js');
    const exportData = desktop.match(/export function exportData\(\) \{\s*return \{([\s\S]*?)\n    \};/u)[1];
    const desktopKeys = [...exportData.matchAll(/^\s+(\w+):/gmu)].map(match => match[1]);
    assert.deepEqual(desktopKeys, FICHE_EXPORT_KEYS);
    const serverKeys = source('js/fiche/commands.js').match(/const EXPORT_KEYS = new Set\(\[([\s\S]*?)\]\);/u)[1];
    assert.deepEqual([...serverKeys.matchAll(/'(\w+)'/gu)].map(match => match[1]), FICHE_EXPORT_KEYS);
    const desktopImport = desktop.match(/const exportKeys = new Set\(\[([\s\S]*?)\]\);/u)[1];
    assert.deepEqual([...desktopImport.matchAll(/'(\w+)'/gu)].map(match => match[1]), FICHE_EXPORT_KEYS);

    const data = { ...sheet(), customSpecs: {}, customTalents: {}, optVisible: { 'section-sorts': false }, nom: 'Ilsa', race: 'humain',
        blessuresAct: '3', resilience: '1', determination: '1', chance: '1', destin: '2', corruption: '0',
        catalogueMigrationBarriers: [{ purchaseIds: ['x'] }], revision: 9 };
    const exportedAt = '2026-10-06T12:34:56.000Z';
    // Ce que le bureau écrit : { _format, _version, _app, _charId, _exportedAt, ...exportData() } (exportData : les 26 clés).
    const expected = {
        _format: 'wfrp4-fiche', _version: 1, _app: 'v2.31.1', _charId: 'test', _exportedAt: exportedAt,
        ...Object.fromEntries(desktopKeys.map(key => [key, data[key]])),
    };
    const built = buildFicheExport(data, { charId: 'test', appVersion: 'v2.31.1', exportedAt });
    assert.deepEqual(built, expected);
    assert.equal(JSON.stringify(built, null, 2), JSON.stringify(expected, null, 2), 'même ordre des clés, donc même fichier');
    assert.ok(!('catalogueMigrationBarriers' in built) && !('revision' in built));
    assert.equal(ficheExportFilename('test', exportedAt), 'fiche-test-2026-10-06.json');
    assert.match(desktop, /a\.download = `fiche-\$\{payload\._charId\}-\$\{jour\}\.json`/u);
});

test('import : format invalide ou illisible refusé, clés filtrées, aller-retour avec l’export', () => {
    assert.deepEqual(parseFicheImport('{pas du json'), { error: 'unreadable' });
    assert.deepEqual(parseFicheImport('[]'), { error: 'format' });
    assert.deepEqual(parseFicheImport('null'), { error: 'format' });
    assert.deepEqual(parseFicheImport(JSON.stringify({ nom: 'Ilsa' })), { error: 'format' });
    assert.deepEqual(parseFicheImport(JSON.stringify({ _format: 'autre', nom: 'Ilsa' })), { error: 'format' });
    const text = JSON.stringify({ _format: 'wfrp4-fiche', _charId: 'x', nom: 'Ilsa', revision: 4, secret: 1, xpLog: [] });
    assert.deepEqual(parseFicheImport(text), { data: { nom: 'Ilsa', xpLog: [] } });
    const data = sheet();
    const roundTrip = parseFicheImport(JSON.stringify(buildFicheExport(data, { charId: 'a', exportedAt: '2026-01-01T00:00:00Z' }))).data;
    assert.deepEqual(roundTrip, Object.fromEntries(FICHE_EXPORT_KEYS.filter(key => key in data).map(key => [key, data[key]])));
});

class FakeElement {
    constructor(documentRef, tagName) {
        Object.assign(this, {
            ownerDocument: documentRef, tagName, children: [], parentNode: null, attributes: new Map(), listeners: new Map(),
            className: '', textContent: '', hidden: false, disabled: false, open: false, style: {}, value: '',
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
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    querySelectorAll() { return this.all().filter(node => node.tagName === 'button' && !node.disabled); }
    closest(selector) {
        const name = selector.slice(1, -1);
        for (let node = this; node; node = node.parentNode) if (node.attributes?.has(name)) return node;
        return null;
    }
    showModal() { this.open = true; }
    close() { this.open = false; }
    byClass(name) { return this.all().find(node => node.className.split(' ').includes(name)); }
    byText(text) { return this.all().find(node => node.textContent === text); }
}
const fakeDocument = () => {
    const documentRef = {
        activeElement: null, defaultView: null, body: { classList: { add() {}, remove() {} } },
        createElement: tag => new FakeElement(documentRef, tag),
        addEventListener() {}, removeEventListener() {},
    };
    return documentRef;
};

// Contrôleur factice : brouillon, conflits et envois observables.
function journalSetup({ online = true, conflicts = [] } = {}) {
    const documentRef = fakeDocument();
    const calls = [];
    const draft = {};
    const context = {
        online,
        state: { phase: 'ready', data: { possessions: 'Une plume' }, conflicts },
        controller: {
            getState: () => ({ hasDraft: Object.keys(draft).length > 0 }),
            getDraftPaths: () => Object.keys(draft),
            stagePatch: changes => { calls.push(['stage', changes]); Object.assign(draft, changes); return { ok: true }; },
            submitPatch: async () => { calls.push(['submit']); for (const key of Object.keys(draft)) delete draft[key]; return { status: 'saved' }; },
            retryPendingPatch: async () => ({ status: 'saved' }),
            resolveConflict: (path, choice) => { calls.push(['resolve', path, choice]); return true; },
        },
    };
    const panel = createJournalPanel({ documentRef, getContext: () => context, saveDelay: 20 });
    panel.update();
    const area = panel.element.all().find(node => node.tagName === 'textarea');
    const status = panel.element.byClass('m-form-status');
    return { documentRef, calls, context, panel, area, status };
}

test('possessions : brouillon à chaque frappe, envoi après la pause et à la perte du focus', async () => {
    const setup = journalSetup();
    assert.equal(setup.area.value, 'Une plume');
    assert.equal(setup.status.textContent, 'Enregistré');
    setup.area.value = 'Une plume, une dague';
    setup.area.dispatch('input');
    setup.area.value = 'Une plume, une dague, du pain';
    setup.area.dispatch('input');
    assert.equal(setup.status.textContent, 'Enregistrement…');
    assert.deepEqual(setup.calls.map(call => call[0]), ['stage', 'stage'], 'rien n’est envoyé pendant la frappe');
    await sleep(60);
    assert.deepEqual(setup.calls.map(call => call[0]), ['stage', 'stage', 'submit'], 'un seul envoi après la pause');
    assert.equal(setup.status.textContent, 'Enregistré');

    setup.area.value = 'Autre';
    setup.area.dispatch('input');
    setup.area.dispatch('blur');
    await sleep(0);
    assert.equal(setup.calls.filter(call => call[0] === 'submit').length, 2, 'la perte du focus envoie sans attendre');
    await sleep(60);
    assert.equal(setup.calls.filter(call => call[0] === 'submit').length, 2, 'la pause ne renvoie pas');
    setup.panel.destroy();
});

test('possessions : hors ligne le brouillon attend, au retour du réseau save() l’envoie ; la saisie n’est pas écrasée', async () => {
    const setup = journalSetup({ online: false });
    setup.documentRef.activeElement = setup.area;
    setup.area.value = 'Écrit hors ligne';
    setup.area.dispatch('input');
    await sleep(60);
    assert.equal(setup.status.textContent, 'Modification en attente de connexion');
    assert.ok(!setup.calls.some(call => call[0] === 'submit'));
    setup.context.state = { ...setup.context.state, data: { possessions: 'Valeur serveur' } };
    setup.panel.update();
    assert.equal(setup.area.value, 'Écrit hors ligne', 'le champ focalisé garde la saisie');
    setup.context.online = true;
    await setup.panel.save();
    assert.equal(setup.calls.filter(call => call[0] === 'submit').length, 1);
    assert.equal(setup.status.textContent, 'Enregistré');
    setup.documentRef.activeElement = null;
    setup.panel.update();
    assert.equal(setup.area.value, 'Valeur serveur');
    setup.panel.destroy();
});

test('possessions : conflit, boutons de résolution', async () => {
    const setup = journalSetup({ conflicts: [{ path: 'possessions' }] });
    assert.equal(setup.status.textContent, 'Conflit : cette note a aussi changé sur le serveur.');
    const conflict = setup.panel.element.byClass('m-journal-conflict');
    assert.equal(conflict.hidden, false);
    conflict.byText('Prendre celle du serveur').dispatch('click');
    conflict.byText('Garder ma version').dispatch('click');
    assert.deepEqual(setup.calls, [['resolve', 'possessions', 'server'], ['resolve', 'possessions', 'local']]);
    setup.context.state = { ...setup.context.state, conflicts: [] };
    setup.panel.update();
    assert.equal(conflict.hidden, true);
    setup.panel.destroy();
});

test('journal : bascule Expérience / Possessions et notes avec aria-pressed, historique et annulation du dernier achat', () => {
    const data = buy(sheet(), 'soc', 2, 'op-1');
    const documentRef = fakeDocument();
    const cancels = [];
    const context = { online: true, state: { phase: 'ready', uid: 'u1', data, conflicts: [] }, engine, controller: { getDraftPaths: () => [] } };
    const panel = createJournalPanel({
        documentRef, getContext: () => context, onCancel: (id, trigger) => cancels.push([id, trigger]),
    });
    panel.update();
    const switches = panel.element.all().filter(node => node.className === 'm-apt-switch-button');
    assert.deepEqual(switches.map(node => [node.textContent, node.getAttribute('aria-pressed')]),
        [['Expérience', 'true'], ['Possessions et notes', 'false']]);
    const figures = panel.element.all().filter(node => node.tagName === 'dd').map(node => node.textContent);
    assert.deepEqual(figures, ['500', '50', '450']);
    const items = panel.element.all().filter(node => node.tagName === 'li');
    assert.equal(items.length, 2);
    assert.equal(items[0].byClass('m-journal-amount').textContent, '−50');
    assert.equal(items[1].byClass('m-journal-amount').textContent, '+500');
    const button = items[0].byClass('m-journal-cancel');
    assert.equal(items[1].byClass('m-journal-cancel'), undefined);
    button.dispatch('click');
    assert.equal(cancels[0][0], xpLogRows(data, engine, 'u1')[0].purchaseId);
    switches[1].dispatch('click');
    assert.deepEqual(switches.map(node => node.getAttribute('aria-pressed')), ['false', 'true']);

    // Annulé : barré et suffixé.
    const undone = engine.applyCommand(globalThis.structuredClone(data), {
        type: 'cancel', operationId: 'op-2', payload: { purchaseId: cancels[0][0] },
    }, PLAYER).data;
    context.state = { ...context.state, data: undone };
    panel.update();
    const rows = panel.element.all().filter(node => node.tagName === 'li');
    assert.equal(rows[1].byClass('m-journal-label').textContent, 'soc +2 (annulé)');
    assert.ok(rows[1].className.includes('m-journal-cancelled'));
    assert.equal(panel.element.all().filter(node => node.className === 'm-journal-cancel').length, 0);
    panel.destroy();
});

function cancelSetup({ online = true, execute, retry, pendingOperationId = null } = {}) {
    const documentRef = fakeDocument();
    const announces = [];
    const data = buy(sheet(), 'soc', 2, 'op-1');
    const context = {
        online, engine, state: { phase: 'ready', uid: 'u1', data, pendingOperationId },
        controller: {
            executeOnlineCommand: execute || (async () => ({ status: 'confirmed' })),
            retryPendingCommand: retry || (async () => ({ status: 'confirmed' })),
        },
    };
    const sheetRef = createCancelSheet({ documentRef, getContext: () => context, announce: message => announces.push(message) });
    const trigger = documentRef.createElement('button');
    const purchaseId = xpLogRows(data, engine, 'u1')[0].purchaseId;
    const el = sheetRef.element;
    return { documentRef, announces, context, sheet: sheetRef, trigger, purchaseId, el, confirm: () => el.all().find(node => /Annuler l’achat|Annulation en cours/u.test(node.textContent)) };
}

test('annulation : confirmation dans un volet, commande cancel avec l’identifiant, annonce', async () => {
    const sent = [];
    const setup = cancelSetup({ execute: async (type, payload) => { sent.push([type, payload]); return { status: 'confirmed' }; } });
    setup.sheet.open(setup.purchaseId, setup.trigger);
    assert.ok(setup.el.open);
    assert.equal(setup.el.byClass('m-purchase-nature').textContent, 'soc +2');
    assert.match(setup.el.byClass('m-purchase-formula').textContent, /remboursement de 50 XP/u);
    assert.equal(sent.length, 0, 'ouvrir n’annule rien');
    setup.confirm().dispatch('click');
    assert.ok(setup.confirm().disabled, 'un seul envoi');
    await sleep(0);
    assert.deepEqual(sent, [['cancel', { purchaseId: setup.purchaseId }]]);
    assert.ok(!setup.el.open);
    assert.deepEqual(setup.announces, ['soc +2 : achat annulé']);
    assert.equal(setup.documentRef.activeElement, setup.trigger);
});

test('annulation : hors ligne désactivée avec la raison, refus du serveur et réponse incertaine avec « Réessayer »', async () => {
    const offline = cancelSetup({ online: false });
    offline.sheet.open(offline.purchaseId, offline.trigger);
    assert.ok(offline.confirm().disabled);
    assert.equal(offline.el.byClass('m-purchase-reason').textContent, 'Annulation possible une fois en ligne');

    const refused = cancelSetup({ execute: async () => { throw Object.assign(new Error('x'), { code: 'failed-precondition', details: { kind: 'purchase-not-reversible' } }); } });
    refused.sheet.open(refused.purchaseId, refused.trigger);
    refused.confirm().dispatch('click');
    await sleep(0);
    assert.ok(refused.el.open);
    assert.equal(refused.el.byClass('m-purchase-error').textContent, 'Cet achat ne peut plus être annulé.');
    assert.deepEqual(refused.announces, []);

    let executed = 0;
    let retried = 0;
    const uncertain = cancelSetup({
        execute: async () => { executed += 1; throw Object.assign(new Error('x'), { code: 'unavailable' }); },
        retry: async () => { retried += 1; return { status: 'confirmed' }; },
    });
    uncertain.sheet.open(uncertain.purchaseId, uncertain.trigger);
    uncertain.confirm().dispatch('click');
    await sleep(0);
    uncertain.context.state = { ...uncertain.context.state, pendingOperationId: 'op-9' };
    uncertain.sheet.update();
    assert.match(uncertain.el.byClass('m-purchase-error').textContent, /incertaine/u);
    uncertain.el.byText('Réessayer').dispatch('click');
    await sleep(0);
    assert.deepEqual([executed, retried], [1, 1], 'la reprise rejoue la commande en attente sans en créer une autre');
    assert.ok(!uncertain.el.open);
});

test('import MJ : motif de 3 caractères minimum, migration puis commande import avec les clés filtrées', async () => {
    const documentRef = fakeDocument();
    const sent = [];
    const announces = [];
    const context = {
        online: true, charId: 'test', state: { phase: 'ready' },
        controller: { executeOnlineCommand: async (type, payload) => { sent.push([type, payload]); return { status: 'confirmed' }; } },
    };
    const importSheet = createImportSheet({ documentRef, getContext: () => context, announce: message => announces.push(message) });
    const file = { fileName: 'fiche-test.json', data: { ...sheet(), nom: 'Ilsa' } };
    importSheet.open(file, documentRef.createElement('button'));
    const el = importSheet.element;
    const confirm = () => el.all().find(node => /Importer$|Import en cours/u.test(node.textContent) && node.tagName === 'button');
    const reason = el.all().find(node => node.tagName === 'input');
    assert.ok(confirm().disabled);
    assert.match(el.byClass('m-purchase-reason').textContent, /Motif requis/u);
    reason.value = ' ab ';
    reason.dispatch('input');
    assert.ok(confirm().disabled, '2 caractères utiles : refusé');
    reason.value = ' Reprise de fiche ';
    reason.dispatch('input');
    assert.ok(!confirm().disabled);
    confirm().dispatch('click');
    await sleep(10);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][0], 'import');
    assert.equal(sent[0][1].reason, 'Reprise de fiche');
    assert.equal(sent[0][1].data.nom, 'Ilsa');
    assert.ok(Object.keys(sent[0][1].data).every(key => FICHE_EXPORT_KEYS.includes(key)));
    assert.deepEqual(announces, ['Import confirmé par le serveur.']);
    assert.ok(!el.open);
});

test('téléchargement : Blob, lien temporaire avec le nom de fichier, adresse révoquée', async () => {
    const documentRef = fakeDocument();
    const appended = [];
    documentRef.body = { append: link => appended.push(link) };
    const revoked = [];
    const original = [URL.createObjectURL, URL.revokeObjectURL];
    let blob = null;
    URL.createObjectURL = value => { blob = value; return 'blob:fiche'; };
    URL.revokeObjectURL = url => revoked.push(url);
    try {
        const link = { href: '', download: '', clicked: 0, click() { this.clicked += 1; }, remove() { appended.pop(); } };
        documentRef.createElement = () => link;
        downloadJson(documentRef, 'fiche-test-2026-10-06.json', '{"a":1}');
        assert.equal(link.href, 'blob:fiche');
        assert.equal(link.download, 'fiche-test-2026-10-06.json');
        assert.equal(link.clicked, 1);
        assert.equal(appended.length, 0, 'le lien temporaire est retiré');
        assert.equal(await blob.text(), '{"a":1}');
        assert.equal(blob.type, 'application/json');
        await sleep(1100);
        assert.deepEqual(revoked, ['blob:fiche']);
    } finally {
        [URL.createObjectURL, URL.revokeObjectURL] = original;
    }
});

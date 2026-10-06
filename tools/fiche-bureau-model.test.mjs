import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { purchasePayload } from '../js/mobile/fiche-purchase.js';
import { xpBalance } from '../js/fiche/derived.js';
import { bureauSkills, inspectorModel, missingChips, roleControls, correctionChanges, correctionOverlay, correctionMatches } from '../js/fiche-bureau/model.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();
const { careers } = catalogue;
const keys = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const data = (extra = {}) => ({ nom: 'Personnage test', race: 'humain', carriere: 'Agitateur', rang: '1',
    basicSpecs: {}, chosenVariants: {}, careerOverrides: {}, carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: 3 }])),
    skillsBasic: { Charme: 3, Esquive: 0 }, skillsAdvanced: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [], careers: [],
    xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: 5000 }], ...extra });
const ready = { phase: 'ready', role: 'joueur' };

function apply(d, spec, n = 1, role = 'joueur') {
    const model = inspectorModel(d, engine, careers, spec, { ...ready, role }, true, n);
    assert.ok(model?.enabled, JSON.stringify(spec));
    const result = engine.applyCommand(d, { type: 'purchase', operationId: globalThis.crypto.randomUUID(), payload: purchasePayload(model.target, n, engine) }, { uid: 'test', role });
    assert.equal(result.result.cost, model.preview.cost);
    assert.equal(xpBalance(result.data).libre, xpBalance(d).libre - model.preview.cost);
    return result.data;
}

test('inspecteur : sélection, coût, total et débit identiques au moteur', () => {
    const d = data();
    const carac = inspectorModel(d, engine, careers, { kind: 'carac', key: 'soc' }, ready, true, 2);
    assert.equal(carac.target.title, 'Sociabilité');
    assert.equal(carac.preview.newTotal, 35);
    apply(d, { kind: 'carac', key: 'soc' }, 2);
    const skill = bureauSkills(d, engine, careers).find(row => row.nom === 'Charme');
    apply(d, { ...skill, kind: 'skill' });
    apply(d, { kind: 'talent', nom: 'Sociable' });
    apply(d, { kind: 'sort', nom: engine.ruleCatalog.spells.find(rule => /mineur/iu.test(rule.type)).nom });
    apply(d, { kind: 'miracle', nom: engine.ruleCatalog.miracles[0].nom });
    apply(d, { kind: 'rank', rankMode: 'advanceRank' });
});

test('fusion : entraînées d’abord, recherche multi-mots sans accents et compétences avancées manquantes', () => {
    const d = data();
    const rows = bureauSkills(d, engine, careers);
    assert.equal(rows[0].adv > 0, true);
    assert.ok(rows.some(row => row.newName && row.inCareer && row.adv === 0));
    const found = bureauSkills(d, engine, careers, { query: 'resistance alc' });
    assert.ok(found.some(row => /alcool/iu.test(row.nom)));
    for (const row of rows.filter(row => row.newName)) {
        const target = inspectorModel(d, engine, careers, { ...row, kind: 'skill' }, ready, true);
        assert.ok(target, row.nom);
    }
});

test('les puces de jauges adressent leur achat et disparaissent après satisfaction', () => {
    const d = data();
    const chips = missingChips(d, engine, careers);
    assert.equal(chips[0].length, 3);
    assert.ok(chips[1].length > 0 && chips[2].length > 0);
    const updated = apply(d, chips[0][0].spec, 2);
    assert.equal(missingChips(updated, engine, careers)[0].length, chips[0].length - 1);
    apply(d, chips[1].find(chip => !chip.spec.newName).spec);
    apply(d, chips[2][0].spec);
});

test('achat désactivé : hors ligne, XP insuffisante, lecture seule et commande en attente', () => {
    const spec = { kind: 'carac', key: 'soc' };
    assert.match(inspectorModel(data(), engine, careers, spec, ready, false).reason, /une fois en ligne/u);
    assert.match(inspectorModel(data({ xpLog: [] }), engine, careers, spec, ready, true).reason, /Il manque/u);
    for (const phase of ['legacy-readonly', 'tombstone', 'command-pending', 'saving']) assert.equal(inspectorModel(data(), engine, careers, spec, { ...ready, phase }, true).enabled, false);
    assert.equal(inspectorModel(data(), engine, careers, spec, { ...ready, hasDraft: true }, true).enabled, false);
});

test('talent au choix : achat bloqué avant choix puis nom composé accepté', () => {
    const d = data({ rang: '4' });
    const spec = { kind: 'talent', nom: 'Savoir-vivre (au choix)' };
    assert.match(inspectorModel(d, engine, careers, spec, ready, true).reason, /spécialité/u);
    const updated = apply(d, { ...spec, pick: 'Guilde' });
    assert.ok(updated.talentsAcq.some(row => row.nom === 'Savoir-vivre (Guilde)'));
});

test('contrôles de rôle : joueur sans commandes MJ, lecture seule sans modification', () => {
    assert.deepEqual(roleControls(ready), { editable: true, mj: false, actions: false });
    assert.deepEqual(roleControls({ ...ready, role: 'mj' }), { editable: true, mj: true, actions: true });
    assert.equal(roleControls({ ...ready, phase: 'legacy-readonly' }).editable, false);
    assert.equal(roleControls({ ...ready, role: 'readonly' }).editable, false);
});

test('corrections bureau : batch existant accepté sans dépenser d’XP', () => {
    const d = data({ talentsAcq: [{ id: 'talent1', nom: 'Sociable', note: '' }] });
    const changes = [
        ...correctionChanges(d, { kind: 'identity' }, { nom: 'Nouveau nom', race: 'nain' }),
        ...correctionChanges(d, { kind: 'carac', key: 'soc' }, { base: '40', adv: '5' }),
        ...correctionChanges(d, { kind: 'skill', row: 'Charme' }, { adv: '8' }),
        ...correctionChanges(d, { kind: 'talent', nom: 'Sociable' }, { taken: '0' }),
    ];
    const applied = engine.applyCommand(d, { type: 'correct', operationId: 'test-correction', payload: { kind: 'batch', reason: 'Test bureau', changes } }, { uid: 'test', role: 'mj' });
    assert.equal(applied.data.nom, 'Nouveau nom');
    assert.equal(applied.data.carac.soc.base, 40);
    assert.equal(applied.data.skillsBasic.Charme, 8);
    assert.equal(applied.data.talentsAcq.length, 0);
    assert.equal(xpBalance(applied.data).libre, xpBalance(d).libre);
});


test('lot MJ : aperçu des corrections et remplacement d’une cible sans cumuler les prises', () => {
    const d = data();
    const spec = { kind: 'talent', nom: 'Sociable' };
    const first = correctionChanges(d, spec, { taken: '2' });
    assert.equal(correctionOverlay(d, first).talentsAcq.length, 2);
    const remaining = first.filter(item => !correctionMatches(item, d, spec));
    const updated = [...remaining, ...correctionChanges(d, spec, { taken: '1' })];
    assert.equal(correctionOverlay(d, updated).talentsAcq.length, 1);
    assert.equal(d.talentsAcq.length, 0);
    assert.equal(xpBalance(correctionOverlay(d, updated)).libre, 5000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { armourProtection, equipmentFormula, applyEquipmentCommand, validateEquipmentItem } from '../js/fiche/equipment.js';
import { buildFicheExport, parseFicheImport } from '../js/fiche/export-import.js';

const catalogue = JSON.parse(readFileSync(new URL('../js/data/equipment-catalog.json', import.meta.url), 'utf8'));
const get = (name, category) => globalThis.structuredClone(catalogue.items.find(item => item.name === name && (!category || item.category === category)));
const data = { carac: { f: { base: 31, adv: 9 } }, xpLog: [{ id: 'xp', kind: 'gain', montant: 200 }], nom: 'Test' };
const body = result => result.locations.find(location => location.id === 'body');

test('catalogue : profils complets validés, identités uniques et portée absente explicite', () => {
    assert.equal(catalogue.items.length, 213);
    assert.equal(catalogue.keywords.length, 55);
    assert.equal(new Set(catalogue.items.map(item => item.id)).size, catalogue.items.length);
    for (const item of catalogue.items) assert.equal(validateEquipmentItem(item, catalogue), item);
    assert.equal(get('Javelot').range, 'BF × 3');
    assert.equal(get('Bombe Cinderblast').range, 'BF');
    assert.equal(get('Globe de Vent Empoisonné Skaven').range, '');
    assert.equal(get('Targe (Buckler)').ap, 1);
    assert.equal(get('Targe (Buckler)').damage, 'BF + 2');
    assert.deepEqual([get('Pavois (Pavise)').damage, get('Pavois (Pavise)').reach], ['', '']);
    assert.equal(catalogue.items.filter(item => item.kind === 'ammunition' && item.source.startsWith('Livre de base')).length, 8);
    assert.deepEqual(get('Flèches elfiques (12)').keywords.map(word => word.id), ['precise', 'empaleuse', 'perforante']);
    for (const source of Object.values(catalogue.sources)) assert.match(source.sha256, /^[0-9a-f]{64}$/u);
});

test('dégâts et portée : BF actuel, constantes, variantes et texte spécial sans exécution', () => {
    assert.equal(equipmentFormula('=+BF +4', data).value, 8);
    assert.equal(equipmentFormula('BF × 3', data).value, 12);
    assert.equal(equipmentFormula('BF +6*', data).label, 'BF +6* = 10');
    assert.equal(equipmentFormula('+9', data).value, 9);
    assert.equal(equipmentFormula('+9', data).label, '+9');
    assert.equal(equipmentFormula('+0', data).label, '+0');
    assert.equal(equipmentFormula('40', data).label, '40');
    assert.equal(equipmentFormula('Spécial', data).value, null);
    assert.equal(equipmentFormula('BF + globalThis.alert(1)', data).value, null);
    assert.equal(equipmentFormula('+9 / +12', data).value, null);
});

test('armure : cuir, maille, plates donnent 5 PA uniquement sur leurs zones communes', () => {
    const result = armourProtection([get('Veste de cuir'), get('Cotte de mailles'), get('Plastron', 'Plates')]);
    assert.equal(body(result).ap, 5);
    assert.equal(result.locations.find(zone => zone.id === 'rightArm').ap, 3);
    assert.equal(result.locations.find(zone => zone.id === 'leftArm').ap, 3);
    assert.equal(result.locations.find(zone => zone.id === 'head').ap, 0);
    assert.deepEqual(body(result).counted.map(item => item.ap), [1, 2, 2]);
});

test('armure : meilleur cumul légal, pièces non comptées, bonus unique et bouclier séparé', () => {
    const result = armourProtection([get('Justaucorps de cuir'), get('Veste de cuir'), get('Chemise de mailles'), get('Cotte de mailles'),
        get('Plastron', 'Plates'), get('Plastron', 'Gromril (nain)'), get('Heaume du Kraken'), { ...get('Heaume du Kraken'), id: 'other' }, get('Bouclier'), get('Grand Bouclier')]);
    assert.equal(body(result).ap, 8);
    assert.equal(body(result).ignored.length, 4);
    assert.equal(result.shield.ap, 3);
    assert.equal(result.locations.find(zone => zone.id === 'head').ap, 2);
});

test('les défauts conditionnels sont conservés sans retirer définitivement les PA', () => {
    const result = armourProtection([get('Coiffe de mailles'), get('Heaume', 'Plates')]);
    const head = result.locations.find(zone => zone.id === 'head');
    assert.equal(head.ap, 4);
    assert.equal(head.conditional.length, 2);
});

test('commandes MJ : copies personnalisables, conflits refusés, XP et autres champs conservés', () => {
    const command = { operationId: 'op_add', payload: { action: 'add', item: get('Hallebarde (2M)'), reason: 'Ajout d’arme' } };
    assert.throws(() => applyEquipmentCommand(data, command, { role: 'joueur' }, catalogue), { code: 'permission-denied' });
    const added = applyEquipmentCommand(data, command, { role: 'mj' }, catalogue);
    assert.equal(added.data.equipment[0].id, 'op_add:equipment');
    assert.deepEqual(added.data.xpLog, data.xpLog);
    assert.equal(data.equipment, undefined);
    command.payload.item.keywords.push({ id: 'solide', parameter: '9' });
    assert.equal(added.data.equipment[0].keywords.some(word => word.id === 'solide' && word.parameter === '9'), false);
    const before = added.data.equipment[0];
    const edited = applyEquipmentCommand(added.data, { operationId: 'op_edit', payload: { action: 'update', id: before.id, before, item: { ...before, name: 'Lame solaire', damage: 'BF + 5', custom: true } } }, { role: 'mj' }, catalogue);
    assert.equal(edited.data.equipment[0].name, 'Lame solaire');
    assert.throws(() => applyEquipmentCommand(edited.data, { operationId: 'op_stale', payload: { action: 'remove', id: before.id, before } }, { role: 'mj' }, catalogue), { code: 'aborted' });
    assert.throws(() => validateEquipmentItem({ ...before, keywords: [{ id: 'Mot inventé', parameter: '' }] }, catalogue), { code: 'invalid-argument' });
    assert.throws(() => validateEquipmentItem({ ...before, keywords: [{ id: 'retire', parameter: 'x'.repeat(101) }] }, catalogue), { code: 'invalid-argument' });
    assert.throws(() => validateEquipmentItem({ ...before, keywords: [{ id: 'empaleuse', parameter: '2' }] }, catalogue), { code: 'invalid-argument' });
    // Un mot clé retiré du référentiel reste porté par l'objet, à l'édition comme à l'export.
    const current = edited.data.equipment[0];
    assert.throws(() => applyEquipmentCommand(edited.data, { operationId: 'op_invented', payload: { action: 'update', id: before.id, before: current, item: { ...current, keywords: [{ id: 'ancien-mot', parameter: '3' }] } } }, { role: 'mj' }, catalogue), { code: 'invalid-argument' });
    const legacy = { ...current, keywords: [{ id: 'ancien-mot', parameter: '3' }] };
    const legacyData = { ...edited.data, equipment: [legacy] };
    const retired = applyEquipmentCommand(legacyData, { operationId: 'op_retired', payload: { action: 'update', id: before.id, before: legacy, item: { ...legacy, name: 'Lame ancienne' } } }, { role: 'mj' }, catalogue);
    assert.deepEqual(retired.data.equipment[0].keywords, legacy.keywords);
    const exported = buildFicheExport(retired.data, { charId: 'test', exportedAt: '2026-10-07' });
    assert.deepEqual(parseFicheImport(JSON.stringify(exported)).data.equipment, retired.data.equipment);
});

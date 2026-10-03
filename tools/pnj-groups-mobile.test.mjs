import assert from 'node:assert/strict';
import test from 'node:test';
import { createPnjListModel } from '../js/mobile/pnj-list-model.js';
import { createPublicDraftStore } from '../js/mobile/drafts-store.js';
import { defaultPnjFormValues, normalizePnjFormValues, validatePnjForm } from '../js/mobile/views/pnj-edit.js';
import { selectPnjDetailModel } from '../js/mobile/pnj-detail-model.js';

function memoryStorage() {
    const data = new Map();
    return { get length() { return data.size; }, key: index => [...data.keys()][index] ?? null,
        getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key) };
}

const item = (id, fields = {}) => ({ id, nom: id, visibleJoueurs: true, ...fields });

test('les filtres mobiles trouvent chaque appartenance; les cartes de détail exposent les groupes cumulés', () => {
    const pnjs = [item('a', { groupes: ['Compagnie du Loup', 'Garde'] }), item('b', { groupe: 'Marchands' })];
    const state = createPnjListModel({ items: pnjs, filters: { groupe: ['Garde'] } }).getState();
    assert.deepEqual(state.results.map(pnj => pnj.id), ['a']);
    const detail = selectPnjDetailModel({ resources: {
        pnjs: { status: 'ready', items: [pnjs[0]] }, relations: { status: 'ready', items: [] }, indices: { status: 'ready', items: [] },
    }, connection: { phase: 'ready' } }, 'a');
    assert.deepEqual(detail.groupes, ['Compagnie du Loup', 'Garde']);
    assert.equal(detail.context, 'Compagnie du Loup, Garde');
});

test('les variantes de casse et accents d’un groupe partagent filtre et facette', () => {
    const pnjs = [item('a', { groupes: ['École'] }), item('b', { groupes: ['ecole'] })];
    const model = createPnjListModel({ items: pnjs, filters: { groupe: ['éCOLE'] } }).getState();
    assert.deepEqual(model.facets.groupe, ['École']);
    assert.deepEqual(model.filters.groupe, ['École']);
    assert.deepEqual(model.results.map(pnj => pnj.id), ['a', 'b']);
});

test('les groupes mobiles survivent aux brouillons allowlistés et restent rétrocompatibles avec groupe', () => {
    let time = 1000;
    const drafts = createPublicDraftStore({ storage: memoryStorage(), now: () => time++ });
    const values = normalizePnjFormValues({ ...defaultPnjFormValues(), nom: 'Ada', groupe: 'Garde', groupes: ['Garde', 'Compagnie'] });
    assert.deepEqual(values.groupes, ['Garde', 'Compagnie']);
    assert.equal(validatePnjForm(values).valid, true);
    const saved = drafts.save({ ...values, notes: 'secret MJ', imagePath: 'private/path' }, { pnjId: 'ada' });
    assert.equal(saved.ok, true);
    assert.deepEqual(drafts.find('ada').values.groupes, ['Garde', 'Compagnie']);
    assert.equal(Object.hasOwn(drafts.find('ada').values, 'notes'), false);
    assert.equal(drafts.save({ nom: 'Ada', groupes: Array(21).fill('Groupe') }).ok, false);
    assert.equal(validatePnjForm({ ...values, groupes: Array(21).fill('Groupe') }).valid, false);
    assert.deepEqual(normalizePnjFormValues({ ...values, groupes: [] }).groupes, []);
    assert.equal(normalizePnjFormValues({ ...values, groupes: [] }).groupe, '');
    assert.equal(Object.isFrozen(saved.draft.values.groupes), true);
});

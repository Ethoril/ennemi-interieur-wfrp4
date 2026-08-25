import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPnjFacets, createPnjListModel, filterPnjs, foldSearchText, reconcilePnjFilters, sortPnjs } from '../js/mobile/pnj-list-model.js';

const pnj = (id, overrides = {}) => ({ id, nom: `PNJ ${id}`, visibleJoueurs: true, ...overrides });

test('la recherche plie accents, casse, espaces et apostrophes sur les champs publics utiles', () => {
    assert.equal(foldSearchText("L’Épée d'Azúr"), 'lepee dazur');
    const item = pnj('a', { nom: 'L’Épée', surnom: 'La Renarde', rôle: 'Éclaireuse', profession: 'Cartographe', lieu: 'Altdorf', groupes: ['Les Loups'] });
    assert.equal(filterPnjs([item], { search: 'epee' }).length, 1);
    assert.equal(filterPnjs([item], { search: 'renarde' }).length, 1);
    assert.equal(filterPnjs([item], { search: 'eclaireuse' }).length, 1);
    assert.equal(filterPnjs([item], { search: 'cartographe' }).length, 1);
    assert.equal(filterPnjs([item], { search: 'ALTDORF' }).length, 1);
    assert.equal(filterPnjs([item], { search: 'loups' }).length, 1);
});

test('le tri est numérique puis nom plié puis identifiant, avec ordre absent en dernier', () => {
    const sorted = sortPnjs([
        pnj('z', { nom: 'Émile', ordre: 2 }),
        pnj('a', { nom: 'Émile', ordre: 2 }),
        pnj('b', { nom: 'Abe', ordre: 2 }),
        pnj('c', { nom: 'Premier', ordre: 1 }),
        pnj('d', { nom: 'Sans ordre', ordre: Number.NaN }),
    ]);
    assert.deepEqual(sorted.map(item => item.id), ['c', 'b', 'a', 'z', 'd']);
    assert.deepEqual(sorted.map(item => item.id), sortPnjs([...sorted]).map(item => item.id));
});

test('les facettes acceptent groupe string/tableau, restent stables et les filtres combinent dimensions avec union locale', () => {
    const items = [
        pnj('a', { groupe: 'Nord', statut: 'vivant', lieu: 'Altdorf' }),
        pnj('b', { groupes: ['Nord', 'Garde'], statut: 'absent', lieu: 'Middenheim' }),
        pnj('c', { groupe: 'Sud', statut: 'vivant', lieu: 'Altdorf' }),
    ];
    const facets = buildPnjFacets(items);
    assert.deepEqual(facets.groupe, ['Garde', 'Nord', 'Sud']);
    assert.deepEqual(facets.statut, ['absent', 'vivant']);
    const model = createPnjListModel({ items, filters: { groupe: ['Nord', 'Sud'], statut: ['vivant'], lieu: ['Altdorf'] } });
    assert.deepEqual(model.getState().results.map(item => item.id), ['a', 'c']);
    assert.equal(model.getState().activeFilterCount, 4);
    assert.deepEqual(model.getState().filters, { groupe: ['Nord', 'Sud'], statut: ['vivant'], lieu: ['Altdorf'] });
});

test('la réconciliation retire les choix disparus et distingue aucun publié d aucun résultat', () => {
    const model = createPnjListModel({ items: [pnj('a', { groupe: 'Nord' })], filters: { groupe: ['Nord'] } });
    assert.equal(model.getState().emptyState, null);
    model.setItems([]);
    assert.equal(model.getState().emptyState, 'no-published');
    assert.deepEqual(model.getState().filters, { groupe: [], statut: [], lieu: [] });
    model.setItems([pnj('b', { groupe: 'Sud' })]);
    model.setSearch('inexistant');
    assert.equal(model.getState().emptyState, 'no-results');
    assert.deepEqual(model.getState().filters.groupe, []);
    assert.deepEqual(reconcilePnjFilters({ groupe: ['Nord'] }, buildPnjFacets([pnj('b', { groupe: 'Sud' })])), { groupe: [], statut: [], lieu: [] });
});

test('le modèle reste utilisable pour 0, 1, 50 et 500+ PNJ sans muter les entrées', () => {
    for (const count of [0, 1, 50, 501]) {
        const source = Array.from({ length: count }, (_, index) => pnj(`p-${index}`, { ordre: index, description: { hostile: true } }));
        const model = createPnjListModel({ items: source });
        assert.equal(model.getState().items.length, count);
        assert.ok(Object.isFrozen(model.getState().items));
        assert.ok(Object.isFrozen(model.getState().results));
        if (count) assert.ok(Object.isFrozen(model.getState().items[0]));
        assert.equal(source.length, count);
        assert.equal(source[0]?.nom, count ? 'PNJ p-0' : undefined);
    }
});

test('valeurs hostiles sont ignorées sans exception et ne contaminent ni facettes ni résultats', () => {
    const hostile = [null, 4, { id: { toString: () => { throw new Error('piège'); } } }, pnj('safe', { groupe: ['Nord', 4, null], statut: { bad: true }, lieu: Symbol('lieu'), nom: 'Sûr' })];
    assert.doesNotThrow(() => createPnjListModel({ items: hostile, search: { toString: () => { throw new Error('piège'); } }, filters: { groupe: [4, null, 'Nord'], statut: [{ bad: true }] } }));
    const state = createPnjListModel({ items: hostile }).getState();
    assert.deepEqual(state.facets.groupe, ['Nord']);
    assert.deepEqual(state.facets.statut, []);
    assert.equal(state.results.length, 1);
});

test('les mises à jour de recherche et de filtres sont des sorties immuables et comptent les dimensions actives', () => {
    const model = createPnjListModel({ items: [pnj('a', { groupe: 'Nord', statut: 'vivant' })] });
    const next = model.setSearch('nord');
    assert.equal(next.results.length, 1, 'la recherche inclut les groupes publics');
    const filtered = model.setFilters({ groupe: ['Nord'], statut: ['vivant'] });
    assert.equal(filtered.results.length, 1);
    assert.equal(filtered.activeFilterCount, 2);
    assert.throws(() => { filtered.filters.groupe.push('Sud'); }, TypeError);
    assert.deepEqual(model.clearFilters().filters, { groupe: [], statut: [], lieu: [] });
});

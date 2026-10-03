import test from 'node:test';
import assert from 'node:assert/strict';
import { groupCatalog, groupKey, groupLabel, matchesGroupFilter, normalizeGroups, pnjGroups } from '../js/pnj-groups.js';
import { normalizePnjPublic } from '../js/data/firebase-normalizers.js';
import { createMjPnjRepository } from '../js/data/pnjs-repository.js';
import { ERROR_KINDS } from '../js/data/firebase-errors.js';

function makeFirestore() {
    const data = new Map();
    const key = (collection, id) => `${collection}/${id}`;
    const sdk = {
        collection: (_db, collection) => ({ collection }),
        doc: (_db, collection, id) => ({ collection, id }),
        serverTimestamp: () => ({ seconds: 1, nanoseconds: 0 }),
        writeBatch: () => {
            const writes = [];
            return {
                set: (ref, value) => writes.push(() => data.set(key(ref.collection, ref.id), { ...value })),
                commit: async () => writes.forEach(write => write()),
            };
        },
        runTransaction: async (_db, callback) => {
            const writes = [];
            const tx = {
                get: async ref => ({ exists: () => data.has(key(ref.collection, ref.id)), data: () => data.get(key(ref.collection, ref.id)) }),
                update: (ref, value) => writes.push(() => data.set(key(ref.collection, ref.id), { ...data.get(key(ref.collection, ref.id)), ...value })),
                set: (ref, value) => writes.push(() => data.set(key(ref.collection, ref.id), { ...value })),
            };
            const result = await callback(tx);
            writes.forEach(write => write());
            return result;
        },
    };
    return { sdk, client: { db: {}, isGM: true }, data };
}

test('groupes nettoyés, dédoublés sans casse ni accents et labels du catalogue réutilisés', () => {
    assert.equal(groupKey('  École   du   Nord '), 'ecole du nord');
    assert.deepEqual(normalizeGroups(['Guilde', ' guilde ', 'ECOLE', 'École'], ['École']), ['Guilde', 'École']);
    assert.deepEqual(pnjGroups({ groupe: '  Vieux   Monde ' }), ['Vieux Monde']);
    assert.deepEqual(pnjGroups({ groupe: 'Legacy', groupes: [] }), []);
    assert.deepEqual(groupCatalog([{ groupes: ['École'] }, { groupe: 'ecole' }, { groupe: 'Guilde' }]), ['École', 'Guilde']);
    assert.equal(groupLabel({ groupes: ['Guilde', 'École'] }), 'Guilde, École');
    assert.equal(matchesGroupFilter({ groupes: ['ecole', 'Garde'] }, new Set(['École'])), true);
    assert.equal(matchesGroupFilter({ groupe: ' GÁRDE ' }, ['garde']), true);
    assert.equal(matchesGroupFilter({ groupes: [] }, ['Garde']), false);
    assert.equal(matchesGroupFilter({ groupe: 'Garde' }, []), true);
});

test('normalizer lit le legacy et rend le miroir cohérent, y compris la liste vide', () => {
    const legacy = normalizePnjPublic({ id: 'old', data: { groupe: '  Vieille  ville ' } });
    assert.deepEqual(legacy.groupes, ['Vieille ville']);
    assert.equal(legacy.groupe, 'Vieille ville');
    const canonical = normalizePnjPublic({ id: 'new', data: { groupe: 'incorrect', groupes: ['Guilde', ' École  du Nord '] } });
    assert.deepEqual(canonical.groupes, ['Guilde', 'École du Nord']);
    assert.equal(canonical.groupe, 'Guilde');
    assert.deepEqual(normalizePnjPublic({ id: 'clear', data: { groupe: 'old', groupes: [] } }).groupes, []);
    assert.equal(normalizePnjPublic({ id: 'clear', data: { groupe: 'old', groupes: [] } }).groupe, '');
});

test('repository synchronizes canonical and legacy writes, honors explicit clear and protects bounds', async () => {
    const fake = makeFirestore();
    const repo = createMjPnjRepository(fake);
    await repo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true, groupe: 'Ancienne' });
    assert.deepEqual(fake.data.get('pnjs/a').groupes, ['Ancienne']);
    await repo.update('a', { groupes: [' Guilde  locale ', 'École', 'guilde locale'] });
    assert.deepEqual(fake.data.get('pnjs/a').groupes, ['Guilde locale', 'École']);
    assert.equal(fake.data.get('pnjs/a').groupe, 'Guilde locale');
    await repo.update('a', { groupe: 'Nouveau primaire' });
    assert.deepEqual(fake.data.get('pnjs/a').groupes, ['Nouveau primaire', 'Guilde locale', 'École']);
    await repo.update('a', { groupes: [] });
    assert.deepEqual(fake.data.get('pnjs/a').groupes, []);
    assert.equal(fake.data.get('pnjs/a').groupe, '');
    fake.data.set('pnjs/legacy', { nom: 'Legacy', visibleJoueurs: true, groupe: 'Ancien' });
    await repo.update('legacy', { groupe: 'Remplacé' });
    assert.deepEqual(fake.data.get('pnjs/legacy').groupes, ['Remplacé']);
    await repo.update('legacy', { groupe: '' });
    assert.deepEqual(fake.data.get('pnjs/legacy').groupes, ['Remplacé']);
    await assert.rejects(repo.update('a', { groupes: 'pas-un-tableau' }), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.update('a', { groupes: Array(21).fill('Groupe') }), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.update('a', { groupes: ['   '] }), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.update('a', { groupes: ['x'.repeat(201)] }), error => error.kind === ERROR_KINDS.VALIDATION);
});

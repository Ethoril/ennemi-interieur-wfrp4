import test from 'node:test';
import assert from 'node:assert/strict';
import { createMjPnjRepository, createPublicPnjRepository } from '../js/data/pnjs-repository.js';
import { createMjRelationsRepository, createPublicRelationsRepository } from '../js/data/relations-repository.js';
import { ERROR_KINDS } from '../js/data/firebase-errors.js';

function makeFirestore() {
    const state = {
        collections: new Map(), subscriptions: [], nextId: 0, batchCommits: 0,
        failBatchCommitAt: null, getDocsCalls: 0, afterSnapshotGetDocs: null, lastTransactionOperations: [],
        transactionRelationCounts: [],
    };
    const collectionMap = name => {
        if (!state.collections.has(name)) state.collections.set(name, new Map());
        return state.collections.get(name);
    };
    const snap = (ref, data) => ({
        id: ref.id,
        exists: () => data !== undefined,
        data: () => data === undefined ? undefined : { ...data },
        metadata: { fromCache: false, hasPendingWrites: false },
    });
    const applyValue = (value, previous) => {
        if (value?.__serverTimestamp) return { seconds: 1, nanoseconds: 0 };
        if (value?.__arrayRemove !== undefined) return (Array.isArray(previous) ? previous : []).filter(item => item !== value.__arrayRemove);
        return value;
    };
    const applySet = (ref, data, merge = false) => {
        const old = collectionMap(ref.collection).get(ref.id) ?? {};
        const next = merge ? { ...old } : {};
        for (const [key, value] of Object.entries(data)) next[key] = applyValue(value, old[key]);
        collectionMap(ref.collection).set(ref.id, next);
    };
    const applyUpdate = (ref, data) => {
        if (!collectionMap(ref.collection).has(ref.id)) throw new Error('not-found');
        applySet(ref, data, true);
    };
    const sdk = {
        collection: (_db, name) => ({ kind: 'collection', name }),
        doc: (...args) => {
            if (args.length === 1) return { kind: 'doc', collection: args[0].name, id: `auto-${++state.nextId}` };
            return { kind: 'doc', collection: args[1], id: args[2] };
        },
        where: (field, operator, value) => ({ field, operator, value }),
        documentId: () => '__name__',
        query: (collection, ...constraints) => ({ kind: 'query', collection, constraints }),
        serverTimestamp: () => ({ __serverTimestamp: true }),
        arrayRemove: value => ({ __arrayRemove: value }),
        getDoc: async ref => snap(ref, collectionMap(ref.collection).get(ref.id)),
        updateDoc: async (ref, data) => applyUpdate(ref, data),
        getDocs: async target => {
            const collection = target.collection ?? target;
            state.getDocsCalls += 1;
            const result = { docs: [...collectionMap(collection.name).entries()].map(([id, data]) => snap({ id }, data)), metadata: { fromCache: false, hasPendingWrites: false } };
            if (typeof state.afterSnapshotGetDocs === 'function') state.afterSnapshotGetDocs(target, state.getDocsCalls);
            return result;
        },
        onSnapshot: (target, optionsOrNext, nextOrError, maybeError) => {
            const hasOptions = optionsOrNext && typeof optionsOrNext === 'object';
            const options = hasOptions ? optionsOrNext : null;
            const next = hasOptions ? nextOrError : optionsOrNext;
            const error = hasOptions ? maybeError : nextOrError;
            const subscription = { target, options, next, error, active: true };
            state.subscriptions.push(subscription);
            return () => { subscription.active = false; };
        },
        writeBatch: () => {
            const operations = [];
            return {
                set: (ref, data, options) => operations.push(['set', ref, data, options]),
                update: (ref, data) => operations.push(['update', ref, data]),
                delete: ref => operations.push(['delete', ref]),
                commit: async () => {
                    state.batchCommits += 1;
                    if (state.failBatchCommitAt === state.batchCommits) throw new Error('cascade-failure-secret');
                    if (operations.some(([kind, ref]) => kind === 'update' && !collectionMap(ref.collection).has(ref.id))) {
                        throw new Error('not-found');
                    }
                    for (const [kind, ref, data, options] of operations) {
                        if (kind === 'set') applySet(ref, data, options?.merge === true);
                        else if (kind === 'update') applyUpdate(ref, data);
                        else collectionMap(ref.collection).delete(ref.id);
                    }
                },
            };
        },
        runTransaction: async (_db, callback) => {
            const operations = [];
            const transaction = {
                get: async ref => snap(ref, collectionMap(ref.collection).get(ref.id)),
                set: (ref, data, options) => operations.push(['set', ref, data, options]),
                update: (ref, data) => operations.push(['update', ref, data]),
                delete: ref => operations.push(['delete', ref]),
            };
            const result = await callback(transaction);
            state.lastTransactionOperations = operations;
            state.transactionRelationCounts.push(operations.filter(([kind, ref]) => kind === 'update' && ref.collection === 'relations').length);
            for (const [kind, ref, data, options] of operations) {
                if (kind === 'set') applySet(ref, data, options?.merge === true);
                else if (kind === 'update') applyUpdate(ref, data);
                else collectionMap(ref.collection).delete(ref.id);
            }
            return result;
        },
    };
    return { sdk, client: { db: {} }, state, collectionMap, snap };
}

function put(fake, collection, id, data) {
    fake.collectionMap(collection).set(id, { ...data });
}

function publicPnj(id, visibleJoueurs = true, extra = {}) {
    return { id, data: { nom: id, visibleJoueurs, suppressionEnCours: false, ...extra } };
}

test('les fabriques séparent public/MJ et les abonnements sont filtrés, ordonnés, dédoublés et désabonnables', () => {
    const fake = makeFirestore();
    const publicRepo = createPublicPnjRepository(fake);
    const mjRepo = createMjPnjRepository(fake);
    assert.equal('subscribePrivate' in publicRepo, false);
    assert.equal('create' in publicRepo, false);
    assert.equal(typeof mjRepo.subscribePrivate, 'function');
    const received = [];
    const unsubscribe = publicRepo.subscribeVisible((items, metadata) => received.push({ items, metadata }), error => { throw error; });
    const subscription = fake.state.subscriptions[0];
    assert.deepEqual(subscription.options, { includeMetadataChanges: true });
    assert.ok(subscription.target.constraints.some(item => item.field === 'visibleJoueurs' && item.value === true));
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: {} });
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: {} });
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].items.map(item => item.id), ['a', 'z']);
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: { fromCache: true } });
    assert.equal(received.length, 2);
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: { fromCache: false, hasPendingWrites: false } });
    assert.equal(received.length, 3, 'la confirmation serveur identique doit rester observable');
    unsubscribe();
    unsubscribe();
    subscription.next({ docs: [], metadata: {} });
    assert.equal(received.length, 3);

    publicRepo.subscribeOne('a', () => {}, error => { throw error; });
    const oneQuery = fake.state.subscriptions[1].target;
    assert.ok(oneQuery.constraints.some(item => item.field === '__name__' && item.value === 'a'));
});

test('le dépôt PNJ canonise les portraits legacy et marque les références invalides', () => {
    const fake = makeFirestore();
    const repo = createPublicPnjRepository(fake);
    const received = [];
    repo.subscribeVisible(items => received.push(items));
    fake.state.subscriptions[0].next({ docs: [
        publicPnj('safe', true, {
            imageUrl: 'https://storage.googleapis.com/campagne-wrpg.firebasestorage.app/portraits/safe/a.webp?token=secret',
        }),
        publicPnj('bad', true, {
            imageUrl: 'https://user:secret@storage.googleapis.com/campagne-wrpg.firebasestorage.app/portraits/bad/a.webp',
        }),
    ], metadata: {} });
    const items = received.at(-1);
    assert.equal(items.find(item => item.id === 'safe').imageUrl.endsWith('/a.webp'), true);
    assert.doesNotMatch(JSON.stringify(items), /token=|user:secret|secret/u);
    assert.equal(items.find(item => item.id === 'bad').imageUrl, null);
    assert.equal(items.find(item => item.id === 'bad').legacyImageInvalid, true);
});

test('subscribeOne et subscribePrivate émettent l’absence, dédupliquent et conservent les métadonnées', () => {
    const fake = makeFirestore();
    const repo = createMjPnjRepository(fake);
    const one = [];
    repo.subscribeOne('missing', (value, metadata) => one.push({ value, metadata }), error => { throw error; });
    const oneSubscription = fake.state.subscriptions[0];
    oneSubscription.next({ exists: () => false, data: () => undefined, id: 'missing', metadata: {} });
    oneSubscription.next({ exists: () => false, data: () => undefined, id: 'missing', metadata: {} });
    oneSubscription.next({ exists: () => false, data: () => undefined, id: 'missing', metadata: { fromCache: true } });
    assert.equal(one.length, 2);
    assert.equal(one[0].value, null);
    assert.equal(one[1].metadata.fromCache, true);

    const privateValues = [];
    repo.subscribePrivate('missing', (value, metadata) => privateValues.push({ value, metadata }), error => { throw error; });
    const privateSubscription = fake.state.subscriptions[1];
    privateSubscription.next({ exists: () => false, data: () => undefined, id: 'missing', metadata: {} });
    privateSubscription.next({ exists: () => false, data: () => undefined, id: 'missing', metadata: {} });
    assert.equal(privateValues.length, 1);
    assert.equal(privateValues[0].value, null);
});

test('le dépôt MJ signale seulement par booléen une coexistence modern/legacy', () => {
    const fake = makeFirestore(); const mj = createMjPnjRepository(fake); const publicRepo = createPublicPnjRepository(fake);
    const mjValues = []; mj.subscribeOne('a', value => mjValues.push(value), error => { throw error; });
    fake.state.subscriptions[0].next({ exists: () => true, id: 'a', data: () => ({ nom: 'A', visibleJoueurs: true, imagePath: 'portraits/a/new.webp', imageUrl: 'https://legacy.example/p.webp' }), metadata: {} });
    assert.equal(mjValues.at(-1).legacyImagePresent, true); assert.doesNotMatch(JSON.stringify(mjValues.at(-1)), /legacy\.example|p\.webp/u);
    const publicValues = []; publicRepo.subscribeOne('a', value => publicValues.push(value), error => { throw error; });
    fake.state.subscriptions[1].next({ exists: () => true, id: 'a', data: () => ({ nom: 'A', visibleJoueurs: true, imagePath: 'portraits/a/new.webp', imageUrl: 'https://legacy.example/p.webp' }), metadata: {} });
    assert.equal(Object.hasOwn(publicValues.at(-1), 'legacyImagePresent'), false);
});

test('les relations publiques filtrent les endpoints visibles et réémettent après changement de jeu PNJ', () => {
    const fake = makeFirestore();
    const repo = createPublicRelationsRepository({ ...fake, visiblePnjIds: ['a', 'b'] });
    const received = [];
    repo.subscribeVisible(items => received.push(items));
    const subscription = fake.state.subscriptions[0];
    subscription.next({ docs: [
        { id: 'r-hidden', data: () => ({ source: 'a', cible: 'x', type: 'z', visibleJoueurs: true }) },
        { id: 'r-ok', data: () => ({ source: 'b', cible: 'a', type: 'a', visibleJoueurs: true }) },
    ], metadata: {} });
    assert.deepEqual(received.at(-1).map(item => item.id), ['r-ok']);
    repo.setVisiblePnjIds(['a', 'x']);
    assert.equal(subscription.active, false);
    assert.deepEqual(received.at(-1), []);
    subscription.next({ docs: [{ id: 'late', data: () => ({ source: 'a', cible: 'x', type: 'z', visibleJoueurs: true }) }], metadata: {} });
    assert.deepEqual(received.at(-1), []);
    fake.state.subscriptions.at(-1).next({ docs: [
        { id: 'r-hidden', data: () => ({ source: 'a', cible: 'x', type: 'z', visibleJoueurs: true }) },
    ], metadata: {} });
    assert.deepEqual(received.at(-1).map(item => item.id), ['r-hidden']);
});

test('les requêtes publiques bornent les deux endpoints et attendent tous les lots avant de confirmer le serveur', () => {
    const fake = makeFirestore();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const repo = createPublicRelationsRepository({ ...fake, visiblePnjIds: ids });
    const received = [], errors = [];
    const stop = repo.subscribeVisible((items, metadata) => received.push({ items, metadata }), error => errors.push(error));
    assert.equal(fake.state.subscriptions.length, 4);
    for (const subscription of fake.state.subscriptions) {
        const constraints = subscription.target.constraints;
        assert.ok(constraints.some(filter => filter.field === 'visibleJoueurs' && filter.value === true));
        for (const field of ['source', 'cible']) {
            const filter = constraints.find(filter => filter.field === field);
            assert.equal(filter.operator, 'in');
            assert.ok(filter.value.length > 0 && filter.value.length <= 5);
            assert.ok(filter.value.every(id => ids.includes(id)));
        }
    }
    const snapshot = { docs: [], metadata: { fromCache: false, hasPendingWrites: false } };
    fake.state.subscriptions[0].next(snapshot);
    fake.state.subscriptions[1].error({ code: 'permission-denied' });
    fake.state.subscriptions[2].next(snapshot);
    fake.state.subscriptions[3].next(snapshot);
    assert.equal(errors.length, 1);
    assert.equal(received.at(-1).metadata.fromCache, true);
    fake.state.subscriptions[1].next(snapshot);
    assert.equal(received.at(-1).metadata.fromCache, false);
    repo.setVisiblePnjIds([...ids].reverse());
    assert.equal(fake.state.subscriptions.length, 4);
    stop();
    const count = received.length;
    fake.state.subscriptions[0].next(snapshot);
    assert.equal(received.length, count);
    assert.ok(fake.state.subscriptions.every(subscription => !subscription.active));
});

test('sans PNJ public, aucun abonnement aux relations ne contourne les règles', () => {
    const fake = makeFirestore();
    const repo = createPublicRelationsRepository(fake);
    const received = [];
    const stop = repo.subscribeVisible(items => received.push(items));
    assert.equal(fake.state.subscriptions.length, 0);
    assert.deepEqual(received.at(-1), []);
    repo.setVisiblePnjIds(['a', 'b']);
    assert.equal(fake.state.subscriptions.length, 1);
    stop();
});

test('les émissions annotent uniquement un miroir exact et unique', () => {
    const fake = makeFirestore();
    const repo = createPublicRelationsRepository({ ...fake, visiblePnjIds: ['a', 'b'] });
    const received = [];
    repo.subscribeVisible(items => received.push(items));
    const subscription = fake.state.subscriptions[0];
    const base = { type: 'allié', label: 'allié', color: '#fff', style: 'solid', visibleJoueurs: true };
    subscription.next({ docs: [
        { id: 'forward', data: () => ({ ...base, source: 'a', cible: 'b' }) },
        { id: 'reverse', data: () => ({ ...base, source: 'b', cible: 'a' }) },
        { id: 'partial', data: () => ({ ...base, label: 'autre', source: 'b', cible: 'a' }) },
    ], metadata: {} });
    const items = received.at(-1);
    assert.equal(items.find(item => item.id === 'forward').reciprocalId, 'reverse');
    assert.equal(items.find(item => item.id === 'reverse').reciprocalId, 'forward');
    assert.equal(items.find(item => item.id === 'partial').reciprocalId, null);
});

test('les mutations MJ PNJ/relations sont transactionnelles, bornées et conflictuelles', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true }, { notes: 'privé' });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true }, { notes: '' });
    assert.equal(fake.collectionMap('pnjs_prives').get('a').notes, 'privé');
    await assert.rejects(pnjRepo.update('a', { description: 'v1' }, {}, { seconds: 999, nanoseconds: 0 }), error => error.kind === ERROR_KINDS.CONFLICT);
    await relationRepo.create({ source: 'a', cible: 'b', type: 'allié', visibleJoueurs: true }, true);
    assert.equal(fake.collectionMap('relations').size, 2);
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'b', type: 'allié', visibleJoueurs: true }, true), error => error.kind === ERROR_KINDS.CONFLICT);
    const relationId = [...fake.collectionMap('relations').keys()][0];
    await relationRepo.remove(relationId, true);
    assert.equal(fake.collectionMap('relations').size, 0);
});

test('la précondition privée protège les notes seules et le patch public simultané sans écriture partielle', async () => {
    const fake = makeFirestore(); const repo = createMjPnjRepository(fake);
    await repo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true }, { notes: 'avant' });
    const publicVersion = { seconds: 1, nanoseconds: 0 }; const privateVersion = { seconds: 1, nanoseconds: 0 };
    await assert.rejects(repo.update('a', {}, { notes: 'perdue' }, undefined, { seconds: 99, nanoseconds: 0 }), error => error.kind === ERROR_KINDS.CONFLICT);
    assert.equal(fake.collectionMap('pnjs_prives').get('a').notes, 'avant');
    await assert.rejects(repo.update('a', { description: 'perdue aussi' }, { notes: 'perdue' }, publicVersion, { seconds: 99, nanoseconds: 0 }), error => error.kind === ERROR_KINDS.CONFLICT);
    assert.equal(fake.collectionMap('pnjs').get('a').description, undefined);
    assert.equal(fake.collectionMap('pnjs_prives').get('a').notes, 'avant');
    await repo.update('a', { description: 'ok' }, { notes: 'nouveau' }, publicVersion, privateVersion);
    assert.equal(fake.collectionMap('pnjs').get('a').description, 'ok');
    assert.equal(fake.collectionMap('pnjs_prives').get('a').notes, 'nouveau');
});

test('la mise à jour privée seule évite toute écriture directe sur une fiche gérée', async () => {
    const fake = makeFirestore(); const repo = createMjPnjRepository(fake);
    await repo.create({ id: 'managed', nom: 'Ada', visibleJoueurs: true }, { notes: 'avant' });
    await repo.updatePrivateOnly('managed', { notes: 'après' }, { seconds: 1, nanoseconds: 0 });
    assert.equal(fake.collectionMap('pnjs_prives').get('managed').notes, 'après');
    assert.equal(fake.state.lastTransactionOperations.length, 1);
    assert.equal(fake.state.lastTransactionOperations[0][1].collection, 'pnjs_prives');
    await assert.rejects(repo.updatePrivateOnly('managed', { notes: 'conflit' }, { seconds: 99, nanoseconds: 0 }),
        error => error.kind === ERROR_KINDS.CONFLICT);
});

test('une mise à jour de relation re-clé sûrement et refuse un miroir non prouvé', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    const created = await relationRepo.create({ source: 'a', cible: 'b', type: 'allié', label: 'Ancien', visibleJoueurs: true });
    const updated = await relationRepo.update(created.id, { label: 'Nouveau' });
    assert.notEqual(updated.nextId, created.id);
    assert.equal(fake.collectionMap('relations').has(created.id), false);
    assert.equal(fake.collectionMap('relations').get(updated.nextId).label, 'Nouveau');
    const rekeySet = fake.state.lastTransactionOperations.find(([kind, ref]) => kind === 'set' && ref.id === updated.nextId);
    assert.equal(rekeySet[2].createdAt.__serverTimestamp, true);

    const pair = await relationRepo.create({ source: 'a', cible: 'b', type: 'ennemi', visibleJoueurs: true }, true);
    await assert.rejects(relationRepo.remove(pair.id, { pair: true, reciprocalId: 'rel-does-not-exist' }),
        error => error.kind === ERROR_KINDS.CONFLICT);

    const pairUpdated = await relationRepo.update(pair.id, { label: 'Nouveau miroir' }, undefined,
        { pair: true, reciprocalId: pair.reciprocalId });
    assert.equal(fake.collectionMap('relations').get(pairUpdated.nextId).label, 'Nouveau miroir');
    assert.equal(fake.collectionMap('relations').get(pairUpdated.reciprocalId).label, 'Nouveau miroir');
});

test('la courbure commune survit aux mises à jour et re-clés de la paire', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const repo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    const pair = await repo.create({ source: 'a', cible: 'b', type: 'lien' }, true);
    await repo.saveCurvature(pair.id, -2.5, pair.reciprocalId);
    assert.equal(fake.collectionMap('relations').get(pair.id).curvature, -2.5);
    assert.equal(fake.collectionMap('relations').get(pair.reciprocalId).curvature, -2.5);
    const changed = await repo.update(pair.id, { label: 'renommé' }, undefined,
        { pair: true, reciprocalId: pair.reciprocalId });
    assert.equal(fake.collectionMap('relations').get(changed.nextId).curvature, -2.5);
    assert.equal(fake.collectionMap('relations').get(changed.reciprocalId).curvature, -2.5);
    const rekeyed = await repo.update(changed.nextId, { type: 'nouveau' }, undefined,
        { pair: true, reciprocalId: changed.reciprocalId });
    assert.equal(fake.collectionMap('relations').get(rekeyed.nextId).curvature, -2.5);
    assert.equal(fake.collectionMap('relations').get(rekeyed.reciprocalId).curvature, -2.5);
    await repo.saveCurvature(rekeyed.nextId, null, rekeyed.reciprocalId);
    assert.equal(fake.collectionMap('relations').get(rekeyed.nextId).curvature, null);
    assert.equal(fake.collectionMap('relations').get(rekeyed.reciprocalId).curvature, null);
    const beforeForward = fake.collectionMap('relations').get(rekeyed.nextId).curvature;
    const beforeReverse = fake.collectionMap('relations').get(rekeyed.reciprocalId).curvature;
    fake.state.failBatchCommitAt = fake.state.batchCommits + 1;
    await assert.rejects(repo.saveCurvature(rekeyed.nextId, 4, rekeyed.reciprocalId));
    assert.equal(fake.collectionMap('relations').get(rekeyed.nextId).curvature, beforeForward);
    assert.equal(fake.collectionMap('relations').get(rekeyed.reciprocalId).curvature, beforeReverse);
    fake.state.failBatchCommitAt = null;
    await assert.rejects(repo.saveCurvature(rekeyed.nextId, 4, rekeyed.nextId), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.saveCurvature(rekeyed.nextId, 4, 'bad id'), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.saveCurvature(rekeyed.nextId, Number.NaN), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.saveCurvature(rekeyed.nextId, 6.01), error => error.kind === ERROR_KINDS.VALIDATION);
});

test('un rekey de paire réconcilie la courbure absente de la réciproque', async () => {
    const fake = makeFirestore();
    const pnjs = createMjPnjRepository(fake);
    const repo = createMjRelationsRepository(fake);
    await pnjs.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjs.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    const pair = await repo.create({ source: 'a', cible: 'b', type: 'lien' }, true);
    await repo.saveCurvature(pair.id, 2);
    const reverse = fake.collectionMap('relations').get(pair.reciprocalId);
    delete reverse.curvature;
    const updated = await repo.update(pair.id, { label: 'renommé' }, undefined,
        { pair: true, reciprocalId: pair.reciprocalId });
    assert.equal(fake.collectionMap('relations').get(updated.nextId).curvature, 2);
    assert.equal(fake.collectionMap('relations').get(updated.reciprocalId).curvature, 2);
});

test('le rekey choisit la dernière courbure explicite, y compris inverse seul et reset récent', async () => {
    const fake = makeFirestore();
    const pnjs = createMjPnjRepository(fake);
    const repo = createMjRelationsRepository(fake);
    await pnjs.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjs.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    let pair = await repo.create({ source: 'a', cible: 'b', type: 'chronologie' }, true);
    const writePairState = (forward, reverse) => {
        put(fake, 'relations', pair.id, { ...fake.collectionMap('relations').get(pair.id), ...forward });
        put(fake, 'relations', pair.reciprocalId, { ...fake.collectionMap('relations').get(pair.reciprocalId), ...reverse });
    };
    const rekey = async label => {
        const updated = await repo.update(pair.id, { label }, undefined,
            { pair: true, reciprocalId: pair.reciprocalId });
        pair = { id: updated.nextId, reciprocalId: updated.reciprocalId };
        return [fake.collectionMap('relations').get(pair.id), fake.collectionMap('relations').get(pair.reciprocalId)];
    };

    const primary = fake.collectionMap('relations').get(pair.id);
    delete primary.curvature;
    writePairState({}, { curvature: 4, updatedAt: { seconds: 20, nanoseconds: 0 } });
    let [forward, reverse] = await rekey('inverse seul');
    assert.equal(forward.curvature, 4);
    assert.equal(reverse.curvature, 4);

    writePairState(
        { curvature: 2, updatedAt: { seconds: 30, nanoseconds: 0 } },
        { curvature: -3, updatedAt: { seconds: 29, nanoseconds: 0 } },
    );
    [forward, reverse] = await rekey('primaire plus récent');
    assert.equal(forward.curvature, 2);
    assert.equal(reverse.curvature, 2);

    writePairState(
        { curvature: 2, updatedAt: { seconds: 40, nanoseconds: 0 } },
        { curvature: null, updatedAt: { seconds: 41, nanoseconds: 0 } },
    );
    [forward, reverse] = await rekey('reset inverse plus récent');
    assert.equal(forward.curvature, null);
    assert.equal(reverse.curvature, null);

    const lowerIdFirst = pair.id.localeCompare(pair.reciprocalId, 'en') < 0;
    writePairState(
        { curvature: lowerIdFirst ? 1 : 5, updatedAt: { seconds: 50, nanoseconds: 0 } },
        { curvature: lowerIdFirst ? 5 : 1, updatedAt: { seconds: 50, nanoseconds: 0 } },
    );
    [forward, reverse] = await rekey('égalité temporelle');
    assert.equal(forward.curvature, 1);
    assert.equal(reverse.curvature, 1);
});

test('saveCurvature est exposé au dépôt public et n’accepte que null ou une valeur bornée', async () => {
    const fake = makeFirestore();
    const repo = createPublicRelationsRepository({ ...fake, visiblePnjIds: ['a', 'b'] });
    assert.equal(typeof repo.saveCurvature, 'function');
    put(fake, 'relations', 'forward', { source: 'a', cible: 'b', type: 'lien', visibleJoueurs: true });
    put(fake, 'relations', 'reverse', { source: 'b', cible: 'a', type: 'lien', visibleJoueurs: true });
    await repo.saveCurvature('forward', 1.5, 'reverse');
    assert.equal(fake.collectionMap('relations').get('forward').curvature, 1.5);
    assert.equal(fake.collectionMap('relations').get('reverse').curvature, 1.5);
    await repo.saveCurvature('forward', null, 'reverse');
    assert.equal(fake.collectionMap('relations').get('forward').curvature, null);
    assert.equal(fake.collectionMap('relations').get('reverse').curvature, null);
    await assert.rejects(repo.saveCurvature('r', Infinity), error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(repo.saveCurvature('r', -6.1), error => error.kind === ERROR_KINDS.VALIDATION);
});

test('les validations de relation sont fail-closed et aucune écriture partielle ne survient', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'a', type: 'auto', visibleJoueurs: true }),
        error => error.kind === ERROR_KINDS.VALIDATION);
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'missing', type: 'absent', visibleJoueurs: true }, true),
        error => error.kind === ERROR_KINDS.NOT_FOUND && !error.message.includes('cascade-failure-secret'));
    assert.equal(fake.collectionMap('relations').size, 0);

    await pnjRepo.create({ id: 'hidden', nom: 'Hidden', visibleJoueurs: false });
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'hidden', type: 'visible', visibleJoueurs: 'oui' }),
        error => error.kind === ERROR_KINDS.VALIDATION);
});

test('la visibilité d’une relation est dérivée de ses deux PNJ et ne bloque jamais le MJ', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    await pnjRepo.create({ id: 'h', nom: 'Hugo', visibleJoueurs: false });
    await pnjRepo.create({ id: 'k', nom: 'Karl', visibleJoueurs: false });

    const hidden = await relationRepo.create({ source: 'h', cible: 'k', type: 'secret', visibleJoueurs: true }, true);
    assert.equal(fake.collectionMap('relations').get(hidden.id).visibleJoueurs, false);
    assert.equal(fake.collectionMap('relations').get(hidden.reciprocalId).visibleJoueurs, false);
    const mixed = await relationRepo.create({ source: 'a', cible: 'h', type: 'mixte' });
    assert.equal(fake.collectionMap('relations').get(mixed.id).visibleJoueurs, false);
    const open = await relationRepo.create({ source: 'a', cible: 'b', type: 'public', visibleJoueurs: false });
    assert.equal(fake.collectionMap('relations').get(open.id).visibleJoueurs, true);

    const updated = await relationRepo.update(mixed.id, { label: 'Mixte', visibleJoueurs: true });
    assert.equal(fake.collectionMap('relations').get(updated.nextId).visibleJoueurs, false);
    const forced = await relationRepo.forceUpdate(open.id, { visibleJoueurs: false }, { confirmed: true });
    assert.equal(fake.collectionMap('relations').get(forced.nextId).visibleJoueurs, true);
});

test('rendre un PNJ visible révèle ses relations si l’autre PNJ l’est, et le masquer révoque', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: false });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    await pnjRepo.create({ id: 'h', nom: 'Hugo', visibleJoueurs: false });
    const withVisible = await relationRepo.create({ source: 'a', cible: 'b', type: 'allié' }, true);
    const withHidden = await relationRepo.create({ source: 'h', cible: 'a', type: 'rival' });
    put(fake, 'pnjs', 'gone', { nom: 'Gone', visibleJoueurs: true, suppressionEnCours: true });
    put(fake, 'relations', 'to-gone', { source: 'a', cible: 'gone', type: 't', visibleJoueurs: false });
    const relations = () => fake.collectionMap('relations');

    const result = await pnjRepo.update('a', { visibleJoueurs: true });
    assert.equal(result.relationsRevealPending, undefined);
    assert.equal(relations().get(withVisible.id).visibleJoueurs, true);
    assert.equal(relations().get(withVisible.reciprocalId).visibleJoueurs, true);
    assert.equal(relations().get(withHidden.id).visibleJoueurs, false);
    assert.equal(relations().get('to-gone').visibleJoueurs, false);
    const reveal = fake.state.lastTransactionOperations.find(([, ref]) => ref.id === withVisible.id);
    assert.equal(reveal[2].updatedAt.__serverTimestamp, true);

    await pnjRepo.update('h', { visibleJoueurs: true });
    assert.equal(relations().get(withHidden.id).visibleJoueurs, true);

    await pnjRepo.update('a', { visibleJoueurs: false });
    assert.equal(relations().get(withVisible.id).visibleJoueurs, false);
    assert.equal(relations().get(withHidden.id).visibleJoueurs, false);
});

test('une relation révélée sur place reste un doublon pour la création et le rekey', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: false });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    await relationRepo.create({ source: 'a', cible: 'b', type: 'allié' }, true);
    const other = await relationRepo.create({ source: 'a', cible: 'b', type: 'autre' });
    await pnjRepo.update('a', { visibleJoueurs: true });
    assert.ok([...fake.collectionMap('relations').values()].every(relation => relation.visibleJoueurs === true));

    await assert.rejects(relationRepo.create({ source: 'a', cible: 'b', type: 'allié' }, true),
        error => error.kind === ERROR_KINDS.CONFLICT && error.operation === 'create-relation-duplicate');
    await assert.rejects(relationRepo.create({ source: 'b', cible: 'a', type: 'allié' }),
        error => error.kind === ERROR_KINDS.CONFLICT);
    await assert.rejects(relationRepo.update(other.id, { type: 'allié', label: 'allié' }),
        error => error.kind === ERROR_KINDS.CONFLICT && error.operation === 'update-relation-rekey');
    assert.equal(fake.collectionMap('relations').size, 3);
});

test('une relation révoquée sur place reste un doublon pour la création', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    await relationRepo.create({ source: 'a', cible: 'b', type: 'allié' }, true);
    await pnjRepo.update('a', { visibleJoueurs: false });
    assert.ok([...fake.collectionMap('relations').values()].every(relation => relation.visibleJoueurs === false));

    await assert.rejects(relationRepo.create({ source: 'a', cible: 'b', type: 'allié' }, true),
        error => error.kind === ERROR_KINDS.CONFLICT && error.operation === 'create-relation-duplicate');
    assert.equal(fake.collectionMap('relations').size, 2);
});

test('un échec de révélation ne fait pas échouer l’enregistrement déjà commis du PNJ', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: false });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    await createMjRelationsRepository(fake).create({ source: 'a', cible: 'b', type: 'allié' });
    const runTransaction = fake.sdk.runTransaction;
    let calls = 0;
    fake.sdk.runTransaction = async (...args) => {
        calls += 1;
        if (calls === 2) throw new Error('reveal-failure-secret');
        return runTransaction(...args);
    };
    const result = await pnjRepo.update('a', { visibleJoueurs: true, description: 'publié' });
    assert.equal(result.id, 'a');
    assert.equal(result.relationsRevealPending, true);
    assert.equal(fake.collectionMap('pnjs').get('a').visibleJoueurs, true);
    assert.ok([...fake.collectionMap('relations').values()].every(relation => relation.visibleJoueurs === false));

    fake.sdk.runTransaction = runTransaction;
    await pnjRepo.update('a', { visibleJoueurs: true });
    assert.ok([...fake.collectionMap('relations').values()].every(relation => relation.visibleJoueurs === true));
});

test('un label vide est refusé, tandis qu’une relation legacy sans label reste éditable', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'b', type: 't', label: '   ', visibleJoueurs: false }),
        error => error.kind === ERROR_KINDS.VALIDATION);
    put(fake, 'relations', 'legacy', { source: 'a', cible: 'b', type: 't', visibleJoueurs: false });
    const updated = await relationRepo.update('legacy', { visibleJoueurs: true });
    assert.equal(fake.collectionMap('relations').get(updated.nextId).label, 't');
});

test('le verrou global bloque toute mutation de relation, y compris sur un autre PNJ', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    put(fake, 'integrity_locks', 'pnj-deletion', { pnjId: 'other', imagePaths: [] });
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'b', type: 'bloquée', visibleJoueurs: false }),
        error => error.kind === ERROR_KINDS.CONFLICT);
    assert.equal(fake.collectionMap('relations').size, 0);
});

test('la suppression PNJ conserve le verrou si le cleanup image manque puis reprend depuis Firestore', async () => {
    const fake = makeFirestore();
    put(fake, 'pnjs', 'a', { nom: 'Ada', visibleJoueurs: true, suppressionEnCours: false, imagePath: 'portraits/a/one.webp' });
    put(fake, 'pnjs_prives', 'a', { notes: '', updatedAt: { seconds: 1, nanoseconds: 0 } });
    put(fake, 'indices', 'i', { titre: 'I', description: '', decouvert: true, pnjsLies: ['a', 'b'] });
    const repo = createMjPnjRepository(fake);
    await assert.rejects(repo.remove('a'), error => error.kind === ERROR_KINDS.VALIDATION && error.state?.lockRetained === true);
    assert.equal(fake.collectionMap('pnjs').has('a'), false);
    assert.equal(fake.collectionMap('integrity_locks').has('pnj-deletion'), true);
    assert.deepEqual(fake.collectionMap('indices').get('i').pnjsLies, ['b']);
    const recovery = createMjPnjRepository({ ...fake, imageService: { cleanupPnjImages: async () => ({ status: 'completed' }) } });
    const state = await recovery.resumeRemoval('a');
    assert.equal(state.lockRetained, false);
    assert.equal(fake.collectionMap('integrity_locks').has('pnj-deletion'), false);
});

test('une suppression absente ne fabrique pas un état de verrou et le masquage révoque les relations', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    const relationRepo = createMjRelationsRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    const relation = await relationRepo.create({ source: 'a', cible: 'b', type: 'allié', visibleJoueurs: true });
    await pnjRepo.update('a', { visibleJoueurs: false });
    assert.equal(fake.collectionMap('relations').get(relation.id).visibleJoueurs, false);
    await assert.rejects(pnjRepo.remove('missing'), error => error.state?.lockRetained === false);
});

test('un portrait legacy/externe est protégé, signalé et ne bloque pas la suppression Firestore', async () => {
    const fake = makeFirestore();
    put(fake, 'pnjs', 'legacy', { nom: 'Legacy', visibleJoueurs: true, imagePath: 'https://autre.example/p.jpg' });
    put(fake, 'pnjs_prives', 'legacy', { notes: '' });
    const state = await createMjPnjRepository(fake).remove('legacy');
    assert.equal(state.legacyImageSkipped, true);
    assert.equal(Object.hasOwn(state, 'skippedImagePaths'), false);
    const lock = fake.collectionMap('integrity_locks').get('pnj-deletion');
    assert.equal(lock, undefined);
    assert.equal(fake.collectionMap('pnjs').has('legacy'), false);
});

test('une imageUrl legacy est signalée par booléen sans URL dans état ou verrou', async () => {
    const fake = makeFirestore();
    put(fake, 'pnjs', 'legacy-url', { nom: 'Legacy URL', visibleJoueurs: true, imageUrl: 'https://storage.googleapis.com/campagne-wrpg.firebasestorage.app/portraits/legacy-url/a.webp?token=secret' });
    put(fake, 'pnjs_prives', 'legacy-url', { notes: '' });
    const state = await createMjPnjRepository(fake).remove('legacy-url');
    assert.equal(state.legacyImageSkipped, true);
    assert.doesNotMatch(JSON.stringify(state), /storage|token|https/iu);
    assert.equal(fake.collectionMap('integrity_locks').has('pnj-deletion'), false);
});

test('un identifiant PNJ trop long pour Storage ne crée pas un lock image incompatible', async () => {
    const fake = makeFirestore();
    const longId = 'p'.repeat(101);
    const path = `portraits/${longId}/p.webp`;
    put(fake, 'pnjs', longId, { nom: 'Long', visibleJoueurs: true, imagePath: path });
    put(fake, 'pnjs_prives', longId, { notes: '' });
    const state = await createMjPnjRepository(fake).remove(longId);
    assert.equal(state.legacyImageSkipped, true);
    assert.equal(Object.hasOwn(state, 'skippedImagePaths'), false);
    assert.equal(fake.collectionMap('integrity_locks').has('pnj-deletion'), false);
    assert.equal(fake.collectionMap('pnjs').has(longId), false);
});

test('la cascade >500 est découpée en lots et reprend après panne, sans faux succès', async () => {
    const fake = makeFirestore();
    put(fake, 'pnjs', 'a', { nom: 'Ada', visibleJoueurs: true, suppressionEnCours: false });
    put(fake, 'pnjs_prives', 'a', { notes: '' });
    for (let index = 0; index < 600; index += 1) {
        put(fake, 'relations', `r-${index}`, { source: 'a', cible: `b-${index}`, type: 't', visibleJoueurs: false });
    }
    fake.state.failBatchCommitAt = 2;
    const repo = createMjPnjRepository(fake);
    await assert.rejects(repo.remove('a'), error => error.state?.lockRetained === true
        && error.state?.firestoreDone === false && !error.message.includes('cascade-failure-secret'));
    assert.equal(fake.collectionMap('pnjs').has('a'), true);
    fake.state.failBatchCommitAt = null;
    const state = await repo.resumeRemoval('a');
    assert.equal(state.lockRetained, false);
    assert.equal(fake.collectionMap('relations').size, 0);
    assert.ok(fake.state.batchCommits >= 4); // deux lots de cascade + final + déverrouillage
});

test('un nettoyage image en panne conserve le verrou et reprend après le commit Firestore', async () => {
    const fake = makeFirestore();
    put(fake, 'pnjs', 'img', { nom: 'Image', visibleJoueurs: true, suppressionEnCours: false, imagePath: 'portraits/img/p.webp' });
    put(fake, 'pnjs_prives', 'img', { notes: '' });
    let calls = 0;
    const imageService = { cleanupPnjImages: async () => {
        calls += 1;
        if (calls === 1) throw new Error('storage-secret');
        return { ok: true };
    } };
    const repo = createMjPnjRepository({ ...fake, imageService });
    await assert.rejects(repo.remove('img'), error => error.state?.firestoreDone === true
        && error.state?.imageCleanupPending === true && !error.message.includes('storage-secret'));
    assert.equal(fake.collectionMap('pnjs').has('img'), false);
    assert.equal(fake.collectionMap('integrity_locks').has('pnj-deletion'), true);
    const state = await repo.resumeRemoval('img');
    assert.equal(state.lockRetained, false);
    assert.equal(calls, 2);
});

test('le masquage PNJ stabilise une relation apparue entre la prélecture et la transaction', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    fake.state.afterSnapshotGetDocs = (_target, call) => {
        if (call === 1) put(fake, 'relations', 'late', { source: 'a', cible: 'b', type: 'late', visibleJoueurs: true });
    };
    await pnjRepo.update('a', { visibleJoueurs: false });
    assert.equal(fake.collectionMap('relations').get('late').visibleJoueurs, false);
});

test('la révocation de masse reste sous la limite de 8 relations par transaction', async () => {
    const fake = makeFirestore();
    put(fake, 'pnjs', 'a', { nom: 'Ada', visibleJoueurs: true, suppressionEnCours: false });
    put(fake, 'pnjs_prives', 'a', { notes: '' });
    for (let index = 0; index < 25; index += 1) {
        put(fake, 'relations', `mass-${index}`, { source: 'a', cible: `b-${index}`, type: 't', visibleJoueurs: true });
    }
    await createMjPnjRepository(fake).update('a', { visibleJoueurs: false });
    const relationTransactions = fake.state.transactionRelationCounts.filter(count => count > 0);
    assert.ok(relationTransactions.length >= 4);
    assert.ok(relationTransactions.every(count => count <= 8));
    assert.ok([...fake.collectionMap('relations').values()].every(relation => relation.visibleJoueurs === false));
});

test('la passe de stabilisation ne réécrit pas une note modifiée entre les passes', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true }, { notes: 'avant' });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    fake.state.afterSnapshotGetDocs = (_target, call) => {
        if (call === 1) put(fake, 'relations', 'late', { source: 'a', cible: 'b', type: 'late', visibleJoueurs: true });
        if (call === 2) put(fake, 'pnjs_prives', 'a', { notes: 'concurrent', updatedAt: { seconds: 9, nanoseconds: 0 } });
    };
    await pnjRepo.update('a', { visibleJoueurs: false }, { notes: 'demande' });
    assert.equal(fake.collectionMap('pnjs_prives').get('a').notes, 'concurrent');
    assert.equal(fake.collectionMap('relations').get('late').visibleJoueurs, false);
});

test('une republication concurrente pendant la stabilisation est refusée', async () => {
    const fake = makeFirestore();
    const pnjRepo = createMjPnjRepository(fake);
    await pnjRepo.create({ id: 'a', nom: 'Ada', visibleJoueurs: true });
    await pnjRepo.create({ id: 'b', nom: 'Bob', visibleJoueurs: true });
    fake.state.afterSnapshotGetDocs = (_target, call) => {
        if (call === 1) put(fake, 'relations', 'late', { source: 'a', cible: 'b', type: 'late', visibleJoueurs: true });
        if (call === 2) fake.collectionMap('pnjs').get('a').visibleJoueurs = true;
    };
    await assert.rejects(pnjRepo.update('a', { visibleJoueurs: false }),
        error => error.kind === ERROR_KINDS.CONFLICT);
    assert.equal(fake.collectionMap('pnjs').get('a').visibleJoueurs, true);
});

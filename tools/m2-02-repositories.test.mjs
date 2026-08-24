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
        getDocs: async target => {
            const collection = target.collection ?? target;
            state.getDocsCalls += 1;
            const result = { docs: [...collectionMap(collection.name).entries()].map(([id, data]) => snap({ id }, data)), metadata: { fromCache: false, hasPendingWrites: false } };
            if (typeof state.afterSnapshotGetDocs === 'function') state.afterSnapshotGetDocs(target, state.getDocsCalls);
            return result;
        },
        onSnapshot: (target, next, error) => {
            const subscription = { target, next, error, active: true };
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
    assert.ok(subscription.target.constraints.some(item => item.field === 'visibleJoueurs' && item.value === true));
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: {} });
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: {} });
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].items.map(item => item.id), ['a', 'z']);
    subscription.next({ docs: [publicPnj('z', true, { nom: 'Émile' }), publicPnj('a', true, { nom: 'Ada' }), publicPnj('x', false)], metadata: { fromCache: true } });
    assert.equal(received.length, 2);
    unsubscribe();
    unsubscribe();
    subscription.next({ docs: [], metadata: {} });
    assert.equal(received.length, 2);

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
    assert.deepEqual(received.at(-1).map(item => item.id), ['r-hidden']);
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
    await assert.rejects(relationRepo.create({ source: 'a', cible: 'hidden', type: 'visible', visibleJoueurs: true }),
        error => error.kind === ERROR_KINDS.CONFLICT);
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
    assert.deepEqual(state.skippedImagePaths, ['https://autre.example/p.jpg']);
    assert.equal(fake.collectionMap('pnjs').has('legacy'), false);
});

test('un identifiant PNJ trop long pour Storage ne crée pas un lock image incompatible', async () => {
    const fake = makeFirestore();
    const longId = 'p'.repeat(101);
    const path = `portraits/${longId}/p.webp`;
    put(fake, 'pnjs', longId, { nom: 'Long', visibleJoueurs: true, imagePath: path });
    put(fake, 'pnjs_prives', longId, { notes: '' });
    const state = await createMjPnjRepository(fake).remove(longId);
    assert.deepEqual(state.skippedImagePaths, [path]);
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

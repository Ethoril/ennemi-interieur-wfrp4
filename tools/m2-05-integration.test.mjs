import test from 'node:test';
import assert from 'node:assert/strict';
import { createMjPnjRepository, createPublicPnjRepository } from '../js/data/pnjs-repository.js';
import { createMjRelationsRepository, createPublicRelationsRepository } from '../js/data/relations-repository.js';
import { createMjIndicesRepository, createPublicIndicesRepository } from '../js/data/indices-repository.js';
import { createMjImagesRepository, createPublicImagesRepository } from '../js/data/images-repository.js';
import { ERROR_KINDS } from '../js/data/firebase-errors.js';

function makeDouble() {
    const state = { collections: new Map(), subscriptions: [], nextId: 0, revoked: [] };
    const map = name => { if (!state.collections.has(name)) state.collections.set(name, new Map()); return state.collections.get(name); };
    const snap = (ref, data) => ({ id: ref.id, exists: () => data !== undefined,
        data: () => data === undefined ? undefined : { ...data }, metadata: { fromCache: false, hasPendingWrites: false } });
    const apply = (ref, data, merge = false) => {
        const old = map(ref.collection).get(ref.id) ?? {};
        const next = merge ? { ...old } : {};
        for (const [key, value] of Object.entries(data)) {
            next[key] = value?.__serverTimestamp ? { seconds: 1, nanoseconds: 0 }
                : value?.__arrayRemove ? (old[key] ?? []).filter(item => !value.__arrayRemove.includes(item)) : value;
        }
        map(ref.collection).set(ref.id, next);
    };
    const sdk = {
        collection: (_db, name) => ({ kind: 'collection', name }),
        doc: (...args) => args.length === 1 ? { kind: 'doc', collection: args[0].name, id: `auto-${++state.nextId}` }
            : { kind: 'doc', collection: args[1], id: args[2] },
        query: (collection, ...constraints) => ({ ...collection, kind: 'query', constraints }),
        where: (field, operator, value) => ({ field, operator, value }),
        documentId: () => '__name__',
        serverTimestamp: () => ({ __serverTimestamp: true }),
        arrayRemove: (...values) => ({ __arrayRemove: values }),
        deleteField: () => ({ __deleteField: true }),
        getDoc: async ref => snap(ref, map(ref.collection).get(ref.id)),
        getDocs: async target => ({ docs: [...map(target.name).entries()].map(([id, data]) => snap({ id }, data)), metadata: {} }),
        onSnapshot: (target, next, error) => {
            const subscription = { target, next, error, closed: false };
            state.subscriptions.push(subscription);
            return () => { subscription.closed = true; };
        },
        writeBatch: () => {
            const operations = [];
            return {
                set: (ref, data, options) => operations.push(['set', ref, data, options]),
                update: (ref, data) => operations.push(['update', ref, data]),
                delete: ref => operations.push(['delete', ref]),
                commit: async () => operations.forEach(([kind, ref, data, options]) => {
                    if (kind === 'delete') map(ref.collection).delete(ref.id);
                    else apply(ref, data, options?.merge === true || kind === 'update');
                }),
            };
        },
        runTransaction: async (_db, callback) => {
            const operations = [];
            const transaction = {
                get: async ref => snap(ref, map(ref.collection).get(ref.id)),
                set: (ref, data, options) => operations.push(['set', ref, data, options]),
                update: (ref, data) => operations.push(['update', ref, data]),
                delete: ref => operations.push(['delete', ref]),
            };
            const result = await callback(transaction);
            for (const [kind, ref, data, options] of operations) {
                if (kind === 'delete') map(ref.collection).delete(ref.id);
                else apply(ref, data, options?.merge === true || kind === 'update');
            }
            return result;
        },
    };
    const storageSdk = {
        ref: (_storage, path) => ({ path }),
        getBlob: async ref => new globalThis.Blob([ref.path], { type: 'image/webp' }),
    };
    const storage = {};
    const makeClient = () => {
        const active = new Set();
        return {
            db: {}, active,
            listen: (...args) => {
                let released = false;
                let activeCallback = true;
                const [target, onNext, onError, ...rest] = args;
                const raw = sdk.onSnapshot(target,
                    value => { if (activeCallback) onNext?.(value); },
                    error => { if (activeCallback) onError?.(error); }, ...rest);
                const release = () => {
                    if (released) return;
                    released = true;
                    activeCallback = false;
                    active.delete(release);
                    raw();
                };
                active.add(release);
                return release;
            },
            close: () => { for (const release of [...active]) release(); },
        };
    };
    const publicClient = makeClient();
    const mjClient = makeClient();
    return { sdk, storageSdk, storage, client: publicClient, publicClient, mjClient, state, map };
}

function put(fake, collection, id, data) { fake.map(collection).set(id, { ...data }); }

test('les quatre dépôts partagent le même double public/MJ et libèrent leurs ressources', async () => {
    const fake = makeDouble();
    put(fake, 'pnjs', 'a', { nom: 'Ada', visibleJoueurs: true, suppressionEnCours: false, updatedAt: { seconds: 1, nanoseconds: 0 } });
    put(fake, 'pnjs', 'b', { nom: 'Bob', visibleJoueurs: true, suppressionEnCours: false });
    put(fake, 'pnjs_prives', 'a', { notes: 'secret', updatedAt: { seconds: 1, nanoseconds: 0 } });
    put(fake, 'indices', 'i', { titre: 'Découvert', decouvert: true, pnjsLies: [] });

    const publicPnj = createPublicPnjRepository({ ...fake, client: fake.publicClient });
    const mjPnj = createMjPnjRepository({ ...fake, client: fake.mjClient });
    const publicRelations = createPublicRelationsRepository({ ...fake, client: fake.publicClient, visiblePnjIds: ['a', 'b'] });
    const mjRelations = createMjRelationsRepository({ ...fake, client: fake.mjClient });
    const publicIndices = createPublicIndicesRepository({ ...fake, client: fake.publicClient });
    const mjIndices = createMjIndicesRepository({ ...fake, client: fake.mjClient });
    const objectUrls = [];
    const imageOptions = {
        ...fake,
        createObjectUrl: blob => { const url = `blob:test-${objectUrls.length}`; objectUrls.push(url); return url; },
        revokeObjectUrl: url => fake.state.revoked.push(url),
        uploader: async (_file, { kind, ownerId }) => ({ imagePath: `${kind === 'portrait' ? 'portraits' : 'indices'}/${ownerId}/a.webp` }),
        journal: { remember: async () => true, forget: async () => true },
        cleanup: { unreferenced: async () => ({ status: 'completed' }), recover: async () => ({ recovered: 0 }) },
    };
    const publicImages = createPublicImagesRepository(imageOptions);
    const mjImages = createMjImagesRepository(imageOptions);

    const publicValues = [];
    const unsubscribePnj = publicPnj.subscribeVisible((items, metadata) => publicValues.push({ items, metadata }));
    const pnjSubscription = fake.state.subscriptions.at(-1);
    const pnjSnapshot = { docs: [{ id: 'a', data: () => fake.map('pnjs').get('a') }], metadata: {} };
    pnjSubscription.next(pnjSnapshot);
    pnjSubscription.next(pnjSnapshot);
    assert.equal(publicValues.length, 1);
    pnjSubscription.next({ ...pnjSnapshot, metadata: { fromCache: true, hasPendingWrites: false } });
    pnjSubscription.next({ ...pnjSnapshot, metadata: { fromCache: false, hasPendingWrites: false } });
    assert.equal(publicValues.length, 3, 'un changement cache -> serveur reste observable');
    assert.equal(publicValues[0].items[0].id, 'a');
    unsubscribePnj();
    pnjSubscription.next({ docs: [], metadata: {} });
    assert.equal(publicValues.length, 3);

    const privateValues = [];
    mjPnj.subscribePrivate('a', value => privateValues.push(value));
    fake.state.subscriptions.at(-1).next({ id: 'a', exists: () => true, data: () => ({ notes: 'secret' }), metadata: {} });
    assert.equal(privateValues[0].notes, 'secret');
    await assert.rejects(mjPnj.update('a', { description: 'x' }, {}, { seconds: 99, nanoseconds: 0 }),
        error => error.kind === ERROR_KINDS.CONFLICT);
    const created = await mjPnj.create({ id: 'c', nom: 'C', visibleJoueurs: true }, { notes: 'n' });
    assert.equal(created.id, 'c');
    assert.deepEqual(fake.map('pnjs').get('c').updatedAt, { seconds: 1, nanoseconds: 0 });

    await mjRelations.create({ source: 'a', cible: 'b', type: 'allié', visibleJoueurs: true }, true);
    const relationValues = [];
    publicRelations.subscribeVisible(items => relationValues.push(items));
    const relationSubscription = fake.state.subscriptions.at(-1);
    relationSubscription.next({ docs: [
        { id: 'r1', data: () => ({ source: 'a', cible: 'b', type: 'allié', label: 'allié', visibleJoueurs: true }) },
        { id: 'r2', data: () => ({ source: 'b', cible: 'a', type: 'allié', label: 'allié', visibleJoueurs: true }) },
    ], metadata: {} });
    assert.equal(relationValues.at(-1).length, 2);

    const indexValues = [];
    publicIndices.subscribeDiscovered((items, metadata) => indexValues.push({ items, metadata }));
    const indexSubscription = fake.state.subscriptions.at(-1);
    indexSubscription.next({ docs: [{ id: 'i', data: () => fake.map('indices').get('i') }], metadata: {} });
    assert.equal(indexValues[0].items[0].id, 'i');
    const newIndice = await mjIndices.create({ id: 'i2', titre: 'Nouveau', decouvert: false, pnjsLies: [] });
    assert.equal(newIndice.id, 'i2');

    const imageHandle = publicImages.loadObjectUrl('portraits/a/a.webp');
    const image = await imageHandle;
    image.release();
    await mjImages.replace(null, { kind: 'portrait', ownerId: 'a' }, new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: async () => {} });
    assert.ok(fake.publicClient.active.size > 0);
    assert.ok(fake.mjClient.active.size > 0);
    const relationCountBeforeClose = relationValues.length;
    const indexCountBeforeClose = indexValues.length;
    fake.publicClient.close();
    fake.mjClient.close();
    assert.equal(fake.publicClient.active.size, 0);
    assert.equal(fake.mjClient.active.size, 0);
    relationSubscription.next({ docs: [], metadata: {} });
    indexSubscription.next({ docs: [], metadata: {} });
    assert.equal(relationValues.length, relationCountBeforeClose, 'un callback tardif est ignoré après close');
    assert.equal(indexValues.length, indexCountBeforeClose, 'le callback indice tardif est ignoré après close');
    assert.ok(fake.state.subscriptions.every(subscription => subscription.closed), 'les deux handles détachent tous les raw listeners');
    publicImages.close();
    mjImages.close();
    assert.equal(fake.state.revoked.length, 1);
});

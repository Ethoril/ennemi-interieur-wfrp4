import test from 'node:test';
import assert from 'node:assert/strict';
import { createMjIndicesRepository, createPublicIndicesRepository } from '../js/data/indices-repository.js';
import { createMjImagesRepository, createPublicImagesRepository, describeImage } from '../js/data/images-repository.js';
import { normalizeIndice } from '../js/data/firebase-normalizers.js';
import { ERROR_KINDS } from '../js/data/firebase-errors.js';

function makeFake() {
    const state = { collections: new Map(), subscriptions: [], nextId: 0, revoked: [], blobs: 0, failTransaction: false, failAfterApply: false };
    const map = name => { if (!state.collections.has(name)) state.collections.set(name, new Map()); return state.collections.get(name); };
    const snap = (ref, data) => ({ id: ref.id, exists: () => data !== undefined,
        data: () => data === undefined ? undefined : { ...data }, metadata: { fromCache: false, hasPendingWrites: false } });
    const apply = (ref, data, merge = false) => {
        const old = map(ref.collection).get(ref.id) ?? {};
        const next = merge ? { ...old } : {};
        for (const [key, value] of Object.entries(data)) {
            next[key] = value?.__serverTimestamp ? { seconds: 1, nanoseconds: 0 }
                : value?.__arrayUnion ? [...new Set([...(old[key] ?? []), ...value.__arrayUnion])]
                    : value?.__arrayRemove ? (old[key] ?? []).filter(item => !value.__arrayRemove.includes(item)) : value;
        }
        map(ref.collection).set(ref.id, next);
    };
    const sdk = {
        collection: (_db, name) => ({ kind: 'collection', name }),
        doc: (...args) => args.length === 1 ? { kind: 'doc', collection: args[0].name, id: `auto-${++state.nextId}` } : { kind: 'doc', collection: args[1], id: args[2] },
        query: (collection, ...constraints) => ({ ...collection, kind: 'query', constraints }),
        where: (field, operator, value) => ({ field, operator, value }),
        documentId: () => '__name__',
        serverTimestamp: () => ({ __serverTimestamp: true }),
        arrayUnion: (...values) => ({ __arrayUnion: values }),
        arrayRemove: (...values) => ({ __arrayRemove: values }),
        getDoc: async ref => snap(ref, map(ref.collection).get(ref.id)),
        getDocs: async target => ({ docs: [...map(target.name).entries()].map(([id, data]) => snap({ id }, data)), metadata: {} }),
        onSnapshot: (target, next, error) => { const item = { target, next, error }; state.subscriptions.push(item); return () => { item.closed = true; }; },
        runTransaction: async (_db, callback) => {
            const operations = [];
            const transaction = {
                get: async ref => snap(ref, map(ref.collection).get(ref.id)),
                set: (ref, data, options) => operations.push(['set', ref, data, options]),
                update: (ref, data) => operations.push(['update', ref, data]),
                delete: ref => operations.push(['delete', ref]),
            };
            const result = await callback(transaction);
            if (state.failTransaction) {
                state.failTransaction = false;
                throw new Error('firestore-secret');
            }
            for (const [kind, ref, data, options] of operations) {
                if (kind === 'set') apply(ref, data, options?.merge === true);
                else if (kind === 'update') apply(ref, data, true);
                else map(ref.collection).delete(ref.id);
            }
            if (state.failAfterApply) {
                state.failAfterApply = false;
                throw new Error('firestore-after-apply-secret');
            }
            return result;
        },
    };
    const storageSdk = { ref: (_storage, path) => ({ path }), getBlob: async ref => { state.blobs += 1; return new globalThis.Blob([ref.path]); } };
    return { sdk, storageSdk, storage: {}, client: { db: {} }, state, map };
}

function put(fake, collection, id, data) { fake.map(collection).set(id, { ...data }); }

test('les dépôts indices séparent public/MJ et portent les requêtes publiques obligatoires', () => {
    const fake = makeFake();
    put(fake, 'indices', 'seen', { titre: 'Visible', decouvert: true, pnjsLies: [] });
    put(fake, 'indices', 'secret', { titre: 'Secret', decouvert: false, pnjsLies: [] });
    const publicRepo = createPublicIndicesRepository(fake);
    const mjRepo = createMjIndicesRepository(fake);
    assert.equal('create' in publicRepo, false);
    assert.equal(typeof mjRepo.create, 'function');
    const received = [];
    const unsubscribe = publicRepo.subscribeDiscovered((items, metadata) => received.push({ items, metadata }), error => { throw error; });
    const subscription = fake.state.subscriptions[0];
    assert.ok(subscription.target.constraints.some(item => item.field === 'decouvert' && item.value === true));
    subscription.next({ docs: [{ id: 'seen', data: () => ({ titre: 'Visible', decouvert: true, pnjsLies: [] }) }], metadata: {} });
    subscription.next({ docs: [{ id: 'seen', data: () => ({ titre: 'Visible', decouvert: true, pnjsLies: [] }) }], metadata: {} });
    assert.equal(received.length, 1);
    unsubscribe(); unsubscribe();
    subscription.next({ docs: [], metadata: {} });
    assert.equal(received.length, 1);
    publicRepo.subscribeLinked('p-1', () => {}, error => { throw error; });
    const linked = fake.state.subscriptions[1].target.constraints;
    assert.ok(linked.some(item => item.field === 'pnjsLies' && item.operator === 'array-contains'));
    assert.ok(linked.some(item => item.field === 'decouvert' && item.value === true));
});

test('les sorties indices exposent un descripteur legacy sans URL brute', () => {
    const fake = makeFake();
    const received = [];
    createPublicIndicesRepository(fake).subscribeDiscovered(items => received.push(items));
    const subscription = fake.state.subscriptions[0];
    subscription.next({ docs: [{ id: 'legacy', data: () => ({ titre: 'Legacy', decouvert: true, pnjsLies: [], imageUrl: 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp?alt=media&token=secret' }) }], metadata: {} });
    assert.equal(received[0][0].image.legacy, true);
    assert.equal(received[0][0].image.path, 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp');
    assert.equal(received[0][0].image.path.includes('token='), false);
    assert.equal(Object.hasOwn(received[0][0], 'imageUrl'), false);
    assert.equal(Object.hasOwn(received[0][0], 'imagePath'), false);
});

test('les sorties indices modernes gardent le chemin dans le descripteur', () => {
    const fake = makeFake();
    let result;
    createPublicIndicesRepository(fake).subscribeDiscovered(items => { result = items[0]; });
    fake.state.subscriptions[0].next({ docs: [{ id: 'modern', data: () => ({ titre: 'Modern', decouvert: true, pnjsLies: [], imagePath: 'indices/modern/a.webp' }) }], metadata: {} });
    assert.deepEqual(result.image, { path: 'indices/modern/a.webp', legacy: false, invalid: false });
    assert.equal(Object.hasOwn(result, 'imagePath'), false);
    assert.equal(Object.hasOwn(result, 'imageUrl'), false);
});

test('une erreur d index reste identifiable sans exposer sa cause technique', () => {
    const fake = makeFake();
    let received = null;
    createPublicIndicesRepository(fake).subscribeDiscovered(() => {}, error => { received = error; });
    fake.state.subscriptions[0].error({ code: 'failed-precondition', message: 'secret-index-details' });
    assert.equal(received.technicalCode, 'firestore-index-required');
    assert.equal(received.message.includes('secret-index-details'), false);
});

test('les mutations indices valident les liens, conflits et verrou global', async () => {
    const fake = makeFake();
    put(fake, 'pnjs', 'p-1', { suppressionEnCours: false });
    const repo = createMjIndicesRepository(fake);
    const created = await repo.create({ id: 'i-1', titre: 'Indice', decouvert: false, pnjsLies: ['p-1', 'p-1'] });
    assert.deepEqual(fake.map('indices').get(created.id).pnjsLies, ['p-1']);
    await assert.rejects(repo.update('i-1', { titre: 'conflit' }, { seconds: 99, nanoseconds: 0 }), error => error.kind === ERROR_KINDS.CONFLICT);
    await repo.addLinkedPnj('i-1', 'p-1');
    await repo.removeLinkedPnj('i-1', 'p-1');
    put(fake, 'integrity_locks', 'pnj-deletion', { pnjId: 'p-1' });
    await assert.rejects(repo.update('i-1', { titre: 'bloqué' }), error => error.kind === ERROR_KINDS.CONFLICT);
});

test('les doublons de liens sont dédupliqués avant la limite', async () => {
    const fake = makeFake();
    put(fake, 'pnjs', 'p-1', { suppressionEnCours: false });
    const repo = createMjIndicesRepository(fake);
    const created = await repo.create({ id: 'i-duplicates', titre: 'Indice', decouvert: false, pnjsLies: Array.from({ length: 101 }, () => 'p-1') });
    assert.deepEqual(fake.map('indices').get(created.id).pnjsLies, ['p-1']);
});

test('la suppression indice signale et reprend un échec Storage après Firestore', async () => {
    const fake = makeFake();
    put(fake, 'indices', 'i-1', { titre: 'Indice', decouvert: true, pnjsLies: [], imagePath: 'indices/i-1/a.webp' });
    let calls = 0;
    const repo = createMjIndicesRepository({ ...fake, imageService: { cleanupImage: async (_path, options) => { assert.equal(options.skipJournal, true); calls += 1; throw new Error('storage-secret'); } } });
    await assert.rejects(repo.remove('i-1'), error => error.state?.firestoreDone === true && error.state.imageCleanupPending === true
        && !error.message.includes('storage-secret'));
    assert.equal(fake.map('indices').has('i-1'), false);
    assert.equal(calls, 1);
});

test('update image nettoie le verrou sans dépendre du journal local', async () => {
    const fake = makeFake();
    fake.sdk.deleteField = () => ({ __deleteField: true });
    put(fake, 'indices', 'i-replace', { titre: 'Indice', decouvert: false, pnjsLies: [], imagePath: 'indices/i-replace/old.webp' });
    let calls = 0;
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        uploadClueImage: async id => ({ imagePath: `indices/${id}/new.webp` }), ackUpload: () => true,
        cleanupImage: async (_path, options) => { assert.equal(options.skipJournal, true); calls += 1; fake.map('integrity_locks/images/indices').delete('i-replace'); },
    } });
    await repo.update('i-replace', {}, undefined, { imageFile: new globalThis.Blob(['x'], { type: 'image/webp' }) });
    assert.equal(calls, 1);
});

test('resumeRemoval reprend un verrou avec journal local indisponible', async () => {
    const fake = makeFake();
    put(fake, 'integrity_locks/images/indices', 'i-resume', { ownerCollection: 'indices', ownerId: 'i-resume', path: 'indices/i-resume/old.webp' });
    let calls = 0;
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        cleanupImage: async (_path, options) => { assert.equal(options.skipJournal, true); calls += 1; fake.map('integrity_locks/images/indices').delete('i-resume'); },
    } });
    const result = await repo.resumeRemoval('i-resume');
    assert.equal(result.imageCleanupPending, false);
    assert.equal(calls, 1);
});

test('la suppression indice legacy conserve et signale imageUrl sans cleanup Storage', async () => {
    const fake = makeFake();
    put(fake, 'indices', 'i-legacy', { titre: 'Legacy', decouvert: true, pnjsLies: [], imageUrl: 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp?token=secret' });
    const repo = createMjIndicesRepository(fake);
    const result = await repo.remove('i-legacy');
    assert.equal(result.skippedLegacyImageUrl, 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp');
    assert.equal(result.skippedLegacyImageUrl.includes('token='), false);
    assert.equal(fake.map('indices').has('i-legacy'), false);
});

test('une imageUrl legacy hostile est signalée sans relayer sa valeur', async () => {
    const fake = makeFake();
    put(fake, 'indices', 'i-hostile', { titre: 'Hostile', decouvert: true, pnjsLies: [], imageUrl: 'https://user:secret@example.com/a.webp' });
    const result = await createMjIndicesRepository(fake).remove('i-hostile');
    assert.equal(result.legacyImageSkipped, true);
    assert.equal(result.legacyImageInvalid, true);
    assert.equal(result.skippedLegacyImageUrl, null);
    assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('update signale un imagePath protégé d un autre propriétaire sans le relayer', async () => {
    const fake = makeFake();
    put(fake, 'indices', 'i-owner', { titre: 'Indice', decouvert: false, pnjsLies: [], imagePath: 'indices/other/file.webp' });
    const result = await createMjIndicesRepository(fake).update('i-owner', { titre: 'Modifié' });
    assert.equal(result.skippedImagePathInvalid, true);
    assert.equal(result.skippedImagePathReason, 'owner-mismatch');
    assert.equal(JSON.stringify(result).includes('indices/other'), false);
});

test('update ack journal en échec ne relaye pas un ancien imagePath externe', async () => {
    const fake = makeFake();
    fake.sdk.deleteField = () => ({ __deleteField: true });
    put(fake, 'indices', 'i-ack-hostile', { titre: 'Indice', decouvert: false, pnjsLies: [], imagePath: 'gs://campagne-wrpg.firebasestorage.app/a.webp?token=secret' });
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        uploadClueImage: async id => ({ imagePath: `indices/${id}/new.webp` }), ackUpload: () => false,
    } });
    await assert.rejects(repo.update('i-ack-hostile', {}, undefined, { imageFile: new globalThis.Blob(['x'], { type: 'image/webp' }) }), error => {
        const serialized = JSON.stringify(error.state);
        return error.state?.journalPending === true && error.state.oldImagePath === null
            && error.state.skippedImagePathInvalid === true && !serialized.includes('token=') && !serialized.includes('secret');
    });
});

test('remove signale un imagePath externe canonisé sans token', async () => {
    const fake = makeFake();
    put(fake, 'indices', 'i-path-external', { titre: 'Indice', decouvert: false, pnjsLies: [], imagePath: 'gs://campagne-wrpg.firebasestorage.app/a.webp?token=secret' });
    const result = await createMjIndicesRepository(fake).remove('i-path-external');
    assert.equal(result.skippedImagePathInvalid, true);
    assert.equal(result.skippedImagePathReason, 'external-reference');
    assert.equal(result.skippedImagePath, null);
    assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('le descripteur protège les anciens chemins et bloque un imagePath moderne invalide', () => {
    assert.deepEqual(describeImage({ imagePath: null, imageUrl: 'gs://campagne-wrpg.firebasestorage.app/indices/i/a.webp' }),
        { path: 'gs://campagne-wrpg.firebasestorage.app/indices/i/a.webp', legacy: true, invalid: false });
    const normalizedLegacy = normalizeIndice({ id: 'i', data: { titre: 'I', decouvert: true, pnjsLies: [], imageUrl: 'gs://campagne-wrpg.firebasestorage.app/indices/i/a.webp' } });
    assert.equal(describeImage(normalizedLegacy).legacy, true);
    assert.equal(describeImage(normalizeIndice({ id: 'i', data: { titre: 'I', decouvert: true, pnjsLies: [], imageUrl: 'not-a-url' } })).invalid, true);
    assert.equal(describeImage({ imagePath: 'indices/i/../bad.webp', imageUrl: 'gs://campagne-wrpg.firebasestorage.app/indices/i/a.webp', issues: [{ field: 'imagePath', code: 'invalid-reference' }] }).invalid, true);
    assert.equal(describeImage({ imagePath: 'indices/i/../bad.webp' }).invalid, true);
    assert.equal(describeImage({ imageUrl: 'not-a-url' }).invalid, true);
    const userinfo = describeImage({ imageUrl: 'https://user:secret@example.com/portrait.webp' });
    assert.equal(userinfo.invalid, true);
    assert.equal(userinfo.path, null);
    assert.equal(JSON.stringify(userinfo).includes('secret'), false);
});

test('les images partagent une URL objet en mémoire et la révoquent au dernier handle', async () => {
    const fake = makeFake();
    let urls = 0;
    const repo = createPublicImagesRepository({ ...fake, createObjectUrl: () => `blob:${++urls}`, revokeObjectUrl: url => fake.state.revoked.push(url) });
    const first = repo.loadObjectUrl('indices/i-1/a.webp');
    const second = repo.loadObjectUrl('indices/i-1/a.webp');
    const [one, two] = await Promise.all([first, second]);
    assert.equal(one.url, two.url);
    assert.equal(fake.state.blobs, 1);
    one.release();
    assert.equal(fake.state.revoked.length, 0);
    two.release();
    assert.deepEqual(fake.state.revoked, [one.url]);
});

test('une ancienne lecture URL après close ne détache pas une nouvelle entrée', async () => {
    const fake = makeFake();
    let resolveFirst;
    let reads = 0;
    const storageSdk = { ref: (_storage, path) => ({ path }), getBlob: async ref => {
        reads += 1;
        if (reads === 1) return new Promise(resolve => { resolveFirst = () => resolve(new globalThis.Blob([ref.path])); });
        return new globalThis.Blob([ref.path]);
    } };
    let urls = 0;
    const revoked = [];
    const repo = createPublicImagesRepository({ ...fake, storageSdk,
        createObjectUrl: () => `blob:stale-${++urls}`, revokeObjectUrl: value => revoked.push(value) });
    const first = repo.loadObjectUrl('indices/i-stale/a.webp');
    await Promise.resolve();
    repo.close();
    const second = repo.loadObjectUrl('indices/i-stale/a.webp');
    const secondValue = await second;
    resolveFirst();
    const firstValue = await first;
    secondValue.release();
    assert.equal(firstValue.url !== secondValue.url, true);
    assert.deepEqual(revoked.sort(), [firstValue.url, secondValue.url].sort());
});

test('upload image exige un Blob raster, un chemin propriétaire et une réponse déterministe', async () => {
    const fake = makeFake();
    const repo = createMjImagesRepository({ ...fake, journal: { remember: async () => true, forget: () => true }, uploader: async (_file, context) => {
        assert.deepEqual(Object.keys(context).sort(), ['contentType', 'kind', 'ownerId']);
        const { kind, ownerId, contentType } = context;
        return { imagePath: `${kind === 'indice' ? 'indices' : 'portraits'}/${ownerId}/upload.${contentType.split('/')[1]}` };
    } });
    const uploaded = await repo.uploadClueImage('i-1', new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: 'secret' });
    assert.equal(uploaded.imagePath, 'indices/i-1/upload.webp');
    await assert.rejects(repo.uploadClueImage('i-1', new globalThis.Blob(['x'], { type: 'text/plain' })), error => error.kind === ERROR_KINDS.VALIDATION);
});

test('un remplacement vers le même chemin ne laisse pas de verrou image', async () => {
    const fake = makeFake();
    fake.sdk.deleteField = () => ({ __deleteField: true });
    put(fake, 'indices', 'i-same', { titre: 'Indice', decouvert: false, pnjsLies: [], imagePath: 'indices/i-same/a.webp', imageUrl: 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp' });
    let cleanups = 0;
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        uploadClueImage: async id => ({ imagePath: `indices/${id}/a.webp` }), ackUpload: () => true,
        cleanupImage: async () => { cleanups += 1; }, remove: async () => {},
    } });
    const result = await repo.update('i-same', {}, undefined, { imageFile: new globalThis.Blob(['x'], { type: 'image/webp' }) });
    assert.equal(cleanups, 0);
    assert.equal(result.skippedLegacyImageUrl, 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp');
    assert.equal(fake.map('integrity_locks/images/indices').has('i-same'), false);
});

test('un conflit update avec le même chemin passe par le cleanup non-référencé', async () => {
    const fake = makeFake();
    fake.sdk.deleteField = () => ({ __deleteField: true });
    put(fake, 'indices', 'i-conflict-image', { titre: 'Indice', decouvert: false, pnjsLies: [], imagePath: 'indices/i-conflict-image/a.webp' });
    let cleanups = 0;
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        uploadClueImage: async id => ({ imagePath: `indices/${id}/a.webp` }), ackUpload: () => true,
        cleanupImage: async (_path, options) => { cleanups += 1; assert.equal(options.skipJournal, true); return { skipped: true }; },
    } });
    await assert.rejects(repo.update('i-conflict-image', { titre: 'conflit' }, { seconds: 99, nanoseconds: 0 }, {
        imageFile: new globalThis.Blob(['x'], { type: 'image/webp' }),
    }), error => error.state?.commitUnknown === true);
    assert.equal(cleanups, 1);
});

test('une réponse callable étrangère est signalée sans suppression arbitraire', async () => {
    const fake = makeFake();
    let removed = 0;
    const repo = createMjImagesRepository({ ...fake,
        journal: { remember: async () => true },
        uploader: async (_file, _context) => ({ imagePath: 'indices/other/file.webp' }),
        cleanup: { remove: async () => { removed += 1; } } });
    await assert.rejects(repo.uploadClueImage('i-1', new globalThis.Blob(['x'], { type: 'image/webp' })), error =>
        error.state?.compensationSkipped === true && error.state.responsePathInvalid === true
        && error.state.responsePathReason === 'owner-mismatch' && !JSON.stringify(error.state).includes('other'));
    assert.equal(removed, 0);
});

test('une réponse callable URL tokenisée ne fuit pas son chemin', async () => {
    const fake = makeFake();
    const repo = createMjImagesRepository({ ...fake, journal: { remember: async () => true },
        uploader: async () => ({ imagePath: 'https://user:secret@example.com/a.webp?token=secret' }),
    });
    await assert.rejects(repo.uploadClueImage('i-1', new globalThis.Blob(['x'], { type: 'image/webp' })), error =>
        error.state?.responsePathInvalid === true && error.state.responsePathReason === 'external-reference'
        && !JSON.stringify(error.state).includes('secret'));
});

test('cleanupImage refuse un chemin ou propriétaire incohérent avant le service', async () => {
    const fake = makeFake();
    let called = 0;
    const repo = createMjImagesRepository({ ...fake,
        cleanup: { unreferenced: async () => { called += 1; } },
    });
    await assert.rejects(repo.cleanupImage('indices/i-1/file.webp', { collection: 'indices', ownerId: 'other' }),
        error => error.kind === ERROR_KINDS.VALIDATION);
    assert.equal(called, 0);
});

test('remove externe canonise token et refuse userinfo sans relayer le secret', async () => {
    const fake = makeFake();
    const repo = createMjImagesRepository({ ...fake });
    const safe = await repo.remove('gs://campagne-wrpg.firebasestorage.app/legacy/a.webp?token=secret');
    assert.equal(safe.path, 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp');
    assert.equal(safe.legacyImageInvalid, false);
    const hostile = await repo.remove('https://user:secret@example.com/a.webp');
    assert.equal(hostile.path, null);
    assert.equal(hostile.legacyImageInvalid, true);
    assert.equal(JSON.stringify(hostile).includes('secret'), false);
});

test('la date normalisée est convertie en valeur Firestore et non en map', async () => {
    const fake = makeFake();
    const repo = createMjIndicesRepository(fake);
    await repo.create({ id: 'i-date', titre: 'Date', decouvert: false, pnjsLies: [], dateDecouverte: { seconds: 12, nanoseconds: 0 } });
    assert.ok(fake.map('indices').get('i-date').dateDecouverte instanceof Date);
});

test('une transaction appliquée puis rejetée reste commitUnknown et est réconciliable', async () => {
    const fake = makeFake();
    fake.state.failAfterApply = true;
    const repo = createMjIndicesRepository(fake);
    await assert.rejects(repo.create({ id: 'i-uncertain', titre: 'Indice', decouvert: false, pnjsLies: [] }), error =>
        error.state?.commitUnknown === true && error.state?.commitDone !== false);
    assert.equal(fake.map('indices').has('i-uncertain'), true);
});

test('un échec de journal après upload compense immédiatement le fichier', async () => {
    const fake = makeFake();
    let cleanupCalls = 0;
    let deleted = 0;
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/upload.${contentType.split('/')[1]}` }),
        journal: { remember: async () => false }, cleanup: { unreferenced: async (_path, options) => { assert.equal(options.skipJournal, true); cleanupCalls += 1; return { skipped: true, reason: 'reference-conservee', deleted }; } } });
    await assert.rejects(repo.uploadClueImage('i-1', new globalThis.Blob(['x'], { type: 'image/webp' })), error => error.kind === ERROR_KINDS.UNKNOWN || error.kind === ERROR_KINDS.VALIDATION);
    assert.equal(cleanupCalls, 1);
    assert.equal(deleted, 0);
});

test('la création image compense si Firestore échoue après le téléversement', async () => {
    const fake = makeFake();
    let removed = 0;
    fake.state.failTransaction = true;
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        uploadClueImage: async id => ({ imagePath: `indices/${id}/new.webp` }),
        remove: async () => { removed += 1; }, cleanupImage: async () => { removed += 1; }, ackUpload: () => true,
    } });
    await assert.rejects(repo.create({ id: 'i-fail', titre: 'Fail', decouvert: false, pnjsLies: [] }, { imageFile: new globalThis.Blob(['x'], { type: 'image/webp' }) }),
        error => !error.message.includes('firestore-secret'));
    assert.equal(removed, 1);
    assert.equal(fake.map('indices').has('i-fail'), false);
});

test('une réponse image indice hostile ne ressort jamais dans l état', async () => {
    const fake = makeFake();
    const repo = createMjIndicesRepository({ ...fake, imageService: {
        uploadClueImage: async () => ({ imagePath: 'https://user:secret@example.com/a.webp' }),
    } });
    await assert.rejects(repo.create({ id: 'i-hostile-upload', titre: 'Hostile', decouvert: false, pnjsLies: [] }, {
        imageFile: new globalThis.Blob(['x'], { type: 'image/webp' }),
    }), error => error.state?.responsePathInvalid === true && error.state?.compensationSkipped === true
        && !JSON.stringify(error.state).includes('secret'));
});

test('replace conserve l ancien jusqu au commit puis nettoie par non-référence', async () => {
    const fake = makeFake();
    const events = [];
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => { events.push('upload'); return { imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }; },
        journal: { remember: async () => { events.push('remember'); return true; }, forget: () => events.push('forget') },
        cleanup: { unreferenced: async () => events.push('cleanup') },
    });
    const result = await repo.replace('indices/i-1/old.webp', { kind: 'indice', ownerId: 'i-1' }, new globalThis.Blob(['x'], { type: 'image/webp' }), {
        commit: async () => events.push('commit'),
    });
    assert.equal(result.cleanupPending, false);
    // Le nouveau fichier reste journalisé jusqu'à la fin du nettoyage de
    // l'ancien : un crash après commit reste ainsi reprenable.
    assert.deepEqual(events, ['remember', 'upload', 'remember', 'commit', 'cleanup', 'forget', 'forget']);
});

test('replace commit failure leaves l ancien et compense le nouveau', async () => {
    const fake = makeFake();
    let removed = 0;
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }),
        journal: { remember: async () => true, forget: () => true },
        cleanup: { unreferenced: async () => { removed += 1; } },
    });
    await assert.rejects(repo.replace('indices/i-1/old.webp', { kind: 'indice', ownerId: 'i-1' }, new globalThis.Blob(['x'], { type: 'image/webp' }), {
        commit: async () => { throw new Error('commit-secret'); },
    }), error => error.state?.commitUnknown === true && error.state?.commitDone !== false && !error.message.includes('commit-secret'));
    assert.equal(removed, 1);
});

test('replace commit incertain conserve le journal de l ancien', async () => {
    const fake = makeFake();
    const forgotten = [];
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }),
        journal: { remember: async () => true, forget: path => forgotten.push(path) },
        cleanup: { unreferenced: async () => ({ skipped: true, reason: 'reference-conservee' }) },
    });
    await assert.rejects(repo.replace('indices/i-uncertain/old.webp', { kind: 'indice', ownerId: 'i-uncertain' },
        new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: async () => { throw new Error('commit-unknown-secret'); } }),
        error => error.state?.commitUnknown === true && !error.message.includes('commit-unknown-secret'));
    assert.equal(forgotten.includes('indices/i-uncertain/old.webp'), false);
});

test('replace signale un cleanup ancien en échec après commit', async () => {
    const fake = makeFake();
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }),
        journal: { remember: async () => true, forget: () => true },
        cleanup: { unreferenced: async () => { throw new Error('cleanup-secret'); } },
    });
    await assert.rejects(repo.replace('indices/i-1/old.webp', { kind: 'indice', ownerId: 'i-1' }, new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: async () => {} }),
        error => error.state?.commitDone === true && error.state?.cleanupPending === true && !error.message.includes('cleanup-secret'));
});

test('replace externe canonise ou invalide l ancienne URL sans fuite', async () => {
    const fake = makeFake();
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }),
        journal: { remember: async () => true, forget: () => true },
    });
    const safe = await repo.replace('gs://campagne-wrpg.firebasestorage.app/legacy/a.webp?token=secret',
        { kind: 'indice', ownerId: 'i-external' }, new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: async () => {} });
    assert.equal(safe.skippedOldPath, 'gs://campagne-wrpg.firebasestorage.app/legacy/a.webp');
    const hostile = await repo.replace('https://user:secret@example.com/a.webp',
        { kind: 'indice', ownerId: 'i-external' }, new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: async () => {} });
    assert.equal(hostile.skippedOldPath, null);
    assert.equal(hostile.skippedOldPathInvalid, true);
    assert.equal(JSON.stringify(hostile).includes('secret'), false);
});

test('replace refuse silencieusement le cleanup d un ancien chemin d autre propriétaire', async () => {
    const fake = makeFake();
    const remembered = [];
    let cleanups = 0;
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }),
        journal: { remember: async entry => { remembered.push(entry.path); return true; }, forget: () => {} },
        cleanup: { unreferenced: async () => { cleanups += 1; } },
    });
    const result = await repo.replace('indices/other/file.webp', { kind: 'indice', ownerId: 'i-owner' },
        new globalThis.Blob(['x'], { type: 'image/webp' }), { commit: async () => {} });
    assert.equal(result.skippedOldPath, null);
    assert.equal(result.skippedOldPathInvalid, true);
    assert.equal(result.skippedOldPathReason, 'owner-mismatch');
    assert.deepEqual(remembered, ['indices/i-owner/new.webp']);
    assert.equal(cleanups, 0);
});

test('les erreurs replace ne relaient jamais l ancienne URL legacy brute', async () => {
    const fake = makeFake();
    const repo = createMjImagesRepository({ ...fake,
        uploader: async (_file, { ownerId, contentType }) => ({ imagePath: `indices/${ownerId}/new.${contentType.split('/')[1]}` }),
        journal: { remember: async () => true, forget: () => {} },
        cleanup: { unreferenced: async () => ({ skipped: true }) },
    });
    let tokenError;
    try {
        await repo.replace('gs://campagne-wrpg.firebasestorage.app/a.webp?token=secret',
            { kind: 'indice', ownerId: 'i-error' }, new globalThis.Blob(['x'], { type: 'image/webp' }),
            { commit: async () => { throw new Error('commit-secret'); } });
    } catch (error) { tokenError = error; }
    assert.equal(tokenError.state?.commitUnknown, true);
    assert.equal(JSON.stringify(tokenError.state).includes('token='), false);
    assert.equal(tokenError.state.skippedOldPath, 'gs://campagne-wrpg.firebasestorage.app/a.webp');
    let userInfoError;
    try {
        await repo.replace('https://user:secret@example.com/a.webp',
            { kind: 'indice', ownerId: 'i-error' }, new globalThis.Blob(['x'], { type: 'image/webp' }),
            { commit: async () => { throw new Error('commit-secret'); } });
    } catch (error) { userInfoError = error; }
    assert.equal(userInfoError.state?.commitUnknown, true);
    assert.equal(JSON.stringify(userInfoError.state).includes('secret'), false);
    assert.equal(userInfoError.state.oldPath, null);
    assert.equal(userInfoError.state.skippedOldPathInvalid, true);
});

test('un abandon pendant le chargement révoque l URL dès sa résolution', async () => {
    const fake = makeFake();
    let resolveBlob;
    fake.storageSdk.getBlob = () => new Promise(resolve => { resolveBlob = resolve; });
    const repo = createPublicImagesRepository({ ...fake, createObjectUrl: () => 'blob:abandon', revokeObjectUrl: url => fake.state.revoked.push(url) });
    const pending = repo.loadObjectUrl('indices/i-1/a.webp');
    pending.release();
    resolveBlob(new globalThis.Blob(['x']));
    const loaded = await pending;
    assert.equal(loaded.url, 'blob:abandon');
    assert.deepEqual(fake.state.revoked, ['blob:abandon']);
    loaded.release();
});

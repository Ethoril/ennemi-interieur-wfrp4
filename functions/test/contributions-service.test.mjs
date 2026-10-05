import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    ContributionError,
    getCampaignCapabilities,
    getContentEditContext,
    getContentHistory,
    getContentPnjChoices,
    listContentTrash,
    listPendingPurgeCleanups,
    mutatePublicContent,
    mutateMjContent,
    purgePublicContent,
    restorePublicContent,
    setTrashVisibility,
    trashPublicContent,
    uploadContributionImage,
} from '../src/contributions/service.mjs';

const MJ = { auth: { uid: 'mj-1', token: { email: 'ethoril@gmail.com', email_verified: true } } };
const PLAYER = { auth: { uid: 'player-1', token: { email: 'player@example.test', email_verified: true } } };
const OTHER = { auth: { uid: 'other-1', token: { email: 'other@example.test', email_verified: true } } };
const OUTSIDER = { auth: { uid: 'outside-1', token: { email: 'outside@example.test', email_verified: true } } };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function snap(path, value) {
    return { id: path.split('/').at(-1), ref: ref(path), exists: () => value !== undefined, data: () => clone(value) };
}
function ref(path) {
    return {
        path,
        get: async () => snap(path, state.documents.get(path)),
        collection(name) { return collection(`${path}/${name}`); },
    };
}
function collection(path) {
    return query(path);
}
function query(path, filters = [], options = {}) {
    const q = {
        path, filters, ...options,
        doc(id) { return ref(`${path}/${id}`); },
        where(field, operator, value) { return query(path, [...filters, { field, operator, value }], options); },
        orderBy(field, direction) { return query(path, filters, { ...options, order: [field, direction] }); },
        limit(value) { return query(path, filters, { ...options, limit: value }); },
        startAfter(cursor) { return query(path, filters, { ...options, after: cursor?.id }); },
        async get() {
            const prefix = `${path}/`;
            let docs = [...state.documents.entries()].filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .filter(([, value]) => filters.every(({ field, operator, value: expected }) => {
                    const actual = value[field];
                    return operator === '==' ? actual === expected
                        : operator === 'array-contains' ? Array.isArray(actual) && actual.includes(expected) : false;
                }))
                .map(([key, value]) => snap(key, value));
            if (options.order) {
                const [field, direction] = options.order;
                docs.sort((left, right) => (left.data()?.[field] ?? 0) < (right.data()?.[field] ?? 0) ? (direction === 'desc' ? 1 : -1) : 0);
            }
            if (options.after) {
                const index = docs.findIndex(doc => doc.id === options.after);
                if (index >= 0) docs = docs.slice(index + 1);
            }
            if (options.limit !== undefined) docs = docs.slice(0, options.limit);
            return { docs, size: docs.length, empty: docs.length === 0 };
        },
    };
    return q;
}

let state;
function createStore(seed = {}) {
    state = { documents: new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)])) };
    const db = {
        doc: ref,
        collection,
        async runTransaction(callback) {
            const writes = new Map();
            let writing = false;
            const transaction = {
                async get(reference) {
                    if (writing) throw new Error('read after write');
                    if (typeof reference.get === 'function' && !reference.path) return reference.get();
                    if (typeof reference.get === 'function' && reference.path && !reference.path.includes('/')) return reference.get();
                    if (typeof reference.get === 'function' && reference.filters) return reference.get();
                    return snap(reference.path, state.documents.get(reference.path));
                },
                set(reference, value) { writing = true; writes.set(reference.path, ['set', clone(value)]); },
                update(reference, value) { writing = true; writes.set(reference.path, ['update', clone(value)]); },
                delete(reference) { writing = true; writes.set(reference.path, ['delete']); },
            };
            const result = await callback(transaction);
            for (const [path, [action, value]] of writes) {
                if (action === 'delete') state.documents.delete(path);
                else if (action === 'update') state.documents.set(path, { ...state.documents.get(path), ...value });
                else state.documents.set(path, value);
            }
            return clone(result);
        },
    };
    return { db, documents: state.documents };
}

function dependencies(store) {
    let tick = 0;
    const storage = new Map();
    return {
        db: store.db,
        timestamp: () => ++tick,
        deleteField: () => null,
        bucket: { file(path) {
            return {
                async getMetadata() {
                    if (!storage.has(path)) { const error = new Error('missing'); error.code = 404; throw error; }
                    return [storage.get(path)];
                },
                async save(bytes, options) {
                    const metadata = { size: bytes.length, contentType: options.metadata.contentType,
                        cacheControl: options.metadata.cacheControl, md5Hash: createHash('md5').update(bytes).digest('base64'), metadata: {} };
                    storage.set(path, metadata);
                },
                async delete() { storage.delete(path); },
            };
        } },
        storage,
    };
}

function access() { return { bhelgi: ['player@example.test', 'other@example.test'] }; }

test('les choix PNJ ne renvoient que id et nom et excluent les cachés pour un joueur', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/a': { nom: 'Aline', visibleJoueurs: true },
        'pnjs/b': { nom: 'Boris', visibleJoueurs: true, suppressionEnCours: true },
        'pnjs/c': { nom: 'Secret', visibleJoueurs: false, notes: 'private' },
    });
    const deps = dependencies(store);
    assert.deepEqual(await getContentPnjChoices({ ...PLAYER, data: { limit: 1 } }, deps), {
        pnjs: [{ id: 'a', nom: 'Aline' }], nextCursor: 'a',
    });
    assert.deepEqual(await getContentPnjChoices({ ...PLAYER, data: { cursor: 'a' } }, deps), { pnjs: [], nextCursor: null });
    assert.deepEqual(await getContentPnjChoices(MJ, deps), { pnjs: [{ id: 'a', nom: 'Aline' }, { id: 'c', nom: 'Secret' }], nextCursor: null });
    await assert.rejects(getContentPnjChoices(OUTSIDER, deps), error => error.code === 'permission-denied');
});

test('une création MJ conserve atomiquement le statut secret et un joueur ne peut pas le forger', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    await rejectsCode(mutatePublicContent({ kind: 'pnj', action: 'create', id: 'forged-secret', operationId: 'player-hidden-create',
        baseRevision: 0, changes: { nom: 'Secret forgé', visibleJoueurs: false } }, PLAYER, deps), 'permission-denied');
    await mutatePublicContent({ kind: 'pnj', action: 'create', id: 'mj-secret-create', operationId: 'mj-hidden-create',
        baseRevision: 0, changes: { nom: 'Secret MJ', groupes: [], visibleJoueurs: false } }, MJ, deps);
    assert.equal(store.documents.get('pnjs/mj-secret-create').visibleJoueurs, false);
});
function pnj(id, fields = {}) { return { nom: id, visibleJoueurs: true, groupes: [], createdAt: 1, ...fields }; }
async function rejectsCode(promise, code, kind) {
    await assert.rejects(promise, error => error.code === code && (kind === undefined || error.details?.kind === kind));
}

test('capabilities et contexte restent allowlistés et ne divulguent pas les emails ni les relations vers un PNJ caché', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/secret': pnj('secret', { visibleJoueurs: false, privateNotes: 'secret note' }),
        'pnjs/public': pnj('public'),
        'relations/r-secret': { source: 'secret', cible: 'public', type: 'ami', visibleJoueurs: true },
    });
    const deps = dependencies(store);
    assert.deepEqual(await getCampaignCapabilities(PLAYER, deps), { role: 'joueur', contribution: true, characterIds: ['bhelgi'] });
    assert.equal(JSON.stringify(await getCampaignCapabilities({}, deps)).includes('player@example.test'), false);
    await rejectsCode(getContentEditContext({ ...PLAYER, data: { kind: 'relation', id: 'r-secret' } }, deps), 'not-found');
});

test('création, historique et fusion trois voies conservent seulement les champs publics', async () => {
    const store = createStore({ 'campagne/acces': access(), 'pnjs/anchor': pnj('anchor') });
    const deps = dependencies(store);
    const created = await mutatePublicContent({
        kind: 'pnj', action: 'create', id: 'new-pnj', operationId: 'create-1', baseRevision: 0,
        changes: { nom: 'Mara', groupes: ['La Vigie'] },
    }, PLAYER, deps);
    assert.equal(created.revision, 1);
    assert.equal(store.documents.get('pnjs/new-pnj').visibleJoueurs, true);
    assert.equal(created.ownerUid, undefined);
    const edited = await mutatePublicContent({
        kind: 'pnj', action: 'update', id: 'new-pnj', operationId: 'edit-1', baseRevision: 1,
        changes: { description: 'Une piste.' }, baseValues: { description: '' },
    }, PLAYER, deps);
    assert.equal(edited.revision, 2);
    const history = await getContentHistory({ ...PLAYER, data: { kind: 'pnj', id: 'new-pnj' } }, deps);
    assert.equal(history.events.length, 2);
    assert.equal(history.events[0].role, 'joueur');
    assert.equal(history.events[0].actor, 'self');
});

test('deux bases anciennes fusionnent sur des champs distincts et bloquent le même champ concurrent', async () => {
    const store = createStore({
        'campagne/acces': access(), 'pnjs/mine': pnj('Mien', { description: '', lieu: '' }),
        'content_metadata/pnj_mine': { kind: 'pnj', contentId: 'mine', ownerUid: 'player-1', revision: 4, state: 'active' },
    });
    const deps = dependencies(store);
    await mutatePublicContent({ kind: 'pnj', action: 'update', id: 'mine', operationId: 'field-a', baseRevision: 4,
        changes: { description: 'Texte A' }, baseValues: { description: '' } }, PLAYER, deps);
    await mutatePublicContent({ kind: 'pnj', action: 'update', id: 'mine', operationId: 'field-b', baseRevision: 4,
        changes: { lieu: 'Middenheim' }, baseValues: { lieu: '' } }, OTHER, deps);
    assert.equal(store.documents.get('pnjs/mine').description, 'Texte A');
    assert.equal(store.documents.get('pnjs/mine').lieu, 'Middenheim');
    await rejectsCode(mutatePublicContent({ kind: 'pnj', action: 'update', id: 'mine', operationId: 'field-c', baseRevision: 4,
        changes: { description: 'Texte B' }, baseValues: { description: '' } }, PLAYER, deps), 'aborted', 'conflict');
});

test('un champ public absent utilise null comme base et peut être ajouté sans faux conflit', async () => {
    const store = createStore({ 'campagne/acces': access(), 'indices/clue': {
        titre: 'Indice', description: '', source: '', type: '', decouvert: true, pnjsLies: [],
    } });
    const deps = dependencies(store);
    const context = await getContentEditContext({ ...PLAYER, data: { kind: 'indice', id: 'clue' } }, deps);
    assert.equal(Object.hasOwn(context.data, 'dateDecouverte'), false);
    await mutatePublicContent({ kind: 'indice', action: 'update', id: 'clue', operationId: 'add-date', baseRevision: context.revision,
        changes: { dateDecouverte: null }, baseValues: { dateDecouverte: null } }, PLAYER, deps);
    assert.equal(store.documents.get('indices/clue').dateDecouverte, null);
});

test('un reçu de contribution est retourné seulement après nouvelle validation de l’accès', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const command = { kind: 'pnj', action: 'create', id: 'receipt-pnj', operationId: 'receipt-op', baseRevision: 0, changes: { nom: 'Mara' } };
    const first = await mutatePublicContent(command, PLAYER, deps);
    assert.equal((await mutatePublicContent(command, PLAYER, deps)).revision, first.revision);
    store.documents.set('campagne/acces', { bhelgi: [] });
    await rejectsCode(mutatePublicContent(command, PLAYER, deps), 'permission-denied');
});

test('édition d’indice conserve côté serveur les références héritées vers PNJ cachés sans les rendre à l’appelant', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/visible': pnj('visible'),
        'pnjs/hidden': pnj('hidden', { visibleJoueurs: false }),
        'indices/clue': { titre: 'Indice', description: '', source: '', type: '', decouvert: true, pnjsLies: ['hidden', 'visible'] },
        'content_metadata/indice_clue': { kind: 'indice', contentId: 'clue', ownerUid: 'player-1', revision: 1, state: 'active' },
    });
    const deps = dependencies(store);
    const context = await getContentEditContext({ ...PLAYER, data: { kind: 'indice', id: 'clue' } }, deps);
    assert.deepEqual(context.data.pnjsLies, ['visible']);
    await mutatePublicContent({
        kind: 'indice', action: 'update', id: 'clue', operationId: 'clue-edit', baseRevision: 1,
        changes: { titre: 'Indice modifié' }, baseValues: { titre: 'Indice' },
    }, PLAYER, deps);
    assert.deepEqual(store.documents.get('indices/clue').pnjsLies, ['hidden', 'visible']);
    assert.equal(JSON.stringify(store.documents.get('content_history/indice_clue/events/clue-edit')).includes('hidden'), false);
    store.documents.set('content_history/indice_clue/events/old-link-change', {
        kind: 'indice', operationId: 'old-link-change', action: 'update', revision: 0, actorUid: 'other-1', role: 'joueur',
        changes: { pnjsLies: { before: ['hidden', 'visible'], after: ['hidden'] } },
    });
    const history = await getContentHistory({ ...PLAYER, data: { kind: 'indice', id: 'clue' } }, deps);
    assert.deepEqual(history.events.find(event => event.operationId === 'old-link-change').changes.pnjsLies,
        { before: ['visible'], after: [] });
});

test('création et édition d’une paire de relations restent réciproques et atomiques', async () => {
    const store = createStore({ 'campagne/acces': access(), 'pnjs/a': pnj('A'), 'pnjs/b': pnj('B') });
    const deps = dependencies(store);
    const created = await mutatePublicContent({
        kind: 'relation', action: 'create', pair: true, operationId: 'pair-create', baseRevision: 0,
        changes: { source: 'a', cible: 'b', type: 'allié', label: 'Allié', style: 'solid' },
    }, PLAYER, deps);
    assert.ok(created.reciprocalId);
    const primary = store.documents.get(`relations/${created.id}`);
    const reverse = store.documents.get(`relations/${created.reciprocalId}`);
    assert.equal(primary.source, reverse.cible);
    assert.equal(primary.cible, reverse.source);
    assert.equal(store.documents.get(`content_metadata/relation_${created.id}`).reciprocalId, created.reciprocalId);

    await mutatePublicContent({
        kind: 'relation', action: 'update', id: created.id, operationId: 'pair-edit', baseRevision: 1,
        reciprocalId: created.reciprocalId, reciprocalBaseRevision: 1,
        changes: { label: 'Compagnon' }, baseValues: { label: 'Allié' },
    }, PLAYER, deps);
    assert.equal(store.documents.get(`relations/${created.id}`).label, 'Compagnon');
    assert.equal(store.documents.get(`relations/${created.reciprocalId}`).label, 'Compagnon');
    assert.equal(store.documents.get(`content_metadata/relation_${created.reciprocalId}`).revision, 2);
    await trashPublicContent({ kind: 'relation', id: created.id, operationId: 'pair-trash', baseRevision: 2 }, PLAYER, deps);
    assert.equal(store.documents.has(`relations/${created.id}`), false);
    assert.equal(store.documents.has(`relations/${created.reciprocalId}`), false);
    const restored = await restorePublicContent({ kind: 'relation', id: created.id, operationId: 'pair-restore', baseRevision: 3 }, PLAYER, deps);
    assert.equal(restored.restoredDependencies, 1);
    assert.equal(store.documents.get(`relations/${created.reciprocalId}`).source, 'b');
});

test('trash et restauration propres respectent propriétaire, révocation et entrée MJ non-restaurable', async () => {
    const store = createStore({
        'campagne/acces': access(), 'pnjs/mine': pnj('Mien'),
        'content_metadata/pnj_mine': { kind: 'pnj', contentId: 'mine', ownerUid: 'player-1', revision: 3, state: 'active' },
    });
    const deps = dependencies(store);
    const trashed = await trashPublicContent({ kind: 'pnj', id: 'mine', operationId: 'trash-1', baseRevision: 3 }, PLAYER, deps);
    assert.equal(trashed.state, 'trashed');
    assert.equal(store.documents.has('pnjs/mine'), false);
    await rejectsCode(restorePublicContent({ kind: 'pnj', id: 'mine', operationId: 'foreign-restore', baseRevision: 4 }, OTHER, deps), 'permission-denied');
    assert.equal((await listContentTrash({ ...PLAYER, data: {} }, deps)).entries.length, 1);
    const locked = await setTrashVisibility({ kind: 'pnj', id: 'mine', operationId: 'hide-trash', baseRevision: 4, ownerCanRestore: false }, MJ, deps);
    assert.equal(locked.ownerCanRestore, false);
    assert.equal((await listContentTrash({ ...PLAYER, data: {} }, deps)).entries.length, 0);
    await rejectsCode(restorePublicContent({ kind: 'pnj', id: 'mine', operationId: 'blocked-restore', baseRevision: 4 }, PLAYER, deps), 'permission-denied');
    store.documents.set('campagne/acces', { bhelgi: [] });
    await rejectsCode(trashPublicContent({ kind: 'pnj', id: 'mine', operationId: 'trash-1', baseRevision: 3 }, PLAYER, deps), 'permission-denied');
    const restored = await restorePublicContent({ kind: 'pnj', id: 'mine', operationId: 'restore-mj', baseRevision: 4 }, MJ, deps);
    assert.equal(restored.state, 'active');
    assert.equal(store.documents.get('pnjs/mine').visibleJoueurs, true);
    store.documents.set('campagne/acces', access());
    await trashPublicContent({ kind: 'pnj', id: 'mine', operationId: 'trash-again', baseRevision: 5 }, PLAYER, deps);
    assert.equal(store.documents.get('content_trash_archive/pnj_mine_4').state, 'archived');
    await purgePublicContent({ kind: 'pnj', id: 'mine', operationId: 'purge-all', baseRevision: 6 }, MJ, deps);
    assert.equal(store.documents.has('content_trash_archive/pnj_mine_4'), false);
    assert.equal(store.documents.get('content_trash/pnj_mine').state, 'purged');
});

function seedPurgeImage(store, deps, { id = 'purge-photo', path = `portraits/${id}/portrait-op.png`, reservationState = 'consumed' } = {}) {
    store.documents.set(`content_trash/pnj_${id}`, {
        kind: 'pnj', contentId: id, state: 'trashed', revision: 3,
        data: { nom: 'À purger', imagePath: path }, dependencies: [],
    });
    store.documents.set(`content_metadata/pnj_${id}`, { kind: 'pnj', contentId: id, revision: 3, state: 'trashed' });
    store.documents.set(`content_image_reservations/pnj_${id}_op`, {
        kind: 'pnj', contentId: id, path, operationId: 'op', state: reservationState, uid: 'mj-1',
    });
    deps.storage.set(path, { contentType: 'image/png' });
    return path;
}

test('purge committe avant Storage, marque audit et supprime une image devenue orpheline', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    let committedBeforeDelete = false;
    const originalFile = deps.bucket.file.bind(deps.bucket);
    deps.bucket.file = value => {
        const file = originalFile(value);
        return { ...file, async delete(options) {
            committedBeforeDelete = store.documents.get('content_trash/pnj_purge-photo')?.state === 'purged'
                && Boolean(store.documents.get('content_purge_audit/purge-image')?.paths?.length);
            assert.deepEqual(options, { ignoreNotFound: true });
            return file.delete(options);
        } };
    };

    const result = await purgePublicContent({ kind: 'pnj', id: 'purge-photo', operationId: 'purge-image', baseRevision: 3 }, MJ, deps);
    assert.equal(committedBeforeDelete, true);
    assert.equal(deps.storage.has(path), false);
    assert.deepEqual(result.cleanup, { status: 'complete', candidates: 1, deleted: 1, missing: 0, retained: 0, pending: 0, retryable: 0 });
    assert.equal(store.documents.get('content_image_reservations/pnj_purge-photo_op').state, 'purging');
    assert.equal(store.documents.get('content_trash/pnj_purge-photo').cleanupStatus, 'complete');
    assert.equal(store.documents.get('content_purge_audit/purge-image').paths[0].state, 'deleted');
    assert.equal(store.documents.get('content_operations/purge-image').response.cleanup.status, 'complete');
});

test('purge conserve toute image référencée par une fiche active, une autre corbeille ou une archive', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    store.documents.set('indices/active-ref', { titre: 'Actif', imagePath: path });
    store.documents.set('content_trash/indice-other', { kind: 'indice', contentId: 'other', state: 'trashed', data: { titre: 'Corbeille', imagePath: path } });
    store.documents.set('content_trash_archive/pnj_old_2', { rootKey: 'pnj_old', kind: 'pnj', contentId: 'old', state: 'archived',
        data: { nom: 'Archive', imagePath: null }, dependencies: [{ kind: 'indice', contentId: 'old-index', data: { imagePath: path } }] });

    const result = await purgePublicContent({ kind: 'pnj', id: 'purge-photo', operationId: 'purge-shared', baseRevision: 3 }, MJ, deps);
    assert.equal(deps.storage.has(path), true);
    assert.equal(result.cleanup.status, 'retained');
    assert.equal(result.cleanup.retained, 1);
    assert.equal(store.documents.get('content_purge_audit/purge-shared').paths[0].state, 'protected');
});

test('un retry transactionnel du contrôle des références abandonne les candidats de la tentative obsolète', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    const originalTransaction = store.db.runTransaction.bind(store.db);
    let transactionCount = 0;
    store.db.runTransaction = async callback => {
        transactionCount += 1;
        if (transactionCount === 2) {
            try {
                await originalTransaction(async transaction => {
                    await callback(transaction);
                    store.documents.set('indices/arrive-pendant-retry', { imagePath: path });
                    throw new Error('forced transaction retry');
                });
            } catch { /* Simule le rejeu Firestore après le changement concurrent. */ }
        }
        return originalTransaction(callback);
    };
    let deleteCalls = 0;
    const originalFile = deps.bucket.file.bind(deps.bucket);
    deps.bucket.file = value => {
        const file = originalFile(value);
        return { ...file, async delete(options) { deleteCalls += 1; return file.delete(options); } };
    };

    const result = await purgePublicContent({ kind: 'pnj', id: 'purge-photo', operationId: 'purge-race', baseRevision: 3 }, MJ, deps);
    assert.equal(result.cleanup.status, 'retained');
    assert.equal(deleteCalls, 0);
    assert.equal(deps.storage.has(path), true);
    assert.equal(store.documents.get('content_purge_audit/purge-race').paths[0].state, 'protected');
});

test('purge ne supprime pas une image dont la réservation consommée est absente ou ambiguë', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps, { reservationState: 'uploaded' });
    const result = await purgePublicContent({ kind: 'pnj', id: 'purge-photo', operationId: 'purge-unverified', baseRevision: 3 }, MJ, deps);
    assert.equal(deps.storage.has(path), true);
    assert.equal(result.cleanup.status, 'retained');
    assert.equal(store.documents.get('content_purge_audit/purge-unverified').paths[0].reason, 'reservation-unverified');
});

test('un résultat Storage incertain se reprend explicitement en rejouant le reçu MJ', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    const originalFile = deps.bucket.file.bind(deps.bucket);
    let failures = 1;
    deps.bucket.file = value => {
        const file = originalFile(value);
        return { ...file, async delete(options) {
            if (failures-- > 0) throw Object.assign(new Error('private storage detail'), { code: 'unavailable' });
            return file.delete(options);
        } };
    };
    const command = { kind: 'pnj', id: 'purge-photo', operationId: 'purge-retry', baseRevision: 3 };
    const first = await purgePublicContent(command, MJ, deps);
    assert.equal(first.cleanup.status, 'pending');
    assert.equal(first.cleanup.pending, 1);
    assert.equal(deps.storage.has(path), true);
    assert.equal(store.documents.get('content_purge_audit/purge-retry').paths[0].reason, 'storage-unavailable');

    const retry = await purgePublicContent(command, MJ, deps);
    assert.deepEqual(retry.cleanup, { status: 'complete', candidates: 1, deleted: 1, missing: 0, retained: 0, pending: 0, retryable: 0 });
    assert.equal(deps.storage.has(path), false);
    assert.equal(store.documents.get('content_operations/purge-retry').response.cleanup.status, 'complete');
});

test('un résultat tardif d’un ancien bail ne remplace pas le résultat terminal de la reprise concurrente', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    const command = { kind: 'pnj', id: 'purge-photo', operationId: 'purge-lease', baseRevision: 3 };
    const firstFile = deps.bucket.file.bind(deps.bucket);
    let failInitial = true;
    deps.bucket.file = value => {
        const file = firstFile(value);
        return { ...file, async delete(options) {
            if (failInitial) { failInitial = false; throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); }
            return file.delete(options);
        } };
    };
    await purgePublicContent(command, MJ, deps);

    let releaseFirst;
    let signalFirst;
    const firstStarted = new Promise(resolve => { signalFirst = resolve; });
    let storageCall = 0;
    deps.bucket.file = value => {
        const file = firstFile(value);
        return { ...file, delete(options) {
            storageCall += 1;
            if (storageCall === 1) {
                signalFirst();
                return new Promise((resolve, reject) => { releaseFirst = reject; });
            }
            return file.delete(options);
        } };
    };
    const olderAttempt = purgePublicContent(command, MJ, deps);
    await firstStarted;
    const auditRef = store.documents.get('content_purge_audit/purge-lease');
    auditRef.paths = auditRef.paths.map(item => ({ ...item, cleanupLeaseUntil: 0 }));
    const newerAttempt = await purgePublicContent(command, MJ, deps);
    assert.equal(newerAttempt.cleanup.status, 'complete');
    releaseFirst(Object.assign(new Error('late failure'), { code: 'unavailable' }));
    await olderAttempt;
    assert.equal(deps.storage.has(path), false);
    assert.equal(store.documents.get('content_purge_audit/purge-lease').paths[0].state, 'deleted');
    assert.equal(store.documents.get('content_operations/purge-lease').response.cleanup.status, 'complete');
});

test('les reprises persistantes sont MJ seulement et ne révèlent aucun chemin privé', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    const originalFile = deps.bucket.file.bind(deps.bucket);
    deps.bucket.file = value => {
        const file = originalFile(value);
        return { ...file, async delete() { throw Object.assign(new Error('private path'), { code: 'unavailable' }); } };
    };
    const command = { kind: 'pnj', id: 'purge-photo', operationId: 'purge-resume', baseRevision: 3 };
    await purgePublicContent(command, MJ, deps);
    const page = await listPendingPurgeCleanups({ ...MJ, data: {} }, deps);
    assert.equal(page.entries.length, 1);
    assert.deepEqual(page.entries[0], {
        operationId: 'purge-resume', kind: 'pnj', id: 'purge-photo', summary: 'À purger', baseRevision: 3,
        cleanup: { status: 'pending', candidates: 1, deleted: 0, missing: 0, retained: 0, pending: 1, retryable: 1 },
        createdAt: 2,
    });
    assert.equal(JSON.stringify(page).includes(path), false);
    assert.equal(JSON.stringify(page).includes('actorUid'), false);
    await rejectsCode(listPendingPurgeCleanups({ ...PLAYER, data: {} }, deps), 'permission-denied');
});

test('un reçu purge ne contourne pas une rétrogradation MJ et ne supprime rien avant rétablissement du rôle', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const path = seedPurgeImage(store, deps);
    const visibilityCommand = { kind: 'pnj', id: 'purge-photo', operationId: 'hide-before-demotion', baseRevision: 3,
        ownerCanRestore: false };
    await setTrashVisibility(visibilityCommand, MJ, deps);
    const command = { kind: 'pnj', id: 'purge-photo', operationId: 'purge-demoted', baseRevision: 3 };
    const originalFile = deps.bucket.file.bind(deps.bucket);
    let failOnce = true;
    deps.bucket.file = value => {
        const file = originalFile(value);
        return { ...file, async delete(options) {
            if (failOnce) { failOnce = false; throw Object.assign(new Error('unavailable'), { code: 'unavailable' }); }
            return file.delete(options);
        } };
    };
    const first = await purgePublicContent(command, MJ, deps);
    assert.equal(first.cleanup.status, 'pending');
    assert.equal(deps.storage.has(path), true);

    const demotedSameUser = { auth: { uid: 'mj-1', token: { email: 'player@example.test', email_verified: true } } };
    await rejectsCode(purgePublicContent(command, demotedSameUser, deps), 'permission-denied');
    await rejectsCode(setTrashVisibility(visibilityCommand, demotedSameUser, deps), 'permission-denied');
    assert.equal(deps.storage.has(path), true);
    await purgePublicContent(command, MJ, deps);
    assert.equal(deps.storage.has(path), false);
});

test('le nettoyage Storage est borné à dix objets par appel et reprend le curseur d’audit', async () => {
    const seed = { 'campagne/acces': access() };
    const store = createStore(seed);
    const deps = dependencies(store);
    const paths = [];
    const dependencyEntries = [];
    for (let index = 0; index < 11; index++) {
        const id = `dep-${index}`;
        const path = `indices/${id}/image-op${index}.png`;
        paths.push(path);
        deps.storage.set(path, { contentType: 'image/png' });
        dependencyEntries.push({ kind: 'indice', contentId: id, data: { titre: id, imagePath: path } });
        store.documents.set(`content_image_reservations/indice_${id}_op${index}`, { kind: 'indice', contentId: id,
            path, operationId: `op${index}`, state: 'consumed', uid: 'mj-1' });
    }
    store.documents.set('content_trash/pnj_batch', { kind: 'pnj', contentId: 'batch', state: 'trashed', revision: 1,
        data: { nom: 'Batch' }, dependencies: dependencyEntries });
    store.documents.set('content_metadata/pnj_batch', { kind: 'pnj', contentId: 'batch', state: 'trashed', revision: 1 });
    const command = { kind: 'pnj', id: 'batch', operationId: 'purge-batch', baseRevision: 1 };
    const first = await purgePublicContent(command, MJ, deps);
    assert.equal(first.cleanup.status, 'pending');
    assert.equal(first.cleanup.deleted, 10);
    assert.equal(first.cleanup.pending, 1);
    assert.equal(paths.filter(path => deps.storage.has(path)).length, 1);
    const second = await purgePublicContent(command, MJ, deps);
    assert.equal(second.cleanup.status, 'complete');
    assert.equal(second.cleanup.deleted, 11);
    assert.equal(paths.filter(path => deps.storage.has(path)).length, 0);
});

test('restauration d’un PNJ ne remplace pas un indice dépendant modifié depuis la mise en corbeille', async () => {
    const store = createStore({
        'campagne/acces': access(), 'pnjs/mine': pnj('Mien'),
        'indices/clue': { titre: 'Indice', decouvert: true, pnjsLies: ['mine'] },
        'content_metadata/pnj_mine': { kind: 'pnj', contentId: 'mine', ownerUid: 'player-1', revision: 2, state: 'active' },
        'content_metadata/indice_clue': { kind: 'indice', contentId: 'clue', ownerUid: 'mj-1', revision: 7, state: 'active' },
    });
    const deps = dependencies(store);
    await trashPublicContent({ kind: 'pnj', id: 'mine', operationId: 'cascade-trash', baseRevision: 2 }, PLAYER, deps);
    assert.deepEqual(store.documents.get('indices/clue').pnjsLies, []);
    store.documents.set('indices/clue', { ...store.documents.get('indices/clue'), titre: 'Indice modifié ailleurs' });
    store.documents.set('content_metadata/indice_clue', { ...store.documents.get('content_metadata/indice_clue'), revision: 9 });
    const restored = await restorePublicContent({ kind: 'pnj', id: 'mine', operationId: 'cascade-restore', baseRevision: 3 }, PLAYER, deps);
    assert.equal(restored.restoredDependencies, 0);
    assert.equal(restored.skippedDependencies, 1);
    assert.deepEqual(store.documents.get('indices/clue').pnjsLies, []);
    assert.equal(store.documents.get('indices/clue').titre, 'Indice modifié ailleurs');
});

test('une query de cascade tronquée refuse avant toute suppression, même si ses 451 lignes sont cachées', async () => {
    const seed = {
        'campagne/acces': access(), 'pnjs/mine': pnj('Mien'),
        'content_metadata/pnj_mine': { kind: 'pnj', contentId: 'mine', ownerUid: 'player-1', revision: 1, state: 'active' },
    };
    for (let index = 0; index < 451; index++) seed[`relations/hidden-${index}`] = { source: 'mine', cible: 'other', type: 'ami', visibleJoueurs: false };
    const store = createStore(seed);
    await rejectsCode(trashPublicContent({ kind: 'pnj', id: 'mine', operationId: 'truncated-cascade', baseRevision: 1 }, PLAYER, dependencies(store)), 'failed-precondition', 'cascade-too-large');
    assert.equal(store.documents.has('pnjs/mine'), true);
    assert.equal(store.documents.has('content_trash/pnj_mine'), false);
});

test('un contenu sans propriétaire migré reste MJ-seul pour la suppression et garde ownerUid null', async () => {
    const store = createStore({ 'campagne/acces': access(), 'pnjs/legacy': pnj('Hérité') });
    const deps = dependencies(store);
    await rejectsCode(trashPublicContent({ kind: 'pnj', id: 'legacy', operationId: 'player-trash', baseRevision: 0 }, PLAYER, deps), 'permission-denied');
    await trashPublicContent({ kind: 'pnj', id: 'legacy', operationId: 'mj-trash', baseRevision: 0 }, MJ, deps);
    assert.equal(store.documents.get('content_trash/pnj_legacy').ownerUid, null);
});

test('upload contribution autorisé revalide le compte et consomme un reçu image lié au digest', async () => {
    const store = createStore({ 'campagne/acces': access() });
    const deps = dependencies(store);
    const body = { kind: 'portrait', ownerId: 'new-pnj', operationId: 'img-1', contentType: 'image/png', base64: PNG.toString('base64') };
    const uploaded = await uploadContributionImage({ ...PLAYER, data: body }, deps);
    assert.equal(uploaded.imagePath, 'portraits/new-pnj/portrait-img-1.png');
    const reservation = store.documents.get('content_image_reservations/pnj_new-pnj_img-1');
    assert.equal(reservation.state, 'uploaded');
    assert.equal(reservation.uid, PLAYER.auth.uid);
    await rejectsCode(uploadContributionImage({ ...OTHER, data: { ...body, base64: Buffer.from([...PNG, 1]).toString('base64') } }, deps), 'already-exists');
    await rejectsCode(uploadContributionImage({ ...OUTSIDER, data: { ...body, operationId: 'img-2' } }, deps), 'permission-denied');
});

test('les commandes refusent pollution de prototype, détails hors allowlist et données de contenus cachés', async () => {
    const store = createStore({
        'campagne/acces': access(), 'pnjs/mine': pnj('Mien'),
        'content_metadata/pnj_mine': { kind: 'pnj', contentId: 'mine', ownerUid: 'player-1', revision: 1, state: 'active' },
    });
    const raw = JSON.parse('{"kind":"pnj","action":"update","id":"mine","operationId":"bad","baseRevision":1,"changes":{"__proto__":{"x":1}},"baseValues":{"__proto__":null}}');
    await assert.rejects(mutatePublicContent(raw, PLAYER, dependencies(store)), error => error.code === 'invalid-argument');
    await rejectsCode(getContentEditContext({ ...PLAYER, data: { kind: 'pnj', id: 'missing' } }, dependencies(store)), 'not-found');
    assert.equal({}.x, undefined);
});

test('MJ peut relire et modifier les contenus cachés via une commande versionnée sans exposer ce chemin aux joueurs', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/hidden': pnj('secret', { visibleJoueurs: false, description: 'MJ seulement' }),
        'content_metadata/pnj_hidden': { kind: 'pnj', contentId: 'hidden', ownerUid: null, revision: 3, state: 'active' },
        'content_history/pnj_hidden/events/mj-old': { kind: 'pnj', operationId: 'mj-old', role: 'mj', actorUid: 'mj-1', action: 'update', revision: 3, changes: { nom: { before: 'old', after: 'secret' } } },
    });
    await rejectsCode(getContentEditContext({ auth: PLAYER.auth, data: { kind: 'pnj', id: 'hidden' } }, dependencies(store)), 'not-found');
    await rejectsCode(getContentHistory({ ...PLAYER, data: { kind: 'pnj', id: 'hidden' } }, dependencies(store)), 'not-found');
    const context = await getContentEditContext({ auth: MJ.auth, data: { kind: 'pnj', id: 'hidden' } }, dependencies(store));
    assert.equal(context.data.description, 'MJ seulement');
    assert.equal(context.data.visibleJoueurs, false);
    assert.equal(context.revision, 3);
    assert.equal((await getContentHistory({ ...MJ, data: { kind: 'pnj', id: 'hidden' } }, dependencies(store))).events.length, 1);
    await rejectsCode(mutateMjContent({ kind: 'pnj', id: 'hidden', operationId: 'player-op', baseRevision: 3,
        baseValues: { description: 'MJ seulement' }, changes: { description: 'edited' } }, PLAYER, dependencies(store)), 'permission-denied');
    const result = await mutateMjContent({ kind: 'pnj', id: 'hidden', operationId: 'mj-hidden-edit', baseRevision: 3,
        baseValues: { description: 'MJ seulement' }, changes: { description: 'edited' } }, MJ, dependencies(store));
    assert.equal(result.revision, 4);
    assert.equal(store.documents.get('pnjs/hidden').description, 'edited');
    assert.equal(store.documents.get('content_history/pnj_hidden/events/mj-hidden-edit').role, 'mj');
});

test('MJ public→secret cache les relations et retire les liens exposés atomiquement, avec reçu idempotent', async () => {
    const relation = { source: 'hidden', cible: 'visible', type: 'parent', label: 'parent', visibleJoueurs: true };
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/hidden': pnj('hidden', { visibleJoueurs: true }),
        'pnjs/visible': pnj('visible'),
        'indices/clue': { titre: 'indice public', decouvert: true, pnjsLies: ['hidden', 'visible'] },
        'relations/link': relation,
        'relations/secret-link': { source: 'hidden', cible: 'visible', type: 'secret', label: 'secret', visibleJoueurs: false },
        'content_metadata/pnj_hidden': { kind: 'pnj', contentId: 'hidden', ownerUid: null, revision: 4, state: 'active' },
        'content_metadata/indice_clue': { kind: 'indice', contentId: 'clue', ownerUid: 'player-1', revision: 2, state: 'active' },
        'content_metadata/relation_link': { kind: 'relation', contentId: 'link', ownerUid: 'player-1', revision: 7, state: 'active' },
        'content_metadata/relation_secret-link': { kind: 'relation', contentId: 'secret-link', ownerUid: null, revision: 12, state: 'active' },
    });
    const command = { kind: 'pnj', id: 'hidden', operationId: 'mj-hide', baseRevision: 4,
        baseValues: { visibleJoueurs: true }, changes: { visibleJoueurs: false } };
    const first = await mutateMjContent(command, MJ, dependencies(store));
    const retry = await mutateMjContent(command, MJ, dependencies(store));
    assert.deepEqual(retry, first);
    assert.equal(store.documents.get('pnjs/hidden').visibleJoueurs, false);
    assert.equal(store.documents.get('relations/link').visibleJoueurs, false);
    assert.deepEqual(store.documents.get('indices/clue').pnjsLies, ['visible']);
    assert.equal(store.documents.get('content_metadata/relation_link').revision, 8);
    assert.equal(store.documents.get('content_metadata/indice_clue').revision, 3);
    assert.equal(first.cascaded, 2);
    const publish = await mutateMjContent({ kind: 'pnj', id: 'hidden', operationId: 'mj-show', baseRevision: first.revision,
        baseValues: { visibleJoueurs: false }, changes: { visibleJoueurs: true } }, MJ, dependencies(store));
    assert.equal(store.documents.get('relations/link').visibleJoueurs, true);
    assert.equal(store.documents.get('relations/secret-link').visibleJoueurs, false, 'une relation cachée avant la dépublication ne doit pas être republiee implicitement');
    assert.equal(store.documents.get('content_metadata/relation_secret-link').revision, 12);
    assert.deepEqual(store.documents.get('indices/clue').pnjsLies, ['hidden', 'visible']);
    assert.equal(store.documents.get('content_metadata/indice_clue').revision, 4);
    assert.equal(publish.cascaded, 2);
});

test('un retry Firestore reconstruit les dépendances depuis le snapshot transactionnel courant', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/hidden': pnj('hidden', { visibleJoueurs: true }),
        'pnjs/visible': pnj('visible'),
        'indices/clue': { titre: 'indice public', decouvert: true, pnjsLies: ['hidden', 'visible'] },
        'relations/link': { source: 'hidden', cible: 'visible', type: 'parent', label: 'parent', visibleJoueurs: true },
        'content_metadata/pnj_hidden': { kind: 'pnj', contentId: 'hidden', revision: 1, state: 'active' },
        'content_metadata/indice_clue': { kind: 'indice', contentId: 'clue', revision: 1, state: 'active' },
        'content_metadata/relation_link': { kind: 'relation', contentId: 'link', revision: 4, state: 'active' },
    });
    const deps = dependencies(store);
    deps.db.runTransaction = async callback => {
        for (let attempt = 0; attempt < 2; attempt++) {
            let writing = false;
            const writes = new Map();
            const transaction = {
                async get(reference) {
                    if (writing) throw new Error('read after write');
                    if (reference.filters) return reference.get();
                    return snap(reference.path, state.documents.get(reference.path));
                },
                set(reference, value) { writing = true; writes.set(reference.path, ['set', clone(value)]); },
                update(reference, value) { writing = true; writes.set(reference.path, ['update', clone(value)]); },
                delete(reference) { writing = true; writes.set(reference.path, ['delete']); },
            };
            const result = await callback(transaction);
            if (attempt === 0) {
                state.documents.set('relations/late', { source: 'hidden', cible: 'visible', type: 'ally', label: 'ally', visibleJoueurs: true });
                state.documents.set('content_metadata/relation_late', { kind: 'relation', contentId: 'late', revision: 2, state: 'active' });
                continue;
            }
            for (const [path, [action, value]] of writes) {
                if (action === 'delete') state.documents.delete(path);
                else if (action === 'update') state.documents.set(path, { ...state.documents.get(path), ...value });
                else state.documents.set(path, value);
            }
            return result;
        }
    };
    const result = await mutateMjContent({ kind: 'pnj', id: 'hidden', operationId: 'retry-hide', baseRevision: 1,
        baseValues: { visibleJoueurs: true }, changes: { visibleJoueurs: false } }, MJ, deps);
    assert.equal(result.cascaded, 3);
    assert.equal(store.documents.get('relations/late').visibleJoueurs, false);
    assert.equal(store.documents.get('content_metadata/relation_late').revision, 3);
});

test('MJ publicise un PNJ caché avec contrôle de révision et refuse une base obsolète', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/hidden': pnj('hidden', { visibleJoueurs: false }),
        'content_metadata/pnj_hidden': { kind: 'pnj', contentId: 'hidden', ownerUid: null, revision: 1, state: 'active' },
    });
    const command = { kind: 'pnj', id: 'hidden', operationId: 'mj-publish', baseRevision: 1,
        baseValues: { visibleJoueurs: false }, changes: { visibleJoueurs: true } };
    await rejectsCode(mutateMjContent(command, PLAYER, dependencies(store)), 'permission-denied');
    await mutateMjContent(command, MJ, dependencies(store));
    assert.equal(store.documents.get('pnjs/hidden').visibleJoueurs, true);
    await rejectsCode(mutateMjContent({ ...command, operationId: 'stale-mj', baseRevision: 1 }, MJ, dependencies(store)), 'aborted', 'conflict');
});

test('un upload MJ sur fiche cachée n’est associable qu’après revalidation et consommation de réservation', async () => {
    const store = createStore({
        'campagne/acces': access(),
        'pnjs/hidden-image': pnj('hidden-image', { visibleJoueurs: false }),
        'content_metadata/pnj_hidden-image': { kind: 'pnj', contentId: 'hidden-image', ownerUid: null, revision: 0, state: 'active' },
    });
    const deps = dependencies(store);
    const body = { kind: 'portrait', ownerId: 'hidden-image', operationId: 'mj-image', contentType: 'image/png', base64: PNG.toString('base64') };
    await rejectsCode(uploadContributionImage({ ...PLAYER, data: body }, deps), 'not-found');
    const uploaded = await uploadContributionImage({ ...MJ, data: body }, deps);
    const result = await mutateMjContent({ kind: 'pnj', id: 'hidden-image', operationId: 'mj-associate-image', baseRevision: 0,
        baseValues: { imagePath: null }, changes: { imagePath: uploaded.imagePath } }, MJ, deps);
    assert.equal(result.revision, 1);
    assert.equal(store.documents.get('pnjs/hidden-image').imagePath, uploaded.imagePath);
    assert.equal(store.documents.get('content_image_reservations/pnj_hidden-image_mj-image').state, 'consumed');
});

test('la modification MJ d’une relation gérée conserve la paire réciproque et les deux révisions', async () => {
    const forward = { source: 'a', cible: 'b', type: 'ami', label: 'ami', visibleJoueurs: true, curvature: 1 };
    const reverse = { ...forward, source: 'b', cible: 'a' };
    const store = createStore({
        'campagne/acces': access(), 'pnjs/a': pnj('a'), 'pnjs/b': pnj('b'),
        'relations/r1': forward, 'relations/r2': reverse,
        'content_metadata/relation_r1': { kind: 'relation', contentId: 'r1', ownerUid: null, reciprocalId: 'r2', revision: 2, state: 'active' },
        'content_metadata/relation_r2': { kind: 'relation', contentId: 'r2', ownerUid: null, reciprocalId: 'r1', revision: 4, state: 'active' },
    });
    const context = await getContentEditContext({ ...MJ, data: { kind: 'relation', id: 'r1' } }, dependencies(store));
    assert.equal(context.data.reciprocalId, 'r2');
    const command = { kind: 'relation', id: 'r1', operationId: 'mj-pair-edit', baseRevision: 2,
        reciprocalId: 'r2', reciprocalBaseRevision: context.data.reciprocalRevision,
        baseValues: { label: 'ami' }, changes: { label: 'sœur' } };
    await rejectsCode(mutateMjContent({ ...command, reciprocalId: undefined, reciprocalBaseRevision: undefined }, MJ, dependencies(store)), 'failed-precondition', 'reciprocal-required');
    const result = await mutateMjContent(command, MJ, dependencies(store));
    assert.equal(result.revision, 3);
    assert.equal(store.documents.get('relations/r1').label, 'sœur');
    assert.equal(store.documents.get('relations/r2').label, 'sœur');
    assert.equal(store.documents.get('content_metadata/relation_r2').revision, 5);
});

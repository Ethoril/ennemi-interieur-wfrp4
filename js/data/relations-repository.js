import { normalizeRelation } from './firebase-normalizers.js';
import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { relationId } from '../pnj-integrity.js';
import {
    collectionRef, compareUnicode, documentRef, queryRef,
    requireRepository, serverTimestamp, snapshotData, snapshotMetadata, sortedBy,
    subscribeSnapshot, timestampEqual, valueKey, whereConstraint,
} from './repository-utils.js';

const RELATION_FIELDS = Object.freeze(['source', 'cible', 'type', 'label', 'color', 'style', 'visibleJoueurs']);
const SAFE_COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu;

function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 150
        && /^[A-Za-z0-9_-]+$/u.test(value);
}

function validateKeys(value, operation) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !RELATION_FIELDS.includes(key))) {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    }
}

function relationInput(input, { create = false } = {}) {
    validateKeys(input, 'relation-validation');
    const output = {};
    for (const field of ['source', 'cible']) {
        if (create || Object.hasOwn(input, field)) {
            if (!validId(input[field])) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: `relation-${field}` });
            output[field] = input[field];
        }
    }
    if (create || Object.hasOwn(input, 'type')) {
        if (typeof input.type !== 'string' || input.type.trim() === '' || input.type.length > 100) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-type' });
        }
        output.type = input.type.trim();
    }
    if (Object.hasOwn(input, 'label')) {
        if (typeof input.label !== 'string' || input.label.trim() === '' || input.label.length > 300) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-label' });
        }
        output.label = input.label.trim();
    }
    if (create && !Object.hasOwn(output, 'label')) output.label = output.type;
    if (Object.hasOwn(input, 'color')) {
        if (input.color !== null && (typeof input.color !== 'string' || !SAFE_COLOR.test(input.color))) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-color' });
        }
        output.color = input.color;
    }
    if (Object.hasOwn(input, 'style')) {
        if (input.style !== 'solid' && input.style !== 'dashed') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-style' });
        output.style = input.style;
    } else if (create) output.style = 'solid';
    if (create || Object.hasOwn(input, 'visibleJoueurs')) {
        if (typeof input.visibleJoueurs !== 'boolean') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-visibility' });
        output.visibleJoueurs = input.visibleJoueurs;
    }
    if (output.source && output.cible && output.source === output.cible) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-self' });
    return output;
}

function fullRelation(data) {
    return relationInput(data, { create: true });
}

function reverseRelation(data) {
    return { ...data, source: data.cible, cible: data.source };
}

function sameRelationFields(left, right) {
    return RELATION_FIELDS.every(field => left[field] === right[field]);
}

function relationFieldsKey(relation) {
    return JSON.stringify(RELATION_FIELDS.map(field => relation[field]));
}

function withExactReciprocalIds(items) {
    const byKey = new Map();
    for (const item of items) {
        const key = relationFieldsKey(item);
        const list = byKey.get(key) || [];
        list.push(item);
        byKey.set(key, list);
    }
    return items.map(item => {
        const candidates = byKey.get(relationFieldsKey(reverseRelation(item))) || [];
        // Une paire n'est prouvée que si le miroir inverse est unique et
        // strictement égal sur tous les champs métier.
        const reciprocal = candidates.length === 1 && candidates[0].id !== item.id
            && sameRelationFields(candidates[0], reverseRelation(item)) ? candidates[0] : null;
        return { ...item, reciprocalId: reciprocal?.id ?? null };
    });
}

function snapshotExists(snapshot) {
    return typeof snapshot?.exists === 'function' ? snapshot.exists() : snapshot?.exists === true;
}

function compareRelation(left, right) {
    return compareUnicode(left.type, right.type) || compareUnicode(left.id, right.id);
}

function docs(snapshot) {
    return Array.isArray(snapshot?.docs) ? snapshot.docs : [];
}

function transactionApi(sdk, db, operation, callback) {
    if (typeof sdk.runTransaction !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    return sdk.runTransaction(db, callback);
}

function mutationError(error, operation) {
    return error instanceof FirebaseClientError ? error : normalizeFirebaseError(error, { operation });
}

function ensureExpected(snapshot, expectedUpdatedAt) {
    if (expectedUpdatedAt !== undefined && !timestampEqual(snapshotData(snapshot).updatedAt, expectedUpdatedAt)) {
        throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'relation-expected-updated-at' });
    }
}

function emitRelations(snapshot, onData, state, filter) {
    const normalized = docs(snapshot).map(normalizeRelation).filter(filter);
    const items = sortedBy(withExactReciprocalIds(normalized), compareRelation);
    const metadata = snapshotMetadata(snapshot);
    const key = `${valueKey(items)}|${metadata.fromCache}|${metadata.hasPendingWrites}`;
    if (key === state.lastKey) return;
    state.lastKey = key;
    onData(items, metadata);
}

function createRepository({ sdk, client, role, visiblePnjIds = [] } = {}) {
    const db = requireRepository(sdk, client, 'relation-repository');
    const isMj = role === 'mj';
    let visibleIds = new Set(Array.isArray(visiblePnjIds) ? visiblePnjIds.filter(validId) : []);
    const activeVisibleSubscriptions = new Set();

    function setVisiblePnjIds(ids) {
        visibleIds = new Set(Array.isArray(ids) ? ids.filter(validId) : []);
        for (const subscription of activeVisibleSubscriptions) {
            if (subscription.snapshot) emitRelations(subscription.snapshot, subscription.onData, subscription.state,
                relation => relation.visibleJoueurs === true
                    && visibleIds.has(relation.source) && visibleIds.has(relation.cible));
        }
    }

    function subscribeVisible(onData, onError, options = {}) {
        if (Array.isArray(options.visiblePnjIds)) setVisiblePnjIds(options.visiblePnjIds);
        const target = queryRef(sdk, collectionRef(sdk, db, 'relations'), [whereConstraint(sdk, 'visibleJoueurs', '==', true)]);
        const state = { lastKey: null };
        const subscription = { snapshot: null, onData, state };
        activeVisibleSubscriptions.add(subscription);
        const unsubscribe = subscribeSnapshot(sdk, target, snapshot => {
            subscription.snapshot = snapshot;
            try {
                emitRelations(snapshot, onData, state, relation => relation.visibleJoueurs === true
                    && visibleIds.has(relation.source) && visibleIds.has(relation.cible));
            } catch (error) { if (typeof onError === 'function') onError(mutationError(error, 'subscribe-relations')); }
        }, onError, client?.listen);
        return () => { activeVisibleSubscriptions.delete(subscription); unsubscribe(); };
    }

    function subscribeAll(onData, onError) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'subscribe-all-relations' });
        const state = { lastKey: null };
        return subscribeSnapshot(sdk, collectionRef(sdk, db, 'relations'), snapshot => {
            try { emitRelations(snapshot, onData, state, () => true); }
            catch (error) { if (typeof onError === 'function') onError(mutationError(error, 'subscribe-relations')); }
        }, onError, client?.listen);
    }

    function findForPnj(id, relations = []) {
        if (!validId(id) || !Array.isArray(relations)) return [];
        return relations.filter(relation => relation.source === id || relation.cible === id);
    }

    async function create(data, bidirectional = false) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'create-relation' });
        const primary = fullRelation(data);
        const reverse = bidirectional ? reverseRelation(primary) : null;
        const primaryRef = documentRef(sdk, db, 'relations', relationId(primary));
        const reverseRef = reverse ? documentRef(sdk, db, 'relations', relationId(reverse)) : null;
        try {
            return await transactionApi(sdk, db, 'create-relation', async transaction => {
                const sourceSnapshot = await transaction.get(documentRef(sdk, db, 'pnjs', primary.source));
                const cibleSnapshot = await transaction.get(documentRef(sdk, db, 'pnjs', primary.cible));
                const relationSnapshot = await transaction.get(primaryRef);
                const reverseSnapshot = reverseRef ? await transaction.get(reverseRef) : null;
                const lockSnapshot = await transaction.get(documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
                if (snapshotExists(lockSnapshot)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-lock' });
                }
                for (const endpoint of [sourceSnapshot, cibleSnapshot]) {
                    if (!snapshotExists(endpoint)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'create-relation-endpoint' });
                    if (snapshotData(endpoint).suppressionEnCours === true) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-endpoint' });
                }
                if (primary.visibleJoueurs === true
                    && (snapshotData(sourceSnapshot).visibleJoueurs !== true || snapshotData(cibleSnapshot).visibleJoueurs !== true)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-visibility' });
                }
                if (relationSnapshot?.exists?.() || reverseSnapshot?.exists?.()) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-duplicate' });
                const timestamp = serverTimestamp(sdk);
                transaction.set(primaryRef, { ...primary, createdAt: timestamp, updatedAt: timestamp });
                if (reverseRef) transaction.set(reverseRef, { ...reverse, createdAt: timestamp, updatedAt: timestamp });
                return { id: relationId(primary), reciprocalId: reverseRef?.id ?? null };
            });
        } catch (error) { throw mutationError(error, 'create-relation'); }
    }

    async function update(id, patch, expectedUpdatedAt, options = {}) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'update-relation' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'update-relation' });
        const relationRef = documentRef(sdk, db, 'relations', id);
        try {
            return await transactionApi(sdk, db, 'update-relation', async transaction => {
                const current = await transaction.get(relationRef);
                if (!snapshotExists(current)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'update-relation' });
                ensureExpected(current, expectedUpdatedAt);
                const currentData = normalizeRelation(current);
                const base = Object.fromEntries(RELATION_FIELDS
                    .filter(field => field !== 'label' || currentData.label !== '')
                    .map(field => [field, currentData[field]]));
                const next = fullRelation({ ...base, ...(patch ?? {}) });
                const source = await transaction.get(documentRef(sdk, db, 'pnjs', next.source));
                const cible = await transaction.get(documentRef(sdk, db, 'pnjs', next.cible));
                const lock = await transaction.get(documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
                if (snapshotExists(lock)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-relation-lock' });
                }
                for (const endpoint of [source, cible]) {
                    if (!snapshotExists(endpoint)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'update-relation-endpoint' });
                    if (snapshotData(endpoint).suppressionEnCours === true) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-relation-endpoint' });
                }
                if (next.visibleJoueurs === true
                    && (snapshotData(source).visibleJoueurs !== true || snapshotData(cible).visibleJoueurs !== true)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-relation-visibility' });
                }
                const nextId = relationId(next);
                const pair = options?.pair === true || options?.reciprocalId !== undefined;
                const reciprocalId = pair ? options?.reciprocalId : null;
                if (pair && !validId(reciprocalId)) {
                    throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'update-relation-reciprocal' });
                }
                const reciprocalRef = pair ? documentRef(sdk, db, 'relations', reciprocalId) : null;
                const reciprocalSnapshot = reciprocalRef ? await transaction.get(reciprocalRef) : null;
                const reciprocalData = reciprocalSnapshot && snapshotExists(reciprocalSnapshot)
                    ? normalizeRelation(reciprocalSnapshot) : null;
                if (pair && (!reciprocalData || !sameRelationFields(reciprocalData, reverseRelation(currentData)))) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-relation-reciprocal' });
                }
                const nextReverse = pair ? reverseRelation(next) : null;
                const nextReverseId = nextReverse ? relationId(nextReverse) : null;
                const nextRef = documentRef(sdk, db, 'relations', nextId);
                const nextReverseRef = nextReverseId ? documentRef(sdk, db, 'relations', nextReverseId) : null;
                const nextSnapshot = nextId === id ? current : await transaction.get(nextRef);
                const nextReverseSnapshot = nextReverseRef && nextReverseId !== reciprocalId
                    ? await transaction.get(nextReverseRef) : null;
                if (nextId !== id && snapshotExists(nextSnapshot)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-relation-rekey' });
                }
                if (pair && nextReverseId !== reciprocalId && snapshotExists(nextReverseSnapshot)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-relation-rekey' });
                }
                const timestamp = serverTimestamp(sdk);
                if (nextId === id) transaction.update(relationRef, { ...next, updatedAt: timestamp });
                else {
                    transaction.set(nextRef, { ...next, createdAt: timestamp, updatedAt: timestamp });
                    transaction.delete(relationRef);
                }
                if (pair) {
                    if (nextReverseId === reciprocalId) transaction.update(reciprocalRef, { ...nextReverse, updatedAt: timestamp });
                    else {
                        transaction.set(nextReverseRef, { ...nextReverse, createdAt: timestamp, updatedAt: timestamp });
                        transaction.delete(reciprocalRef);
                    }
                }
                return { id, nextId, reciprocalId: pair ? nextReverseId : null };
            });
        } catch (error) { throw mutationError(error, 'update-relation'); }
    }

    async function forceUpdate(id, patch, options = {}) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'force-update-relation' });
        if (options?.confirmed !== true) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'force-update-relation-confirmation' });
        return update(id, patch, undefined, { ...options, force: true });
    }

    async function remove(id, pairOrOptions = false) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'delete-relation' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'delete-relation' });
        const relationRef = documentRef(sdk, db, 'relations', id);
        try {
            const pair = pairOrOptions === true || pairOrOptions?.pair === true;
            return await transactionApi(sdk, db, 'delete-relation', async transaction => {
                const current = await transaction.get(relationRef);
                if (!snapshotExists(current)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'delete-relation' });
                const data = normalizeRelation(current);
                const lock = await transaction.get(documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
                if (snapshotExists(lock)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'delete-relation-lock' });
                }
                let reciprocalId = null;
                let reciprocal = null;
                if (pair) {
                    reciprocal = documentRef(sdk, db, 'relations', pairOrOptions?.reciprocalId ?? relationId(reverseRelation(data)));
                    reciprocalId = reciprocal.id;
                    const reciprocalSnapshot = await transaction.get(reciprocal);
                    if (!reciprocalSnapshot?.exists?.()) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'delete-relation-pair' });
                    const reciprocalData = normalizeRelation(reciprocalSnapshot);
                    const expected = reverseRelation(data);
                    if (reciprocalData.source !== expected.source || reciprocalData.cible !== expected.cible
                        || reciprocalData.type !== expected.type || reciprocalData.label !== expected.label
                        || reciprocalData.color !== expected.color || reciprocalData.style !== expected.style
                        || reciprocalData.visibleJoueurs !== expected.visibleJoueurs) {
                        throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'delete-relation-pair' });
                    }
                }
                transaction.delete(relationRef);
                if (reciprocal) transaction.delete(reciprocal);
                return { id, reciprocalId };
            });
        } catch (error) { throw mutationError(error, 'delete-relation'); }
    }

    const repository = Object.freeze({ subscribeVisible, setVisiblePnjIds, findForPnj });
    if (isMj) return Object.freeze({ ...repository, subscribeAll, create, update, forceUpdate, remove });
    return repository;
}

export function createPublicRelationsRepository(options = {}) {
    return createRepository({ ...options, role: 'public' });
}

export function createMjRelationsRepository(options = {}) {
    return createRepository({ ...options, role: 'mj' });
}

export const createPublicRelationRepository = createPublicRelationsRepository;
export const createMjRelationRepository = createMjRelationsRepository;

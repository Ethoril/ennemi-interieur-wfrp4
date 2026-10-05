import { normalizeRelation } from './firebase-normalizers.js';
import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { relationId } from '../pnj-integrity.js';
import {
    collectionRef, compareUnicode, documentRef, queryRef,
    requireRepository, serverTimestamp, snapshotData, snapshotMetadata, sortedBy,
    subscribeSnapshot, timestampEqual, valueKey, whereConstraint,
} from './repository-utils.js';

const RELATION_FIELDS = Object.freeze(['source', 'cible', 'type', 'label', 'color', 'style', 'visibleJoueurs']);
const RELATION_INPUT_FIELDS = Object.freeze([...RELATION_FIELDS, 'curvature']);
const SAFE_COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu;

function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 150
        && /^[A-Za-z0-9_-]+$/u.test(value);
}

function validateKeys(value, operation) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !RELATION_INPUT_FIELDS.includes(key))) {
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
    if (Object.hasOwn(input, 'curvature')) {
        if (input.curvature !== null && (typeof input.curvature !== 'number' || !Number.isFinite(input.curvature)
            || input.curvature < -6 || input.curvature > 6)) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-curvature' });
        }
        output.curvature = input.curvature;
    }
    // La valeur fournie n'est que provisoire : create et update la recalculent
    // depuis les deux PNJ lus dans la transaction.
    if (Object.hasOwn(input, 'visibleJoueurs')) {
        if (typeof input.visibleJoueurs !== 'boolean') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'relation-visibility' });
        output.visibleJoueurs = input.visibleJoueurs;
    } else if (create) output.visibleJoueurs = false;
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

function curvatureUpdatedAt(data) {
    const value = data.updatedAt;
    return value ? value.seconds * 1000 + (value.nanoseconds ?? 0) / 1e6 : 0;
}

function latestExplicitCurvature(left, right) {
    const candidates = [left, right].filter(item => Object.hasOwn(item, 'curvature'));
    candidates.sort((a, b) => curvatureUpdatedAt(b) - curvatureUpdatedAt(a)
        || String(a.id).localeCompare(String(b.id), 'en'));
    return candidates.length ? { present: true, value: candidates[0].curvature } : { present: false };
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

// Une relation n'est visible des joueurs que si ses deux PNJ le sont : ce
// n'est pas un choix du MJ, et donc jamais un motif de refus.
function derivedVisibility(...endpoints) {
    return endpoints.every(endpoint => snapshotExists(endpoint)
        && snapshotData(endpoint).visibleJoueurs === true
        && snapshotData(endpoint).suppressionEnCours !== true);
}

// L'identifiant intègre la visibilité, mais révélation et révocation la
// basculent sur place : une même relation peut exister sous l'autre clé.
function oppositeVisibilityId(relation) {
    return relationId({ ...relation, visibleJoueurs: relation.visibleJoueurs !== true });
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
        const nextIds = new Set(Array.isArray(ids) ? ids.filter(validId) : []);
        if (nextIds.size === visibleIds.size && [...nextIds].every(id => visibleIds.has(id))) return;
        visibleIds = nextIds;
        for (const subscription of activeVisibleSubscriptions) {
            subscription.restart();
        }
    }

    function subscribeVisible(onData, onError, options = {}) {
        if (Array.isArray(options.visiblePnjIds)) setVisiblePnjIds(options.visiblePnjIds);
        const state = { lastKey: null };
        let generation = 0;
        let closed = false;
        let unsubscribers = [];
        let lastDocs = [];
        const emit = (documents, metadata) => {
            lastDocs = documents.filter(document => {
                const data = snapshotData(document);
                return data.visibleJoueurs === true && visibleIds.has(data.source) && visibleIds.has(data.cible);
            });
            emitRelations({ docs: lastDocs, metadata }, onData, state, relation => relation.visibleJoueurs === true
                && visibleIds.has(relation.source) && visibleIds.has(relation.cible));
        };
        const restart = () => {
            const token = ++generation;
            unsubscribers.forEach(unsubscribe => unsubscribe());
            unsubscribers = [];
            // Purger immédiatement les liens révoqués, même avant les nouveaux snapshots.
            const retained = lastDocs.filter(document => {
                const data = snapshotData(document);
                return visibleIds.has(data.source) && visibleIds.has(data.cible);
            });
            emit(retained, { fromCache: true, hasPendingWrites: false });
            const ids = [...visibleIds].sort(compareUnicode);
            if (!ids.length) {
                emit([], { fromCache: false, hasPendingWrites: false });
                return;
            }
            // Les règles vérifient les DEUX PNJ : un filtre visibleJoueurs seul
            // est refusé. Chaque requête doit prouver ses endpoints, avec au plus
            // dix documents PNJ consultés par les règles (deux groupes de cinq).
            const chunks = [];
            for (let offset = 0; offset < ids.length; offset += 5) chunks.push(ids.slice(offset, offset + 5));
            const batches = chunks.flatMap(source => chunks.map(cible => ({ source, cible, snapshot: null, error: false })));
            for (const batch of batches) {
                const target = queryRef(sdk, collectionRef(sdk, db, 'relations'), [
                    whereConstraint(sdk, 'visibleJoueurs', '==', true),
                    whereConstraint(sdk, 'source', 'in', batch.source),
                    whereConstraint(sdk, 'cible', 'in', batch.cible),
                ]);
                const unsubscribe = subscribeSnapshot(sdk, target, snapshot => {
                    if (closed || token !== generation) return;
                    batch.snapshot = snapshot;
                    batch.error = false;
                    if (!batches.every(item => item.snapshot && !item.error)) return;
                    try {
                        const metadata = batches.map(item => snapshotMetadata(item.snapshot));
                        emit(batches.flatMap(item => docs(item.snapshot)), {
                            fromCache: metadata.some(item => item.fromCache),
                            hasPendingWrites: metadata.some(item => item.hasPendingWrites),
                        });
                    } catch (error) { onError?.(mutationError(error, 'subscribe-relations')); }
                }, error => {
                    if (closed || token !== generation) return;
                    batch.error = true;
                    onError?.(mutationError(error, 'subscribe-relations'));
                }, client?.listen);
                unsubscribers.push(unsubscribe);
            }
        };
        const subscription = { restart };
        activeVisibleSubscriptions.add(subscription);
        restart();
        return () => {
            closed = true;
            generation += 1;
            activeVisibleSubscriptions.delete(subscription);
            unsubscribers.forEach(unsubscribe => unsubscribe());
            unsubscribers = [];
        };
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
        const requested = fullRelation(data);
        try {
            return await transactionApi(sdk, db, 'create-relation', async transaction => {
                const sourceSnapshot = await transaction.get(documentRef(sdk, db, 'pnjs', requested.source));
                const cibleSnapshot = await transaction.get(documentRef(sdk, db, 'pnjs', requested.cible));
                // L'identifiant dépend de la visibilité : il n'est connu qu'après lecture des PNJ.
                const primary = { ...requested, visibleJoueurs: derivedVisibility(sourceSnapshot, cibleSnapshot) };
                const reverse = bidirectional ? reverseRelation(primary) : null;
                const primaryRef = documentRef(sdk, db, 'relations', relationId(primary));
                const reverseRef = reverse ? documentRef(sdk, db, 'relations', relationId(reverse)) : null;
                const relationSnapshot = await transaction.get(primaryRef);
                const reverseSnapshot = reverseRef ? await transaction.get(reverseRef) : null;
                const oppositeSnapshot = await transaction.get(documentRef(sdk, db, 'relations', oppositeVisibilityId(primary)));
                const reverseOppositeSnapshot = reverse
                    ? await transaction.get(documentRef(sdk, db, 'relations', oppositeVisibilityId(reverse))) : null;
                const lockSnapshot = await transaction.get(documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
                if (snapshotExists(lockSnapshot)) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-lock' });
                }
                for (const endpoint of [sourceSnapshot, cibleSnapshot]) {
                    if (!snapshotExists(endpoint)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'create-relation-endpoint' });
                    if (snapshotData(endpoint).suppressionEnCours === true) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-endpoint' });
                }
                if ([relationSnapshot, reverseSnapshot, oppositeSnapshot, reverseOppositeSnapshot].some(snapshotExists)) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'create-relation-duplicate' });
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
                if (Object.hasOwn(currentData, 'curvature')) base.curvature = currentData.curvature;
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
                next.visibleJoueurs = derivedVisibility(source, cible);
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
                if (pair && !Object.hasOwn(patch ?? {}, 'curvature')) {
                    const sharedCurvature = latestExplicitCurvature(currentData, reciprocalData);
                    if (sharedCurvature.present) next.curvature = sharedCurvature.value;
                    else delete next.curvature;
                }
                const nextReverse = pair ? reverseRelation(next) : null;
                const nextReverseId = nextReverse ? relationId(nextReverse) : null;
                const nextRef = documentRef(sdk, db, 'relations', nextId);
                const nextReverseRef = nextReverseId ? documentRef(sdk, db, 'relations', nextReverseId) : null;
                const nextSnapshot = nextId === id ? current : await transaction.get(nextRef);
                const nextReverseSnapshot = nextReverseRef && nextReverseId !== reciprocalId
                    ? await transaction.get(nextReverseRef) : null;
                // Les documents de la relation elle-même (ou de sa réciproque) ne comptent pas comme doublons.
                const ownIds = new Set([id, reciprocalId]);
                const oppositeId = nextId !== id ? oppositeVisibilityId(next) : null;
                const reverseOppositeId = pair && nextReverseId !== reciprocalId ? oppositeVisibilityId(nextReverse) : null;
                const oppositeSnapshots = [];
                for (const candidate of [oppositeId, reverseOppositeId]) {
                    if (candidate && !ownIds.has(candidate)) {
                        oppositeSnapshots.push(await transaction.get(documentRef(sdk, db, 'relations', candidate)));
                    }
                }
                if ((nextId !== id && snapshotExists(nextSnapshot)) || oppositeSnapshots.some(snapshotExists)) {
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

    async function saveCurvature(id, curvature, reciprocalId = null) {
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-relation-curvature' });
        if (reciprocalId !== null && (!validId(reciprocalId) || reciprocalId === id)) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-relation-curvature-reciprocal' });
        }
        if (curvature !== null && (typeof curvature !== 'number' || !Number.isFinite(curvature)
            || curvature < -6 || curvature > 6)) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-relation-curvature' });
        }
        try {
            const data = { curvature, updatedAt: serverTimestamp(sdk) };
            if (reciprocalId !== null) {
                if (typeof sdk.writeBatch !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-relation-curvature' });
                const batch = sdk.writeBatch(db);
                batch.update(documentRef(sdk, db, 'relations', id), data);
                batch.update(documentRef(sdk, db, 'relations', reciprocalId), data);
                await batch.commit();
            } else {
                if (typeof sdk.updateDoc !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'save-relation-curvature' });
                await sdk.updateDoc(documentRef(sdk, db, 'relations', id), data);
            }
        } catch (error) { throw mutationError(error, 'save-relation-curvature'); }
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

    const repository = Object.freeze({ subscribeVisible, setVisiblePnjIds, findForPnj, saveCurvature });
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

import { normalizePnjPrivate, normalizePnjPublic } from './firebase-normalizers.js';
import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { describeImage } from './images-repository.js';
import { commitCascadeBatches } from '../pnj-integrity.js';
import {
    collectionRef, compareOrder, compareUnicode, documentIdConstraint, documentRef, getDocument, getDocuments,
    queryRef, requireRepository, serverTimestamp, snapshotData,
    snapshotId, snapshotMetadata, sortedBy, subscribeSnapshot, timestampEqual, valueKey,
    whereConstraint,
} from './repository-utils.js';

const PUBLIC_FIELDS = Object.freeze([
    'nom', 'statut', 'vivant', 'lieu', 'groupe', 'description', 'visibleJoueurs', 'imagePath', 'ordre',
]);
const PRIVATE_FIELDS = Object.freeze(['notes']);
// Le formulaire mobile et le bureau partagent ces valeurs contractuelles ;
// les anciens documents peuvent omettre les champs, mais toute valeur fournie
// à une mutation doit rester dans l’allowlist.
const PNJ_STATUSES = new Set(['', 'allié', 'neutre', 'ennemi']);
const PNJ_LIVING = new Set(['oui', 'non', 'inconnu']);
const MAX_ID_LENGTH = 150;
const MAX_REVOCATION_RELATIONS = 498;
const RELATIONS_PER_REVOCATION_TRANSACTION = 8;
const MAX_REVOCATION_TRANSACTIONS = Math.ceil(MAX_REVOCATION_RELATIONS / RELATIONS_PER_REVOCATION_TRANSACTION);

function plainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function validId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
        && /^[A-Za-z0-9_-]+$/u.test(value);
}

function boundedString(value, field, maximum, { required = false } = {}) {
    if (typeof value !== 'string' || value.length > maximum || (required && value.trim() === '')) {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: `pnj-${field}` });
    }
    return value;
}

function validateKeys(input, allowed, operation) {
    if (!plainObject(input) || Object.keys(input).some(key => !allowed.includes(key))) {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    }
}

function validateImagePath(value, id) {
    if (value === null || value === undefined || value === '') {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-image-path' });
    }
    if (typeof value !== 'string') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-image-path' });
    const parts = value.split('/');
    if (parts.length !== 3 || parts[0] !== 'portraits' || parts[1] !== id
        || parts[2].length === 0 || parts[2].length > 128 || ['.', '..'].includes(parts[2])) {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-image-path' });
    }
    return value;
}

function sanitizePublic(input, id, { create = false } = {}) {
    validateKeys(input, PUBLIC_FIELDS, 'pnj-public-validation');
    const output = {};
    if (create || Object.hasOwn(input, 'nom')) output.nom = boundedString(input.nom, 'nom', 200, { required: true });
    for (const [field, maximum] of [['statut', 64], ['vivant', 32], ['lieu', 200], ['groupe', 200], ['description', 20000]]) {
        if (Object.hasOwn(input, field)) output[field] = boundedString(input[field], field, maximum);
    }
    if (Object.hasOwn(output, 'statut') && !PNJ_STATUSES.has(output.statut)) {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-statut' });
    }
    if (Object.hasOwn(output, 'vivant') && !PNJ_LIVING.has(output.vivant)) {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-vivant' });
    }
    if (create || Object.hasOwn(input, 'visibleJoueurs')) {
        if (typeof input.visibleJoueurs !== 'boolean') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-visibility' });
        output.visibleJoueurs = input.visibleJoueurs;
    }
    if (Object.hasOwn(input, 'imagePath')) {
        // null is the explicit, transactional request to detach a portrait;
        // creation still requires a valid path when one is supplied.
        output.imagePath = input.imagePath === null && !create ? null : validateImagePath(input.imagePath, id);
    }
    if (Object.hasOwn(input, 'ordre')) {
        if (input.ordre !== null && (typeof input.ordre !== 'number' || !Number.isFinite(input.ordre))) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-order' });
        }
        output.ordre = input.ordre;
    }
    return output;
}

function sanitizePrivate(input, { create = false } = {}) {
    validateKeys(input, PRIVATE_FIELDS, 'pnj-private-validation');
    const output = {};
    if (create || Object.hasOwn(input, 'notes')) output.notes = boundedString(input.notes ?? '', 'notes', 30000);
    return output;
}

function comparePnj(left, right) {
    return compareOrder(left.ordre, right.ordre)
        || compareUnicode(left.nom, right.nom)
        || compareUnicode(left.id, right.id);
}

function docsFromSnapshot(snapshot) {
    return Array.isArray(snapshot?.docs) ? snapshot.docs : [];
}

function snapshotExists(snapshot) {
    return typeof snapshot?.exists === 'function' ? snapshot.exists() : snapshot?.exists === true;
}

function emitNormalized(snapshot, normalizer, compare, onData, state, filter = () => true) {
    const items = sortedBy(docsFromSnapshot(snapshot).map(normalizer).filter(filter), compare);
    const metadata = snapshotMetadata(snapshot);
    const key = `${valueKey(items)}|${metadata.fromCache}|${metadata.hasPendingWrites}`;
    if (key === state.lastKey) return;
    state.lastKey = key;
    onData(items, metadata);
}

function normalizePnjForRepository(snapshot, includeLegacyImagePresent = false) {
    const raw = snapshotData(snapshot);
    const normalized = normalizePnjPublic(snapshot);
    const image = describeImage(normalized, normalized.id, 'portrait');
    return {
        ...normalized,
        image,
        imagePath: image.invalid || image.legacy ? null : image.path,
        imageUrl: image.legacy && !image.invalid ? image.path : null,
        legacyImageInvalid: image.legacy && image.invalid,
        ...(includeLegacyImagePresent ? { legacyImagePresent: typeof raw.imageUrl === 'string' && raw.imageUrl.length > 0 } : {}),
    };
}

function queryAll(sdk, db, collectionName, constraints = []) {
    return queryRef(sdk, collectionRef(sdk, db, collectionName), constraints);
}

function makeMutationError(error, operation) {
    return error instanceof FirebaseClientError ? error : normalizeFirebaseError(error, { operation });
}

function readUpdatedAt(snapshot) {
    return snapshotData(snapshot).updatedAt ?? null;
}

function ensureExpected(snapshot, expectedUpdatedAt) {
    if (expectedUpdatedAt !== undefined && !timestampEqual(readUpdatedAt(snapshot), expectedUpdatedAt)) {
        throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'pnj-expected-updated-at' });
    }
}

function newDocumentRef(sdk, db, collectionName, requestedId) {
    if (requestedId !== undefined) {
        if (!validId(requestedId)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-id' });
        return documentRef(sdk, db, collectionName, requestedId);
    }
    const collection = collectionRef(sdk, db, collectionName);
    if (typeof sdk.doc !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-id' });
    const generated = sdk.doc(collection);
    if (!generated?.id) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-id' });
    return generated;
}

function batchApi(sdk, db, operation) {
    if (typeof sdk.writeBatch !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    const batch = sdk.writeBatch(db);
    if (!batch || typeof batch.commit !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    return batch;
}

function transactionApi(sdk, db, operation) {
    if (typeof sdk.runTransaction !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation });
    return sdk.runTransaction;
}

function relationDocsWithoutId(snapshot, id) {
    return docsFromSnapshot(snapshot).filter(item => {
        const data = snapshotData(item);
        return data.source === id || data.cible === id;
    });
}

function visibleRelationRefs(sdk, db, snapshot, id) {
    return relationDocsWithoutId(snapshot, id)
        .filter(item => snapshotData(item).visibleJoueurs === true)
        .map(item => documentRef(sdk, db, 'relations', snapshotId(item)));
}

function indiceDocsWithId(snapshot, id) {
    return docsFromSnapshot(snapshot).filter(item => snapshotData(item).pnjsLies?.includes(id));
}

function deletionState({ firestoreDone, imageCleanupPending, lockRetained, imagePaths = [], legacyImageSkipped = false }) {
    return Object.freeze({
        firestoreDone,
        imageCleanupPending,
        lockRetained,
        imagePaths: [...imagePaths],
        legacyImageSkipped: legacyImageSkipped === true,
    });
}

function throwWithState(error, state, operation) {
    const normalized = makeMutationError(error, operation);
    normalized.state = state;
    throw normalized;
}

function imageCleanupSucceeded(result) {
    return result === true || result?.ok === true || result?.status === 'completed';
}

function arrayRemoveValue(sdk, id) {
    if (typeof sdk.arrayRemove !== 'function') {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'remove-pnj-array' });
    }
    return sdk.arrayRemove(id);
}

function protectedImagePathOrNull(value, id) {
    if (!value || typeof id !== 'string' || id.length > 100) return null;
    try { return validateImagePath(value, id); }
    catch { return null; }
}

function createRepository({ sdk, client, role, imageService = null } = {}) {
    const db = requireRepository(sdk, client, 'pnj-repository');
    const isMj = role === 'mj';

    function subscribeCollection(target, normalizer, comparator, onData, onError, filter = () => true) {
        const state = { lastKey: null };
        return subscribeSnapshot(sdk, target, snapshot => {
            try { emitNormalized(snapshot, normalizer, comparator, onData, state, filter); }
            catch (error) { if (typeof onError === 'function') onError(makeMutationError(error, 'subscribe')); }
        }, onError, client?.listen);
    }

    function subscribeVisible(onData, onError) {
        const target = queryAll(sdk, db, 'pnjs', [whereConstraint(sdk, 'visibleJoueurs', '==', true)]);
        return subscribeCollection(target, normalizePnjForRepository, comparePnj, onData, onError,
            pnj => pnj.visibleJoueurs === true && pnj.suppressionEnCours !== true);
    }

    function subscribeAll(onData, onError) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'subscribe-all-pnjs' });
        return subscribeCollection(queryAll(sdk, db, 'pnjs'), snapshot => normalizePnjForRepository(snapshot, true), comparePnj, onData, onError);
    }

    function subscribeOne(id, onData, onError) {
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'subscribe-pnj' });
        const target = isMj
            ? documentRef(sdk, db, 'pnjs', id)
            : queryAll(sdk, db, 'pnjs', [
                whereConstraint(sdk, 'visibleJoueurs', '==', true),
                whereConstraint(sdk, documentIdConstraint(sdk), '==', id),
            ]);
        const state = { lastKey: null };
        return subscribeSnapshot(sdk, target, snapshot => {
            try {
                let normalized = null;
                if (Array.isArray(snapshot?.docs)) {
                    const found = docsFromSnapshot(snapshot).find(item => snapshotId(item) === id);
                    normalized = found ? normalizePnjForRepository(found, isMj) : null;
                } else if (snapshotExists(snapshot)) {
                    normalized = normalizePnjForRepository(snapshot, isMj);
                }
                if (!isMj && !(normalized?.visibleJoueurs === true && normalized.suppressionEnCours !== true)) normalized = null;
                const metadata = snapshotMetadata(snapshot);
                const key = valueKey([normalized, metadata]);
                if (key === state.lastKey) return;
                state.lastKey = key;
                onData(normalized, metadata);
            } catch (error) { if (typeof onError === 'function') onError(makeMutationError(error, 'subscribe-pnj')); }
        }, onError, client?.listen);
    }

    function subscribePrivate(id, onData, onError) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'subscribe-private-pnj' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'subscribe-private-pnj' });
        const state = { lastKey: null };
        return subscribeSnapshot(sdk, documentRef(sdk, db, 'pnjs_prives', id), snapshot => {
            try {
                const normalized = snapshotExists(snapshot) ? normalizePnjPrivate(snapshot) : null;
                const metadata = snapshotMetadata(snapshot);
                const key = valueKey([normalized, metadata]);
                if (key === state.lastKey) return;
                state.lastKey = key;
                onData(normalized, metadata);
            }
            catch (error) { if (typeof onError === 'function') onError(makeMutationError(error, 'subscribe-private-pnj')); }
        }, onError, client?.listen);
    }

    async function create(publicInput, privateInput = {}, options = {}) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'create-pnj' });
        const pnjRef = newDocumentRef(sdk, db, 'pnjs', options.id ?? publicInput?.id);
        const id = pnjRef.id;
        const publicPayload = { ...(publicInput ?? {}) };
        delete publicPayload.id;
        const publicData = sanitizePublic(publicPayload, id, { create: true });
        const privateData = sanitizePrivate(privateInput, { create: true });
        delete publicData.id;
        const batch = batchApi(sdk, db, 'create-pnj');
        const timestamp = serverTimestamp(sdk);
        batch.set(pnjRef, { ...publicData, createdAt: timestamp, updatedAt: timestamp });
        batch.set(documentRef(sdk, db, 'pnjs_prives', id), { ...privateData, updatedAt: timestamp });
        try { await batch.commit(); return { id }; }
        catch (error) { throw makeMutationError(error, 'create-pnj'); }
    }

    function reserveId() {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'reserve-pnj-id' });
        return newDocumentRef(sdk, db, 'pnjs').id;
    }

    // expectedPrivateUpdatedAt est optionnel pour conserver la compatibilité des appels bureau
    // historiques à quatre arguments ; mobile le fournit pour les éditions privées concurrentes.
    async function update(id, patchPublic = {}, patchPrivate = {}, expectedUpdatedAt, expectedPrivateUpdatedAt, options = {}) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'update-pnj' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'update-pnj' });
        const pnjRef = documentRef(sdk, db, 'pnjs', id);
        const privateRef = documentRef(sdk, db, 'pnjs_prives', id);
        try {
            const publicData = sanitizePublic(patchPublic, id);
            const privateData = sanitizePrivate(patchPrivate);
            if (publicData.imagePath === null) {
                if (typeof sdk.deleteField !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-image-delete' });
                publicData.imagePath = sdk.deleteField();
            }
            // Toute intention explicite sur le portrait moderne rend une
            // éventuelle référence legacy contradictoire : elle est purgée
            // dans la même transaction, sans dépendre d’un indicateur UI.
            const clearLegacyImageUrl = Object.hasOwn(publicData, 'imagePath') || options?.clearLegacyImageUrl === true;
            if (clearLegacyImageUrl) {
                if (typeof sdk.deleteField !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'pnj-legacy-image-delete' });
                publicData.imageUrl = sdk.deleteField();
            }
            if (!Object.keys(publicData).length && !Object.keys(privateData).length) {
                throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'update-pnj-empty' });
            }
            let result;
            let firstPass = true;
            let transactionCount = 0;
            const revoking = publicData.visibleJoueurs === false;
            while (true) {
                const relationsSnapshot = revoking
                    ? await getDocuments(sdk, collectionRef(sdk, db, 'relations'))
                    : { docs: [] };
                const relationsToRevoke = visibleRelationRefs(sdk, db, relationsSnapshot, id);
                if (relationsToRevoke.length > MAX_REVOCATION_RELATIONS) {
                    throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-pnj-revoke-relations' });
                }
                const sublots = relationsToRevoke.length
                    ? Array.from({ length: Math.ceil(relationsToRevoke.length / RELATIONS_PER_REVOCATION_TRANSACTION) },
                        (_, index) => relationsToRevoke.slice(index * RELATIONS_PER_REVOCATION_TRANSACTION,
                            (index + 1) * RELATIONS_PER_REVOCATION_TRANSACTION))
                    : [[]];
                for (const relationsBatch of sublots) {
                    if (transactionCount >= MAX_REVOCATION_TRANSACTIONS) {
                        throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-pnj-revoke-relations-stabilize' });
                    }
                    const applyPnjPatch = firstPass;
                    result = await transactionApi(sdk, db, 'update-pnj')(db, async transaction => {
                        const pnjSnapshot = await transaction.get(pnjRef);
                        if (!snapshotExists(pnjSnapshot)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'update-pnj' });
                        if (applyPnjPatch) ensureExpected(pnjSnapshot, expectedUpdatedAt);
                        else if (snapshotData(pnjSnapshot).visibleJoueurs !== false) {
                            throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-pnj-revoke-republished' });
                        }
                        if (applyPnjPatch && Object.keys(privateData).length && expectedPrivateUpdatedAt !== undefined) {
                            const privateSnapshot = await transaction.get(privateRef);
                            if (!snapshotExists(privateSnapshot)
                                || !timestampEqual(readUpdatedAt(privateSnapshot), expectedPrivateUpdatedAt)) {
                                throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'update-pnj-private' });
                            }
                        }
                        const timestamp = serverTimestamp(sdk);
                        const relationSnapshots = [];
                        for (const relationRef of relationsBatch) relationSnapshots.push(await transaction.get(relationRef));
                        if (applyPnjPatch) {
                            // Le PNJ public porte la version commune : une édition privée seule doit
                            // tout de même faire conflit avec une autre édition concurrente.
                            transaction.update(pnjRef, { ...publicData, updatedAt: timestamp });
                            if (Object.keys(privateData).length) transaction.set(privateRef, { ...privateData, updatedAt: timestamp }, { merge: true });
                        }
                        for (const [index, relationRef] of relationsBatch.entries()) {
                            const relationSnapshot = relationSnapshots[index];
                            if (snapshotExists(relationSnapshot) && snapshotData(relationSnapshot).visibleJoueurs === true) {
                                transaction.update(relationRef, { visibleJoueurs: false, updatedAt: timestamp });
                            }
                        }
                        return { id };
                    });
                    firstPass = false;
                    transactionCount += 1;
                }
                if (!revoking) break;
                const remaining = visibleRelationRefs(sdk, db,
                    await getDocuments(sdk, collectionRef(sdk, db, 'relations')), id);
                if (!remaining.length) break;
            }
            return result;
        } catch (error) { throw makeMutationError(error, 'update-pnj'); }
    }

    async function collectImpact(id) {
        const [relations, indices] = await Promise.all([
            getDocuments(sdk, collectionRef(sdk, db, 'relations')),
            getDocuments(sdk, collectionRef(sdk, db, 'indices')),
        ]);
        return {
            relationDocs: relationDocsWithoutId(relations, id),
            indiceDocs: indiceDocsWithId(indices, id),
        };
    }

    // L’aperçu ne pose aucun verrou : il informe l’écran avant confirmation,
    // tandis que remove() recalcule toujours l’impact sous verrou de cascade.
    async function inspectRemovalImpact(id) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'inspect-pnj-removal-impact' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'inspect-pnj-removal-impact' });
        try {
            const [pnjSnapshot, privateSnapshot, impact] = await Promise.all([
                getDocument(sdk, documentRef(sdk, db, 'pnjs', id)),
                getDocument(sdk, documentRef(sdk, db, 'pnjs_prives', id)),
                collectImpact(id),
            ]);
            if (!snapshotExists(pnjSnapshot)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'inspect-pnj-removal-impact' });
            const data = snapshotData(pnjSnapshot);
            const normalizedPublic = normalizePnjPublic(pnjSnapshot);
            const normalizedPrivate = snapshotExists(privateSnapshot) ? normalizePnjPrivate(privateSnapshot) : null;
            if (normalizedPublic.issues.length || normalizedPrivate?.issues?.length) {
                throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'inspect-pnj-removal-impact' });
            }
            const imagePath = protectedImagePathOrNull(data.imagePath, id);
            return Object.freeze({
                id,
                name: normalizedPublic.nom,
                relationsCount: impact.relationDocs.length,
                indicesCount: impact.indiceDocs.length,
                hasPortrait: Boolean(imagePath
                    || (typeof data.imagePath === 'string' && data.imagePath.length)
                    || (typeof data.imageUrl === 'string' && data.imageUrl.length)),
                hasPrivateNotes: Boolean(normalizedPrivate?.notes?.trim()),
            });
        } catch (error) {
            throw makeMutationError(error, 'inspect-pnj-removal-impact');
        }
    }

    async function inspectVisibilityImpact(id) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'inspect-pnj-visibility-impact' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'inspect-pnj-visibility-impact' });
        try {
            const [pnjSnapshot, relations, pnjs] = await Promise.all([
                getDocument(sdk, documentRef(sdk, db, 'pnjs', id)),
                getDocuments(sdk, collectionRef(sdk, db, 'relations')),
                getDocuments(sdk, collectionRef(sdk, db, 'pnjs')),
            ]);
            if (!snapshotExists(pnjSnapshot)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'inspect-pnj-visibility-impact' });
            const normalized = normalizePnjPublic(pnjSnapshot);
            if (normalized.issues.length) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'inspect-pnj-visibility-impact' });
            const visibleRelations = relationDocsWithoutId(relations, id)
                .filter(snapshot => snapshotData(snapshot).visibleJoueurs === true).length;
            const endpoints = new Map(docsFromSnapshot(pnjs).map(snapshot => {
                const normalizedEndpoint = normalizePnjPublic(snapshot);
                return [snapshotId(snapshot), normalizedEndpoint];
            }));
            const incompatibleVisibleRelationsCount = relationDocsWithoutId(relations, id)
                .filter(snapshot => snapshotData(snapshot).visibleJoueurs === true)
                .filter(snapshot => {
                    const data = snapshotData(snapshot);
                    const otherId = data.source === id ? data.cible : data.source;
                    const endpoint = endpoints.get(otherId);
                    return !endpoint || endpoint.visibleJoueurs !== true || endpoint.suppressionEnCours === true;
                }).length;
            return Object.freeze({ id, visibleRelationsCount: visibleRelations, incompatibleVisibleRelationsCount });
        } catch (error) { throw makeMutationError(error, 'inspect-pnj-visibility-impact'); }
    }

    async function commitImpact(id, impact) {
        const operations = [
            ...impact.relationDocs.map(snapshot => ({ kind: 'delete', ref: documentRef(sdk, db, 'relations', snapshotId(snapshot)) })),
            ...impact.indiceDocs.map(snapshot => {
                return {
                    kind: 'update',
                    ref: documentRef(sdk, db, 'indices', snapshotId(snapshot)),
                    data: { pnjsLies: arrayRemoveValue(sdk, id), updatedAt: serverTimestamp(sdk) },
                };
            }),
        ];
        await commitCascadeBatches(operations, async batchOperations => {
            const batch = batchApi(sdk, db, 'remove-pnj-cascade');
            for (const operation of batchOperations) {
                if (operation.kind === 'delete') batch.delete(operation.ref);
                else batch.update(operation.ref, operation.data);
            }
            await batch.commit();
        }, 500, 2);
    }

    async function completeRemovalUnsafe(id, lockData) {
        const rawImagePaths = Array.isArray(lockData?.imagePaths) ? lockData.imagePaths : [];
        if (rawImagePaths.length > 2) {
            throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'remove-pnj-image-paths' });
        }
        const imagePaths = rawImagePaths.map(path => validateImagePath(path, id));
        const legacyImageSkipped = lockData?.legacyImageSkipped === true;
        for (let pass = 0; pass < 5; pass += 1) {
            const impact = await collectImpact(id);
            if (!impact.relationDocs.length && !impact.indiceDocs.length) break;
            await commitImpact(id, impact);
            if (pass === 4) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'remove-pnj-stabilize' });
        }
        const finalImpact = await collectImpact(id);
        if (finalImpact.relationDocs.length || finalImpact.indiceDocs.length) {
            throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'remove-pnj-stabilize' });
        }
        const pnjRef = documentRef(sdk, db, 'pnjs', id);
        const privateRef = documentRef(sdk, db, 'pnjs_prives', id);
        const lockRef = documentRef(sdk, db, 'integrity_locks', 'pnj-deletion');
        const finalBatch = batchApi(sdk, db, 'remove-pnj-final');
        finalBatch.delete(privateRef);
        finalBatch.delete(pnjRef);
        try { await finalBatch.commit(); }
        catch (error) {
            throwWithState(error, deletionState({ firestoreDone: false, imageCleanupPending: false, lockRetained: true, imagePaths, legacyImageSkipped }), 'remove-pnj-final');
        }
        if (imagePaths.length) {
            if (!imageService || typeof imageService.cleanupPnjImages !== 'function') {
                throwWithState(new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'remove-pnj-image-service' }),
                    deletionState({ firestoreDone: true, imageCleanupPending: true, lockRetained: true, imagePaths, legacyImageSkipped }), 'remove-pnj-image-service');
            }
            try {
                const result = await imageService.cleanupPnjImages({ pnjId: id, imagePaths, lock: lockData });
                if (!imageCleanupSucceeded(result)) throw new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'remove-pnj-image-cleanup' });
            } catch (error) {
                throwWithState(error, deletionState({ firestoreDone: true, imageCleanupPending: true, lockRetained: true, imagePaths, legacyImageSkipped }), 'remove-pnj-image-cleanup');
            }
        }
        const unlockBatch = batchApi(sdk, db, 'remove-pnj-unlock');
        unlockBatch.delete(lockRef);
        try { await unlockBatch.commit(); }
        catch (error) {
            throwWithState(error, deletionState({ firestoreDone: true, imageCleanupPending: false, lockRetained: true, imagePaths, legacyImageSkipped }), 'remove-pnj-unlock');
        }
        return deletionState({ firestoreDone: true, imageCleanupPending: false, lockRetained: false, imagePaths, legacyImageSkipped });
    }

    async function completeRemoval(id, lockData) {
        const imagePaths = Array.isArray(lockData?.imagePaths) ? lockData.imagePaths : [];
        const legacyImageSkipped = lockData?.legacyImageSkipped === true;
        try {
            return await completeRemovalUnsafe(id, lockData);
        } catch (error) {
            if (error?.state) throw error;
            throwWithState(error, deletionState({
                firestoreDone: false,
                imageCleanupPending: false,
                lockRetained: true,
                imagePaths,
                legacyImageSkipped,
            }), 'remove-pnj-recovery');
        }
    }

    async function beginRemoval(id) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'remove-pnj' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'remove-pnj' });
        const pnjRef = documentRef(sdk, db, 'pnjs', id);
        const lockRef = documentRef(sdk, db, 'integrity_locks', 'pnj-deletion');
        return transactionApi(sdk, db, 'remove-pnj-lock')(db, async transaction => {
            const lockSnapshot = await transaction.get(lockRef);
            const pnjSnapshot = await transaction.get(pnjRef);
            if (lockSnapshot?.exists?.() && snapshotData(lockSnapshot).pnjId !== id) {
                throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'remove-pnj-lock' });
            }
            if (!pnjSnapshot?.exists?.()) {
                if (lockSnapshot?.exists?.()) return snapshotData(lockSnapshot);
                throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'remove-pnj' });
            }
            if (snapshotData(pnjSnapshot).suppressionEnCours === true && !lockSnapshot?.exists?.()) {
                throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'remove-pnj-lock' });
            }
            if (lockSnapshot?.exists?.()) return snapshotData(lockSnapshot);
            const data = snapshotData(pnjSnapshot);
            const protectedPath = protectedImagePathOrNull(data.imagePath, id);
            const imagePaths = protectedPath ? [protectedPath] : [];
            const legacyImageSkipped = Boolean((typeof data.imagePath === 'string' && data.imagePath.length && !protectedPath)
                || (typeof data.imageUrl === 'string' && data.imageUrl.length));
            const timestamp = serverTimestamp(sdk);
            transaction.set(lockRef, { pnjId: id, imagePaths, legacyImageSkipped, createdAt: timestamp, updatedAt: timestamp });
            transaction.update(pnjRef, { suppressionEnCours: true, updatedAt: timestamp });
            return { pnjId: id, imagePaths, legacyImageSkipped };
        });
    }

    async function remove(id) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'remove-pnj' });
        try {
            const lockData = await beginRemoval(id);
            return await completeRemoval(id, lockData);
        } catch (error) {
            if (error?.state) throw error;
            let lockRetained = false;
            let imagePaths = [];
            let legacyImageSkipped = false;
            if (validId(id)) {
                try {
                    const lockSnapshot = await getDocument(sdk, documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
                    const lockData = snapshotExists(lockSnapshot) ? snapshotData(lockSnapshot) : null;
                    lockRetained = lockData?.pnjId === id;
                    imagePaths = Array.isArray(lockData?.imagePaths) ? lockData.imagePaths : [];
                    legacyImageSkipped = lockData?.legacyImageSkipped === true;
                } catch { /* L'état reste conservateur sans inventer un verrou. */ }
            }
            throwWithState(error, deletionState({ firestoreDone: false, imageCleanupPending: false, lockRetained, imagePaths, legacyImageSkipped }), 'remove-pnj');
        }
    }

    async function resumeRemoval(id) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'resume-pnj-removal' });
        if (!validId(id)) throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'resume-pnj-removal' });
        let lockData = null;
        try {
            const lockSnapshot = await getDocument(sdk, documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
            if (!snapshotExists(lockSnapshot)) throw new FirebaseClientError(ERROR_KINDS.NOT_FOUND, { operation: 'resume-pnj-removal' });
            lockData = snapshotData(lockSnapshot);
            if (lockData.pnjId !== id) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'resume-pnj-removal' });
            return await completeRemoval(id, lockData);
        } catch (error) {
            if (error?.state) throw error;
            throwWithState(error, deletionState({
                firestoreDone: false,
                imageCleanupPending: false,
                lockRetained: Boolean(lockData),
                imagePaths: Array.isArray(lockData?.imagePaths) ? lockData.imagePaths : [],
                legacyImageSkipped: lockData?.legacyImageSkipped === true,
            }), 'resume-pnj-removal');
        }
    }

    async function inspectRemovalLock() {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'inspect-pnj-removal' });
        const snapshot = await getDocument(sdk, documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'));
        return snapshotExists(snapshot) ? snapshotData(snapshot) : null;
    }

    async function inspectPortraitCommit(id, expectedNewPath, {
        creation = false, previousUpdatedAt, previousPrivateUpdatedAt,
    } = {}) {
        if (!isMj) throw new FirebaseClientError(ERROR_KINDS.PERMISSION, { operation: 'inspect-pnj-portrait-commit' });
        if (!validId(id) || typeof expectedNewPath !== 'string') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'inspect-pnj-portrait-commit' });
        validateImagePath(expectedNewPath, id);
        const [publicSnapshot, privateSnapshot] = await Promise.all([
            getDocument(sdk, documentRef(sdk, db, 'pnjs', id)),
            getDocument(sdk, documentRef(sdk, db, 'pnjs_prives', id)),
        ]);
        const publicExists = snapshotExists(publicSnapshot);
        const privateExists = snapshotExists(privateSnapshot);
        const publicMatches = publicExists && snapshotData(publicSnapshot).imagePath === expectedNewPath;
        if (creation) {
            if (publicMatches && privateExists) return Object.freeze({ status: 'committed' });
            if (!publicExists && !privateExists) return Object.freeze({ status: 'not-committed' });
            return Object.freeze({ status: 'inconsistent' });
        }
        if (publicMatches) return Object.freeze({ status: 'committed' });
        if (!publicExists) return Object.freeze({ status: 'inconsistent' });
        const publicData = snapshotData(publicSnapshot);
        const privateData = privateExists ? snapshotData(privateSnapshot) : null;
        const versionMatches = (current, expected) => expected === undefined
            || (expected === null ? current === null || current === undefined : timestampEqual(current, expected));
        const hasBaseline = previousUpdatedAt !== undefined || previousPrivateUpdatedAt !== undefined;
        const unchanged = hasBaseline
            && versionMatches(publicData.updatedAt, previousUpdatedAt)
            && versionMatches(privateData?.updatedAt, previousPrivateUpdatedAt);
        return Object.freeze({ status: unchanged ? 'not-committed' : 'inconsistent' });
    }

    const repository = { subscribeVisible, subscribeOne };
    if (isMj) Object.assign(repository, {
        subscribeAll, subscribePrivate, create, reserveId, update, remove, resumeRemoval, inspectRemovalLock, inspectPortraitCommit, inspectRemovalImpact,
        inspectVisibilityImpact,
    });
    return Object.freeze(repository);
}

export function createPublicPnjRepository(options = {}) {
    return createRepository({ ...options, role: 'public' });
}

export function createMjPnjRepository(options = {}) {
    return createRepository({ ...options, role: 'mj' });
}

export const createPublicPnjsRepository = createPublicPnjRepository;
export const createMjPnjsRepository = createMjPnjRepository;

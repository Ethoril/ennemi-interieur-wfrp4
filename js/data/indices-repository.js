import { normalizeIndice, normalizeTimestamp } from './firebase-normalizers.js';
import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { canonicalLegacyImageUrl, describeImage, imagePathFor } from './images-repository.js';
import {
    collectionRef, compareUnicode, documentIdConstraint, documentRef, getDocument, queryRef,
    requireRepository, serverTimestamp, snapshotData, snapshotId, snapshotMetadata,
    sortedBy, subscribeSnapshot, timestampEqual, valueKey, whereConstraint,
} from './repository-utils.js';

const FIELDS = Object.freeze(['titre', 'description', 'decouvert', 'pnjsLies', 'imagePath', 'dateDecouverte', 'source', 'type', 'ordre']);
const MAX_LINKS = 100;
const MAX_RAW_LINKS = 500;

function fail(operation, kind = ERROR_KINDS.VALIDATION) {
    throw new FirebaseClientError(kind, { operation });
}

function normalizedError(error, operation) {
    const normalized = error instanceof FirebaseClientError ? error : normalizeFirebaseError(error, { operation });
    if (normalized.code === 'failed-precondition' || error?.code === 'failed-precondition') normalized.technicalCode = 'firestore-index-required';
    return normalized;
}

function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(value); }

function validateKeys(input, operation) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !FIELDS.includes(key))) fail(operation);
}

function text(value, field, max, required = false) {
    if (typeof value !== 'string' || value.length > max || (required && value.trim() === '')) fail(`indice-${field}`);
    return value;
}

function normalizeLinks(value) {
    if (!Array.isArray(value) || value.length > MAX_RAW_LINKS) fail('indice-pnjs-lies');
    const links = [...new Set(value)];
    if (links.length > MAX_LINKS || links.some(id => !validId(id))) fail('indice-pnjs-lies');
    return links.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function firestoreDate(value) {
    if (value === null) return null;
    if (value instanceof Date || typeof value?.toDate === 'function') return value;
    const normalized = normalizeTimestamp(value);
    if (!normalized) fail('indice-date');
    return new Date(normalized.seconds * 1000 + Math.floor(normalized.nanoseconds / 1e6));
}

function sanitize(input, id, { create = false } = {}) {
    validateKeys(input, 'indice-validation');
    const output = {};
    if (create || Object.hasOwn(input, 'titre')) output.titre = text(input.titre, 'titre', 200, true);
    for (const [field, max] of [['description', 30000], ['source', 150], ['type', 100]]) {
        if (Object.hasOwn(input, field)) output[field] = text(input[field], field, max);
    }
    if (create || Object.hasOwn(input, 'decouvert')) {
        if (typeof input.decouvert !== 'boolean') fail('indice-decouvert');
        output.decouvert = input.decouvert;
    }
    if (create || Object.hasOwn(input, 'pnjsLies')) output.pnjsLies = normalizeLinks(input.pnjsLies ?? []);
    if (Object.hasOwn(input, 'imagePath')) {
        if (typeof input.imagePath !== 'string' || !input.imagePath) fail('indice-image-path');
        const parts = input.imagePath.split('/');
        if (parts.length !== 3 || input.imagePath !== imagePathFor('indice', id, parts[2])) fail('indice-image-path');
        output.imagePath = input.imagePath;
    }
    if (Object.hasOwn(input, 'dateDecouverte')) {
        output.dateDecouverte = firestoreDate(input.dateDecouverte);
    }
    if (Object.hasOwn(input, 'ordre')) {
        if (input.ordre !== null && (typeof input.ordre !== 'number' || !Number.isFinite(input.ordre))) fail('indice-ordre');
        output.ordre = input.ordre;
    }
    return output;
}

function compareIndice(left, right) {
    const leftOrder = typeof left.ordre === 'number' && Number.isFinite(left.ordre) ? left.ordre : null;
    const rightOrder = typeof right.ordre === 'number' && Number.isFinite(right.ordre) ? right.ordre : null;
    if (leftOrder === null && rightOrder !== null) return 1;
    if (leftOrder !== null && rightOrder === null) return -1;
    if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
    const leftDate = normalizeTimestamp(left.dateDecouverte);
    const rightDate = normalizeTimestamp(right.dateDecouverte);
    if (leftDate && !rightDate) return -1;
    if (!leftDate && rightDate) return 1;
    if (leftDate && rightDate) {
        if (leftDate.seconds !== rightDate.seconds) return rightDate.seconds - leftDate.seconds;
        if (leftDate.nanoseconds !== rightDate.nanoseconds) return rightDate.nanoseconds - leftDate.nanoseconds;
    }
    return compareUnicode(left.titre, right.titre) || compareUnicode(left.id, right.id);
}

function exists(snapshot) { return typeof snapshot?.exists === 'function' ? snapshot.exists() : snapshot?.exists === true; }
function docs(snapshot) { return Array.isArray(snapshot?.docs) ? snapshot.docs : []; }

function repositoryIndice(snapshot) {
    const normalized = normalizeIndice(snapshot);
    const image = describeImage(normalized);
    const withoutRawImage = { ...normalized };
    delete withoutRawImage.imagePath;
    delete withoutRawImage.imageUrl;
    return { ...withoutRawImage, image };
}

function emitList(snapshot, onData, state, filter) {
    const items = sortedBy(docs(snapshot).map(repositoryIndice).filter(filter), compareIndice);
    const metadata = snapshotMetadata(snapshot);
    const key = `${valueKey(items)}|${metadata.fromCache}|${metadata.hasPendingWrites}`;
    if (key === state.lastKey) return;
    state.lastKey = key;
    onData(items, metadata);
}

function transactionApi(sdk, db, operation, callback) {
    if (typeof sdk.runTransaction !== 'function') fail(operation);
    return sdk.runTransaction(db, callback);
}

function queryIndices(sdk, db, constraints = []) {
    return queryRef(sdk, collectionRef(sdk, db, 'indices'), constraints);
}

function lockRef(sdk, db) { return documentRef(sdk, db, 'integrity_locks', 'pnj-deletion'); }

function indiceImageLockRef(sdk, db, id) {
    if (typeof sdk.doc !== 'function') fail('indice-image-lock');
    return sdk.doc(db, 'integrity_locks/images/indices', id);
}

function ownedIndicePath(path, id) {
    if (typeof path !== 'string') return false;
    const parts = path.split('/');
    try { return parts.length === 3 && path === imagePathFor('indice', id, parts[2]); }
    catch { return false; }
}

function legacyImageState(data) {
    const present = typeof data?.imageUrl === 'string' && data.imageUrl.length > 0;
    return { legacyImageSkipped: present, legacyImageInvalid: present && !canonicalLegacyImageUrl(data.imageUrl),
        skippedLegacyImageUrl: present ? canonicalLegacyImageUrl(data.imageUrl) : null };
}

function invalidImagePathReason(path, ownerId) {
    if (typeof path !== 'string' || !path || ownedIndicePath(path, ownerId)) return null;
    return canonicalLegacyImageUrl(path) ? 'external-reference' : 'owner-mismatch';
}

function createRepository({ sdk, client, role, imageService = null } = {}) {
    const db = requireRepository(sdk, client, 'indice-repository');
    const isMj = role === 'mj';

    function subscribeList(target, onData, onError, filter) {
        const state = { lastKey: null };
        return subscribeSnapshot(sdk, target, snapshot => {
            try { emitList(snapshot, onData, state, filter); }
            catch (error) { if (typeof onError === 'function') onError(normalizedError(error, 'subscribe-indices')); }
        }, error => { if (typeof onError === 'function') onError(normalizedError(error, 'subscribe-indices')); }, client?.listen);
    }

    function publicFilter(indice) { return indice.decouvert === true; }
    function subscribeDiscovered(onData, onError) {
        return subscribeList(queryIndices(sdk, db, [whereConstraint(sdk, 'decouvert', '==', true)]), onData, onError, publicFilter);
    }

    function subscribeAll(onData, onError) {
        if (!isMj) fail('subscribe-all-indices', ERROR_KINDS.PERMISSION);
        return subscribeList(queryIndices(sdk, db), onData, onError, () => true);
    }

    function subscribeOne(id, onData, onError) {
        if (!validId(id)) fail('subscribe-indice');
        const target = isMj ? documentRef(sdk, db, 'indices', id)
            : queryIndices(sdk, db, [whereConstraint(sdk, 'decouvert', '==', true), whereConstraint(sdk, documentIdConstraint(sdk), '==', id)]);
        const state = { lastKey: null };
        return subscribeSnapshot(sdk, target, snapshot => {
            try {
                const found = Array.isArray(snapshot?.docs) ? docs(snapshot).find(item => snapshotId(item) === id) : snapshot;
                const item = found && exists(found) !== false ? repositoryIndice(found) : null;
                const visible = isMj || (item?.decouvert === true);
                const metadata = snapshotMetadata(snapshot);
                const result = visible ? item : null;
                const key = valueKey([result, metadata]);
                if (key === state.lastKey) return;
                state.lastKey = key;
                onData(result, metadata);
            } catch (error) { if (typeof onError === 'function') onError(normalizedError(error, 'subscribe-indice')); }
        }, error => { if (typeof onError === 'function') onError(normalizedError(error, 'subscribe-indice')); }, client?.listen);
    }

    function subscribeLinked(pnjId, onData, onError) {
        if (!validId(pnjId)) fail('subscribe-linked-indices');
        const constraints = [whereConstraint(sdk, 'pnjsLies', 'array-contains', pnjId)];
        if (!isMj) constraints.unshift(whereConstraint(sdk, 'decouvert', '==', true));
        return subscribeList(queryIndices(sdk, db, constraints), onData, onError, isMj ? () => true : publicFilter);
    }

    async function assertImageLockReleased(id, path, operation) {
        const lock = await getDocument(sdk, indiceImageLockRef(sdk, db, id));
        if (exists(lock)) {
            const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation });
            error.state = { firestoreDone: true, imageCleanupPending: true, imagePath: path, indiceId: id };
            throw error;
        }
    }

    async function validateLock(transaction) {
        const lock = await transaction.get(lockRef(sdk, db));
        if (exists(lock)) fail('indice-deletion-lock', ERROR_KINDS.CONFLICT);
    }

    async function validatePnjLinks(transaction, links) {
        const snapshots = [];
        for (const linkedId of links) snapshots.push(await transaction.get(documentRef(sdk, db, 'pnjs', linkedId)));
        for (const snapshot of snapshots) {
            if (!exists(snapshot)) fail('indice-pnj-not-found', ERROR_KINDS.NOT_FOUND);
            if (snapshotData(snapshot).suppressionEnCours === true) fail('indice-pnj-deletion', ERROR_KINDS.CONFLICT);
        }
    }

    async function uploadImage(id, options = {}) {
        if (!options.imageFile) return null;
        if (!imageService || typeof imageService.uploadClueImage !== 'function') fail('indice-image-service');
        let result;
        try {
            result = await imageService.uploadClueImage(id, options.imageFile);
        } catch (error) {
            throw normalizedError(error, 'indice-image-upload');
        }
        if (!result || !ownedIndicePath(result.imagePath, id)) {
            const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'indice-image-response' });
            error.state = { responsePathInvalid: true, compensationSkipped: true,
                responsePathReason: invalidImagePathReason(result?.imagePath, id) ?? 'invalid-response' };
            throw error;
        }
        return result;
    }

    async function compensateImage(path, id) {
        if (!path) return;
        if (!ownedIndicePath(path, id)) {
            const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'indice-image-compensation' });
            error.state = { responsePathInvalid: true, compensationSkipped: true,
                responsePathReason: invalidImagePathReason(path, id) ?? 'invalid-response' };
            throw error;
        }
        try {
            if (typeof imageService?.cleanupImage !== 'function') {
            const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'indice-image-compensation' });
            error.state = { commitUnknown: true, imageCleanupPending: true, imagePath: path, indiceId: id };
                throw error;
            }
            await imageService.cleanupImage(path, { collection: 'indices', ownerId: id, skipJournal: true });
        } catch (error) {
            const normalized = normalizedError(error, 'indice-image-compensation');
            normalized.state = { commitUnknown: true, imageCleanupPending: true, imagePath: path, indiceId: id };
            throw normalized;
        }
    }

    async function create(data, options = {}) {
        if (!isMj) fail('create-indice', ERROR_KINDS.PERMISSION);
        const requestedId = options.id ?? data?.id;
        const indiceRef = requestedId ? documentRef(sdk, db, 'indices', requestedId) : sdk.doc(collectionRef(sdk, db, 'indices'));
        const id = indiceRef.id;
        if (!validId(id)) fail('indice-id');
        const input = { ...(data ?? {}) }; delete input.id;
        const baseData = sanitize(input, id, { create: true });
        const image = await uploadImage(id, options);
        const publicData = image ? { ...baseData, imagePath: image.imagePath } : baseData;
        try {
            const result = await transactionApi(sdk, db, 'create-indice', async transaction => {
                await validateLock(transaction);
                await validatePnjLinks(transaction, publicData.pnjsLies);
                const existing = await transaction.get(indiceRef);
                if (exists(existing)) fail('create-indice-duplicate', ERROR_KINDS.CONFLICT);
                const timestamp = serverTimestamp(sdk);
                transaction.set(indiceRef, { ...publicData, createdAt: timestamp, updatedAt: timestamp });
                return { id };
            });
            if (image && (typeof imageService?.ackUpload !== 'function' || !imageService.ackUpload(image.imagePath))) {
                const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'create-indice-journal-ack' });
                error.state = { firestoreDone: true, imageCleanupPending: false, journalPending: true, imagePath: image.imagePath, indiceId: id };
                throw error;
            }
            return result;
        } catch (error) {
            if (error?.state?.firestoreDone === true) throw error;
            try { await compensateImage(image?.imagePath, id); }
            catch (compensationError) {
                compensationError.state = { ...(compensationError.state ?? {}), commitUnknown: true, imagePath: image?.imagePath, indiceId: id };
                throw compensationError;
            }
            const normalized = normalizedError(error, 'create-indice');
            normalized.state = { commitUnknown: true, imagePath: image?.imagePath ?? null, indiceId: id };
            throw normalized;
        }
    }

    async function update(id, patch = {}, expectedUpdatedAt, options = {}) {
        if (!isMj) fail('update-indice', ERROR_KINDS.PERMISSION);
        if (!validId(id)) fail('update-indice');
        const ref = documentRef(sdk, db, 'indices', id);
        const image = await uploadImage(id, options);
        let data;
        try { data = sanitize({ ...(patch ?? {}), ...(image ? { imagePath: image.imagePath } : {}) }, id); }
        catch (error) {
            if (image) await compensateImage(image.imagePath, id);
            throw error;
        }
        // A modern image replacement must clear any legacy durable URL in the
        // same Firestore write. Refuse the operation before the transaction if
        // the injected SDK cannot provide that sentinel, after compensating the
        // already-uploaded image.
        if (image && typeof sdk.deleteField !== 'function') {
            await compensateImage(image.imagePath, id);
            fail('update-indice-delete-field');
        }
        let result;
        let skippedLegacyImageUrl = null;
        let legacyImageSkipped = false;
        let legacyImageInvalid = false;
        let skippedImagePathInvalid = false;
        let skippedImagePathReason = null;
        try {
            result = await transactionApi(sdk, db, 'update-indice', async transaction => {
                const current = await transaction.get(ref);
                if (!exists(current)) fail('update-indice', ERROR_KINDS.NOT_FOUND);
                await validateLock(transaction);
                const currentData = snapshotData(current);
                const oldImagePath = currentData.imagePath ?? null;
                skippedImagePathReason = invalidImagePathReason(oldImagePath, id);
                skippedImagePathInvalid = Boolean(skippedImagePathReason);
                const legacy = legacyImageState(currentData);
                skippedLegacyImageUrl = legacy.skippedLegacyImageUrl;
                legacyImageSkipped = legacy.legacyImageSkipped;
                legacyImageInvalid = legacy.legacyImageInvalid;
                const skippedImagePath = !oldImagePath ? skippedLegacyImageUrl : null;
                const oldImageIsProtected = image && ownedIndicePath(oldImagePath, id)
                    && oldImagePath !== image.imagePath;
                const imageLock = oldImageIsProtected ? indiceImageLockRef(sdk, db, id) : null;
                const imageLockSnapshot = imageLock ? await transaction.get(imageLock) : null;
                if (imageLockSnapshot && exists(imageLockSnapshot)) fail('update-indice-image-lock', ERROR_KINDS.CONFLICT);
                if (!Object.keys(data).length) fail('update-indice-empty');
                if (expectedUpdatedAt !== undefined && !timestampEqual(snapshotData(current).updatedAt, expectedUpdatedAt)) fail('update-indice-conflict', ERROR_KINDS.CONFLICT);
                if (Object.hasOwn(data, 'pnjsLies')) await validatePnjLinks(transaction, data.pnjsLies);
                const timestamp = serverTimestamp(sdk);
                const write = { ...data, updatedAt: timestamp };
                if (image && typeof sdk.deleteField === 'function') write.imageUrl = sdk.deleteField();
                if (oldImageIsProtected) {
                    transaction.set(imageLock, { ownerCollection: 'indices', ownerId: id, path: oldImagePath,
                        createdAt: timestamp, updatedAt: timestamp });
                }
                transaction.update(ref, write);
                return { id, oldImagePath, skippedImagePath, skippedLegacyImageUrl, legacyImageSkipped, legacyImageInvalid,
                    skippedImagePathInvalid, skippedImagePathReason };
            });
        } catch (error) {
            if (image) {
                try { await compensateImage(image.imagePath, id); }
                catch (compensationError) {
                    compensationError.state = { ...(compensationError.state ?? {}), commitUnknown: true, imagePath: image.imagePath, indiceId: id };
                    throw compensationError;
                }
            }
            const normalized = normalizedError(error, 'update-indice');
            normalized.state = { commitUnknown: true, imagePath: image?.imagePath ?? null, skippedLegacyImageUrl,
                legacyImageSkipped, legacyImageInvalid, skippedImagePathInvalid, skippedImagePathReason, indiceId: id };
            throw normalized;
        }
        if (image && result.oldImagePath && result.oldImagePath !== image.imagePath && ownedIndicePath(result.oldImagePath, id)) {
            try {
                if (typeof imageService?.cleanupImage !== 'function') fail('update-indice-image-service');
                await imageService.cleanupImage(result.oldImagePath, { collection: 'indices', ownerId: id, skipJournal: true });
                await assertImageLockReleased(id, result.oldImagePath, 'update-indice-image-lock-release');
            } catch (error) {
                const normalized = normalizedError(error, 'update-indice-image-cleanup');
                normalized.state = { firestoreDone: true, imageCleanupPending: true, imagePath: result.oldImagePath,
                    skippedImagePath: result.skippedImagePath, skippedLegacyImageUrl: result.skippedLegacyImageUrl,
                    legacyImageSkipped: result.legacyImageSkipped, legacyImageInvalid: result.legacyImageInvalid,
                    skippedImagePathInvalid: result.skippedImagePathInvalid, skippedImagePathReason: result.skippedImagePathReason,
                    newImagePath: image.imagePath, indiceId: id };
                throw normalized;
            }
        }
        if (image && (typeof imageService?.ackUpload !== 'function' || !imageService.ackUpload(image.imagePath))) {
            const error = new FirebaseClientError(ERROR_KINDS.UNKNOWN, { operation: 'update-indice-journal-ack' });
            error.state = { firestoreDone: true, imageCleanupPending: false,
                imagePath: image.imagePath, newImagePath: image.imagePath,
                oldImagePath: ownedIndicePath(result.oldImagePath, id) ? result.oldImagePath : null,
                skippedImagePath: result.skippedImagePath, skippedLegacyImageUrl: result.skippedLegacyImageUrl,
                legacyImageSkipped: result.legacyImageSkipped, legacyImageInvalid: result.legacyImageInvalid,
                skippedImagePathInvalid: result.skippedImagePathInvalid, skippedImagePathReason: result.skippedImagePathReason,
                indiceId: id, journalPending: true };
            throw error;
        }
        return { id: result.id, skippedImagePath: result.skippedImagePath, skippedLegacyImageUrl: result.skippedLegacyImageUrl,
            legacyImageSkipped: result.legacyImageSkipped, legacyImageInvalid: result.legacyImageInvalid,
            skippedImagePathInvalid: result.skippedImagePathInvalid, skippedImagePathReason: result.skippedImagePathReason };
    }

    async function mutateLinks(id, pnjId, add) {
        if (!isMj) fail('mutate-indice-links', ERROR_KINDS.PERMISSION);
        if (!validId(id) || !validId(pnjId)) fail('mutate-indice-links');
        const ref = documentRef(sdk, db, 'indices', id);
        try {
            return await transactionApi(sdk, db, 'mutate-indice-links', async transaction => {
                const current = await transaction.get(ref);
                if (!exists(current)) fail('mutate-indice-links', ERROR_KINDS.NOT_FOUND);
                await validateLock(transaction);
                if (add) await validatePnjLinks(transaction, [pnjId]);
                const links = normalizeLinks(snapshotData(current).pnjsLies ?? []);
                const next = add ? [...new Set([...links, pnjId])] : links.filter(value => value !== pnjId);
                const timestamp = serverTimestamp(sdk);
                transaction.update(ref, { pnjsLies: normalizeLinks(next), updatedAt: timestamp });
                return { id, pnjsLies: normalizeLinks(next) };
            });
        } catch (error) { throw normalizedError(error, 'mutate-indice-links'); }
    }

    async function remove(id) {
        if (!isMj) fail('remove-indice', ERROR_KINDS.PERMISSION);
        if (!validId(id)) fail('remove-indice');
        const ref = documentRef(sdk, db, 'indices', id);
        let imagePath = null;
        let skippedImagePath = null;
        let skippedLegacyImageUrl = null;
        let legacyImageSkipped = false;
        let legacyImageInvalid = false;
        let skippedImagePathInvalid = false;
        let skippedImagePathReason = null;
        let imageLock = false;
        try {
            await transactionApi(sdk, db, 'remove-indice', async transaction => {
                imageLock = false;
                const current = await transaction.get(ref);
                if (!exists(current)) fail('remove-indice', ERROR_KINDS.NOT_FOUND);
                await validateLock(transaction);
                const currentData = snapshotData(current);
                imagePath = currentData.imagePath ?? null;
                skippedImagePathReason = invalidImagePathReason(imagePath, id);
                skippedImagePathInvalid = Boolean(skippedImagePathReason);
                const legacy = legacyImageState(currentData);
                skippedLegacyImageUrl = legacy.skippedLegacyImageUrl;
                legacyImageSkipped = legacy.legacyImageSkipped;
                legacyImageInvalid = legacy.legacyImageInvalid;
                skippedImagePath = !imagePath ? skippedLegacyImageUrl : null;
                if (ownedIndicePath(imagePath, id)) {
                    const cleanupLock = indiceImageLockRef(sdk, db, id);
                    const cleanupLockSnapshot = await transaction.get(cleanupLock);
                    if (exists(cleanupLockSnapshot)) fail('remove-indice-image-lock', ERROR_KINDS.CONFLICT);
                    const timestamp = serverTimestamp(sdk);
                    transaction.set(cleanupLock, { ownerCollection: 'indices', ownerId: id, path: imagePath,
                        createdAt: timestamp, updatedAt: timestamp });
                    imageLock = true;
                }
                transaction.delete(ref);
            });
        } catch (error) {
            const normalized = normalizedError(error, 'remove-indice');
            if (imagePath || skippedLegacyImageUrl) normalized.state = {
                commitUnknown: true, imagePath: ownedIndicePath(imagePath, id) ? imagePath : null, skippedImagePath, skippedLegacyImageUrl,
                legacyImageSkipped, legacyImageInvalid, skippedImagePathInvalid, skippedImagePathReason, indiceId: id,
            };
            throw normalized;
        }
        if (!imagePath) return { firestoreDone: true, imageCleanupPending: false, imagePath: null, skippedImagePath, skippedLegacyImageUrl, legacyImageSkipped, legacyImageInvalid };
        if (!ownedIndicePath(imagePath, id)) return { firestoreDone: true, imageCleanupPending: false, imagePath: null,
            skippedImagePath, skippedLegacyImageUrl, legacyImageSkipped, legacyImageInvalid, skippedImagePathInvalid, skippedImagePathReason };
        try {
            if (!imageService || typeof imageService.cleanupImage !== 'function') fail('remove-indice-image-service');
            await imageService.cleanupImage(imagePath, { collection: 'indices', ownerId: id, skipJournal: true });
            await assertImageLockReleased(id, imagePath, 'remove-indice-image-lock-release');
            return { firestoreDone: true, imageCleanupPending: false, imagePath, imageLock, skippedImagePath, skippedLegacyImageUrl,
                legacyImageSkipped, legacyImageInvalid, skippedImagePathInvalid, skippedImagePathReason };
        } catch (error) {
            const normalized = normalizedError(error, 'remove-indice-image-cleanup');
            normalized.state = { firestoreDone: true, imageCleanupPending: true, imagePath, skippedImagePath,
                skippedLegacyImageUrl, legacyImageSkipped, legacyImageInvalid, skippedImagePathInvalid, skippedImagePathReason, indiceId: id };
            throw normalized;
        }
    }

    async function resumeRemoval(id) {
        if (!isMj) fail('resume-indice-removal', ERROR_KINDS.PERMISSION);
        if (!validId(id)) fail('resume-indice-removal');
        const ref = indiceImageLockRef(sdk, db, id);
        let path = null;
        try {
            const lock = await getDocument(sdk, ref);
            if (!exists(lock)) fail('resume-indice-removal', ERROR_KINDS.NOT_FOUND);
            const data = snapshotData(lock);
            if (data.ownerCollection !== 'indices' || data.ownerId !== id || !ownedIndicePath(data.path, id)) fail('resume-indice-removal');
            const owner = await getDocument(sdk, documentRef(sdk, db, 'indices', id));
            if (exists(owner)) fail('resume-indice-removal-conflict', ERROR_KINDS.CONFLICT);
            path = data.path;
            if (!imageService || typeof imageService.cleanupImage !== 'function') fail('resume-indice-image-service');
            await imageService.cleanupImage(path, { collection: 'indices', ownerId: id, skipJournal: true });
            await assertImageLockReleased(id, path, 'resume-indice-image-lock-release');
            return { firestoreDone: true, imageCleanupPending: false, imagePath: path };
        } catch (error) {
            const normalized = normalizedError(error, 'resume-indice-removal');
            if (path) normalized.state = { firestoreDone: true, imageCleanupPending: true, imagePath: path, indiceId: id };
            throw normalized;
        }
    }

    const repository = { subscribeDiscovered, subscribeOne, subscribeLinked };
    if (isMj) Object.assign(repository, { subscribeAll, create, update, remove, resumeRemoval,
        addLinkedPnj: (id, pnjId) => mutateLinks(id, pnjId, true),
        removeLinkedPnj: (id, pnjId) => mutateLinks(id, pnjId, false) });
    return Object.freeze(repository);
}

export function createPublicIndicesRepository(options = {}) { return createRepository({ ...options, role: 'public' }); }
export function createMjIndicesRepository(options = {}) { return createRepository({ ...options, role: 'mj' }); }
export const createPublicIndiceRepository = createPublicIndicesRepository;
export const createMjIndiceRepository = createMjIndicesRepository;

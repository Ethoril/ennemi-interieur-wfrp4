import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { documentRef, requireRepository, serverTimestamp, snapshotData, snapshotMetadata, subscribeSnapshot } from './repository-utils.js';
import { initialCampaign, validateCampaign, validateDossiers, validateLocationData, validateSource } from '../carnaval-model.js';

const clone = value => JSON.parse(JSON.stringify(value));
const exists = snapshot => typeof snapshot?.exists === 'function' ? snapshot.exists() : snapshot?.exists === true;

function error(kind, code, operation, cause = null) {
    const result = new FirebaseClientError(kind, { code, operation, cause });
    return result;
}

function assertValid(value, validator, operation, source = undefined) {
    const checked = validator(value, source);
    if (!checked.valid) throw error(ERROR_KINDS.VALIDATION, 'invalid-carnaval-data', operation, checked.errors);
}

function assertNetworkSnapshot(snapshot, operation) {
    if (snapshot?.metadata?.fromCache === true) throw error(ERROR_KINDS.OFFLINE, 'cache-only', operation);
}

function revisionConflict(latest, operation) {
    const conflict = error(ERROR_KINDS.CONFLICT, 'revision-conflict', operation);
    conflict.latest = clone(latest);
    return conflict;
}

export function createCarnavalRepository({ sdk, client } = {}) {
    const db = requireRepository(sdk, client, 'carnaval-repository');
    if (client?.isGM !== true) throw error(ERROR_KINDS.PERMISSION, 'permission-denied', 'carnaval-repository');
    if (typeof sdk.runTransaction !== 'function' || typeof sdk.onSnapshot !== 'function') {
        throw error(ERROR_KINDS.VALIDATION, 'missing-firestore-api', 'carnaval-repository');
    }
    const sourceRef = documentRef(sdk, db, 'carnaval_sources', 'current');
    const dossiersRef = documentRef(sdk, db, 'carnaval_sources', 'dossiers');
    const hintsRef = documentRef(sdk, db, 'carnaval_sources', 'locations');
    const campaignRef = documentRef(sdk, db, 'carnaval_campaigns', 'current');
    const movementsRef = documentRef(sdk, db, 'carnaval_campaigns', 'locations');
    const subscriptions = new Set();
    let closed = false;

    async function revisionError(cause, ref, expectedRevision, operation) {
        if (cause instanceof FirebaseClientError) return cause;
        const code = String(cause?.code ?? '').replace(/^(?:firestore|firebase)\//u, '');
        if (code === 'permission-denied' || code === 'aborted') {
            // Une écriture concurrente peut échouer sur la règle de révision avant que le SDK ne relance la transaction.
            const latest = await sdk.runTransaction(db, async transaction => {
                const snapshot = await transaction.get(ref);
                return exists(snapshot) ? snapshotData(snapshot) : null;
            }).catch(() => null);
            if (latest && latest.revision !== expectedRevision) return revisionConflict(latest, operation);
        }
        return normalizeFirebaseError(cause, { operation });
    }

    function subscribe(ref, validator, onData, onError, operation) {
        if (closed) throw error(ERROR_KINDS.VALIDATION, 'repository-closed', operation);
        if (typeof onData !== 'function') throw error(ERROR_KINDS.VALIDATION, 'callback-required', operation);
        const unsubscribe = subscribeSnapshot(sdk, ref, snapshot => {
            try {
                assertNetworkSnapshot(snapshot, operation);
                if (snapshot?.metadata?.hasPendingWrites === true) return;
                const data = exists(snapshot) ? snapshotData(snapshot) : null;
                if (data !== null) assertValid(data, validator, operation);
                onData(data, snapshotMetadata(snapshot));
            } catch (cause) { if (typeof onError === 'function') onError(cause); }
        }, cause => { if (typeof onError === 'function') onError(normalizeFirebaseError(cause, { operation })); }, client?.listen);
        subscriptions.add(unsubscribe);
        return () => { subscriptions.delete(unsubscribe); unsubscribe(); };
    }

    return Object.freeze({
        subscribeSource(onData, onError) { return subscribe(sourceRef, validateSource, onData, onError, 'subscribe-carnaval-source'); },
        subscribeDossiers(onData, onError) { return subscribe(dossiersRef, validateDossiers, onData, onError, 'subscribe-carnaval-dossiers'); },
        subscribeLocationHints(onData, onError) { return subscribe(hintsRef, data => validateLocationData(data, { hints: true }), onData, onError, 'subscribe-carnaval-location-hints'); },
        subscribeMovements(onData, onError) { return subscribe(movementsRef, validateLocationData, onData, onError, 'subscribe-carnaval-movements'); },
        subscribeCampaign(onData, onError) { return subscribe(campaignRef, validateCampaign, onData, onError, 'subscribe-carnaval-campaign'); },
        async saveMovements(movements, expectedRevision) {
            const operation = 'save-carnaval-movements';
            if (closed) throw error(ERROR_KINDS.VALIDATION, 'repository-closed', operation);
            const requested = { version: 1, revision: expectedRevision, movements };
            assertValid(requested, validateLocationData, operation);
            try {
                return await sdk.runTransaction(db, async transaction => {
                    const [previous, source] = await Promise.all([transaction.get(movementsRef), transaction.get(sourceRef)]);
                    const current = exists(previous) ? snapshotData(previous) : { revision: 0, movements: [] };
                    if (current.revision !== expectedRevision) throw revisionConflict(current, operation);
                    const characterIds = new Set(snapshotData(source)?.characters?.map(character => character.id) ?? []);
                    if (requested.movements.some(item => !characterIds.has(item.characterId))) {
                        throw error(ERROR_KINDS.VALIDATION, 'unknown-character', operation);
                    }
                    const saved = { ...requested, revision: expectedRevision + 1 };
                    transaction.set(movementsRef, { ...saved, updatedAt: serverTimestamp(sdk) });
                    return saved;
                });
            } catch (cause) {
                throw await revisionError(cause, movementsRef, expectedRevision, operation);
            }
        },
        async saveCampaign(campaign, { expectedRevision } = {}) {
            if (closed) throw error(ERROR_KINDS.VALIDATION, 'repository-closed', 'save-carnaval-campaign');
            if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw error(ERROR_KINDS.VALIDATION, 'revision-required', 'save-carnaval-campaign');
            if (campaign?.revision !== expectedRevision) throw error(ERROR_KINDS.CONFLICT, 'revision-mismatch', 'save-carnaval-campaign');
            assertValid(campaign, validateCampaign, 'save-carnaval-campaign');
            try {
                return await sdk.runTransaction(db, async transaction => {
                    const currentSnapshot = await transaction.get(campaignRef);
                    const sourceSnapshot = await transaction.get(sourceRef);
                    if (!exists(sourceSnapshot)) throw error(ERROR_KINDS.NOT_FOUND, 'source-missing', 'save-carnaval-campaign');
                    assertValid(campaign, validateCampaign, 'save-carnaval-campaign', snapshotData(sourceSnapshot));
                    const latest = exists(currentSnapshot) ? snapshotData(currentSnapshot) : initialCampaign();
                    if (!exists(currentSnapshot) || latest.revision !== expectedRevision) {
                        throw revisionConflict(latest, 'save-carnaval-campaign');
                    }
                    const next = { ...clone(campaign), revision: expectedRevision + 1, updatedAt: serverTimestamp(sdk) };
                    const campaignData = { ...next };
                    delete campaignData.updatedAt;
                    assertValid(campaignData, validateCampaign, 'save-carnaval-campaign');
                    transaction.set(campaignRef, next);
                    return { revision: next.revision, campaign: { ...next, updatedAt: null } };
                });
            } catch (cause) {
                throw await revisionError(cause, campaignRef, expectedRevision, 'save-carnaval-campaign');
            }
        },
        async importSource(source) {
            if (closed) throw error(ERROR_KINDS.VALIDATION, 'repository-closed', 'import-carnaval-source');
            assertValid(source, validateSource, 'import-carnaval-source');
            try {
                return await sdk.runTransaction(db, async transaction => {
                    const existingSource = await transaction.get(sourceRef);
                    const existingCampaign = await transaction.get(campaignRef);
                    if (exists(existingSource) || exists(existingCampaign)) throw error(ERROR_KINDS.CONFLICT, 'source-exists', 'import-carnaval-source');
                    transaction.set(sourceRef, { ...clone(source), updatedAt: serverTimestamp(sdk) });
                    transaction.set(campaignRef, { ...initialCampaign(), updatedAt: serverTimestamp(sdk) });
                    return { imported: true, version: 1 };
                });
            } catch (cause) {
                if (cause?.code === 'source-exists') throw cause;
                throw normalizeFirebaseError(cause, { operation: 'import-carnaval-source' });
            }
        },
        close() {
            if (closed) return;
            closed = true;
            for (const unsubscribe of subscriptions) unsubscribe();
            subscriptions.clear();
        },
    });
}

import { FirebaseClientError, ERROR_KINDS, normalizeFirebaseError } from './firebase-errors.js';
import { documentRef, requireRepository, serverTimestamp, snapshotData, snapshotMetadata, subscribeSnapshot } from './repository-utils.js';
import { initialCampaign, validateCampaign, validateSource } from '../carnaval-model.js';

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

export function createCarnavalRepository({ sdk, client } = {}) {
    const db = requireRepository(sdk, client, 'carnaval-repository');
    if (client?.isGM !== true) throw error(ERROR_KINDS.PERMISSION, 'permission-denied', 'carnaval-repository');
    if (typeof sdk.runTransaction !== 'function' || typeof sdk.onSnapshot !== 'function') {
        throw error(ERROR_KINDS.VALIDATION, 'missing-firestore-api', 'carnaval-repository');
    }
    const sourceRef = documentRef(sdk, db, 'carnaval_sources', 'current');
    const campaignRef = documentRef(sdk, db, 'carnaval_campaigns', 'current');
    const subscriptions = new Set();
    let closed = false;

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
        subscribeCampaign(onData, onError) { return subscribe(campaignRef, validateCampaign, onData, onError, 'subscribe-carnaval-campaign'); },
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
                        const conflict = error(ERROR_KINDS.CONFLICT, 'revision-conflict', 'save-carnaval-campaign');
                        conflict.latest = clone(latest);
                        throw conflict;
                    }
                    const next = { ...clone(campaign), revision: expectedRevision + 1, updatedAt: serverTimestamp(sdk) };
                    const campaignData = { ...next };
                    delete campaignData.updatedAt;
                    assertValid(campaignData, validateCampaign, 'save-carnaval-campaign');
                    transaction.set(campaignRef, next);
                    return { revision: next.revision, campaign: { ...next, updatedAt: null } };
                });
            } catch (cause) {
                if (cause?.code === 'revision-conflict') throw cause;
                const firebaseCode = String(cause?.code ?? '').replace(/^(?:firestore|firebase)\//u, '');
                if (firebaseCode === 'permission-denied' || firebaseCode === 'aborted') {
                    try {
                        const latest = await sdk.runTransaction(db, async transaction => {
                            const snapshot = await transaction.get(campaignRef);
                            return exists(snapshot) ? snapshotData(snapshot) : null;
                        });
                        if (latest && latest.revision !== expectedRevision) {
                            const conflict = error(ERROR_KINDS.CONFLICT, 'revision-conflict', 'save-carnaval-campaign');
                            conflict.latest = clone(latest);
                            throw conflict;
                        }
                    } catch (readError) {
                        if (readError?.code === 'revision-conflict') throw readError;
                    }
                }
                throw normalizeFirebaseError(cause, { operation: 'save-carnaval-campaign' });
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

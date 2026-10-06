import { FICHE_SCHEMA_VERSION, migrateFicheDocument } from './fiche-schema.js';
import { DRAFT_SCHEMA_VERSION } from './fiche-draft-store.js';

const SIMPLE_PATHS = new Set([
    'nom', 'race', 'blessuresAct', 'resilience', 'determination', 'chance', 'destin',
    'corruption', 'possessions', 'optVisible.section-sorts', 'optVisible.section-prieres',
]);
const PRIVATE_COMMANDS = new Set(['gain', 'correct', 'import', 'reset']);

function clone(value) {
    return globalThis.structuredClone(value);
}

function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function pathSegments(path) {
    if (typeof path !== 'string') return [];
    try {
        const segments = path.split('.').map(segment => decodeURIComponent(segment));
        return segments.some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment)) ? [] : segments;
    } catch { return []; }
}

function readPath(data, path) {
    const [root, key, field] = pathSegments(path);
    if (field) {
        if (root === 'chosenVariants') return data?.[root]?.[key]?.[field] ?? null;
        const row = data?.[root]?.find?.(item => item?.id === key);
        return row && Object.hasOwn(row, field) ? row[field] : null;
    }
    if (key) return data?.[root]?.[key] ?? null;
    return data && Object.hasOwn(data, root) ? data[root] : null;
}

function writePath(data, path, value) {
    const [root, key, field] = pathSegments(path);
    if (field) {
        if (root === 'chosenVariants') {
            data[root] = { ...(data[root] || {}), [key]: { ...(data[root]?.[key] || {}), [field]: clone(value) } };
            return;
        }
        const rows = Array.isArray(data[root]) ? data[root] : [];
        const index = rows.findIndex(item => item?.id === key);
        if (index < 0) throw new Error('Ligne introuvable');
        data[root] = rows.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: clone(value) } : item);
    } else if (key) {
        data[root] = { ...(data[root] || {}), [key]: clone(value) };
    } else data[root] = clone(value);
}

function defaultEditablePath(path) {
    if (SIMPLE_PATHS.has(path)) return true;
    const [root, id, field, extra] = pathSegments(path);
    return !extra && /^(?:careers|skillsAdvanced|talentsAcq|talentsAvail|sorts|prieres)$/u.test(root)
        && typeof id === 'string' && id.length > 0 && field === 'note'
        || root === 'basicSpecs' && typeof id === 'string' && id.length > 0 && !field
        || root === 'favoriteSkills' && /^[1-5]$/u.test(id || '') && !field
        || root === 'chosenVariants' && typeof id === 'string' && id.length > 0 && /^[1-5]$/u.test(field || '') && !extra;
}

function validEnvelope(envelope) {
    return envelope?.schemaVersion === FICHE_SCHEMA_VERSION
        && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0
        && envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data);
}

function isUncertainError(error) {
    return ['unavailable', 'deadline-exceeded', 'internal', 'unknown'].includes(String(error?.code || '').split('/').at(-1));
}

export function createFicheController({
    repository,
    draftStore,
    canEditPath = defaultEditablePath,
    migrateDocument = migrateFicheDocument,
    makeOperationId = () => globalThis.crypto.randomUUID(),
    isOnline = () => globalThis.navigator?.onLine !== false,
    onChange = () => {},
    receiptTimeoutMs = 8_000,
} = {}) {
    if (!repository || !draftStore || typeof repository.subscribe !== 'function'
        || typeof repository.execute !== 'function') throw new TypeError('Dépendances du contrôleur fiche invalides');

    let generation = 0;
    let unsubscribe = null;
    let waiters = [];
    let pendingCommand = null;
    let pendingCommandSourcePhase = null;
    let snapshot = null;
    let session = null;
    let draft = null;
    let draftPersistenceUnavailable = false;
    let current = Object.freeze({ phase: 'signed-out', data: null, conflicts: [] });

    function persistDraft() {
        if (!session || !draft) {
            draftPersistenceUnavailable = false;
            return { ok: true };
        }
        const result = draftStore.save(session.uid, session.charId, draft);
        draftPersistenceUnavailable = !result?.ok;
        return result;
    }

    function removeDraft() {
        if (session) draftStore.remove(session.uid, session.charId);
        draftPersistenceUnavailable = false;
    }

    function emit(patch = {}) {
        current = Object.freeze({ ...current, ...patch });
        onChange(current);
        return current;
    }

    function resolveWaiters(revision) {
        const remaining = [];
        for (const waiter of waiters) {
            if (revision >= waiter.revision) {
                clearTimeout(waiter.timer);
                waiter.resolve(true);
            } else remaining.push(waiter);
        }
        waiters = remaining;
    }

    function phaseAfterCommand() {
        if (['ready', 'missing', 'tombstone', 'legacy-readonly'].includes(current.phase)) return current.phase;
        if (['missing', 'tombstone', 'legacy-readonly'].includes(pendingCommandSourcePhase)) return pendingCommandSourcePhase;
        return 'ready';
    }

    function waitForRevision(revision, expectedGeneration) {
        if (generation !== expectedGeneration) return Promise.resolve(false);
        if (current.revision >= revision) return Promise.resolve(true);
        return new Promise(resolve => {
            const waiter = { revision, resolve, timer: null, generation: expectedGeneration };
            waiter.timer = setTimeout(() => {
                waiters = waiters.filter(item => item !== waiter);
                resolve(false);
            }, receiptTimeoutMs);
            waiters.push(waiter);
        });
    }

    function computeConflicts(remoteData) {
        if (!draft) return [];
        return Object.entries(draft.changes).flatMap(([path, values]) => {
            const remote = readPath(remoteData, path);
            if (same(remote, values.base) || same(remote, values.local)) return [];
            return [{ path, base: values.base, local: values.local, server: remote }];
        });
    }

    function refreshData() {
        const data = snapshot?.data ? clone(snapshot.data) : null;
        if (data && draft) {
            for (const [path, values] of Object.entries(draft.changes)) {
                try { writePath(data, path, values.local); } catch { /* obsolete row stays a visible conflict */ }
            }
        }
        const conflicts = snapshot && draft ? computeConflicts(snapshot.data) : [];
        const phase = current.phase;
        emit({
            data: data ? clone(data) : null,
            conflicts,
            hasDraft: !!draft,
            pendingPatchOperationId: draft?.pendingOperation?.operationId || null,
            draftPersistenceUnavailable,
            phase,
        });
    }

    function reconcilePatchReceipt(expectedGeneration) {
        if (generation !== expectedGeneration || !session || !draft?.pendingOperation?.expectedRevision
            || !snapshot || snapshot.revision < draft.pendingOperation.expectedRevision) return false;
        const sentChanges = draft.pendingOperation.changes || {};
        for (const [path, sentValue] of Object.entries(sentChanges)) {
            const currentChange = draft.changes[path];
            if (!currentChange) continue;
            if (same(currentChange.local, sentValue)) delete draft.changes[path];
            // The acknowledged write establishes this field's new base. If a
            // third writer has already advanced it again, computeConflicts must
            // expose B/C/D instead of rebasing C over D silently.
            else currentChange.base = clone(sentValue);
        }
        draft.baseData = clone(snapshot.data);
        draft.baseRevision = snapshot.revision;
        draft.pendingOperation = null;
        if (!Object.keys(draft.changes).length) {
            removeDraft();
            draft = null;
        } else persistDraft();
        refreshData();
        return true;
    }

    function acceptSnapshot(result, expectedGeneration) {
        if (generation !== expectedGeneration || !session) return;
        if (!result?.exists) {
            snapshot = null;
            emit({ phase: 'missing', envelope: null, data: null, revision: null, conflicts: [], hasDraft: false });
            return;
        }
        const envelope = result.envelope;
        if (validEnvelope(envelope) && Number.isSafeInteger(current.revision) && envelope.revision < current.revision) return;
        if (!validEnvelope(envelope)) {
            snapshot = { envelope, data: envelope?.data || null, revision: envelope?.revision ?? null };
            emit({ phase: 'legacy-readonly', envelope, data: clone(snapshot.data), revision: snapshot.revision, conflicts: [] });
            return;
        }
        snapshot = { envelope, data: clone(envelope.data), revision: envelope.revision };
        if (envelope.tombstone === true) {
            emit({ phase: 'tombstone', envelope, revision: envelope.revision, data: {}, conflicts: [] });
            resolveWaiters(envelope.revision);
            return;
        }
        if (!draft) draft = draftStore.load(session.uid, session.charId);
        emit({ phase: 'ready', envelope, revision: envelope.revision });
        refreshData();
        reconcilePatchReceipt(expectedGeneration);
        if (pendingCommand?.expectedRevision && envelope.revision >= pendingCommand.expectedRevision) {
            pendingCommand = null;
            emit({ phase: 'ready', pendingOperationId: null });
        }
        resolveWaiters(envelope.revision);
    }

    function setSession(nextSession) {
        generation += 1;
        unsubscribe?.();
        unsubscribe = null;
        const capturedGeneration = generation;
        pendingCommand = null;
        pendingCommandSourcePhase = null;
        for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.resolve(false);
        }
        waiters = [];
        draft = null;
        draftPersistenceUnavailable = false;
        snapshot = null;
        session = nextSession?.uid && nextSession?.charId
            ? { uid: String(nextSession.uid), charId: String(nextSession.charId), role: nextSession.role === 'mj' ? 'mj' : 'joueur' }
            : null;
        if (!session) {
            emit({ phase: 'signed-out', uid: null, charId: null, role: null, data: null, envelope: null, revision: null, conflicts: [], hasDraft: false, draftPersistenceUnavailable: false });
            return () => {};
        }
        emit({ phase: 'loading', uid: session.uid, charId: session.charId, role: session.role, data: null, envelope: null, revision: null, conflicts: [], hasDraft: false });
        unsubscribe = repository.subscribe(session.charId,
            result => acceptSnapshot(result, capturedGeneration),
            error => {
                if (generation !== capturedGeneration) return;
                emit({ phase: 'error', error: error?.code === 'permission-denied' ? 'permission-denied' : 'read-failed', data: null });
            });
        return () => {
            if (generation === capturedGeneration) {
                generation += 1;
                unsubscribe?.();
                unsubscribe = null;
                draft = null;
                snapshot = null;
                session = null;
                emit({ phase: 'signed-out', uid: null, charId: null, role: null, data: null, envelope: null, revision: null, conflicts: [], hasDraft: false, draftPersistenceUnavailable: false });
            }
        };
    }

    function stagePatch(changes) {
        if (!['ready', 'saving', 'awaiting-snapshot', 'command-pending'].includes(current.phase) || !session || !snapshot || !changes || typeof changes !== 'object' || Array.isArray(changes)) {
            return { ok: false, reason: 'not-editable' };
        }
        const paths = Object.keys(changes);
        if (!paths.length || paths.some(path => !canEditPath(path) || changes[path] === undefined || changes[path] === null)) {
            return { ok: false, reason: 'field-forbidden' };
        }
        const baseData = draft?.baseData || clone(snapshot.data);
        const localData = draft?.localData || clone(snapshot.data);
        const draftChanges = { ...(draft?.changes || {}) };
        for (const path of paths) {
            // A new path starts from the freshest server value, even while other
            // paths remain dirty in this tab. Existing paths keep their original
            // three-way-merge base until the user resolves that field.
            const base = Object.hasOwn(draftChanges, path) ? draftChanges[path].base : (readPath(snapshot.data, path) ?? null);
            writePath(localData, path, changes[path]);
            if (same(base, changes[path])) {
                const inFlightValue = draft?.pendingOperation?.changes?.[path];
                if (inFlightValue !== undefined && !same(inFlightValue, changes[path])) {
                    draftChanges[path] = { base, local: clone(changes[path]) };
                } else delete draftChanges[path];
            }
            else draftChanges[path] = { base, local: clone(changes[path]) };
        }
        draft = Object.keys(draftChanges).length || draft?.pendingOperation ? {
            schemaVersion: DRAFT_SCHEMA_VERSION,
            charId: session.charId,
            baseRevision: draft?.baseRevision ?? snapshot.revision,
            baseData,
            localData,
            changes: draftChanges,
            pendingOperation: draft?.pendingOperation || null,
        } : null;
        const persistence = draft ? persistDraft() : (removeDraft(), { ok: true });
        refreshData();
        return persistence.ok ? { ok: true, hasDraft: !!draft }
            : { ok: true, hasDraft: !!draft, persistence: 'memory-only', persistenceReason: persistence.reason };
    }

    function resolveConflict(path, choice) {
        if (!draft || !snapshot || !['server', 'local'].includes(choice) || !Object.hasOwn(draft.changes, path)) return false;
        const serverValue = readPath(snapshot.data, path);
        if (choice === 'server') {
            writePath(draft.localData, path, serverValue);
            delete draft.changes[path];
        } else {
            draft.changes[path] = { base: serverValue ?? null, local: draft.changes[path].local };
            writePath(draft.localData, path, draft.changes[path].local);
        }
        draft.baseData = clone(snapshot.data);
        draft.baseRevision = snapshot.revision;
        draft.pendingOperation = null;
        if (!Object.keys(draft.changes).length) {
            removeDraft();
            draft = null;
        } else persistDraft();
        refreshData();
        return true;
    }

    function listOtherDraftSessions() {
        if (!session || current.phase !== 'ready' || typeof draftStore.listOtherSessions !== 'function') return [];
        return draftStore.listOtherSessions(session.uid, session.charId);
    }

    function restoreDraftSession(sessionId) {
        if (!session || current.phase !== 'ready' || draft || typeof draftStore.loadSession !== 'function') return false;
        const recovered = draftStore.loadSession(session.uid, session.charId, sessionId);
        if (!recovered) return false;
        draft = recovered;
        persistDraft();
        refreshData();
        return true;
    }

    function saveCorrectionDraft(value) {
        if (!session || session.role !== 'mj' || !['ready', 'saving', 'awaiting-snapshot', 'command-pending'].includes(current.phase)
            || typeof draftStore.saveCorrection !== 'function') return { ok: false, reason: 'not-authorized' };
        return draftStore.saveCorrection(session.uid, session.charId, {
            schemaVersion: DRAFT_SCHEMA_VERSION,
            charId: session.charId,
            baseRevision: snapshot?.revision ?? 0,
            reason: String(value?.reason || '').slice(0, 1000),
            items: Array.isArray(value?.items) ? clone(value.items) : [],
        });
    }

    function listOtherCorrectionDraftSessions() {
        if (!session || session.role !== 'mj' || current.phase !== 'ready'
            || typeof draftStore.listOtherCorrectionSessions !== 'function') return [];
        return draftStore.listOtherCorrectionSessions(session.uid, session.charId);
    }

    function loadCorrectionDraftSession(sessionId) {
        if (!session || session.role !== 'mj' || current.phase !== 'ready'
            || typeof draftStore.loadCorrectionSession !== 'function') return null;
        return draftStore.loadCorrectionSession(session.uid, session.charId, sessionId);
    }

    function removeCorrectionDraft() {
        if (!session || session.role !== 'mj' || typeof draftStore.removeCorrection !== 'function') return false;
        return draftStore.removeCorrection(session.uid, session.charId);
    }

    function removeCorrectionDraftSession(sessionId) {
        if (!session || session.role !== 'mj' || typeof draftStore.removeCorrectionSession !== 'function') return false;
        return draftStore.removeCorrectionSession(session.uid, session.charId, sessionId);
    }

    async function submitPatch() {
        if (!draft || !Object.keys(draft.changes).length) return { status: 'empty' };
        if (draft.pendingOperation) return { status: 'retry-required', operationId: draft.pendingOperation.operationId };
        if (current.phase === 'command-pending') return { status: 'blocked', reason: 'command-pending' };
        if (!['ready', 'saving', 'awaiting-snapshot'].includes(current.phase) || current.conflicts.length) return { status: 'blocked', reason: current.conflicts.length ? 'conflict' : current.phase };
        if (!isOnline()) return { status: 'blocked', reason: 'offline' };
        const expectedGeneration = generation;
        const changes = Object.fromEntries(Object.entries(draft.changes).map(([path, values]) => [path, values.local]));
        const baseValues = Object.fromEntries(Object.entries(draft.changes).map(([path, values]) => [path, values.base]));
        const command = {
            charId: session.charId,
            operationId: draft.pendingOperation?.operationId || makeOperationId(),
            baseRevision: draft.baseRevision,
            type: 'patch',
            payload: { changes, baseValues },
        };
        draft.pendingOperation = { operationId: command.operationId, changes: clone(changes), command: clone(command) };
        persistDraft();
        emit({ phase: 'saving' });
        try {
            const receipt = await repository.execute(command);
            if (generation !== expectedGeneration) return { status: 'stale' };
            draft.pendingOperation.expectedRevision = receipt.revision;
            persistDraft();
            if (await waitForRevision(receipt.revision, expectedGeneration)) {
                reconcilePatchReceipt(expectedGeneration);
                return { status: 'saved', receipt };
            }
            if (generation !== expectedGeneration) return { status: 'stale' };
            emit({ phase: 'awaiting-snapshot' });
            return { status: 'awaiting-snapshot', receipt };
        } catch (error) {
            if (generation !== expectedGeneration) return { status: 'stale' };
            if (!isUncertainError(error) && draft?.pendingOperation?.operationId === command.operationId) {
                draft.pendingOperation = null;
                if (!Object.keys(draft.changes).length) {
                    removeDraft();
                    draft = null;
                } else persistDraft();
            }
            emit({ phase: 'ready', error: error?.details?.kind || error?.code || 'save-failed' });
            throw error;
        }
    }

    async function retryPendingPatch() {
        const command = draft?.pendingOperation?.command;
        if (!command || !isOnline()) throw new Error('Aucun patch réessayable ou connexion absente');
        const expectedGeneration = generation;
        emit({ phase: 'saving' });
        try {
            const receipt = await repository.execute(command);
            if (generation !== expectedGeneration) return { status: 'stale' };
            if (draft?.pendingOperation?.operationId === command.operationId) {
                draft.pendingOperation.expectedRevision = receipt.revision;
                persistDraft();
            }
            if (await waitForRevision(receipt.revision, expectedGeneration)) {
                reconcilePatchReceipt(expectedGeneration);
                return { status: 'saved', receipt };
            }
            if (generation !== expectedGeneration) return { status: 'stale' };
            emit({ phase: 'awaiting-snapshot' });
            return { status: 'awaiting-snapshot', receipt };
        } catch (error) {
            if (generation !== expectedGeneration) return { status: 'stale' };
            if (!isUncertainError(error) && draft?.pendingOperation?.operationId === command.operationId) {
                draft.pendingOperation = null;
                if (!Object.keys(draft.changes).length) draft = null;
                if (draft) persistDraft();
                else removeDraft();
            }
            emit({ phase: 'ready', error: error?.details?.kind || error?.code || 'save-failed' });
            throw error;
        }
    }

    async function executeOnlineCommand(type, payload) {
        const initialImport = type === 'import' && session?.role === 'mj' && current.phase === 'missing';
        const tombstoneImport = type === 'import' && session?.role === 'mj' && current.phase === 'tombstone';
        if ((current.phase !== 'ready' && !initialImport && !tombstoneImport) || !session || (!snapshot && !initialImport)) {
            throw new Error('Fiche non modifiable');
        }
        if (!isOnline()) throw new Error('Une connexion est requise pour cette commande');
        if (pendingCommand) return { status: 'retry-required', operationId: pendingCommand.operationId };
        if (PRIVATE_COMMANDS.has(type) && session.role !== 'mj') throw new Error('Commande réservée au MJ');
        pendingCommand = {
            charId: session.charId,
            operationId: makeOperationId(),
            baseRevision: snapshot?.revision ?? 0,
            type,
            payload: clone(payload),
        };
        pendingCommandSourcePhase = current.phase;
        return retryPendingCommand();
    }

    async function retryPendingCommand() {
        if (!pendingCommand || !isOnline()) throw new Error('Aucune commande réessayable ou connexion absente');
        const expectedGeneration = generation;
        const command = pendingCommand;
        emit({ phase: 'command-pending', pendingOperationId: command.operationId });
        try {
            const receipt = await repository.execute(command);
            if (generation !== expectedGeneration) return { status: 'stale' };
            command.expectedRevision = receipt.revision;
            if (await waitForRevision(receipt.revision, expectedGeneration)) {
                if (generation !== expectedGeneration) return { status: 'stale' };
                if (pendingCommand?.operationId === command.operationId) pendingCommand = null;
                emit({ phase: phaseAfterCommand(), pendingOperationId: null });
                pendingCommandSourcePhase = null;
                return { status: 'confirmed', receipt };
            }
            if (generation !== expectedGeneration) return { status: 'stale' };
            emit({ phase: 'awaiting-snapshot', pendingOperationId: command.operationId });
            return { status: 'awaiting-snapshot', receipt };
        } catch (error) {
            if (generation !== expectedGeneration) return { status: 'stale' };
            if (!isUncertainError(error) && pendingCommand?.operationId === command.operationId) pendingCommand = null;
            emit({ phase: phaseAfterCommand(), pendingOperationId: pendingCommand?.operationId || null, error: error?.code || 'command-failed' });
            if (!pendingCommand) pendingCommandSourcePhase = null;
            throw error;
        }
    }

    async function migrateLegacy(confirmCharId) {
        if (session?.role !== 'mj' || current.phase !== 'legacy-readonly' || !current.envelope) throw new Error('Migration indisponible');
        if (confirmCharId !== session.charId) throw new Error('Confirmation du personnage invalide');
        const preflight = await migrateDocument(current.envelope, { charId: session.charId });
        if (!preflight.canApply) return { status: 'blocked', report: preflight.report };
        if (!isOnline() || typeof repository.migrate !== 'function') throw new Error('Connexion ou callable de migration indisponible');
        return repository.migrate({ charId: session.charId, confirmCharId, expectedSourceFingerprint: preflight.report.sourceFingerprint });
    }

    return Object.freeze({
        getState: () => current,
        getDraftPaths: () => Object.keys(draft?.changes || {}),
        setSession,
        stagePatch,
        resolveConflict,
        listOtherDraftSessions,
        restoreDraftSession,
        saveCorrectionDraft,
        listOtherCorrectionDraftSessions,
        loadCorrectionDraftSession,
        removeCorrectionDraft,
        removeCorrectionDraftSession,
        submitPatch,
        retryPendingPatch,
        executeOnlineCommand,
        retryPendingCommand,
        migrateLegacy,
        close() {
            generation += 1;
            unsubscribe?.();
            unsubscribe = null;
            pendingCommand = null;
            pendingCommandSourcePhase = null;
            draft = null;
            draftPersistenceUnavailable = false;
            snapshot = null;
            session = null;
            for (const waiter of waiters) {
                clearTimeout(waiter.timer);
                waiter.resolve(false);
            }
            waiters = [];
            emit({ phase: 'signed-out', uid: null, charId: null, role: null, data: null, envelope: null, revision: null, conflicts: [], hasDraft: false, draftPersistenceUnavailable: false });
        },
    });
}

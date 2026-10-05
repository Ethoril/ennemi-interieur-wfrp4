const DRAFT_SCHEMA_VERSION = 2;
const CHAR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_CORRECTION_BYTES = 128 * 1024;
const MAX_SCOPE_BYTES = 2 * 1024 * 1024;
const MAX_SCOPE_RECORDS = 100;

function validIdentity(uid, charId) {
    return typeof uid === 'string' && uid.trim().length > 0
        && typeof charId === 'string' && CHAR_ID_PATTERN.test(charId);
}

function clone(value) {
    return globalThis.structuredClone(value);
}

export function createFicheDraftStore({ storage = globalThis.localStorage, now = () => Date.now(), makeSessionId = () => globalThis.crypto.randomUUID() } = {}) {
    // Unique per module instance, not only per sessionStorage: browsers clone
    // sessionStorage when a tab is duplicated or opened from another tab.
    const activeSessionId = makeSessionId();

    const keyPrefix = (uid, charId) => {
        if (!validIdentity(uid, charId)) throw new TypeError('Identité de brouillon invalide');
        return `wfrp4:fiche-draft:v${DRAFT_SCHEMA_VERSION}:${encodeURIComponent(uid)}:${charId}:`;
    };
    const keyFor = (uid, charId, sessionId = activeSessionId, kind = 'patch') => `${keyPrefix(uid, charId)}${kind === 'correction' ? 'correction:' : ''}${sessionId}`;

    function utf8Bytes(value) {
        return new globalThis.TextEncoder().encode(value).byteLength;
    }

    function checkCapacity(uid, charId, ownKey, raw, maxBytes) {
        const bytes = utf8Bytes(raw);
        if (bytes > maxBytes) return { ok: false, reason: 'draft-too-large' };
        try {
            const prefix = keyPrefix(uid, charId);
            let totalBytes = bytes;
            let records = 1;
            for (let index = 0; index < (storage?.length || 0); index += 1) {
                const key = storage.key(index);
                if (!key?.startsWith(prefix) || key === ownKey) continue;
                const value = storage.getItem(key);
                if (value == null) continue;
                totalBytes += utf8Bytes(value);
                records += 1;
            }
            if (totalBytes > MAX_SCOPE_BYTES) return { ok: false, reason: 'scope-too-large' };
            if (records > MAX_SCOPE_RECORDS) return { ok: false, reason: 'too-many-drafts' };
            return { ok: true };
        } catch {
            return { ok: false, reason: 'storage-unavailable' };
        }
    }

    function decode(raw, charId) {
        const draft = JSON.parse(raw);
        if (draft?.schemaVersion !== DRAFT_SCHEMA_VERSION || draft.charId !== charId
            || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0
            || !draft.baseData || typeof draft.baseData !== 'object'
            || !draft.localData || typeof draft.localData !== 'object'
            || !draft.changes || typeof draft.changes !== 'object' || Array.isArray(draft.changes)
            || Object.keys(draft.changes).length > 200) return null;
        return clone(draft);
    }

    function loadFromKey(uid, charId, sessionId) {
        try {
            const raw = storage?.getItem(keyFor(uid, charId, sessionId));
            return raw && utf8Bytes(raw) <= MAX_DRAFT_BYTES ? decode(raw, charId) : null;
        } catch {
            return null;
        }
    }

    function decodeCorrection(raw, charId) {
        const draft = JSON.parse(raw);
        if (draft?.schemaVersion !== DRAFT_SCHEMA_VERSION || draft.charId !== charId
            || !Array.isArray(draft.items) || draft.items.length > 50
            || typeof draft.reason !== 'string' || draft.reason.length > 1000) return null;
        return clone(draft);
    }

    function loadCorrectionFromKey(uid, charId, sessionId) {
        try {
            const raw = storage?.getItem(keyFor(uid, charId, sessionId, 'correction'));
            if (!raw || utf8Bytes(raw) > MAX_CORRECTION_BYTES) return null;
            const draft = decodeCorrection(raw, charId);
            return draft ? { ...draft, sessionId } : null;
        } catch { return null; }
    }

    return Object.freeze({
        load(uid, charId) {
            return loadFromKey(uid, charId, activeSessionId);
        },
        loadSession(uid, charId, sessionId) {
            if (typeof sessionId !== 'string' || !sessionId || sessionId === activeSessionId) return null;
            return loadFromKey(uid, charId, sessionId);
        },
        listOtherSessions(uid, charId) {
            try {
                const prefix = keyPrefix(uid, charId);
                const active = activeSessionId;
                const sessions = [];
                for (let index = 0; index < (storage?.length || 0); index += 1) {
                    const key = storage.key(index);
                    if (!key?.startsWith(prefix)) continue;
                    const sessionId = key.slice(prefix.length);
                    if (!sessionId || sessionId === active) continue;
                    const draft = loadFromKey(uid, charId, sessionId);
                    if (draft) sessions.push({ sessionId, savedAt: draft.savedAt || 0, changeCount: Object.keys(draft.changes).length });
                }
                return sessions.sort((left, right) => right.savedAt - left.savedAt);
            } catch {
                return [];
            }
        },
        save(uid, charId, draft) {
            try {
                if (!validIdentity(uid, charId) || draft?.schemaVersion !== DRAFT_SCHEMA_VERSION
                    || draft.charId !== charId || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 0
                    || !draft.changes || typeof draft.changes !== 'object' || Array.isArray(draft.changes)) {
                    return { ok: false, reason: 'invalid' };
                }
                if (Object.keys(draft.changes).length > 200) return { ok: false, reason: 'too-many-changes' };
                if (!storage?.setItem) return { ok: false, reason: 'storage-unavailable' };
                const key = keyFor(uid, charId);
                const raw = JSON.stringify({ ...clone(draft), sessionId: activeSessionId, savedAt: now() });
                const capacity = checkCapacity(uid, charId, key, raw, MAX_DRAFT_BYTES);
                if (!capacity.ok) return capacity;
                storage.setItem(key, raw);
                return { ok: true };
            } catch (error) {
                return { ok: false, reason: error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'storage-unavailable' };
            }
        },
        saveCorrection(uid, charId, draft) {
            try {
                if (!validIdentity(uid, charId) || draft?.schemaVersion !== DRAFT_SCHEMA_VERSION
                    || draft.charId !== charId || !Array.isArray(draft.items) || draft.items.length > 50
                    || typeof draft.reason !== 'string' || draft.reason.length > 1000) return { ok: false, reason: 'invalid' };
                if (!storage?.setItem) return { ok: false, reason: 'storage-unavailable' };
                const key = keyFor(uid, charId, activeSessionId, 'correction');
                const raw = JSON.stringify({ ...clone(draft), sessionId: activeSessionId, savedAt: now() });
                const capacity = checkCapacity(uid, charId, key, raw, MAX_CORRECTION_BYTES);
                if (!capacity.ok) return capacity;
                storage.setItem(key, raw);
                return { ok: true };
            } catch (error) {
                return { ok: false, reason: error?.name === 'QuotaExceededError' ? 'quota-exceeded' : 'storage-unavailable' };
            }
        },
        loadCorrection(uid, charId) {
            return loadCorrectionFromKey(uid, charId, activeSessionId);
        },
        loadCorrectionSession(uid, charId, sessionId) {
            if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId) || sessionId === activeSessionId) return null;
            return loadCorrectionFromKey(uid, charId, sessionId);
        },
        listOtherCorrectionSessions(uid, charId) {
            try {
                const prefix = `${keyPrefix(uid, charId)}correction:`;
                const sessions = [];
                for (let index = 0; index < (storage?.length || 0); index += 1) {
                    const key = storage.key(index);
                    if (!key?.startsWith(prefix)) continue;
                    const sessionId = key.slice(prefix.length);
                    if (!SESSION_ID_PATTERN.test(sessionId) || sessionId === activeSessionId) continue;
                    const draft = loadCorrectionFromKey(uid, charId, sessionId);
                    if (draft) sessions.push({ sessionId, savedAt: draft.savedAt || 0, changeCount: draft.items.length });
                }
                return sessions.sort((left, right) => right.savedAt - left.savedAt);
            } catch { return []; }
        },
        removeCorrection(uid, charId) {
            try {
                storage?.removeItem(keyFor(uid, charId, activeSessionId, 'correction'));
                return true;
            } catch { return false; }
        },
        removeCorrectionSession(uid, charId, sessionId) {
            try {
                if (!validIdentity(uid, charId) || typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) return false;
                storage?.removeItem(keyFor(uid, charId, sessionId, 'correction'));
                return true;
            } catch { return false; }
        },
        remove(uid, charId) {
            try {
                storage?.removeItem(keyFor(uid, charId));
                return true;
            } catch {
                return false;
            }
        },
    });
}

export { DRAFT_SCHEMA_VERSION };

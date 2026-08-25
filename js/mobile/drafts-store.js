const DRAFT_VERSION = 1;
const KEY_PREFIX = 'wfrp4-mobile-public-draft:v1:';
const MAX_DRAFTS = 12;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_FIELDS = Object.freeze(['nom', 'statut', 'vivant', 'lieu', 'groupe', 'description', 'visibleJoueurs']);

function safeStorage(storage) {
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
        && typeof storage.removeItem === 'function') return storage;
    return null;
}

function nowValue(now) {
    const value = typeof now === 'function' ? now() : now;
    return Number.isFinite(value) ? value : Date.now();
}

function safeDefaultStorage() {
    try { return globalThis.localStorage; } catch { return null; }
}

function localId(value) {
    return typeof value === 'string' && /^draft:[A-Za-z0-9_-]{8,100}$/u.test(value) ? value : null;
}

function keyFor(id) { return `${KEY_PREFIX}${id || 'new'}`; }

function sanitizeValues(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const values = {};
    for (const field of PUBLIC_FIELDS) {
        if (!Object.hasOwn(input, field)) continue;
        if (field === 'visibleJoueurs') {
            if (typeof input[field] !== 'boolean') return null;
        } else if (typeof input[field] !== 'string' || input[field].length > (field === 'description' ? 20000 : 300)) return null;
        if (field === 'statut' && !['', 'allié', 'ennemi', 'neutre'].includes(input[field])) return null;
        if (field === 'vivant' && !['oui', 'non', 'inconnu'].includes(input[field])) return null;
        values[field] = input[field];
    }
    return values;
}

function safeDraft(raw, timestamp) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== DRAFT_VERSION
        || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)
        || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)
        || raw.createdAt > raw.updatedAt || raw.createdAt > timestamp + 60_000 || timestamp - raw.createdAt > MAX_AGE_MS
        || timestamp - raw.updatedAt > MAX_AGE_MS || raw.updatedAt > timestamp + 60_000
        || !localId(raw.draftId) || (raw.pnjId !== null && (typeof raw.pnjId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(raw.pnjId)))) return null;
    const values = sanitizeValues(raw.values);
    if (!values || Object.keys(values).length === 0) return null;
    return Object.freeze({ version: DRAFT_VERSION, draftId: raw.draftId, pnjId: raw.pnjId ?? null, createdAt: raw.createdAt, updatedAt: raw.updatedAt, values: Object.freeze(values) });
}

function readKeys(storage) {
    const keys = [];
    try {
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) keys.push(key);
        }
    } catch { return []; }
    return keys;
}

export function createPublicDraftStore({ storage = safeDefaultStorage(), now = Date.now } = {}) {
    const backend = safeStorage(storage);
    const timestamp = () => nowValue(now);
    const list = () => {
        if (!backend) return [];
        const current = timestamp(); const drafts = [];
        for (const key of readKeys(backend)) {
            try {
                const draft = safeDraft(JSON.parse(backend.getItem(key)), current);
                if (draft && keyFor(draft.draftId) !== key) { backend.removeItem(key); continue; }
                if (draft) drafts.push(draft);
                else backend.removeItem(key);
            } catch { try { backend.removeItem(key); } catch { /* stockage hostile : ignorer cette entrée */ } }
        }
        return drafts.sort((left, right) => right.updatedAt - left.updatedAt);
    };
    const remove = draftOrId => {
        if (!backend) return false;
        const id = typeof draftOrId === 'string' ? draftOrId : draftOrId?.draftId;
        if (!localId(id)) return false;
        try { backend.removeItem(keyFor(id)); return true; } catch { return false; }
    };
    const save = (values, { pnjId = null, draftId = null } = {}) => {
        if (!backend) return Object.freeze({ ok: false, reason: 'unavailable' });
        const clean = sanitizeValues(values);
        if (!clean || Object.keys(clean).length === 0) return Object.freeze({ ok: false, reason: 'invalid' });
        if (pnjId !== null && (typeof pnjId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(pnjId))) return Object.freeze({ ok: false, reason: 'invalid' });
        const id = localId(draftId) || `draft:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        const current = timestamp(); const previous = list().find(item => item.draftId === id);
        const draft = { version: DRAFT_VERSION, draftId: id, pnjId: pnjId === null ? null : pnjId, createdAt: previous?.createdAt || current, updatedAt: current, values: clean };
        try {
            backend.setItem(keyFor(id), JSON.stringify(draft));
            for (const extra of list().slice(MAX_DRAFTS)) remove(extra);
            const safe = safeDraft(draft, current);
            return safe ? Object.freeze({ ok: true, draft: safe }) : Object.freeze({ ok: false, reason: 'invalid' });
        } catch { return Object.freeze({ ok: false, reason: 'quota' }); }
    };
    const find = pnjId => list().find(item => (pnjId === null ? item.pnjId === null : item.pnjId === pnjId)) || null;
    const clear = () => { let count = 0; for (const draft of list()) if (remove(draft)) count += 1; return count; };
    return Object.freeze({ version: DRAFT_VERSION, maxDrafts: MAX_DRAFTS, maxAgeMs: MAX_AGE_MS, list, find, save, remove, clear, sanitizeValues });
}

export { DRAFT_VERSION, KEY_PREFIX, MAX_DRAFTS, MAX_AGE_MS, PUBLIC_FIELDS };

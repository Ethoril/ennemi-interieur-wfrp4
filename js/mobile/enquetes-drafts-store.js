const VERSION = 1;
const KEY_PREFIX = 'wfrp4-mobile-enquete-draft:v1:';
const MAX_DRAFTS = 12;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 100_000;
const FIELDS = Object.freeze(['titre', 'description', 'decouvert', 'ordre', 'pnjsLies']);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,150}$/u;

function backendOf(storage) {
    return storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
        && typeof storage.removeItem === 'function' && typeof storage.key === 'function' ? storage : null;
}

function safeDefaultStorage() {
    try { return globalThis.localStorage; } catch { return null; }
}

function cleanValues(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const values = {};
    if (Object.hasOwn(input, 'titre')) {
        if (typeof input.titre !== 'string' || input.titre.length > 200) return null;
        values.titre = input.titre;
    }
    if (Object.hasOwn(input, 'description')) {
        if (typeof input.description !== 'string' || input.description.length > 30000) return null;
        values.description = input.description;
    }
    if (Object.hasOwn(input, 'decouvert')) {
        if (typeof input.decouvert !== 'boolean') return null;
        values.decouvert = input.decouvert;
    }
    if (Object.hasOwn(input, 'ordre')) {
        if (input.ordre !== null && (typeof input.ordre !== 'number' || !Number.isFinite(input.ordre))) return null;
        values.ordre = input.ordre;
    }
    if (Object.hasOwn(input, 'pnjsLies')) {
        if (!Array.isArray(input.pnjsLies) || input.pnjsLies.length > 100 || input.pnjsLies.some(id => typeof id !== 'string' || !ID_PATTERN.test(id))) return null;
        values.pnjsLies = [...new Set(input.pnjsLies)];
    }
    return Object.keys(values).length ? values : null;
}

function safeId(value) { return typeof value === 'string' && /^draft:[A-Za-z0-9_-]{8,100}$/u.test(value); }
function keyFor(id) { return `${KEY_PREFIX}${id || 'new'}`; }

function timestampOf(now) {
    try {
        const value = typeof now === 'function' ? now() : now;
        return Number.isFinite(value) ? value : Date.now();
    } catch { return Date.now(); }
}

function readKeys(backend) {
    const keys = [];
    try {
        for (let index = 0; index < backend.length; index += 1) {
            const key = backend.key(index);
            if (typeof key === 'string' && key.startsWith(KEY_PREFIX)) keys.push(key);
        }
    } catch { return []; }
    return keys;
}

function safeDraft(raw, current, key) {
    const validDates = Number.isFinite(raw?.createdAt) && Number.isFinite(raw?.updatedAt)
        && raw.createdAt >= 0 && raw.updatedAt >= 0 && raw.createdAt <= raw.updatedAt
        && raw.createdAt <= current + 60_000 && raw.updatedAt <= current + 60_000
        && current - raw.createdAt <= MAX_AGE && current - raw.updatedAt <= MAX_AGE;
    const valid = raw?.version === VERSION && safeId(raw?.draftId)
        && keyFor(raw.draftId) === key
        && (raw?.indiceId === null || raw?.indiceId === undefined || ID_PATTERN.test(raw.indiceId))
        && validDates;
    const values = cleanValues(raw?.values);
    if (!valid || !values) return null;
    return Object.freeze({ version: VERSION, draftId: raw.draftId, indiceId: raw.indiceId ?? null, createdAt: raw.createdAt, updatedAt: raw.updatedAt, values: Object.freeze(values) });
}

export function createEnquetesDraftStore({ storage = safeDefaultStorage(), now = Date.now } = {}) {
    const backend = backendOf(storage);
    const clock = () => timestampOf(now);
    const list = () => {
        if (!backend) return [];
        const current = clock();
        const output = [];
        for (const key of readKeys(backend)) {
            try {
                let raw;
                try { raw = JSON.parse(backend.getItem(key)); } catch { raw = null; }
                const draft = safeDraft(raw, current, key);
                if (!draft) { backend.removeItem(key); continue; }
                output.push(draft);
            } catch { try { backend.removeItem(key); } catch { /* stockage hostile : continuer fail-closed */ } }
        }
        return output.sort((left, right) => right.updatedAt - left.updatedAt);
    };
    const save = (values, { indiceId = null, draftId = null } = {}) => {
        if (!backend) return Object.freeze({ ok: false, reason: 'unavailable' });
        const clean = cleanValues(values);
        if (!clean || (indiceId !== null && !ID_PATTERN.test(indiceId))) return Object.freeze({ ok: false, reason: 'invalid' });
        const id = safeId(draftId) ? draftId : `draft:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        const current = clock();
        const previous = list().find(item => item.draftId === id);
        const draft = { version: VERSION, draftId: id, indiceId, createdAt: previous?.createdAt ?? current, updatedAt: current, values: clean };
        const serialized = JSON.stringify(draft);
        if (serialized.length > MAX_BYTES) return Object.freeze({ ok: false, reason: 'too-large' });
        try {
            backend.setItem(keyFor(id), serialized);
            for (const extra of list().slice(MAX_DRAFTS)) remove(extra.draftId);
            const stored = safeDraft(draft, current, keyFor(id));
            if (!stored) return Object.freeze({ ok: false, reason: 'invalid' });
            return Object.freeze({ ok: true, draft: stored });
        } catch { return Object.freeze({ ok: false, reason: 'quota' }); }
    };
    const find = indiceId => list().find(item => (indiceId === null ? item.indiceId === null : item.indiceId === indiceId)) || null;
    const remove = draftId => { if (!backend || !safeId(draftId)) return false; try { backend.removeItem(keyFor(draftId)); return true; } catch { return false; } };
    const clear = () => { let count = 0; for (const draft of list()) if (remove(draft.draftId)) count += 1; return count; };
    const removeForIndice = indiceId => {
        if (typeof indiceId !== 'string' || !ID_PATTERN.test(indiceId)) return 0;
        let count = 0;
        for (const draft of list().filter(item => item.indiceId === indiceId)) if (remove(draft.draftId)) count += 1;
        return count;
    };
    return Object.freeze({ version: VERSION, fields: FIELDS, list, save, find, remove, removeForIndice, clear, sanitizeValues: cleanValues });
}

export { FIELDS, KEY_PREFIX, VERSION, MAX_DRAFTS, MAX_AGE, MAX_BYTES };

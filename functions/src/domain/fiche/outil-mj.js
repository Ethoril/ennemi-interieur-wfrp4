// Commande `outil-mj` : écriture en retour, par l'outil MJ, des valeurs durables d'un PJ sur sa fiche.
// Contrat figé (chantier H, plan.md §1). Logique pure, partagée avec la Cloud Function par
// tools/sync-fiche-domain.mjs. Tout ce qui n'est pas dans la liste fermée ci-dessous est refusé :
// aucune donnée réservée au MJ ne peut atteindre la fiche, que le joueur lit en entier.
import { counterError } from './v5.js';

export const OUTIL_MJ_CARACS = Object.freeze(['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc']);
export const OUTIL_MJ_COUNTERS = Object.freeze(['fortune', 'destin', 'peche', 'corruption']);
export const SUIVI_CATEGORIES = Object.freeze(['penitence', 'sequelle', 'cicatrice', 'maladie', 'mutation']);
export const MAX_SUIVI_ENTRIES = 200;
const MAX_CHANGES = 40;
const SEND_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_ROW_ID = 200;
const CHANGE_KEYS = Object.freeze({
    counter: ['op', 'field', 'base', 'value', 'label'],
    carac: ['op', 'carac', 'base', 'value', 'label'],
    'skill-adv': ['op', 'id', 'base', 'value', 'label'],
    suivi: ['op', 'id', 'base', 'value', 'label'],
});
const SUIVI_KEYS = ['id', 'categorie', 'libelle', 'detail', 'depuis'];

export class OutilMjError extends Error {
    constructor(message, code = 'invalid-argument', details = undefined) {
        super(message);
        this.name = 'FicheCommandError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(message, code = 'invalid-argument', details) {
    throw new OutilMjError(message, code, details);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}

function same(left, right) {
    return stableStringify(left) === stableStringify(right);
}

function hasOnlyKeys(record, allowed, required = allowed) {
    return Object.keys(record).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(record, key));
}

function isText(value, max, min = 0) {
    return typeof value === 'string' && value.length >= min && value.length <= max;
}

function isRowId(value) {
    return isText(value, MAX_ROW_ID, 1) && value.trim() === value && !/[\u0000-\u001f]/u.test(value);
}

function isCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
}

/** Erreur de forme d'une entrée « Suivi du MJ », ou null. */
export function suiviEntryError(entry) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, SUIVI_KEYS, ['id', 'categorie', 'libelle', 'detail'])) return 'entrée de suivi invalide';
    if (!isRowId(entry.id)) return 'identifiant de suivi invalide';
    if (!SUIVI_CATEGORIES.includes(entry.categorie)) return 'catégorie de suivi invalide';
    if (!isText(entry.libelle, 200, 1) || !isText(entry.detail, 1_000)) return 'texte de suivi invalide';
    if (Object.hasOwn(entry, 'depuis') && !isText(entry.depuis, 40)) return 'date de suivi invalide';
    return null;
}

/** Erreur de forme de la liste `suiviMj` (import JSON), ou null. */
export function suiviListError(value) {
    if (!Array.isArray(value) || value.length > MAX_SUIVI_ENTRIES) return 'liste de suivi invalide';
    const ids = new Set();
    for (const entry of value) {
        const error = suiviEntryError(entry);
        if (error) return error;
        if (ids.has(entry.id)) return 'identifiant de suivi en double';
        ids.add(entry.id);
    }
    return null;
}

/** Clé du change dans le conflit et l'historique : counter:destin, carac:ag, skill-adv:<id>, suivi:<id>. */
export function outilMjChangeKey(change) {
    if (change.op === 'counter') return `counter:${change.field}`;
    if (change.op === 'carac') return `carac:${change.carac}`;
    return `${change.op}:${change.id}`;
}

function validateChange(change) {
    if (!isRecord(change) || !Object.hasOwn(CHANGE_KEYS, change.op)) fail('change non pris en charge');
    if (!hasOnlyKeys(change, CHANGE_KEYS[change.op])) fail('clés de change invalides', 'invalid-argument', { kind: 'field-forbidden' });
    if (!isText(change.label, 200, 1)) fail('provenance du change invalide');
    if (change.op === 'counter') {
        if (!OUTIL_MJ_COUNTERS.includes(change.field)) fail('compteur non autorisé', 'invalid-argument', { kind: 'field-forbidden' });
        if (counterError(change.value) || (change.base !== null && counterError(change.base))) fail('valeur de compteur invalide');
    } else if (change.op === 'carac') {
        if (!OUTIL_MJ_CARACS.includes(change.carac)) fail('caractéristique non autorisée', 'invalid-argument', { kind: 'field-forbidden' });
        if (!isCount(change.base) || !isCount(change.value) || change.value > 999) fail('Base de caractéristique invalide');
    } else if (change.op === 'skill-adv') {
        if (!isRowId(change.id)) fail('identifiant de compétence invalide');
        if (!isCount(change.base) || !isCount(change.value) || change.value > 999) fail('Avances de compétence invalides');
    } else {
        if (!isRowId(change.id)) fail('identifiant de suivi invalide');
        if (change.base === null && change.value === null) fail('change de suivi vide');
        for (const entry of [change.base, change.value]) {
            if (entry === null) continue;
            const error = suiviEntryError(entry);
            if (error) fail(error);
            if (entry.id !== change.id) fail('identifiant de suivi incohérent');
        }
    }
}

/** Valide la forme complète d'une commande `outil-mj` (clés fermées, CA23). */
export function validateOutilMjCommand(command) {
    const payload = command?.payload;
    if (!isRecord(payload) || !hasOnlyKeys(payload, ['reason', 'sendId', 'undoOf', 'changes'], ['reason', 'sendId', 'changes'])) {
        fail('contenu de commande outil MJ invalide');
    }
    if (!isText(payload.reason, 1_000) || payload.reason.trim().length < 3) fail('motif obligatoire');
    if (typeof payload.sendId !== 'string' || !SEND_ID_PATTERN.test(payload.sendId)) fail('identifiant d’envoi invalide');
    // Identifiant déterministe : un renvoi est rejoué, jamais réappliqué (CA6).
    if (command.operationId !== `outilmj-${payload.sendId}-${command.charId}`) fail('identifiant d’opération outil MJ invalide');
    if (Object.hasOwn(payload, 'undoOf') && (typeof payload.undoOf !== 'string' || !OPERATION_ID_PATTERN.test(payload.undoOf)
        || payload.undoOf === command.operationId)) fail('opération annulée invalide');
    if (!Array.isArray(payload.changes) || !payload.changes.length || payload.changes.length > MAX_CHANGES) fail('liste de changes invalide');
    const keys = new Set();
    for (const change of payload.changes) {
        validateChange(change);
        const key = outilMjChangeKey(change);
        if (keys.has(key)) fail('change en double');
        keys.add(key);
    }
    return payload;
}

/** Valeur actuelle sur la fiche du champ visé par un change (null si absent). */
export function outilMjCurrentValue(data, change) {
    if (change.op === 'counter') return Object.hasOwn(data, change.field) ? data[change.field] : null;
    if (change.op === 'carac') {
        const carac = isRecord(data.carac) && isRecord(data.carac[change.carac]) ? data.carac[change.carac] : null;
        return carac && Object.hasOwn(carac, 'base') ? carac.base : null;
    }
    const rows = change.op === 'skill-adv' ? data.skillsAdvanced : data.suiviMj;
    const matches = Array.isArray(rows) ? rows.filter(row => row?.id === change.id) : [];
    if (matches.length !== 1) return null;
    return change.op === 'skill-adv' ? (Object.hasOwn(matches[0], 'adv') ? matches[0].adv : null) : matches[0];
}

function applyChange(data, change) {
    if (change.op === 'counter') {
        data[change.field] = change.value;
    } else if (change.op === 'carac') {
        // Base seulement (Q8) : les Avances ne bougent jamais.
        data.carac = { ...data.carac, [change.carac]: { ...data.carac[change.carac], base: change.value } };
    } else if (change.op === 'skill-adv') {
        data.skillsAdvanced = data.skillsAdvanced.map(row => row?.id === change.id ? { ...row, adv: change.value } : row);
    } else {
        const rows = Array.isArray(data.suiviMj) ? data.suiviMj : [];
        if (change.value === null) data.suiviMj = rows.filter(row => row?.id !== change.id);
        else if (rows.some(row => row?.id === change.id)) data.suiviMj = rows.map(row => row?.id === change.id ? change.value : row);
        else data.suiviMj = [...rows, change.value];
        if (data.suiviMj.length > MAX_SUIVI_ENTRIES) fail('suivi du MJ trop long', 'resource-exhausted');
    }
}

/**
 * Applique une commande `outil-mj` validée, change par change : fiche = base → appliquer ;
 * fiche = valeur voulue → rien (CA12) ; sinon conflit. Un seul conflit refuse toute la commande (CA10).
 * Retourne { data, summary } ; le service dresse l'historique par outilMjChangeDelta.
 */
export function applyOutilMjCommand(data, command, context = {}) {
    if (context.role !== 'mj') fail('commande réservée au MJ', 'permission-denied');
    const payload = validateOutilMjCommand(command);
    const conflicts = [];
    const toApply = [];
    for (const change of payload.changes) {
        const current = outilMjCurrentValue(data, change);
        if (same(current, change.value)) continue;
        if (same(current, change.base)) toApply.push(change);
        else conflicts.push(outilMjChangeKey(change));
    }
    if (conflicts.length) {
        fail('la fiche a changé depuis la dernière lecture de l’outil', 'aborted', {
            kind: 'conflict', fields: conflicts, ...(Number.isSafeInteger(context.revision) ? { revision: context.revision } : {}),
        });
    }
    const nextData = JSON.parse(JSON.stringify(data));
    for (const change of toApply) applyChange(nextData, change);
    const undoOf = payload.undoOf;
    return {
        data: nextData,
        summary: {
            kind: 'outil-mj',
            label: undoOf ? 'Annulation d’un envoi de l’outil MJ' : 'Envoi de l’outil MJ',
            ...(undoOf ? { undoOf } : {}),
        },
    };
}

/** Historique (CA9) : { clé: { before, after, label } } pour les seuls champs réellement modifiés. */
export function outilMjChangeDelta(before, after, payload) {
    const delta = {};
    for (const change of payload.changes) {
        const previous = outilMjCurrentValue(before, change);
        const next = outilMjCurrentValue(after, change);
        if (!same(previous, next)) delta[outilMjChangeKey(change)] = { before: previous, after: next, label: change.label };
    }
    return delta;
}

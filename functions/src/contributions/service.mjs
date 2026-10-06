import { createHash, randomUUID } from 'node:crypto';
import { uploadProtectedImage, UploadValidationError } from '../core.mjs';

export const CONTRIBUTION_KINDS = Object.freeze(['pnj', 'indice', 'relation']);
export const CAMPAIGN_CHAR_IDS = Object.freeze(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']);
export const CONTRIBUTION_LIMITS = Object.freeze({
    textBytes: 48 * 1024,
    descriptionBytes: 30_000,
    dependencies: 450,
    transactionWrites: 480,
    trashBytes: 700 * 1024,
    purgeImageCandidates: 100,
    purgeImageBatch: 10,
    purgeReferenceScan: 501,
});

const ADMIN_EMAIL = 'ethoril@gmail.com';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,150}$/u;
const OPERATION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PNJ_FIELDS = new Set(['nom', 'statut', 'vivant', 'lieu', 'groupe', 'groupes', 'description', 'imagePath']);
const INDICE_FIELDS = new Set(['titre', 'description', 'source', 'type', 'dateDecouverte', 'pnjsLies', 'imagePath']);
const RELATION_FIELDS = new Set(['source', 'cible', 'type', 'label', 'color', 'style', 'curvature']);
const CONTENT_COLLECTION = Object.freeze({ pnj: 'pnjs', indice: 'indices', relation: 'relations' });

export class ContributionError extends Error {
    constructor(message, code = 'invalid-argument', details = undefined) {
        super(message);
        this.name = 'ContributionError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(message, code = 'invalid-argument', details) {
    throw new ContributionError(message, code, details);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exists(snapshot) {
    return typeof snapshot?.exists === 'function' ? snapshot.exists() : snapshot?.exists === true;
}

function dataOf(snapshot) { return exists(snapshot) ? snapshot.data() : null; }
function safeId(value, label = 'identifiant') {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) fail(`${label} invalide`);
    return value;
}

function assertSafeTree(value, depth = 0) {
    if (depth > 12) fail('contenu trop imbriqué');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
        if (Buffer.byteLength(value, 'utf8') > CONTRIBUTION_LIMITS.textBytes) fail('texte trop volumineux');
        return;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('nombre invalide');
        return;
    }
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) fail('date invalide');
        return;
    }
    if (value && typeof value.toDate === 'function') {
        const date = value.toDate();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) fail('date invalide');
        return;
    }
    if (Array.isArray(value)) {
        if (value.length > 500) fail('liste trop volumineuse');
        for (const item of value) assertSafeTree(item, depth + 1);
        return;
    }
    if (!isRecord(value)) fail('objet invalide');
    for (const [key, item] of Object.entries(value)) {
        if (DANGEROUS_KEYS.has(key) || key.length > 200) fail('clé invalide');
        assertSafeTree(item, depth + 1);
    }
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    return JSON.stringify(value);
}

function hashCommand(command, uid) {
    return createHash('sha256').update(canonical({ command, uid })).digest('hex');
}

function boundedText(value, max, field, { required = false } = {}) {
    if (typeof value !== 'string' || value.length > max || (required && value.trim() === '')) fail(`${field} invalide`);
    return value;
}

function normalizeGroups(input) {
    if (!Array.isArray(input) || input.length > 20) fail('groupes invalides');
    const seen = new Set();
    const result = [];
    for (const item of input) {
        if (typeof item !== 'string') fail('groupes invalides');
        const label = item.trim().replace(/\s+/gu, ' ');
        const key = label.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
        if (!label || label.length > 200) fail('groupes invalides');
        if (!seen.has(key)) { seen.add(key); result.push(label); }
    }
    return result;
}

function normalizeLinks(input) {
    if (!Array.isArray(input) || input.length > 100) fail('liens PNJ invalides');
    const links = [...new Set(input.map(value => safeId(value, 'identifiant PNJ')))];
    return links.sort((left, right) => left.localeCompare(right));
}

function normalizePnj(raw, { creating = false } = {}) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !PNJ_FIELDS.has(key))) fail('champs PNJ non autorisés');
    const result = {};
    if (creating || Object.hasOwn(raw, 'nom')) result.nom = boundedText(raw.nom, 200, 'nom', { required: true });
    for (const [field, max] of [['statut', 64], ['vivant', 32], ['lieu', 200], ['groupe', 200], ['description', 20_000]]) {
        if (Object.hasOwn(raw, field)) result[field] = boundedText(raw[field], max, field);
    }
    if (Object.hasOwn(raw, 'statut') && !['', 'allié', 'neutre', 'ennemi'].includes(result.statut)) fail('statut PNJ invalide');
    if (Object.hasOwn(raw, 'vivant') && !['oui', 'non', 'inconnu'].includes(result.vivant)) fail('état PNJ invalide');
    if (Object.hasOwn(raw, 'groupes')) {
        result.groupes = normalizeGroups(raw.groupes);
        result.groupe = result.groupes[0] ?? '';
    } else if (Object.hasOwn(raw, 'groupe')) {
        result.groupe = boundedText(raw.groupe, 200, 'groupe');
    }
    if (Object.hasOwn(raw, 'imagePath')) {
        if (raw.imagePath !== null && typeof raw.imagePath !== 'string') fail('chemin de portrait invalide');
        result.imagePath = raw.imagePath;
    }
    return result;
}

function normalizeIndice(raw, { creating = false } = {}) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !INDICE_FIELDS.has(key))) fail('champs d’indice non autorisés');
    const result = {};
    if (creating || Object.hasOwn(raw, 'titre')) result.titre = boundedText(raw.titre, 200, 'titre', { required: true });
    for (const [field, max] of [['description', CONTRIBUTION_LIMITS.descriptionBytes], ['source', 150], ['type', 100]]) {
        if (Object.hasOwn(raw, field)) result[field] = boundedText(raw[field], max, field);
    }
    if (creating || Object.hasOwn(raw, 'pnjsLies')) result.pnjsLies = normalizeLinks(raw.pnjsLies ?? []);
    if (Object.hasOwn(raw, 'dateDecouverte')) {
        const value = raw.dateDecouverte;
        if (value === null) result.dateDecouverte = null;
        else if (value instanceof Date && Number.isFinite(value.getTime())) result.dateDecouverte = value;
        else if (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))) result.dateDecouverte = new Date(value);
        else if (isRecord(value) && Number.isSafeInteger(value.seconds) && Number.isInteger(value.nanoseconds ?? 0)) {
            result.dateDecouverte = new Date(value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1e6));
            if (!Number.isFinite(result.dateDecouverte.getTime())) fail('date de découverte invalide');
        } else fail('date de découverte invalide');
    }
    if (Object.hasOwn(raw, 'imagePath')) {
        if (typeof raw.imagePath !== 'string' || !raw.imagePath) fail('chemin d’image invalide');
        result.imagePath = raw.imagePath;
    }
    return result;
}

function normalizeRelation(raw, { creating = false } = {}) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !RELATION_FIELDS.has(key))) fail('champs de relation non autorisés');
    const result = {};
    for (const field of ['source', 'cible']) {
        if (creating || Object.hasOwn(raw, field)) result[field] = safeId(raw[field], field);
    }
    if (creating || Object.hasOwn(raw, 'type')) result.type = boundedText(raw.type, 100, 'type de relation', { required: true });
    if (Object.hasOwn(raw, 'label')) result.label = boundedText(raw.label, 300, 'libellé');
    if (Object.hasOwn(raw, 'color')) {
        if (raw.color !== null && (typeof raw.color !== 'string' || raw.color.length > 32
            || !/^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu.test(raw.color))) fail('couleur invalide');
        result.color = raw.color;
    }
    if (Object.hasOwn(raw, 'style')) {
        if (!['solid', 'dashed'].includes(raw.style)) fail('style invalide');
        result.style = raw.style;
    }
    if (Object.hasOwn(raw, 'curvature')) {
        if (raw.curvature !== null && (typeof raw.curvature !== 'number' || !Number.isFinite(raw.curvature)
            || raw.curvature < -6 || raw.curvature > 6)) fail('courbure invalide');
        result.curvature = raw.curvature;
    }
    if (result.source && result.cible && result.source === result.cible) fail('une relation doit relier deux PNJ distincts');
    return result;
}

function validateImagePath(kind, id, path) {
    if (kind === 'pnj' && path === null) return;
    if (typeof path !== 'string' || path.length > 512) fail('chemin d’image invalide');
    const parts = path.split('/');
    const prefix = kind === 'pnj' ? 'portraits' : 'indices';
    const stem = kind === 'pnj' ? 'portrait' : 'image';
    if (parts.length !== 3 || parts[0] !== prefix || parts[1] !== id
        || !new RegExp(`^${stem}-[A-Za-z0-9_-]{1,128}\\.(?:jpg|png|webp|gif|avif)$`, 'u').test(parts[2])) {
        fail('chemin d’image ne correspondant pas au contenu');
    }
}

function validateCommand(command) {
    if (!isRecord(command)) fail('commande invalide');
    const allowed = ['kind', 'action', 'id', 'operationId', 'baseRevision', 'changes', 'baseValues', 'pair', 'reciprocalId', 'reciprocalBaseRevision'];
    if (Object.keys(command).some(key => !allowed.includes(key))) fail('propriétés de commande non autorisées');
    if (!CONTRIBUTION_KINDS.includes(command.kind)) fail('type de contenu invalide');
    if (!['create', 'update'].includes(command.action)) fail('action invalide');
    if (typeof command.operationId !== 'string' || !OPERATION_PATTERN.test(command.operationId)) fail('identifiant d’opération invalide');
    if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) fail('révision de base invalide');
    if (command.action === 'update') safeId(command.id);
    else if (command.id !== undefined) safeId(command.id);
    if (!isRecord(command.changes)) fail('modifications invalides');
    if (command.baseValues !== undefined && !isRecord(command.baseValues)) fail('valeurs de base invalides');
    if (command.action === 'update' && !isRecord(command.baseValues)) fail('valeurs de base requises');
    if (Object.hasOwn(command, 'pair') && typeof command.pair !== 'boolean') fail('option de relation invalide');
    if (command.reciprocalId !== undefined) safeId(command.reciprocalId, 'relation réciproque');
    if (command.reciprocalBaseRevision !== undefined
        && (!Number.isSafeInteger(command.reciprocalBaseRevision) || command.reciprocalBaseRevision < 0)) fail('révision réciproque invalide');
    assertSafeTree(command.changes);
    if (command.baseValues !== undefined) assertSafeTree(command.baseValues);
    if (Buffer.byteLength(canonical(command), 'utf8') > 96 * 1024) fail('commande trop volumineuse');
    return command;
}

function validateChanges(command) {
    const allowlist = new Set(command.kind === 'pnj' ? PNJ_FIELDS : command.kind === 'indice' ? INDICE_FIELDS : RELATION_FIELDS);
    if (command.action === 'create' && command.kind === 'pnj') allowlist.add('visibleJoueurs');
    if (command.action === 'create' && command.kind === 'indice') allowlist.add('decouvert');
    if (Object.keys(command.changes).length === 0 || Object.keys(command.changes).length > allowlist.size
        || Object.keys(command.changes).some(key => !allowlist.has(key))) fail('champs non autorisés');
    if (command.action === 'create' && Object.hasOwn(command.changes, 'visibleJoueurs')
        && typeof command.changes.visibleJoueurs !== 'boolean') fail('visibilité invalide');
    if (command.action === 'create' && Object.hasOwn(command.changes, 'decouvert')
        && typeof command.changes.decouvert !== 'boolean') fail('visibilité invalide');
    if (command.action === 'create') {
        if (command.baseRevision !== 0 || command.baseValues !== undefined) fail('révision de création invalide');
    } else if (Object.keys(command.baseValues).length !== Object.keys(command.changes).length
        || Object.keys(command.changes).some(key => !Object.hasOwn(command.baseValues, key))) fail('valeurs de base incomplètes');
    if (command.kind !== 'relation' && (command.pair === true || command.reciprocalId !== undefined || command.reciprocalBaseRevision !== undefined)) {
        fail('option de paire réservée aux relations');
    }
}

function identity(request) {
    const auth = request?.auth;
    const email = typeof auth?.token?.email === 'string' ? auth.token.email.trim().toLowerCase() : '';
    if (!auth?.uid || !email || auth.token.email_verified !== true) fail('authentification vérifiée requise', 'unauthenticated');
    return { uid: auth.uid, email, isMj: email === ADMIN_EMAIL };
}

function roleFor(user, access) {
    if (user.isMj) return 'mj';
    if (CAMPAIGN_CHAR_IDS.some(charId => Array.isArray(access?.[charId]) && access[charId].includes(user.email))) return 'joueur';
    return 'public';
}

function requireContributor(user, access) {
    const role = roleFor(user, access);
    if (role === 'public') fail('contribution non autorisée', 'permission-denied');
    return role;
}

function contentRef(db, kind, id) { return db.doc(`${CONTENT_COLLECTION[kind]}/${id}`); }
function metadataRef(db, kind, id) { return db.doc(`content_metadata/${kind}_${id}`); }
function trashRef(db, kind, id) { return db.doc(`content_trash/${kind}_${id}`); }
function trashArchiveRef(db, kind, id, revision) { return db.doc(`content_trash_archive/${kind}_${id}_${revision}`); }
function purgeAuditRef(db, operationId) { return db.doc(`content_purge_audit/${operationId}`); }
function receiptRef(db, operationId) { return db.doc(`content_operations/${operationId}`); }
function historyRef(db, kind, id, operationId) { return db.doc(`content_history/${kind}_${id}/events/${operationId}`); }
function campaignRef(db) { return db.doc('campagne/acces'); }
function deletionLockRef(db) { return db.doc('integrity_locks/pnj-deletion'); }

function readPublic(kind, id, raw) {
    if (kind === 'pnj') {
        const legacyGroup = typeof raw.groupe === 'string' ? raw.groupe.trim() : '';
        const groups = Array.isArray(raw.groupes) ? normalizeGroups(raw.groupes)
            : legacyGroup ? normalizeGroups([legacyGroup]) : [];
        return {
            id, nom: raw.nom ?? '', statut: raw.statut ?? '', vivant: raw.vivant ?? '',
            lieu: raw.lieu ?? '', groupe: raw.groupe ?? groups[0] ?? '', groupes: groups,
            description: raw.description ?? '', visibleJoueurs: raw.visibleJoueurs === true,
            ...(typeof raw.imagePath === 'string' ? { imagePath: raw.imagePath } : {}),
        };
    }
    if (kind === 'indice') {
        const result = {
            id, titre: raw.titre ?? '', description: raw.description ?? '', source: raw.source ?? '', type: raw.type ?? '',
            decouvert: raw.decouvert === true, pnjsLies: normalizeLinks(Array.isArray(raw.pnjsLies) ? raw.pnjsLies : []),
        };
        if (raw.dateDecouverte === null || raw.dateDecouverte instanceof Date || typeof raw.dateDecouverte === 'string') result.dateDecouverte = raw.dateDecouverte;
        else if (raw.dateDecouverte && typeof raw.dateDecouverte.toDate === 'function') result.dateDecouverte = raw.dateDecouverte.toDate();
        else if (isRecord(raw.dateDecouverte) && Number.isSafeInteger(raw.dateDecouverte.seconds)) {
            result.dateDecouverte = { seconds: raw.dateDecouverte.seconds, nanoseconds: Number.isInteger(raw.dateDecouverte.nanoseconds) ? raw.dateDecouverte.nanoseconds : 0 };
        }
        if (typeof raw.imagePath === 'string') result.imagePath = raw.imagePath;
        return result;
    }
    const relationFields = Object.fromEntries(Object.entries(raw).filter(([field]) => RELATION_FIELDS.has(field)));
    const result = { id, ...normalizeRelation(relationFields, { creating: true }), visibleJoueurs: raw.visibleJoueurs === true };
    return result;
}

function publicSnapshot(kind, raw) {
    const fields = kind === 'pnj' ? new Set([...PNJ_FIELDS, 'visibleJoueurs', 'createdAt', 'updatedAt', 'ordre', 'suppressionEnCours'])
        : kind === 'indice' ? new Set([...INDICE_FIELDS, 'decouvert', 'createdAt', 'updatedAt', 'ordre'])
            : new Set([...RELATION_FIELDS, 'visibleJoueurs', 'createdAt', 'updatedAt']);
    return Object.fromEntries(Object.entries(raw).filter(([field]) => fields.has(field)));
}

function visibleToPublic(kind, raw) {
    if (!raw) return false;
    if (kind === 'pnj') return raw.visibleJoueurs === true && raw.suppressionEnCours !== true;
    if (kind === 'indice') return raw.decouvert === true;
    return raw.visibleJoueurs === true;
}

function same(left, right) { return canonical(left) === canonical(right); }

function threeWay(current, changes, baseValues, revision) {
    const changed = {};
    const conflicts = [];
    for (const [key, after] of Object.entries(changes)) {
        const before = baseValues[key];
        const remote = Object.hasOwn(current, key) ? current[key] : null;
        if (same(remote, before)) changed[key] = after;
        else if (!same(remote, after) && !same(before, after)) conflicts.push(key);
    }
    if (conflicts.length) fail('modification concurrente', 'aborted', { kind: 'conflict', revision, fields: conflicts });
    return changed;
}

function normalizePayload(kind, raw, id, { creating = false } = {}) {
    const normalized = kind === 'pnj' ? normalizePnj(raw, { creating })
        : kind === 'indice' ? normalizeIndice(raw, { creating })
            : normalizeRelation(raw, { creating });
    if (Object.hasOwn(normalized, 'imagePath') && normalized.imagePath !== null) validateImagePath(kind, id, normalized.imagePath);
    return normalized;
}

function deriveRelationFingerprint(data) {
    const normalized = value => String(value ?? '').trim().toLocaleLowerCase('fr');
    return JSON.stringify([
        String(data.source ?? ''), String(data.cible ?? ''), normalized(data.type),
        normalized(data.label || data.type), normalized(data.color), normalized(data.style || 'solid'), true,
    ]);
}

export function relationDocumentId(data) {
    const input = deriveRelationFingerprint(data);
    let first = 0x811c9dc5, second = 0x9e3779b9;
    for (let index = 0; index < input.length; index++) {
        const code = input.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `rel-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function reverseRelation(data) { return { ...data, source: data.cible, cible: data.source, visibleJoueurs: true }; }
function reverseRelationFields(data) {
    return Object.fromEntries([...RELATION_FIELDS].filter(field => Object.hasOwn(data, field))
        .map(field => [field, field === 'source' ? data.cible : field === 'cible' ? data.source : data[field]]));
}
function isExactReciprocal(left, right) {
    if (!left || !right) return false;
    return deriveRelationFingerprint(left) === deriveRelationFingerprint(reverseRelation(right));
}

function relationData(raw) { return { ...normalizeRelation(raw, { creating: true }), visibleJoueurs: true }; }

function validateEndpoints(source, target) {
    for (const snapshot of [source, target]) {
        const data = dataOf(snapshot);
        if (!data || data.visibleJoueurs !== true || data.suppressionEnCours === true) {
            fail('extrémité PNJ indisponible', 'failed-precondition', { kind: 'endpoint-unavailable' });
        }
    }
}

async function getVisiblePnjIds(transaction, db, ids) {
    const visible = [];
    for (const id of ids) {
        const snapshot = await transaction.get(contentRef(db, 'pnj', id));
        const raw = dataOf(snapshot);
        if (raw?.visibleJoueurs === true && raw.suppressionEnCours !== true) visible.push(id);
    }
    return visible;
}

function safeSummary(kind, data) {
    if (kind === 'pnj') return { kind, nom: data.nom };
    if (kind === 'indice') return { kind, titre: data.titre };
    return { kind, type: data.type, label: data.label ?? data.type };
}

function changedFields(before, after, allowed) {
    return Object.fromEntries([...allowed].filter(key => !same(before[key], after[key]))
        .map(key => [key, { before: before[key] ?? null, after: after[key] ?? null }]));
}

function cleanPrivateError(error) {
    if (error instanceof ContributionError) throw error;
    if (error instanceof UploadValidationError) throw new ContributionError(error.message, error.code);
    throw new ContributionError('opération de contribution impossible', 'internal');
}

function verifyReceipt(snapshot, commandHash) {
    const receipt = dataOf(snapshot);
    if (!receipt) return null;
    if (receipt.commandHash !== commandHash) fail('identifiant d’opération déjà utilisé', 'already-exists');
    return receipt.response;
}

function metadataDefaults(kind, id, current) {
    const value = current ?? {};
    if (value.state && value.state !== 'active') fail('contenu indisponible', 'not-found');
    return {
        ...value,
        kind,
        contentId: id,
        ownerUid: typeof value.ownerUid === 'string' ? value.ownerUid : null,
        revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
        state: 'active',
        ...(typeof value.reciprocalId === 'string' ? { reciprocalId: value.reciprocalId } : {}),
        ...(value.createdAt ? { createdAt: value.createdAt } : {}),
    };
}

function assertCurrentPublic(kind, raw) {
    if (!visibleToPublic(kind, raw)) fail('contenu public indisponible', 'not-found');
}

function assertBaseRevision(command, metadata) {
    if (command.baseRevision > metadata.revision) fail('révision inconnue', 'aborted', { kind: 'conflict', revision: metadata.revision });
}

function imageReservationFromPath(kind, id, path, db) {
    if (typeof path !== 'string') return null;
    const file = path.split('/')[2] || '';
    const match = file.match(/^(?:portrait|image)-([A-Za-z0-9_-]{1,128})\.(?:jpg|png|webp|gif|avif)$/u);
    if (!match) fail('chemin image invalide');
    return { kind, ref: db.doc(`content_image_reservations/${kind}_${id}_${match[1]}`), operationId: match[1], path };
}

async function checkReservation(transaction, descriptor, uid, { consume = false } = {}) {
    if (!descriptor) return null;
    const snapshot = await transaction.get(descriptor.ref);
    const reservation = dataOf(snapshot);
    if (!reservation || reservation.uid !== uid || reservation.path !== descriptor.path
        || reservation.kind !== descriptor.kind || reservation.state !== 'uploaded'
        || !Number.isSafeInteger(reservation.size) || reservation.size < 1
        || typeof reservation.md5Hash !== 'string' || !reservation.md5Hash) {
        fail('réservation image indisponible', 'failed-precondition', { kind: 'image-reservation-invalid' });
    }
    return consume ? { ref: descriptor.ref, value: { ...reservation, state: 'consumed' } } : reservation;
}

/** Read-only capability endpoint. It never returns campaign email addresses. */
export async function getCampaignCapabilities(request, deps) {
    if (!deps?.db) fail('service indisponible', 'internal');
    const user = request?.auth ? identity(request) : null;
    if (!user) return { role: 'public', contribution: false, characterIds: [] };
    const snapshot = await campaignRef(deps.db).get();
    const role = roleFor(user, dataOf(snapshot) ?? {});
    return {
        role,
        contribution: role !== 'public',
        characterIds: role === 'mj' ? [...CAMPAIGN_CHAR_IDS, 'test']
            : role === 'joueur' ? CAMPAIGN_CHAR_IDS.filter(charId => (dataOf(snapshot)?.[charId] ?? []).includes(user.email)) : [],
    };
}

/** Read-only, allowlisted editor context. Hidden content is indistinguishable from missing content. */
export async function getContentEditContext(request, deps) {
    const user = request?.auth ? identity(request) : null;
    const { kind } = request?.data ?? {};
    if (!CONTRIBUTION_KINDS.includes(kind)) fail('type de contenu invalide');
    const id = safeId(request.data.id);
    const [accessSnapshot, contentSnapshot, metadataSnapshot] = await Promise.all([
        campaignRef(deps.db).get(), contentRef(deps.db, kind, id).get(), metadataRef(deps.db, kind, id).get(),
    ]);
    const access = dataOf(accessSnapshot) ?? {};
    const role = user ? roleFor(user, access) : 'public';
    const content = dataOf(contentSnapshot);
    if (role !== 'mj') assertCurrentPublic(kind, content);
    else if (!content || dataOf(metadataSnapshot)?.state && dataOf(metadataSnapshot).state !== 'active') fail('contenu introuvable', 'not-found');
    const metadata = metadataDefaults(kind, id, dataOf(metadataSnapshot));
    const publicData = readPublic(kind, id, content);
    if (kind === 'relation' && role !== 'mj') {
        const [sourceSnapshot, targetSnapshot] = await Promise.all([
            contentRef(deps.db, 'pnj', publicData.source).get(),
            contentRef(deps.db, 'pnj', publicData.cible).get(),
        ]);
        try { validateEndpoints(sourceSnapshot, targetSnapshot); }
        catch { fail('contenu public indisponible', 'not-found'); }
    }
    if (kind === 'indice' && role !== 'mj') {
        const safeLinks = [];
        for (const linkedId of publicData.pnjsLies) {
            const pnj = await contentRef(deps.db, 'pnj', linkedId).get();
            if (dataOf(pnj)?.visibleJoueurs === true) safeLinks.push(linkedId);
        }
        publicData.pnjsLies = safeLinks;
    }
    if (kind === 'relation' && role !== 'mj') {
        const reverseId = typeof metadata.reciprocalId === 'string' ? metadata.reciprocalId : relationDocumentId(reverseRelation(publicData));
        const reciprocal = await contentRef(deps.db, 'relation', reverseId).get();
        if (exists(reciprocal) && visibleToPublic('relation', dataOf(reciprocal))
            && isExactReciprocal(publicData, dataOf(reciprocal))) {
            publicData.reciprocalId = reverseId;
            publicData.reciprocalRevision = metadataDefaults('relation', reverseId, dataOf(await metadataRef(deps.db, 'relation', reverseId).get())).revision;
        }
    }
    if (kind === 'relation' && role === 'mj') {
        const candidateId = typeof metadata.reciprocalId === 'string'
            ? metadata.reciprocalId : relationDocumentId(reverseRelation(publicData));
        const [candidate, candidateMeta] = await Promise.all([
            contentRef(deps.db, 'relation', candidateId).get(), metadataRef(deps.db, 'relation', candidateId).get(),
        ]);
        if (exists(candidate) && isExactReciprocal(publicData, dataOf(candidate))) {
            const candidateMetadata = metadataDefaults('relation', candidateId, dataOf(candidateMeta));
            const linkedManagedPair = metadata.reciprocalId === candidateId && candidateMetadata.reciprocalId === id;
            const adoptableLegacyPair = !exists(metadataSnapshot) && !exists(candidateMeta);
            if (linkedManagedPair || adoptableLegacyPair) {
                publicData.reciprocalId = candidateId;
                publicData.reciprocalRevision = candidateMetadata.revision;
            }
        }
    }
    return {
        kind,
        id,
        data: publicData,
        revision: metadata.revision,
        managed: exists(metadataSnapshot),
        canEdit: role !== 'public',
        canDelete: role === 'mj' || (role === 'joueur' && metadata.ownerUid === user.uid),
    };
}

/** Authenticated, role-filtered choices for public relationship and clue controls. */
export async function getContentPnjChoices(request, deps) {
    const user = identity(request);
    if (!deps?.db) fail('service indisponible', 'internal');
    const access = dataOf(await campaignRef(deps.db).get()) ?? {};
    const role = requireContributor(user, access);
    const limit = request?.data?.limit ?? 500;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) fail('limite invalide');
    let query = deps.db.collection('pnjs').orderBy('nom').limit(limit + 1);
    if (role !== 'mj') query = deps.db.collection('pnjs').where('visibleJoueurs', '==', true).orderBy('nom').limit(limit + 1);
    if (typeof request?.data?.cursor === 'string' && request.data.cursor) {
        const cursorId = safeId(request.data.cursor, 'curseur');
        const cursor = await contentRef(deps.db, 'pnj', cursorId).get();
        if (exists(cursor) && (role === 'mj' || dataOf(cursor)?.visibleJoueurs === true)) query = query.startAfter(cursor);
    }
    const snapshot = await query.get();
    const hasMore = snapshot.docs.length > limit;
    const scanned = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;
    const pnjs = scanned
        .filter(document => document.data()?.suppressionEnCours !== true)
        .map(document => ({ id: document.id, nom: typeof document.data()?.nom === 'string' ? document.data().nom : '' }))
        .filter(item => item.nom);
    return { pnjs, nextCursor: hasMore ? scanned.at(-1)?.id ?? null : null };
}

/** MJ-only versioned edit path for managed content, including hidden records and visibility. */
export async function mutateMjContent(rawCommand, request, deps) {
    const user = identity(request);
    if (!user.isMj) fail('modification réservée au MJ', 'permission-denied');
    if (!deps?.db || typeof deps.timestamp !== 'function') fail('service indisponible', 'internal');
    if (!isRecord(rawCommand)) fail('commande invalide');
    const command = { ...rawCommand };
    const permitted = ['kind', 'id', 'operationId', 'baseRevision', 'baseValues', 'changes', 'reciprocalId', 'reciprocalBaseRevision'];
    if (Object.keys(command).some(key => !permitted.includes(key)) || !CONTRIBUTION_KINDS.includes(command.kind)) fail('commande invalide');
    safeId(command.id);
    if (typeof command.operationId !== 'string' || !OPERATION_PATTERN.test(command.operationId)) fail('identifiant d’opération invalide');
    if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) fail('révision invalide');
    if (!isRecord(command.changes) || !isRecord(command.baseValues)
        || Object.keys(command.changes).length < 1 || Object.keys(command.changes).length > 16
        || Object.keys(command.changes).length !== Object.keys(command.baseValues).length
        || Object.keys(command.changes).some(key => !Object.hasOwn(command.baseValues, key))) fail('valeurs de base incomplètes');
    assertSafeTree(command.changes);
    assertSafeTree(command.baseValues);
    if (Buffer.byteLength(canonical(command), 'utf8') > 96 * 1024) fail('commande trop volumineuse');
    const allowed = command.kind === 'pnj' ? new Set([...PNJ_FIELDS, 'visibleJoueurs'])
        : command.kind === 'indice' ? new Set([...INDICE_FIELDS, 'decouvert'])
            : new Set([...RELATION_FIELDS, 'visibleJoueurs']);
    if (Object.keys(command.changes).some(key => !allowed.has(key))) fail('champs non autorisés');
    for (const [key, value] of Object.entries(command.changes)) {
        if (['visibleJoueurs', 'decouvert'].includes(key) && typeof value !== 'boolean') fail('visibilité invalide');
    }
    if (command.reciprocalId !== undefined) safeId(command.reciprocalId, 'relation réciproque');
    if (command.reciprocalBaseRevision !== undefined && (!Number.isSafeInteger(command.reciprocalBaseRevision) || command.reciprocalBaseRevision < 0)) fail('révision réciproque invalide');

    const operationHash = hashCommand(command, user.uid);
    const docRef = contentRef(deps.db, command.kind, command.id);
    const docMetaRef = metadataRef(deps.db, command.kind, command.id);
    const opRef = receiptRef(deps.db, command.operationId);
    try {
        return await deps.db.runTransaction(async transaction => {
            const dependencies = [];
            const [accessSnap, receiptSnap, lockSnap, contentSnap, metadataSnap] = await Promise.all([
                transaction.get(campaignRef(deps.db)), transaction.get(opRef), transaction.get(deletionLockRef(deps.db)),
                transaction.get(docRef), transaction.get(docMetaRef),
            ]);
            const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
            if (role !== 'mj') fail('modification réservée au MJ', 'permission-denied');
            const replay = verifyReceipt(receiptSnap, operationHash);
            if (replay) return replay;
            if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });
            const raw = dataOf(contentSnap);
            if (!raw) fail('contenu introuvable', 'not-found');
            const metadata = metadataDefaults(command.kind, command.id, dataOf(metadataSnap));
            if (metadata.state !== 'active') fail('contenu introuvable', 'not-found');
            if (metadata.revision !== command.baseRevision) fail('révision modifiée', 'aborted', { kind: 'conflict', revision: metadata.revision });

            const conflicts = Object.keys(command.changes).filter(field =>
                !same(Object.hasOwn(raw, field) ? raw[field] : null, command.baseValues[field]));
            if (conflicts.length) fail('modification concurrente', 'aborted', { kind: 'conflict', revision: metadata.revision, fields: conflicts });

            const publicFields = Object.fromEntries(Object.entries(command.changes).filter(([key]) =>
                command.kind === 'pnj' ? PNJ_FIELDS.has(key) : command.kind === 'indice' ? INDICE_FIELDS.has(key) : RELATION_FIELDS.has(key)));
            const normalized = Object.keys(publicFields).length ? normalizePayload(command.kind, publicFields, command.id) : {};
            const next = { ...raw, ...normalized };
            for (const field of ['visibleJoueurs', 'decouvert']) if (Object.hasOwn(command.changes, field)) next[field] = command.changes[field];
            if (command.kind === 'pnj' && Object.hasOwn(normalized, 'groupes')) next.groupe = normalized.groupes[0] ?? '';
            if (command.kind === 'relation' && next.visibleJoueurs === true) {
                const endpoints = await Promise.all([next.source, next.cible].map(endpoint => transaction.get(contentRef(deps.db, 'pnj', safeId(endpoint)))));
                validateEndpoints(endpoints[0], endpoints[1]);
            }
            let reciprocal = null;
            if (command.kind === 'relation' && (metadata.reciprocalId || command.reciprocalId)) {
                const reciprocalId = metadata.reciprocalId || command.reciprocalId;
                if (command.reciprocalId !== reciprocalId || !Number.isSafeInteger(command.reciprocalBaseRevision)) {
                    fail('modification d’une paire réciproque doit rester atomique', 'failed-precondition', { kind: 'reciprocal-required' });
                }
                const safeReciprocalId = safeId(reciprocalId, 'relation réciproque');
                const reciprocalRef = contentRef(deps.db, 'relation', safeReciprocalId);
                const reciprocalMetaRef = metadataRef(deps.db, 'relation', safeReciprocalId);
                const [reciprocalSnap, reciprocalMetaSnap] = await Promise.all([transaction.get(reciprocalRef), transaction.get(reciprocalMetaRef)]);
                const reciprocalRaw = dataOf(reciprocalSnap);
                const reciprocalMetadata = metadataDefaults('relation', safeReciprocalId, dataOf(reciprocalMetaSnap));
                if (!reciprocalRaw || reciprocalMetadata.revision !== command.reciprocalBaseRevision
                    || (reciprocalMetadata.reciprocalId && reciprocalMetadata.reciprocalId !== command.id)
                    || (!metadata.reciprocalId && (exists(metadataSnap) || exists(reciprocalMetaSnap)))
                    || !isExactReciprocal(raw, reciprocalRaw)) {
                    fail('relation réciproque modifiée', 'aborted', { kind: 'conflict', revision: reciprocalMetadata.revision });
                }
                const reversed = { ...reverseRelationFields(next), visibleJoueurs: next.visibleJoueurs === true };
                reciprocal = { id: safeReciprocalId, ref: reciprocalRef, metaRef: reciprocalMetaRef,
                    metadata: reciprocalMetadata, raw: reciprocalRaw, next: reversed };
            } else if (command.kind === 'relation' && (command.reciprocalId !== undefined || command.reciprocalBaseRevision !== undefined)) {
                fail('cette relation ne possède pas de miroir géré', 'failed-precondition', { kind: 'reciprocal-changed' });
            }
            if (command.kind === 'indice' && next.decouvert === true) {
                const endpoints = await Promise.all(normalizeLinks(next.pnjsLies ?? []).map(endpoint => transaction.get(contentRef(deps.db, 'pnj', endpoint))));
                if (endpoints.some(endpoint => dataOf(endpoint)?.visibleJoueurs !== true)) fail('une enquête découverte ne peut lier que des PNJ publics', 'failed-precondition', { kind: 'endpoint-unavailable' });
            }

            const imageReservation = Object.hasOwn(command.changes, 'imagePath') && next.imagePath
                && next.imagePath !== (raw.imagePath ?? null)
                ? imageReservationFromPath(command.kind, command.id, next.imagePath, deps.db) : null;
            const consumedReservation = imageReservation
                ? await checkReservation(transaction, imageReservation, user.uid, { consume: true }) : null;

            const visibilityTurningOff = command.kind === 'pnj' && raw.visibleJoueurs === true && next.visibleJoueurs !== true;
            const visibilityTurningOn = command.kind === 'pnj' && raw.visibleJoueurs !== true && next.visibleJoueurs === true;
            if (visibilityTurningOff || visibilityTurningOn) {
                const relationLimit = CONTRIBUTION_LIMITS.dependencies + 1;
                const [outgoing, incoming, indices] = await Promise.all([
                    transaction.get(deps.db.collection('relations').where('source', '==', command.id).limit(relationLimit)),
                    transaction.get(deps.db.collection('relations').where('cible', '==', command.id).limit(relationLimit)),
                    visibilityTurningOff
                        ? transaction.get(deps.db.collection('indices').where('pnjsLies', 'array-contains', command.id).limit(relationLimit))
                        : Promise.resolve({ size: 0, docs: [] }),
                ]);
                if ([outgoing, incoming, indices].some(result => result.size >= relationLimit)) {
                    fail('cascade trop volumineuse ou tronquée', 'failed-precondition', { kind: 'cascade-too-large' });
                }
                const related = new Map();
                for (const snapshot of [...outgoing.docs, ...incoming.docs]) {
                    const value = dataOf(snapshot);
                    if (visibilityTurningOff && value?.visibleJoueurs === true) {
                        related.set(`relation_${snapshot.id}`, { kind: 'relation', id: snapshot.id, raw: value });
                    }
                }
                for (const snapshot of indices.docs) {
                    const value = dataOf(snapshot);
                    if (value?.decouvert === true) related.set(`indice_${snapshot.id}`, { kind: 'indice', id: snapshot.id, raw: value });
                }
                if (related.size > CONTRIBUTION_LIMITS.dependencies) fail('cascade trop volumineuse', 'failed-precondition', { kind: 'cascade-too-large', dependencies: related.size });
                for (const dependency of related.values()) {
                    if (visibilityTurningOn && dependency.kind === 'relation') {
                        const otherId = dependency.raw.source === command.id ? dependency.raw.cible : dependency.raw.source;
                        const endpoint = dataOf(await transaction.get(contentRef(deps.db, 'pnj', safeId(otherId))));
                        if (endpoint?.visibleJoueurs !== true || endpoint.suppressionEnCours === true) continue;
                    }
                    const ref = metadataRef(deps.db, dependency.kind, dependency.id);
                    const snap = await transaction.get(ref);
                    dependency.ref = contentRef(deps.db, dependency.kind, dependency.id);
                    dependency.metaRef = ref;
                    dependency.metadata = metadataDefaults(dependency.kind, dependency.id, dataOf(snap));
                    dependency.data = dependency.kind === 'pnj' ? readPublic('pnj', dependency.id, dependency.raw)
                        : dependency.kind === 'indice' ? readPublic('indice', dependency.id, dependency.raw) : readPublic('relation', dependency.id, dependency.raw);
                    dependencies.push(dependency);
                }
                if (visibilityTurningOn && Array.isArray(metadata.visibilitySnapshot?.relations)) {
                    for (const entry of metadata.visibilitySnapshot.relations) {
                        if (!isRecord(entry) || typeof entry.id !== 'string' || !Number.isSafeInteger(entry.revision)) continue;
                        const relationId = safeId(entry.id);
                        const relationRef = contentRef(deps.db, 'relation', relationId);
                        const relationMetaRef = metadataRef(deps.db, 'relation', relationId);
                        const [relationSnap, relationMetaSnap] = await Promise.all([transaction.get(relationRef), transaction.get(relationMetaRef)]);
                        const relationRaw = dataOf(relationSnap);
                        const relationMetadata = metadataDefaults('relation', relationId, dataOf(relationMetaSnap));
                        if (!relationRaw || relationRaw.visibleJoueurs !== false || relationMetadata.state !== 'active'
                            || relationMetadata.revision !== entry.revision) continue;
                        const otherId = relationRaw.source === command.id ? relationRaw.cible : relationRaw.cible === command.id ? relationRaw.source : null;
                        if (!otherId) continue;
                        const otherPnj = dataOf(await transaction.get(contentRef(deps.db, 'pnj', safeId(otherId))));
                        if (otherPnj?.visibleJoueurs !== true || otherPnj.suppressionEnCours === true) continue;
                        dependencies.push({ kind: 'relation', id: relationId, raw: relationRaw,
                            data: readPublic('relation', relationId, relationRaw), ref: relationRef, metaRef: relationMetaRef, metadata: relationMetadata });
                    }
                }
                if (visibilityTurningOn && Array.isArray(metadata.visibilitySnapshot?.indices)) {
                    for (const entry of metadata.visibilitySnapshot.indices) {
                        if (!isRecord(entry) || typeof entry.id !== 'string' || !Array.isArray(entry.afterLinks)
                            || !Number.isSafeInteger(entry.revision)) continue;
                        const indexRef = contentRef(deps.db, 'indice', safeId(entry.id));
                        const indexMetadataRef = metadataRef(deps.db, 'indice', entry.id);
                        const [indexSnap, indexMetaSnap] = await Promise.all([transaction.get(indexRef), transaction.get(indexMetadataRef)]);
                        const indexRaw = dataOf(indexSnap);
                        const indexMetadata = metadataDefaults('indice', entry.id, dataOf(indexMetaSnap));
                        if (!indexRaw || indexRaw.decouvert !== true || indexMetadata.revision !== entry.revision
                            || !same(normalizeLinks(indexRaw.pnjsLies ?? []), normalizeLinks(entry.afterLinks))) continue;
                        const endpointIds = normalizeLinks(entry.afterLinks).filter(linkedId => linkedId !== command.id);
                        const endpointValues = await Promise.all(endpointIds.map(linkedId => transaction.get(contentRef(deps.db, 'pnj', linkedId))));
                        if (endpointValues.some(endpoint => dataOf(endpoint)?.visibleJoueurs !== true || dataOf(endpoint)?.suppressionEnCours === true)) continue;
                        const restoredLinks = normalizeLinks([...entry.afterLinks, command.id]);
                        dependencies.push({ kind: 'indice', id: entry.id, raw: indexRaw, data: readPublic('indice', entry.id, indexRaw),
                            ref: indexRef, metaRef: indexMetadataRef, metadata: indexMetadata, action: 'restore-index', restoredLinks });
                    }
                }
            }
            if (4 + (reciprocal ? 3 : 0) + dependencies.length * 3 > CONTRIBUTION_LIMITS.transactionWrites) fail('cascade trop volumineuse', 'failed-precondition', { kind: 'cascade-too-large' });

            const now = deps.timestamp();
            const changes = {};
            const write = {};
            for (const field of Object.keys(command.changes)) {
                const before = Object.hasOwn(raw, field) ? raw[field] : null;
                const after = next[field] ?? null;
                if (!same(before, after)) { changes[field] = { before, after }; write[field] = next[field]; }
            }
            if (command.kind === 'pnj' && Object.hasOwn(write, 'groupes')) write.groupe = next.groupe;
            if (Object.keys(changes).length === 0) fail('aucune modification à enregistrer');
            transaction.update(docRef, { ...write, updatedAt: now });
            const visibilitySnapshot = visibilityTurningOff ? {
                relations: dependencies.filter(item => item.kind === 'relation').map(item => ({ id: item.id, revision: item.metadata.revision + 1 })),
                indices: dependencies.filter(item => item.kind === 'indice').map(item => ({
                    id: item.id, afterLinks: normalizeLinks(item.data.pnjsLies ?? []).filter(linkedId => linkedId !== command.id),
                    revision: item.metadata.revision + 1,
                })),
            } : visibilityTurningOn ? { relations: [], indices: [] } : metadata.visibilitySnapshot;
            transaction.set(docMetaRef, { ...metadata, ...(visibilitySnapshot ? { visibilitySnapshot } : {}),
                ...(reciprocal ? { reciprocalId: reciprocal.id } : {}), revision: metadata.revision + 1, state: 'active', updatedAt: now });
            if (consumedReservation) transaction.set(consumedReservation.ref, { ...consumedReservation.value, updatedAt: now });
            if (reciprocal) {
                const reciprocalChanges = Object.fromEntries([...RELATION_FIELDS].filter(field => !same(reciprocal.raw[field] ?? null, reciprocal.next[field] ?? null))
                    .map(field => [field, { before: reciprocal.raw[field] ?? null, after: reciprocal.next[field] ?? null }]));
                transaction.update(reciprocal.ref, { ...reciprocal.next, updatedAt: now });
                transaction.set(reciprocal.metaRef, { ...reciprocal.metadata, revision: reciprocal.metadata.revision + 1,
                    reciprocalId: command.id, state: 'active', updatedAt: now });
                transaction.set(historyRef(deps.db, 'relation', reciprocal.id, `${command.operationId}_reciprocal`), {
                    kind: 'relation', operationId: command.operationId, actorUid: user.uid, role: 'mj', action: 'mj-update',
                    revision: reciprocal.metadata.revision + 1, changes: reciprocalChanges, createdAt: now,
                });
            }
            for (const dependency of dependencies) {
                const fields = dependency.kind === 'relation' ? { visibleJoueurs: visibilityTurningOn }
                    : dependency.action === 'restore-index' ? { pnjsLies: dependency.restoredLinks }
                        : { pnjsLies: dependency.data.pnjsLies.filter(id => id !== command.id) };
                const depChanges = Object.fromEntries(Object.entries(fields).map(([field, after]) => [field, { before: dependency.raw[field] ?? null, after }]));
                const revision = dependency.metadata.revision + 1;
                transaction.update(dependency.ref, { ...fields, updatedAt: now });
                transaction.set(dependency.metaRef, { ...dependency.metadata, revision, state: 'active', updatedAt: now });
                transaction.set(historyRef(deps.db, dependency.kind, dependency.id, `${command.operationId}_${dependency.id}`), {
                    kind: dependency.kind, operationId: command.operationId, actorUid: user.uid, role: 'mj', action: 'visibility-cascade', revision, changes: depChanges, createdAt: now,
                });
            }
            const response = { kind: command.kind, id: command.id, operationId: command.operationId, revision: metadata.revision + 1, summary: safeSummary(command.kind, readPublic(command.kind, command.id, next)), cascaded: dependencies.length };
            transaction.set(historyRef(deps.db, command.kind, command.id, command.operationId), {
                kind: command.kind, operationId: command.operationId, actorUid: user.uid, role: 'mj', action: 'mj-update', revision: response.revision, changes, createdAt: now,
            });
            transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
            return response;
        });
    } catch (error) { cleanPrivateError(error); }
}

/** Apply one public create/update with revision merge, private metadata and a receipt. */
export async function mutatePublicContent(rawCommand, request, deps) {
    const command = validateCommand(rawCommand);
    validateChanges(command);
    const user = identity(request);
    if (!deps?.db || typeof deps.timestamp !== 'function') fail('service indisponible', 'internal');
    const operationHash = hashCommand(command, user.uid);
    const requestedId = command.id;
    const mainRef = requestedId ? contentRef(deps.db, command.kind, requestedId) : null;
    const metaRef = requestedId ? metadataRef(deps.db, command.kind, requestedId) : null;
    const accessRef = campaignRef(deps.db);
    const opRef = receiptRef(deps.db, command.operationId);
    const lockRef = deletionLockRef(deps.db);

    try {
        return await deps.db.runTransaction(async transaction => {
            const [accessSnap, receiptSnap] = await Promise.all([transaction.get(accessRef), transaction.get(opRef)]);
            const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
            const replay = verifyReceipt(receiptSnap, operationHash);
            if (replay) return replay;
            const lockSnap = await transaction.get(lockRef);
            if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });

            let id = requestedId;
            if (command.kind === 'relation' && command.action === 'create' && !id) {
                const normalizedCreate = normalizePayload('relation', command.changes, 'pending', { creating: true });
                id = relationDocumentId({ ...normalizedCreate, visibleJoueurs: true });
            }
            if (!id) fail('identifiant requis');
            const documentRef = requestedId ? mainRef : contentRef(deps.db, command.kind, id);
            const documentMetadataRef = requestedId ? metaRef : metadataRef(deps.db, command.kind, id);
            const [contentSnap, metadataSnap] = await Promise.all([transaction.get(documentRef), transaction.get(documentMetadataRef)]);
            const oldRaw = dataOf(contentSnap);
            const metadata = metadataDefaults(command.kind, id, dataOf(metadataSnap));
            let nextPublic, nextRaw, changed, newRevision, ownerUid, safeIndexAfter;
            const reservationWrites = [];
            const reservationDescriptors = [];

            if (command.action === 'create') {
                if (role !== 'mj' && ((command.kind === 'pnj' && Object.hasOwn(command.changes, 'visibleJoueurs'))
                    || (command.kind === 'indice' && Object.hasOwn(command.changes, 'decouvert')))) {
                    fail('le statut de visibilité est réservé au MJ', 'permission-denied');
                }
                if (oldRaw || (exists(metadataSnap) && metadata.state !== 'reserved')) fail('identifiant déjà utilisé', 'already-exists');
                if (exists(metadataSnap) && (dataOf(metadataSnap).state !== 'reserved'
                    || dataOf(metadataSnap).ownerUid !== user.uid)) fail('identifiant déjà réservé', 'already-exists');
                const createFields = { ...command.changes };
                delete createFields.visibleJoueurs;
                delete createFields.decouvert;
                const fields = normalizePayload(command.kind, createFields, id, { creating: true });
                if (command.kind === 'pnj' && fields.imagePath != null) reservationDescriptors.push(imageReservationFromPath('pnj', id, fields.imagePath, deps.db));
                if (command.kind === 'indice' && fields.imagePath != null) reservationDescriptors.push(imageReservationFromPath('indice', id, fields.imagePath, deps.db));
                if (command.kind === 'pnj') nextPublic = { ...fields, visibleJoueurs: role === 'mj' ? command.changes.visibleJoueurs !== false : true };
                else if (command.kind === 'indice') nextPublic = { ...fields, decouvert: role === 'mj' ? command.changes.decouvert !== false : true };
                else nextPublic = { ...fields, visibleJoueurs: true };
                nextRaw = nextPublic;
                changed = Object.fromEntries(Object.entries(nextPublic).map(([key, value]) => [key, { before: null, after: value }]));
                newRevision = 1;
                ownerUid = user.uid;
            } else {
                if (!oldRaw) fail('contenu introuvable', 'not-found');
                assertCurrentPublic(command.kind, oldRaw);
                assertBaseRevision(command, metadata);
                if (command.baseRevision === metadata.revision) {
                    // Exact-base writes may omit before values only if the client sent them anyway.
                }
                const currentPublic = readPublic(command.kind, id, oldRaw);
                delete currentPublic.id;
                delete currentPublic.visibleJoueurs;
                delete currentPublic.decouvert;
                delete currentPublic.reciprocalId;
                delete currentPublic.reciprocalRevision;
                const oldIndexLinks = command.kind === 'indice' ? currentPublic.pnjsLies : [];
                const candidateIndexLinks = command.kind === 'indice' && Array.isArray(command.changes.pnjsLies)
                    ? normalizeLinks(command.changes.pnjsLies) : [];
                const visibleIndexLinks = command.kind === 'indice'
                    ? await getVisiblePnjIds(transaction, deps.db, [...new Set([...oldIndexLinks, ...candidateIndexLinks])]) : [];
                const hiddenIndexLinks = oldIndexLinks.filter(linkedId => !visibleIndexLinks.includes(linkedId));
                if (command.kind === 'indice') currentPublic.pnjsLies = oldIndexLinks.filter(linkedId => visibleIndexLinks.includes(linkedId));
                if (command.kind === 'indice') safeIndexAfter = currentPublic.pnjsLies;
                const merged = threeWay(currentPublic, command.changes, command.baseValues, metadata.revision);
                const fields = normalizePayload(command.kind, merged, id);
                nextPublic = { ...currentPublic, ...fields };
                if (command.kind === 'pnj') {
                    nextPublic.groupes = normalizeGroups(nextPublic.groupes ?? [nextPublic.groupe ?? '']);
                    nextPublic.groupe = nextPublic.groupes[0] ?? '';
                    nextPublic.visibleJoueurs = true;
                } else if (command.kind === 'indice') {
                    const submittedLinks = normalizeLinks(nextPublic.pnjsLies ?? []);
                    const visibleSubmittedLinks = await getVisiblePnjIds(transaction, deps.db, submittedLinks);
                    if (visibleSubmittedLinks.length !== submittedLinks.length) fail('une enquête ne peut viser qu’un PNJ public', 'failed-precondition', { kind: 'endpoint-unavailable' });
                    safeIndexAfter = submittedLinks;
                    nextPublic.pnjsLies = normalizeLinks([...hiddenIndexLinks, ...submittedLinks]);
                    nextPublic.decouvert = true;
                } else nextPublic.visibleJoueurs = true;
                nextRaw = { ...oldRaw, ...fields };
                if (command.kind === 'indice') nextRaw.pnjsLies = nextPublic.pnjsLies;
                if (command.kind === 'pnj' && (Object.hasOwn(fields, 'groupes') || Object.hasOwn(fields, 'groupe'))) {
                    nextRaw.groupes = nextPublic.groupes;
                    nextRaw.groupe = nextPublic.groupe;
                }
                if (Object.hasOwn(fields, 'imagePath') && !same(fields.imagePath, oldRaw.imagePath ?? null)) {
                    if (fields.imagePath !== null) reservationDescriptors.push(imageReservationFromPath(command.kind, id, fields.imagePath, deps.db));
                }
                const auditPublic = command.kind === 'indice' ? { ...nextPublic, pnjsLies: safeIndexAfter } : nextPublic;
                changed = changedFields(currentPublic, auditPublic, command.kind === 'pnj' ? PNJ_FIELDS : command.kind === 'indice' ? INDICE_FIELDS : RELATION_FIELDS);
                newRevision = metadata.revision + 1;
                ownerUid = metadata.ownerUid;
            }

            if (command.kind === 'relation') {
                return await mutateRelationInTransaction({ transaction, deps, command, user, role, operationHash, id,
                    documentRef, documentMetadataRef, contentSnap, metadataSnap, oldRaw, metadata, nextPublic, nextRaw,
                    changed, newRevision, ownerUid, accessSnap, receiptSnap, reservationWrites, reservationDescriptors, opRef });
            }

            const endpointIds = command.kind === 'indice' && command.action === 'create' ? normalizeLinks(nextPublic.pnjsLies ?? []) : [];
            const endpointSnapshots = [];
            for (const endpointId of endpointIds) endpointSnapshots.push(await transaction.get(contentRef(deps.db, 'pnj', endpointId)));
            for (const endpoint of endpointSnapshots) {
                const endpointData = dataOf(endpoint);
                if (!endpointData || endpointData.visibleJoueurs !== true || endpointData.suppressionEnCours === true) {
                    fail('une enquête ne peut viser qu’un PNJ public', 'failed-precondition', { kind: 'endpoint-unavailable' });
                }
            }
            for (const descriptor of reservationDescriptors) {
                const reservation = await checkReservation(transaction, descriptor, user.uid, { consume: true });
                if (reservation) reservationWrites.push(reservation);
            }

            const now = deps.timestamp();
            if (command.action === 'create') transaction.set(documentRef, { ...nextPublic, createdAt: now, updatedAt: now });
            else {
                const update = {};
                for (const field of Object.keys(changed)) {
                    if (field === 'imagePath' && nextPublic.imagePath === null) {
                        if (typeof deps.deleteField !== 'function') fail('suppression d’image indisponible', 'internal');
                        update.imagePath = deps.deleteField();
                    } else update[field] = field === 'imagePath' && nextPublic.imagePath === undefined ? deps.deleteField?.() : nextPublic[field];
                }
                if (command.kind === 'pnj' && ('groupe' in update || 'groupes' in update)) {
                    update.groupe = nextPublic.groupe;
                    update.groupes = nextPublic.groupes;
                }
                update.updatedAt = now;
                transaction.update(documentRef, update);
            }
            transaction.set(documentMetadataRef, {
                ...metadata,
                kind: command.kind,
                contentId: id,
                ownerUid,
                revision: newRevision,
                state: 'active',
                updatedAt: now,
                ...(command.action === 'create' ? { createdAt: now } : {}),
            });
            for (const reservation of reservationWrites) transaction.set(reservation.ref, { ...reservation.value, updatedAt: now });
            const response = { kind: command.kind, id, operationId: command.operationId, revision: newRevision, summary: safeSummary(command.kind, nextPublic) };
            transaction.set(historyRef(deps.db, command.kind, id, command.operationId), {
                kind: command.kind, operationId: command.operationId, actorUid: user.uid, role, action: command.action, revision: newRevision,
                changes: changed, createdAt: now,
            });
            transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
            return response;
        });
    } catch (error) { cleanPrivateError(error); }
}

async function mutateRelationInTransaction(args) {
    const {
        transaction, deps, command, user, role, operationHash, id, documentRef, documentMetadataRef,
        oldRaw, metadata, nextPublic, changed, newRevision, ownerUid, opRef,
    } = args;
    const currentPairId = typeof metadata.reciprocalId === 'string' ? metadata.reciprocalId : null;
    const pairId = command.action === 'create'
        ? (command.pair === true ? relationDocumentId(reverseRelation(nextPublic)) : command.reciprocalId)
        : (command.reciprocalId ?? (command.pair === true ? currentPairId : null));
    if (command.action === 'update' && currentPairId && !pairId) {
        fail('modification d’une paire réciproque doit rester atomique', 'failed-precondition', { kind: 'reciprocal-required' });
    }
    if (command.action === 'update' && pairId && !Number.isSafeInteger(command.reciprocalBaseRevision)) {
        fail('révision de la relation réciproque requise');
    }
    if (command.pair === true && !pairId) fail('relation réciproque invalide');
    if (pairId === id) fail('identifiants de relation réciproque identiques');
    let pairRef = null, pairMetadataRef = null, pairSnap = null, pairMetadataSnap = null;
    if (pairId) {
        pairRef = contentRef(deps.db, 'relation', safeId(pairId, 'relation réciproque'));
        pairMetadataRef = metadataRef(deps.db, 'relation', pairId);
        [pairSnap, pairMetadataSnap] = await Promise.all([transaction.get(pairRef), transaction.get(pairMetadataRef)]);
    }
    const endpoints = await Promise.all([nextPublic.source, nextPublic.cible].map(endpointId => transaction.get(contentRef(deps.db, 'pnj', safeId(endpointId)))));
    validateEndpoints(endpoints[0], endpoints[1]);
    const reverse = { ...reverseRelation(nextPublic), visibleJoueurs: true };
    const now = deps.timestamp();
    if (command.action === 'create') {
        if (oldRaw) fail('relation déjà existante', 'already-exists');
        if (pairSnap && exists(pairSnap)) fail('relation réciproque déjà existante', 'already-exists');
        transaction.set(documentRef, { ...nextPublic, visibleJoueurs: true, createdAt: now, updatedAt: now });
        transaction.set(documentMetadataRef, {
            kind: 'relation', contentId: id, ownerUid, revision: newRevision, state: 'active',
            ...(pairId ? { reciprocalId: pairId } : {}), createdAt: now, updatedAt: now,
        });
        if (pairRef && pairMetadataRef) {
            const pairMetadata = metadataDefaults('relation', pairId, dataOf(pairMetadataSnap));
            transaction.set(pairRef, { ...reverse, createdAt: now, updatedAt: now });
            transaction.set(pairMetadataRef, {
                ...pairMetadata, kind: 'relation', contentId: pairId, ownerUid, revision: 1, state: 'active',
                reciprocalId: id, createdAt: now, updatedAt: now,
            });
        }
    } else {
        if (!oldRaw) fail('relation introuvable', 'not-found');
        if (pairRef) {
            const pairRaw = dataOf(pairSnap);
            if (!visibleToPublic('relation', pairRaw) || !isExactReciprocal(oldRaw, pairRaw)) {
                fail('relation réciproque modifiée', 'failed-precondition', { kind: 'reciprocal-changed' });
            }
            const pairMetadata = metadataDefaults('relation', pairId, dataOf(pairMetadataSnap));
            if (command.reciprocalBaseRevision !== undefined && command.reciprocalBaseRevision !== pairMetadata.revision) {
                fail('révision réciproque modifiée', 'aborted', { kind: 'conflict', revision: pairMetadata.revision });
            }
            transaction.update(pairRef, { ...reverse, updatedAt: now });
            transaction.set(pairMetadataRef, { ...pairMetadata, reciprocalId: id, revision: pairMetadata.revision + 1, state: 'active', updatedAt: now });
            transaction.set(documentMetadataRef, { ...metadata, reciprocalId: pairId, revision: newRevision, state: 'active', updatedAt: now });
        } else transaction.set(documentMetadataRef, { ...metadata, revision: newRevision, state: 'active', updatedAt: now });
        const update = { ...nextPublic, visibleJoueurs: true, updatedAt: now };
        transaction.update(documentRef, update);
    }
    const response = {
        kind: 'relation', id, operationId: command.operationId, revision: newRevision,
        summary: safeSummary('relation', nextPublic), ...(pairId ? { reciprocalId: pairId } : {}),
    };
    transaction.set(historyRef(deps.db, 'relation', id, command.operationId), {
        kind: 'relation', operationId: command.operationId, actorUid: user.uid, role, action: command.action,
        revision: newRevision, changes: changed, createdAt: now,
    });
    transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
    return response;
}

function safePublicHistoryEvent(event, { user, role, visibleLinks }) {
    const allowedFields = event?.kind === 'pnj' ? PNJ_FIELDS : event?.kind === 'indice' ? INDICE_FIELDS : RELATION_FIELDS;
    const changes = {};
    if (isRecord(event?.changes)) {
        for (const [field, delta] of Object.entries(event.changes)) {
            if (!allowedFields.has(field) || !isRecord(delta)) continue;
            if (field === 'pnjsLies') {
                const filterLinks = value => Array.isArray(value) ? value.filter(id => typeof id === 'string' && visibleLinks.has(id)) : value;
                changes[field] = { before: filterLinks(delta.before), after: filterLinks(delta.after) };
            } else changes[field] = { before: delta.before ?? null, after: delta.after ?? null };
        }
    }
    return {
        operationId: String(event?.operationId ?? ''), kind: event?.kind, action: event?.action,
        revision: Number.isSafeInteger(event?.revision) ? event.revision : 0,
        actor: event?.actorUid === user.uid ? 'self' : 'other', role: event?.role ?? role,
        changes, createdAt: event?.createdAt ?? null,
    };
}

function operationEnvelope(raw, allowedKeys) {
    if (!isRecord(raw) || Object.keys(raw).some(key => !allowedKeys.includes(key))) fail('commande invalide');
    const command = { ...raw };
    if (!CONTRIBUTION_KINDS.includes(command.kind)) fail('type de contenu invalide');
    safeId(command.id);
    if (typeof command.operationId !== 'string' || !OPERATION_PATTERN.test(command.operationId)) fail('identifiant d’opération invalide');
    if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) fail('révision invalide');
    return command;
}

/** Read public contribution history; links and fields are allowlisted again on output. */
export async function getContentHistory(request, deps) {
    const user = identity(request);
    const { kind, id } = request?.data ?? {};
    if (!CONTRIBUTION_KINDS.includes(kind)) fail('type de contenu invalide');
    safeId(id);
    const limit = request.data.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('limite invalide');
    const [accessSnap, contentSnap] = await Promise.all([campaignRef(deps.db).get(), contentRef(deps.db, kind, id).get()]);
    const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
    if (role !== 'mj') assertCurrentPublic(kind, dataOf(contentSnap));
    else if (!dataOf(contentSnap)) fail('contenu introuvable', 'not-found');
    let query = deps.db.collection(`content_history/${kind}_${id}/events`).orderBy('revision', 'desc').limit(limit);
    if (typeof request.data.cursor === 'string' && request.data.cursor) {
        const cursor = await deps.db.doc(`content_history/${kind}_${id}/events/${safeId(request.data.cursor, 'curseur')}`).get();
        if (exists(cursor)) query = query.startAfter(cursor);
    }
    const snapshot = await query.get();
    const events = snapshot.docs.map(doc => ({ ...doc.data(), kind }));
    const linkedIds = new Set();
    for (const event of events) for (const delta of Object.values(event.changes ?? {})) {
        if (event.kind === 'indice' && Array.isArray(delta?.before)) delta.before.forEach(link => typeof link === 'string' && linkedIds.add(link));
        if (event.kind === 'indice' && Array.isArray(delta?.after)) delta.after.forEach(link => typeof link === 'string' && linkedIds.add(link));
    }
    const visibleLinks = new Set();
    for (const linkedId of linkedIds) {
        const linked = dataOf(await contentRef(deps.db, 'pnj', linkedId).get());
        if (role === 'mj' || (linked?.visibleJoueurs === true && linked.suppressionEnCours !== true)) visibleLinks.add(linkedId);
    }
    return {
        events: events.map(event => safePublicHistoryEvent(event, { user, role, visibleLinks })),
        nextCursor: snapshot.docs.length === limit ? snapshot.docs.at(-1).id : null,
    };
}

/** Return safe trash summaries only; the saved public document is never sent by this endpoint. */
export async function listContentTrash(request, deps) {
    const user = identity(request);
    const access = dataOf(await campaignRef(deps.db).get()) ?? {};
    const role = requireContributor(user, access);
    const limit = request?.data?.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('limite invalide');
    let query = deps.db.collection('content_trash').where('state', '==', 'trashed').orderBy('createdAt', 'desc');
    if (role !== 'mj') query = query.where('ownerUid', '==', user.uid).where('ownerCanRestore', '==', true);
    if (typeof request?.data?.cursor === 'string' && request.data.cursor) {
        const cursor = await deps.db.doc(`content_trash/${safeId(request.data.cursor, 'curseur')}`).get();
        if (exists(cursor)) query = query.startAfter(cursor);
    }
    const snapshot = await query.limit(limit).get();
    return {
        entries: snapshot.docs.map(doc => {
            const value = doc.data();
            return {
                id: value.contentId, kind: value.kind, revision: value.revision,
                summary: value.summary, createdAt: value.createdAt,
                ownerCanRestore: value.ownerCanRestore === true,
                canRestore: role === 'mj' || (value.ownerUid === user.uid && value.ownerCanRestore === true),
            };
        }),
        nextCursor: snapshot.docs.length === limit ? snapshot.docs.at(-1).id : null,
    };
}

/** Liste les nettoyages Storage encore relançables, sans exposer les chemins privés. */
export async function listPendingPurgeCleanups(request, deps) {
    const user = identity(request);
    const access = dataOf(await campaignRef(deps.db).get()) ?? {};
    const role = requireContributor(user, access);
    if (role !== 'mj') fail('nettoyages réservés au MJ', 'permission-denied');
    const limit = request?.data?.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail('limite invalide');
    // L’ordre implicite par identifiant permet le curseur sans index composite ajouté.
    let query = deps.db.collection('content_purge_audit').where('resumeAvailable', '==', true);
    if (typeof request?.data?.cursor === 'string' && request.data.cursor) {
        const cursor = await deps.db.doc(`content_purge_audit/${safeId(request.data.cursor, 'curseur')}`).get();
        if (exists(cursor)) query = query.startAfter(cursor);
    }
    const snapshot = await query.limit(limit).get();
    return {
        entries: snapshot.docs.map(doc => {
            const value = doc.data();
            return {
                operationId: value.operationId,
                kind: value.kind,
                id: value.contentId,
                summary: typeof value.summary === 'string' ? value.summary
                    : [value.summary?.nom, value.summary?.titre, value.summary?.label].find(item => typeof item === 'string') ?? 'Contenu purgé',
                baseRevision: value.baseRevision,
                cleanup: value.cleanup,
                createdAt: value.createdAt,
            };
        }),
        nextCursor: snapshot.docs.length === limit ? snapshot.docs.at(-1).id : null,
    };
}

/** Atomically remove public content and bounded public dependencies into protected trash. */
export async function trashPublicContent(rawCommand, request, deps) {
    const command = operationEnvelope(rawCommand, ['kind', 'id', 'operationId', 'baseRevision']);
    const user = identity(request);
    const operationHash = hashCommand(command, user.uid);
    const mainRef = contentRef(deps.db, command.kind, command.id);
    const metaRef = metadataRef(deps.db, command.kind, command.id);
    const trashDocumentRef = trashRef(deps.db, command.kind, command.id);
    const opRef = receiptRef(deps.db, command.operationId);
    try {
        return await deps.db.runTransaction(async transaction => {
            const [accessSnap, receiptSnap, lockSnap, contentSnap, metadataSnap, trashSnap] = await Promise.all([
                transaction.get(campaignRef(deps.db)), transaction.get(opRef), transaction.get(deletionLockRef(deps.db)),
                transaction.get(mainRef), transaction.get(metaRef), transaction.get(trashDocumentRef),
            ]);
            const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
            const replay = verifyReceipt(receiptSnap, operationHash);
            if (replay) return replay;
            if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });
            const previousTrash = dataOf(trashSnap);
            if (previousTrash?.state === 'trashed') fail('contenu déjà présent dans la corbeille', 'already-exists');
            const archiveRef = previousTrash?.state === 'restored'
                ? trashArchiveRef(deps.db, command.kind, command.id, previousTrash.revision) : null;
            const archiveSnap = archiveRef ? await transaction.get(archiveRef) : null;
            if (archiveSnap && exists(archiveSnap)) fail('archive de corbeille déjà présente', 'already-exists');
            const raw = dataOf(contentSnap);
            assertCurrentPublic(command.kind, raw);
            if (command.kind === 'relation') {
                const endpoints = await Promise.all([raw.source, raw.cible].map(id => transaction.get(contentRef(deps.db, 'pnj', safeId(id)))));
                try { validateEndpoints(endpoints[0], endpoints[1]); }
                catch { fail('contenu public indisponible', 'not-found'); }
            }
            const metadata = metadataDefaults(command.kind, command.id, dataOf(metadataSnap));
            if (command.baseRevision !== metadata.revision) fail('révision modifiée', 'aborted', { kind: 'conflict', revision: metadata.revision });
            if (role !== 'mj' && metadata.ownerUid !== user.uid) fail('suppression réservée au propriétaire ou MJ', 'permission-denied');
            const dependencyEntries = [];
            if (command.kind === 'pnj') {
                const [outgoingSnap, incomingSnap, indexSnap] = await Promise.all([
                    transaction.get(deps.db.collection('relations').where('source', '==', command.id).limit(451)),
                    transaction.get(deps.db.collection('relations').where('cible', '==', command.id).limit(451)),
                    transaction.get(deps.db.collection('indices').where('pnjsLies', 'array-contains', command.id).limit(451)),
                ]);
                if ([outgoingSnap, incomingSnap, indexSnap].some(result => result.size >= 451)) {
                    fail('cascade trop volumineuse ou tronquée', 'failed-precondition', { kind: 'cascade-too-large' });
                }
                const related = new Map();
                for (const doc of [...outgoingSnap.docs, ...incomingSnap.docs]) {
                    const value = doc.data();
                    if (value.visibleJoueurs === true) related.set(doc.id, { kind: 'relation', id: doc.id, data: publicSnapshot('relation', value) });
                }
                for (const doc of indexSnap.docs) {
                    const value = doc.data();
                    if (value.decouvert === true) related.set(`indice_${doc.id}`, { kind: 'indice', id: doc.id, data: publicSnapshot('indice', value) });
                }
                dependencyEntries.push(...related.values());
                if (dependencyEntries.length > CONTRIBUTION_LIMITS.dependencies) fail('cascade trop volumineuse', 'failed-precondition', { kind: 'cascade-too-large', dependencies: dependencyEntries.length });
                for (const dependency of dependencyEntries) {
                    dependency.metaRef = metadataRef(deps.db, dependency.kind, dependency.id);
                    dependency.metaSnap = await transaction.get(dependency.metaRef);
                    dependency.baseRevision = metadataDefaults(dependency.kind, dependency.id, dataOf(dependency.metaSnap)).revision;
                }
            } else if (command.kind === 'relation') {
                const reciprocalId = safeId(metadata.reciprocalId ?? relationDocumentId(reverseRelation(raw)), 'relation réciproque');
                const reciprocalRef = contentRef(deps.db, 'relation', reciprocalId);
                const reciprocalMetadataRef = metadataRef(deps.db, 'relation', reciprocalId);
                const [reciprocalSnap, reciprocalMetaSnap] = await Promise.all([
                    transaction.get(reciprocalRef), transaction.get(reciprocalMetadataRef),
                ]);
                const reciprocal = dataOf(reciprocalSnap);
                if (visibleToPublic('relation', reciprocal) && isExactReciprocal(raw, reciprocal)) {
                    dependencyEntries.push({ kind: 'relation', id: reciprocalId, data: publicSnapshot('relation', reciprocal), metaRef: reciprocalMetadataRef,
                        metaSnap: reciprocalMetaSnap, baseRevision: metadataDefaults('relation', reciprocalId, dataOf(reciprocalMetaSnap)).revision });
                }
            }
            // Reserve room for the same cascade to restore atomically later: two writes per dependency.
            const plannedWrites = 5 + (archiveRef ? 1 : 0) + dependencyEntries.length * 2;
            if (plannedWrites > CONTRIBUTION_LIMITS.transactionWrites) fail('cascade trop volumineuse', 'failed-precondition', { kind: 'cascade-too-large', dependencies: dependencyEntries.length });

            const now = deps.timestamp();
            const dependencies = dependencyEntries.map(({ kind, id, data, baseRevision }) => ({
                kind, contentId: id, data, baseRevision, trashedRevision: baseRevision + 1,
                action: kind === 'relation' ? 'deleted' : 'unlinked',
                ...(kind === 'indice' ? { afterLinks: normalizeLinks(data.pnjsLies ?? []).filter(linkedId => linkedId !== command.id) } : {}),
            }));
            const trashValue = {
                kind: command.kind, contentId: command.id, ownerUid: metadata.ownerUid,
                ownerCanRestore: true, state: 'trashed', revision: metadata.revision + 1,
                baseRevision: metadata.revision, data: publicSnapshot(command.kind, raw), dependencies,
                summary: safeSummary(command.kind, readPublic(command.kind, command.id, raw)),
                createdAt: now, trashedBy: user.uid, dependencyCount: dependencyEntries.length,
            };
            if (Buffer.byteLength(canonical(trashValue), 'utf8') > CONTRIBUTION_LIMITS.trashBytes) {
                fail('archive de corbeille trop volumineuse', 'failed-precondition', { kind: 'cascade-too-large', dependencies: dependencyEntries.length });
            }
            transaction.delete(mainRef);
            transaction.set(metaRef, { ...metadata, state: 'trashed', revision: metadata.revision + 1, updatedAt: now });
            if (archiveRef) transaction.set(archiveRef, { ...previousTrash, rootKey: `${command.kind}_${command.id}`, state: 'archived', archivedAt: now });
            transaction.set(trashDocumentRef, trashValue);
            for (const dependency of dependencyEntries) {
                const depRef = contentRef(deps.db, dependency.kind, dependency.id);
                const depMetadata = metadataDefaults(dependency.kind, dependency.id, dataOf(dependency.metaSnap));
                if (dependency.kind === 'relation') {
                    transaction.delete(depRef);
                    transaction.set(dependency.metaRef, { ...depMetadata, state: 'trashed-cascade', revision: dependency.baseRevision + 1, updatedAt: now });
                } else {
                    const storedDependency = dependencies.find(item => item.kind === dependency.kind && item.contentId === dependency.id);
                    transaction.update(depRef, { pnjsLies: storedDependency.afterLinks, updatedAt: now });
                    transaction.set(dependency.metaRef, { ...depMetadata, state: 'active', revision: dependency.baseRevision + 1, updatedAt: now });
                }
            }
            const response = { kind: command.kind, id: command.id, operationId: command.operationId, revision: metadata.revision + 1, state: 'trashed' };
            transaction.set(historyRef(deps.db, command.kind, command.id, command.operationId), {
                kind: command.kind, operationId: command.operationId, action: 'trash', actorUid: user.uid, role,
                revision: response.revision, changes: {}, createdAt: now,
            });
            transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
            return response;
        });
    } catch (error) { cleanPrivateError(error); }
}

/** Restore only missing root/dependencies at the versions recorded by the trash operation. */
export async function restorePublicContent(rawCommand, request, deps) {
    const command = operationEnvelope(rawCommand, ['kind', 'id', 'operationId', 'baseRevision']);
    const user = identity(request);
    const operationHash = hashCommand(command, user.uid);
    const mainRef = contentRef(deps.db, command.kind, command.id);
    const metaRef = metadataRef(deps.db, command.kind, command.id);
    const trashDocumentRef = trashRef(deps.db, command.kind, command.id);
    const opRef = receiptRef(deps.db, command.operationId);
    try {
        return await deps.db.runTransaction(async transaction => {
            const [accessSnap, receiptSnap, lockSnap, contentSnap, metadataSnap, trashSnap] = await Promise.all([
                transaction.get(campaignRef(deps.db)), transaction.get(opRef), transaction.get(deletionLockRef(deps.db)),
                transaction.get(mainRef), transaction.get(metaRef), transaction.get(trashDocumentRef),
            ]);
            const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
            const replay = verifyReceipt(receiptSnap, operationHash);
            if (replay) return replay;
            if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });
            const trash = dataOf(trashSnap);
            if (!trash || trash.state !== 'trashed') fail('entrée de corbeille indisponible', 'not-found');
            if (role !== 'mj' && (trash.ownerUid !== user.uid || trash.ownerCanRestore !== true)) fail('restauration interdite', 'permission-denied');
            if (command.baseRevision !== trash.revision) fail('révision de corbeille modifiée', 'aborted', { kind: 'conflict', revision: trash.revision });
            if (exists(contentSnap)) fail('le contenu existe déjà; restauration sans écrasement refusée', 'already-exists');
            const metadata = dataOf(metadataSnap);
            if (!metadata || metadata.state !== 'trashed' || metadata.revision !== trash.revision) fail('métadonnées de restauration modifiées', 'failed-precondition', { kind: 'restore-stale' });
            if (command.kind === 'relation') {
                const endpoints = await Promise.all([trash.data.source, trash.data.cible].map(id => transaction.get(contentRef(deps.db, 'pnj', safeId(id)))));
                try { validateEndpoints(endpoints[0], endpoints[1]); }
                catch { fail('extrémité de relation indisponible', 'failed-precondition', { kind: 'endpoint-unavailable' }); }
            }
            const dependencyEntries = Array.isArray(trash.dependencies) ? trash.dependencies : [];
            const dependencies = [];
            for (const dep of dependencyEntries) {
                const ref = contentRef(deps.db, dep.kind, dep.contentId);
                const depMeta = metadataRef(deps.db, dep.kind, dep.contentId);
                const [currentSnap, currentMetaSnap] = await Promise.all([transaction.get(ref), transaction.get(depMeta)]);
                let endpointsValid = true;
                if (dep.action === 'deleted') {
                    const endpointStates = await Promise.all([dep.data.source, dep.data.cible].map(async endpointId => {
                        if (command.kind === 'pnj' && endpointId === command.id) return trash.data;
                        return dataOf(await transaction.get(contentRef(deps.db, 'pnj', safeId(endpointId))));
                    }));
                    endpointsValid = endpointStates.every(endpoint => endpoint?.visibleJoueurs === true && endpoint.suppressionEnCours !== true);
                }
                dependencies.push({ ref, metaRef: depMeta, meta: dataOf(currentMetaSnap), current: dataOf(currentSnap), data: dep, endpointsValid });
            }
            if (5 + dependencies.length * 2 > CONTRIBUTION_LIMITS.transactionWrites) fail('restauration trop volumineuse', 'failed-precondition', { kind: 'cascade-too-large' });
            const now = deps.timestamp();
            const restoredRoot = { ...trash.data, updatedAt: now };
            if (command.kind === 'pnj' || command.kind === 'relation') restoredRoot.visibleJoueurs = true;
            if (command.kind === 'indice') restoredRoot.decouvert = true;
            transaction.set(mainRef, restoredRoot);
            transaction.set(metaRef, { ...metadata, state: 'active', revision: metadata.revision + 1, updatedAt: now });
            let restoredDependencies = 0, skippedDependencies = 0;
            for (const dependency of dependencies) {
                if (dependency.data.action === 'deleted') {
                    if (dependency.endpointsValid && !dependency.current && dependency.meta?.state === 'trashed-cascade'
                        && dependency.meta.revision === dependency.data.trashedRevision) {
                        transaction.set(dependency.ref, { ...dependency.data.data, visibleJoueurs: true, updatedAt: now });
                        transaction.set(dependency.metaRef, { ...dependency.meta, state: 'active', revision: dependency.data.trashedRevision + 1, updatedAt: now });
                        restoredDependencies++;
                    } else skippedDependencies++;
                } else if (dependency.current && dependency.meta?.state === 'active'
                    && dependency.meta.revision === dependency.data.trashedRevision
                    && same(normalizeLinks(dependency.current.pnjsLies ?? []), dependency.data.afterLinks ?? [])) {
                    const currentLinks = normalizeLinks(dependency.current.pnjsLies ?? []);
                    const links = normalizeLinks([...currentLinks, command.id]);
                    transaction.update(dependency.ref, { pnjsLies: links, updatedAt: now });
                    transaction.set(dependency.metaRef, { ...dependency.meta, revision: dependency.meta.revision + 1, updatedAt: now });
                    restoredDependencies++;
                } else skippedDependencies++;
            }
            const response = { kind: command.kind, id: command.id, operationId: command.operationId, revision: metadata.revision + 1, state: 'active', restoredDependencies, skippedDependencies };
            transaction.set(trashDocumentRef, { ...trash, state: 'restored', restoredAt: now, restoredBy: user.uid });
            transaction.set(historyRef(deps.db, command.kind, command.id, command.operationId), { kind: command.kind, operationId: command.operationId, action: 'restore', actorUid: user.uid, role, revision: response.revision, changes: {}, createdAt: now });
            transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
            return response;
        });
    } catch (error) { cleanPrivateError(error); }
}

function addPurgeImageCandidate(candidates, kind, id, raw) {
    if (!['pnj', 'indice'].includes(kind) || typeof id !== 'string' || typeof raw?.imagePath !== 'string') return;
    try { validateImagePath(kind, id, raw.imagePath); }
    catch { return; }
    const descriptor = imageReservationFromPath(kind, id, raw.imagePath, { doc: path => ({ path }) });
    const candidate = { kind, id, path: raw.imagePath, reservationPath: descriptor.ref.path };
    const previous = candidates.get(candidate.path);
    if (previous && previous.reservationPath !== candidate.reservationPath) {
        candidates.set(candidate.path, { ...previous, ambiguous: true });
    } else candidates.set(candidate.path, candidate);
}

function collectPurgeImageCandidates(trashEntries) {
    const candidates = new Map();
    const unmanaged = new Set();
    for (const trash of trashEntries) {
        if (!trash || !['pnj', 'indice', 'relation'].includes(trash.kind)) continue;
        for (const record of [{ kind: trash.kind, id: trash.contentId, data: trash.data },
            ...(Array.isArray(trash.dependencies) ? trash.dependencies.map(item => ({ kind: item?.kind, id: item?.contentId, data: item?.data })) : [])]) {
            if (typeof record.data?.imagePath !== 'string' || !record.data.imagePath) continue;
            try { validateImagePath(record.kind, record.id, record.data.imagePath); }
            catch { unmanaged.add(`${record.kind}:${record.id}:${record.data.imagePath}`); }
        }
        addPurgeImageCandidate(candidates, trash.kind, trash.contentId, trash.data);
        for (const dependency of Array.isArray(trash.dependencies) ? trash.dependencies : []) {
            addPurgeImageCandidate(candidates, dependency?.kind, dependency?.contentId, dependency?.data);
        }
    }
    const all = [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path));
    return { candidates: all.slice(0, CONTRIBUTION_LIMITS.purgeImageCandidates),
        omitted: Math.max(0, all.length - CONTRIBUTION_LIMITS.purgeImageCandidates), unmanaged: unmanaged.size };
}

function toBucketPath(value, bucketName) {
    if (typeof value !== 'string') return null;
    if (/^(?:portraits|indices)\/[A-Za-z0-9_-]{1,150}\/[A-Za-z0-9_-]{1,128}\.(?:jpg|png|webp|gif|avif)$/u.test(value)) return value;
    if (typeof bucketName !== 'string' || !bucketName) return null;
    try {
        if (value.startsWith(`gs://${bucketName}/`)) return decodeURIComponent(value.slice(bucketName.length + 6));
        const url = new URL(value);
        if (url.hostname === 'storage.googleapis.com') {
            const segments = url.pathname.split('/').filter(Boolean);
            return segments[0] === bucketName ? decodeURIComponent(segments.slice(1).join('/')) : null;
        }
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/u);
        return match?.[1] === bucketName ? decodeURIComponent(match[2]) : null;
    } catch { return null; }
}

function collectReferencedImagePaths(value, bucketName, paths = new Set(), depth = 0) {
    if (depth > 12 || value === null || typeof value !== 'object') return paths;
    if (Array.isArray(value)) {
        for (const item of value) collectReferencedImagePaths(item, bucketName, paths, depth + 1);
        return paths;
    }
    for (const [key, item] of Object.entries(value)) {
        if ((key === 'imagePath' || key === 'imageUrl') && typeof item === 'string') {
            const path = toBucketPath(item, bucketName);
            if (path) paths.add(path);
        } else if (item && typeof item === 'object') collectReferencedImagePaths(item, bucketName, paths, depth + 1);
    }
    return paths;
}

function summarizePurgeCleanup(audit) {
    const paths = Array.isArray(audit?.paths) ? audit.paths : [];
    const deleted = paths.filter(item => item.state === 'deleted').length;
    const missing = paths.filter(item => item.state === 'missing').length;
    const retained = paths.filter(item => item.state === 'retained' || item.state === 'protected').length;
    const pending = paths.filter(item => item.state === 'pending' || item.state === 'deleting' || item.state === 'failed').length;
    const retryable = paths.filter(item => ['pending', 'deleting', 'failed', 'protected'].includes(item.state)).length;
    const omitted = Number.isSafeInteger(audit?.omittedCandidates) ? audit.omittedCandidates : 0;
    const unmanaged = Number.isSafeInteger(audit?.unmanagedCandidates) ? audit.unmanagedCandidates : 0;
    const status = pending > 0 ? 'pending' : retained > 0 || omitted > 0 || unmanaged > 0 ? 'retained' : 'complete';
    return { status, candidates: paths.length + omitted + unmanaged, deleted, missing, retained: retained + omitted + unmanaged, pending, retryable };
}

function isStorageNotFound(error) {
    return error?.code === 404 || error?.code === '404' || error?.code === 'storage/object-not-found';
}

async function runPurgeImageCleanup(operationId, request, deps) {
    const auditRef = purgeAuditRef(deps.db, operationId);
    const user = identity(request);
    const bucketName = deps.bucket?.name;
    const selection = await deps.db.runTransaction(async transaction => {
        const toDelete = [];
        const [accessSnap, auditSnap] = await Promise.all([
            transaction.get(campaignRef(deps.db)), transaction.get(auditRef),
        ]);
        const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
        if (role !== 'mj') fail('nettoyage Storage réservé au MJ', 'permission-denied');
        const audit = dataOf(auditSnap);
        if (!audit) return { audit: null, toDelete: [] };
        const paths = Array.isArray(audit.paths) ? audit.paths.map(item => ({ ...item })) : [];
        const nowMs = Date.now();
        const indexes = paths.map((item, index) => ({ item, index }))
            .filter(({ item }) => ['pending', 'failed', 'protected'].includes(item.state)
                || (item.state === 'deleting' && (!Number.isFinite(item.cleanupLeaseUntil) || item.cleanupLeaseUntil <= nowMs)))
            .slice(0, CONTRIBUTION_LIMITS.purgeImageBatch);
        if (!indexes.length) return { audit, toDelete };

        const inventoryCollections = ['pnjs', 'indices', 'content_trash', 'content_trash_archive'];
        const inventorySnapshots = await Promise.all(inventoryCollections.map(name => transaction.get(
            deps.db.collection(name).limit(CONTRIBUTION_LIMITS.purgeReferenceScan))));
        const scanComplete = inventorySnapshots.every(snapshot => snapshot.size < CONTRIBUTION_LIMITS.purgeReferenceScan);
        const referenced = new Set();
        for (const snapshot of inventorySnapshots) {
            for (const doc of snapshot.docs) collectReferencedImagePaths(doc.data(), bucketName, referenced);
        }
        const reservationSnapshots = await Promise.all(indexes.map(({ item }) => transaction.get(
            deps.db.collection('content_image_reservations').where('path', '==', item.path).limit(3))));
        const cleanupAttemptId = randomUUID();
        const withoutLease = item => {
            const copy = { ...item };
            delete copy.cleanupAttemptId;
            delete copy.cleanupLeaseUntil;
            return copy;
        };
        for (let offset = 0; offset < indexes.length; offset++) {
            const { item, index } = indexes[offset];
            if (item.state === 'retained') continue;
            if (!scanComplete) {
                paths[index] = { ...withoutLease(item), state: 'protected', reason: 'reference-scan-limit' };
                continue;
            }
            const reservationDocs = reservationSnapshots[offset].docs;
            const ownReservation = reservationDocs.find(doc => doc.ref.path === item.reservationPath);
            const reservation = ownReservation?.data();
            if (!reservation || reservation.path !== item.path || reservation.kind !== item.kind
                || !['consumed', 'purging'].includes(reservation.state) || item.ambiguous) {
                paths[index] = { ...withoutLease(item), state: 'retained', reason: 'reservation-unverified' };
                continue;
            }
            const anotherReservation = reservationDocs.some(doc => doc.ref.path !== item.reservationPath);
            if (anotherReservation || referenced.has(item.path)) {
                paths[index] = { ...withoutLease(item), state: 'protected', reason: anotherReservation ? 'reservation-reference' : 'content-reference' };
                continue;
            }
            paths[index] = { ...item, state: 'deleting', reason: null, cleanupAttemptId,
                cleanupLeaseUntil: nowMs + 30_000 };
            toDelete.push({ ...item, index, cleanupAttemptId });
        }
        const cleanup = summarizePurgeCleanup({ ...audit, paths });
        const nextAudit = { ...audit, paths, cleanup, resumeAvailable: cleanup.retryable > 0, updatedAt: deps.timestamp() };
        transaction.set(auditRef, nextAudit);
        return { audit: nextAudit, toDelete };
    });
    if (!selection?.audit) return { status: 'not-tracked', candidates: 0, deleted: 0, missing: 0, retained: 0, pending: 0, retryable: 0 };

    const outcomes = await Promise.all(selection.toDelete.map(async item => {
        try {
            if (!deps.bucket?.file) return { index: item.index, cleanupAttemptId: item.cleanupAttemptId, state: 'failed', reason: 'storage-unavailable' };
            await deps.bucket.file(item.path).delete({ ignoreNotFound: true });
            return { index: item.index, cleanupAttemptId: item.cleanupAttemptId, state: 'deleted', reason: null };
        } catch (error) {
            if (isStorageNotFound(error)) return { index: item.index, cleanupAttemptId: item.cleanupAttemptId, state: 'missing', reason: null };
            return { index: item.index, cleanupAttemptId: item.cleanupAttemptId, state: 'failed', reason: 'storage-unavailable' };
        }
    }));
    const completedAudit = await deps.db.runTransaction(async transaction => {
        const [auditSnap, trashSnap, receiptSnap] = await Promise.all([
            transaction.get(auditRef),
            transaction.get(trashRef(deps.db, selection.audit.kind, selection.audit.contentId)),
            transaction.get(receiptRef(deps.db, operationId)),
        ]);
        const currentAudit = dataOf(auditSnap);
        if (!currentAudit) return selection.audit;
        const paths = Array.isArray(currentAudit.paths) ? currentAudit.paths.map(item => ({ ...item })) : [];
        for (const outcome of outcomes) {
            const current = paths[outcome.index];
            if (current?.state !== 'deleting' || current.cleanupAttemptId !== outcome.cleanupAttemptId) continue;
            const { cleanupAttemptId, cleanupLeaseUntil, ...cleanCurrent } = current;
            paths[outcome.index] = { ...cleanCurrent, state: outcome.state, reason: outcome.reason };
        }
        const cleanup = summarizePurgeCleanup({ ...currentAudit, paths });
        const nextAudit = { ...currentAudit, paths, cleanup, resumeAvailable: cleanup.retryable > 0, updatedAt: deps.timestamp() };
        transaction.set(auditRef, nextAudit);
        const trash = dataOf(trashSnap);
        if (trash?.state === 'purged' && trash.purgeAuditId === operationId) {
            transaction.set(trashRef(deps.db, selection.audit.kind, selection.audit.contentId), { ...trash, cleanupStatus: cleanup.status, cleanupUpdatedAt: deps.timestamp() });
        }
        const receipt = dataOf(receiptSnap);
        if (receipt?.operationId === operationId) transaction.set(receiptRef(deps.db, operationId), {
            ...receipt, response: { ...receipt.response, cleanup },
        });
        return nextAudit;
    });
    return summarizePurgeCleanup(completedAudit);
}

/** Permanent purge removes Firestore snapshots first, then cleans only proven-unreferenced managed images. */
export async function purgePublicContent(rawCommand, request, deps) {
    const command = operationEnvelope(rawCommand, ['kind', 'id', 'operationId', 'baseRevision']);
    const user = identity(request);
    const operationHash = hashCommand(command, user.uid);
    const opRef = receiptRef(deps.db, command.operationId);
    const trashDocumentRef = trashRef(deps.db, command.kind, command.id);
    const auditRef = purgeAuditRef(deps.db, command.operationId);
    try {
        const result = await deps.db.runTransaction(async transaction => {
            const [accessSnap, receiptSnap, lockSnap, trashSnap, metadataSnap] = await Promise.all([
                transaction.get(campaignRef(deps.db)), transaction.get(opRef), transaction.get(deletionLockRef(deps.db)),
                transaction.get(trashDocumentRef), transaction.get(metadataRef(deps.db, command.kind, command.id)),
            ]);
            const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
            if (role !== 'mj') fail('purge réservé au MJ', 'permission-denied');
            const replay = verifyReceipt(receiptSnap, operationHash);
            if (replay) return replay;
            if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });
            const trash = dataOf(trashSnap);
            if (!trash || trash.state !== 'trashed') fail('entrée de corbeille indisponible', 'not-found');
            if (trash.revision !== command.baseRevision) fail('révision de corbeille modifiée', 'aborted', { kind: 'conflict', revision: trash.revision });
            const archiveSnapshot = await transaction.get(deps.db.collection('content_trash_archive')
                .where('rootKey', '==', `${command.kind}_${command.id}`).limit(CONTRIBUTION_LIMITS.transactionWrites));
            const imagePlan = collectPurgeImageCandidates([trash, ...archiveSnapshot.docs.map(doc => doc.data())]);
            const reservationRecords = await Promise.all(imagePlan.candidates.map(async candidate => {
                if (candidate.ambiguous) return { candidate, reservation: null };
                const reservationRef = deps.db.doc(candidate.reservationPath);
                const snapshot = await transaction.get(reservationRef);
                return { candidate, reservationRef, reservation: dataOf(snapshot) };
            }));
            const reservationUpdates = reservationRecords.filter(({ candidate, reservation }) => !candidate.ambiguous
                && reservation?.path === candidate.path && reservation.kind === candidate.kind
                && ['consumed', 'purging'].includes(reservation.state));
            if (archiveSnapshot.size + 5 + reservationUpdates.length > CONTRIBUTION_LIMITS.transactionWrites) {
                fail('archives trop nombreuses pour un purge atomique', 'failed-precondition', { kind: 'archive-purge-too-large' });
            }
            const candidateRecords = reservationRecords.map(({ candidate, reservation }) => {
                if (!reservation || reservation.path !== candidate.path || reservation.kind !== candidate.kind
                    || !['consumed', 'purging'].includes(reservation.state) || candidate.ambiguous) {
                    return { ...candidate, state: 'retained', reason: 'reservation-unverified' };
                }
                return { ...candidate, state: 'pending', reason: null };
            });
            for (const record of reservationUpdates) {
                transaction.set(record.reservationRef, { ...record.reservation, state: 'purging', updatedAt: deps.timestamp() });
            }
            const now = deps.timestamp();
            const audit = {
                operationId: command.operationId, kind: command.kind, contentId: command.id, actorUid: user.uid,
                baseRevision: command.baseRevision, summary: safeSummary(command.kind, trash.data ?? {}),
                paths: candidateRecords, omittedCandidates: imagePlan.omitted, unmanagedCandidates: imagePlan.unmanaged,
                cleanup: summarizePurgeCleanup({ paths: candidateRecords, omittedCandidates: imagePlan.omitted, unmanagedCandidates: imagePlan.unmanaged }),
                createdAt: now, updatedAt: now,
            };
            audit.resumeAvailable = audit.cleanup.retryable > 0;
            transaction.set(auditRef, audit);
            transaction.set(trashDocumentRef, { ...trash, state: 'purged', purgedAt: now, purgedBy: user.uid,
                data: null, dependencies: [], purgeAuditId: command.operationId, cleanupStatus: audit.cleanup.status });
            const metadata = dataOf(metadataSnap);
            if (metadata) transaction.set(metadataRef(deps.db, command.kind, command.id), { ...metadata, state: 'purged', revision: metadata.revision + 1, updatedAt: now });
            for (const archive of archiveSnapshot.docs) transaction.delete(archive.ref);
            const response = { kind: command.kind, id: command.id, operationId: command.operationId, state: 'purged', cleanup: audit.cleanup };
            transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
            transaction.set(historyRef(deps.db, command.kind, command.id, command.operationId), {
                kind: command.kind, operationId: command.operationId, actorUid: user.uid, role: 'mj', action: 'purge',
                revision: metadata?.revision ? metadata.revision + 1 : command.baseRevision + 1, changes: {}, createdAt: now,
            });
            return response;
        });
        try {
            const cleanup = await runPurgeImageCleanup(command.operationId, request, deps);
            return { ...result, cleanup };
        } catch {
            const cleanup = result.cleanup || { status: 'pending', candidates: 0, deleted: 0, missing: 0, retained: 0, pending: 0 };
            return { ...result, cleanup: { ...cleanup, status: cleanup.status === 'complete' ? 'complete' : 'pending', pending: cleanup.pending || cleanup.candidates } };
        }
    } catch (error) { cleanPrivateError(error); }
}

/** Only MJ can revoke the original contributor's right to restore a trashed entry. */
export async function setTrashVisibility(rawCommand, request, deps) {
    const command = operationEnvelope(rawCommand, ['kind', 'id', 'operationId', 'baseRevision', 'ownerCanRestore']);
    if (typeof command.ownerCanRestore !== 'boolean') fail('visibilité de corbeille invalide');
    const user = identity(request);
    const operationHash = hashCommand(command, user.uid);
    const opRef = receiptRef(deps.db, command.operationId);
    const trashDocumentRef = trashRef(deps.db, command.kind, command.id);
    try {
        return await deps.db.runTransaction(async transaction => {
            const [accessSnap, receiptSnap, trashSnap] = await Promise.all([
                transaction.get(campaignRef(deps.db)), transaction.get(opRef), transaction.get(trashDocumentRef),
            ]);
            const enqAccess = dataOf(accessSnap) ?? {};
            if (enqAccess.enqMaintenance && enqAccess.enqMaintenance !== deps.enqueteJobId) fail('réorganisation des enquêtes en cours', 'failed-precondition');
            const role = requireContributor(user, enqAccess);
            if (role !== 'mj') fail('action réservée au MJ', 'permission-denied');
            const replay = verifyReceipt(receiptSnap, operationHash);
            if (replay) return replay;
            const trash = dataOf(trashSnap);
            if (!trash || trash.state !== 'trashed') fail('entrée de corbeille indisponible', 'not-found');
            if (trash.revision !== command.baseRevision) fail('révision de corbeille modifiée', 'aborted', { kind: 'conflict', revision: trash.revision });
            const now = deps.timestamp();
            transaction.set(trashDocumentRef, { ...trash, ownerCanRestore: command.ownerCanRestore, updatedAt: now });
            const response = { kind: command.kind, id: command.id, operationId: command.operationId, ownerCanRestore: command.ownerCanRestore };
            transaction.set(opRef, { operationId: command.operationId, actorUid: user.uid, commandHash: operationHash, response, createdAt: now });
            return response;
        });
    } catch (error) { cleanPrivateError(error); }
}

function contributionImageKind(upload) {
    return upload.kind === 'portrait' ? 'pnj' : upload.kind === 'indice' ? 'indice' : null;
}

async function authorizeContributionImage(upload, request, deps) {
    const user = identity(request);
    const kind = contributionImageKind(upload);
    if (!kind || upload.ownerId !== safeId(upload.ownerId) || typeof upload.md5Hash !== 'string') {
        fail('réservation image invalide');
    }
    const reference = imageReservationFromPath(kind, upload.ownerId, upload.imagePath, deps.db);
    if (!reference || reference.operationId !== upload.operationId) fail('chemin image invalide');
    const reservation = reference.ref;
    const content = contentRef(deps.db, kind, upload.ownerId);
    const metadata = metadataRef(deps.db, kind, upload.ownerId);
    const trash = trashRef(deps.db, kind, upload.ownerId);
    const lock = deletionLockRef(deps.db);
    await deps.db.runTransaction(async transaction => {
        const [accessSnap, contentSnap, metadataSnap, trashSnap, reservationSnap, lockSnap] = await Promise.all([
            transaction.get(campaignRef(deps.db)), transaction.get(content), transaction.get(metadata),
            transaction.get(trash), transaction.get(reservation), transaction.get(lock),
        ]);
        requireContributor(user, dataOf(accessSnap) ?? {});
        if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });
        const current = dataOf(contentSnap);
        if (current) {
            if (user.isMj) {
                if (dataOf(metadataSnap)?.state && dataOf(metadataSnap).state !== 'active') fail('contenu indisponible', 'not-found');
            } else assertCurrentPublic(kind, current);
        }
        else if (exists(metadataSnap) || exists(trashSnap)) fail('identifiant de contenu indisponible', 'already-exists');
        const oldReservation = dataOf(reservationSnap);
        if (oldReservation && (oldReservation.uid !== user.uid || oldReservation.path !== upload.imagePath
            || oldReservation.md5Hash !== upload.md5Hash || oldReservation.size !== upload.size
            || oldReservation.contentType !== upload.contentType || !['pending', 'uploaded', 'consumed'].includes(oldReservation.state))) {
            fail('réservation image déjà utilisée', 'already-exists');
        }
        if (!oldReservation) {
            const now = deps.timestamp();
            transaction.set(reservation, {
                kind, contentId: upload.ownerId, uid: user.uid, operationId: upload.operationId,
                path: upload.imagePath, contentType: upload.contentType, size: upload.size,
                md5Hash: upload.md5Hash, state: 'pending', createdAt: now, updatedAt: now,
            });
        }
    });
    return true;
}

async function completeContributionImage(upload, request, deps) {
    const user = identity(request);
    const kind = contributionImageKind(upload);
    if (!kind) fail('réservation image invalide');
    const reference = imageReservationFromPath(kind, upload.ownerId, upload.imagePath, deps.db);
    const content = contentRef(deps.db, kind, upload.ownerId);
    const metadata = metadataRef(deps.db, kind, upload.ownerId);
    const trash = trashRef(deps.db, kind, upload.ownerId);
    const lock = deletionLockRef(deps.db);
    await deps.db.runTransaction(async transaction => {
        const [accessSnap, reservationSnap, contentSnap, metadataSnap, trashSnap, lockSnap] = await Promise.all([
            transaction.get(campaignRef(deps.db)), transaction.get(reference.ref), transaction.get(content),
            transaction.get(metadata), transaction.get(trash), transaction.get(lock),
        ]);
        requireContributor(user, dataOf(accessSnap) ?? {});
        if (exists(lockSnap)) fail('modifications temporairement suspendues', 'failed-precondition', { kind: 'content-lock' });
        const reservation = dataOf(reservationSnap);
        if (!reservation || reservation.uid !== user.uid || reservation.path !== upload.imagePath
            || reservation.md5Hash !== upload.md5Hash || reservation.size !== upload.size
            || reservation.contentType !== upload.contentType || !['pending', 'uploaded', 'consumed'].includes(reservation.state)) {
            fail('réservation image invalide', 'failed-precondition', { kind: 'image-reservation-invalid' });
        }
        const current = dataOf(contentSnap);
        if (current) {
            if (user.isMj) {
                if (dataOf(metadataSnap)?.state && dataOf(metadataSnap).state !== 'active') fail('contenu indisponible', 'not-found');
            } else assertCurrentPublic(kind, current);
        }
        else if (exists(metadataSnap) || exists(trashSnap)) fail('identifiant de contenu indisponible', 'already-exists');
        if (reservation.state !== 'consumed' && reservation.state !== 'uploaded') {
            transaction.set(reference.ref, { ...reservation, state: 'uploaded', updatedAt: deps.timestamp() });
        }
    });
}

/** Player/MJ upload endpoint. The injected core path still validates bytes, signature, storage digest and App Check at callable wiring. */
export async function uploadContributionImage(request, deps) {
    if (!deps?.db || !deps?.bucket || typeof deps.timestamp !== 'function') fail('service indisponible', 'internal');
    try {
        return await uploadProtectedImage(request?.data, request, {
            ...deps,
            authorizeUpload: (upload, context) => authorizeContributionImage(upload, context, deps),
            onUploadComplete: (upload, context) => completeContributionImage(upload, context, deps),
        });
    } catch (error) { cleanPrivateError(error); }
}

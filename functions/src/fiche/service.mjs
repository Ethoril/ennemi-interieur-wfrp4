import { createHash } from 'node:crypto';

export const FICHE_CHAR_IDS = Object.freeze(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren', 'test']);
export const FICHE_SCHEMA_VERSION = 2;
export const FICHE_COMMAND_TYPES = Object.freeze(['patch', 'purchase', 'cancel', 'gain', 'correct', 'import', 'reset']);

const PLAYER_CHAR_IDS = new Set(FICHE_CHAR_IDS.filter(charId => charId !== 'test'));
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const PATCH_TYPES = new Set(['patch']);
const SERVER_ONLY_TYPES = new Set(['gain', 'correct', 'import', 'reset']);
const ADMIN_EMAIL = 'ethoril@gmail.com';
const PATCH_FIELDS = new Set([
    'nom', 'race', 'blessuresAct', 'resilience', 'determination', 'chance', 'destin',
    'corruption', 'possessions', 'optVisible.section-sorts', 'optVisible.section-prieres',
]);
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_FICHE_DATA_BYTES = 900 * 1024;
const MAX_DEPTH = 12;
const MAX_STRING_LENGTH = 20_000;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class FicheCommandError extends Error {
    constructor(message, code = 'invalid-argument', details = undefined) {
        super(message);
        this.name = 'FicheCommandError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(message, code = 'invalid-argument', details) {
    throw new FicheCommandError(message, code, details);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertSafeTree(value, depth = 0) {
    if (depth > MAX_DEPTH) fail('payload trop imbriqué');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string') {
        if (value.length > MAX_STRING_LENGTH) fail('texte trop long');
        return;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('nombre invalide');
        return;
    }
    if (Array.isArray(value)) {
        if (value.length > 2_000) fail('tableau trop volumineux');
        for (const item of value) assertSafeTree(item, depth + 1);
        return;
    }
    if (!isRecord(value)) fail('objet invalide');
    for (const [key, item] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) fail('clé interdite');
        if (key.length > 200) fail('clé trop longue');
        assertSafeTree(item, depth + 1);
    }
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashCommand(command, uid) {
    const canonical = stableStringify({ command, uid });
    return createHash('sha256').update(canonical).digest('hex');
}

function validateCommand(command) {
    if (!isRecord(command)) fail('commande invalide');
    const expectedKeys = ['charId', 'operationId', 'baseRevision', 'type', 'payload'];
    if (Object.keys(command).some(key => !expectedKeys.includes(key))
        || expectedKeys.some(key => !Object.hasOwn(command, key))) fail('forme de commande invalide');
    const { charId, operationId, baseRevision, type, payload } = command;
    if (!FICHE_CHAR_IDS.includes(charId)) fail('personnage invalide');
    if (typeof operationId !== 'string' || !ID_PATTERN.test(operationId)) fail('identifiant d’opération invalide');
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) fail('révision de base invalide');
    if (!FICHE_COMMAND_TYPES.includes(type)) fail('type de commande invalide');
    if (!isRecord(payload)) fail('contenu de commande invalide');
    assertSafeTree(payload);
    if (Buffer.byteLength(stableStringify(command), 'utf8') > MAX_COMMAND_BYTES) fail('commande trop volumineuse');
    if (type === 'patch') validatePatchPayload(payload);
    return command;
}

function validatePrivilegedPayload(command) {
    const { type, payload } = command;
    if (!SERVER_ONLY_TYPES.has(type)) return;
    if (typeof payload.reason !== 'string' || payload.reason.trim().length < 3 || payload.reason.length > 1_000) {
        fail('motif obligatoire');
    }
    if (type === 'import' && !isRecord(payload.data)) fail('données d’import invalides');
    if (type === 'reset' && Object.keys(payload).some(key => key !== 'reason')) fail('contenu de réinitialisation invalide');
}

function validatePatchPayload(payload) {
    if (Object.keys(payload).some(key => !['changes', 'baseValues'].includes(key))
        || !isRecord(payload.changes) || !isRecord(payload.baseValues)) fail('modification simple invalide');
    const paths = Object.keys(payload.changes);
    if (!paths.length || paths.length > 40 || paths.some(path => !Object.hasOwn(payload.baseValues, path))
        || Object.keys(payload.baseValues).some(path => !Object.hasOwn(payload.changes, path))) {
        fail('valeurs de base invalides');
    }
    for (const path of paths) {
        const segments = parsePatchPath(path);
        const simple = PATCH_FIELDS.has(path);
        const rowNote = segments.length === 3
            && ['careers', 'skillsAdvanced', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(segments[0])
            && !!segments[1] && segments[2] === 'note';
        const basicSpec = segments.length === 2 && segments[0] === 'basicSpecs' && !!segments[1];
        const chosenVariant = segments.length === 3 && segments[0] === 'chosenVariants'
            && !!segments[1] && /^[1-5]$/u.test(segments[2]);
        if (!simple && !rowNote && !basicSpec && !chosenVariant) {
            fail('champ non autorisé', 'permission-denied', { kind: 'field-forbidden', path });
        }
        const value = payload.changes[path];
        const base = payload.baseValues[path];
        if (value === null) fail('une modification ne peut pas supprimer un champ');
        if (simple && path.startsWith('optVisible.')) {
            if (typeof value !== 'boolean' || (base !== null && typeof base !== 'boolean')) fail('valeur de visibilité invalide');
        } else if (rowNote) {
            if (typeof value !== 'string' || value.length > 2_000 || (base !== null && typeof base !== 'string')) fail('note invalide');
        } else if (basicSpec || chosenVariant) {
            if (typeof value !== 'string' || value.length > 200 || (base !== null && typeof base !== 'string')) fail('choix de carrière invalide');
        } else if (typeof value !== 'string' || (base !== null && typeof base !== 'string')) {
            fail('valeur de champ invalide');
        }
    }
}

function parsePatchPath(path) {
    if (typeof path !== 'string' || path.length > 600) return [];
    try {
        const segments = path.split('.').map(segment => decodeURIComponent(segment));
        return segments.some(segment => FORBIDDEN_KEYS.has(segment)) ? [] : segments;
    } catch {
        return [];
    }
}

function deepEqual(left, right) {
    return stableStringify(left) === stableStringify(right);
}

function resolvePatch(data, payload, revision) {
    const changes = new Map();
    const conflicts = [];
    for (const [path, localValue] of Object.entries(payload.changes)) {
        const baseValue = payload.baseValues[path];
        const [root, child, field] = parsePatchPath(path);
        const remoteValue = pathValue(data, path);
        if (deepEqual(remoteValue, baseValue)) {
            changes.set(path, localValue);
        } else if (!deepEqual(remoteValue, localValue) && !deepEqual(baseValue, localValue)) {
            conflicts.push(path);
        }
    }
    if (conflicts.length) fail('modifications concurrentes sur le même champ', 'aborted', { kind: 'conflict', fields: conflicts, revision });
    const nextData = { ...data };
    for (const [path, value] of changes) {
        const [root, child, field] = parsePatchPath(path);
        if (field === 'note' && root !== 'chosenVariants') {
            nextData[root] = nextData[root].map(row => row.id === child ? { ...row, note: value } : row);
        } else if (field && root === 'chosenVariants') {
            nextData.chosenVariants = { ...(isRecord(nextData.chosenVariants) ? nextData.chosenVariants : {}), [child]: {
                ...(isRecord(nextData.chosenVariants?.[child]) ? nextData.chosenVariants[child] : {}), [field]: value,
            } };
        } else if (child) nextData[root] = { ...(isRecord(nextData[root]) ? nextData[root] : {}), [child]: value };
        else nextData[root] = value;
    }
    return nextData;
}

function journalEffects(data, operationId) {
    const rows = Array.isArray(data?.xpLog) ? data.xpLog : [];
    const effects = rows.filter(row => row?.operationId === operationId && Array.isArray(row.effects))
        .flatMap(row => row.effects)
        .filter(item => item && typeof item.path === 'string' && item.path.length <= 600)
        .slice(0, 100)
        .map(item => ({ path: item.path, before: item.before ?? null, after: item.after ?? null }));
    assertSafeTree(effects);
    return effects;
}

function validateAuth(request) {
    const auth = request?.auth;
    const email = typeof auth?.token?.email === 'string' ? auth.token.email.trim().toLowerCase() : '';
    if (!auth?.uid || !email || auth.token.email_verified !== true) fail('authentification requise', 'unauthenticated');
    return { uid: auth.uid, email, isAdmin: email === ADMIN_EMAIL };
}

function snapshotData(snapshot) {
    return snapshot?.exists ? snapshot.data() : null;
}

function ensureAuthorized(user, command, accessData) {
    if (command.charId === 'test') {
        if (!user.isAdmin) fail('accès refusé', 'permission-denied');
        return 'mj';
    }
    if (user.isAdmin) return 'mj';
    if (!PLAYER_CHAR_IDS.has(command.charId)) fail('accès refusé', 'permission-denied');
    const emails = accessData?.[command.charId];
    if (!Array.isArray(emails) || !emails.includes(user.email)) {
        fail('accès refusé', 'permission-denied');
    }
    if (SERVER_ONLY_TYPES.has(command.type)) fail('commande réservée au MJ', 'permission-denied');
    return 'joueur';
}

function requireExactRevision(command, revision) {
    if (command.baseRevision !== revision) {
        fail('la fiche a changé depuis sa lecture', 'aborted', { kind: 'conflict', revision });
    }
}

function normalizeDomainResult(result, originalData, before) {
    if (!isRecord(result) || !isRecord(result.data)) fail('résultat métier invalide', 'internal');
    assertSafeTree(result.data);
    const clean = { data: result.data };
    if (Object.hasOwn(result, 'result')) {
        if (!isRecord(result.result)) fail('résultat métier invalide', 'internal');
        assertSafeTree(result.result);
        clean.result = sanitizeSummary(result.result);
    }
    if (Object.hasOwn(result, 'summary')) clean.summary = sanitizeSummary(result.summary);
    if (stableStringify(originalData) !== before) fail('le moteur a modifié son état d’entrée', 'internal');
    return clean;
}

function sanitizeSummary(summary) {
    if (typeof summary === 'string') {
        if (summary.length > 500) fail('résumé métier trop long', 'internal');
        return summary;
    }
    if (!isRecord(summary)) fail('résumé métier invalide', 'internal');
    const allowedKeys = new Set(['label', 'kind', 'target', 'cost', 'purchaseId', 'undoOf', 'fields']);
    const clean = {};
    for (const [key, value] of Object.entries(summary)) {
        if (!allowedKeys.has(key)) continue;
        if (typeof value === 'string' && value.length <= 200) clean[key] = value;
        else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
        else if (typeof value === 'boolean') clean[key] = value;
        else if (key === 'fields' && Array.isArray(value) && value.length <= 40
            && value.every(field => typeof field === 'string' && PATCH_FIELDS.has(field))) clean[key] = value;
    }
    return clean;
}

function pathValue(data, path) {
    const [root, child, field] = parsePatchPath(path);
    if (field && root === 'chosenVariants') return data[root]?.[child]?.[field] ?? null;
    if (field) {
        const rows = Array.isArray(data[root]) ? data[root].filter(row => row?.id === child) : [];
        return rows.length === 1 && Object.hasOwn(rows[0], field) ? rows[0][field] : null;
    }
    if (child) return isRecord(data[root]) && Object.hasOwn(data[root], child) ? data[root][child] : null;
    return Object.hasOwn(data, root) ? data[root] : null;
}

function pathExists(data, path) {
    const [root, child, field] = parsePatchPath(path);
    if (field && root === 'chosenVariants') return isRecord(data[root]?.[child]) && Object.hasOwn(data[root][child], field);
    if (field) return Array.isArray(data[root]) && data[root].filter(row => row?.id === child && Object.hasOwn(row, field)).length === 1;
    return child ? isRecord(data[root]) && Object.hasOwn(data[root], child) : Object.hasOwn(data, root);
}

/**
 * Exécute une commande de fiche de manière atomique.
 * deps: { db, applyCommand(data, command, context), timestamp() }.
 */
export async function executeFicheCommand(rawCommand, request, deps) {
    const command = validateCommand(rawCommand);
    if (!deps?.db || typeof deps.db.doc !== 'function' || typeof deps.db.runTransaction !== 'function'
        || typeof deps.timestamp !== 'function') fail('service indisponible', 'internal');
    if (typeof deps.applyCommand !== 'function' && typeof deps.createEngine !== 'function' && !['patch', 'reset'].includes(command.type)) {
        fail('moteur de fiche indisponible', 'internal');
    }
    const user = validateAuth(request);
    const commandHash = hashCommand(command, user.uid);
    const ficheRef = deps.db.doc(`fiches/${command.charId}`);
    const accessRef = deps.db.doc('campagne/acces');
    const catalogueRef = deps.db.doc('referentiels/public');
    const operationRef = ficheRef.collection('operations').doc(command.operationId);
    const historyRef = ficheRef.collection('history').doc(command.operationId);
    const commandBackupRef = ['import', 'reset'].includes(command.type)
        ? ficheRef.collection('command_backups').doc(command.operationId)
        : null;

    return deps.db.runTransaction(async transaction => {
        // Firestore impose que toutes les lectures précèdent les premières écritures.
        const [accessSnapshot, ficheSnapshot, operationSnapshot, catalogueSnapshot] = await Promise.all([
            transaction.get(accessRef), transaction.get(ficheRef), transaction.get(operationRef), transaction.get(catalogueRef),
        ]);
        const role = ensureAuthorized(user, command, snapshotData(accessSnapshot));
        validatePrivilegedPayload(command);

        const priorReceipt = snapshotData(operationSnapshot);
        if (priorReceipt) {
            if (priorReceipt.commandHash !== commandHash) fail('identifiant d’opération déjà utilisé', 'already-exists');
            return priorReceipt.response;
        }

        let envelope = snapshotData(ficheSnapshot);
        if (!envelope && command.type === 'import' && role === 'mj' && command.baseRevision === 0) {
            // Initialisation explicite et auditée d’une fiche absente, réservée
            // au MJ et limitée à un import motivé sur la révision zéro.
            envelope = { schemaVersion: FICHE_SCHEMA_VERSION, revision: 0, tombstone: false, data: {} };
        }
        if (!envelope || envelope.schemaVersion !== FICHE_SCHEMA_VERSION || !Number.isSafeInteger(envelope.revision)
            || envelope.revision < 0 || !isRecord(envelope.data)) {
            fail('migration de fiche requise', 'failed-precondition', { kind: 'migration-needed' });
        }
        if (command.baseRevision > envelope.revision) {
            fail('révision de base inconnue', 'aborted', { kind: 'conflict', revision: envelope.revision });
        }
        if (envelope.tombstone === true && !['import', 'reset'].includes(command.type)) {
            fail('la fiche a été réinitialisée', 'failed-precondition', { kind: 'tombstone' });
        }
        if (command.type !== 'patch' && command.type !== 'purchase' && command.type !== 'cancel') {
            requireExactRevision(command, envelope.revision);
        }

        const publishedCatalogue = snapshotData(catalogueSnapshot)?.catalogue || deps.initialCatalogue;
        const publishedEngine = typeof deps.createEngine === 'function'
            ? deps.createEngine(publishedCatalogue)
            : null;

        const context = Object.freeze({
            role,
            uid: user.uid,
            charId: command.charId,
            revision: envelope.revision,
            baseRevision: command.baseRevision,
            ...(publishedEngine?.catalogVersion ? { catalogVersion: publishedEngine.catalogVersion } : {}),
        });
        let nextData;
        let domainResult = {};
        let changeDelta;
        if (command.type === 'patch') {
            const validatePatch = publishedEngine?.validatePatch || deps.validatePatch;
            if (typeof validatePatch === 'function') await validatePatch(envelope.data, command.payload, context);
            else if (Object.keys(command.payload.changes).some(path => (
                parsePatchPath(path)[0] === 'chosenVariants' || parsePatchPath(path)[0] === 'basicSpecs'
            ))) fail('validation du catalogue requise', 'failed-precondition', { kind: 'catalog-validation-required' });
            nextData = resolvePatch(envelope.data, command.payload, envelope.revision);
            changeDelta = Object.fromEntries(Object.keys(command.payload.changes)
                .filter(path => !deepEqual(pathValue(envelope.data, path), pathValue(nextData, path)))
                .map(path => [path, {
                    before: pathValue(envelope.data, path),
                    ...(pathExists(envelope.data, path) ? {} : { beforeExists: false }),
                    after: pathValue(nextData, path),
                }]));
        } else if (command.type === 'reset') {
            nextData = {};
        } else {
            const inputData = structuredClone(envelope.data);
            const before = stableStringify(inputData);
            const applyCommand = publishedEngine?.applyCommand || deps.applyCommand;
            const result = await applyCommand(inputData, command, context);
            domainResult = normalizeDomainResult(result, inputData, before);
            nextData = domainResult.data;
        }

        assertSafeTree(nextData);
        if (Buffer.byteLength(stableStringify(nextData), 'utf8') > MAX_FICHE_DATA_BYTES) {
            fail('la fiche dépasse la taille maximale conservatrice', 'resource-exhausted', { kind: 'fiche-too-large' });
        }

        const nextRevision = envelope.revision + 1;
        const response = { operationId: command.operationId, charId: command.charId, revision: nextRevision };
        if (domainResult.result) response.result = domainResult.result;
        const now = deps.timestamp();
        let backupPath;
        let commandBackup;
        if (commandBackupRef && ficheSnapshot.exists) {
            commandBackup = {
                operationId: command.operationId,
                type: command.type,
                uid: user.uid,
                charId: command.charId,
                sourceRevision: envelope.revision,
                sourceEnvelope: envelope,
                createdAt: now,
            };
            let backupBytes;
            try { backupBytes = Buffer.byteLength(JSON.stringify(commandBackup), 'utf8'); }
            catch { fail('sauvegarde de commande non sérialisable', 'failed-precondition', { kind: 'backup-invalid' }); }
            if (backupBytes > MAX_FICHE_DATA_BYTES) {
                fail('la sauvegarde de commande dépasse la limite conservatrice de 900 KiB', 'resource-exhausted', { kind: 'backup-too-large' });
            }
            backupPath = `fiches/${command.charId}/command_backups/${command.operationId}`;
        }
        const nextEnvelope = {
            ...envelope,
            schemaVersion: FICHE_SCHEMA_VERSION,
            revision: nextRevision,
            data: nextData,
            updatedAt: now,
            updatedBy: user.uid,
            ...(publishedEngine?.catalogVersion ? { catalogVersion: publishedEngine.catalogVersion } : {}),
            ...(command.type === 'reset' ? { tombstone: true } : { tombstone: false }),
        };
        if (commandBackup) transaction.set(commandBackupRef, commandBackup);
        transaction.set(ficheRef, nextEnvelope);
        transaction.set(operationRef, { operationId: command.operationId, commandHash, uid: user.uid, response, createdAt: now });
        transaction.set(historyRef, {
            operationId: command.operationId,
            type: command.type,
            uid: user.uid,
            role,
            revision: nextRevision,
            createdAt: now,
            commandHash,
            ...(command.type === 'patch' ? { fields: Object.keys(command.payload.changes) } : {}),
            ...(changeDelta && Object.keys(changeDelta).length ? { changes: changeDelta } : {}),
            ...(!changeDelta ? (() => {
                const effects = journalEffects(nextData, command.operationId);
                return effects.length ? { effects } : {};
            })() : {}),
            ...(typeof command.payload.reason === 'string' ? { reason: command.payload.reason.trim() } : {}),
            ...(domainResult.summary !== undefined ? { summary: domainResult.summary } : {}),
            ...(backupPath ? { backupPath } : {}),
        });
        return response;
    });
}

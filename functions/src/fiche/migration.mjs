import { migrateFicheDocument, FICHE_SCHEMA_VERSION } from '../domain/fiche-schema.js';
import { FICHE_CHAR_IDS } from './service.mjs';

const ADMIN_EMAIL = 'ethoril@gmail.com';
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_BACKUP_BYTES = 900 * 1024;

export class FicheMigrationError extends Error {
    constructor(message, code = 'invalid-argument', details = undefined) {
        super(message);
        this.name = 'FicheMigrationError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(message, code, details) {
    throw new FicheMigrationError(message, code, details);
}

function validateRequest(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || Object.keys(data).some(key => !['charId', 'confirmCharId', 'expectedSourceFingerprint'].includes(key))
        || Object.keys(data).length !== 3) fail('confirmation de migration invalide');
    if (typeof data.charId !== 'string' || !FICHE_CHAR_IDS.includes(data.charId)
        || data.confirmCharId !== data.charId) fail('confirmation du personnage invalide');
    if (typeof data.expectedSourceFingerprint !== 'string' || !FINGERPRINT_PATTERN.test(data.expectedSourceFingerprint)) {
        fail('empreinte source invalide');
    }
    return data;
}

function validateMj(request) {
    const auth = request?.auth;
    const email = typeof auth?.token?.email === 'string' ? auth.token.email.trim().toLowerCase() : '';
    if (!auth?.uid || !email || auth.token.email_verified !== true) fail('authentification requise', 'unauthenticated');
    if (email !== ADMIN_EMAIL) fail('migration réservée au MJ', 'permission-denied');
    return auth.uid;
}

function snapshotData(snapshot) {
    return snapshot?.exists ? snapshot.data() : null;
}

function cleanReport(report) {
    return {
        status: report.status,
        sourceFingerprint: report.sourceFingerprint,
        sourceSchemaVersion: report.sourceSchemaVersion,
        targetSchemaVersion: report.targetSchemaVersion,
        sourceRevision: report.sourceRevision,
        targetRevision: report.targetRevision,
        blocked: report.blocked.slice(0, 40),
        anomalies: report.anomalies.slice(0, 40).map(item => ({
            ...(typeof item.code === 'string' ? { code: item.code } : {}),
            ...(typeof item.path === 'string' ? { path: item.path } : {}),
        })),
    };
}

/**
 * MJ-only transactional migration. The caller must provide an explicitly reviewed
 * source fingerprint and repeat the character ID in confirmCharId.
 * deps: { db, timestamp(), migrateDocument? }.
 */
export async function migrateFicheCallable(request, deps) {
    const uid = validateMj(request);
    const { charId, confirmCharId, expectedSourceFingerprint } = validateRequest(request?.data);
    if (!deps?.db || typeof deps.db.doc !== 'function' || typeof deps.db.runTransaction !== 'function'
        || typeof deps.timestamp !== 'function') fail('service de migration indisponible', 'internal');
    const migrateDocument = deps.migrateDocument || migrateFicheDocument;
    const ficheRef = deps.db.doc(`fiches/${charId}`);

    return deps.db.runTransaction(async transaction => {
        const ficheSnapshot = await transaction.get(ficheRef);
        const source = snapshotData(ficheSnapshot);
        if (!source) fail('fiche source introuvable', 'not-found');

        const migration = await migrateDocument(source, { charId });
        if (!migration.canApply) {
            fail('migration bloquée par des anomalies de données', 'failed-precondition', {
                kind: 'migration-blocked',
                report: cleanReport(migration.report),
            });
        }
        // Validate the entire V2 shape before trusting its marker. A valid V2
        // envelope keeps its original migration fingerprint through later edits,
        // so a retry can safely succeed without comparing the current document hash.
        if (migration.report.status === 'already-migrated'
            && migration.document.migration?.sourceFingerprint === expectedSourceFingerprint) {
            return {
                charId,
                sourceFingerprint: expectedSourceFingerprint,
                schemaVersion: FICHE_SCHEMA_VERSION,
                revision: migration.document.revision,
                status: 'already-migrated',
            };
        }
        if (migration.report.sourceFingerprint !== expectedSourceFingerprint) {
            fail('la fiche a changé depuis la vérification', 'aborted', {
                kind: 'source-changed',
                currentSourceFingerprint: migration.report.sourceFingerprint,
            });
        }
        if (migration.report.status === 'already-migrated') {
            return {
                charId,
                sourceFingerprint: expectedSourceFingerprint,
                schemaVersion: FICHE_SCHEMA_VERSION,
                revision: migration.document.revision,
                status: 'already-migrated',
            };
        }

        let backupBytes;
        try {
            backupBytes = Buffer.byteLength(JSON.stringify(source), 'utf8');
        } catch {
            fail('enveloppe source non sérialisable', 'failed-precondition', { kind: 'backup-invalid' });
        }
        if (backupBytes > MAX_BACKUP_BYTES) {
            fail('la sauvegarde dépasse la limite conservatrice de 900 KiB', 'resource-exhausted', { kind: 'backup-too-large' });
        }

        const backupRef = ficheRef.collection('migration_backups').doc(expectedSourceFingerprint);
        const historyRef = ficheRef.collection('history').doc(`migration_${expectedSourceFingerprint}`);
        const [backupSnapshot, historySnapshot] = await Promise.all([
            transaction.get(backupRef),
            transaction.get(historyRef),
        ]);
        if (snapshotData(backupSnapshot) || snapshotData(historySnapshot)) {
            fail('marqueur de migration incohérent', 'failed-precondition', { kind: 'migration-marker-conflict' });
        }

        const now = deps.timestamp();
        const migrated = {
            ...migration.document,
            updatedAt: now,
            updatedBy: uid,
            migration: { ...migration.document.migration, migratedAt: now },
        };
        transaction.create(backupRef, {
            charId,
            sourceFingerprint: expectedSourceFingerprint,
            sourceDocument: source,
            createdAt: now,
            createdBy: uid,
        });
        transaction.set(ficheRef, migrated);
        transaction.create(historyRef, {
            type: 'migration',
            charId,
            uid,
            sourceFingerprint: expectedSourceFingerprint,
            schemaVersion: FICHE_SCHEMA_VERSION,
            revision: migrated.revision,
            backupPath: `fiches/${charId}/migration_backups/${expectedSourceFingerprint}`,
            createdAt: now,
        });
        return {
            charId,
            sourceFingerprint: expectedSourceFingerprint,
            schemaVersion: FICHE_SCHEMA_VERSION,
            revision: migrated.revision,
            status: 'migrated',
        };
    });
}

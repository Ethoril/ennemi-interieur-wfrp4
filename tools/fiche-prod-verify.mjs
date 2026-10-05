// Vérification post-migration en lecture seule; toute identité et archive viennent du backup opérateur.
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    CHARACTER_IDS, PROJECT, REPO_ROOT, createCliAuthenticatedClient, deserializeFirestoreValue,
    readVerifiedBackup,
} from './fiche-prod-backup.mjs';
import { FICHE_ARRAY_FIELDS, FICHE_SCHEMA_VERSION, ficheFingerprint, migrateFicheDocument, stableJson } from '../js/fiche-schema.js';

const option = (argv, name) => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

export function parseArgs(argv = process.argv.slice(2)) {
    const [command = null, ...rest] = argv;
    return {
        command,
        project: option(rest, 'project'),
        backup: option(rest, 'backup'),
        phase: option(rest, 'phase') ?? 'post',
        help: rest.includes('--help') || rest.includes('-h'),
    };
}

export function validateArgs(args, { repoRoot = REPO_ROOT } = {}) {
    const errors = [];
    if (args.command !== 'verify-live') errors.push('commande verify-live obligatoire');
    if (args.project !== PROJECT) errors.push(`--project=${PROJECT} obligatoire`);
    if (args.phase !== 'post' && args.phase !== 'pre-source-match') errors.push('--phase doit être post ou pre-source-match');
    if (!args.backup || !isAbsolute(args.backup)) errors.push('--backup absolu obligatoire');
    else {
        const fromRepo = relative(resolve(repoRoot), resolve(args.backup));
        const outside = fromRepo === '..' || fromRepo.startsWith(`..${sep}`) || isAbsolute(fromRepo);
        if (!outside) {
            errors.push('--backup doit être hors du dépôt');
        }
    }
    return errors;
}

function counts(data) {
    return Object.fromEntries(FICHE_ARRAY_FIELDS.map(field => [field,
        Array.isArray(data?.[field]) ? data[field].length : null]));
}

function makeRow(charId, flags, details = {}) {
    const verified = Object.values(flags).every(value => value === true);
    return {
        charId,
        status: verified ? 'verified' : 'mismatch',
        ...flags,
        ...(details.sourceCounts ? { sourceCounts: details.sourceCounts } : {}),
        ...(details.expectedCounts ? { expectedCounts: details.expectedCounts } : {}),
        ...(details.liveCounts ? { liveCounts: details.liveCounts } : {}),
        ...(Number.isSafeInteger(details.assignedIds) ? { assignedIds: details.assignedIds } : {}),
        ...(Number.isSafeInteger(details.descendantCount) ? { descendantCount: details.descendantCount } : {}),
    };
}

function failedRow(charId, status, details = {}) {
    return {
        charId,
        status,
        ...(typeof details.exists === 'boolean' ? { liveExists: details.exists } : {}),
        ...(details.sourceCounts ? { sourceCounts: details.sourceCounts } : {}),
        ...(Number.isSafeInteger(details.descendantCount) ? { descendantCount: details.descendantCount } : {}),
    };
}

/** Compare l’archive vérifiée avec l’état live sans jamais écrire ni restituer de valeur de fiche. */
export async function verifyLiveRecords({ db, payload, types, phase = 'post' } = {}) {
    if (!db || typeof db.doc !== 'function' || !payload || !Array.isArray(payload.records)
        || !CHARACTER_IDS.every((id, index) => payload.records[index]?.charId === id)) {
        throw new Error('archive ou client de lecture invalide');
    }
    const rows = [];
    for (const record of payload.records) {
        const source = record.exists ? deserializeFirestoreValue(record.document, types) : null;
        const liveSnapshot = await db.doc(`fiches/${record.charId}`).get();
        const live = liveSnapshot.exists ? liveSnapshot.data() : null;
        const sourceCounts = source ? counts(source.data) : undefined;
        if (!source || !live) {
            rows.push(failedRow(record.charId, !source ? 'source-missing' : 'live-missing', {
                exists: Boolean(live), sourceCounts, descendantCount: record.descendants.length,
            }));
            continue;
        }

        const archiveSourceFingerprintMatches = await ficheFingerprint(source) === record.sourceFingerprint;
        const currentFingerprint = await ficheFingerprint(live);
        if (phase === 'pre-source-match') {
            rows.push(makeRow(record.charId, {
                sourceFingerprintMatches: archiveSourceFingerprintMatches && currentFingerprint === record.sourceFingerprint,
            }, { sourceCounts, descendantCount: record.descendants.length }));
            continue;
        }

        const migration = await migrateFicheDocument(source, { charId: record.charId });
        const expected = migration.document;
        if (!migration.canApply || !expected) {
            rows.push(failedRow(record.charId, 'source-not-migratable', {
                exists: true, sourceCounts, descendantCount: record.descendants.length,
            }));
            continue;
        }
        const markerFingerprint = expected.migration?.sourceFingerprint;
        const backupPath = `fiches/${record.charId}/migration_backups/${markerFingerprint}`;
        const historyPath = `fiches/${record.charId}/history/migration_${markerFingerprint}`;
        const [migrationBackupSnapshot, historySnapshot] = await Promise.all([
            db.doc(backupPath).get(), db.doc(historyPath).get(),
        ]);
        const migrationBackup = migrationBackupSnapshot.exists ? migrationBackupSnapshot.data() : null;
        const history = historySnapshot.exists ? historySnapshot.data() : null;
        const expectedSourceIsCurrent = migration.report.status !== 'already-migrated';
        const sourceRevision = Number.isSafeInteger(migrationBackup?.sourceDocument?.revision)
            ? migrationBackup.sourceDocument.revision : 1;
        const storedSourceFingerprint = migrationBackup?.sourceDocument
            ? await ficheFingerprint(migrationBackup.sourceDocument) : null;
        const backupSourceMatches = expectedSourceIsCurrent
            ? stableJson(migrationBackup?.sourceDocument) === stableJson(source)
            : storedSourceFingerprint === markerFingerprint;
        const sameOperator = typeof migrationBackup?.createdBy === 'string'
            && migrationBackup.createdBy.length > 0
            && history?.uid === migrationBackup.createdBy
            && (migration.report.status === 'already-migrated' || live.updatedBy === migrationBackup.createdBy);
        const flags = {
            sourceFingerprintMatches: archiveSourceFingerprintMatches
                && (!expectedSourceIsCurrent || markerFingerprint === record.sourceFingerprint),
            schemaVersionMatches: live.schemaVersion === FICHE_SCHEMA_VERSION,
            revisionMatches: live.revision === expected.revision,
            migrationMarkerMatches: live.migration?.ficheSchemaVersion === FICHE_SCHEMA_VERSION
                && live.migration?.sourceFingerprint === markerFingerprint,
            dataMatchesExpected: stableJson(live.data) === stableJson(expected.data),
            migrationBackupExists: Boolean(migrationBackup),
            migrationBackupMatchesSource: Boolean(migrationBackup)
                && migrationBackup.charId === record.charId
                && migrationBackup.sourceFingerprint === markerFingerprint
                && backupSourceMatches,
            migrationHistoryExists: Boolean(history),
            migrationHistoryMatches: Boolean(history)
                && history.type === 'migration'
                && history.charId === record.charId
                && history.sourceFingerprint === markerFingerprint
                && history.schemaVersion === FICHE_SCHEMA_VERSION
                && history.revision === sourceRevision
                && history.backupPath === backupPath,
            sameOperator,
            xpTotalsPreserved: stableJson(migration.report.xpBefore) === stableJson(migration.report.xpAfter),
        };
        rows.push(makeRow(record.charId, flags, {
            sourceCounts,
            expectedCounts: counts(expected.data),
            liveCounts: counts(live.data),
            assignedIds: migration.report.assignedIds.length,
            descendantCount: record.descendants.length,
        }));
    }
    return {
        project: payload.project,
        phase,
        allVerified: rows.length === CHARACTER_IDS.length && rows.every(row => row.status === 'verified'),
        records: rows,
    };
}

export async function runLiveVerify(args, {
    createClient = createCliAuthenticatedClient,
    readBackup = readVerifiedBackup,
} = {}) {
    const errors = validateArgs(args);
    if (errors.length) throw new Error(errors.join('\n'));
    const client = await createClient();
    try {
        const { payload, encryptedBytes } = await readBackup(args.backup, { types: client.types });
        if (payload.project !== PROJECT) throw new Error('archive d’un autre projet');
        const result = await verifyLiveRecords({ db: client.db, payload, types: client.types, phase: args.phase });
        return { ...result, archiveVerified: true, encryptedBytes };
    } finally {
        await client.app?.delete?.().catch(() => {});
    }
}

export function publicOutput(result) {
    return JSON.stringify(result, null, 2);
}

function usage() {
    return [
        `node tools/fiche-prod-verify.mjs verify-live --project=${PROJECT} --backup=<archive DPAPI absolue> [--phase=post|pre-source-match]`,
        'Lecture seule : compare cinq fiches, backup de migration et historique; aucun write Firebase.',
    ].join('\n');
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
    const args = parseArgs();
    if (args.help) process.stdout.write(`${usage()}\n`);
    else {
        try {
            const result = await runLiveVerify(args);
            process.stdout.write(`${publicOutput(result)}\n`);
            if (!result.allVerified) process.exitCode = 2;
        } catch {
            process.stderr.write(`Vérification refusée ou échouée. Aucun détail de fiche, UID ou jeton n’a été affiché.\n${usage()}\n`);
            process.exitCode = 1;
        }
    }
}

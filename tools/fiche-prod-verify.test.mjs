import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ficheFingerprint, migrateFicheDocument } from '../js/fiche-schema.js';
import { CHARACTER_IDS, PROJECT, REPO_ROOT } from './fiche-prod-backup.mjs';
import { parseArgs, runLiveVerify, validateArgs, verifyLiveRecords } from './fiche-prod-verify.mjs';

function sourceFor(charId) {
    return {
        revision: 4,
        updatedAt: `source-${charId}`,
        updatedBy: 'previous-uid-private',
        data: {
            nom: `Personnage ${charId}`,
            carac: { cc: { base: 30, adv: 2 } },
            skillsBasic: { 'Corps à corps (Base)': 3 },
            skillsAdvanced: [{ nom: 'Esquive', adv: 4, note: 'NOTE PRIVÉE COMPÉTENCE' }],
            careers: [{ carriere: 'Érudit', rang: '1', note: 'NOTE PRIVÉE CARRIÈRE' }],
            talentsAcq: [{ nom: 'Baratiner', note: 'NOTE PRIVÉE TALENT' }],
            talentsAvail: [], sorts: [], prieres: [],
            xpLog: [{ kind: 'gain', montant: 987654, raison: 'XP privée' }],
            xpTotal: 987654,
        },
    };
}

async function fixture() {
    const documents = new Map();
    const records = [];
    for (const charId of CHARACTER_IDS) {
        const source = sourceFor(charId);
        const sourceFingerprint = await ficheFingerprint(source);
        const migration = await migrateFicheDocument(source, { charId });
        assert.equal(migration.canApply, true);
        const operatorUid = `operator-private-${charId}`;
        const live = {
            ...migration.document,
            updatedAt: `migration-${charId}`,
            updatedBy: operatorUid,
            migration: { ...migration.document.migration, migratedAt: `migration-${charId}` },
        };
        const backupPath = `fiches/${charId}/migration_backups/${sourceFingerprint}`;
        const historyPath = `fiches/${charId}/history/migration_${sourceFingerprint}`;
        documents.set(`fiches/${charId}`, live);
        documents.set(backupPath, { charId, sourceFingerprint, sourceDocument: source, createdBy: operatorUid });
        documents.set(historyPath, {
            type: 'migration', charId, uid: operatorUid, sourceFingerprint, schemaVersion: 2,
            revision: source.revision, backupPath,
        });
        records.push({ charId, exists: true, sourceFingerprint, document: source, descendants: [] });
    }
    const reads = [];
    const db = { doc(path) { return { async get() { reads.push(path); const value = documents.get(path);
        return { exists: value !== undefined, data: () => value }; } }; } };
    return { payload: { format: 'wfrp-fiche-prod-backup-v1', project: PROJECT, records }, documents, reads, db };
}

test('vérification postmigration valide données attendues, backup exact, historique et même opérateur sans exposer le contenu', async () => {
    const data = await fixture();
    const result = await verifyLiveRecords({ db: data.db, payload: data.payload, types: {}, phase: 'post' });
    assert.equal(result.allVerified, true);
    assert.equal(result.records.length, 5);
    assert.ok(result.records.every(row => row.status === 'verified'
        && row.sourceFingerprintMatches && row.dataMatchesExpected && row.migrationBackupMatchesSource
        && row.migrationHistoryMatches && row.sameOperator && row.xpTotalsPreserved));
    assert.deepEqual(result.records[0].sourceCounts, result.records[0].expectedCounts);
    const output = JSON.stringify(result);
    for (const privateValue of ['NOTE PRIVÉE', '987654', 'previous-uid-private', 'operator-private', 'XP privée']) {
        assert.equal(output.includes(privateValue), false);
    }
    assert.equal(data.reads.length, 15);
    assert.equal(data.reads.some(path => /migration_backups|history/u.test(path)), true);
});

test('un champ métier altéré, backup absent ou historique d’un autre opérateur échoue sans détail de fiche', async () => {
    const data = await fixture();
    const live = data.documents.get('fiches/bhelgi');
    live.data.skillsAdvanced[0].note = 'MODIFICATION APRÈS MIGRATION';
    live.schemaVersion = 1;
    live.revision += 1;
    live.migration.sourceFingerprint = 'f'.repeat(64);
    data.documents.delete('fiches/bhelgi/migration_backups/' + data.payload.records[0].sourceFingerprint);
    data.documents.get('fiches/bhelgi/history/migration_' + data.payload.records[0].sourceFingerprint).uid = 'different-private-uid';

    const result = await verifyLiveRecords({ db: data.db, payload: data.payload, types: {}, phase: 'post' });
    assert.equal(result.allVerified, false);
    const row = result.records[0];
    assert.equal(row.status, 'mismatch');
    assert.equal(row.dataMatchesExpected, false);
    assert.equal(row.schemaVersionMatches, false);
    assert.equal(row.revisionMatches, false);
    assert.equal(row.migrationMarkerMatches, false);
    assert.equal(row.migrationBackupExists, false);
    assert.equal(row.sameOperator, false);
    assert.equal(JSON.stringify(result).includes('MODIFICATION APRÈS MIGRATION'), false);
    assert.equal(JSON.stringify(result).includes('different-private-uid'), false);
});

test('mode pré-source compare uniquement les cinq empreintes live sans demander les marqueurs postmigration', async () => {
    const data = await fixture();
    for (const record of data.payload.records) data.documents.set(`fiches/${record.charId}`, record.document);
    const result = await verifyLiveRecords({ db: data.db, payload: data.payload, types: {}, phase: 'pre-source-match' });
    assert.equal(result.allVerified, true);
    assert.ok(result.records.every(row => row.sourceFingerprintMatches));
    assert.equal(data.reads.length, 5);

    data.documents.get('fiches/wren').revision += 1;
    const changed = await verifyLiveRecords({ db: data.db, payload: data.payload, types: {}, phase: 'pre-source-match' });
    assert.equal(changed.allVerified, false);
    assert.equal(changed.records.at(-1).sourceFingerprintMatches, false);
});

test('arguments exigent projet nommé, archive absolue hors dépôt et phase autorisée', () => {
    const backup = resolve(REPO_ROOT, '..', 'fiche-verify-test.dpapi.json');
    assert.deepEqual(validateArgs({ command: 'verify-live', project: PROJECT, backup, phase: 'post' }), []);
    assert.match(validateArgs({ command: 'verify-live', project: 'autre', backup, phase: 'post' }).join(' '), /project/u);
    assert.match(validateArgs({ command: 'verify-live', project: PROJECT, backup: 'relative.json', phase: 'post' }).join(' '), /absolu/u);
    assert.match(validateArgs({ command: 'verify-live', project: PROJECT, backup, phase: 'apply' }).join(' '), /phase/u);
    assert.equal(parseArgs(['verify-live', `--project=${PROJECT}`, `--backup=${backup}`]).phase, 'post');
});

test('client live et archive sont injectés; mode CLI ne peut pas écrire ni se connecter sur projet invalide', async () => {
    const data = await fixture();
    let clientCreated = false;
    let backupRead = false;
    let clientDeleted = false;
    const args = { command: 'verify-live', project: PROJECT, backup: resolve(REPO_ROOT, '..', 'fiches.dpapi.json'), phase: 'post' };
    const result = await runLiveVerify(args, {
        async createClient() { clientCreated = true; return { db: data.db, types: {}, app: { async delete() { clientDeleted = true; } } }; },
        async readBackup(_path, { types }) { backupRead = true; assert.deepEqual(types, {}); return { payload: data.payload, encryptedBytes: 1234 }; },
    });
    assert.equal(result.allVerified, true);
    assert.equal(result.archiveVerified, true);
    assert.equal(clientCreated && backupRead && clientDeleted, true);

    await assert.rejects(runLiveVerify({ ...args, project: 'wrong' }, {
        async createClient() { throw new Error('must not connect'); },
    }), /project/u);
});

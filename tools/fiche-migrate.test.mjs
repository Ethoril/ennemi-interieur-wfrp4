import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ficheFingerprint, migrateFicheDocument, stableJson } from '../js/fiche-schema.js';
import { isOutsideRepository, parseArgs, runMigration, validateOptions } from './fiche-migrate.mjs';

const fiche = data => ({ data, updatedAt: { seconds: 10, nanoseconds: 0 } });

class WebTimestamp {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000); }
    toMillis() { return this.toDate().getTime(); }
}

class AdminTimestamp {
    constructor(seconds, nanoseconds) { this._seconds = seconds; this._nanoseconds = nanoseconds; }
    get seconds() { return this._seconds; }
    get nanoseconds() { return this._nanoseconds; }
    toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000); }
    toMillis() { return this.toDate().getTime(); }
}

test('fingerprint canonise les Timestamp Web/Admin et Date, la migration préserve le timestamp métier', async () => {
    const web = new WebTimestamp(10, 123_000_000);
    const admin = new AdminTimestamp(10, 123_000_000);
    const date = new Date(10_123);
    assert.equal(stableJson({ updatedAt: web }), stableJson({ updatedAt: admin }));
    assert.equal(await ficheFingerprint({ updatedAt: web }), await ficheFingerprint({ updatedAt: admin }));
    assert.equal(await ficheFingerprint({ updatedAt: web }), await ficheFingerprint({ updatedAt: date }));

    const source = fiche({ skillsAdvanced: [], updatedAt: web });
    const result = await migrateFicheDocument(source, { charId: 'timestamp-test' });
    assert.equal(result.canApply, true);
    assert.equal(result.document.data.updatedAt, web);
    assert.equal(source.data.updatedAt, web);

    const dateSource = fiche({ skillsAdvanced: [], updatedAt: date });
    const dateResult = await migrateFicheDocument(dateSource, { charId: 'timestamp-date' });
    assert.equal(dateResult.canApply, true);
    assert.notEqual(dateResult.document.data.updatedAt, date);
    assert.equal(dateResult.document.data.updatedAt.getTime(), date.getTime());
});

test('migration préserve missing/empty, ajoute une enveloppe versionnée et produit des IDs stables', async () => {
    const source = fiche({
        skillsAdvanced: [{ nom: 'Dressage', adv: 2 }, { nom: 'Dressage', adv: 2 }],
        careers: [],
        xpLog: [{ kind: 'gain', montant: 40 }, { applied: true, cout: -5, targetType: 'skill-adv' }],
    });
    const first = await migrateFicheDocument(source, { charId: 'test' });
    const second = await migrateFicheDocument(source, { charId: 'test' });

    assert.equal(first.canApply, true);
    assert.equal(first.document.schemaVersion, 2);
    assert.equal(first.document.revision, 1);
    assert.equal(Object.hasOwn(first.document.data, 'talentsAcq'), false);
    assert.deepEqual(first.document.data.careers, []);
    assert.deepEqual(first.document.data.skillsAdvanced, second.document.data.skillsAdvanced);
    assert.notEqual(first.document.data.skillsAdvanced[0].id, first.document.data.skillsAdvanced[1].id);
    assert.deepEqual(first.document.data.xpLog.map(row => row.cout), [undefined, -5]);
    assert.equal(first.document.data.xpLog[1].purchaseId, undefined);
    assert.ok(first.report.anomalies.some(item => item.code === 'legacy-applied-purchase-unlinked'));
});

test('xpTotal suit le comportement historique sans double gain, tout en préservant les données source', async () => {
    const source = fiche({ xpTotal: '75', xpLog: [{ type: 'Autre', cout: 10 }] });
    const result = await migrateFicheDocument(source, { charId: 'char-a' });
    const again = await migrateFicheDocument(result.document, { charId: 'char-a' });

    assert.equal(result.canApply, true);
    assert.equal(result.document.data.xpTotal, '75');
    assert.equal(result.document.data.xpLog[0].kind, 'gain');
    assert.equal(result.document.data.xpLog[0].montant, 75);
    assert.equal(result.document.data.xpLog[0].origin, 'legacy-xpTotal');
    assert.equal(result.report.syntheticXpGain, true);
    assert.equal(again.report.status, 'already-migrated');
    assert.deepEqual(again.document, result.document);

    const noJournal = await migrateFicheDocument(fiche({ xpTotal: 20 }), { charId: 'char-b' });
    assert.deepEqual(noJournal.document.data.xpLog.map(row => row.montant), [20]);
});

test('un gain existant empêche de synthétiser xpTotal, sans réécrire le journal', async () => {
    const source = fiche({ xpTotal: 99, xpLog: [{ kind: 'gain', montant: 30 }] });
    const result = await migrateFicheDocument(source, { charId: 'char-c' });
    assert.equal(result.report.syntheticXpGain, false);
    assert.equal(result.document.data.xpLog.length, 1);
    assert.equal(result.document.data.xpLog[0].montant, 30);
});

test('IDs existants sont conservés et les collisions bloquent sans renommer les lignes', async () => {
    const source = fiche({
        careers: [{ id: 'keep-me', nom: 'A' }],
        talentsAcq: [{ id: 'duplicate', nom: 'B' }],
        xpLog: [{ id: 'duplicate', applied: true, cout: 20 }],
    });
    const result = await migrateFicheDocument(source, { charId: 'test' });
    assert.equal(result.canApply, false);
    assert.equal(result.document, null);
    assert.ok(result.report.blocked.some(value => value.endsWith(':id-collision')));
    assert.equal(source.data.careers[0].id, 'keep-me');
    assert.equal(source.data.xpLog[0].purchaseId, undefined);
});

test('les types de collection invalides sont signalés et ne sont pas convertis en tableau vide', async () => {
    const source = fiche({ skillsAdvanced: null, xpLog: -1 });
    const result = await migrateFicheDocument(source, { charId: 'test' });
    assert.equal(result.canApply, false);
    assert.ok(result.report.blocked.includes('data.skillsAdvanced:array-not-array'));
    assert.ok(result.report.blocked.includes('data.xpLog:array-not-array'));
    assert.equal(source.data.skillsAdvanced, null);
    assert.equal(source.data.xpLog, -1);
});

test('les montants historiques atypiques restent intacts et deviennent des anomalies non bloquantes', async () => {
    const source = fiche({ xpTotal: -12, xpLog: [{ kind: 'gain', montant: -20 }, { cout: -50, applied: false }] });
    const result = await migrateFicheDocument(source, { charId: 'test' });
    assert.equal(result.canApply, true);
    assert.deepEqual(result.document.data.xpLog.map(row => row.montant ?? row.cout), [-20, -50]);
    assert.equal(result.document.data.xpTotal, -12);
    assert.ok(result.report.anomalies.some(item => item.code === 'legacy-xp-total-negative'));
});

test('un tombstone garde sa révision et bloque une fiche effacée sans révision', async () => {
    const deleted = await migrateFicheDocument({ ...fiche({}), schemaVersion: 1, revision: 8, tombstone: true }, { charId: 'test' });
    assert.equal(deleted.canApply, true);
    assert.equal(deleted.document.revision, 8);
    assert.equal(deleted.document.tombstone, true);

    const broken = await migrateFicheDocument({ ...fiche({}), tombstone: true }, { charId: 'test' });
    assert.equal(broken.canApply, false);
    assert.ok(broken.report.blocked.includes('revision:tombstone-revision-missing'));
});

test('un marqueur V2 ne masque ni une révision invalide, ni des types ou IDs incomplets', async () => {
    const marker = { ficheSchemaVersion: 2 };
    const invalidRevision = await migrateFicheDocument({
        ...fiche({}), schemaVersion: 2, revision: -1, migration: marker,
    }, { charId: 'test' });
    assert.equal(invalidRevision.canApply, false);
    assert.ok(invalidRevision.report.blocked.includes('revision:revision-invalid'));

    const invalidArray = await migrateFicheDocument({
        ...fiche({ careers: 'ancienne-valeur' }), schemaVersion: 2, revision: 4, migration: marker,
    }, { charId: 'test' });
    assert.equal(invalidArray.canApply, false);
    assert.ok(invalidArray.report.blocked.includes('data.careers:array-not-array'));

    const missingId = await migrateFicheDocument({
        ...fiche({ careers: [{ nom: 'Fiche anonyme' }] }), schemaVersion: 2, revision: 4, migration: marker,
    }, { charId: 'test' });
    assert.equal(missingId.canApply, false);
    assert.ok(missingId.report.blocked.includes('data.careers[0].id:schema2-id-missing'));
    assert.equal(JSON.stringify(missingId.report).includes('Fiche anonyme'), false);
});

test('les chemins de migration sont absolus, distincts et hors dépôt même en dry-run', () => {
    const args = parseArgs([
        '--input=/private/fiche.json', '--out=/private/rapport.json', '--char-id=test',
    ]);
    assert.equal(args.apply, false);
    assert.deepEqual(validateOptions(args, '/repo'), []);
    assert.equal(isOutsideRepository('/repo/fiche.json', '/repo'), false);
    assert.ok(validateOptions({ ...args, out: '/repo/rapport.json' }, '/repo')
        .some(message => message.includes('--out doit être hors du dépôt')));
    assert.ok(validateOptions({ ...args, input: args.out }, '/repo')
        .some(message => message.includes('distinct')));
});

test('le CLI dry-run n’écrit qu’un rapport et --apply produit un nouveau fichier avec manifeste', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fiche-migration-'));
    try {
        const input = join(directory, 'fiche-v1.json');
        const dryRun = join(directory, 'rapport.json');
        const output = join(directory, 'fiche-v2.json');
        const manifest = join(directory, 'manifeste.json');
        const source = fiche({ nom: 'Fiche anonyme', careers: [{ nom: 'Archiviste', rang: -1 }] });
        await writeFile(input, JSON.stringify(source), 'utf8');

        const simulation = await runMigration({ input, out: dryRun, charId: 'fixture', apply: false });
        const report = JSON.parse(await readFile(dryRun, 'utf8'));
        assert.equal(simulation.appliedToNewFile, false);
        assert.equal(report.mode, 'dry-run');
        assert.equal(JSON.stringify(report).includes('Fiche anonyme'), false);
        assert.equal(JSON.parse(await readFile(input, 'utf8')).data.careers[0].rang, -1);

        const applied = await runMigration({ input, out: output, manifest, charId: 'fixture', apply: true });
        const migrated = JSON.parse(await readFile(output, 'utf8'));
        const migrationReport = JSON.parse(await readFile(manifest, 'utf8'));
        assert.equal(applied.appliedToNewFile, true);
        assert.equal(migrated.revision, 1);
        assert.equal(migrated.data.careers[0].rang, -1);
        assert.match(migrated.data.careers[0].id, /^mig_[a-f0-9]{32}$/u);
        assert.equal(migrationReport.mode, 'applied-to-new-file');
        assert.equal(JSON.parse(await readFile(input, 'utf8')).data.careers[0].id, undefined);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

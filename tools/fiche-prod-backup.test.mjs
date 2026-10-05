import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    ARCHIVE_FORMAT,
    CHARACTER_IDS,
    PROJECT,
    createAuthorizedUserFirestore,
    decryptArchive,
    deserializeFirestoreValue,
    ensureOutsideDirectory,
    encryptArchive,
    parseArgs,
    preflightPayload,
    publicOutput,
    serializeFirestoreValue,
    runBackup,
    validateArgs,
    validateBackupPayload,
    verifyPayloadFingerprints,
    wrapKeyDpapi,
    unwrapKeyDpapi,
} from './fiche-prod-backup.mjs';

const requireFunctions = createRequire(new globalThis.URL('../functions/package.json', import.meta.url));
const outside = resolve(tmpdir(), 'wfrp-fiche-prod-synthetic-backups');
const archivePath = join(outside, 'synthetic.dpapi.json');
const args = command => parseArgs(command);

function protectForTest(key) { return `wrapped:${key.toString('base64')}`; }
function unprotectForTest(wrapped) { return Buffer.from(wrapped.slice('wrapped:'.length), 'base64'); }

class TimestampFake {
    constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
    toDate() { return new Date(this.seconds * 1000 + this.nanoseconds / 1e6); }
    toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
}

function validArgs(command, extra = []) {
    const common = [`--project=${PROJECT}`];
    if (command === 'backup') return args([command, ...common,
        `--confirm-ids=${CHARACTER_IDS.join(',')}`, `--out-dir=${outside}`, ...extra]);
    return args([command, ...common, `--backup=${archivePath}`, ...extra]);
}

function payloadFor(document) {
    return {
        format: ARCHIVE_FORMAT,
        project: PROJECT,
        capturedAt: '2026-10-05T12:00:00.000Z',
        records: CHARACTER_IDS.map(charId => ({
            charId,
            exists: charId === 'bhelgi',
            sourceFingerprint: charId === 'bhelgi' ? 'f'.repeat(64) : null,
            document: charId === 'bhelgi' ? document : null,
            descendants: [],
        })),
    };
}

test('garde opérateur limite le projet, les cinq IDs et les chemins hors dépôt', () => {
    assert.deepEqual(validateArgs(validArgs('backup')), []);
    assert.match(validateArgs(args(['backup', '--project=autre', '--confirm-ids=test', `--out-dir=${outside}`])).join(' '), /campagne-wrpg/);
    assert.match(validateArgs(args(['backup', `--project=${PROJECT}`, `--confirm-ids=${[...CHARACTER_IDS, 'test'].join(',')}`, `--out-dir=${outside}`])).join(' '), /exactement/);
    assert.match(validateArgs(args(['backup', `--project=${PROJECT}`, `--confirm-ids=${CHARACTER_IDS.join(',')}`, '--out-dir=relative'])).join(' '), /absolu/);
    const repoRoot = resolve(tmpdir(), 'wfrp-fiche-backup-args-repo');
    const insideRepo = resolve(repoRoot, 'bad.json');
    assert.match(validateArgs(args(['preflight', `--project=${PROJECT}`, `--backup=${insideRepo}`]), { repoRoot }).join(' '), /hors du dépôt/);
    assert.match(validateArgs(args(['apply', `--project=${PROJECT}`, `--backup=${archivePath}`])).join(' '), /commande/);
});

test('le chemin final est vérifié après résolution des liens et création du dossier', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fiche-operator-path-'));
    const insideRepo = resolve(root, 'repo');
    const elsewhere = resolve(root, 'outside');
    await import('node:fs/promises').then(fs => Promise.all([
        fs.mkdir(insideRepo, { recursive: true }), fs.mkdir(elsewhere, { recursive: true }),
    ]));
    try {
        assert.equal(await ensureOutsideDirectory(elsewhere, { repoRoot: insideRepo }), elsewhere);
        assert.equal(await ensureOutsideDirectory(insideRepo, { repoRoot: insideRepo }).then(() => false, () => true), true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('l’enveloppe chiffrée authentifie le contenu et le test round-trip ne dépend pas de DPAPI', () => {
    const payload = { format: ARCHIVE_FORMAT, project: PROJECT, records: [] };
    const encrypted = encryptArchive(payload, { protectKey: protectForTest });
    assert.equal(encrypted.toString('utf8').includes(PROJECT), false);
    assert.deepEqual(decryptArchive(encrypted, { unprotectKey: unprotectForTest }), payload);
    const brokenObject = JSON.parse(encrypted.toString('utf8'));
    brokenObject.ciphertext = `${brokenObject.ciphertext[0] === 'A' ? 'B' : 'A'}${brokenObject.ciphertext.slice(1)}`;
    const broken = Buffer.from(JSON.stringify(brokenObject));
    assert.throws(() => decryptArchive(broken, { unprotectKey: unprotectForTest }));
});

test('DPAPI CurrentUser round-trip un secret synthétique sous Windows PowerShell', { skip: process.platform !== 'win32' }, () => {
    const secret = Buffer.from('cle-uniquement-fictive-00000000000');
    const wrapped = wrapKeyDpapi(secret);
    assert.notEqual(wrapped, secret.toString('base64'));
    assert.deepEqual(unwrapKeyDpapi(wrapped), secret);
});

test('les valeurs Firestore typées conservent le fingerprint des timestamps avant et après archivage', async () => {
    const data = { createdAt: new TimestampFake(1_800_000_000, 123_456_789), nested: [new Date('2020-01-02T03:04:05.000Z')] };
    const encoded = serializeFirestoreValue(data);
    const decoded = deserializeFirestoreValue(encoded, { Timestamp: TimestampFake });
    const { ficheFingerprint } = await import('../js/fiche-schema.js');
    assert.equal(await ficheFingerprint(data), await ficheFingerprint(decoded));
});

test('le validateur refuse un sixième ID, un ordre différent ou un document déclaré absent incohérent', () => {
    const payload = payloadFor({ schemaVersion: 1, revision: 1, data: {} });
    assert.equal(validateBackupPayload(payload), true);
    assert.throws(() => validateBackupPayload({ ...payload, records: [...payload.records, payload.records[0]] }));
    assert.throws(() => validateBackupPayload({ ...payload, records: [...payload.records].reverse() }));
    const malformed = globalThis.structuredClone(payload);
    malformed.records[0].exists = false;
    assert.throws(() => validateBackupPayload(malformed));
});

test('backup de test injecté parcourt uniquement les cinq IDs et vérifie tout le sous-arbre chiffré', async () => {
    const output = await mkdtemp(join(tmpdir(), 'fiche-operator-test-'));
    const visited = [];
    const sourceData = { schemaVersion: 1, revision: 2, data: { skillsBasic: {} } };
    const timestampTypes = { Timestamp: TimestampFake };
    const makeRef = path => ({
        path,
        get: async () => {
            visited.push(path);
            return path === 'fiches/bhelgi'
                ? { exists: true, data: () => sourceData, ref: makeRef(path) }
                : { exists: false };
        },
        listCollections: async () => path === 'fiches/bhelgi'
            ? [{ id: 'history', get: async () => ({ docs: [{ id: 'entry-a', data: () => ({ revision: 1 }), ref: makeRef(`${path}/history/entry-a`) }] }) }]
            : [],
    });
    const createClient = async () => ({
        db: { doc: makeRef },
        types: {
            ...timestampTypes,
            firestore: { doc: refPath => makeRef(refPath) },
        },
        app: { delete: async () => {} },
    });
    try {
        const result = await runBackup({ ...validArgs('backup'), outDir: output }, {
            createClient,
            platform: 'win32',
            protectKey: protectForTest,
            unprotectKey: unprotectForTest,
        });
        assert.equal(result.records.length, 5);
        assert.equal(result.records[0].descendantCount, 1);
        assert.deepEqual(visited, CHARACTER_IDS.map(charId => `fiches/${charId}`));
        assert.equal((await readdir(output)).length, 1);
    } finally {
        await rm(output, { recursive: true, force: true });
    }
});

test('le préflight chiffre/simule uniquement les cinq fiches et sépare blockers des avertissements métier', async () => {
    const source = {
        schemaVersion: 1,
        revision: 7,
        updatedAt: new TimestampFake(1_800_000_000, 987),
        data: {
            xpTotal: 50,
            xpLog: [{ kind: 'purchase', cout: 10, raison: 'legacy sans liaison' }],
            skillsBasic: { Athlétisme: '2' },
            skillsAdvanced: [{ nom: 'Esquive', adv: -1 }],
            carac: { cc: { adv: 0 } },
            careers: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [],
        },
    };
    const encoded = serializeFirestoreValue(source);
    const dbTypes = { Timestamp: TimestampFake };
    const decoded = deserializeFirestoreValue(encoded, dbTypes);
    const { ficheFingerprint } = await import('../js/fiche-schema.js');
    const fingerprint = await ficheFingerprint(decoded);
    const fixture = payloadFor(encoded);
    fixture.records[0].sourceFingerprint = fingerprint;
    const report = await preflightPayload(fixture, dbTypes);
    assert.equal(report.records.length, 5);
    assert.equal(report.noStructuralBlockers, false);
    assert.equal(report.requiresReview, true);
    const row = report.records[0];
    assert.equal(row.status, 'ready');
    assert.equal(row.xpTotalsPreserved, true);
    assert.equal(row.numericReview.numericStrings, 1);
    assert.equal(row.numericReview.negativeValues, 1);
    assert.ok(row.warnings > 0);
    assert.equal(report.records[1].status, 'missing');
    assert.equal(report.records[1].blockers, 1);
    assert.equal(Object.hasOwn(row, 'sourceDocument'), false);
    assert.equal(JSON.stringify(report).includes('Esquive'), false);
    assert.equal(JSON.stringify(report).includes('"gained":50'), false);
    assert.equal(await verifyPayloadFingerprints(fixture, dbTypes), true);
    assert.equal(publicOutput(report).includes('"gained":50'), false);
    assert.equal(publicOutput(report).includes('"spent":10'), false);
});

test('un personnage manquant est un blocage structurel et le client Firestore reçoit OAuth authorized_user en mémoire', async () => {
    const fixture = {
        format: ARCHIVE_FORMAT,
        project: PROJECT,
        records: CHARACTER_IDS.map(charId => ({
            charId, exists: false, sourceFingerprint: null, document: null, descendants: [],
        })),
    };
    const report = await preflightPayload(fixture);
    assert.equal(report.noStructuralBlockers, false);
    assert.equal(report.requiresReview, true);
    assert.ok(report.records.every(row => row.status === 'missing' && row.blockers === 1));

    let settings;
    class FirestoreFake { constructor(value) { settings = value; } }
    const db = createAuthorizedUserFirestore({
        Firestore: FirestoreFake,
        clientId: 'synthetic-oauth-client-id',
        clientSecret: 'synthetic-oauth-app-secret',
        refreshToken: 'synthetic-user-refresh-token',
    });
    assert.ok(db instanceof FirestoreFake);
    assert.equal(settings.projectId, PROJECT);
    assert.equal(settings.preferRest, true);
    assert.deepEqual(settings.credentials, {
        type: 'authorized_user',
        client_id: 'synthetic-oauth-client-id',
        client_secret: 'synthetic-oauth-app-secret',
        refresh_token: 'synthetic-user-refresh-token',
    });
    assert.throws(() => createAuthorizedUserFirestore({
        Firestore: FirestoreFake, clientId: 'x', clientSecret: 'y', refreshToken: 'z', projectId: 'other',
    }), /configuration/u);
    const { Firestore } = requireFunctions('firebase-admin/firestore');
    const firestore = createAuthorizedUserFirestore({
        Firestore,
        clientId: 'synthetic-oauth-client-id.apps.googleusercontent.com',
        clientSecret: 'synthetic-oauth-app-secret',
        refreshToken: 'synthetic-user-refresh-token',
    });
    assert.equal(typeof firestore.doc, 'function');
    await firestore.terminate();
});

test('le préflight accepte seulement les anomalies historiques XP connues si les totaux restent strictement préservés', async () => {
    const { ficheFingerprint } = await import('../js/fiche-schema.js');
    const makePayload = async xpLog => {
        const source = {
            schemaVersion: 1,
            revision: 3,
            data: {
                xpTotal: '10',
                xpLog,
                skillsAdvanced: [], careers: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [],
            },
        };
        const document = serializeFirestoreValue(source);
        const sourceFingerprint = await ficheFingerprint(source);
        return {
            format: ARCHIVE_FORMAT,
            project: PROJECT,
            records: CHARACTER_IDS.map(charId => ({
                charId, exists: true, sourceFingerprint, document, descendants: [],
            })),
        };
    };

    const expectedLegacy = await preflightPayload(await makePayload([
        { applied: true, type: 'Compétence', cout: 2 },
        { kind: 'carac', cout: 1 },
        { kind: 'gain', montant: 3 },
    ]), { Timestamp: TimestampFake });
    assert.equal(expectedLegacy.noStructuralBlockers, true);
    assert.equal(expectedLegacy.requiresReview, false);
    assert.ok(expectedLegacy.records.every(row => row.xpTotalsPreserved && row.numericReview.xpEntryIssues === 0));
    assert.ok(expectedLegacy.records.every(row => row.anomalyCodes.includes('legacy-applied-purchase-unlinked')
        && row.anomalyCodes.includes('legacy-xp-value-string')));

    const unknown = await preflightPayload(await makePayload([{ kind: 'unknown', cout: 2 }]), { Timestamp: TimestampFake });
    assert.equal(unknown.records[0].numericReview.xpEntryIssues, 1);
    assert.equal(unknown.records[0].requiresReview, true);
});

test('aucun dossier ne peut être collecté en dehors de la liste autorisée', async () => {
    const { collectFicheTree } = await import('./fiche-prod-backup.mjs');
    let paths = [];
    const db = { doc(path) { paths.push(path); return { get: async () => ({ exists: false }) }; } };
    await assert.rejects(() => collectFicheTree(db, 'test'));
    assert.deepEqual(paths, []);
});
import { Buffer } from 'node:buffer';

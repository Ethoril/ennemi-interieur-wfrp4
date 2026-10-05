// Sauvegarde et préflight opérateur, strictement en lecture. Aucun mode d'écriture Firebase.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ficheFingerprint, migrateFicheDocument, stableJson } from '../js/fiche-schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const PROJECT = 'campagne-wrpg';
export const CHARACTER_IDS = Object.freeze(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']);
export const ARCHIVE_FORMAT = 'wfrp-fiche-prod-backup-v1';
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
export const MAX_DOCUMENTS = 20_000;
const require = createRequire(import.meta.url);

const option = (argv, name) => argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

export function parseArgs(argv = process.argv.slice(2)) {
    const [command = null, ...rest] = argv;
    return {
        command,
        project: option(rest, 'project'),
        confirmIds: option(rest, 'confirm-ids'),
        outDir: option(rest, 'out-dir'),
        backup: option(rest, 'backup'),
        help: rest.includes('--help') || rest.includes('-h'),
    };
}

export function isOutsideRepository(path, repoRoot = REPO_ROOT) {
    const fromRepo = relative(resolve(repoRoot), resolve(path));
    return fromRepo === '..' || fromRepo.startsWith(`..${sep}`) || isAbsolute(fromRepo);
}

export function validateArgs(args, { repoRoot = REPO_ROOT } = {}) {
    const errors = [];
    if (!['backup', 'verify', 'preflight'].includes(args.command)) errors.push('commande backup, verify ou preflight requise');
    if (args.project !== PROJECT) errors.push(`--project=${PROJECT} obligatoire`);
    if (args.command === 'backup') {
        if (args.confirmIds !== CHARACTER_IDS.join(',')) errors.push(`--confirm-ids doit lister exactement ${CHARACTER_IDS.join(',')}`);
        if (!args.outDir || !isAbsolute(args.outDir)) errors.push('--out-dir absolu obligatoire');
        else if (!isOutsideRepository(args.outDir, repoRoot)) errors.push('--out-dir doit être hors du dépôt');
    }
    if (['verify', 'preflight'].includes(args.command)) {
        if (!args.backup || !isAbsolute(args.backup)) errors.push('--backup absolu obligatoire');
        else if (!isOutsideRepository(args.backup, repoRoot)) errors.push('--backup doit être hors du dépôt');
    }
    return errors;
}

export function serializeFirestoreValue(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return { __backupType: 'number', value: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
    }
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Date) return { __backupType: 'date', value: value.toISOString() };
    const isTimestamp = value.constructor?.name === 'Timestamp'
        || (typeof value.toDate === 'function' && Number.isInteger(value.seconds ?? value._seconds));
    if (isTimestamp) return {
        __backupType: 'timestamp',
        seconds: Number(value.seconds ?? value._seconds),
        nanoseconds: Number(value.nanoseconds ?? value._nanoseconds ?? 0),
    };
    if (typeof value.toBase64 === 'function') return { __backupType: 'bytes', value: value.toBase64() };
    if (Number.isFinite(value.latitude) && Number.isFinite(value.longitude)) {
        return { __backupType: 'geopoint', latitude: value.latitude, longitude: value.longitude };
    }
    if (typeof value.path === 'string' && value.firestore) return { __backupType: 'reference', path: value.path };
    if (Array.isArray(value)) return value.map(serializeFirestoreValue);
    const map = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestoreValue(item)]));
    return Object.hasOwn(value, '__backupType') ? { __backupType: 'map', value: map } : map;
}

export function deserializeFirestoreValue(value, types, { literalMapRoot = false } = {}) {
    if (Array.isArray(value)) return value.map(item => deserializeFirestoreValue(item, types));
    if (!value || typeof value !== 'object') return value;
    if (literalMapRoot) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserializeFirestoreValue(item, types)]));
    if (value.__backupType === 'map') return deserializeFirestoreValue(value.value, types, { literalMapRoot: true });
    if (value.__backupType === 'timestamp') return new types.Timestamp(value.seconds, value.nanoseconds);
    if (value.__backupType === 'date') return new Date(value.value);
    if (value.__backupType === 'bytes') return types.Bytes.fromBase64String(value.value);
    if (value.__backupType === 'geopoint') return new types.GeoPoint(value.latitude, value.longitude);
    if (value.__backupType === 'reference') return types.firestore.doc(value.path);
    if (value.__backupType === 'number') return ({ NaN: Number.NaN, Infinity: Number.POSITIVE_INFINITY, '-Infinity': Number.NEGATIVE_INFINITY })[value.value];
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserializeFirestoreValue(item, types)]));
}

function runPowerShell(script, input) {
    const powershellModulePath = [
        process.env.USERPROFILE && resolve(process.env.USERPROFILE, 'Documents/WindowsPowerShell/Modules'),
        process.env.ProgramFiles && resolve(process.env.ProgramFiles, 'WindowsPowerShell/Modules'),
        process.env.WINDIR && resolve(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/Modules'),
    ].filter(Boolean).join(';');
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
        input,
        encoding: 'utf8',
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, PSModulePath: powershellModulePath },
    });
    if (result.error || result.status !== 0 || !result.stdout.trim()) throw new Error('DPAPI CurrentUser indisponible');
    return result.stdout.trim();
}

export function wrapKeyDpapi(key, powershell = runPowerShell) {
    const script = "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $s=[Console]::In.ReadToEnd(); $ss=ConvertTo-SecureString -String $s -AsPlainText -Force; ConvertFrom-SecureString -SecureString $ss";
    return powershell(script, key.toString('base64'));
}

export function unwrapKeyDpapi(wrapped, powershell = runPowerShell) {
    const script = "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; $s=[Console]::In.ReadToEnd(); $ss=ConvertTo-SecureString -String $s; $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }";
    return Buffer.from(powershell(script, wrapped), 'base64');
}

export function encryptArchive(payload, { protectKey = wrapKeyDpapi } = {}) {
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    if (plaintext.length > MAX_BACKUP_BYTES) throw new Error('archive dépasse le plafond de 100 MiB');
    const key = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const archive = {
        format: ARCHIVE_FORMAT,
        encryption: 'AES-256-GCM + DPAPI-CurrentUser',
        wrappedKey: protectKey(key),
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertextSha256: createHash('sha256').update(ciphertext).digest('hex'),
        ciphertext: ciphertext.toString('base64'),
    };
    key.fill(0);
    return Buffer.from(`${JSON.stringify(archive)}\n`, 'utf8');
}

export function decryptArchive(bytes, { unprotectKey = unwrapKeyDpapi } = {}) {
    const archive = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (archive.format !== ARCHIVE_FORMAT || archive.encryption !== 'AES-256-GCM + DPAPI-CurrentUser') {
        throw new Error('format de sauvegarde inconnu');
    }
    const ciphertext = Buffer.from(archive.ciphertext, 'base64');
    const digest = createHash('sha256').update(ciphertext).digest('hex');
    if (digest !== archive.ciphertextSha256) throw new Error('intégrité de la sauvegarde invalide');
    const key = unprotectKey(archive.wrappedKey);
    if (key.length !== 32) throw new Error('clé DPAPI invalide');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(archive.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(archive.tag, 'base64'));
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    key.fill(0);
    if (plaintext.length > MAX_BACKUP_BYTES) throw new Error('archive déchiffrée dépasse le plafond');
    return JSON.parse(plaintext.toString('utf8'));
}

export async function collectFicheTree(db, charId, { maxDocuments = MAX_DOCUMENTS } = {}) {
    if (!CHARACTER_IDS.includes(charId)) throw new Error('personnage hors liste autorisée');
    const rootRef = db.doc(`fiches/${charId}`);
    const rootSnap = await rootRef.get();
    let count = rootSnap.exists ? 1 : 0;
    const record = { charId, exists: rootSnap.exists, sourceFingerprint: null, document: null, descendants: [] };
    if (rootSnap.exists) {
        const source = rootSnap.data();
        record.sourceFingerprint = await ficheFingerprint(source);
        record.document = serializeFirestoreValue(source);
    }
    const visit = async (documentRef, path) => {
        const collections = await documentRef.listCollections();
        for (const collection of collections) {
            const query = await collection.get();
            for (const child of query.docs) {
                count += 1;
                if (count > maxDocuments) throw new Error('sous-arbre dépasse le plafond de documents; aucune archive écrite');
                const data = child.data();
                const childPath = `${path}/${collection.id}/${child.id}`;
                record.descendants.push({
                    path: childPath,
                    fingerprint: await ficheFingerprint(data),
                    document: serializeFirestoreValue(data),
                });
                await visit(child.ref, childPath);
            }
        }
    };
    await visit(rootRef, `fiches/${charId}`);
    return record;
}

export function validateBackupPayload(payload, expectedProject = PROJECT) {
    if (!payload || payload.format !== ARCHIVE_FORMAT || payload.project !== expectedProject
        || !Array.isArray(payload.records) || payload.records.length !== CHARACTER_IDS.length) {
        throw new Error('manifeste de sauvegarde invalide');
    }
    for (let i = 0; i < CHARACTER_IDS.length; i++) {
        const record = payload.records[i];
        if (record?.charId !== CHARACTER_IDS[i] || typeof record.exists !== 'boolean' || !Array.isArray(record.descendants)) {
            throw new Error('liste des personnages de sauvegarde invalide');
        }
        if (record.exists !== (typeof record.sourceFingerprint === 'string' && record.document !== null)) {
            throw new Error('état de fiche incohérent dans la sauvegarde');
        }
        if (record.exists && !/^[a-f0-9]{64}$/u.test(record.sourceFingerprint)) throw new Error('empreinte de fiche invalide');
        for (const descendant of record.descendants) {
            if (!descendant || typeof descendant.path !== 'string'
                || !descendant.path.startsWith(`fiches/${record.charId}/`)
                || !/^[a-f0-9]{64}$/u.test(descendant.fingerprint)
                || !descendant.document || typeof descendant.document !== 'object') {
                throw new Error('sous-document de sauvegarde invalide');
            }
        }
    }
    return true;
}

function migrationShapePreserved(before, after, report) {
    const original = globalThis.structuredClone(before);
    const migrated = globalThis.structuredClone(after);
    for (const item of report.assignedIds) {
        if (item.index === 'xpTotal') {
            migrated.xpLog?.shift();
        } else if (Array.isArray(migrated[item.field]) && migrated[item.field][item.index]) {
            delete migrated[item.field][item.index].id;
        }
    }
    if (!Object.hasOwn(original, 'xpLog') && Array.isArray(migrated.xpLog) && !migrated.xpLog.length) delete migrated.xpLog;
    for (let i = 0; i < (original.xpLog?.length ?? 0); i++) {
        const oldRow = original.xpLog[i];
        const newRow = migrated.xpLog?.[i];
        if (oldRow && !Object.hasOwn(oldRow, 'origin') && newRow) delete newRow.origin;
    }
    return stableJson(original) === stableJson(migrated);
}

function countNumericReview(data) {
    const counts = {
        numericStrings: 0,
        negativeValues: 0,
        nonIntegerValues: 0,
        nonFiniteValues: 0,
        negativeAdvanceValues: 0,
        nonIntegerAdvanceValues: 0,
        negativeXpValues: 0,
        xpNonNumericValues: 0,
        xpEntryIssues: 0,
        xpGainEntries: 0,
        xpCostEntries: 0,
        xpLegacyTypedCostEntries: 0,
        xpLegacyKindCostEntries: 0,
        xpUnlinkedAppliedPurchases: 0,
    };
    const inspect = (value, category) => {
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) counts.nonFiniteValues++;
            else {
                if (value < 0) {
                    counts.negativeValues++;
                    if (category === 'advance') counts.negativeAdvanceValues++;
                    if (category === 'xp') counts.negativeXpValues++;
                }
                if (!Number.isSafeInteger(value)) {
                    counts.nonIntegerValues++;
                    if (category === 'advance') counts.nonIntegerAdvanceValues++;
                }
            }
        } else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(+value)) {
            counts.numericStrings++;
        } else if (category === 'xp') counts.xpNonNumericValues++;
    };
    const legacyTypes = new Set(['Caractéristique', 'Compétence', 'Talent', 'Carrière', 'Sort', 'Miracle', 'Autre']);
    const legacyKindsWithCost = new Set([
        'advance', 'carac', 'caracteristique', 'skill', 'competence', 'talent',
        'career', 'carriere', 'rank', 'rang', 'spell', 'sort', 'miracle',
    ]);
    for (const value of Object.values(data.skillsBasic ?? {})) inspect(value, 'advance');
    for (const row of Array.isArray(data.skillsAdvanced) ? data.skillsAdvanced : []) inspect(row?.adv, 'advance');
    for (const value of Object.values(data.carac ?? {})) inspect(value?.adv, 'advance');
    if (Object.hasOwn(data, 'xpTotal')) inspect(data.xpTotal, 'xp');
    if (Array.isArray(data.xpLog)) {
        for (const entry of data.xpLog) {
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
                counts.xpEntryIssues++;
                continue;
            }
            const kind = typeof entry.kind === 'string' ? entry.kind.toLowerCase() : '';
            const legacyType = typeof entry.type === 'string' && legacyTypes.has(entry.type);
            const legacyKind = legacyKindsWithCost.has(kind);
            const currentKind = ['gain', 'purchase', 'correction'].includes(kind);
            if (!currentKind && !legacyKind && !legacyType) {
                counts.xpEntryIssues++;
                continue;
            }
            const field = kind === 'gain' ? 'montant' : 'cout';
            if (!Object.hasOwn(entry, field)) {
                counts.xpEntryIssues++;
                counts.xpNonNumericValues++;
            } else {
                inspect(entry[field], 'xp');
                if (kind === 'gain') counts.xpGainEntries++;
                else if (legacyType) counts.xpLegacyTypedCostEntries++;
                else if (legacyKind) counts.xpLegacyKindCostEntries++;
                else counts.xpCostEntries++;
            }
            if (entry.applied === true && !Object.hasOwn(entry, 'purchaseId')) counts.xpUnlinkedAppliedPurchases++;
        }
    }
    return counts;
}

export async function preflightPayload(payload, types = {}) {
    validateBackupPayload(payload);
    const rows = [];
    for (const record of payload.records) {
        if (!record.exists) {
            rows.push({ charId: record.charId, status: 'missing', descendants: record.descendants.length,
                blockers: 1, warnings: 0, requiresReview: true });
            continue;
        }
        const source = types.Timestamp
            ? deserializeFirestoreValue(record.document, types)
            : record.document;
        const { document, report, canApply } = await migrateFicheDocument(source, { charId: record.charId });
        const mismatch = canApply && !migrationShapePreserved(source.data, document.data, report);
        const review = countNumericReview(source.data ?? {});
        const blockers = report.blocked.length + Number(mismatch);
        const warningCount = report.anomalies.length + Object.values(review).reduce((sum, value) => sum + value, 0);
        const expectedLegacyAnomalies = new Set(['legacy-applied-purchase-unlinked', 'legacy-xp-value-string']);
        const unexpectedAnomaly = report.anomalies.some(item => !expectedLegacyAnomalies.has(item.code));
        const xpTotalsPreserved = stableJson(report.xpBefore) === stableJson(report.xpAfter);
        const requiresReview = blockers > 0 || !canApply || !xpTotalsPreserved || unexpectedAnomaly
            || review.negativeValues > 0 || review.nonIntegerValues > 0 || review.nonFiniteValues > 0
            || review.xpNonNumericValues > 0 || review.xpEntryIssues > 0;
        rows.push({
            charId: record.charId,
            status: mismatch ? 'blocked' : report.status,
            revision: report.sourceRevision,
            sourceFingerprint: report.sourceFingerprint,
            descendants: record.descendants.length,
            arraysBefore: report.arrayCountsBefore,
            arraysAfter: report.arrayCountsAfter,
            assignedIds: report.assignedIds.length,
            syntheticXpGain: report.syntheticXpGain,
            xpTotalsPreserved,
            numericReview: review,
            anomalyCodes: report.anomalies.map(item => item.code).filter(Boolean),
            blockers,
            warnings: warningCount,
            requiresReview,
            canApply,
        });
    }
    return {
        project: payload.project,
        records: rows,
        noStructuralBlockers: rows.every(row => row.blockers === 0),
        requiresReview: rows.some(row => row.requiresReview),
    };
}

export function createAuthorizedUserFirestore({ Firestore, clientId, clientSecret, refreshToken, projectId = PROJECT } = {}) {
    if (typeof Firestore !== 'function' || typeof clientId !== 'string' || !clientId
        || typeof clientSecret !== 'string' || !clientSecret || typeof refreshToken !== 'string' || !refreshToken
        || projectId !== PROJECT) {
        throw new Error('configuration Firestore lecture seule invalide');
    }
    return new Firestore({
        projectId,
        credentials: { type: 'authorized_user', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken },
        preferRest: true,
    });
}

function configuredAdminEmail(repoRoot = REPO_ROOT) {
    const rules = require('node:fs').readFileSync(resolve(repoRoot, 'firestore.rules'), 'utf8');
    const migration = require('node:fs').readFileSync(resolve(repoRoot, 'functions/src/fiche/migration.mjs'), 'utf8');
    const ruleEmail = rules.match(/request\.auth\.token\.email\s*==\s*'([^']+)'/u)?.[1]?.toLowerCase();
    const serviceEmail = migration.match(/const ADMIN_EMAIL\s*=\s*'([^']+)'/u)?.[1]?.toLowerCase();
    if (!ruleEmail || ruleEmail !== serviceEmail) throw new Error('identité MJ incohérente entre les règles et le service');
    return ruleEmail;
}

export async function createCliAuthenticatedClient({ repoRoot = REPO_ROOT } = {}) {
    const cliAuth = require('firebase-tools/lib/auth.js');
    const scopes = require('firebase-tools/lib/scopes.js');
    const account = cliAuth.getProjectDefaultAccount(repoRoot);
    const email = account?.user?.email?.trim()?.toLowerCase();
    if (!account?.tokens?.refresh_token || !email || email !== configuredAdminEmail(repoRoot)) {
        throw new Error('compte Firebase CLI absent ou différent du compte MJ configuré');
    }
    const requestedScopes = [scopes.CLOUD_PLATFORM, scopes.OPENID, scopes.EMAIL, scopes.USERINFO_EMAIL];
    const tokenResult = await cliAuth.getAccessToken(account.tokens.refresh_token, requestedScopes);
    const accessToken = typeof tokenResult === 'string' ? tokenResult : tokenResult?.access_token;
    if (!accessToken) throw new Error('session Firebase CLI invalide');
    const identityResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo?fields=email,verified_email', {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    const identity = identityResponse.ok ? await identityResponse.json() : null;
    if (identity?.verified_email !== true || identity?.email?.trim()?.toLowerCase() !== email) {
        throw new Error('identité Google vérifiée indisponible ou différente du compte Firebase CLI');
    }
    const credential = { getAccessToken: async () => {
        const refreshed = await cliAuth.getAccessToken(account.tokens.refresh_token, requestedScopes);
        const token = typeof refreshed === 'string' ? refreshed : refreshed?.access_token;
        if (!token) throw new Error('session Firebase CLI expirée');
        return {
            access_token: token,
            expires_in: Math.max(60, Math.floor(((refreshed.expires_at ?? Date.now() + 3_600_000) - Date.now()) / 1000)),
        };
    } };
    const [{ initializeApp }, firestore] = await Promise.all([
        import('firebase-admin/app'), import('firebase-admin/firestore'),
    ]);
    const app = initializeApp({ credential, projectId: PROJECT }, `fiche-prod-backup-${Date.now()}`);
    let authUser;
    try {
        const { getAuth } = await import('firebase-admin/auth');
        authUser = await getAuth(app).getUserByEmail(email);
        if (authUser.emailVerified !== true || authUser.email?.trim()?.toLowerCase() !== email) {
            throw new Error('identité Firebase Auth non vérifiée');
        }
    } catch {
        await app.delete().catch(() => {});
        throw new Error('compte MJ Firebase Auth absent ou non vérifié');
    }
    let db;
    try {
        // Firestore Admin via getFirestore(app) exige une credential GoogleAuth compatible.
        // Le client Firestore direct accepte authorized_user en mémoire et ne crée aucun fichier ADC.
        const { Firestore } = firestore;
        const cliApi = require('firebase-tools/lib/api.js');
        db = createAuthorizedUserFirestore({
            Firestore,
            clientId: cliApi.clientId(),
            clientSecret: cliApi.clientSecret(),
            refreshToken: account.tokens.refresh_token,
        });
    } catch {
        await app.delete().catch(() => {});
        throw new Error('client Firestore lecture seule indisponible');
    }
    return {
        app: { delete: async () => {
            await db.terminate().catch(() => {});
            await app.delete().catch(() => {});
        } },
        email,
        db,
        types: {
            Timestamp: firestore.Timestamp,
            GeoPoint: firestore.GeoPoint,
            Bytes: firestore.Bytes,
            firestore: { doc: path => db.doc(path) },
        },
    };
}

async function resolveOutside(path) {
    const full = resolve(path);
    if (!isAbsolute(path)) throw new Error('chemin absolu requis');
    let parent = dirname(full);
    while (true) {
        try { await stat(parent); break; }
        catch (error) {
            if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
            const next = dirname(parent);
            if (next === parent) throw error;
            parent = next;
        }
    }
    const realParent = await realpath(parent);
    const resolvedPath = resolve(realParent, relative(parent, dirname(full)), basename(full));
    if (!isOutsideRepository(resolvedPath)) throw new Error('chemin réel dans le dépôt refusé');
    return resolvedPath;
}

export async function ensureOutsideDirectory(path, { repoRoot = REPO_ROOT } = {}) {
    const resolved = await resolveOutside(path);
    await mkdir(resolved, { recursive: true });
    const canonical = await realpath(resolved);
    if (!isOutsideRepository(canonical, repoRoot)) throw new Error('dossier réel dans le dépôt refusé');
    return canonical;
}

async function writeExclusive(path, contents) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents, { flag: 'wx' });
}

export async function runBackup(args, {
    createClient = createCliAuthenticatedClient,
    protectKey = wrapKeyDpapi,
    unprotectKey = unwrapKeyDpapi,
    platform = process.platform,
} = {}) {
    const errors = validateArgs(args);
    if (errors.length) throw new Error(errors.join('\n'));
    if (platform !== 'win32') throw new Error('backup opérateur DPAPI limité à Windows');
    const outDir = await ensureOutsideDirectory(args.outDir);
    const existing = await import('node:fs/promises').then(fs => fs.readdir(outDir));
    if (existing.length) throw new Error('dossier de sauvegarde doit être neuf et vide');
    const client = await createClient();
    const records = [];
    let path = null;
    try {
        for (const charId of CHARACTER_IDS) {
            records.push(await collectFicheTree(client.db, charId));
            if (Buffer.byteLength(JSON.stringify(records), 'utf8') > MAX_BACKUP_BYTES) {
                throw new Error('données dépassent le plafond de 100 MiB; aucune archive écrite');
            }
        }
        const payload = { format: ARCHIVE_FORMAT, project: PROJECT, capturedAt: new Date().toISOString(), records };
        const encrypted = encryptArchive(payload, { protectKey });
        path = resolve(outDir, `fiches-${new Date().toISOString().replaceAll(':', '-')}.dpapi.json`);
        await writeExclusive(path, encrypted);
        const verified = decryptArchive(await readFile(path), { unprotectKey });
        await verifyPayloadFingerprints(verified, client.types);
        return {
            path,
            records: records.map(({ charId, exists, sourceFingerprint, descendants }) => ({ charId, exists, sourceFingerprint, descendantCount: descendants.length })),
            encryptedBytes: encrypted.length,
        };
    } catch (error) {
        if (path) await import('node:fs/promises').then(fs => fs.rm(path, { force: true })).catch(() => {});
        throw error;
    } finally {
        await client.app.delete().catch(() => {});
    }
}

export async function readVerifiedBackup(path, { unprotectKey = unwrapKeyDpapi, types } = {}) {
    const realPath = await realpath(path);
    if (!isOutsideRepository(realPath)) throw new Error('sauvegarde dans le dépôt refusée');
    const bytes = await readFile(realPath);
    if (bytes.length > MAX_BACKUP_BYTES * 1.5) throw new Error('archive chiffrée dépasse le plafond');
    const payload = decryptArchive(bytes, { unprotectKey });
    validateBackupPayload(payload);
    await verifyPayloadFingerprints(payload, types);
    return { payload, encryptedBytes: bytes.length };
}

export async function verifyPayloadFingerprints(payload, types) {
    validateBackupPayload(payload);
    const decode = value => types ? deserializeFirestoreValue(value, types) : value;
    for (const record of payload.records) {
        if (record.exists && await ficheFingerprint(decode(record.document)) !== record.sourceFingerprint) {
            throw new Error('empreinte fiche invalide dans la sauvegarde');
        }
        for (const descendant of record.descendants) {
            if (await ficheFingerprint(decode(descendant.document)) !== descendant.fingerprint) {
                throw new Error('empreinte de sous-document invalide dans la sauvegarde');
            }
        }
    }
    return true;
}

export async function runPreflight(args, { unprotectKey = unwrapKeyDpapi, types } = {}) {
    const errors = validateArgs(args);
    if (errors.length) throw new Error(errors.join('\n'));
    const firestoreTypes = types ?? await import('firebase-admin/firestore');
    const dbTypes = { ...firestoreTypes, firestore: { doc: path => ({ path, firestore: {} }) } };
    const { payload, encryptedBytes } = await readVerifiedBackup(args.backup, { unprotectKey, types: dbTypes });
    const report = await preflightPayload(payload, dbTypes);
    return { ...report, archiveVerified: true, encryptedBytes };
}

export function publicOutput(result) {
    return JSON.stringify(result, null, 2);
}

function usage() {
    return [
        `node tools/fiche-prod-backup.mjs backup --project=${PROJECT} --confirm-ids=${CHARACTER_IDS.join(',')} --out-dir=<absolu hors dépôt>`,
        `node tools/fiche-prod-backup.mjs verify --project=${PROJECT} --backup=<archive DPAPI absolue>`,
        `node tools/fiche-prod-backup.mjs preflight --project=${PROJECT} --backup=<archive DPAPI absolue>`,
        'Outil Windows lecture seule : sauvegarde chiffrée DPAPI CurrentUser, vérification locale et préflight de migration. Aucun mode apply.',
    ].join('\n');
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
    const args = parseArgs();
    if (args.help) process.stdout.write(`${usage()}\n`);
    else {
        try {
            if (args.command === 'backup') process.stdout.write(publicOutput(await runBackup(args)) + '\n');
            else if (args.command === 'verify') {
                const firestoreTypes = await import('firebase-admin/firestore');
                const { payload, encryptedBytes } = await readVerifiedBackup(args.backup, {
                    types: { ...firestoreTypes, firestore: { doc: path => ({ path, firestore: {} }) } },
                });
                process.stdout.write(publicOutput({ project: payload.project, archiveVerified: true, encryptedBytes,
                    records: payload.records.map(item => ({ charId: item.charId, exists: item.exists, sourceFingerprint: item.sourceFingerprint, descendantCount: item.descendants.length })) }) + '\n');
            } else process.stdout.write(publicOutput(await runPreflight(args)) + '\n');
        } catch {
            process.stderr.write(`Opération refusée ou en échec. Aucun détail de fiche, email ou jeton n’a été affiché.\n${usage()}\n`);
            process.exitCode = 1;
        }
    }
}

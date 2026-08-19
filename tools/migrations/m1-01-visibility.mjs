// Migration M1-01 : visibilité explicite et séparation des notes MJ.
// Le mode lecture seule est volontairement le défaut : il ouvre seulement une connexion Admin
// en lecture et ne modifie jamais Firestore.
import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    PRODUCTION_BUCKET,
    PRODUCTION_PROJECT,
    createAdminClient,
    readAndVerifyFile,
    resolveBackupPath,
    validateCollectionManifest,
    validateStorageManifest,
} from '../mobile-backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../..');
export const COLLECTIONS = ['pnjs', 'relations'];
export const LEGACY_PRIVATE_KEYS = Object.freeze(['notes', 'notesMJ', 'notesPrivees', 'privateNotes']);
export const MAX_BATCH_SIZE = 400;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function optionValue(args, names) {
    const candidates = Array.isArray(names) ? names : [names];
    for (const name of candidates) {
        const prefix = `--${name}=`;
        const argument = args.find(item => item.startsWith(prefix));
        if (argument) return argument.slice(prefix.length);
    }
    return null;
}

export function parseArgs(argv = process.argv.slice(2)) {
    const [phase = null, ...args] = argv;
    const dryRun = !args.includes('--execute') || args.includes('--dry-run');
    const batchSize = Number(optionValue(args, ['batch-size', 'batch']) ?? MAX_BATCH_SIZE);
    const backupManifest = optionValue(args, ['backup-manifest', 'manifest', 'backup']);
    return {
        phase,
        command: phase,
        project: optionValue(args, 'project'),
        bucket: optionValue(args, 'bucket'),
        backupManifest,
        manifest: backupManifest,
        confirmProduction: optionValue(args, 'confirm-production'),
        state: optionValue(args, ['state', 'resume']),
        dryRun,
        execute: !dryRun,
        batchSize,
    };
}

export function isOutsideRepository(path, repoRoot = REPO_ROOT) {
    const rel = relative(resolve(repoRoot), resolve(path));
    return rel === '..' || rel.startsWith('..') || isAbsolute(rel);
}

export function validateBatchSize(batchSize) {
    return Number.isInteger(batchSize) && batchSize > 0 && batchSize <= MAX_BATCH_SIZE;
}

export function validateTarget(options, { env = process.env, repoRoot = REPO_ROOT } = {}) {
    const errors = [];
    const backupManifest = options.backupManifest ?? options.manifest;
    if (!options.phase || !['prepare', 'copy-private', 'cleanup'].includes(options.phase)) {
        errors.push('phase prepare, copy-private ou cleanup obligatoire');
    }
    if (!options.project) errors.push('--project obligatoire');
    if (!options.bucket) errors.push('--bucket obligatoire');
    if (!validateBatchSize(options.batchSize)) errors.push(`--batch-size doit être compris entre 1 et ${MAX_BATCH_SIZE}`);

    const production = options.project === PRODUCTION_PROJECT || options.bucket === PRODUCTION_BUCKET;
    if (production && (options.project !== PRODUCTION_PROJECT || options.bucket !== PRODUCTION_BUCKET)) {
        errors.push('projet et bucket de production doivent correspondre');
    }
    if (production && options.confirmProduction !== PRODUCTION_PROJECT) {
        errors.push('production refusée sans --confirm-production=campagne-wrpg');
    }
    if (production && !options.dryRun) {
        if (!backupManifest) {
            errors.push('manifeste M0 complet obligatoire pour la production');
        } else if (!isAbsolute(backupManifest)) {
            errors.push('--backup-manifest doit être un chemin absolu');
        } else if (!isOutsideRepository(backupManifest, repoRoot)) {
            errors.push('--backup-manifest doit être hors du dépôt');
        }
    }
    if (options.state && (!isAbsolute(options.state) || !isOutsideRepository(options.state, repoRoot))) {
        errors.push('--state doit être un chemin absolu hors du dépôt');
    }
    // Un émulateur est accepté, mais un nom de projet/bucket de production reste interdit :
    // cela évite qu'une variable d'environnement mal posée transforme un test en migration réelle.
    if (env.FIRESTORE_EMULATOR_HOST && production) errors.push('cible de production interdite par le runner émulateur');
    return errors;
}

export function validateEmulatorRunner({ project, bucket, env = process.env } = {}) {
    const storageHost = env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST;
    const errors = [];
    if (!env.FIRESTORE_EMULATOR_HOST || !storageHost) errors.push('émulateurs Firestore et Storage obligatoires');
    if (project === PRODUCTION_PROJECT || bucket === PRODUCTION_BUCKET) errors.push('cible de production interdite');
    if (!project || !bucket) errors.push('projet et bucket explicites obligatoires');
    return errors;
}

export async function validateBackupManifest(path, { project, bucket, repoRoot = REPO_ROOT } = {}) {
    if (!path || !isAbsolute(path) || !isOutsideRepository(path, repoRoot)) {
        throw new Error('manifeste M0 : chemin absolu hors du dépôt obligatoire');
    }
    let manifest;
    const backupRoot = dirname(path);
    try {
        manifest = JSON.parse(await readFile(path, 'utf8'));
    } catch {
        throw new Error('manifeste M0 illisible');
    }
    const expectedCollections = ['pnjs', 'pnjs_prives', 'relations', 'indices'];
    const complete = manifest?.format === 'mobile-baseline-backup'
        && manifest.version === 1
        && manifest.complete === true
        && manifest.projectId === project
        && manifest.bucket === bucket
        && expectedCollections.every(name => isRecord(manifest.collections?.[name])
            && typeof manifest.collections[name].file === 'string'
            && Number.isSafeInteger(manifest.collections[name].count)
            && manifest.collections[name].count >= 0)
        && isRecord(manifest.storage)
        && Array.isArray(manifest.storage.files)
        && manifest.storage.count === manifest.storage.files.length
        && Number.isSafeInteger(manifest.storage.totalBytes)
        && manifest.storage.totalBytes >= 0
        && manifest.storage.files.every(file => isRecord(file)
            && typeof file.path === 'string' && file.path.length > 0
            && Number.isSafeInteger(file.size) && file.size >= 0
            && typeof file.sha256 === 'string' && file.sha256.length > 0);
    if (!complete) throw new Error('manifeste M0 incomplet ou cible différente');
    for (const collection of expectedCollections) {
        const details = manifest.collections[collection];
        let documents;
        try {
            const pathToFile = resolveBackupPath(backupRoot, details.file);
            const buffer = await readAndVerifyFile(pathToFile, details, collection);
            documents = JSON.parse(buffer.toString('utf8'));
        } catch {
            throw new Error(`manifeste M0 invalide : fichier ${collection}`);
        }
        const errors = validateCollectionManifest(collection, details, documents);
        if (errors.length) throw new Error(`manifeste M0 invalide : ${collection}`);
    }
    const storageErrors = validateStorageManifest(manifest.storage);
    if (storageErrors.length) throw new Error('manifeste M0 invalide : Storage');
    for (const file of manifest.storage.files) {
        try {
            const pathToFile = resolveBackupPath(backupRoot, `storage/${file.path}`);
            await readAndVerifyFile(pathToFile, file, 'Storage');
        } catch {
            throw new Error('manifeste M0 invalide : fichier Storage');
        }
    }
    return manifest;
}

export function isRecognizedTimestamp(value) {
    if (!value || typeof value !== 'object') return false;
    if (typeof value.toDate === 'function' && Number.isFinite(Number(value.seconds))) return true;
    return Number.isFinite(Number(value.seconds)) && Number.isInteger(Number(value.nanoseconds ?? 0));
}

export function legacyNotes(data) {
    if (!isRecord(data)) return [];
    return LEGACY_PRIVATE_KEYS
        .filter(key => Object.hasOwn(data, key))
        .map(key => ({ key, value: data[key] }));
}

export function sameLegacyNote(entries) {
    if (!entries.length) return { present: false, conflict: false, value: undefined, keys: [] };
    const first = entries[0].value;
    const nonString = entries.some(entry => typeof entry.value !== 'string');
    return {
        present: true,
        conflict: nonString || entries.some(entry => !isDeepStrictEqual(entry.value, first)),
        nonString,
        value: first,
        keys: entries.map(entry => entry.key),
    };
}

export function planPrepare(data, now) {
    const updates = {};
    const signals = [];
    if (!Object.hasOwn(data, 'visibleJoueurs')) updates.visibleJoueurs = true;
    else if (typeof data.visibleJoueurs !== 'boolean') signals.push('visibleJoueurs-non-booléen');
    for (const field of ['createdAt', 'updatedAt']) {
        if (!Object.hasOwn(data, field)) updates[field] = now;
        else if (!isRecognizedTimestamp(data[field])) signals.push(`${field}-atypique`);
    }
    return { updates, signals };
}

export function planPrivateCopy(publicData, privateData) {
    const entries = legacyNotes(publicData);
    const legacy = sameLegacyNote(entries);
    if (!legacy.present) return { action: 'none', keys: [], conflict: false };
    if (legacy.conflict) return { action: 'conflict', keys: legacy.keys, conflict: true };
    if (privateData && Object.hasOwn(privateData, 'notes')) {
        const equal = isDeepStrictEqual(privateData.notes, legacy.value);
        return {
            action: equal ? (Object.hasOwn(privateData, 'updatedAt') ? 'unchanged' : 'touch') : 'conflict',
            keys: legacy.keys,
            conflict: !equal,
        };
    }
    return {
        action: 'copy', keys: legacy.keys, conflict: false, value: legacy.value,
        needsTimestamp: !privateData || !Object.hasOwn(privateData, 'updatedAt'),
    };
}

export function planCleanup(publicData, privateData) {
    const entries = legacyNotes(publicData);
    const legacy = sameLegacyNote(entries);
    if (!legacy.present) return { action: 'none', keys: [], conflict: false };
    if (legacy.conflict || !privateData || !Object.hasOwn(privateData, 'notes')) {
        return { action: 'blocked', keys: legacy.keys, conflict: true };
    }
    return {
        action: isDeepStrictEqual(privateData.notes, legacy.value) ? 'delete' : 'blocked',
        keys: legacy.keys,
        conflict: !isDeepStrictEqual(privateData.notes, legacy.value),
    };
}

function emptySummary(phase) {
    return { phase, vus: 0, modifies: 0, inchanges: 0, erreurs: 0, conflits: 0, signaux: [], candidats: [] };
}

function addSummary(summary, key, amount = 1) { summary[key] += amount; }

async function readCollection(db, name) {
    const snapshot = await db.collection(name).get();
    return snapshot.docs.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

async function saveState(path, state) {
    if (path) {
        await mkdir(dirname(path), { recursive: true });
        const temporaryPath = `${path}.tmp-${process.pid}`;
        try {
            await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
            await rename(temporaryPath, path);
        } finally {
            await unlink(temporaryPath).catch(() => {});
        }
    }
}

function chunks(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}

function afterCursor(docs, cursor) {
    return cursor ? docs.filter(document => document.id > cursor) : docs;
}

function countPlan(summary, plan, dryRun) {
    if (plan.action === 'conflict' || plan.action === 'blocked') {
        addSummary(summary, 'conflits');
        addSummary(summary, 'erreurs');
    } else if (plan.action === 'copy' || plan.action === 'touch' || plan.action === 'delete') {
        addSummary(summary, 'modifies');
    } else if (plan.action === 'unchanged' || plan.action === 'none') {
        addSummary(summary, 'inchanges');
    }
    // `dryRun` est conservé dans la signature pour rendre explicite qu'aucune écriture n'est
    // déduite d'un plan ; les plans eux-mêmes ne contiennent jamais la note.
    void dryRun;
}

async function runPrepare({ db, phase, batchSize, dryRun, statePath, state, Timestamp }) {
    const summary = emptySummary(phase);
    for (const collection of COLLECTIONS) {
        const docs = afterCursor(await readCollection(db, collection), state.cursors[collection]);
        for (const group of chunks(docs, batchSize)) {
            const batch = dryRun ? null : db.batch();
            for (const document of group) {
                addSummary(summary, 'vus');
                const plan = planPrepare(document.data(), Timestamp.now());
                summary.signaux.push(...plan.signals.map(signal => `${collection}/${document.id}:${signal}`));
                if (!Object.keys(plan.updates).length) {
                    addSummary(summary, 'inchanges');
                    continue;
                }
                addSummary(summary, 'modifies');
                summary.candidats.push(`${collection}/${document.id}`);
                if (batch) batch.set(document.ref, plan.updates, { merge: true });
            }
            if (batch) await batch.commit();
            if (group.length && !dryRun) {
                state.cursors[collection] = group[group.length - 1].id;
                await saveState(statePath, state);
            }
        }
    }
    return summary;
}

async function runCopyPrivate({ db, phase, batchSize, dryRun, statePath, state, Timestamp }) {
    const summary = emptySummary(phase);
    const allPublicDocs = await readCollection(db, 'pnjs');
    const publicDocs = afterCursor(allPublicDocs, state.cursors.pnjs);
    const privateDocs = await readCollection(db, 'pnjs_prives');
    const privateById = new Map(privateDocs.map(document => [document.id, document.data()]));
    const privateIds = new Set(privateDocs.map(document => document.id));
    privateDocs.forEach(() => addSummary(summary, 'vus'));
    // Le curseur ne doit pas faire passer un document déjà traité pour un orphelin.
    allPublicDocs.forEach(document => privateIds.delete(document.id));
    const batchGroups = chunks(publicDocs, batchSize);
    for (const group of batchGroups) {
        const batch = dryRun ? null : db.batch();
        for (const document of group) {
            addSummary(summary, 'vus');
            const plan = planPrivateCopy(document.data(), privateById.get(document.id));
            if (plan.action === 'conflict') {
                addSummary(summary, 'conflits');
                addSummary(summary, 'erreurs');
                summary.signaux.push(`pnjs/${document.id}:conflit-note`);
            } else if (plan.action === 'copy' || plan.action === 'touch') {
                addSummary(summary, 'modifies');
                summary.candidats.push(`pnjs/${document.id}`);
                if (batch) {
                    const privateUpdate = plan.action === 'copy' ? { notes: plan.value } : {};
                    if (plan.action === 'touch' || plan.needsTimestamp) privateUpdate.updatedAt = Timestamp.now();
                    batch.set(db.collection('pnjs_prives').doc(document.id), privateUpdate, { merge: true });
                }
            } else {
                addSummary(summary, 'inchanges');
            }
            privateIds.delete(document.id);
        }
        if (batch) await batch.commit();
        if (group.length && !dryRun) {
            state.cursors.pnjs = group[group.length - 1].id;
            await saveState(statePath, state);
        }
    }
    for (const id of privateIds) {
        summary.signaux.push(`pnjs_prives/${id}:orphelin`);
    }
    return summary;
}

async function runCleanup({ db, phase, batchSize, dryRun, statePath, state, FieldValue }) {
    const summary = emptySummary(phase);
    const publicDocs = afterCursor(await readCollection(db, 'pnjs'), state.cursors.pnjs);
    for (const group of chunks(publicDocs, batchSize)) {
        for (const document of group) {
            addSummary(summary, 'vus');
            const publicRef = db.collection('pnjs').doc(document.id);
            const privateRef = db.collection('pnjs_prives').doc(document.id);
            try {
                if (dryRun) {
                    const privateSnap = await privateRef.get();
                    const plan = planCleanup(document.data(), privateSnap.exists ? privateSnap.data() : null);
                    countPlan(summary, plan, true);
                    if (plan.action === 'blocked') summary.signaux.push(`pnjs/${document.id}:nettoyage-bloqué`);
                    if (plan.action === 'delete') summary.candidats.push(`pnjs/${document.id}`);
                } else {
                    const plan = await db.runTransaction(async transaction => {
                        const [publicSnap, privateSnap] = await transaction.getAll(publicRef, privateRef);
                        const currentPlan = planCleanup(publicSnap.data(), privateSnap.exists ? privateSnap.data() : null);
                        if (currentPlan.action === 'delete') {
                            const update = Object.fromEntries(currentPlan.keys.map(key => [key, FieldValue.delete()]));
                            transaction.update(publicRef, update);
                        }
                        return currentPlan;
                    });
                    countPlan(summary, plan, false);
                    if (plan.action === 'delete') summary.candidats.push(`pnjs/${document.id}`);
                    if (plan.action === 'blocked') {
                        summary.signaux.push(`pnjs/${document.id}:nettoyage-bloqué`);
                    }
                }
            } catch {
                addSummary(summary, 'erreurs');
                summary.signaux.push(`pnjs/${document.id}:erreur`);
                throw new Error('échec transactionnel du cleanup');
            }
        }
        if (group.length && !dryRun) {
            state.cursors.pnjs = group[group.length - 1].id;
            await saveState(statePath, state);
        }
    }
    return summary;
}

export async function runPhase(options) {
    if (!options.db) throw new Error('client Admin absent');
    if (!validateBatchSize(options.batchSize ?? MAX_BATCH_SIZE)) throw new Error(`--batch-size doit être compris entre 1 et ${MAX_BATCH_SIZE}`);
    const state = options.stateData && (!options.stateData.phase || options.stateData.phase === options.phase)
        ? options.stateData : { phase: options.phase, cursors: {} };
    state.phase = options.phase;
    state.cursors ??= {};
    const common = {
        ...options, state, batchSize: Math.min(options.batchSize ?? MAX_BATCH_SIZE, MAX_BATCH_SIZE),
        dryRun: options.dryRun !== false,
    };
    if (options.phase === 'prepare') return runPrepare(common);
    if (options.phase === 'copy-private') return runCopyPrivate(common);
    return runCleanup(common);
}

export async function runMigration(options) {
    const errors = validateTarget(options);
    if (errors.length) throw new Error(errors.join('; '));
    if (options.execute && options.project === PRODUCTION_PROJECT) {
        await validateBackupManifest(options.backupManifest ?? options.manifest, options);
    }
    let stateData = { phase: options.phase, cursors: {} };
    if (options.state && !options.dryRun) {
        try { stateData = JSON.parse(await readFile(options.state, 'utf8')); } catch (error) {
            if (error.code !== 'ENOENT') throw new Error('état de reprise illisible');
        }
    }
    const client = await createAdminClient({ project: options.project, bucket: options.bucket });
    try {
        return await runPhase({ ...options, db: client.db, Timestamp: client.Timestamp,
            FieldValue: options.FieldValue, stateData, statePath: options.dryRun ? undefined : options.state });
    } finally {
        await client.app.delete();
    }
}

// Le SDK Admin expose FieldValue via firestore.FieldValue ; l'import dynamique ci-dessous évite
// de charger firebase-admin en dry-run et garde le module testable sans réseau.
export async function executeMigration(options) {
    const { FieldValue } = await import('firebase-admin/firestore');
    return runMigration({ ...options, FieldValue });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const options = parseArgs();
    try {
        const errors = validateTarget(options);
        if (errors.length) throw new Error(errors.join('; '));
        const result = await executeMigration(options);
        console.log(options.dryRun
            ? `✓ Dry-run M1-01 ${options.phase} : ${result.vus} vus, ${result.modifies} candidats modifiés, ${result.inchanges} inchangés, ${result.erreurs} erreurs, ${result.conflits} conflits, candidats=${result.candidats.join(',') || 'aucun'}, signaux=${result.signaux.join(',') || 'aucun'} (aucune écriture).`
            : `✓ Migration M1-01 ${options.phase} : ${result.vus} vus, ${result.modifies} modifiés, ${result.inchanges} inchangés, ${result.erreurs} erreurs.`);
    } catch (error) {
        console.error(`Migration M1-01 refusée : ${error.message}`);
        process.exitCode = 1;
    }
}

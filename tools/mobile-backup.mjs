// Sauvegarde M0 : dry-run par défaut, sortie hors dépôt et production verrouillée.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');
export const PRODUCTION_PROJECT = 'campagne-wrpg';
export const PRODUCTION_BUCKET = 'campagne-wrpg.firebasestorage.app';
export const COLLECTIONS = ['pnjs', 'pnjs_prives', 'relations', 'indices'];
export const STORAGE_PREFIXES = ['portraits/', 'indices/'];
const STORAGE_METADATA_KEYS = [
    'contentType', 'cacheControl', 'contentDisposition', 'contentEncoding', 'contentLanguage',
    'md5Hash', 'generation', 'metageneration', 'timeCreated', 'updated',
];

function optionValue(args, name) {
    const prefix = `--${name}=`;
    const value = args.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : null;
}

export function parseArgs(argv = process.argv.slice(2)) {
    const [command = null, ...args] = argv;
    return {
        command,
        project: optionValue(args, 'project'),
        bucket: optionValue(args, 'bucket'),
        out: optionValue(args, 'out'),
        input: optionValue(args, 'input'),
        confirmProduction: optionValue(args, 'confirm-production'),
        confirmRestore: optionValue(args, 'confirm-restore'),
        execute: args.includes('--execute'),
        allowNonEmulatorRestore: args.includes('--allow-non-emulator-restore'),
    };
}

export function isOutsideRepository(path, repoRoot = REPO_ROOT) {
    const rel = relative(resolve(repoRoot), resolve(path));
    return rel === '..' || rel.startsWith('..') || isAbsolute(rel);
}

export function validateOptions(options, {
    repoRoot = REPO_ROOT,
    env = process.env,
} = {}) {
    const errors = [];
    if (!['backup', 'restore'].includes(options.command)) errors.push('commande backup ou restore obligatoire');
    if (!options.project) errors.push('--project obligatoire');
    if (!options.bucket) errors.push('--bucket obligatoire');
    const productionTarget = options.project === PRODUCTION_PROJECT || options.bucket === PRODUCTION_BUCKET;
    if (productionTarget && options.confirmProduction !== PRODUCTION_PROJECT) {
        errors.push('production refusée sans --confirm-production=campagne-wrpg');
    }
    if (options.project === PRODUCTION_PROJECT && options.bucket !== PRODUCTION_BUCKET) {
        errors.push('le bucket de production ne correspond pas au projet');
    }
    if (options.bucket === PRODUCTION_BUCKET && options.project !== PRODUCTION_PROJECT) {
        errors.push('le bucket de production est interdit avec un autre projet');
    }
    if (options.command === 'backup') {
        if (!options.out) errors.push('--out obligatoire pour backup');
        else if (!isAbsolute(options.out)) errors.push('--out doit être un chemin absolu');
        else if (!isOutsideRepository(options.out, repoRoot)) errors.push('--out doit être hors du dépôt');
    }
    if (options.command === 'restore') {
        if (!options.input) errors.push('--input obligatoire pour restore');
        else if (!isAbsolute(options.input)) errors.push('--input doit être un chemin absolu');
        else if (!isOutsideRepository(options.input, repoRoot)) errors.push('--input doit être hors du dépôt');
        if (options.project === PRODUCTION_PROJECT || options.bucket === PRODUCTION_BUCKET) {
            errors.push('restauration de production toujours interdite');
        }
        const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST
            && (env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST));
        if (!emulator && (!options.allowNonEmulatorRestore || options.confirmRestore !== options.project)) {
            errors.push('restauration refusée hors émulateur sans garde explicite');
        }
    }
    return errors;
}

export function validateEmulatorRunnerOptions({ project, bucket, env = process.env } = {}) {
    const errors = [];
    const storageHost = env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (!env.FIRESTORE_EMULATOR_HOST || !storageHost) {
        errors.push('émulateurs Firestore et Storage obligatoires');
    }
    if (project === PRODUCTION_PROJECT || bucket === PRODUCTION_BUCKET) {
        errors.push('cible de production interdite');
    }
    return errors;
}

export function serializeFirestoreValue(value) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return { __type: 'number', value: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
    }
    if (value === null || typeof value !== 'object') return value;
    if (value.toDate instanceof Function && value.seconds !== undefined) {
        return {
            __type: 'timestamp',
            seconds: Number(value.seconds),
            nanoseconds: Number(value.nanoseconds ?? 0),
        };
    }
    if (value.latitude !== undefined && value.longitude !== undefined) {
        return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
    }
    if (value.path !== undefined && value.firestore !== undefined) {
        return { __type: 'reference', path: value.path };
    }
    if (value.toBase64 instanceof Function) return { __type: 'bytes', value: value.toBase64() };
    if (value instanceof Date) return { __type: 'date', value: value.toISOString() };
    if (Array.isArray(value)) return value.map(serializeFirestoreValue);
    const map = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestoreValue(item)]));
    return Object.hasOwn(value, '__type') ? { __type: 'map', value: map } : map;
}

export function deserializeFirestoreValue(value, { Timestamp, GeoPoint, Bytes, firestore, literalMapRoot = false }) {
    if (Array.isArray(value)) return value.map(item => deserializeFirestoreValue(item, { Timestamp, GeoPoint, Bytes, firestore }));
    if (!value || typeof value !== 'object') return value;
    if (literalMapRoot) return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key, deserializeFirestoreValue(item, { Timestamp, GeoPoint, Bytes, firestore }),
    ]));
    if (value.__type === 'number') {
        if (value.value === 'NaN') return Number.NaN;
        if (value.value === 'Infinity') return Number.POSITIVE_INFINITY;
        if (value.value === '-Infinity') return Number.NEGATIVE_INFINITY;
        throw new Error(`nombre spécial inconnu : ${value.value}`);
    }
    if (value.__type === 'map') {
        return deserializeFirestoreValue(value.value, { Timestamp, GeoPoint, Bytes, firestore, literalMapRoot: true });
    }
    if (value.__type === 'timestamp') return new Timestamp(value.seconds, value.nanoseconds);
    if (value.__type === 'date') return new Date(value.value);
    if (value.__type === 'geopoint') return new GeoPoint(value.latitude, value.longitude);
    if (value.__type === 'bytes') return Bytes.fromBase64String(value.value);
    if (value.__type === 'reference') return firestore.doc(value.path);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
        key, deserializeFirestoreValue(item, { Timestamp, GeoPoint, Bytes, firestore }),
    ]));
}

export function sanitizeStorageMetadata(metadata = {}) {
    const clean = {};
    for (const key of STORAGE_METADATA_KEYS) {
        if (metadata[key] !== undefined && metadata[key] !== null) clean[key] = metadata[key];
    }
    const custom = Object.fromEntries(Object.entries(metadata.metadata ?? {}).filter(([key]) => {
        return key.toLowerCase() !== 'firebasestoragedownloadtokens';
    }));
    if (Object.keys(custom).length) clean.metadata = custom;
    return clean;
}

export function storageMetadataForUpload(metadata = {}) {
    const clean = sanitizeStorageMetadata(metadata);
    const writable = {};
    for (const key of ['contentType', 'cacheControl', 'contentDisposition', 'contentEncoding', 'contentLanguage', 'metadata']) {
        if (clean[key] !== undefined) writable[key] = clean[key];
    }
    return writable;
}

async function assertFreshDirectory(path) {
    try {
        const entries = await readdir(path);
        if (entries.length) throw new Error(`dossier de sortie existant et non vide : ${path}`);
        throw new Error(`dossier de sortie existant : ${path}`);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
}

export async function createAdminClient({ project, bucket }) {
    const { applicationDefault, initializeApp } = await import('firebase-admin/app');
    const { getFirestore, Timestamp, GeoPoint, Bytes } = await import('firebase-admin/firestore');
    const { getStorage } = await import('firebase-admin/storage');
    const options = { projectId: project, storageBucket: bucket };
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) options.credential = applicationDefault();
    const app = initializeApp(options, `mobile-baseline-${Date.now()}`);
    return {
        app,
        db: getFirestore(app),
        bucket: getStorage(app).bucket(),
        Timestamp,
        GeoPoint,
        Bytes,
    };
}

export async function hashFile(path) {
    const hash = createHash('sha256');
    hash.update(await readFile(path));
    return hash.digest('hex');
}

export async function readAndVerifyFile(path, details, label = path) {
    const buffer = await readFile(path);
    const expectedSize = Number(details.bytes ?? details.size);
    if (expectedSize !== buffer.length) throw new Error(`taille invalide pour ${label}`);
    const hash = createHash('sha256');
    hash.update(buffer);
    if (details.sha256 !== hash.digest('hex')) throw new Error(`empreinte invalide pour ${label}`);
    return buffer;
}

export function resolveBackupPath(input, relativePath) {
    if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
        throw new Error(`chemin de backup invalide : ${relativePath}`);
    }
    const segments = relativePath.split(/[\\/]/u);
    if (segments.includes('..') || /^[A-Za-z]:/u.test(relativePath) || relativePath.startsWith('/')) {
        throw new Error(`chemin de backup hors dossier : ${relativePath}`);
    }
    const root = resolve(input);
    const path = resolve(root, relativePath);
    if (isOutsideRepository(path, root)) throw new Error(`chemin de backup hors dossier : ${relativePath}`);
    return path;
}

export async function verifyFileIntegrity(path, details, label = path) {
    await readAndVerifyFile(path, details, label);
}

export function validateRestoreDocuments(collection, documents) {
    const errors = [];
    if (!Array.isArray(documents)) return [`${collection} doit être un tableau`];
    const ids = new Set();
    documents.forEach((document, index) => {
        if (!document || typeof document !== 'object' || Array.isArray(document)) {
            errors.push(`${collection}[${index}] doit être un objet`);
            return;
        }
        if (typeof document.id !== 'string' || !document.id || document.id.includes('/')) {
            errors.push(`${collection}[${index}].id invalide`);
        } else if (ids.has(document.id)) {
            errors.push(`${collection} contient un id dupliqué : ${document.id}`);
        } else {
            ids.add(document.id);
        }
        if (!document.data || typeof document.data !== 'object' || Array.isArray(document.data)) {
            errors.push(`${collection}[${index}].data invalide`);
        }
    });
    return errors;
}

export function validateCollectionManifest(collection, details, documents) {
    if (!details || typeof details !== 'object') return [`manifeste incomplet : ${collection}`];
    const errors = validateRestoreDocuments(collection, documents);
    if (documents.length !== details.count) errors.push(`compte JSON invalide pour ${collection}`);
    if (details.ids !== undefined) {
        if (!Array.isArray(details.ids) || details.ids.length !== documents.length
            || details.ids.some(id => typeof id !== 'string')
            || new Set(details.ids).size !== details.ids.length
            || !documents.every(document => details.ids.includes(document.id))) {
            errors.push(`identifiants JSON invalides pour ${collection}`);
        }
    }
    return errors;
}

export function validateStorageManifest(storage) {
    if (!storage || !Array.isArray(storage.files)) return ['manifeste Storage incomplet'];
    const errors = [];
    if (storage.count !== storage.files.length) errors.push('compte Storage incohérent');
    const paths = storage.files.map(file => file?.path).filter(path => typeof path === 'string');
    if (new Set(paths).size !== paths.length) errors.push('chemins Storage dupliqués');
    storage.files.forEach(file => {
        if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !file.path) {
            errors.push('chemin Storage absent du manifeste');
        } else if (!file.path.startsWith('portraits/') && !file.path.startsWith('indices/')) {
            errors.push('préfixe Storage invalide');
        }
        if (!Number.isSafeInteger(file?.size) || file.size < 0) errors.push('taille Storage invalide');
    });
    const totalBytes = storage.files.reduce((total, file) => total + Number(file?.size ?? NaN), 0);
    if (!Number.isFinite(totalBytes) || storage.totalBytes !== totalBytes) errors.push('taille totale Storage incohérente');
    return errors;
}

async function exportFirestore(db, outDir) {
    const summary = {};
    for (const collection of COLLECTIONS) {
        const snapshot = await db.collection(collection).get();
        const documents = snapshot.docs.map(document => ({
            id: document.id,
            data: serializeFirestoreValue(document.data()),
        }));
        const file = `firestore/${collection}.json`;
        const path = join(outDir, file);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(documents, null, 2)}\n`, 'utf8');
        summary[collection] = {
            count: documents.length,
            file,
            bytes: (await stat(path)).size,
            sha256: await hashFile(path),
            ids: documents.map(document => document.id),
        };
    }
    return summary;
}

async function exportStorage(bucket, outDir) {
    const files = [];
    for (const prefix of STORAGE_PREFIXES) {
        const [objects] = await bucket.getFiles({ prefix });
        for (const object of objects) {
            if (object.name.endsWith('/')) continue;
            const destination = resolveBackupPath(outDir, `storage/${object.name}`);
            await mkdir(dirname(destination), { recursive: true });
            await object.download({ destination });
            const metadata = sanitizeStorageMetadata(object.metadata ?? {});
            const size = Number(object.metadata?.size ?? (await stat(destination)).size);
            files.push({
                path: object.name,
                size,
                sha256: await hashFile(destination),
                ...metadata,
            });
        }
    }
    return {
        prefixes: STORAGE_PREFIXES,
        count: files.length,
        totalBytes: files.reduce((total, file) => total + file.size, 0),
        files,
    };
}

export async function backup(options) {
    const errors = validateOptions(options);
    if (errors.length) throw new Error(errors.join('; '));
    if (!options.execute) {
        console.log(`✓ Dry-run : backup ${options.project} → ${options.out} (aucune connexion, aucune écriture).`);
        return { dryRun: true };
    }
    await assertFreshDirectory(options.out);
    await mkdir(options.out, { recursive: true });
    await writeFile(join(options.out, 'manifest.json'), `${JSON.stringify({
        format: 'mobile-baseline-backup',
        version: 1,
        complete: false,
        generatedAt: new Date().toISOString(),
        projectId: options.project,
        bucket: options.bucket,
    }, null, 2)}\n`, 'utf8');
    const client = await createAdminClient(options);
    try {
        const collections = await exportFirestore(client.db, options.out);
        const storage = await exportStorage(client.bucket, options.out);
        const manifest = {
            format: 'mobile-baseline-backup',
            version: 1,
            complete: true,
            generatedAt: new Date().toISOString(),
            projectId: options.project,
            bucket: options.bucket,
            collections,
            storage,
        };
        await writeFile(join(options.out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        console.log(`✓ Backup exporté : ${options.project}, ${Object.values(collections).reduce((total, item) => total + item.count, 0)} documents, ${storage.count} fichiers.`);
        return manifest;
    } finally {
        await client.app.delete();
    }
}

export async function restore(options) {
    const errors = validateOptions({ ...options, command: 'restore' });
    if (errors.length) throw new Error(errors.join('; '));
    if (!options.execute) {
        console.log(`✓ Dry-run : restore ${options.input} → ${options.project} (aucune connexion, aucune écriture).`);
        return { dryRun: true };
    }
    const manifest = JSON.parse(await readFile(resolveBackupPath(options.input, 'manifest.json'), 'utf8'));
    if (manifest.format !== 'mobile-baseline-backup' || manifest.version !== 1 || manifest.complete !== true) {
        throw new Error('format de backup inconnu');
    }
    const preparedCollections = [];
    for (const collection of COLLECTIONS) {
        const details = manifest.collections?.[collection];
        if (!details || typeof details.file !== 'string') throw new Error(`manifeste incomplet : ${collection}`);
        const path = resolveBackupPath(options.input, details.file);
        const buffer = await readAndVerifyFile(path, details, collection);
        const documents = JSON.parse(buffer.toString('utf8'));
        const documentErrors = validateCollectionManifest(collection, details, documents);
        if (documentErrors.length) {
            throw new Error(documentErrors.join('; '));
        }
        preparedCollections.push({ collection, documents });
    }
    const storageErrors = validateStorageManifest(manifest.storage);
    if (storageErrors.length) throw new Error(storageErrors.join('; '));
    const preparedStorage = [];
    for (const file of manifest.storage.files) {
        if (!file || typeof file.path !== 'string') throw new Error('chemin Storage absent du manifeste');
        if (!file.path.startsWith('portraits/') && !file.path.startsWith('indices/')) {
            throw new Error('préfixe Storage invalide');
        }
        resolveBackupPath(options.input, file.path);
        const path = resolveBackupPath(options.input, `storage/${file.path}`);
        const buffer = await readAndVerifyFile(path, file, file.path);
        preparedStorage.push({ file, buffer });
    }
    const client = await createAdminClient(options);
    let documentCount = 0;
    let fileCount = 0;
    try {
        for (const { collection, documents } of preparedCollections) {
            for (const document of documents) {
                const data = deserializeFirestoreValue(document.data, {
                    Timestamp: client.Timestamp,
                    GeoPoint: client.GeoPoint,
                    Bytes: client.Bytes,
                    firestore: client.db,
                });
                await client.db.collection(collection).doc(document.id).set(data);
                documentCount += 1;
            }
        }
        for (const { file, buffer } of preparedStorage) {
            await client.bucket.file(file.path).save(buffer, {
                resumable: false,
                metadata: storageMetadataForUpload(file),
            });
            fileCount += 1;
        }
    } finally {
        await client.app.delete();
    }
    console.log(`✓ Restore de test terminé : ${documentCount} documents, ${fileCount} fichiers.`);
    return { documentCount, fileCount };
}

function usage() {
    console.log(`Usage (dry-run par défaut) :
  node tools/mobile-backup.mjs backup --project=ID --bucket=BUCKET --out=CHEMIN-ABSOLU-HORS-DEPOT [--execute]
  node tools/mobile-backup.mjs restore --project=ID --bucket=BUCKET --input=CHEMIN-ABSOLU-HORS-DEPOT [--execute]

Production exige --confirm-production=campagne-wrpg. Restore hors émulateur exige
--allow-non-emulator-restore et --confirm-restore=ID ; production reste toujours interdite.`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const options = parseArgs();
    if (process.argv.includes('--help') || !options.command) usage();
    else {
        try {
            if (options.command === 'backup') await backup(options);
            else if (options.command === 'restore') await restore(options);
            else throw new Error('commande inconnue');
        } catch (error) {
            console.error(`✗ ${error.message}`);
            process.exitCode = 1;
        }
    }
}

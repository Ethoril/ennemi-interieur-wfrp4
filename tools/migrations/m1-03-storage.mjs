// Migration Storage M1-03. Dry-run par défaut, sans URL ni contenu sensible dans les sorties.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createAdminClient, PRODUCTION_BUCKET, PRODUCTION_PROJECT, REPO_ROOT } from '../mobile-backup.mjs';
import { validateBackupManifest } from './m1-01-visibility.mjs';

export const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;
export const MAX_INDICE_BYTES = 5 * 1024 * 1024;
export const RASTER_MIME = /^image\/(jpeg|png|webp|gif|avif)$/u;
const PHASES = new Set(['inventory', 'copy-verify', 'reference', 'cleanup']);

const option = (args, name) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
export function parseArgs(argv = process.argv.slice(2)) {
    const [phase = 'inventory', ...args] = argv;
    return {
        phase,
        project: option(args, 'project'), bucket: option(args, 'bucket'),
        manifest: option(args, 'backup-manifest'), state: option(args, 'state'),
        confirmProduction: option(args, 'confirm-production'),
        confirmCleanup: option(args, 'confirm-cleanup'),
        execute: args.includes('--execute'),
    };
}

const outsideRepo = path => {
    const rel = relative(REPO_ROOT, resolve(path));
    return rel === '..' || /^\.\.(?:[\\/]|$)/u.test(rel) || isAbsolute(rel);
};

export function validateOptions(options, { env = process.env } = {}) {
    const errors = [];
    if (!PHASES.has(options.phase)) errors.push('phase invalide (inventory, copy-verify, reference ou cleanup)');
    if (!options.project) errors.push('--project obligatoire');
    if (!options.bucket) errors.push('--bucket obligatoire');
    const production = options.project === PRODUCTION_PROJECT || options.bucket === PRODUCTION_BUCKET;
    if (production && (options.project !== PRODUCTION_PROJECT || options.bucket !== PRODUCTION_BUCKET)) errors.push('projet et bucket production incohérents');
    if (production && options.execute && options.confirmProduction !== PRODUCTION_PROJECT) errors.push('exécution production exige --confirm-production=campagne-wrpg');
    if (production && !options.execute && options.confirmProduction !== PRODUCTION_PROJECT) errors.push('inventaire production exige --confirm-production=campagne-wrpg');
    if (production && !options.manifest) errors.push('production exige --backup-manifest M0 complet');
    if (options.execute && !options.state) errors.push('--state absolu obligatoire avec --execute');
    if (options.state && (!isAbsolute(options.state) || !outsideRepo(options.state))) errors.push('--state doit être hors dépôt');
    if (options.execute && production && !options.manifest) errors.push('--backup-manifest obligatoire avec --execute en production');
    if (options.manifest && (!isAbsolute(options.manifest) || !outsideRepo(options.manifest))) errors.push('--backup-manifest doit être hors dépôt');
    if (options.phase === 'cleanup' && (!options.execute || options.confirmCleanup !== options.project)) errors.push('cleanup exige --execute et --confirm-cleanup=projet');
    const storageEmulator = env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (!production && (!env.FIRESTORE_EMULATOR_HOST || !storageEmulator)) errors.push('émulateurs Firestore et Storage obligatoires hors production');
    if (production && (env.FIRESTORE_EMULATOR_HOST || storageEmulator)) errors.push('cible production interdite avec émulateur');
    return errors;
}

export function parseStorageReference(value, expectedBucket = null) {
    if (typeof value !== 'string' || !value) return { path: null, valid: false };
    if (value.startsWith('portraits/') || value.startsWith('indices/')) return { path: value, valid: true };
    if (value.startsWith('gs://')) {
        const slash = value.indexOf('/', 5);
        const bucket = slash >= 0 ? value.slice(5, slash) : '';
        return { path: slash >= 0 ? value.slice(slash + 1) : null, valid: Boolean(bucket && (!expectedBucket || bucket === expectedBucket)) };
    }
    try {
        const url = new URL(value);
        if (url.hostname === 'storage.googleapis.com') {
            const match = url.pathname.match(/^\/([^/]+)\/(.+)$/u);
            const path = match?.[2] ? decodeURIComponent(match[2]) : null;
            return { path, valid: Boolean(path && (!expectedBucket || match?.[1] === expectedBucket)) };
        }
        if (url.hostname !== 'firebasestorage.googleapis.com' && !url.hostname.endsWith('.firebasestorage.app')) {
            return { path: null, valid: false };
        }
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/u);
        const bucket = match?.[1] ?? null;
        const path = match?.[2] ? decodeURIComponent(match[2]) : null;
        return { path, valid: Boolean(path && (!expectedBucket || bucket === expectedBucket)) };
    } catch { return { path: null, valid: false }; }
}

export function storagePathFromImageUrl(value, expectedBucket = null) {
    const result = parseStorageReference(value, expectedBucket);
    return result.valid ? result.path : null;
}

function ownerReferences(collection, documents, expectedBucket) {
    const result = [];
    for (const document of documents ?? []) {
        const data = document?.data;
        if (!document?.id || !data || typeof data !== 'object' || Array.isArray(data)) continue;
        const imagePath = parseStorageReference(data.imagePath, expectedBucket);
        const imageUrl = parseStorageReference(data.imageUrl, expectedBucket);
        if (Object.hasOwn(data, 'imagePath') && data.imagePath !== null && (typeof data.imagePath !== 'string' || (data.imagePath && !imagePath.valid))) {
            result.push({ collection, id: document.id, invalid: 'imagePath-invalide' });
            continue;
        }
        if (Object.hasOwn(data, 'imageUrl') && data.imageUrl !== null && (typeof data.imageUrl !== 'string' || (data.imageUrl && !imageUrl.valid))) {
            result.push({ collection, id: document.id, invalid: 'imageUrl-invalide' });
            continue;
        }
        // imagePath est déjà la cible protégée : il ne devient jamais une
        // source legacy et n’est jamais supprimé par cleanup.
        if (imagePath.path) {
            const protectedParts = imagePath.path.split('/');
            const expectedPrefix = collection === 'pnjs' ? 'portraits' : 'indices';
            if (protectedParts.length !== 3 || protectedParts[0] !== expectedPrefix || protectedParts[1] !== document.id) {
                result.push({ collection, id: document.id, invalid: 'imagePath-identifiant-invalide' });
                continue;
            }
            result.push({ collection, id: document.id, protectedPath: imagePath.path });
            if (imageUrl.path && imageUrl.path !== imagePath.path) result.push({ collection, id: document.id, source: imageUrl.path, target: imagePath.path, expectedImagePath: imagePath.path, expectedImageUrl: imageUrl.path, expectedImagePathValue: data.imagePath, expectedImageUrlValue: data.imageUrl ?? null,
                expectedImagePathHash: hashRawValue(data.imagePath), expectedImageUrlHash: hashRawValue(data.imageUrl) });
            continue;
        }
        if (imageUrl.path) result.push({ collection, id: document.id, source: imageUrl.path, expectedImagePath: null, expectedImageUrl: imageUrl.path, expectedImagePathValue: null, expectedImageUrlValue: data.imageUrl ?? null,
            expectedImagePathHash: null, expectedImageUrlHash: hashRawValue(data.imageUrl) });
    }
    return result;
}

function hashRawValue(value) {
    return typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null;
}

function targetName(source, collection, id) {
    const rawBase = source.split('/').pop()?.replace(/[^A-Za-z0-9._-]/gu, '_') || 'image.bin';
    const extension = rawBase.match(/[.][A-Za-z0-9]+$/u)?.[0]?.toLowerCase() ?? '';
    const base = extension ? `${rawBase.slice(0, -extension.length)}${extension}` : rawBase;
    const prefix = collection === 'pnjs' ? 'portraits' : 'indices';
    return `${prefix}/${id}/${base}`;
}

export function planMigration({ pnjs = [], indices = [], files = [], bucket = null } = {}) {
    const refs = [...ownerReferences('pnjs', pnjs, bucket), ...ownerReferences('indices', indices, bucket)];
    const objects = new Map((files ?? []).filter(file => typeof file?.path === 'string').map(file => [file.path, file]));
    const ownerIds = {
        portraits: new Set((pnjs ?? []).map(document => document?.id).filter(Boolean)),
        indices: new Set((indices ?? []).map(document => document?.id).filter(Boolean)),
    };
    const bySource = new Map();
    const signals = [];
    const entries = [];
    for (const ref of refs) {
        if (ref.invalid) { signals.push(`${ref.collection}/${ref.id}:${ref.invalid}`); continue; }
        if (!ref.source) continue;
        if (ref.source.split('/').length !== 2) {
            signals.push(`${ref.collection}/${ref.id}:source-legacy-non-plat`);
            continue;
        }
        if (!ref.source.startsWith('portraits/') && !ref.source.startsWith('indices/')) {
            signals.push(`${ref.collection}/${ref.id}:prefix-invalide`);
            continue;
        }
        const expectedPrefix = ref.collection === 'pnjs' ? 'portraits/' : 'indices/';
        if (!ref.source.startsWith(expectedPrefix)) signals.push(`${ref.collection}/${ref.id}:prefix-invalide`);
        const source = objects.get(ref.source);
        if (!source) { signals.push(`${ref.collection}/${ref.id}:objet-absent`); continue; }
        const maxBytes = ref.collection === 'pnjs' ? MAX_PORTRAIT_BYTES : MAX_INDICE_BYTES;
        if (!RASTER_MIME.test(source.contentType ?? '') || !Number.isSafeInteger(Number(source.size)) || Number(source.size) <= 0 || Number(source.size) > maxBytes) {
            signals.push(`${ref.collection}/${ref.id}:media-invalide`);
        }
        const target = ref.target || targetName(ref.source, ref.collection, ref.id);
        const existing = bySource.get(ref.source) ?? [];
        existing.push(ref);
        bySource.set(ref.source, existing);
        entries.push({ ...ref, target, sourceMeta: source });
    }
    for (const [source, owners] of bySource) if (owners.length > 1) signals.push(`${source}:references-multiples`);
    const referenced = new Set(refs.map(ref => ref.source).filter(Boolean));
    const protectedPaths = new Set(refs.map(ref => ref.protectedPath).filter(Boolean));
    for (const ref of refs.filter(item => item.protectedPath)) {
        const target = objects.get(ref.protectedPath);
        if (!target) {
            signals.push(`${ref.collection}/${ref.id}:cible-absente`);
            continue;
        }
        if (hasDownloadToken(target)) signals.push(`${ref.collection}/${ref.id}:cible-token-legacy`);
        if (!hasProtectedCachePolicy(target)) signals.push(`${ref.collection}/${ref.id}:cible-cache-persistant`);
        const maxBytes = ref.collection === 'pnjs' ? MAX_PORTRAIT_BYTES : MAX_INDICE_BYTES;
        if (!RASTER_MIME.test(target.contentType ?? '') || !Number.isSafeInteger(Number(target.size))
            || Number(target.size) <= 0 || Number(target.size) > maxBytes) signals.push(`${ref.collection}/${ref.id}:cible-media-invalide`);
    }
    for (const file of objects.values()) {
        if (file.path.startsWith('portraits/') || file.path.startsWith('indices/')) {
            const parts = file.path.split('/');
            if (parts.length === 2 && !referenced.has(file.path)) signals.push(`${file.path}:orphelin`);
            if (parts.length >= 3) {
                const [prefix, owner] = parts;
                if (!ownerIds[prefix]?.has(owner)) signals.push(`${file.path}:proprietaire-absent`);
                else if (!protectedPaths.has(file.path)) signals.push(`${file.path}:orphelin-protege`);
            }
        }
    }
    const targets = new Map();
    for (const entry of entries) {
        const previous = targets.get(entry.target);
        if (previous && previous.source !== entry.source) signals.push(`${entry.target}:collision`);
        targets.set(entry.target, entry);
    }
    return { entries, signals, counts: { references: refs.length, entries: entries.length, signals: signals.length } };
}

export function verifyMetadata(source, destination) {
    const sourceSize = Number(source?.size);
    const destinationSize = Number(destination?.size);
    return Number.isSafeInteger(sourceSize) && sourceSize === destinationSize
        && source?.contentType === destination?.contentType
        && typeof source?.md5Hash === 'string' && source.md5Hash.length > 0
        && source.md5Hash === destination?.md5Hash;
}

export function metadataIdentity(metadata) {
    return { size: String(metadata?.size ?? ''), contentType: metadata?.contentType ?? null, md5Hash: metadata?.md5Hash ?? null };
}

export function hasDownloadToken(metadata) {
    return Object.entries(metadata?.metadata ?? {}).some(([key, value]) => key.toLowerCase() === 'firebasestoragedownloadtokens'
        && ((typeof value === 'string' && value.length > 0) || (Array.isArray(value) && value.length > 0)));
}

function hasProtectedCachePolicy(metadata) {
    return metadata?.cacheControl === 'no-store';
}

export function planIdentity(plan, project, bucket) {
    const payload = JSON.stringify({ project, bucket, entries: plan.entries.map(entry => ({
        collection: entry.collection, id: entry.id, source: entry.source, target: entry.target,
        sourceMeta: metadataIdentity(entry.sourceMeta),
        expectedImagePathHash: entry.expectedImagePathHash ?? null,
        expectedImageUrlHash: entry.expectedImageUrlHash ?? null,
    })).sort((left, right) => `${left.collection}/${left.id}`.localeCompare(`${right.collection}/${right.id}`)) });
    return createHash('sha256').update(payload).digest('hex');
}

export function createMigrationState(plan, project, bucket) {
    return { format: 'm1-03-storage-state', version: 1, project, bucket,
        planFingerprint: planIdentity(plan, project, bucket),
        // L’état est rejouable, mais ne conserve jamais l’URL legacy complète.
        entries: plan.entries.map(entry => ({ collection: entry.collection, id: entry.id, source: entry.source,
            target: entry.target, expectedImagePath: entry.expectedImagePath ?? null,
            expectedImageUrl: entry.expectedImageUrl ?? null,
            expectedImagePathHash: entry.expectedImagePathHash ?? null,
            expectedImageUrlHash: entry.expectedImageUrlHash ?? null,
            sourceMeta: metadataIdentity(entry.sourceMeta) })),
        copied: {}, referenced: {}, cleaned: {} };
}

export function planFromState(state) {
    return { entries: Array.isArray(state?.entries) ? state.entries : [], signals: [], counts: { references: state?.entries?.length ?? 0, entries: state?.entries?.length ?? 0, signals: 0 } };
}

export function validateMigrationState(state, plan, project, bucket) {
    const validEntries = Array.isArray(state?.entries) && state.entries.every(entry => entry &&
        (entry.collection === 'pnjs' || entry.collection === 'indices')
        && typeof entry.id === 'string' && typeof entry.source === 'string' && typeof entry.target === 'string'
        && entry.source.split('/').length === 2 && entry.target.split('/').length === 3
        && entry.source.split('/')[0] === (entry.collection === 'pnjs' ? 'portraits' : 'indices')
        && entry.target.split('/')[0] === (entry.collection === 'pnjs' ? 'portraits' : 'indices')
        && entry.target.split('/')[1] === entry.id && entry.target.split('/')[2].length > 0
        && (entry.expectedImagePath === null || typeof entry.expectedImagePath === 'string')
        && (entry.expectedImageUrl === null || typeof entry.expectedImageUrl === 'string')
        && (entry.expectedImagePathHash === null || typeof entry.expectedImagePathHash === 'string')
        && (entry.expectedImageUrlHash === null || typeof entry.expectedImageUrlHash === 'string')
        && entry.sourceMeta && typeof entry.sourceMeta === 'object' && typeof entry.sourceMeta.md5Hash === 'string');
    return state && state.format === 'm1-03-storage-state' && state.version === 1
        && state.project === project && state.bucket === bucket
        && state.planFingerprint === planIdentity(plan, project, bucket)
        && validEntries
        && Boolean(state.copied && state.referenced && state.cleaned);
}

export function recordMigrationPhase(state, phase, key, value) {
    if (!['copied', 'referenced', 'cleaned'].includes(phase)) throw new Error('phase d’état invalide');
    state[phase][key] = value;
    return state;
}

function validEntryMedia(entry, metadata) {
    const maxBytes = entry.collection === 'pnjs' ? MAX_PORTRAIT_BYTES : MAX_INDICE_BYTES;
    return RASTER_MIME.test(metadata?.contentType ?? '') && Number.isSafeInteger(Number(metadata?.size))
        && Number(metadata.size) > 0 && Number(metadata.size) <= maxBytes && typeof metadata?.md5Hash === 'string';
}

async function snapshot(client) {
    const [pnjs, indices, files] = await Promise.all([
        client.db.collection('pnjs').get(), client.db.collection('indices').get(), client.bucket.getFiles({ autoPaginate: true }),
    ]);
    return {
        pnjs: pnjs.docs.map(doc => ({ id: doc.id, data: doc.data() })),
        indices: indices.docs.map(doc => ({ id: doc.id, data: doc.data() })),
        files: files[0].map(file => ({ path: file.name, size: file.metadata.size, contentType: file.metadata.contentType,
            cacheControl: file.metadata.cacheControl, md5Hash: file.metadata.md5Hash,
            generation: file.metadata.generation, metadata: file.metadata.metadata })),
    };
}

export async function persistState(path, state) {
    if (!path) return;
    const target = resolve(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function runMigration(options) {
    const optionErrors = validateOptions(options);
    if (optionErrors.length) throw new Error(`migration refusée : ${optionErrors.join('; ')}`);
    if (options.manifest) await validateBackupManifest(options.manifest, { project: options.project, bucket: options.bucket });
    const client = await createAdminClient({ project: options.project, bucket: options.bucket });
    try {
        const data = await snapshot(client);
        let state = {};
        if (options.state) {
            try { state = JSON.parse(await readFile(resolve(options.state), 'utf8')); } catch { state = {}; }
        }
        const freshPlan = planMigration({ ...data, bucket: options.bucket });
        const persistedPlan = options.phase === 'cleanup' && Object.keys(state).length && Array.isArray(state.entries)
            ? planFromState(state) : null;
        const plan = persistedPlan || freshPlan;
        if (Object.keys(state).length && (!validateMigrationState(state, plan, options.project, options.bucket))) {
            throw new Error('état de reprise incompatible avec la cible ou le plan courant');
        }
        if (options.state && !Object.keys(state).length) state = createMigrationState(plan, options.project, options.bucket);
        if (options.phase === 'inventory' || !options.execute) return { ...plan, dryRun: true };
        if (plan.signals.some(signal => !/:orphelin(?:-protege)?$/u.test(signal))) throw new Error('migration bloquée : anomalie de média, référence ou propriétaire');
        const { FieldValue } = await import('firebase-admin/firestore');
        if (options.phase === 'copy-verify') {
            for (const entry of plan.entries) {
                const source = client.bucket.file(entry.source);
                const destination = client.bucket.file(entry.target);
                const [sourceMetadata] = await source.getMetadata();
                if (!validEntryMedia(entry, sourceMetadata)) throw new Error(`source non vérifiée pour ${entry.collection}/${entry.id}`);
                const [exists] = await destination.exists();
                if (!exists) {
                    // save() avec des métadonnées blanches évite de recopier un token legacy.
                    const [contents] = await source.download();
                    await destination.save(contents, { resumable: false, metadata: {
                        contentType: sourceMetadata.contentType,
                        cacheControl: 'no-store',
                        contentDisposition: sourceMetadata.contentDisposition,
                        contentEncoding: sourceMetadata.contentEncoding,
                        contentLanguage: sourceMetadata.contentLanguage,
                        metadata: Object.fromEntries(Object.entries(sourceMetadata.metadata ?? {}).filter(([key]) => key.toLowerCase() !== 'firebasestoragedownloadtokens')),
                    } });
                }
                const [metadata] = await destination.getMetadata();
                if (hasDownloadToken(metadata) || !hasProtectedCachePolicy(metadata)
                    || !verifyMetadata(sourceMetadata, metadata)) throw new Error(`copie non vérifiée pour ${entry.collection}/${entry.id}`);
                recordMigrationPhase(state, 'copied', entry.target, { source: entry.source, identity: metadataIdentity(sourceMetadata) });
                await persistState(options.state, state);
            }
        } else if (options.phase === 'reference') {
            for (const entry of plan.entries) {
                if (!state.copied[entry.target]) throw new Error(`référence impossible avant copy-verify pour ${entry.collection}/${entry.id}`);
                const source = client.bucket.file(entry.source);
                const destination = client.bucket.file(entry.target);
                const [sourceMetadata] = await source.getMetadata();
                const [destinationMetadata] = await destination.getMetadata();
                if (!validEntryMedia(entry, sourceMetadata) || hasDownloadToken(destinationMetadata)
                    || !hasProtectedCachePolicy(destinationMetadata) || !verifyMetadata(sourceMetadata, destinationMetadata)) throw new Error(`référence impossible : copie non vérifiée pour ${entry.collection}/${entry.id}`);
                const ownerRef = client.db.collection(entry.collection).doc(entry.id);
                await client.db.runTransaction(async transaction => {
                    const owner = await transaction.get(ownerRef);
                    const current = owner.data() ?? {};
                    const currentPath = storagePathFromImageUrl(current.imagePath, options.bucket);
                    const currentUrl = storagePathFromImageUrl(current.imageUrl, options.bucket);
                    if (currentPath !== (entry.expectedImagePath ?? null) || currentUrl !== (entry.expectedImageUrl ?? null)
                        || (current.imagePath ?? null) !== entry.expectedImagePathValue || (current.imageUrl ?? null) !== entry.expectedImageUrlValue) throw new Error(`référence modifiée pour ${entry.collection}/${entry.id}`);
                    transaction.update(ownerRef, { imagePath: entry.target, updatedAt: FieldValue.serverTimestamp() });
                });
                recordMigrationPhase(state, 'referenced', entry.target, { source: entry.source, identity: metadataIdentity(sourceMetadata) });
                await persistState(options.state, state);
            }
        } else if (options.phase === 'cleanup') {
            for (const entry of plan.entries) {
                if (!state.referenced[entry.target]) throw new Error(`cleanup impossible avant reference pour ${entry.collection}/${entry.id}`);
                const destination = client.bucket.file(entry.target);
                const [destinationMetadata] = await destination.getMetadata();
                if (hasDownloadToken(destinationMetadata) || !hasProtectedCachePolicy(destinationMetadata)) throw new Error(`cleanup refusé : cible non protégée pour ${entry.collection}/${entry.id}`);
                if (!verifyMetadata(entry.sourceMeta, destinationMetadata)) throw new Error(`cleanup refusé : destination modifiée pour ${entry.collection}/${entry.id}`);
                const source = client.bucket.file(entry.source);
                const [sourceExists] = await source.exists();
                let sourceMetadata = null;
                if (sourceExists) {
                    [sourceMetadata] = await source.getMetadata();
                    if (!verifyMetadata(sourceMetadata, destinationMetadata)) throw new Error(`cleanup refusé : source modifiée pour ${entry.collection}/${entry.id}`);
                }
                const ownerRef = client.db.collection(entry.collection).doc(entry.id);
                await client.db.runTransaction(async transaction => {
                    const owner = await transaction.get(ownerRef);
                    const ownerData = owner.data() ?? {};
                    const hasCurrentUrl = Object.hasOwn(ownerData, 'imageUrl');
                    const currentUrl = hasCurrentUrl ? storagePathFromImageUrl(ownerData.imageUrl, options.bucket) : null;
                    if (ownerData.imagePath !== entry.target
                        || (hasCurrentUrl && (currentUrl !== entry.expectedImageUrl || hashRawValue(ownerData.imageUrl) !== entry.expectedImageUrlHash))) {
                        throw new Error(`cleanup refusé sans référence inchangée pour ${entry.collection}/${entry.id}`);
                    }
                    if (hasCurrentUrl) transaction.update(ownerRef, { imageUrl: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() });
                });
                if (sourceExists) {
                    await source.delete({ ignoreNotFound: true, ifGenerationMatch: sourceMetadata.generation });
                }
                recordMigrationPhase(state, 'cleaned', entry.source, { target: entry.target, identity: metadataIdentity(destinationMetadata) });
                await persistState(options.state, state);
            }
        }
        return { ...plan, dryRun: false };
    } finally { await client.app.delete(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const options = parseArgs();
    const errors = validateOptions(options);
    if (errors.length) { console.error(`Migration M1-03 refusée : ${errors.join('; ')}`); process.exitCode = 1; }
    else try {
        const result = await runMigration(options);
        console.log(JSON.stringify({ dryRun: result.dryRun, counts: result.counts, signals: result.signals }, null, 2));
        if (result.signals.length) process.exitCode = 2;
    } catch (error) { console.error(`Migration M1-03 impossible : ${error.message}`); process.exitCode = 1; }
}

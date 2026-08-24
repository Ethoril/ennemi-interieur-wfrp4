// Inventaire administratif M1-04 : lectures uniquement, aucune suppression automatique.
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createAdminClient, PRODUCTION_BUCKET, PRODUCTION_PROJECT } from '../mobile-backup.mjs';

const option = (args, name) => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;

export function validateOrphanAudit(options, env = process.env) {
    const production = options.project === PRODUCTION_PROJECT || options.bucket === PRODUCTION_BUCKET;
    const errors = [];
    if (!options.project || !options.bucket) errors.push('--project et --bucket obligatoires');
    if (production && (options.project !== PRODUCTION_PROJECT || options.bucket !== PRODUCTION_BUCKET)) errors.push('projet et bucket production incohérents');
    if (production && options.confirmProduction !== PRODUCTION_PROJECT) errors.push('audit production exige --confirm-production=campagne-wrpg');
    const storageEmulator = env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST;
    if (!production && (!env.FIRESTORE_EMULATOR_HOST || !storageEmulator)) errors.push('émulateurs Firestore et Storage obligatoires hors production');
    if (production && (env.FIRESTORE_EMULATOR_HOST || storageEmulator)) errors.push('cible production interdite avec émulateur');
    return errors;
}

export function canonicalPath(value, bucket) {
    if (typeof value !== 'string' || !value) return null;
    if (value.startsWith('portraits/') || value.startsWith('indices/')) return value;
    if (value.startsWith(`gs://${bucket}/`)) return value.slice(bucket.length + 6);
    try {
        const url = new URL(value);
        if (url.hostname === 'storage.googleapis.com') {
            const segments = url.pathname.split('/').filter(Boolean);
            return segments[0] === bucket ? decodeURIComponent(segments.slice(1).join('/')) : null;
        }
        const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/u);
        return match?.[1] === bucket ? decodeURIComponent(match[2]) : null;
    } catch { return null; }
}

export function findOrphanPaths(documents, filePaths, bucket) {
    const referenced = new Set();
    for (const data of documents) {
        for (const value of [data?.imagePath, data?.imageUrl]) {
            const path = canonicalPath(value, bucket);
            if (path) referenced.add(path);
        }
    }
    return filePaths
        .filter(path => /^(?:portraits|indices)\//u.test(path) && !referenced.has(path));
}

export async function auditOrphans(options) {
    const errors = validateOrphanAudit(options);
    if (errors.length) throw new Error(`audit refusé : ${errors.join('; ')}`);
    const client = await createAdminClient({ project: options.project, bucket: options.bucket });
    try {
        const [pnjs, indices, files] = await Promise.all([
            client.db.collection('pnjs').get(),
            client.db.collection('indices').get(),
            client.bucket.getFiles({ autoPaginate: true }),
        ]);
        const documents = [...pnjs.docs, ...indices.docs].map(snapshot => snapshot.data() || {});
        const orphanPaths = findOrphanPaths(documents, files[0].map(file => file.name), options.bucket);
        return { count: orphanPaths.length, orphanPaths };
    } finally { await client.app.delete(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const args = process.argv.slice(2);
    const options = {
        project: option(args, 'project'), bucket: option(args, 'bucket'),
        confirmProduction: option(args, 'confirm-production'),
    };
    const errors = validateOrphanAudit(options);
    if (errors.length) { console.error(`Audit Storage M1-04 refusé : ${errors.join('; ')}`); process.exitCode = 1; }
    else try {
        const result = await auditOrphans(options);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) { console.error(`Audit Storage M1-04 impossible : ${error.message}`); process.exitCode = 1; }
}

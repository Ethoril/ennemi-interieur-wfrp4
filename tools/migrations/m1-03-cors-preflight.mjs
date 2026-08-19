// Préflight CORS : validation locale, inspection distante en lecture et apply explicitement gardé.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminClient, PRODUCTION_BUCKET, PRODUCTION_PROJECT } from '../mobile-backup.mjs';

export function validateCorsConfig(config) {
    const errors = [];
    if (!Array.isArray(config) || config.length !== 1) return ['configuration CORS doit contenir une règle'];
    const [rule] = config;
    const exact = (actual, expected) => Array.isArray(actual) && actual.length === expected.length
        && [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000');
    if (!exact(rule.origin, ['http://localhost:8000', 'http://127.0.0.1:8000', 'https://ethoril.github.io'])) errors.push('origines attendues absentes ou supplémentaires');
    if (!exact(rule.method, ['GET', 'HEAD'])) errors.push('méthodes attendues absentes ou supplémentaires');
    if (!exact(rule.responseHeader, ['Content-Type', 'Content-Length', 'ETag'])) errors.push('en-têtes attendus absents ou supplémentaires');
    if (!Number.isInteger(rule.maxAgeSeconds) || rule.maxAgeSeconds < 0) errors.push('maxAgeSeconds invalide');
    return errors;
}

export function validateTarget({ project, bucket, execute = false, confirmProduction = null, confirmCors = null, mode = 'validate', env = process.env } = {}) {
    const errors = [];
    if (!project || !bucket) errors.push('--project et --bucket obligatoires');
    if (project === PRODUCTION_PROJECT || bucket === PRODUCTION_BUCKET) {
        if (project !== PRODUCTION_PROJECT || bucket !== PRODUCTION_BUCKET) errors.push('projet et bucket production incohérents');
        if (confirmProduction !== PRODUCTION_PROJECT) errors.push('préflight production exige --confirm-production=campagne-wrpg');
    }
    if (mode !== 'validate' && mode !== 'inspect' && mode !== 'apply') errors.push('mode CORS invalide');
    if (mode === 'validate' && execute) errors.push('préflight CORS strictement en lecture : --execute interdit');
    if (mode === 'apply' && (!execute || confirmCors !== project)) errors.push('apply exige --execute et --confirm-cors=projet');
    if (mode === 'apply' && project !== PRODUCTION_PROJECT && (!env.FIRESTORE_EMULATOR_HOST || !(env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST))) errors.push('apply hors production exige Firestore et Storage émulateurs');
    if ((mode === 'apply' || mode === 'inspect') && (project === PRODUCTION_PROJECT || bucket === PRODUCTION_BUCKET)
        && (env.FIRESTORE_EMULATOR_HOST || env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST)) errors.push('production interdite avec émulateur');
    if (mode === 'inspect' && project !== PRODUCTION_PROJECT && (!env.FIRESTORE_EMULATOR_HOST || !(env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST))) errors.push('inspect hors production exige Firestore et Storage émulateurs');
    return errors;
}

export async function inspectCors(client, expected) {
    const [metadata] = await client.bucket.getMetadata();
    const actual = metadata.cors ?? [];
    const normalize = value => (Array.isArray(value) ? value.map(normalize).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalize(item)])) : value);
    return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

export async function applyCors(client, config) {
    await client.bucket.setMetadata({ cors: config });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const value = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
    const mode = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'validate';
    const options = { project: value('project'), bucket: value('bucket'), confirmProduction: value('confirm-production'), confirmCors: value('confirm-cors'), execute: process.argv.includes('--execute'), mode };
    const errors = validateTarget(options);
    let config = null;
    try {
        config = JSON.parse(await readFile(resolve('storage.cors.json'), 'utf8'));
        errors.push(...validateCorsConfig(config));
    } catch { errors.push('storage.cors.json illisible'); }
    if (errors.length) { console.error(`Préflight CORS M1-03 refusé : ${errors.join('; ')}`); process.exitCode = 1; }
    else if (mode === 'inspect' || mode === 'apply') {
        try {
            const client = await createAdminClient(options);
            try {
                if (mode === 'apply') {
                    await applyCors(client, config);
                    console.log('✓ CORS Storage appliqué après confirmations.');
                } else if (!await inspectCors(client, config)) { console.error('✗ CORS Storage différent du fichier versionné.'); process.exitCode = 2; }
                else console.log('✓ CORS Storage conforme ; aucune configuration appliquée.');
            } finally { await client.app.delete(); }
        } catch (error) { console.error(`Préflight CORS impossible : ${error.message}`); process.exitCode = 1; }
    } else console.log('✓ CORS local valide ; aucune configuration Storage appliquée.');
}

// Préflight M1-02 strictement en lecture : aucun batch, set, update ou delete n'est utilisé.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdminClient, PRODUCTION_BUCKET, PRODUCTION_PROJECT } from '../mobile-backup.mjs';

export const COLLECTIONS = Object.freeze(['pnjs', 'relations', 'indices', 'pnjs_prives']);
export const LEGACY_PRIVATE_KEYS = Object.freeze(['notes', 'notesMJ', 'notesPrivees', 'privateNotes']);
const PNJ_FIELDS = new Set(['nom', 'statut', 'vivant', 'lieu', 'groupe', 'description', 'imageUrl', 'imagePath', 'visibleJoueurs', 'createdAt', 'updatedAt', 'ordre', 'suppressionEnCours']);
const RELATION_FIELDS = new Set(['source', 'cible', 'type', 'label', 'color', 'style', 'visibleJoueurs', 'createdAt', 'updatedAt']);
const INDICE_FIELDS = new Set(['titre', 'description', 'decouvert', 'pnjsLies', 'imageUrl', 'imagePath', 'dateDecouverte', 'source', 'type', 'createdAt', 'updatedAt', 'ordre']);
const PRIVATE_FIELDS = new Set(['notes', 'updatedAt']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isTimestamp = value => isRecord(value)
    && typeof value.seconds === 'number' && Number.isInteger(value.seconds)
    && typeof value.nanoseconds === 'number' && Number.isInteger(value.nanoseconds)
    && value.nanoseconds >= 0 && value.nanoseconds <= 999999999;
const isString = (value, max, nonEmpty = false) => typeof value === 'string'
    && value.length <= max && (!nonEmpty || value.length > 0);
const isNumberOrNull = value => value === null || (typeof value === 'number' && Number.isFinite(value));

function optionalString(summary, collection, id, data, field, max, allowNull = false) {
    if (!Object.hasOwn(data, field)) return;
    if (allowNull && data[field] === null) return;
    if (!isString(data[field], max)) signal(summary, collection, id, `${field}-invalide`);
}

function signal(summary, collection, id, code) {
    summary.signaux.push(`${collection}/${id}:${code}`);
}

function scanFields(summary, collection, id, data, allowed) {
    for (const key of Object.keys(data)) {
        if (!allowed.has(key)) signal(summary, collection, id, 'champ-inconnu');
    }
}

function scanPnj(summary, id, data) {
    scanFields(summary, 'pnjs', id, data, PNJ_FIELDS);
    for (const key of LEGACY_PRIVATE_KEYS) {
        if (Object.hasOwn(data, key)) signal(summary, 'pnjs', id, `legacy-prive-${key}`);
    }
    if (!isString(data.nom, 200, true)) signal(summary, 'pnjs', id, 'nom-invalide');
    for (const [field, max] of [['statut', 64], ['vivant', 32], ['lieu', 200], ['groupe', 200],
        ['description', 20000], ['imageUrl', 2048], ['imagePath', 512]]) {
        optionalString(summary, 'pnjs', id, data, field, max);
    }
    if (typeof data.visibleJoueurs !== 'boolean') signal(summary, 'pnjs', id, 'visibleJoueurs-invalide');
    if (Object.hasOwn(data, 'suppressionEnCours') && typeof data.suppressionEnCours !== 'boolean') signal(summary, 'pnjs', id, 'suppressionEnCours-invalide');
    if (data.suppressionEnCours === true) signal(summary, 'pnjs', id, 'suppression-en-cours');
    if (!isTimestamp(data.createdAt)) signal(summary, 'pnjs', id, 'createdAt-invalide');
    if (!isTimestamp(data.updatedAt)) signal(summary, 'pnjs', id, 'updatedAt-invalide');
    if (!isNumberOrNull(data.ordre) && Object.hasOwn(data, 'ordre')) signal(summary, 'pnjs', id, 'ordre-invalide');
}

function scanRelation(summary, id, data, pnjs) {
    scanFields(summary, 'relations', id, data, RELATION_FIELDS);
    for (const key of ['source', 'cible', 'type']) {
        if (!isString(data[key], key === 'type' ? 100 : 150, true)) signal(summary, 'relations', id, `${key}-invalide`);
    }
    if (typeof data.visibleJoueurs !== 'boolean') signal(summary, 'relations', id, 'visibleJoueurs-invalide');
    if (!isTimestamp(data.createdAt)) signal(summary, 'relations', id, 'createdAt-invalide');
    if (!isTimestamp(data.updatedAt)) signal(summary, 'relations', id, 'updatedAt-invalide');
    const source = pnjs.get(data.source);
    const cible = pnjs.get(data.cible);
    if (!source) signal(summary, 'relations', id, 'source-inexistant');
    if (!cible) signal(summary, 'relations', id, 'cible-inexistante');
    if (source?.suppressionEnCours === true) signal(summary, 'relations', id, 'source-suppression-en-cours');
    if (cible?.suppressionEnCours === true) signal(summary, 'relations', id, 'cible-suppression-en-cours');
    if (data.visibleJoueurs === true && (!source || source.visibleJoueurs !== true)) signal(summary, 'relations', id, 'source-masque');
    if (data.visibleJoueurs === true && (!cible || cible.visibleJoueurs !== true)) signal(summary, 'relations', id, 'cible-masque');
    if (Object.hasOwn(data, 'color') && data.color !== null && !isString(data.color, 32)) signal(summary, 'relations', id, 'color-invalide');
    optionalString(summary, 'relations', id, data, 'label', 300);
    if (Object.hasOwn(data, 'style') && data.style !== 'solid' && data.style !== 'dashed') signal(summary, 'relations', id, 'style-invalide');
}

function scanIndice(summary, id, data, pnjs) {
    scanFields(summary, 'indices', id, data, INDICE_FIELDS);
    if (!isString(data.titre, 200, true)) signal(summary, 'indices', id, 'titre-invalide');
    if (typeof data.decouvert !== 'boolean') signal(summary, 'indices', id, 'decouvert-invalide');
    if (!Array.isArray(data.pnjsLies) || data.pnjsLies.length > 100) {
        signal(summary, 'indices', id, 'pnjsLies-invalide');
    } else {
        data.pnjsLies.forEach((pnjId, index) => {
            if (!isString(pnjId, 150, true)) signal(summary, 'indices', id, `pnjsLies-${index}-invalide`);
            else if (!pnjs.has(pnjId)) signal(summary, 'indices', id, `pnjsLies-${index}-inexistant`);
            else if (data.decouvert === true && pnjs.get(pnjId).visibleJoueurs !== true) signal(summary, 'indices', id, `pnjsLies-${index}-masque`);
        });
    }
    if (!isTimestamp(data.createdAt)) signal(summary, 'indices', id, 'createdAt-invalide');
    if (!isTimestamp(data.updatedAt)) signal(summary, 'indices', id, 'updatedAt-invalide');
    if (Object.hasOwn(data, 'dateDecouverte') && data.dateDecouverte !== null && !isTimestamp(data.dateDecouverte)) signal(summary, 'indices', id, 'dateDecouverte-invalide');
    if (Object.hasOwn(data, 'ordre') && !isNumberOrNull(data.ordre)) signal(summary, 'indices', id, 'ordre-invalide');
    for (const [field, max] of [['description', 30000], ['imageUrl', 2048], ['imagePath', 512],
        ['source', 150], ['type', 100]]) optionalString(summary, 'indices', id, data, field, max);
}

function scanPrivate(summary, id, data, pnjIds) {
    scanFields(summary, 'pnjs_prives', id, data, PRIVATE_FIELDS);
    if (!pnjIds.has(id)) signal(summary, 'pnjs_prives', id, 'orphelin');
    if (!isString(data.notes, 30000)) signal(summary, 'pnjs_prives', id, 'notes-invalide');
    if (!isTimestamp(data.updatedAt)) signal(summary, 'pnjs_prives', id, 'updatedAt-invalide');
}

export function validateSnapshot(collections) {
    const summary = { ok: true, vus: 0, signaux: [], comptes: {} };
    const pnjDocuments = Array.isArray(collections.pnjs) ? collections.pnjs : [];
    const pnjs = new Map(pnjDocuments
        .filter(document => document?.id && isRecord(document.data))
        .map(document => [document.id, document.data]));
    const pnjIds = new Set(pnjs.keys());
    for (const name of COLLECTIONS) {
        const documents = Array.isArray(collections[name]) ? collections[name] : [];
        summary.comptes[name] = documents.length;
        summary.vus += documents.length;
        for (const document of documents) {
            if (!document?.id || !isRecord(document.data)) {
                signal(summary, name, document?.id || 'inconnu', 'document-invalide');
                continue;
            }
            if (name === 'pnjs') scanPnj(summary, document.id, document.data);
            if (name === 'relations') scanRelation(summary, document.id, document.data, pnjs);
            if (name === 'indices') scanIndice(summary, document.id, document.data, pnjs);
            if (name === 'pnjs_prives') scanPrivate(summary, document.id, document.data, pnjIds);
        }
    }
    summary.ok = summary.signaux.length === 0;
    return summary;
}

export function parseArgs(argv = process.argv.slice(2)) {
    const value = name => argv.find(argument => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
    return { project: value('project'), bucket: value('bucket'), confirmProduction: value('confirm-production'), execute: argv.includes('--execute') };
}

export function validateTarget(options, { env = process.env } = {}) {
    const errors = [];
    if (!options.project) errors.push('--project obligatoire');
    if (!options.bucket) errors.push('--bucket obligatoire');
    if (options.execute) errors.push('préflight strictement en lecture : --execute interdit');
    const production = options.project === PRODUCTION_PROJECT || options.bucket === PRODUCTION_BUCKET;
    if (production && (options.project !== PRODUCTION_PROJECT || options.bucket !== PRODUCTION_BUCKET)) errors.push('projet et bucket de production doivent correspondre');
    if (production && options.confirmProduction !== PRODUCTION_PROJECT) errors.push('préflight production exige --confirm-production=campagne-wrpg');
    if (!production && !env.FIRESTORE_EMULATOR_HOST) errors.push('FIRESTORE_EMULATOR_HOST obligatoire hors production');
    if (env.FIRESTORE_EMULATOR_HOST && production) errors.push('cible de production interdite par le runner émulateur');
    return errors;
}

export async function readSnapshot(db) {
    const collections = {};
    for (const name of COLLECTIONS) {
        const snapshot = await db.collection(name).get();
        collections[name] = snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
    }
    return collections;
}

export async function runPreflight({ project, bucket }) {
    const client = await createAdminClient({ project, bucket });
    try {
        return validateSnapshot(await readSnapshot(client.db));
    } finally {
        await client.app.delete();
    }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const options = parseArgs();
    const errors = validateTarget(options);
    if (errors.length) {
        console.error(`Préflight M1-02 refusé : ${errors.join('; ')}`);
        process.exitCode = 1;
    } else {
        try {
            const summary = await runPreflight(options);
            console.log(JSON.stringify(summary, null, 2));
            if (!summary.ok) process.exitCode = 2;
        } catch (error) {
            console.error(`Préflight M1-02 impossible : ${error.message}`);
            process.exitCode = 1;
        }
    }
}

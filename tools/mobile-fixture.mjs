// Valide le jeu fictif M0 afin que les tests suivants disposent toujours des mêmes cas.
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, 'fixtures/mobile-baseline.json');
const PRIVATE_KEYS = new Set(['notes', 'notesprivees', 'noteprivee', 'private', 'privatenotes']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function loadMobileFixture(path = FIXTURE_PATH) {
    return JSON.parse(await readFile(path, 'utf8'));
}

function hasPrivateKey(value) {
    if (Array.isArray(value)) return value.some(hasPrivateKey);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, child]) => {
        return PRIVATE_KEYS.has(key.toLowerCase()) || hasPrivateKey(child);
    });
}

function uniqueIds(items, key, label, errors) {
    const ids = new Set();
    items.forEach((item, index) => {
        if (!isRecord(item)) {
            errors.push(`${label}[${index}] doit être un objet`);
            return;
        }
        const id = item[key];
        if (typeof id !== 'string' || !id) errors.push(`${label}[${index}].${key} doit être une chaîne non vide`);
        else if (ids.has(id)) errors.push(`${label} contient un doublon ${id}`);
        else ids.add(id);
    });
    return ids;
}

function checkString(item, key, label, errors) {
    if (typeof item[key] !== 'string' || !item[key]) errors.push(`${label}.${key} doit être une chaîne non vide`);
}

function checkStoragePath(file, errors) {
    const prefix = file.ownerType === 'pnj' ? `portraits/${file.ownerId}/` : `indices/${file.ownerId}/`;
    if (typeof file.path !== 'string' || !file.path.startsWith(prefix) || file.path.length <= prefix.length) {
        errors.push(`chemin Storage incohérent pour ${file.ownerId}`);
    }
}

export function validateMobileFixture(data) {
    const errors = [];
    if (!isRecord(data)) return ['le fixture doit être un objet'];
    if (data.format !== 'mobile-baseline-fixture' || data.version !== 2) {
        errors.push('format ou version inattendu');
    }
    const collectionNames = ['pnjs', 'pnjs_prives', 'relations', 'indices', 'storage'];
    const collections = {};
    for (const collection of collectionNames) {
        if (!Array.isArray(data[collection])) errors.push(`${collection} doit être un tableau`);
        else collections[collection] = data[collection];
    }
    if (errors.some(error => /doit être un tableau/.test(error))) return errors;

    const pnjIds = uniqueIds(collections.pnjs, 'id', 'pnjs', errors);
    const privatePnjIds = uniqueIds(collections.pnjs_prives, 'id', 'pnjs_prives', errors);
    uniqueIds(collections.relations, 'id', 'relations', errors);
    uniqueIds(collections.indices, 'id', 'indices', errors);
    const storagePaths = uniqueIds(collections.storage, 'path', 'storage', errors);
    const validPnjs = collections.pnjs.filter(isRecord);
    const validRelations = collections.relations.filter(isRecord);
    const validIndices = collections.indices.filter(isRecord);
    const validStorage = collections.storage.filter(isRecord);
    const visible = validPnjs.filter(pnj => pnj.visibleJoueurs === true);
    const hidden = validPnjs.filter(pnj => pnj.visibleJoueurs === false);
    if (collections.pnjs.length !== 5 || visible.length !== 4 || hidden.length !== 1) {
        errors.push('le fixture doit contenir exactement quatre PNJs visibles et un masqué');
    }
    if (validPnjs.filter(pnj => pnj.imagePath === null).length !== 1) {
        errors.push('un seul PNJ sans portrait est requis');
    }

    for (const pnj of collections.pnjs) {
        if (!isRecord(pnj)) continue;
        checkString(pnj, 'id', 'pnj', errors);
        checkString(pnj, 'nom', 'pnj', errors);
        if (typeof pnj.visibleJoueurs !== 'boolean') errors.push(`visibilité invalide pour ${pnj.id}`);
        if (pnj.imagePath !== null && typeof pnj.imagePath !== 'string') {
            errors.push(`imagePath invalide pour ${pnj.id}`);
        }
        if (hasPrivateKey(pnj)) errors.push(`fuite privée dans le PNJ public ${pnj.id}`);
    }
    for (const privatePnj of collections.pnjs_prives) {
        if (!isRecord(privatePnj)) continue;
        if (!pnjIds.has(privatePnj.id)) errors.push(`note privée sans PNJ ${privatePnj.id}`);
        if (typeof privatePnj.notes !== 'string') errors.push(`notes invalides pour ${privatePnj.id}`);
    }
    for (const relation of collections.relations) {
        if (!isRecord(relation)) continue;
        checkString(relation, 'source', 'relation', errors);
        checkString(relation, 'cible', 'relation', errors);
        checkString(relation, 'type', 'relation', errors);
        checkString(relation, 'label', 'relation', errors);
        if (typeof relation.visibleJoueurs !== 'boolean') errors.push(`visibilité de relation invalide ${relation.id}`);
        if (!pnjIds.has(relation.source)) errors.push(`source de relation invalide ${relation.id}`);
        const cibleValide = pnjIds.has(relation.cible);
        if (!cibleValide && relation.fixtureCase !== 'broken-reference') {
            errors.push(`cible de relation invalide ${relation.id}`);
        }
        if (relation.fixtureCase === 'broken-reference' && cibleValide) {
            errors.push(`référence cassée non cassée ${relation.id}`);
        }
        const source = validPnjs.find(pnj => pnj.id === relation.source);
        const cible = validPnjs.find(pnj => pnj.id === relation.cible);
        if (relation.visibleJoueurs && (!source?.visibleJoueurs || !cible?.visibleJoueurs)) {
            errors.push(`relation publique vers un PNJ masqué ou absent ${relation.id}`);
        }
    }
    const pairGroups = new Map();
    validRelations.filter(relation => relation.bidirectionalGroup).forEach(relation => {
        const group = pairGroups.get(relation.bidirectionalGroup) ?? [];
        group.push(relation);
        pairGroups.set(relation.bidirectionalGroup, group);
    });
    for (const [groupName, pair] of pairGroups) {
        if (pair.length !== 2) {
            errors.push(`paire miroir ${groupName} incomplète`);
            continue;
        }
        const [first, second] = pair;
        if (first.source !== second.cible || first.cible !== second.source
            || first.type !== second.type || first.label !== second.label) {
            errors.push(`paire miroir ${groupName} incorrecte`);
        }
    }
    if (!validRelations.some(relation => relation.fixtureCase === 'simple')) {
        errors.push('une relation simple est requise');
    }
    if (!validRelations.some(relation => relation.bidirectionalGroup === 'fixture-pair'
        && relation.source === 'fixture-brunhilde' && relation.cible === 'fixture-cassandre')) {
        errors.push('la paire miroir fixture-pair est requise');
    }
    if (!validRelations.some(relation => relation.fixtureCase === 'broken-reference'
        && !pnjIds.has(relation.cible))) {
        errors.push('une référence cassée est requise');
    }
    for (const indice of collections.indices) {
        if (!isRecord(indice)) continue;
        checkString(indice, 'id', 'indice', errors);
        checkString(indice, 'titre', 'indice', errors);
        if (typeof indice.decouvert !== 'boolean') errors.push(`drapeau découvert invalide ${indice.id}`);
        if (!Array.isArray(indice.pnjsLies)) errors.push(`pnjsLies invalide ${indice.id}`);
        else indice.pnjsLies.forEach(id => {
            if (typeof id !== 'string' || !pnjIds.has(id)) errors.push(`PNJ lié invalide dans ${indice.id}`);
        });
        checkString(indice, 'imagePath', 'indice', errors);
    }
    const discoveredIndices = validIndices.filter(indice => indice.decouvert === true);
    if (discoveredIndices.length < 2) errors.push('au moins deux indices découverts sont requis');
    if (!validIndices.some(indice => indice.decouvert === false)) errors.push('au moins un indice secret est requis');
    if (!validIndices.some(indice => Array.isArray(indice.pnjsLies) && indice.pnjsLies.length > 1)) {
        errors.push('au moins un indice lié à plusieurs PNJs est requis');
    }

    const referencedMedia = new Map();
    validPnjs.forEach(pnj => {
        if (pnj.imagePath) referencedMedia.set(pnj.imagePath, {
            ownerType: 'pnj', ownerId: pnj.id, protected: !pnj.visibleJoueurs,
        });
    });
    validIndices.forEach(indice => referencedMedia.set(indice.imagePath, {
        ownerType: 'indice', ownerId: indice.id, protected: !indice.decouvert,
    }));
    for (const [path, expected] of referencedMedia) {
        if (!storagePaths.has(path)) errors.push(`média référencé absent ${path}`);
        else {
            const file = validStorage.find(item => item.path === path);
            if (file.ownerType !== expected.ownerType || file.ownerId !== expected.ownerId) {
                errors.push(`propriétaire Storage incorrect ${path}`);
            }
            if (file.shouldBeProtected !== expected.protected) errors.push(`protection Storage incorrecte ${path}`);
        }
    }
    let orphanCount = 0;
    for (const file of validStorage) {
        if (!isRecord(file)) continue;
        if (!['pnj', 'indice'].includes(file.ownerType)) errors.push(`ownerType Storage invalide ${file.path}`);
        if (typeof file.ownerId !== 'string') errors.push(`ownerId Storage invalide ${file.path}`);
        if (typeof file.shouldBeProtected !== 'boolean') errors.push(`protection Storage invalide ${file.path}`);
        checkStoragePath(file, errors);
        if (!referencedMedia.has(file.path)) {
            orphanCount += 1;
            if (file.fixtureCase !== 'orphan' || file.ownerId !== 'fixture-orphelin') {
                errors.push(`média non référencé non identifié comme orphelin ${file.path}`);
            }
        }
    }
    if (orphanCount !== 1) errors.push('un seul média orphelin intentionnel est requis');
    if (privatePnjIds.size < 1) errors.push('une collection pnjs_prives non vide est requise');
    const text = JSON.stringify(data);
    if (!/[À-ÿ]/u.test(text) || !/[']/u.test(text) || !/[<>]/u.test(text)) {
        errors.push('le jeu doit couvrir accents, apostrophes et caractères HTML');
    }
    return errors;
}

if (process.argv.includes('--check')) {
    try {
        const fixture = await loadMobileFixture();
        const errors = validateMobileFixture(fixture);
        if (errors.length) {
            errors.forEach(error => console.error(`✗ Fixture mobile invalide : ${error}`));
            process.exitCode = 1;
        } else {
            console.log(`✓ Fixture mobile M0 valide (${fixture.pnjs.length} PNJs, ${fixture.indices.length} indices).`);
        }
    } catch (error) {
        console.error(`✗ Fixture mobile invalide : ${error.message}`);
        process.exitCode = 1;
    }
}

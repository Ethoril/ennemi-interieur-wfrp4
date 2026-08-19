// Produit uniquement des agrégats à partir d'un backup local ; aucune valeur n'est imprimée.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import {
    COLLECTIONS,
    resolveBackupPath,
    validateCollectionManifest,
    validateStorageManifest,
    verifyFileIntegrity,
} from './mobile-backup.mjs';

function option(name) {
    const prefix = `--${name}=`;
    const value = process.argv.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : null;
}

function typeName(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.__type) return value.__type;
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

function fieldStats(documents) {
    const stats = new Map();
    for (const document of documents) {
        const data = document?.data;
        if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
        for (const [field, value] of Object.entries(data)) {
            const current = stats.get(field) ?? { types: new Map(), present: 0 };
            const type = typeName(value);
            current.types.set(type, (current.types.get(type) ?? 0) + 1);
            current.present += 1;
            stats.set(field, current);
        }
    }
    return stats;
}

function fieldTable(documents) {
    const stats = fieldStats(documents);
    return [...stats.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([field, value]) => {
        const types = [...value.types.entries()].sort(([left], [right]) => left.localeCompare(right));
        const typeText = types.map(([type, count]) => `${type} (${count})`).join(', ');
        const atypical = types.length > 1 ? documents.length - Math.max(...types.map(([, count]) => count)) : 0;
        return `| \`${field}\` | ${typeText} | ${value.present} | ${documents.length - value.present} | ${atypical} |`;
    }).join('\n') || '| *(aucun champ)* | — | 0 | 0 | 0 |';
}

function getReference(data, keys) {
    for (const key of keys) if (typeof data?.[key] === 'string') return data[key];
    return null;
}

function storagePrefix(path) {
    if (path.startsWith('portraits/')) return 'portraits/';
    if (path.startsWith('indices/')) return 'indices/';
    return 'autre';
}

function storagePathFromImageUrl(value) {
    if (typeof value !== 'string') return null;
    if (value.startsWith('portraits/') || value.startsWith('indices/')) return value;
    if (value.startsWith('gs://')) {
        const slash = value.indexOf('/', 5);
        return slash >= 0 ? value.slice(slash + 1) : null;
    }
    try {
        const pathname = new URL(value).pathname;
        const marker = '/o/';
        const index = pathname.indexOf(marker);
        return index >= 0 ? decodeURIComponent(pathname.slice(index + marker.length)) : null;
    } catch {
        return null;
    }
}

function collectImageReferences(value, references) {
    if (Array.isArray(value)) {
        value.forEach(item => collectImageReferences(item, references));
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (/^image(url|path)$/iu.test(key)) {
            const path = storagePathFromImageUrl(child);
            if (path) references.add(path);
        } else {
            collectImageReferences(child, references);
        }
    }
}

async function loadBackup(input) {
    const manifestPath = resolveBackupPath(input, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.format !== 'mobile-baseline-backup' || manifest.version !== 1 || manifest.complete !== true) {
        throw new Error('backup incomplet ou format inconnu');
    }
    const collections = {};
    for (const collection of COLLECTIONS) {
        const details = manifest.collections?.[collection];
        if (!details) throw new Error(`collection absente : ${collection}`);
        const path = resolveBackupPath(input, details.file);
        await verifyFileIntegrity(path, details, collection);
        const documents = JSON.parse(await readFile(path, 'utf8'));
        const errors = validateCollectionManifest(collection, details, documents);
        if (errors.length) throw new Error(`collection invalide : ${collection}`);
        collections[collection] = documents;
    }
    const storageErrors = validateStorageManifest(manifest.storage);
    if (storageErrors.length) throw new Error(storageErrors.join('; '));
    for (const file of manifest.storage.files) {
        if (!file.path.startsWith('portraits/') && !file.path.startsWith('indices/')) {
            throw new Error('préfixe Storage invalide');
        }
        resolveBackupPath(input, file.path);
        await verifyFileIntegrity(resolveBackupPath(input, `storage/${file.path}`), file, 'Storage');
    }
    return { manifest, collections };
}

export async function createProductionInventory(input, generatedAt = new Date().toISOString()) {
    const { manifest, collections } = await loadBackup(resolve(input));
    const pnjIds = new Set(collections.pnjs.map(document => document.id));
    const relations = collections.relations.map(document => document.data ?? {});
    const relationReferences = relations.flatMap(data => [
        getReference(data, ['source', 'sourceId']), getReference(data, ['cible', 'target', 'targetId']),
    ].filter(Boolean));
    const brokenRelations = relations.reduce((total, data) => total
        + [getReference(data, ['source', 'sourceId']), getReference(data, ['cible', 'target', 'targetId'])]
            .filter(reference => reference && !pnjIds.has(reference)).length, 0);
    const indiceReferences = collections.indices.flatMap(document => {
        const data = document.data ?? {};
        const references = data.pnjsLies ?? data.pnjIds ?? data.linkedPnjIds ?? [];
        return Array.isArray(references) ? references : [];
    });
    const brokenIndices = indiceReferences.filter(reference => !pnjIds.has(reference)).length;
    const referencedPaths = new Set();
    Object.values(collections).forEach(documents => documents.forEach(document => collectImageReferences(document.data, referencedPaths)));
    const storageGroups = new Map();
    let orphanCount = 0;
    let referencedFileCount = 0;
    let duplicatePathCount = 0;
    const seenPaths = new Set();
    for (const file of manifest.storage.files) {
        if (seenPaths.has(file.path)) duplicatePathCount += 1;
        seenPaths.add(file.path);
        const prefix = storagePrefix(file.path);
        const key = `${prefix}|${file.contentType ?? 'inconnu'}`;
        const group = storageGroups.get(key) ?? { prefix, contentType: file.contentType ?? 'inconnu', count: 0, bytes: 0 };
        group.count += 1;
        group.bytes += Number(file.size);
        storageGroups.set(key, group);
        if (referencedPaths.has(file.path)) referencedFileCount += 1;
        else orphanCount += 1;
    }
    const missingReferenceCount = [...referencedPaths].filter(path => !seenPaths.has(path)).length;
    const collectionSections = COLLECTIONS.map(collection => {
        const documents = collections[collection];
        return `### ${collection}\n\nDocuments : **${documents.length}**\n\n| Champ | Types (compte) | Présent | Absent | Atypique |\n|---|---|---:|---:|---:|\n${fieldTable(documents)}`;
    }).join('\n\n');
    const storageRows = [...storageGroups.values()].sort((left, right) => `${left.prefix}${left.contentType}`.localeCompare(`${right.prefix}${right.contentType}`))
        .map(group => `| ${group.prefix} | ${group.contentType} | ${group.count} | ${group.bytes} |`).join('\n') || '| *(aucun)* | — | 0 | 0 |';
    return `# Inventaire production M0-01 — agrégats\n\n> Généré le ${generatedAt}. Rapport volontairement limité aux comptes, types et anomalies ; aucune valeur, note, URL, adresse, identifiant, nom de fichier, hash ou chemin local n'est recopié.\n\n## Collections\n\n${collectionSections}\n\n## Références\n\n- Références de relations recensées : **${relationReferences.length}** ; références cassées : **${brokenRelations}**.\n- Références PNJ depuis les indices recensées : **${indiceReferences.length}** ; références cassées : **${brokenIndices}**.\n- Valeurs atypiques : comptées par champ lorsque plusieurs types coexistent ; les valeurs elles-mêmes ne sont pas exportées.\n\n## Storage\n\n- Objets : **${manifest.storage.count}** ; taille totale : **${manifest.storage.totalBytes} octets**.\n- Objets référencés par les champs image : **${referencedFileCount}** ; vrais orphelins : **${orphanCount}** ; références sans objet : **${missingReferenceCount}**.\n- Chemins dupliqués dans le manifeste : **${duplicatePathCount}**.\n\n| Préfixe | Type MIME | Fichiers | Octets |\n|---|---|---:|---:|\n${storageRows}\n`;
}

const input = option('backup');
const output = option('out');
if (input && output) {
    try {
        if (!isAbsolute(input)) throw new Error('--backup doit être absolu');
        await mkdir(dirname(resolve(output)), { recursive: true });
        await writeFile(resolve(output), await createProductionInventory(input), 'utf8');
        console.log('✓ Inventaire agrégé écrit.');
    } catch (error) {
        console.error(`✗ ${error.message}`);
        process.exitCode = 1;
    }
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.error('Usage : node tools/mobile-production-inventory.mjs --backup=CHEMIN-ABSOLU --out=RAPPORT.md');
    process.exitCode = 1;
}

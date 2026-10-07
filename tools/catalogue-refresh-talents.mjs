import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseTalentSheet } from './lib/talent-sheet.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Même graine publiée obligatoire que catalogue-build-snapshot.mjs ; aucun fichier généré n'est recyclé.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = process.argv.find(arg => arg.startsWith('--seed='))?.slice(7);
const seedKey = path => process.platform === 'win32' ? resolve(root, path).toLowerCase() : resolve(root, path);
if (!seedPath || ['js/catalogue/referentiel-public.json', 'functions/src/catalogue/referentiel-public.json'].map(seedKey).includes(seedKey(seedPath))) {
    throw new Error('Fournir --seed=<published-catalogue.json> avant de rafraîchir le référentiel.');
}
await readFile(resolve(root, seedPath), 'utf8');
const spreadsheetId = '1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs';
const worksheet = 'Talents';
const gid = '1096647859';
const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(worksheet)}`;

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

const response = await fetch(url);
if (!response.ok) throw new Error(`Instantané public des talents indisponible (${response.status}).`);
const entries = parseTalentSheet(await response.text());
const names = new Set(entries.map(row => row.nom.normalize('NFC').toLocaleLowerCase('fr')));
if (entries.length < 100 || names.size !== entries.length || entries.some(row => !row.description)) {
    throw new Error(`Snapshot refusé : ${entries.length} lignes, ${names.size} noms uniques.`);
}
const metadata = JSON.parse(await readFile(resolve(root, 'js/catalogue/talent-legacy-aliases.json'), 'utf8'));
const catalogVersion = `sha256:${createHash('sha256').update(stableJson({ entries, ...metadata })).digest('hex')}`;
const snapshot = {
    schemaVersion: 2,
    catalogVersion,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: { kind: 'google-sheets-public-snapshot', spreadsheetId, worksheet, gid },
    entries,
    ...metadata,
};
const target = resolve(root, 'js/catalogue/talents-sheet-snapshot.json');
await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
process.stdout.write(`${entries.length} descriptions récupérées, ${catalogVersion}\n`);
await import('./catalogue-build-snapshot.mjs');

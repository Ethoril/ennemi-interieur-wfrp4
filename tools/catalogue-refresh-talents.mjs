import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spreadsheetId = '1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs';
const worksheet = 'Talents';
const gid = '1096647859';
const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(worksheet)}`;

function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else if (character === '"') quoted = false;
            else cell += character;
        } else if (character === '"') quoted = true;
        else if (character === ',') {
            row.push(cell);
            cell = '';
        } else if (character === '\n' || character === '\r') {
            if (character === '\r' && text[index + 1] === '\n') index += 1;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else cell += character;
    }
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}

function headerKey(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

const response = await fetch(url);
if (!response.ok) throw new Error(`Instantané public des talents indisponible (${response.status}).`);
const [headers, ...rows] = parseCsv((await response.text()).replace(/^\uFEFF/u, ''));
if (!headers) throw new Error('CSV du tableau de talents vide ou illisible.');
const headerIndexes = new Map(headers.map((header, index) => [headerKey(header), index]));
const nameIndex = headerIndexes.get('nom du talent');
const descriptionIndex = headerIndexes.get("resume precis de l'effet");
const sourceIndex = headerIndexes.get('sources');
if ([nameIndex, descriptionIndex, sourceIndex].some(index => index === undefined)) throw new Error('Colonnes du tableau Talents inattendues.');
const entries = rows.map(row => ({
    nom: String(row[nameIndex] || '').trim(),
    description: String(row[descriptionIndex] || '').trim(),
    source: String(row[sourceIndex] || '').trim(),
})).filter(row => row.nom);
const names = new Set(entries.map(row => row.nom.normalize('NFC').toLocaleLowerCase('fr')));
if (entries.length < 100 || names.size !== entries.length || entries.some(row => !row.description)) {
    throw new Error(`Snapshot refusé : ${entries.length} lignes, ${names.size} noms uniques.`);
}
const catalogVersion = `sha256:${createHash('sha256').update(stableJson(entries)).digest('hex')}`;
const snapshot = {
    catalogVersion,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: { kind: 'google-sheets-public-snapshot', spreadsheetId, worksheet, gid },
    entries,
};
const target = resolve(root, 'js/catalogue/talents-sheet-snapshot.json');
await writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
process.stdout.write(`${entries.length} descriptions récupérées, ${catalogVersion}\n`);
await import('./catalogue-build-snapshot.mjs');

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spreadsheet = 'https://docs.google.com/spreadsheets/d/1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs/gviz/tq?tqx=out:csv&sheet=';
const sources = { spells: `${spreadsheet}Magie`, miracles: `${spreadsheet}Miracles` };

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

function normalizeHeader(value) {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
}

function rowsToRecords(csvText) {
    const [headers, ...rows] = parseCsv(csvText);
    if (!headers) throw new Error('Export CSV vide ou illisible');
    const keys = headers.map(normalizeHeader);
    return rows.map(values => Object.fromEntries(keys
        .map((key, index) => [key, (values[index] || '').trim()])
        .filter(([key]) => key)))
        .filter(record => record.nom);
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

const exports = {};
for (const [kind, url] of Object.entries(sources)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Export public ${kind} indisponible (${response.status})`);
    exports[kind] = rowsToRecords(await response.text());
}
const spells = exports.spells.map(row => ({
    nom: row.nom,
    type: row.type || '',
    cn: Number(row.ni) || 0,
    portee: row.portee || '',
    duree: row.duree || '',
    desc: row.description || '',
}));
const miracles = exports.miracles.map(row => ({
    nom: row.nom,
    portee: row.portee || '',
    cible: row.cible || '',
    duree: row.duree || '',
    effet: row.effet || '',
}));
const careers = JSON.parse(await readFile(resolve(root, 'js/data/careers.json'), 'utf8'));
const skills = JSON.parse(await readFile(resolve(root, 'js/data/skills.json'), 'utf8'));
const versionInput = { careers, skills, spells, miracles };
const catalogVersion = `sha256:${createHash('sha256').update(canonicalJson(versionInput)).digest('hex')}`;
const catalog = {
    catalogVersion,
    fetchedAt: new Date().toISOString().slice(0, 10),
    sources,
    spells,
    miracles,
};
await writeFile(resolve(root, 'js/data/fiche-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
process.stdout.write(`Fiche catalog refreshed: ${spells.length} spells, ${miracles.length} miracles, ${catalogVersion}\n`);

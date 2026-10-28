import { URL } from 'node:url';
// Recalcule uniquement l'identité du catalogue après évolution locale des compétences.
// Les sorts et miracles existants sont conservés, aucune requête réseau.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const [careers, skills, catalog] = await Promise.all(['js/data/careers.json', 'js/data/skills.json', 'js/data/fiche-catalog.json'].map(read));
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const catalogVersion = `sha256:${createHash('sha256').update(canonical({careers, skills, spells: catalog.spells, miracles: catalog.miracles})).digest('hex')}`;
if (process.argv.includes('--check')) {
    if (catalog.catalogVersion !== catalogVersion) throw new Error('Identité de fiche-catalog périmée');
} else await writeFile(resolve(root, 'js/data/fiche-catalog.json'), `${JSON.stringify({...catalog, catalogVersion}, null, 2)}\n`);

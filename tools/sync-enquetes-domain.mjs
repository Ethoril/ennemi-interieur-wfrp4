import { URL } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
const src = new URL('../functions/src/enquetes/domain.mjs',import.meta.url);
const dst = new URL('../js/data/enquetes-domain.js',import.meta.url);
const content = await readFile(src,'utf8');
if (process.argv.includes('--check')) {
  if (await readFile(dst,'utf8').catch(()=> '') !== content) throw new Error('Domaine enquêtes non synchronisé');
} else await writeFile(dst,content,'utf8');



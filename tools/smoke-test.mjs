// Smoke test : charge careers.js dans un environnement simulé et imprime des stats.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const code = await readFile(resolve(__dirname, '..', 'js', 'data', 'careers.js'), 'utf8');
const sandbox = { window: {} };
new Function('window', code)(sandbox.window);
const cs = sandbox.window.WFRP_CAREERS;

const variants = cs.filter(c => c.rangs.some((r, i, a) => a.findIndex(x => x.rang === r.rang) !== i));
const prereqs  = cs.filter(c => c.prereq);

console.log('Carrières totales        :', cs.length);
console.log('Carrières avec variantes :', variants.length);
variants.forEach(c => {
    const dup = {};
    c.rangs.forEach(r => { dup[r.rang] = (dup[r.rang] || 0) + 1; });
    const vrang = Object.entries(dup).filter(([_, n]) => n > 1).map(([r, n]) => `r${r}=${n}`).join(', ');
    console.log(`  - ${c.nom} (${vrang})`);
});
console.log('Sous-carrières avec prereq:', prereqs.length);
prereqs.forEach(c => console.log(`  - ${c.nom} ⟵ ${c.prereq.career} rang ${c.prereq.minRang}+`));

// Cas test précis : Artisan rang 2
const artisan = cs.find(c => c.nom === 'Artisan');
const r2 = artisan.rangs.filter(r => r.rang === 2);
console.log(`\nArtisan rang 2 : ${r2.length} variante(s) — ${r2.map(r => r.titre).join(', ')}`);

// Mage (HE) doit avoir 5 rangs
const mage = cs.find(c => c.nom === 'Mage (HE)');
console.log(`Mage (HE) : ${mage.rangs.length} rangs — ${mage.rangs.map(r => `r${r.rang}=${r.titre}`).join(', ')}`);

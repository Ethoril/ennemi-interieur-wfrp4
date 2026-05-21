// Smoke test : charge careers.json, imprime des stats, valide les références
// vers skills.js par diff avec un baseline (tools/skills-baseline.json).
//
// Sortie 1 si :
//   - une NOUVELLE incohérence apparaît (régression : à corriger)
//   - le baseline est invalide
//
// Les incohérences déjà présentes dans le baseline sont tolérées : c'est la
// dette connue, à résorber au fur et à mesure que skills.js est complété.
// Quand des incohérences disparaissent, le script suggère --update-baseline.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadSkills, validateSkillReferences, formatIssues } from './lib/validate-skills.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAREERS_PATH  = resolve(__dirname, '..', 'js', 'data', 'careers.json');
const BASELINE_PATH = resolve(__dirname, 'skills-baseline.json');
const UPDATE = process.argv.includes('--update-baseline');

const cs = JSON.parse(await readFile(CAREERS_PATH, 'utf8'));

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

const artisan = cs.find(c => c.nom === 'Artisan');
if (artisan) {
    const r2 = artisan.rangs.filter(r => r.rang === 2);
    console.log(`\nArtisan rang 2 : ${r2.length} variante(s) — ${r2.map(r => r.titre).join(', ')}`);
}
const mage = cs.find(c => c.nom === 'Mage (HE)');
if (mage) {
    console.log(`Mage (HE) : ${mage.rangs.length} rangs — ${mage.rangs.map(r => `r${r.rang}=${r.titre}`).join(', ')}`);
}

// ── Validation cross-data ────────────────────────────────
console.log('\n── Validation skills.js ─────────────────────');
const skills = await loadSkills();
const issues = validateSkillReferences(cs, skills);
const issueKey = i => `${i.career}::r${i.rang}::${i.skill}`;
const current = new Set(issues.map(issueKey));
const currentSorted = [...current].sort();

if (UPDATE) {
    await writeFile(BASELINE_PATH, JSON.stringify(currentSorted, null, 2) + '\n', 'utf8');
    console.log(`✓ Baseline mise à jour : ${current.size} incohérence(s) dans ${BASELINE_PATH}`);
    process.exit(0);
}

let baseline;
try {
    baseline = new Set(JSON.parse(await readFile(BASELINE_PATH, 'utf8')));
} catch (err) {
    if (err.code === 'ENOENT') {
        console.error(`✗ Baseline absente. Génère-la avec : node tools/smoke-test.mjs --update-baseline`);
        process.exit(1);
    }
    throw err;
}

const regressions = issues.filter(i => !baseline.has(issueKey(i)));
const fixed = [...baseline].filter(k => !current.has(k));

console.log(`Connues (baseline) : ${baseline.size}`);
console.log(`Actuelles          : ${current.size}`);
console.log(`Nouvelles (régression) : ${regressions.length}`);
console.log(`Résolues               : ${fixed.length}`);

if (fixed.length) {
    console.log('\n✓ Incohérences résolues :');
    fixed.slice(0, 10).forEach(k => console.log(`  - ${k}`));
    if (fixed.length > 10) console.log(`  … et ${fixed.length - 10} de plus`);
    console.log('  → mets à jour le baseline : node tools/smoke-test.mjs --update-baseline');
}

if (regressions.length) {
    console.error('\n✗ Régressions (nouvelles incohérences) :');
    console.error(formatIssues(regressions));
    console.error(`\n→ corrige skills.js ou le Google Sheet, puis relance.`);
    process.exit(1);
}

console.log('\n✓ Smoke test OK.');

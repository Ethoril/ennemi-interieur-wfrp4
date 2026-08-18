// Hook PostToolUse : relit au lint le fichier que Claude vient d'éditer.
// Rejoue localement le contrôle de la CI (npm run lint) sur le seul fichier
// touché, pour attraper une régression tout de suite plutôt qu'en CI.
// Ne s'active que sur ce que eslint.config.mjs linte réellement :
// js/**/*.js, sw.js, tools/**/*.mjs. Reste muet sinon.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

// L'entrée du hook arrive en JSON sur l'entrée standard (fd 0).
let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { process.exit(0); }

let input;
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

const filePath = input && input.tool_input && input.tool_input.file_path;
if (!filePath) process.exit(0);

const cwd = (input && input.cwd) || process.cwd();
const rel = relative(cwd, resolve(cwd, filePath)).replace(/\\/g, '/');

// Ne linter que ce que la CI linte.
const lintable = /^js\/.+\.js$/.test(rel) || rel === 'sw.js' || /^tools\/.+\.mjs$/.test(rel);
if (!lintable) process.exit(0);

let ESLint;
try {
    ({ ESLint } = await import('eslint'));
} catch {
    // Outillage absent (node_modules non installé) : ne pas gêner l'édition.
    process.exit(0);
}

let results;
try {
    const eslint = new ESLint({ cwd });
    results = await eslint.lintFiles([rel]);
    const problems = results.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
    if (problems === 0) process.exit(0);

    const formatter = await eslint.loadFormatter('stylish');
    const text = await formatter.format(results);
    process.stderr.write(
        `ESLint signale ${problems} problème(s) sur ${rel}. `
        + `La CI (npm run lint) exige 0 erreur et 0 avertissement — à corriger avant de conclure :\n\n`
        + `${text}\n`,
    );
    // Sortie 2 : le message part vers Claude, qui doit traiter le signalement.
    process.exit(2);
} catch {
    // Un souci du lint lui-même ne doit jamais bloquer une édition.
    process.exit(0);
}

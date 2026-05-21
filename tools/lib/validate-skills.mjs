// Validation cross-data : chaque compétence référencée dans careers.json
// doit exister dans skills.js (sauf slots "ouverts" type "(au choix)" et
// spécialisations génériques type "(Langue)" résolues à l'usage).

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_PATH = resolve(__dirname, '..', '..', 'js', 'data', 'skills.js');

// Doit rester aligné avec fiche.js (OPEN_SPEC_PATTERN / GENERIC_SPEC_WORDS).
const GENERIC_SPEC_WORDS = new Set([
    'Région','Localité','Langue','Commerce','Peuple','Matériau',
    'Arme','Ennemi','Organisation','Divinité',
]);
const OPEN_SPEC_PATTERN = /\(au choix\)$/i;

function isOpenSlot(s) {
    if (OPEN_SPEC_PATTERN.test(s)) return true;
    const m = s.match(/\(([^)]+)\)$/);
    return m ? GENERIC_SPEC_WORDS.has(m[1].trim()) : false;
}

function parseName(s) {
    const m = s.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    return m ? { group: m[1].trim(), spec: m[2].trim() }
             : { group: s.trim(), spec: '' };
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i-1] === b[j-1]
                ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
        }
    }
    return dp[m][n];
}

// skills.js exporte via `window.WFRP_SKILLS = …`. On l'exécute dans un sandbox
// pour récupérer le tableau sans dupliquer la liste côté Node.
export async function loadSkills() {
    const code = await readFile(SKILLS_PATH, 'utf8');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    if (!Array.isArray(sandbox.window.WFRP_SKILLS)) {
        throw new Error(`skills.js n'a pas exposé window.WFRP_SKILLS (chemin : ${SKILLS_PATH})`);
    }
    return sandbox.window.WFRP_SKILLS;
}

export function validateSkillReferences(careers, skills) {
    const knownNames = new Set(skills.map(s => s.nom.toLowerCase()));
    const groupSpecs = new Map();
    for (const s of skills) {
        const g = s.group.toLowerCase();
        if (!groupSpecs.has(g)) groupSpecs.set(g, new Set());
        if (s.spec) groupSpecs.get(g).add(s.spec);
    }

    const issues = [];
    for (const c of careers) {
        for (const r of c.rangs) {
            for (const skillRef of (r.skills || [])) {
                if (isOpenSlot(skillRef)) continue;
                if (knownNames.has(skillRef.toLowerCase())) continue;

                const { group, spec } = parseName(skillRef);
                const groupKey = group.toLowerCase();
                if (groupSpecs.has(groupKey)) {
                    let suggestion = null;
                    const specs = [...groupSpecs.get(groupKey)];
                    if (spec && specs.length) {
                        const lo = spec.toLowerCase();
                        suggestion = specs.reduce((best, s) =>
                            levenshtein(s.toLowerCase(), lo) <
                            levenshtein(best.toLowerCase(), lo) ? s : best);
                    }
                    issues.push({ career: c.nom, rang: r.rang, skill: skillRef,
                                  kind: 'unknown-spec', suggestion });
                } else {
                    issues.push({ career: c.nom, rang: r.rang, skill: skillRef,
                                  kind: 'unknown-group', suggestion: null });
                }
            }
        }
    }
    return issues;
}

export function formatIssues(issues) {
    if (!issues.length) return '✓ Toutes les compétences référencées existent dans skills.js.';
    const lines = [`⚠ ${issues.length} compétence(s) introuvable(s) dans skills.js :`];
    for (const i of issues) {
        const suggest = i.suggestion ? ` → suggestion : « ${i.suggestion} »` : '';
        const reason = i.kind === 'unknown-group' ? 'groupe inconnu' : 'spec inconnue';
        lines.push(`  - ${i.career} (rang ${i.rang}) : « ${i.skill} » (${reason})${suggest}`);
    }
    return lines.join('\n');
}

// Hook PreToolUse : demande confirmation avant d'éditer un fichier sensible.
// Règles de sécurité Firebase, CSP des pages, init Firebase : une modification
// accidentelle expose les données des joueurs ou affaiblit la protection contre
// les injections. Le hook ne bloque pas — il passe la main à l'utilisateur
// (permissionDecision "ask"), qui relit et tranche.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { process.exit(0); }

let input;
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }

const filePath = input && input.tool_input && input.tool_input.file_path;
if (!filePath) process.exit(0);

const cwd = (input && input.cwd) || process.cwd();
const rel = relative(cwd, resolve(cwd, filePath)).replace(/\\/g, '/');

function ask(motif) {
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason:
                `Fichier sensible : ${rel} — ${motif}. Relire la modification avant de l'appliquer.`,
        },
    }));
    process.exit(0);
}

// Fichiers sensibles par chemin exact.
const sensibles = {
    'firestore.rules': 'règles d’accès aux données joueurs (Firestore)',
    'storage.rules': 'règles d’accès au stockage (portraits, indices)',
    'js/firebase-init.js': 'initialisation Firebase et compte administrateur (ADMIN_EMAIL)',
    'firebase.json': 'configuration de déploiement Firebase',
    '.firebaserc': 'projet Firebase ciblé',
};
if (sensibles[rel]) ask(sensibles[rel]);

// CSP : embarquée dans le <head> de chaque page. Ne gêner que si l'édition la touche.
if (/\.html$/.test(rel)) {
    const payload = JSON.stringify(input.tool_input || {});
    if (/Content-Security-Policy|http-equiv/i.test(payload)) {
        ask('politique de sécurité du contenu (CSP) de la page');
    }
}

process.exit(0);

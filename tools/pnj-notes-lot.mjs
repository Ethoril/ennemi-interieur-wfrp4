// Remplit les notes privées MJ (pnjs_prives/{id}) de fiches PNJ à partir d'un fichier de lot hors dépôt.
// À blanc par défaut ; --apply écrit. Ne montre jamais le texte des notes (contenu privé).
import { createCliAuthenticatedClient } from './fiche-prod-backup.mjs';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFile, writeFile } from 'node:fs/promises';
import { planNotesLot, validateLot } from './lib/pnj-notes-lot-plan.mjs';

const USAGE = `Usage : node tools/pnj-notes-lot.mjs --project <id> [--confirm-production] --lot <chemin> [--apply] [--report <chemin>]
  --project             projet Firebase (campagne-wrpg exige --confirm-production ; sinon demo-* ou *recette*)
  --lot                 fichier JSON du lot (hors dépôt)
  --apply               écrit réellement (par défaut : à blanc, rien n'est écrit)
  --report              écrit le résumé en JSON, sans le texte des notes
Code de sortie 2 s'il y a au moins une entrée ignorée (fiche absente, nom différent, notes trop longues) ou en conflit.`;
const FLAGS = new Set(['--project', '--lot', '--report', '--apply', '--confirm-production']);
const WITH_VALUE = new Set(['--project', '--lot', '--report']);
const A_SIGNALER = new Set(['skip-missing', 'skip-name-mismatch', 'skip-too-long', 'conflict']);

function usage(message) {
    if (message) console.error(message);
    console.error(USAGE);
    process.exit(1);
}

const args = process.argv.slice(2);
const values = {};
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!FLAGS.has(arg)) usage(`Argument inconnu : ${arg}`);
    if (WITH_VALUE.has(arg)) {
        const value = args[++i];
        if (!value || value.startsWith('--')) usage(`${arg} attend une valeur`);
        values[arg] = value;
    }
}
const project = values['--project'], lotPath = values['--lot'];
if (!project) usage('--project est obligatoire');
if (!lotPath) usage('--lot est obligatoire');
const applying = args.includes('--apply'), production = project === 'campagne-wrpg';
if (production && !args.includes('--confirm-production')) usage('La production nécessite une autorisation humaine et --confirm-production');
if (!production && !project.startsWith('demo-') && !project.includes('recette')) usage('Projet de recette ou demo requis');
if (process.env.FIRESTORE_EMULATOR_HOST && !project.startsWith('demo-')) usage('Émulateur : projet demo requis');

// Lecture et validation du lot avant toute connexion.
let lot;
try {
    lot = validateLot(JSON.parse(await readFile(lotPath, 'utf8')));
} catch (error) {
    usage(`Lot illisible : ${error.message}`);
}

const client = production ? await createCliAuthenticatedClient() : null;
if (!client) initializeApp({ projectId: project });
const db = client?.db || getFirestore();
try {
    const state = new Map();
    for (const { pnjId } of lot.entries) {
        const [pnj, prive] = await Promise.all([db.doc(`pnjs/${pnjId}`).get(), db.doc(`pnjs_prives/${pnjId}`).get()]);
        state.set(pnjId, {
            exists: pnj.exists,
            nom: pnj.exists ? String(pnj.data().nom ?? '') : '',
            notes: prive.exists ? String(prive.data().notes ?? '') : '',
        });
    }
    const plan = planNotesLot(lot, state);

    const entries = [];
    for (const item of plan) {
        const avant = state.get(item.pnjId).notes.length;
        let { action, reason } = item;
        if (applying && (action === 'write' || action === 'append')) {
            // Relit dans la transaction : abandonne si les notes ont changé depuis la lecture du plan.
            const ref = db.doc(`pnjs_prives/${item.pnjId}`);
            const written = await db.runTransaction(async tx => {
                const snap = await tx.get(ref);
                if ((snap.exists ? String(snap.data().notes ?? '') : '') !== state.get(item.pnjId).notes) return false;
                tx.set(ref, { notes: item.notes, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
                return true;
            });
            if (!written) { action = 'conflict'; reason = 'Les notes ont changé depuis la lecture : entrée abandonnée.'; }
        }
        entries.push({ pnjId: item.pnjId, nom: item.nom, action, reason, longueurAvant: avant, longueurApres: action === 'write' || action === 'append' ? item.notes.length : avant });
    }

    const resume = {};
    for (const { action } of entries) resume[action] = (resume[action] || 0) + 1;
    const report = { project, mode: applying ? 'apply' : 'dry-run', resume, entries };
    console.log(`Projet ${project} — ${applying ? 'écriture' : 'à blanc (rien n\'est écrit)'}`);
    for (const [action, count] of Object.entries(resume)) console.log(`  ${action} : ${count}`);
    for (const e of entries) console.log(`${e.pnjId} | ${e.nom} | ${e.action} | ${e.reason} | notes ${e.longueurAvant} -> ${e.longueurApres}`);
    if (values['--report']) {
        await writeFile(values['--report'], JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.log(`Rapport : ${values['--report']}`);
    }
    if (entries.some(e => A_SIGNALER.has(e.action))) process.exitCode = 2;
} finally {
    if (client) await client.app.delete();
}

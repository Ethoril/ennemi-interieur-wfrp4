// Logique pure de tools/pnj-notes-lot.mjs : validation du lot et plan d'écriture des notes privées MJ (sans Firebase).
// Les règles Firestore ne s'appliquent pas à firebase-admin : les limites de `pnjs_prives` sont reproduites ici.
export const MAX_NOTES = 30000;
export const MAX_ENTRIES = 200;
const PNJ_ID = /^[A-Za-z0-9_-]{1,150}$/u;

export function validateLot(lot) {
    if (!lot || typeof lot !== 'object' || Array.isArray(lot)) throw new Error('lot invalide : un objet JSON est attendu');
    if (lot.version !== 1) throw new Error('lot invalide : "version" doit valoir 1');
    if (!Array.isArray(lot.entries)) throw new Error('lot invalide : "entries" doit être un tableau');
    if (lot.entries.length < 1 || lot.entries.length > MAX_ENTRIES) {
        throw new Error(`lot invalide : "entries" doit contenir entre 1 et ${MAX_ENTRIES} éléments (${lot.entries.length} reçus)`);
    }
    const vus = new Set();
    lot.entries.forEach((entry, index) => {
        const where = `entrée ${index + 1}`;
        if (!entry || typeof entry !== 'object') throw new Error(`lot invalide : ${where} n'est pas un objet`);
        if (typeof entry.pnjId !== 'string' || !PNJ_ID.test(entry.pnjId)) {
            throw new Error(`lot invalide : ${where} a un "pnjId" absent ou mal formé (A-Z, a-z, 0-9, _ et -, 150 caractères au plus)`);
        }
        if (typeof entry.nom !== 'string' || !entry.nom.trim()) throw new Error(`lot invalide : ${where} (${entry.pnjId}) a un "nom" vide`);
        if (typeof entry.notes !== 'string' || !entry.notes.trim()) throw new Error(`lot invalide : ${where} (${entry.pnjId}) a des "notes" vides`);
        if (entry.notes.length > MAX_NOTES) {
            throw new Error(`lot invalide : ${where} (${entry.pnjId}) a des "notes" de ${entry.notes.length} caractères (maximum ${MAX_NOTES})`);
        }
        if (vus.has(entry.pnjId)) throw new Error(`lot invalide : le pnjId ${entry.pnjId} est en double (${where})`);
        vus.add(entry.pnjId);
    });
    return lot;
}

const normaliserNom = nom => String(nom ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const dernierMot = nom => normaliserNom(nom).split(/\s+/u).pop() ?? '';
const fins = texte => texte.replace(/\r\n/gu, '\n');

// Garde contre un identifiant périmé : le dernier mot d'un nom doit figurer dans l'autre.
function nomsCompatibles(nomLot, nomFiche) {
    const lot = normaliserNom(nomLot), fiche = normaliserNom(nomFiche);
    const motLot = dernierMot(nomLot), motFiche = dernierMot(nomFiche);
    return (motLot !== '' && fiche.includes(motLot)) || (motFiche !== '' && lot.includes(motFiche));
}

function planEntree(entry, current) {
    const base = { pnjId: entry.pnjId, nom: entry.nom };
    if (!current?.exists) return { ...base, action: 'skip-missing', reason: 'La fiche publique n\'existe pas.' };
    if (!nomsCompatibles(entry.nom, current.nom)) {
        return { ...base, action: 'skip-name-mismatch', reason: 'Le nom de la fiche ne correspond pas à celui du lot (identifiant périmé ?).' };
    }
    const existantes = current.notes ?? '';
    let action, reason, notes;
    if (!existantes.trim()) {
        action = 'write'; reason = 'Notes vides : le texte du lot est écrit.'; notes = entry.notes;
    } else {
        const premiere = fins(entry.notes).split('\n').map(ligne => ligne.trim()).find(Boolean) ?? '';
        if (fins(existantes).includes(premiere)) {
            return { ...base, action: 'skip-present', reason: 'La première ligne du lot figure déjà dans les notes.' };
        }
        action = 'append'; reason = 'Notes existantes conservées : le texte du lot est ajouté à la suite.';
        notes = `${existantes.trimEnd()}\n\n${entry.notes}`;
    }
    if (notes.length > MAX_NOTES) {
        return { ...base, action: 'skip-too-long', reason: `Le résultat dépasserait ${MAX_NOTES} caractères.` };
    }
    return { ...base, action, reason, notes };
}

// state : Map<pnjId, { exists, nom, notes }> lu en base ; renvoie une action par entrée, dans l'ordre du lot.
export function planNotesLot(lot, state) {
    return lot.entries.map(entry => planEntree(entry, state.get(entry.pnjId)));
}

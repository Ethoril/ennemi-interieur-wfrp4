// Données V5 de la fiche : Fortune (ex-Chance), Péché, Corruption, familiers et mots-clés.
// Module pur, partagé avec la fonction (tools/sync-fiche-domain.mjs). Les identifiants de familier
// reprennent ceux de l'outil MJ (js/core/familiars.js), les cibles de mots-clés son référentiel de base.
import { BASE_KEYWORDS } from '../data/creature-keywords.js';

export const FAMILIER_SYSTEMES = Object.freeze({ homunculus: 'Homoncule', animal: 'Familier animal' });
export const FAMILIER_TYPES = Object.freeze({ combat: 'Familier de combat', power: 'Familier de puissance', spell: 'Familier de sort' });
export const FAMILIER_VENTS = Object.freeze({
    aqshy: 'Aqshy', azyr: 'Azyr', chamon: 'Chamon', ghur: 'Ghur', ghyran: 'Ghyran', hysh: 'Hysh', shyish: 'Shyish', ulgu: 'Ulgu',
});
export const FAMILIER_ESPECES = Object.freeze({
    fox: 'Renard', owl: 'Hibou', stoat: 'Hermine', badger: 'Blaireau', cat: 'Chat', raven: 'Corbeau', generic: 'Compagnon générique',
});
export const MOT_CLE_TYPES = Object.freeze({ haine: 'Haine', animosite: 'Animosité', prejuge: 'Préjugé', 'sans-peur': 'Sans peur' });
export const MOT_CLE_CIBLES = Object.freeze(Object.fromEntries(BASE_KEYWORDS.map(term => [term.id, term.nameFr])));

// Compteurs saisis en chaîne de chiffres, comme `destin` ; une chaîne vide vaut 0.
export const V5_COUNTER_FIELDS = Object.freeze(['fortune', 'peche', 'corruption']);
export const V5_LIST_FIELDS = Object.freeze(['familiers', 'motsCles']);
const MAX_FAMILIERS = 20;
const MAX_MOTS_CLES = 50;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasKey = (table, key) => typeof key === 'string' && Object.hasOwn(table, key);

/** Message d'erreur, ou null si la valeur est un compteur valide (« », « 0 » à « 9999 »). */
export function counterError(value) {
    return typeof value === 'string' && /^\d{0,4}$/u.test(value) ? null : 'entier positif ou nul attendu';
}

/** Message d'erreur, ou null si la liste de familiers est valide. */
export function familiersError(value) {
    if (!Array.isArray(value) || value.length > MAX_FAMILIERS) return 'liste de familiers invalide';
    const ids = new Set();
    for (const row of value) {
        if (!isRecord(row) || Object.keys(row).some(key => !['id', 'systeme', 'type', 'vent', 'espece', 'nom', 'destinSacrifie'].includes(key))) {
            return 'familier invalide';
        }
        if (typeof row.id !== 'string' || !ID_PATTERN.test(row.id) || ids.has(row.id)) return 'identifiant de familier invalide';
        ids.add(row.id);
        if (typeof row.nom !== 'string' || row.nom.length > 200) return 'nom de familier invalide';
        if (!Number.isSafeInteger(row.destinSacrifie) || row.destinSacrifie < 1 || row.destinSacrifie > 100) {
            return 'Destin sacrifié invalide : 1 au minimum';
        }
        if (row.systeme === 'homunculus') {
            if (!hasKey(FAMILIER_TYPES, row.type)) return 'type d’homoncule invalide';
            if (!hasKey(FAMILIER_VENTS, row.vent)) return 'Vent d’homoncule invalide';
            if (row.espece !== null) return 'un homoncule n’a pas d’espèce';
        } else if (row.systeme === 'animal') {
            if (row.type !== 'power') return 'un familier animal est toujours de puissance';
            if (!hasKey(FAMILIER_ESPECES, row.espece)) return 'espèce de familier invalide';
            if (row.vent !== null) return 'un familier animal n’a pas de Vent';
        } else return 'système de familier invalide';
    }
    return null;
}

/** Message d'erreur, ou null si la liste de mots-clés est valide. */
export function motsClesError(value) {
    if (!Array.isArray(value) || value.length > MAX_MOTS_CLES) return 'liste de mots-clés invalide';
    const seen = new Set();
    for (const row of value) {
        if (!isRecord(row) || Object.keys(row).length !== 2 || !hasKey(MOT_CLE_TYPES, row.id) || !hasKey(MOT_CLE_CIBLES, row.cible)) {
            return 'mot-clé invalide';
        }
        const key = `${row.id}:${row.cible}`;
        if (seen.has(key)) return 'mot-clé en double';
        seen.add(key);
    }
    return null;
}

/** Erreur de validation d'un champ V5 modifiable, null si valide ou si le champ n'est pas un champ V5. */
export function v5FieldError(path, value) {
    if (V5_COUNTER_FIELDS.includes(path)) return counterError(value);
    if (path === 'familiers') return familiersError(value);
    if (path === 'motsCles') return motsClesError(value);
    return null;
}

/** « Familier : Brindille (Homoncule, Familier de sort, Ulgu) » ; chaîne vide sans familier. */
export function familiersResume(data) {
    const rows = Array.isArray(data?.familiers) ? data.familiers : [];
    if (!rows.length) return '';
    const label = row => [FAMILIER_SYSTEMES[row?.systeme], FAMILIER_TYPES[row?.type],
        FAMILIER_VENTS[row?.vent] || FAMILIER_ESPECES[row?.espece]].filter(Boolean).join(', ');
    return `${rows.length > 1 ? 'Familiers' : 'Familier'} : ${rows.map(row => `${row?.nom || 'sans nom'} (${label(row)})`).join(' ; ')}`;
}

/** « Haine (Peaux-vertes), Sans peur (Chien) » ; chaîne vide sans mot-clé. */
export function motsClesResume(data) {
    const rows = Array.isArray(data?.motsCles) ? data.motsCles : [];
    return rows.map(row => `${MOT_CLE_TYPES[row?.id] || row?.id} (${MOT_CLE_CIBLES[row?.cible] || row?.cible})`).join(', ');
}

/**
 * Renomme Chance en Fortune sans perte : `fortune` reprend `chance` s'il manque. `chance`, `resilience`
 * et `determination` restent en place (lecture par les anciennes versions de l'outil). Pure et idempotente :
 * rend l'objet reçu quand il n'y a rien à faire.
 */
export function migrerFicheV5(data) {
    if (!isRecord(data) || Object.hasOwn(data, 'fortune') || !Object.hasOwn(data, 'chance')) return data;
    return { ...data, fortune: data.chance };
}

// Équivalences validées pour comparer les compétences des fiches et carrières.
const SKILL_NAME_ALIASES = {
    'chevaucher (cheval)': 'Chevaucher',
    'langage de bataille': 'Langue (Bataille)',
    'lecture sur les lèvres': 'Lire sur les lèvres',
    'signe secrets ranger': 'Signes secrets (Ranger)',
    'représentation (acteur)': 'Divertissement (Acteur)',
    'métier (calligraphe)': 'Art (Calligraphie)',
    'métier (cartographe)': 'Art (Cartographie)',
    'métier (graveur)': 'Art (Gravure)',
};

const SKILL_SPEC_ALIASES = {
    'savoir': {
        'art de la guerre': 'Guerre', 'prophéties': 'Prophétie', 'locale': 'Local',
        "l'empire": 'Empire', 'droit': 'Loi', 'démons': 'Démonologie',
        'plantes': 'Herbes', 'généalogie': 'Noble',
    },
    'corps à corps': { "arme d'hast": 'Armes d\'hast', 'fléaux': 'Fléau', 'lourde': 'Deux mains' },
    'projectiles': { 'lancer': 'Jet', 'armes de jet': 'Jet', 'armes à poudre': 'Poudre noire',
        'arbalète de poing': 'Arbalète' },
    'discrétion': { 'souterraine': 'Souterrains' },
    'dressage': { 'chiens': 'Chien', 'chevaux': 'Cheval', 'pigeons': 'Pigeon', 'blaireaux': 'Blaireau' },
    'signes secrets': { 'chasseurs': 'Chasseur', 'capes grises': 'Ordre Gris' },
    'langue': { 'elthàrin': 'Eltharin' },
    'focalisation': { 'qhaysh / haute magie': 'Qhaysh' },
    'divertissement': { 'narration': 'Contes', 'humour': 'Comédie', 'clownerie': 'Comédie',
        'rhétorique': 'Discours', 'conférence': 'Discours', 'provocation': 'Raillerie' },
    'métier': { 'imprimeur': 'Imprimerie', 'joaillier': 'Orfèvre', 'poisons': 'Empoisonneur',
        'matériel artistique': 'Artiste' },
};

export const OPEN_SPEC_PATTERN = /\((?:.*?\bchoix\b|n'importe quelle|celle du lanceur).*?\)$/i;
const GENERIC_SPEC_WORDS = new Set(['Région', 'Localité', 'Langue', 'Commerce', 'Peuple', 'Matériau', 'Arme', 'Ennemi', 'Organisation', 'Divinité', 'Vent']);

export function isOpenCareerSlot(s) {
    if (OPEN_SPEC_PATTERN.test(s)) return true;
    const m = s.match(/\(([^)]+)\)$/);
    return m ? GENERIC_SPEC_WORDS.has(m[1].trim()) : false;
}

export function canonicalSkillNom(s) {
    let n = s.trim().replace(/\s+/g, ' ');
    const conn = n.match(/^(?:conn\.|connaissances?\b)\s*\(?\s*(.+?)\s*\)?$/i);
    if (conn) n = `Savoir (${conn[1].charAt(0).toUpperCase()}${conn[1].slice(1)})`;
    const whole = SKILL_NAME_ALIASES[n.toLowerCase()];
    if (whole) return whole;
    const m = n.match(/^(.+?) \((.+)\)$/);
    const spec = m && SKILL_SPEC_ALIASES[m[1].toLowerCase()]?.[m[2].toLowerCase()];
    return spec ? `${m[1]} (${spec})` : n;
}

export const sameSkill = (a, b) => canonicalSkillNom(a).toLowerCase() === canonicalSkillNom(b).toLowerCase();

export function expandChoiceSkill(s, canonicalize = canonicalSkillNom) {
    const orMatch = s.match(/\(([^)]+)\)$/);
    if (orMatch) {
        if (isOpenCareerSlot(s)) return [s];
        const content = orMatch[1].trim();
        if (content.startsWith('ou ')) {
            const base = s.split('(')[0].trim();
            const alt = content.substring(3).trim();
            return [base, alt].map(canonicalize);
        }
        const parts = content.split(/,?\s+ou\s+|\s*,\s*/);
        if (parts.length > 1) {
            const base = s.split('(')[0].trim();
            return parts.map(p => canonicalize(`${base} (${p.trim()})`));
        }
    }
    return [canonicalize(s)];
}

export function skillBaseNom(fullNom) {
    return fullNom.split('(')[0].trim().toLowerCase();
}

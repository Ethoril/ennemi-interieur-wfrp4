// Gabarit de rubriques pour les notes privées MJ d'un PNJ. Module pur : le
// texte saisi n'est jamais modifié, le gabarit est seulement ajouté à la fin.
export const NOTES_TEMPLATE_LABELS = ['JOUER', 'VEUT', 'SAIT', 'CROIT', 'TENU PAR', 'BASCULE', 'OUVRE', 'VOIX', 'BONUS', 'ABORDER'];

// Colonne à laquelle commence la valeur de chaque rubrique.
const LABEL_WIDTH = 11;

const TEMPLATE = NOTES_TEMPLATE_LABELS.map(label => label.padEnd(LABEL_WIDTH, ' ')).join('\n');

// Détecte la première rubrique en début de ligne, pas dans un mot (JOUERA).
const FIRST_LABEL_LINE = new RegExp(`^${NOTES_TEMPLATE_LABELS[0]}(?: |$)`, 'm');

// `text` est toujours la version complétée, même si le gabarit figure déjà :
// c'est l'appelant qui décide de l'appliquer ou non.
export function insertNotesTemplate(current) {
    const existing = typeof current === 'string' ? current : '';
    const alreadyPresent = FIRST_LABEL_LINE.test(existing);
    const base = existing.trimEnd();
    return { text: base ? `${base}\n\n${TEMPLATE}` : TEMPLATE, alreadyPresent };
}

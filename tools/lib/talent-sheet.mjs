import { parseCSV } from '../../js/utils.js';
import { parseTalentSourceRows } from '../../js/catalogue/talent-source.js';

export function parseTalentSheet(csv) {
    const [headers, ...rows] = parseCSV(csv.replace(/^\uFEFF/u, ''));
    return parseTalentSourceRows(headers, rows);
}

export const esc = s =>
    String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

export const stripAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// Parser CSV simple — gère les champs entre guillemets ("..."), les guillemets
// échappés (""), les retours \r\n et \n, et trim les espaces.
// Source unique partagée entre sheets.js (Google Sheets) et fiche.js (modale talents).
export function parseCSV(csv) {
    const rows = [];
    let cur = '', inQ = false, row = [];
    for (let i = 0; i <= csv.length; i++) {
        const c = csv[i], n = csv[i + 1];
        if (i === csv.length || (!inQ && (c === '\n' || (c === '\r' && n === '\n')))) {
            row.push(cur.trim());
            if (row.some(f => f !== '')) rows.push(row);
            row = []; cur = '';
            if (c === '\r') i++;
        } else if (inQ) {
            if (c === '"' && n === '"') { cur += '"'; i++; }
            else if (c === '"') inQ = false;
            else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ',') { row.push(cur.trim()); cur = ''; }
            else cur += c;
        }
    }
    return rows;
}

// Exposition globale pour les scripts classiques (fiche.js) qui ne peuvent
// pas importer un module. Évalué quand le module est chargé en deferred ;
// disponible avant le DOMContentLoaded, donc avant tout handler utilisateur.
if (typeof window !== 'undefined') {
    Object.assign(window, { esc, cap, stripAccents, parseCSV });
}

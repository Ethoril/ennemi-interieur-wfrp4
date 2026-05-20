// Régénère js/data/careers.js depuis le Google Sheet "Carrières".
// Usage : node tools/import-careers.mjs
//
// Le script :
// 1. Fetche le CSV depuis le sheet
// 2. Normalise les apostrophes typographiques (’ → ')
// 3. Groupe par carrière, regroupe les variantes (multi-lignes même rang)
// 4. Détecte les prérequis (depuis la 1ère ligne d'une sous-carrière)
// 5. Écrit le résultat dans js/data/careers.js

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SHEET_ID = '1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs';
const SHEET_NAME = 'Carri%C3%A8res'; // "Carrières" URL-encodé
const URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${SHEET_NAME}`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '..', 'js', 'data', 'careers.json');

const CARAC_MAP = {
    'CC': 'cc', 'CT': 'ct', 'F': 'f', 'E': 'e', 'I': 'i',
    'Ag': 'ag', 'Dex': 'dex', 'Int': 'int', 'FM': 'fm', 'Soc': 'soc',
};

// ── Parser CSV ────────────────────────────────────────
function parseCSV(csv) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    let row = [];
    for (let i = 0; i < csv.length; i++) {
        const ch = csv[i];
        const next = csv[i + 1];
        if (inQuotes) {
            if (ch === '"' && next === '"') { current += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { row.push(current); current = ''; }
            else if (ch === '\n' || (ch === '\r' && next === '\n')) {
                row.push(current);
                if (row.some(c => c !== '')) rows.push(row);
                row = []; current = '';
                if (ch === '\r') i++;
            } else current += ch;
        }
    }
    row.push(current);
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
}

// ── Normalisation des chaînes ─────────────────────────
function normalize(s) {
    if (!s) return '';
    return s
        .replace(/’/g, "'")  // apostrophe typographique → ASCII
        .replace(/–|—/g, '-') // tirets en–dash, em–dash → ASCII
        .trim();
}

// Sépare une liste "A, B (spec), C" en items (ne coupe pas dans les parenthèses).
function splitList(s) {
    if (!s) return [];
    const out = [];
    let buf = '';
    let depth = 0;
    for (const ch of s) {
        if (ch === '(') { depth++; buf += ch; }
        else if (ch === ')') { depth--; buf += ch; }
        else if (ch === ',' && depth === 0) { if (buf.trim()) out.push(buf.trim()); buf = ''; }
        else buf += ch;
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
}

// Génère un id en kebab-case depuis le nom de la carrière.
function slugify(s) {
    return s
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents (diacritiques combinants)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ── Mapping ligne CSV → objet ────────────────────────
function parseCarac(s) {
    return splitList(s)
        .map(c => CARAC_MAP[c.trim()] || null)
        .filter(Boolean);
}

// ── Validation structurelle ────────────────────────────
// Bloque l'écriture si les données sont incohérentes — évite de corrompre
// la base au moindre changement de format dans le Google Sheet.
function validate(careers) {
    const errors = [];
    const idsSeen = new Set();
    const nomsSeen = new Set(careers.map(c => c.nom));

    for (const c of careers) {
        if (idsSeen.has(c.id)) errors.push(`id dupliqué : ${c.id} (${c.nom})`);
        idsSeen.add(c.id);

        if (!c.rangs.length) {
            errors.push(`${c.nom} : aucun rang`);
            continue;
        }

        // Les rangs uniques doivent former une séquence contiguë (sans trou).
        // Le départ n'est pas forcément 1 : certaines carrières HE commencent au rang 3.
        const uniqRangs = [...new Set(c.rangs.map(r => r.rang))].sort((a, b) => a - b);
        for (let i = 1; i < uniqRangs.length; i++) {
            if (uniqRangs[i] !== uniqRangs[i - 1] + 1) {
                errors.push(`${c.nom} : trou dans les rangs, trouvés [${uniqRangs.join(', ')}]`);
                break;
            }
        }

        for (const r of c.rangs) {
            if (!r.titre) errors.push(`${c.nom} rang ${r.rang} : titre vide`);
            if (!r.caracs.length) errors.push(`${c.nom} rang ${r.rang} (${r.titre}) : aucune carac`);
        }

        if (c.prereq && !nomsSeen.has(c.prereq.career)) {
            errors.push(`${c.nom} : prereq pointe vers "${c.prereq.career}" qui n'existe pas`);
        }
    }

    if (errors.length) {
        throw new Error(`Validation échouée (${errors.length} erreur(s)) :\n  - ${errors.join('\n  - ')}`);
    }
}

// ── Main ───────────────────────────────────────────────
async function main() {
    console.log(`Téléchargement depuis ${URL}…`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const csv = await res.text();
    const rows = parseCSV(csv);

    if (rows.length < 2) throw new Error('CSV vide.');

    const headers = rows[0].map(h => normalize(h));
    const idx = {
        nom:    headers.indexOf('Nom de la carrière'),
        source: headers.indexOf('Source'),
        rang:   headers.indexOf('Niveau De Carrière'),
        titre:  headers.indexOf('Nom du rang'),
        carac:  headers.indexOf('Caractéristiques accessibles'),
        skills: headers.indexOf('Compétences accessibles'),
        talents: headers.indexOf('Talents accessibles'),
        statut: headers.indexOf('Statut'),
        prereqCar: headers.indexOf('Prérequis Carrière'),
        prereqRang: headers.indexOf('Prérequis rang min'),
    };
    for (const [k, v] of Object.entries(idx)) {
        if (v < 0) throw new Error(`Colonne manquante: ${k} (headers reçus : ${JSON.stringify(headers)})`);
    }

    const careersByNom = new Map();
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const nom = normalize(row[idx.nom]);
        if (!nom) continue;

        const rang = parseInt(row[idx.rang], 10);
        if (!rang) continue;

        const entry = {
            rang,
            titre: normalize(row[idx.titre]),
            statut: normalize(row[idx.statut]),
            caracs: parseCarac(row[idx.carac]),
            skills: splitList(normalize(row[idx.skills])),
            talents: splitList(normalize(row[idx.talents])),
        };

        let career = careersByNom.get(nom);
        if (!career) {
            career = {
                id: slugify(nom),
                nom,
                source: normalize(row[idx.source]),
                rangs: [],
                carac: [],
            };
            // Prérequis renseigné seulement sur la 1ère ligne d'une sous-carrière.
            const pCar = normalize(row[idx.prereqCar]);
            const pRang = normalize(row[idx.prereqRang]);
            if (pCar && pRang) {
                career.prereq = { career: pCar, minRang: parseInt(pRang, 10) };
            }
            careersByNom.set(nom, career);
        }
        career.rangs.push(entry);
    }

    // Cumul des caracs au niveau carrière (union de toutes les caracs des rangs).
    // Tri des rangs par numéro puis stabilité d'insertion (les variantes restent dans l'ordre d'apparition).
    const careers = [...careersByNom.values()];
    for (const c of careers) {
        c.rangs.sort((a, b) => a.rang - b.rang);
        const caracSet = new Set();
        for (const r of c.rangs) for (const k of r.caracs) caracSet.add(k);
        c.carac = [...caracSet];
    }

    // Tri alphabétique sur le nom pour avoir un fichier reproductible.
    careers.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

    validate(careers);

    // ── Génération du fichier ────────────────────────────
    // JSON pur, fetché paresseusement par fiche.js (cf. lazy-load careers).
    const out = JSON.stringify(careers, null, 2) + '\n';
    await writeFile(OUT_PATH, out, 'utf8');
    console.log(`✓ ${careers.length} carrières écrites dans ${OUT_PATH}`);
    // Stats rapides
    let totalRangs = 0;
    let variants = 0;
    let withPrereq = 0;
    for (const c of careers) {
        totalRangs += c.rangs.length;
        if (c.prereq) withPrereq++;
        const seen = new Set();
        for (const r of c.rangs) {
            if (seen.has(r.rang)) variants++;
            seen.add(r.rang);
        }
    }
    console.log(`  ${totalRangs} entrées de rang, ${variants} variantes, ${withPrereq} sous-carrières avec prérequis.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { parseCSV } from '../js/utils.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = process.argv.find(argument => argument.startsWith('--source-dir='))?.slice(13);
const sheetRoot = 'https://docs.google.com/spreadsheets/d/1SCnAJCthdto7ROjovuyDYmz4y9GJBBLfThuYNmYR_Cs/gviz/tq?tqx=out:csv&headers=1&sheet=';
const fold = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase().trim();
const slug = value => fold(value).replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
const sources = {};
async function sheet(name) {
    const url = sheetRoot + encodeURIComponent(name);
    const csv = sourceDirectory ? await readFile(resolve(sourceDirectory, `${name}.csv`), 'utf8') : await fetch(url).then(response => {
        if (!response.ok) throw new Error(`Source ${name} indisponible : ${response.status}`);
        return response.text();
    });
    sources[name] = { url, sha256: createHash('sha256').update(csv).digest('hex') };
    const [headers, ...rows] = parseCSV(csv.replace(/^\uFEFF/u, ''));
    return rows.filter(row => row[1]?.trim()).map(row => Object.fromEntries(headers.filter(Boolean).map((key, index) => [key, row[index]?.trim() || ''])));
}
const keywordRows = await sheet('Mots Clés Armes et Armures');
const keywords = keywordRows.map(row => ({ id: row.Identifiant, name: row.Nom, effect: row.Effet, type: row.Type,
    parameter: row['Paramètre'], source: row.Source, edition: row['Version retenue'],
    aliases: [row['Nom EN'], ...row['Anciens noms'].split(',').map(value => value.trim())].filter(Boolean), note: row.Remarque }));
function parseKeywords(text) {
    const result = [];
    text = String(text || '').normalize('NFC');
    const parts = [];
    let start = 0, depth = 0;
    for (let i = 0; i < text.length; i += 1) {
        if (text[i] === '(') depth += 1;
        else if (text[i] === ')') depth = Math.max(0, depth - 1);
        else if (!depth && /[,;]/u.test(text[i])) { parts.push(text.slice(start, i)); start = i + 1; }
        else if (!depth && /^\s+ou\s+/iu.test(text.slice(i))) {
            const separator = text.slice(i).match(/^\s+ou\s+/iu)[0];
            parts.push(text.slice(start, i)); i += separator.length - 1; start = i + 1;
        }
    }
    parts.push(text.slice(start));
    for (const entry of keywords) {
        const names = [entry.name, ...entry.aliases].map(name => fold(name).replace(/\s+(?:x|\d+)$/u, '')).filter(Boolean);
        for (const name of names) {
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
            const pattern = new RegExp(`^\\s*(?:ou\\s+)?${escaped}(?=$|[\\s.(])\\s*([+-]?\\d+|\\([^)]*\\))?`, 'u');
            const matches = parts.map(value => value.trim()).map(part => ({ part, match: fold(part).match(pattern) })).filter(value => value.match);
            if (matches.length) {
                const parameters = matches.map(({ part, match }) => {
                    if (!entry.parameter || !match[1]) return '';
                    const start = match.index + match[0].lastIndexOf(match[1]);
                    return part.slice(start, start + match[1].length).replace(/^\(|\)$/gu, '');
                }).filter(Boolean);
                result.push({ id: entry.id, parameter: [...new Set(parameters)].join(' ; ') }); break;
            }
        }
    }
    return result;
}
const rangeCorrections = {
    'Lasso': ['BF × 2', 'Livre de base V5 EN, p. 303'],
    'Lasso (2M)': ['BF × 2', 'Livre de base V5 EN, p. 303'],
    'Filet': ['BF', 'Livre de base V5 EN, p. 303'],
    'Bombe': ['BF', 'Livre de base V5 EN, p. 303'],
    'Bombe incendiaire': ['BF', 'Livre de base V5 EN, p. 303'],
    'Bolas': ['BF × 3', 'Livre de base V5 EN, p. 303'],
    'Couteau de lancer': ['BF × 2', 'Livre de base V5 EN, p. 303'],
    'Fléchette': ['BF × 2', 'Livre de base FR (V4), p. 295 (conservé en V5)'],
    'Hache de lancer': ['BF × 2', 'Livre de base V5 EN, p. 303'],
    'Javelot': ['BF × 3', 'Livre de base V5 EN, p. 303'],
    'Rocher': ['BF × 3', 'Livre de base V5 EN, p. 303'],
    'Javelot Blackbriar elfe sylvain': ['BF × 3', 'Archives of the Empire Volume I, p. 93'],
    'Bombe Cinderblast': ['BF', 'Dwarf Player’s Guide, p. 92'],
    'Fléchettes (lot de 12) Homme Lézard': ['Comme la sarbacane', 'Lustria, tableau Lizardman Ammunition'],
};
const locations = text => {
    const result = [];
    const value = fold(text);
    if (value.includes('toutes')) return ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
    if (value.includes('tete')) result.push('head');
    if (value.includes('corps')) result.push('body');
    if (value.includes('bras') || value.includes('mains')) result.push('rightArm', 'leftArm');
    if (value.includes('jamb')) result.push('rightLeg', 'leftLeg');
    return result;
};
const items = [];
const identities = new Map();
for (const [name, defaultKind] of [['Armes Corps à Corps', 'weapon'], ['Armes à Distance', 'weapon'], ['Armures', 'armour']]) {
    for (const row of await sheet(name)) {
        const category = row['Catégorie'];
        const words = parseKeywords(row['Atouts et Défauts'] || row['Atouts et Défauts (et Pénalités)']);
        let kind = defaultKind;
        if (fold(category).includes('bouclier')) kind = 'shield';
        if (/fléchettes \(lot|flèche |flèches |carreau|munition|balle.*poudre/iu.test(row.Nom)) kind = 'ammunition';
        let damage = (row['Dégâts'] || '').replace(/^=\s*/u, '').replace(/^\+\s*(?=BF)/iu, '').trim();
        let reach = row.Allonge || '';
        let range = row['Portée'] || '';
        let source = `Aides de jeu : ${name} / ${category} / ${row.Nom}`;
        if (!range && name === 'Armes à Distance' && rangeCorrections[row.Nom]) { // corrections de portée : armes à distance seulement (le Filet de mêlée n'a pas de portée)
            [range] = rangeCorrections[row.Nom]; source += ` ; portée : ${rangeCorrections[row.Nom][1]}`; }
        let ap = defaultKind === 'armour' ? Number((row["Valeur d'Armure (PA)"] || '').match(/\d+/u)?.[0] ?? NaN) : NaN;
        if (kind === 'shield') {
            if (!Number.isFinite(ap)) ap = Number(words.find(word => word.id === 'protectrice')?.parameter || reach.match(/\d+/u)?.[0] || NaN);
            const rawNotes = row['Atouts et Défauts'] || row['Atouts et Défauts (et Pénalités)'] || '';
            // Un bouclier V5 non posé compte en attaque comme une Arme improvisée d'allonge Personnelle (L06 p.306).
            if (!/BF/iu.test(damage)) {
                const isPlantedPavise = /posé au sol/iu.test(rawNotes);
                const hasShieldQuality = words.some(word => ['bouclier', 'protectrice'].includes(word.id)) && !isPlantedPavise;
                damage = hasShieldQuality ? 'BF + 1' : ''; reach = hasShieldQuality ? 'Personnelle' : '';
                if (hasShieldQuality) source += ' ; usage offensif : Arme improvisée (Livre de base V5 EN p.306)';
            }
        }
        const identity = `${kind}-${slug(name)}-${slug(category)}-${slug(row.Nom)}`;
        const occurrence = identities.get(identity) || 0;
        identities.set(identity, occurrence + 1);
        const id = identity + (occurrence ? `-${occurrence + 1}` : '');
        const layer = kind !== 'armour' ? 'none' : /^cuir souple/iu.test(category) ? 'leather'
            : /^\s*=*\s*\+/u.test(row["Valeur d'Armure (PA)"]) ? 'bonus' : words.some(word => word.id === 'flexible') ? 'flexible' : 'rigid';
        const notes = row['Atouts et Défauts'] || row['Atouts et Défauts (et Pénalités)'] || '';
        items.push({ id, baseId: id, catalogVersion: '', kind, name: row.Nom, category, damage, reach, range,
            ap: Number.isFinite(ap) ? ap : null, locations: locations(row['Zones Couvertes'] || ''), layer, keywords: words,
            notes: kind === 'shield' && words.some(word => word.id === 'bouclier') ? `${notes} ; en attaque : arme improvisée (Inoffensive, Déséquilibrée).` : notes, source, custom: false });
    }
}
// Munitions standard absentes des aides de jeu (Livre de base V5 EN p.302).
const ammunitionSource = 'Livre de base V5 EN p.302, tableau Munitions (complément absent des aides de jeu)';
const standardAmmunition = [
    ['Flèches (12)', 'Arc', '+0', 'Comme l’arc', ['empaleuse'], 'Empaleuse'],
    ['Flèches elfiques (12)', 'Arc', '+0', 'Comme l’arc + 10', ['empaleuse'], 'Empaleuse'],
    ['Carreaux (12)', 'Arbalète', '+0', 'Comme l’arbalète', ['empaleuse'], 'Empaleuse'],
    ['Balles de plomb (12)', 'Fronde', '+1', 'Comme la fronde − 10', ['assommante'], 'Assommante'],
    ['Pierres (12)', 'Fronde', '+0', 'Comme la fronde', ['assommante'], 'Assommante'],
    ['Balles et poudre (12)', 'Poudre Noire', '+0', 'Comme l’arme', ['empaleuse', 'perforante'], 'Empaleuse, Perforante'],
    ['Grenaille et poudre (12)', 'Poudre Noire', '+0', 'Comme l’arme', [{ id: 'explosion', parameter: '+1' }], 'Explosion +1'],
    ['Munitions improvisées et poudre', 'Poudre Noire', '-1', 'Moitié de la portée de l’arme', [], ''],
];
for (const [name, category, damage, range, words, notes] of standardAmmunition) {
    const id = `ammunition-livre-de-base-${slug(category)}-${slug(name)}`;
    items.push({ id, baseId: id, catalogVersion: '', kind: 'ammunition', name, category, damage, reach: '', range, ap: null, locations: [], layer: 'none',
        keywords: words.map(word => typeof word === 'string' ? { id: word, parameter: '' } : word), notes, source: ammunitionSource, custom: false });
}
if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Identifiants d’équipement en doublon');
const catalogVersion = `equipment:${createHash('sha256').update(JSON.stringify({ items, keywords })).digest('hex')}`;
for (const item of items) item.catalogVersion = catalogVersion;
const prior = JSON.parse(await readFile(resolve(root, 'js/data/equipment-catalog.json'), 'utf8'));
const keywordHistory = { ...(prior.keywordHistory || {}) };
if (prior.catalogVersion !== catalogVersion) keywordHistory[prior.catalogVersion] = prior.keywords;
const aliases = {
    'shield-armes-corps-a-corps-bouclier-bouclier-haut-elfe': 'shield-armures-bouclier-bouclier-haut-elfe',
    'shield-armes-corps-a-corps-bouclier-bouclier-standard': 'shield-armures-bouclier-bouclier',
    'shield-armes-corps-a-corps-bouclier-pavois': 'shield-armures-bouclier-pavois-pavise',
    'shield-armes-corps-a-corps-bouclier-bouclier': 'shield-armures-bouclier-bouclier',
    'shield-armes-corps-a-corps-bouclier-targe-buckler': 'shield-armures-bouclier-targe-buckler',
    'shield-armes-corps-a-corps-bouclier-grand-bouclier': 'shield-armures-bouclier-grand-bouclier',
    'shield-armes-corps-a-corps-bouclier-pavois-pavise': 'shield-armures-bouclier-pavois-pavise',
    'weapon-armes-corps-a-corps-fleau-fleau-a-grain': 'weapon-armes-corps-a-corps-fleau-fleau-a-grain-2m',
    'weapon-armes-corps-a-corps-parade-brise-epee': 'weapon-armes-corps-a-corps-escrime-brise-epee',
    'weapon-armes-corps-a-corps-parade-main-gauche': 'weapon-armes-corps-a-corps-escrime-main-gauche',
    'weapon-armes-corps-a-corps-parade-cape': 'weapon-armes-corps-a-corps-base-cape',
    'weapon-armes-corps-a-corps-parade-filet-druchii': 'weapon-armes-corps-a-corps-base-filet-druchii',
    'weapon-armes-a-distance-entraves-fouet': 'weapon-armes-corps-a-corps-fleau-fouet',
    'weapon-armes-a-distance-entraves-lasso': 'weapon-armes-a-distance-entraves-lasso-2m',
    'weapon-armes-a-distance-lancer-bolas': 'weapon-armes-a-distance-entraves-bolas',
    'weapon-armes-a-distance-poudre-noire-long-fusil-d-hochland-2m': 'weapon-armes-a-distance-ingenierie-long-fusil-d-hochland-2m',
};
if (Object.values(aliases).some(id => !items.some(item => item.id === id))) throw new Error('Cible de correspondance absente du catalogue');
const catalogue = { catalogVersion, fetchedAt: new Date().toISOString().slice(0, 10), sources, keywords, keywordHistory, aliases, items };
if (items.some(item => item.keywords.some(word => !keywords.some(entry => entry.id === word.id)))) throw new Error('Mot clé de munition absent du référentiel');
await writeFile(resolve(root, 'js/data/equipment-catalog.json'), `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(JSON.stringify({ items: items.length, keywords: keywords.length, corrections: Object.keys(rangeCorrections).length, ammunition: standardAmmunition.length,
    rangesToConfirm: items.filter(item => item.kind === 'weapon' && item.source.includes('Armes à Distance') && !item.range).map(item => item.name) }));

// Marques d'un PNJ partagées par le bureau (pnjs.js) et le mobile (js/mobile/) :
// le sceau de cire porte le statut par sa couleur ET son glyphe, la porte de Morr
// signale un défunt. Aucune couleur ici : les jetons --seal-* et --morr-* de
// css/base.css les fournissent, redéclarés au besoin par le thème parchemin.
//
// Deux sorties pour une seule géométrie : du balisage pour les rendus par chaîne
// (innerHTML du bureau, D3), des éléments SVG pour les vues mobiles, qui
// n'utilisent jamais innerHTML.

const SVG_NS = 'http://www.w3.org/2000/svg';

const STATUT_KEYS = Object.freeze({ 'allié': 'allie', allie: 'allie', ennemi: 'ennemi', neutre: 'neutre' });
const STATUT_LABELS = Object.freeze({ allie: 'Allié', ennemi: 'Ennemi', neutre: 'Neutre', inconnu: 'Inconnu' });
const VIVANT_LABELS = Object.freeze({ oui: 'Vivant', non: 'Décédé', inconnu: 'Inconnu' });

/** Clé stable d'un statut (allie, ennemi, neutre), « inconnu » pour une valeur vide ou libre. */
export function statutKey(statut) {
    const key = typeof statut === 'string' ? statut.trim().toLowerCase() : '';
    // Object.hasOwn : « constructor » ou « __proto__ » ne doivent pas remonter au prototype.
    return Object.hasOwn(STATUT_KEYS, key) ? STATUT_KEYS[key] : 'inconnu';
}

export function statutLabel(statut) {
    return STATUT_LABELS[statutKey(statut)];
}

/** Libellé lisible de l'état vital ; une valeur hors vocabulaire est rendue telle quelle. */
export function vivantLabel(vivant) {
    const value = typeof vivant === 'string' ? vivant.trim() : '';
    const key = value.toLowerCase();
    return Object.hasOwn(VIVANT_LABELS, key) ? VIVANT_LABELS[key] : value;
}

// Disque de cire légèrement irrégulier, calculé une fois : une spline passant par
// des rayons modulés donne des coulures stables d'un rendu à l'autre.
const WAX_PATH = (() => {
    const count = 28;
    const points = [];
    for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        const radius = 10.2 + 0.65 * Math.sin(angle * 5 + 0.6) + 0.4 * Math.sin(angle * 9 + 1.9) + (i % 7 === 3 ? 0.85 : 0);
        points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    const f = value => value.toFixed(2);
    let d = `M${f(points[0][0])} ${f(points[0][1])}`;
    for (let i = 0; i < count; i++) {
        const [x0, y0] = points[(i - 1 + count) % count];
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % count];
        const [x3, y3] = points[(i + 2) % count];
        d += ` C${f(x1 + (x2 - x0) / 6)} ${f(y1 + (y2 - y0) / 6)} ${f(x2 - (x3 - x1) / 6)} ${f(y2 - (y3 - y1) / 6)} ${f(x2)} ${f(y2)}`;
    }
    return `${d}Z`;
})();

const GLYPHS = Object.freeze({
    allie: 'M-3.4 0.2 L-1.1 2.6 L3.5 -2.7',
    ennemi: 'M-3 -3 L3 3 M3 -3 L-3 3',
    neutre: 'M-3.3 -1.5 L3.3 -1.5 M-3.3 1.5 L3.3 1.5',
    inconnu: 'M-2.1 -1.8 C-2.1 -4.1 2.2 -4.1 2.2 -1.6 C2.2 0 0 0.1 0 1.6',
});

// Porte de Morr : deux piliers, un linteau et son chapeau, un seuil.
const MORR_GATE = 'M-5.6 -4.4 L5.6 -4.4 M-4.2 -6.3 L4.2 -6.3 M-3.4 -4.4 L-3.4 5.4 M3.4 -4.4 L3.4 5.4 M-5.2 5.6 L5.2 5.6';

function sealParts(key) {
    const parts = [
        ['path', { d: WAX_PATH, class: 'seal-wax' }],
        ['ellipse', { cx: '-3.6', cy: '-4.4', rx: '4', ry: '2.4', transform: 'rotate(-30 -3.6 -4.4)', class: 'seal-gloss' }],
        ['circle', { r: '6.7', class: 'seal-press' }],
        ['circle', { r: '6.7', transform: 'translate(-0.5 -0.6)', class: 'seal-ring' }],
        ['path', { d: GLYPHS[key], transform: 'translate(0.45 0.5)', class: 'seal-relief-shadow' }],
        ['path', { d: GLYPHS[key], class: 'seal-relief' }],
    ];
    if (key === 'inconnu') parts.push(['circle', { cx: '0', cy: '3.7', r: '0.85', class: 'seal-dot' }]);
    return parts;
}

const MORR_PARTS = Object.freeze([
    ['circle', { r: '11', class: 'morr-disc' }],
    ['path', { d: MORR_GATE, class: 'morr-gate' }],
]);

// La taille entre telle quelle dans le balisage : seul un nombre fini et positif est admis.
function validSize(size, fallback) {
    return Number.isFinite(size) && size > 0 ? size : fallback;
}

// Position optionnelle : centrée sur (x, y) pour s'imbriquer dans le SVG du graphe.
// Le <title> seul nomme l'image : un aria-label identique fait lire le statut deux fois
// par Chromium (nom puis description).
function frameAttributes(className, size, x, y) {
    const attributes = { class: className, width: String(size), height: String(size), viewBox: '-12 -12 24 24', role: 'img' };
    if (Number.isFinite(x) && Number.isFinite(y)) {
        attributes.x = String(x - size / 2);
        attributes.y = String(y - size / 2);
    }
    return attributes;
}

// Les valeurs viennent toutes des constantes de ce module ou de nombres : rien à échapper.
function toMarkup(attributes, label, parts) {
    const attr = entries => Object.entries(entries).map(([name, value]) => ` ${name}="${value}"`).join('');
    return `<svg${attr(attributes)}><title>${label}</title>${parts.map(([tag, entries]) => `<${tag}${attr(entries)}/>`).join('')}</svg>`;
}

function toElement(documentRef, attributes, label, parts) {
    if (typeof documentRef?.createElementNS !== 'function') return null;
    const create = (tag, entries) => {
        const element = documentRef.createElementNS(SVG_NS, tag);
        for (const [name, value] of Object.entries(entries)) element.setAttribute(name, value);
        return element;
    };
    const svg = create('svg', attributes);
    const title = documentRef.createElementNS(SVG_NS, 'title');
    title.textContent = label;
    svg.append(title, ...parts.map(([tag, entries]) => create(tag, entries)));
    return svg;
}

/** Sceau de statut en balisage SVG : `size` en pixels, (x, y) centre facultatif dans un SVG parent. */
export function sealMarkup(statut, { size, x, y } = {}) {
    const key = statutKey(statut);
    const label = `Statut : ${STATUT_LABELS[key]}`;
    return toMarkup(frameAttributes(`seal seal--${key}`, validSize(size, 20), x, y), label, sealParts(key));
}

/** Sceau de statut en élément SVG ; null si le document ne sait pas créer de SVG. */
export function createSeal(documentRef, statut, { size } = {}) {
    const key = statutKey(statut);
    const label = `Statut : ${STATUT_LABELS[key]}`;
    return toElement(documentRef, frameAttributes(`seal seal--${key}`, validSize(size, 20)), label, sealParts(key));
}

export function morrMarkup({ size, x, y } = {}) {
    return toMarkup(frameAttributes('morr', validSize(size, 18), x, y), 'Décédé', MORR_PARTS);
}

export function createMorr(documentRef, { size } = {}) {
    return toElement(documentRef, frameAttributes('morr', validSize(size, 18)), 'Décédé', MORR_PARTS);
}

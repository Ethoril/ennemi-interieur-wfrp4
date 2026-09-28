import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statutKey, statutLabel, vivantLabel, sealMarkup, createSeal, morrMarkup, createMorr } from '../js/seal.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

// Faux document SVG minimal : il suffit à vérifier la structure produite par createSeal.
function svgDocument() {
    const make = (namespace, tagName) => ({
        namespace, tagName, attributes: new Map(), children: [], textContent: '',
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
        getAttribute(name) { return this.attributes.get(name) ?? null; },
        append(...nodes) { this.children.push(...nodes); },
    });
    return { createElementNS: make };
}

test('le statut se range en quatre clés stables avec un libellé lisible', () => {
    assert.equal(statutKey('allié'), 'allie');
    assert.equal(statutKey(' Ennemi '), 'ennemi');
    assert.equal(statutKey('neutre'), 'neutre');
    for (const value of ['', null, undefined, 'hostile', 42, 'constructor', '__proto__', 'toString']) assert.equal(statutKey(value), 'inconnu');
    assert.equal(statutLabel('constructor'), 'Inconnu');
    assert.equal(statutLabel('allié'), 'Allié');
    assert.equal(statutLabel(''), 'Inconnu');
});

test("l'état vital reprend les libellés du bureau et garde une valeur hors vocabulaire", () => {
    assert.equal(vivantLabel('oui'), 'Vivant');
    assert.equal(vivantLabel('non'), 'Décédé');
    assert.equal(vivantLabel('inconnu'), 'Inconnu');
    assert.equal(vivantLabel('Blessé'), 'Blessé');
    assert.equal(vivantLabel(undefined), '');
    // Une clé héritée d'Object.prototype reste une valeur libre, jamais une fonction.
    assert.equal(vivantLabel('constructor'), 'constructor');
    assert.equal(vivantLabel('__proto__'), '__proto__');
});

test('le sceau en balisage porte classe, taille, nom accessible et un glyphe propre au statut', () => {
    const allie = sealMarkup('allié', { size: 22 });
    const ennemi = sealMarkup('ennemi', { size: 22 });
    assert.match(allie, /^<svg class="seal seal--allie" width="22" height="22" viewBox="-12 -12 24 24" role="img">/u);
    assert.doesNotMatch(allie, /aria-label/u, "le <title> seul nomme le sceau");
    assert.match(allie, /<title>Statut : Allié<\/title>/u);
    assert.notEqual(allie.match(/class="seal-relief"[^>]*/u)?.[0], undefined);
    assert.notEqual(allie.replace(/allie|Allié/gu, ''), ennemi.replace(/ennemi|Ennemi/gu, ''), 'les glyphes doivent différer');
    assert.match(sealMarkup(''), /seal--inconnu[\s\S]*class="seal-dot"/u);
    assert.doesNotMatch(sealMarkup('neutre'), /seal-dot/u);
});

test('le sceau se centre sur (x, y) pour s’imbriquer dans le SVG du graphe', () => {
    assert.match(sealMarkup('neutre', { size: 20, x: 30, y: -10 }), /x="20" y="-20"/u);
    assert.doesNotMatch(sealMarkup('neutre', { size: 20 }), / x="/u);
});

test('une taille non finie ou non positive reprend la valeur par défaut', () => {
    for (const size of [NaN, Infinity, -4, 0, '30', '"><script>', null]) {
        assert.match(sealMarkup('allié', { size }), /width="20" height="20"/u, String(size));
        assert.match(morrMarkup({ size }), /width="18" height="18"/u, String(size));
        assert.equal(createSeal(svgDocument(), 'allié', { size }).getAttribute('width'), '20', String(size));
        assert.equal(createMorr(svgDocument(), { size }).getAttribute('width'), '18', String(size));
    }
    assert.match(sealMarkup('allié', { size: 12.5 }), /width="12.5"/u);
});

test('les constructeurs DOM produisent la même géométrie ou null sans createElementNS', () => {
    const seal = createSeal(svgDocument(), 'ennemi', { size: 30 });
    assert.equal(seal.tagName, 'svg');
    assert.equal(seal.namespace, 'http://www.w3.org/2000/svg');
    assert.equal(seal.getAttribute('class'), 'seal seal--ennemi');
    assert.equal(seal.getAttribute('aria-label'), null);
    assert.equal(seal.getAttribute('role'), 'img');
    assert.equal(seal.getAttribute('width'), '30');
    assert.equal(seal.children[0].tagName, 'title');
    assert.equal(seal.children[0].textContent, 'Statut : Ennemi');
    const markupParts = sealMarkup('ennemi').match(/<(path|ellipse|circle)\b/gu).length;
    assert.equal(seal.children.length - 1, markupParts);
    const morr = createMorr(svgDocument(), { size: 18 });
    assert.equal(morr.getAttribute('aria-label'), null);
    assert.equal(morr.children[0].textContent, 'Décédé');
    assert.doesNotMatch(morrMarkup(), /aria-label/u);
    assert.match(morrMarkup({ size: 18 }), /class="morr"[\s\S]*class="morr-gate"/u);
    assert.equal(createSeal({ createElement() {} }, 'allié'), null);
    assert.equal(createMorr(null), null);
});

test('le module ne contient aucune couleur : elles viennent des jetons des deux thèmes', () => {
    assert.doesNotMatch(read('js/seal.js'), /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
    const base = read('css/base.css');
    for (const key of ['allie', 'ennemi', 'neutre', 'inconnu']) {
        assert.match(base, new RegExp(`--seal-${key}:\\s*#[0-9a-f]{6};`, 'iu'));
        assert.match(base, new RegExp(`\\.seal--${key} \\.seal-wax\\s*\\{[^}]*var\\(--seal-${key}\\)`, 'iu'));
    }
    for (const token of ['--seal-glyph', '--seal-shadow', '--morr-bg', '--morr-ink', '--morr-ring']) {
        assert.match(base, new RegExp(`${token}:`, 'u'));
    }
    assert.match(read('css/theme-parchment.css'), /--seal-shadow:/u);
});

test("l'application mobile charge ses polices auto-hébergées, précachées par le service worker", () => {
    const faces = read('css/fonts.css');
    const files = [...faces.matchAll(/url\('\.\.\/(fonts\/[a-z0-9-]+\.woff2)'\)/gu)].map(match => match[1]);
    assert.deepEqual(files, ['fonts/cinzel-latin.woff2', 'fonts/crimson-text-latin-400.woff2',
        'fonts/crimson-text-latin-600.woff2', 'fonts/crimson-text-latin-400-italic.woff2']);
    assert.equal((faces.match(/font-display: swap;/gu) || []).length, 4);
    for (const file of files) {
        assert.equal(readFileSync(resolve(ROOT, file)).subarray(0, 4).toString('latin1'), 'wOF2', file);
    }
    assert.ok(existsSync(resolve(ROOT, 'fonts/OFL-Cinzel.txt')));
    assert.ok(existsSync(resolve(ROOT, 'fonts/OFL-CrimsonText.txt')));
    const html = read('app/index.html');
    assert.match(html, /<link rel="preload" href="\.\.\/fonts\/cinzel-latin\.woff2" as="font" type="font\/woff2" crossorigin>/u);
    assert.ok(html.indexOf('../css/fonts.css') < html.indexOf('../css/base.css'), 'les faces avant la feuille de base');
    assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic/u);
    const sw = read('sw.js');
    for (const asset of ['./css/fonts.css', './js/seal.js', ...files.map(file => `./${file}`)]) {
        assert.ok(sw.includes(`'${asset}'`), `${asset} doit être précaché`);
    }
});

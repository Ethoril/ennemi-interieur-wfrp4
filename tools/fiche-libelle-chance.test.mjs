// Les points de Chance s'affichent « Chance », jamais « Fortune » (décision du MJ du 09/11/2026 ; inventaire dans
// docs/RENOMMAGE_CHANCE_FORTUNE.md de l'Outil MJ). Le champ Firestore `fortune` et la clé `counter:fortune` ne changent pas :
// seul le texte des chaînes JS et des pages HTML est lu. Les noms propres où « Fortune » ne désigne pas les points restent permis.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOMS_PROPRES = /La Fortune est Capricieuse|Fortune généreuse|Ill[- ]Fortune|Fortune[- ][Tt]elling/g;
const IGNORES = new Set(['node_modules', '.git', 'vendor']);

const walk = dir => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    if (IGNORES.has(entry.name)) return [];
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walk(rel);
    return /\.(m?js)$/.test(entry.name) ? [rel] : [];
});

/** Chaînes littérales d'un source JS, commentaires exclus. */
function stringLiterals(src) {
    const out = []; let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
        if (c === '"' || c === "'" || c === '`') {
            let j = i + 1, s = '';
            while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } if (c !== '`' && src[j] === '\n') break; s += src[j]; j++; }
            out.push(s); i = j + 1; continue;
        }
        i++;
    }
    return out;
}

const offenders = (rel, texts) => texts
    .filter(text => /\bFortune\b/.test(text.replace(NOMS_PROPRES, '')))
    .map(text => `${rel} : « ${text.trim().slice(0, 120)} »`);

test('fiches : aucun libellé « Fortune » pour les points de Chance (js/, functions/src/, pages HTML)', () => {
    const scripts = [...walk('js'), ...walk('functions/src')];
    const pages = fs.readdirSync(ROOT).filter(name => name.endsWith('.html'));
    const found = [
        ...scripts.flatMap(rel => offenders(rel, stringLiterals(fs.readFileSync(path.join(ROOT, rel), 'utf8')))),
        ...pages.flatMap(rel => offenders(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n'))),
    ];
    assert.deepEqual(found, []);
});

test('le filtre accepte les noms propres et refuse un libellé de points', () => {
    assert.deepEqual(offenders('x.js', ['La Fortune est Capricieuse', 'Chance 2']), []);
    assert.equal(offenders('x.js', ['Fortune 2']).length, 1);
    assert.equal(offenders('x.js', ['1 Point de Fortune']).length, 1);
});

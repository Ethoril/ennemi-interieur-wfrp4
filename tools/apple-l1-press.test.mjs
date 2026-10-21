// Lot apple-design 1 : retour au press et hover réservé aux pointeurs qui survolent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS_DIR = new URL('../css/', import.meta.url);
const files = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css'));

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Renvoie les règles { selector, body, media } avec la pile des @media englobants.
function rules(src) {
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (c === '}') {
      const head = stack.pop() ?? '';
      if (!head.startsWith('@')) {
        out.push({ selector: head, body: buf, media: stack.filter((s) => s.startsWith('@media')) });
      }
      buf = '';
    } else if (c === ';' && stack.length && !stack[stack.length - 1].startsWith('@')) {
      buf += c;
    } else if (c === ';') {
      buf = '';
    } else {
      buf += c;
    }
  }
  return out;
}

const all = files.flatMap((f) =>
  rules(stripComments(readFileSync(join(fileURLToPath(CSS_DIR), f), 'utf8'))).map((r) => ({ ...r, file: f })),
);

test('chaque :hover est dans un @media (hover: hover)', () => {
  const bad = all.filter(
    (r) => /:hover\b/.test(r.selector) && !r.media.some((m) => /\(\s*hover\s*:\s*hover\s*\)/.test(m)),
  );
  assert.deepEqual(
    bad.map((r) => `${r.file}: ${r.selector.replace(/\s+/g, ' ')}`),
    [],
  );
});

test('les boutons ont un retour au press (:active avec transform)', () => {
  const active = all.filter(
    (r) => /(^|[\s,])(button|\.btn[\w-]*)[^,{]*:active/.test(r.selector) && /transform\s*:/.test(r.body),
  );
  assert.ok(active.length > 0, 'aucune règle button:active / .btn:active avec transform');
});

test('le flash de tap natif est neutralisé', () => {
  assert.ok(
    all.some((r) => /-webkit-tap-highlight-color\s*:\s*transparent/.test(r.body)),
    '-webkit-tap-highlight-color: transparent absent',
  );
});

test(':active reste sans effet sous prefers-reduced-motion (pas de transform)', () => {
  const reduced = all.filter(
    (r) => r.media.some((m) => /prefers-reduced-motion\s*:\s*reduce/.test(m)) && /:active/.test(r.selector),
  );
  assert.ok(
    reduced.some((r) => /transform\s*:\s*none/.test(r.body)),
    'ajouter un :active { transform: none } sous prefers-reduced-motion: reduce',
  );
});

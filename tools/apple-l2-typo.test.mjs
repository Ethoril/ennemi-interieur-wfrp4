// Lot apple-design : interlettrage selon la taille (grand texte resserré).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRules, decl } from './apple-css.mjs';

const rules = allRules();

// Taille maximale en rem d'une valeur font-size (px/16, rem, em≈rem, clamp/min/max → plus grande valeur).
function maxRem(v) {
  const vals = [...v.matchAll(/([\d.]+)(rem|px|em)\b/g)].map(([, n, u]) => (u === 'px' ? n / 16 : +n));
  return vals.length ? Math.max(...vals) : 0;
}
function trackingEm(v) {
  if (v === 'normal' || v === '0') return 0;
  const m = /^(-?[\d.]+)(em|px)$/.exec(v);
  return m ? (m[2] === 'px' ? m[1] / 16 : +m[1]) : 0;
}

test('le texte de 2rem et plus a un interlettrage ≤ 0.02em', () => {
  const bad = rules.filter((r) => {
    const fs = decl(r.body, 'font-size');
    const ls = decl(r.body, 'letter-spacing');
    return fs && ls && maxRem(fs) >= 2 && trackingEm(ls) > 0.02;
  });
  assert.deepEqual(bad.map((r) => `${r.file}: ${r.selector.replace(/\s+/g, ' ')}`), []);
});

test('les titres h1 et h2 de base ont un interlettrage ≤ 0.02em', () => {
  // Dernière règle globale de base.css qui vise le titre nu et fixe un interlettrage (cascade).
  for (const tag of ['h1', 'h2']) {
    const hits = rules.filter(
      (r) => r.file === 'base.css' && r.media.length === 0 && r.selector.split(',').map((s) => s.trim()).includes(tag) && decl(r.body, 'letter-spacing'),
    );
    const last = hits.at(-1);
    assert.ok(!last || trackingEm(decl(last.body, 'letter-spacing')) <= 0.02, `${tag} : ${last && decl(last.body, 'letter-spacing')}`);
  }
});

test('le corps active le dimensionnement optique', () => {
  assert.ok(
    rules.some((r) => /^(html|body|:root)$/.test(r.selector.trim()) && decl(r.body, 'font-optical-sizing') === 'auto'),
    'font-optical-sizing: auto absent de html/body/:root',
  );
});

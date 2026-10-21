// Lot apple-design : les modales naissent de leur déclencheur et y retournent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { allRules, decl } from './apple-css.mjs';
import { originFromTrigger } from '../js/modal-origin.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rules = allRules();

test('originFromTrigger : centre du déclencheur relatif au contenu', () => {
  const trigger = { left: 100, top: 200, width: 40, height: 20 };
  const content = { left: 50, top: 100, width: 300, height: 400 };
  assert.deepEqual(originFromTrigger(trigger, content), { x: '70px', y: '110px' });
});

test('originFromTrigger : sans déclencheur, centre du contenu', () => {
  assert.deepEqual(originFromTrigger(null, { left: 0, top: 0, width: 10, height: 10 }), { x: '50%', y: '50%' });
});

test('popIn sans dépassement élastique', () => {
  const bouncy = rules.filter((r) => /popIn/.test(decl(r.body, 'animation') ?? '') && /1\.2\d*\s*\)/.test(decl(r.body, 'animation')));
  assert.deepEqual(bouncy.map((r) => `${r.file}: ${r.selector}`), []);
});

test('.modal-content et .pnj-modal-content partent de --modal-origin', () => {
  for (const cls of ['.modal-content', '.pnj-modal-content']) {
    assert.ok(
      rules.some((r) => r.selector.split(',').map((s) => s.trim()).includes(cls) && /var\(--modal-origin-x/.test(decl(r.body, 'transform-origin') ?? '')),
      `${cls} : transform-origin: var(--modal-origin-x, 50%) var(--modal-origin-y, 50%) manquant`,
    );
  }
});

test('la modale vidéo sort par le même chemin (.closing + popOut)', () => {
  assert.ok(rules.some((r) => /^@keyframes popOut/.test(r.selector)), '@keyframes popOut manquant');
  assert.ok(rules.some((r) => /\.closing/.test(r.selector) && /popOut/.test(decl(r.body, 'animation') ?? decl(r.body, 'animation-name') ?? '')), 'règle .closing avec popOut manquante');
  const main = read('js/main.js');
  assert.match(main, /animationend/);
  assert.match(main, /prefers-reduced-motion/);
});

test('main.js et pnjs.js utilisent modal-origin.js', () => {
  for (const f of ['js/main.js', 'js/pnjs.js']) assert.match(read(f), /from ['"]\.\/modal-origin\.js['"]/, f);
});

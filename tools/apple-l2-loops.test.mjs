// Lot apple-design : pas de boucle décorative infinie, pulsations sur opacity/transform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRules, decl } from './apple-css.mjs';

const rules = allRules();
const LOADING = new Set(['spin', 'skeleton-shimmer']);

test('seuls les indicateurs de chargement bouclent à l\'infini', () => {
  const bad = rules.filter((r) => {
    const a = decl(r.body, 'animation') ?? '';
    const n = decl(r.body, 'animation-iteration-count') ?? '';
    if (!/\binfinite\b/.test(a + ' ' + n)) return false;
    const name = decl(r.body, 'animation-name') ?? a.split(/\s+/).find((t) => /^[a-z][\w-]*$/i.test(t) && !/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|both|forwards|backwards|alternate|normal|reverse|var)$/.test(t));
    return !LOADING.has(name) && r.file !== 'carnaval.css';
  });
  assert.deepEqual(bad.map((r) => `${r.file}: ${r.selector.replace(/\s+/g, ' ')}`), []);
});

test('pulse-glow et pulse-green n\'animent que opacity ou transform', () => {
  const frames = rules.filter((r) => /^@keyframes pulse-(glow|green)\b/.test(r.selector));
  const bad = frames.filter((r) => /(^|;|\s)(box-shadow|filter|background|width|height|top|left)\s*:/.test(r.body));
  assert.deepEqual(bad.map((r) => `${r.file}: ${r.selector}`), []);
});

// Lot apple-design : volet bas physique (vélocité, projection, élastique).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { project, rubberband, velocityFrom, shouldDismiss, exitDuration } from '../js/mobile/components/sheet-physics.js';

const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('project : décélération exponentielle d\'Apple (taux 0.998)', () => {
  near(project(1000), 499);
  near(project(-1000), -499);
  assert.equal(project(0), 0);
});

test('rubberband : résistance croissante et bornée', () => {
  assert.equal(rubberband(0, 600), 0);
  const a = rubberband(50, 600), b = rubberband(100, 600), c = rubberband(1e6, 600);
  assert.ok(a > 0 && a < 50);
  assert.ok(b > a && b < 100);
  assert.ok(c <= 600);
});

test('velocityFrom : px/s sur les 100 dernières ms', () => {
  assert.equal(velocityFrom([]), 0);
  assert.equal(velocityFrom([{ t: 0, y: 0 }]), 0);
  near(velocityFrom([{ t: 0, y: 0 }, { t: 50, y: 50 }, { t: 100, y: 150 }]), 1500, 1);
  // Les échantillons plus vieux que 100 ms avant le dernier sont ignorés.
  near(velocityFrom([{ t: 0, y: 0 }, { t: 400, y: 0 }, { t: 450, y: 50 }]), 1000, 1);
});

test('shouldDismiss : la projection décide, pas la seule distance', () => {
  assert.equal(shouldDismiss({ offset: 30, velocity: 1000, height: 600 }), true, 'petit lancer rapide vers le bas');
  assert.equal(shouldDismiss({ offset: 200, velocity: -800, height: 600 }), false, 'relancé vers le haut');
  assert.equal(shouldDismiss({ offset: 100, velocity: 0, height: 600 }), false, 'lent et court');
  assert.equal(shouldDismiss({ offset: 200, velocity: 0, height: 600 }), true, 'lent mais au-delà du quart');
  // Hauteur inconnue (hors navigateur) : seuil historique de 80 px.
  assert.equal(shouldDismiss({ offset: 200, velocity: 0, height: 0 }), true);
  assert.equal(shouldDismiss({ offset: 40, velocity: 0, height: 0 }), false);
});

test('exitDuration : la sortie poursuit à la vitesse du doigt, bornée 120–280 ms', () => {
  assert.equal(exitDuration(300, 3000), 120);
  assert.equal(exitDuration(300, 1500), 200);
  assert.equal(exitDuration(300, 0), 280);
  assert.equal(exitDuration(300, -500), 280);
});

test('bottom-sheet.js s\'appuie sur sheet-physics.js', () => {
  const src = readFileSync(new URL('../js/mobile/components/bottom-sheet.js', import.meta.url), 'utf8');
  assert.match(src, /from ['"]\.\/sheet-physics\.js['"]/);
  assert.match(src, /velocityFrom/);
  assert.match(src, /rubberband/);
});

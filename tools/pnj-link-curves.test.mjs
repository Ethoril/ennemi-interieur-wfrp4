import test from 'node:test';
import assert from 'node:assert/strict';
import { assignCurveLanes, bezierPath, curveFromPoint, curveHandlePoint } from '../js/pnj-link-curves.js';

const relation = (id, source, target, extra = {}) => ({
  id,
  source: { id: source, x: source === 'a' ? 0 : 240, y: source === 'a' ? 0 : 100 },
  target: { id: target, x: target === 'a' ? 0 : 240, y: target === 'a' ? 0 : 100 },
  type: 'alliance',
  ...extra,
});
const byId = links => Object.fromEntries(links.map(link => [link.id, link._curveScale]));

test('automatic lanes are stable across input shuffles and reciprocal links get distinct paths', () => {
  const linksA = [relation('r-c', 'b', 'a'), relation('r-a', 'a', 'b'), relation('r-b', 'b', 'a')];
  const linksB = [relation('r-b', 'b', 'a'), relation('r-c', 'b', 'a'), relation('r-a', 'a', 'b')];
  assignCurveLanes(linksA);
  assignCurveLanes(linksB);
  assert.deepEqual(byId(linksA), byId(linksB));
  assert.deepEqual([...Object.values(byId(linksA))].sort((a, b) => a - b), [-2, 1, 1]);
  const paths = linksA.map(link => bezierPath(link.source.x, link.source.y, link.target.x, link.target.y, link._curveScale));
  assert.equal(new Set(paths).size, paths.length);
  assert.ok(linksA.every(link => link._showLabel === true));
});

test('manual curvature is canonical, zero is straight, and reversing preserves the same curve', () => {
  const forward = relation('manual-forward', 'a', 'b', { curvature: 2.35 });
  const reverse = relation('manual-reverse', 'b', 'a', { curvature: 2.35 });
  const straight = relation('straight', 'a', 'b', { curvature: 0 });
  assignCurveLanes([reverse, straight, forward]);
  assert.equal(forward._curveScale, 2.35);
  assert.equal(reverse._curveScale, -2.35);
  assert.equal(straight._curveScale, 0);
  const fwdPath = bezierPath(0, 0, 240, 100, forward._curveScale, false, 30);
  const revPath = bezierPath(240, 100, 0, 0, reverse._curveScale, true, 30);
  const fwd = fwdPath.match(/^M([^ ]+) Q([^ ]+) (.+)$/u);
  const rev = revPath.match(/^M([^ ]+) Q([^ ]+) (.+)$/u);
  assert.equal(fwd[2], rev[2], 'both directions share the exact quadratic control point');
  assert.equal(fwd[1], rev[1]);
  assert.equal(fwd[3], rev[3]);
});

test('dragging the handle round-trips canonical curvature from either source orientation', () => {
  for (const [source, target, canonical] of [['a', 'b', 3.42], ['b', 'a', -4.18]]) {
    const link = relation('drag', source, target, { curvature: canonical });
    assignCurveLanes([link]);
    const point = curveHandlePoint(link, 30);
    assert.ok(Math.abs(curveFromPoint(link, point, 30) - canonical) <= 0.02);
  }
});

test('near-coincident endpoints and out-of-range drag points stay finite and bounded', () => {
  const link = { id: 'close', source: { id: 'a', x: 4, y: 9 }, target: { id: 'b', x: 4, y: 9 } };
  assignCurveLanes([link]);
  const handle = curveHandlePoint(link);
  assert.ok(Number.isFinite(handle.x) && Number.isFinite(handle.y));
  const path = bezierPath(4, 9, 4, 9, link._curveScale);
  assert.doesNotMatch(path, /NaN|Infinity/u);
  assert.equal(curveFromPoint(link, { x: 1e9, y: -1e9 }), 0);
  const normalLink = relation('far', 'a', 'b');
  assert.equal(curveFromPoint(normalLink, { x: 0, y: 1e9 }), 6);
  assert.equal(curveFromPoint(normalLink, { x: 0, y: -1e9 }), -6);
});

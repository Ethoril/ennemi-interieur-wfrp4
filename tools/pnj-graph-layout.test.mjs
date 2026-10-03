import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberGraphNodes, restoreGraphNodes, applySharedGraphPositions } from '../js/pnj-graph-layout.js';

test('les coordonnées partagées priment sur la simulation et restent fixes après reconstruction', () => {
    const memory = new Map();
    rememberGraphNodes([{ id: 'a', x: 12, y: 34, fx: 12, fy: 34 }], memory);
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const shared = new Map([['a', { x: 400, y: -200 }]]);
    restoreGraphNodes(nodes, shared, memory);
    assert.deepEqual(nodes[0], { id: 'a', x: 400, y: -200, fx: 400, fy: -200 });
    assert.deepEqual(nodes[1], { id: 'b' });
    assert.equal(applySharedGraphPositions(nodes, shared), false);
});

test('une mise à jour distante respecte le glisser local et ignore les coordonnées invalides', () => {
    const nodes = [{ id: 'a', x: 10, y: 20 }, { id: 'b' }, { id: 'c' }];
    const shared = new Map([['a', { x: 90, y: 80 }], ['b', { x: 30, y: 40 }], ['c', { x: Infinity, y: 2 }]]);
    assert.equal(applySharedGraphPositions(nodes, shared, new Set(['a'])), true);
    assert.deepEqual(nodes[0], { id: 'a', x: 10, y: 20 });
    assert.equal(nodes[1].fx, 30);
    assert.deepEqual(nodes[2], { id: 'c' });
    assert.equal(applySharedGraphPositions(nodes, shared), true);
    assert.equal(nodes[0].fx, 90);
});

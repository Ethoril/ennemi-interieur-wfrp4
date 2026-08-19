import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageUrlScope } from '../../js/protected-image-scope.js';

test('scope URL objet révoque sa génération obsolète sans toucher une autre vue', async () => {
    const revoked = [];
    let next = 0;
    const scope = createImageUrlScope({
        fetchBlob: async key => key,
        createObjectUrl: value => `blob:${value}:${++next}`,
        revokeObjectUrl: url => revoked.push(url),
    });
    const first = scope.beginGeneration();
    const firstResult = await scope.load('a', first);
    assert.equal(firstResult.url, 'blob:a:1');
    const second = scope.beginGeneration();
    assert.deepEqual(revoked, ['blob:a:1']);
    const stale = await scope.load('b', first);
    assert.equal(stale.stale, true);
    const current = await scope.load('b', second);
    assert.equal(current.url, 'blob:b:2');
    scope.revokeAll();
    assert.deepEqual(revoked, ['blob:a:1', 'blob:b:2']);
});

test('même clé remplace son URL et invalidate invalide une lecture en vol', async () => {
    const revoked = [];
    let resolveBlob;
    const scope = createImageUrlScope({
        fetchBlob: () => new Promise(resolve => { resolveBlob = resolve; }),
        createObjectUrl: value => `blob:${value}`,
        revokeObjectUrl: url => revoked.push(url),
    });
    const generation = scope.beginGeneration();
    const pending = scope.load('same', generation);
    scope.invalidate();
    resolveBlob('late');
    assert.equal((await pending).stale, true);
    assert.deepEqual(revoked, ['blob:late']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('le Service Worker exclut les blobs Storage avant toute mise en cache', async () => {
    const source = await readFile(resolve('sw.js'), 'utf8');
    assert.match(source, /function isStorageBlobRequest\(value\)/u);
    assert.match(source, /hostname === 'storage\.googleapis\.com'/u);
    assert.match(source, /hostname === 'firebasestorage\.googleapis\.com'/u);
    assert.match(source, /hostname\.endsWith\('\.firebasestorage\.app'\)/u);
    const guard = source.indexOf('isStorageBlobRequest(event.request.url)');
    const firstCacheWrite = source.indexOf('cache.put(');
    assert.ok(guard >= 0 && firstCacheWrite > guard, 'la garde Storage doit précéder toute écriture Cache Storage');
    assert.match(source, /filter\(request => isStorageBlobRequest\(request\.url\)\)/u,
        'l’activation doit purger les réponses Storage éventuellement héritées');
    assert.match(source, /cache\.delete\(request\)/u);
});

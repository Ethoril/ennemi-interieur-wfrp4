import test from 'node:test';
import assert from 'node:assert/strict';
import { Blob } from 'node:buffer';
import { protectedUploadOperationId } from '../../js/protected-upload-id.js';

test('l’identifiant d’upload est déterministe pour reprendre sans nouvel orphelin', async () => {
    const first = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const same = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const other = new Blob([new Uint8Array([1, 2, 4])], { type: 'image/png' });
    assert.equal(await protectedUploadOperationId(first), await protectedUploadOperationId(same));
    assert.notEqual(await protectedUploadOperationId(first), await protectedUploadOperationId(other));
    assert.match(await protectedUploadOperationId(first), /^[a-f0-9]{32}$/u);
});

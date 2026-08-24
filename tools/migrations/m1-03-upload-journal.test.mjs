import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetProtectedUpload, pendingProtectedUploads, rememberProtectedUpload } from '../../js/protected-upload-journal.js';

function memoryStorage() {
    const data = new Map();
    return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

test('le journal local conserve puis acquitte un upload à compenser', () => {
    const storage = memoryStorage();
    const entry = { collection: 'pnjs', ownerId: 'pnj-1', path: 'portraits/pnj-1/portrait-abc.webp' };
    assert.equal(rememberProtectedUpload(entry, storage, 123), true);
    assert.deepEqual(pendingProtectedUploads(storage), [{ ...entry, createdAt: 123 }]);
    assert.equal(forgetProtectedUpload(entry.path, storage), true);
    assert.deepEqual(pendingProtectedUploads(storage), []);
    assert.equal(rememberProtectedUpload({ ...entry, path: '../secret' }, storage), false);
    assert.equal(rememberProtectedUpload({ ...entry, path: 'indices/pnj-1/portrait-abc.webp' }, storage), false);
    assert.equal(rememberProtectedUpload({ ...entry, ownerId: 'pnj-2' }, storage), false);
    assert.equal(rememberProtectedUpload({ ...entry, path: 'portraits/other/portrait-abc.webp' }, storage), false);
});

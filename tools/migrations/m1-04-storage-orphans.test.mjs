import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canonicalPath,
    findOrphanPaths,
    validateOrphanAudit,
} from './m1-04-storage-orphans.mjs';

const production = {
    project: 'campagne-wrpg',
    bucket: 'campagne-wrpg.firebasestorage.app',
};

test('audit M1-04 refuse toute cible ambiguë avant connexion', () => {
    assert.ok(validateOrphanAudit({}, {}).length > 0);
    assert.ok(validateOrphanAudit({
        ...production,
        confirmProduction: null,
    }, {}).some(error => error.includes('confirm-production')));
    assert.ok(validateOrphanAudit({
        project: production.project,
        bucket: 'demo.appspot.com',
        confirmProduction: production.project,
    }, {}).some(error => error.includes('incohérents')));
    assert.ok(validateOrphanAudit({
        project: 'demo-m1-04',
        bucket: 'demo-m1-04.appspot.com',
    }, {}).some(error => error.includes('émulateurs')));
    assert.deepEqual(validateOrphanAudit({
        project: 'demo-m1-04',
        bucket: 'demo-m1-04.appspot.com',
    }, {
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
    }), []);
});

test('audit M1-04 normalise les références et ne liste que les orphelins protégés', () => {
    const bucket = 'demo-m1-04.appspot.com';
    assert.equal(canonicalPath(`gs://${bucket}/portraits/a/portrait.webp`, bucket), 'portraits/a/portrait.webp');
    assert.equal(canonicalPath(`https://storage.googleapis.com/${bucket}/indices/b/clue.png`, bucket), 'indices/b/clue.png');
    assert.equal(canonicalPath(`https://firebasestorage.googleapis.com/v0/b/${bucket}/o/portraits%2Fc%2Fportrait.webp?alt=media`, bucket), 'portraits/c/portrait.webp');
    assert.equal(canonicalPath('https://example.test/portraits/a/portrait.webp', bucket), null);

    const orphanPaths = findOrphanPaths([
        { imagePath: 'portraits/a/portrait.webp' },
        { imageUrl: `gs://${bucket}/indices/b/clue.png` },
    ], [
        'portraits/a/portrait.webp',
        'indices/b/clue.png',
        'portraits/orphan/portrait.webp',
        'unrelated/file.txt',
    ], bucket);
    assert.deepEqual(orphanPaths, ['portraits/orphan/portrait.webp']);
});

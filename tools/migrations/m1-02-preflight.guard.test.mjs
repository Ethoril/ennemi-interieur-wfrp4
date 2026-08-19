import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('tools/migrations/m1-02-preflight.mjs');

test('préflight sans projet/bucket est refusé avant connexion', () => {
    const result = spawnSync(process.execPath, [script], { cwd: resolve('.'), encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Préflight M1-02 refusé/);
});

test('préflight refuse une fausse exécution', () => {
    const result = spawnSync(process.execPath, [script, '--project=demo-m1-02', '--bucket=demo-m1-02.appspot.com', '--execute'], {
        cwd: resolve('.'), env: { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /--execute interdit/);
});

test('préflight production exige la confirmation et reste sans écriture', () => {
    const result = spawnSync(process.execPath, [script,
        '--project=campagne-wrpg', '--bucket=campagne-wrpg.firebasestorage.app'], {
        cwd: resolve('.'), encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /confirm-production/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const runner = resolve('tools/migrations/m1-03-emulator-run.mjs');

test('le runner M1-03 refuse un lancement sans les deux hôtes émulateurs', () => {
    const result = spawnSync(process.execPath, [runner], {
        cwd: resolve('.'), env: { ...process.env, M1_EMULATOR_NO_START: '1', FIRESTORE_EMULATOR_HOST: '', STORAGE_EMULATOR_HOST: '' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Runner M1-03 refusé/);
});

test('le runner M1-03 refuse le projet de production avant tout client Firebase', () => {
    const result = spawnSync(process.execPath, [runner], {
        cwd: resolve('.'), env: { ...process.env, M1_TEST_PROJECT: 'campagne-wrpg', GCLOUD_PROJECT: 'campagne-wrpg', M1_EMULATOR_NO_START: '1', FIRESTORE_EMULATOR_HOST: '', STORAGE_EMULATOR_HOST: '' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Runner M1-03 refusé/);
});

test('la production reste refusée même si les deux hôtes émulateurs sont présents', () => {
    const result = spawnSync(process.execPath, [runner], {
        cwd: resolve('.'), env: { ...process.env, M1_TEST_PROJECT: 'campagne-wrpg', GCLOUD_PROJECT: 'campagne-wrpg', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', STORAGE_EMULATOR_HOST: '127.0.0.1:9199', M1_EMULATOR_NO_START: '1' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Runner M1-03 refusé/);
});

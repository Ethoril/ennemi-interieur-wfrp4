import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const runner = resolve('tools/migrations/m1-01-emulator-run.mjs');

function run(env) {
    return spawnSync(process.execPath, [runner], {
        cwd: resolve('.'), env: { ...process.env, ...env }, encoding: 'utf8',
    });
}

test('runner M1-01 refuse les émulateurs absents avant Admin', () => {
    const result = run({ M1_EMULATOR_NO_START: '1', FIRESTORE_EMULATOR_HOST: '', STORAGE_EMULATOR_HOST: '', FIREBASE_STORAGE_EMULATOR_HOST: '' });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Runner émulateur refusé/);
});

test('runner M1-01 refuse le projet ou bucket production', () => {
    for (const target of [
        { M1_TEST_PROJECT: 'campagne-wrpg', M1_TEST_BUCKET: 'campagne-wrpg.firebasestorage.app' },
        { M1_TEST_PROJECT: 'demo-m1-01', M1_TEST_BUCKET: 'campagne-wrpg.firebasestorage.app' },
    ]) {
        const result = run({
            FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
            M1_EMULATOR_NO_START: '1',
            ...target,
        });
        assert.notEqual(result.status, 0);
        assert.match(`${result.stdout}${result.stderr}`, /Runner émulateur refusé/);
    }
});

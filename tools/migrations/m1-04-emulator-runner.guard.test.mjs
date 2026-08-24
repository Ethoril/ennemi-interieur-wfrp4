import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const runner = resolve('tools/migrations/m1-04-emulator-run.mjs');

test('le runner M1-04 exige un hôte Firestore émulateur', () => {
    const result = spawnSync(process.execPath, [runner], {
        cwd: resolve('.'),
        env: { ...process.env, M1_EMULATOR_NO_START: '1', FIRESTORE_EMULATOR_HOST: '' },
        encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Runner émulateur refusé/);
});

test('le runner M1-04 interdit explicitement la cible de production', () => {
    const result = spawnSync(process.execPath, [runner], {
        cwd: resolve('.'),
        env: {
            ...process.env,
            M1_TEST_PROJECT: 'campagne-wrpg',
            M1_TEST_BUCKET: 'campagne-wrpg.firebasestorage.app',
            FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
            M1_EMULATOR_NO_START: '1',
        },
        encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Runner M1-04 refusé/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const scripts = [
    resolve('tools/mobile-backup-emulator-run.mjs'),
    resolve('tools/mobile-backup-restore-emulator-run.mjs'),
];

function run(script, variables) {
    return spawnSync(process.execPath, [script], {
        cwd: resolve('.'),
        env: { ...process.env, ...variables },
        encoding: 'utf8',
    });
}

test('les runners directs refusent l’absence d’émulateur avant tout client Admin', () => {
    for (const script of scripts) {
        const result = run(script, {
            FIRESTORE_EMULATOR_HOST: '',
            STORAGE_EMULATOR_HOST: '',
            FIREBASE_STORAGE_EMULATOR_HOST: '',
            MOBILE_TEST_BACKUP: resolve('outside-runner-test-backup'),
            MOBILE_BACKUP_INPUT: resolve('outside-runner-test-backup'),
        });
        assert.notEqual(result.status, 0);
        assert.match(`${result.stdout}${result.stderr}`, /Runner émulateur refusé/);
    }
});

test('les runners directs refusent le projet ou bucket de production', () => {
    for (const script of scripts) {
        for (const target of [
            { project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app' },
            { project: 'demo-mobile', bucket: 'campagne-wrpg.firebasestorage.app' },
        ]) {
            const result = run(script, {
                FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
                STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
                MOBILE_TEST_PROJECT: target.project,
                MOBILE_TEST_BUCKET: target.bucket,
                MOBILE_TEST_BACKUP: resolve('outside-runner-test-backup'),
                MOBILE_BACKUP_INPUT: resolve('outside-runner-test-backup'),
            });
            assert.notEqual(result.status, 0);
            assert.match(`${result.stdout}${result.stderr}`, /Runner émulateur refusé/);
        }
    }
});

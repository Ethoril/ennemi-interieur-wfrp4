import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'wfrp-mobile-baseline-'));
const backupPath = join(temporaryRoot, 'backup');
const runner = resolve(repoRoot, 'tools/mobile-backup-emulator-run.mjs');
const firebaseEntry = resolve(repoRoot, 'node_modules/firebase-tools/lib/bin/firebase.js');
const emulatorCommand = `"${process.execPath}" "${runner}"`;
const result = spawnSync(process.execPath, [
    firebaseEntry, 'emulators:exec', '--only', 'firestore,storage', '--project', 'demo-mobile', emulatorCommand,
], {
    cwd: repoRoot,
    env: {
        ...process.env,
        MOBILE_TEST_PROJECT: 'demo-mobile',
        MOBILE_TEST_BUCKET: 'demo-mobile.appspot.com',
        MOBILE_TEST_BACKUP: backupPath,
        XDG_CONFIG_HOME: join(temporaryRoot, 'config'),
    },
    encoding: 'utf8',
    timeout: 180000,
});
try {
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    console.log('✓ Test d’intégration Firebase Emulator Suite réussi.');
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

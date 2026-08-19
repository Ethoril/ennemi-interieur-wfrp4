import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCTION_BUCKET } from './mobile-backup.mjs';

function argument(name) {
    const prefix = `--${name}=`;
    const value = process.argv.find(item => item.startsWith(prefix));
    return value ? value.slice(prefix.length) : null;
}

const input = argument('input') ?? process.env.MOBILE_BACKUP_INPUT;
const project = argument('project') ?? 'demo-mobile';
const bucket = argument('bucket') ?? `${project}.appspot.com`;
assert.ok(input, 'Utiliser --input=CHEMIN-ABSOLU-HORS-DEPOT');
assert.ok(resolve(input) === input || /^[A-Za-z]:[\\/]/u.test(input), 'Le backup doit être absolu');
assert.notEqual(project, 'campagne-wrpg', 'La cible de production est interdite');
assert.notEqual(bucket, PRODUCTION_BUCKET, 'Le bucket de production est interdit');

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const firebaseEntry = resolve(repoRoot, 'node_modules/firebase-tools/lib/bin/firebase.js');
const runner = resolve(repoRoot, 'tools/mobile-backup-restore-emulator-run.mjs');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'wfrp-backup-restore-'));
const command = `"${process.execPath}" "${runner}"`;
const result = spawnSync(process.execPath, [
    firebaseEntry, 'emulators:exec', '--only', 'firestore,storage', '--project', project, command,
], {
    cwd: repoRoot,
    env: {
        ...process.env,
        MOBILE_BACKUP_INPUT: resolve(input),
        MOBILE_TEST_PROJECT: project,
        MOBILE_TEST_BUCKET: bucket,
        XDG_CONFIG_HOME: join(temporaryRoot, 'config'),
    },
    encoding: 'utf8',
    timeout: 180000,
});
try {
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    console.log('✓ Restauration/validation du backup dans les émulateurs réussie.');
} finally {
    await rm(temporaryRoot, { recursive: true, force: true });
}

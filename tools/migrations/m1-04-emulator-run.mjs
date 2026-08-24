// Runner Emulator Suite M1-04 : aucune cible de production n'est acceptée.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = process.env.M1_TEST_PROJECT ?? 'demo-m1-04';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
if (project === 'campagne-wrpg' || process.env.GCLOUD_PROJECT === 'campagne-wrpg'
    || process.env.M1_TEST_BUCKET === 'campagne-wrpg.firebasestorage.app') {
    console.error('Runner M1-04 refusé : cible de production interdite');
    process.exit(1);
}
if (process.env.M1_EMULATOR_NO_START === '1' && !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error('Runner émulateur refusé : hôte Firestore absent');
    process.exit(1);
}

if (process.env.M1_EMULATOR_CHILD === '1') {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
        console.error('Runner M1-04 refusé : FIRESTORE_EMULATOR_HOST absent');
        process.exit(1);
    }
    await import('./m1-04-locks-emulator.test.mjs');
} else {
    const temp = await mkdtemp(join(tmpdir(), 'm1-04-emulator-'));
    const configPath = join(temp, 'firebase.json');
    await writeFile(configPath, `${JSON.stringify({
        firestore: {
            rules: resolve(root, 'firestore.rules'),
            indexes: resolve(root, 'firestore.indexes.json'),
        },
        emulators: { firestore: { port: 8080 } },
    })}\n`, 'utf8');
    const cli = resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
    let result;
    try {
        result = spawnSync(process.execPath, [cli, 'emulators:exec', '--only', 'firestore', '--project', project,
            '--config', configPath, `node "${resolve(root, 'tools/migrations/m1-04-locks-emulator.test.mjs')}"`], {
            cwd: root,
            env: { ...process.env, XDG_CONFIG_HOME: temp, M1_EMULATOR_CHILD: '1', M1_TEST_PROJECT: project },
            encoding: 'utf8',
        });
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error || result.status !== 0) {
        console.error(`Emulator Suite M1-04 échouée (code ${result.status ?? 'inconnu'}).`);
    }
    process.exitCode = result.error || result.status === null ? 1 : result.status;
}

// Runner Emulator Suite autonome : démarre Firestore et Storage dans un projet éphémère.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateEmulatorRunner } from './m1-01-visibility.mjs';

const project = process.env.M1_TEST_PROJECT ?? 'demo-m1-01';
const bucket = process.env.M1_TEST_BUCKET ?? `${project}.appspot.com`;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

if (project === 'campagne-wrpg' || bucket === 'campagne-wrpg.firebasestorage.app') {
    console.error('Runner émulateur refusé : cible de production interdite');
    process.exit(1);
}

if (process.env.M1_EMULATOR_CHILD === '1' || process.env.M1_EMULATOR_NO_START === '1') {
    const errors = validateEmulatorRunner({ project, bucket });
    if (errors.length) {
        console.error(`Runner émulateur refusé : ${errors.join('; ')}`);
        process.exit(1);
    }
    await import('./m1-01-emulator.test.mjs');
} else {
    const temp = await mkdtemp(join(tmpdir(), 'm1-01-emulator-'));
    const configPath = join(temp, 'firebase.json');
    await writeFile(configPath, `${JSON.stringify({
        firestore: { rules: resolve(repoRoot, 'firestore.rules') },
        storage: { rules: resolve(repoRoot, 'storage.rules') },
        emulators: { firestore: { port: 8080 }, storage: { port: 9199 } },
    })}\n`, 'utf8');
    const firebaseCli = resolve(repoRoot, 'node_modules/firebase-tools/lib/bin/firebase.js');
    let result;
    try {
        result = spawnSync(process.execPath, [firebaseCli,
            'emulators:exec', '--only', 'firestore,storage', '--project', project,
            '--config', configPath, `node "${resolve(repoRoot, 'tools/migrations/m1-01-emulator.test.mjs')}"`,
        ], {
            cwd: repoRoot,
            env: { ...process.env, XDG_CONFIG_HOME: temp, M1_EMULATOR_CHILD: '1', M1_TEST_PROJECT: project, M1_TEST_BUCKET: bucket },
            encoding: 'utf8',
        });
    } finally {
        await rm(temp, { recursive: true, force: true });
    }
    if (result.error || result.status !== 0) {
        console.error(`Emulator Suite M1-01 échouée (code ${result.status ?? 'inconnu'}).`);
        if (result.error) console.error(result.error.message);
        if (result.stdout) console.error(result.stdout);
        if (result.stderr) console.error(result.stderr);
    }
    process.exitCode = result.error || result.status === null ? 1 : result.status;
}

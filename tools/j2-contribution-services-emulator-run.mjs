import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = 'demo-j2-services';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.GCLOUD_PROJECT === 'campagne-wrpg' || process.env.FIREBASE_PROJECT === 'campagne-wrpg'
    || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    console.error('Runner services contributions refusé : cible de production ou identifiants ADC détectés');
    process.exit(1);
}
const temp = await mkdtemp(join(tmpdir(), 'j2-services-emulator-'));
const config = join(temp, 'firebase.json');
try {
    await writeFile(config, JSON.stringify({
        firestore: { rules: resolve(root, 'firestore.rules') },
        emulators: { firestore: { port: 8111 }, hub: { port: 4511 }, logging: { port: 4611 }, ui: { enabled: false } },
    }));
    const cli = resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
    const result = spawnSync(process.execPath, [cli, 'emulators:exec', '--only', 'firestore', '--project', project,
        '--config', config, `node --test "${resolve(root, 'tools/j2-contribution-services-emulator.test.mjs')}"`], {
        cwd: root,
        env: { ...process.env, GCLOUD_PROJECT: project, FIREBASE_PROJECT: project,
            GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_CLOUD_QUOTA_PROJECT: '', XDG_CONFIG_HOME: temp, CI: '1' },
        stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally { await rm(temp, { recursive: true, force: true }); }

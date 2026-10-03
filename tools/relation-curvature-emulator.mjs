import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = 'demo-relation-curvature';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.GCLOUD_PROJECT === 'campagne-wrpg' || process.env.FIREBASE_PROJECT === 'campagne-wrpg') {
    console.error('Runner curvature refusé : cible de production interdite');
    process.exit(1);
}
const temp = await mkdtemp(join(tmpdir(), 'relation-curvature-'));
const config = join(temp, 'firebase.json');
try {
    await writeFile(config, JSON.stringify({
        firestore: { rules: resolve(root, 'firestore.rules') },
        emulators: { firestore: { port: 8093 }, hub: { port: 4493 }, logging: { port: 4593 }, ui: { enabled: false } },
    }));
    const cli = resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
    const result = spawnSync(process.execPath, [cli, 'emulators:exec', '--only', 'firestore', '--project', project,
        '--config', config, `node --test "${resolve(root, 'tools/relation-curvature-rules.test.mjs')}"`], {
        cwd: root, env: { ...process.env, XDG_CONFIG_HOME: temp, CI: '1' }, stdio: 'inherit',
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally { await rm(temp, { recursive: true, force: true }); }

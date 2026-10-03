import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Cible fixe et locale : aucune lecture ni écriture dans la campagne réelle.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'carnaval-rules-'));
try {
    const config = join(temp, 'firebase.json');
    await writeFile(config, JSON.stringify({
        firestore: { rules: join(root, 'firestore.rules') },
        emulators: { firestore: { port: 8088 }, hub: { port: 4408 }, logging: { port: 4508 }, ui: { enabled: false } },
    }));
    const result = spawnSync(process.execPath, [join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'),
        'emulators:exec', '--only', 'firestore', '--project', 'demo-carnaval', '--config', config,
        `node "${join(root, 'tools/carnaval-rules.test.mjs')}"`,
    ], { cwd: root, env: { ...process.env, XDG_CONFIG_HOME: temp, CI: '1' }, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally { await rm(temp, { recursive: true, force: true }); }

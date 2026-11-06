// Chantier H, T3 : commande `outil-mj` de bout en bout, sous émulateurs Firestore + Functions.
// La vraie fonction `executeFicheCommand` (functions/src/index.js, App Check imposé) est appelée en HTTP.
// Projet `demo-…` seulement : identifiants ou cible de production refusés.
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = 'demo-outil-mj';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_QUOTA_PROJECT
    || process.env.GCLOUD_PROJECT === 'campagne-wrpg' || process.env.FIREBASE_PROJECT === 'campagne-wrpg') {
    console.error('Recette outil-mj refusée : cible de production ou identifiants ADC détectés');
    process.exit(1);
}
const temp = await mkdtemp(join(tmpdir(), 'outil-mj-emulator-'));
let config;
try {
    const localJavas = await readdir(join(root, 'tools/.runtime/java21')).catch(() => []);
    const javaHome = process.env.JAVA_HOME || (localJavas[0] ? join(root, 'tools/.runtime/java21', localJavas[0]) : null);
    // Fichier de configuration temporaire à la racine : firebase-tools résout `functions.source`
    // par rapport au dossier de la configuration (un chemin absolu est refusé).
    config = join(root, `firebase.outil-mj-emulator.${process.pid}.json`);
    await writeFile(config, JSON.stringify({
        firestore: { rules: 'firestore.rules' },
        functions: { source: 'functions' },
        emulators: {
            firestore: { port: 8133 }, functions: { port: 5033 }, hub: { port: 4533 }, logging: { port: 4633 },
            ui: { enabled: false },
        },
    }));
    const env = {
        ...process.env, GCLOUD_PROJECT: project, FIREBASE_PROJECT: project,
        GOOGLE_APPLICATION_CREDENTIALS: '', GOOGLE_CLOUD_QUOTA_PROJECT: '', XDG_CONFIG_HOME: temp, CI: '1',
        ...(await readdir(join(root, 'tools/.runtime/emulators')).then(() => true, () => false)
            ? { FIREBASE_EMULATORS_PATH: join(root, 'tools/.runtime/emulators') } : {}),
        OUTIL_MJ_FUNCTIONS_URL: `http://127.0.0.1:5033/${project}/europe-west1/executeFicheCommand`,
        ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${join(javaHome, 'bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` } : {}),
    };
    const result = spawnSync(process.execPath, [join(root, 'node_modules/firebase-tools/lib/bin/firebase.js'), 'emulators:exec',
        '--only', 'firestore,functions', '--project', project, '--config', config,
        `"${process.execPath}" --test "${join(root, 'tools/fiche-outil-mj-emulator.test.mjs')}"`], { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally {
    await rm(temp, { recursive: true, force: true });
    if (config) await rm(config, { force: true });
}

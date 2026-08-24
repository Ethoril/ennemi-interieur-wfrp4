import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldInitializeAppCheck, APP_CHECK_PRODUCTION_HOST, APP_CHECK_SITE_KEY } from '../../js/app-check.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

test('App Check est limité à l’origine de production', () => {
    assert.equal(APP_CHECK_PRODUCTION_HOST, 'ethoril.github.io');
    assert.equal(shouldInitializeAppCheck('ethoril.github.io'), true);
    assert.equal(shouldInitializeAppCheck('localhost'), false);
    assert.equal(shouldInitializeAppCheck('127.0.0.1'), false);
    assert.equal(shouldInitializeAppCheck('ethoril.github.io.evil.test'), false);
    assert.match(APP_CHECK_SITE_KEY, /^6L/u);
});

test('Functions déclare son point d’entrée et exige App Check', async () => {
    const [packageJson, source] = await Promise.all([
        readFile(resolve(REPO_ROOT, 'functions/package.json'), 'utf8').then(JSON.parse),
        readFile(resolve(REPO_ROOT, 'functions/src/index.js'), 'utf8'),
    ]);
    assert.equal(packageJson.main, 'src/index.js');
    assert.match(source, /onCall\(\{\s*enforceAppCheck:\s*true\s*\}/u);
    assert.match(source, /region: 'europe-west1'/u);
});

test('le client initialise App Check avec renouvellement automatique sans jeton de debug', async () => {
    const source = await readFile(resolve(REPO_ROOT, 'js/firebase-init.js'), 'utf8');
    assert.match(source, /initializeAppCheck/u);
    assert.match(source, /ReCaptchaEnterpriseProvider/u);
    assert.match(source, /isTokenAutoRefreshEnabled:\s*true/u);
    assert.match(source, /shouldInitializeAppCheck\(globalThis\.location\?\.hostname\)/u);
    assert.doesNotMatch(source, /FIREBASE_APPCHECK_DEBUG_TOKEN/u);
    assert.doesNotMatch(source, /debug.?token/iu);
});

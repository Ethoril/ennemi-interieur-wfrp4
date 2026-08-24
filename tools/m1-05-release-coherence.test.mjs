import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { APP_CHECK_PRODUCTION_HOST, shouldInitializeAppCheck } from '../js/app-check.js';

test('version, cache, CHANGELOG et précache restent cohérents', async () => {
    const [layout, sw, changelog] = await Promise.all([
        readFile(resolve('js/layout.js'), 'utf8'),
        readFile(resolve('sw.js'), 'utf8'),
        readFile(resolve('CHANGELOG.md'), 'utf8'),
    ]);
    const layoutVersion = layout.match(/APP_VERSION = '([^']+)'/u)?.[1];
    const swVersion = sw.match(/const APP_VERSION = '([^']+)'/u)?.[1];
    assert.ok(layoutVersion, 'APP_VERSION manquante dans layout.js');
    assert.equal(swVersion, layoutVersion);
    assert.match(sw, /const CACHE_NAME\s*=\s*'wfrp-cache-'\s*\+\s*APP_VERSION/u);
    const changelogVersion = layoutVersion.slice(1).replaceAll('.', '\\.' );
    assert.match(changelog, new RegExp(`^## \\[${changelogVersion}\\]`, 'mu'));
    assert.match(sw, /['"]\.\/js\/app-check\.js['"]/u);
});

test('la garde App Check reste strictement limitée à l’origine de production', () => {
    assert.equal(APP_CHECK_PRODUCTION_HOST, 'ethoril.github.io');
    assert.equal(shouldInitializeAppCheck('ethoril.github.io'), true);
    assert.equal(shouldInitializeAppCheck('localhost'), false);
    assert.equal(shouldInitializeAppCheck('127.0.0.1'), false);
});

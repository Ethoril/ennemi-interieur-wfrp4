/* global URL */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyStandaloneMobileTarget, redirectLegacyStandaloneEntry } from '../js/pwa-entry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const deploymentBase = 'https://ethoril.github.io/ennemi-interieur-wfrp4/';

test('M7-02 conserve l identité historique et démarre la même PWA sur l interface mobile', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.id, './index.html');
    assert.equal(manifest.start_url, './app/index.html');
    assert.equal(manifest.scope, './');
    assert.equal(new URL(manifest.id, new URL('/', deploymentBase)).href, 'https://ethoril.github.io/index.html');
    assert.equal(new URL(manifest.start_url, deploymentBase).href, `${deploymentBase}app/index.html`);
    assert.ok(new URL(manifest.start_url, deploymentBase).href.startsWith(new URL(manifest.scope, deploymentBase).href));
    assert.equal((read('app/index.html').match(/<link rel="manifest"/gu) ?? []).length, 1);
    assert.match(read('app/index.html'), /href="\.\.\/manifest\.json"/u);
});

test('l ancienne entrée standalone rejoint app sans rediriger le navigateur ou une page bureau', () => {
    const makeOptions = (href, standalone) => ({
        windowRef: {
            location: { href, replace() {} },
            matchMedia: () => ({ matches: standalone }),
            navigator: { userAgent: 'Android' },
        },
        documentRef: { baseURI: href },
    });
    assert.equal(legacyStandaloneMobileTarget(makeOptions(`${deploymentBase}index.html`, false)), null);
    assert.equal(legacyStandaloneMobileTarget(makeOptions(`${deploymentBase}pnjs.html`, true)), null);
    assert.equal(legacyStandaloneMobileTarget(makeOptions(`${deploymentBase}index.html`, true)),
        `${deploymentBase}app/index.html`);
    assert.equal(legacyStandaloneMobileTarget(makeOptions(deploymentBase, true)), `${deploymentBase}app/index.html`);

    const replacements = [];
    const options = makeOptions(`${deploymentBase}index.html`, true);
    options.windowRef.location.replace = target => replacements.push(target);
    assert.equal(redirectLegacyStandaloneEntry(options), true);
    assert.deepEqual(replacements, [`${deploymentBase}app/index.html`]);
});

test('la version mobile est découvrable et sa maintenance reste documentée', () => {
    const layout = read('js/layout.js');
    const home = read('index.html');
    const readme = read('README.md');
    assert.match(layout, /href: 'app\/'[^\n]*label: 'Version mobile'/u);
    assert.match(layout, /redirectLegacyStandaloneEntry/u);
    assert.match(home, /href="app\/"[^>]*id="card-mobile"/u);
    assert.match(home, /Ouvrir la version mobile/u);
    assert.match(readme, /Application mobile/u);
    assert.match(readme, /Faire évoluer PNJs ou Enquêtes/u);
    assert.match(readme, /client joueur[\s\S]*client MJ/u);
    assert.match(readme, /Aucune donnée privée/u);
});

test('M7-02 aligne release, précache, documentation et rollback', () => {
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const app = read('app/index.html');
    const changelog = read('CHANGELOG.md');
    const report = read('docs/mobile/M7-02-activation-livraison-finale.md');
    const packageJson = read('package.json');
    assert.match(layout, /APP_VERSION = 'v2\.22\.1'/u);
    assert.match(sw, /APP_VERSION = 'v2\.22\.1'/u);
    assert.match(app, /app-version" content="v2\.22\.1"/u);
    assert.match(changelog, /^## \[2\.22\.1\] - 2026-08-25\r?\n/u);
    assert.match(sw, /['"]\.\/js\/pwa-entry\.js['"]/u);
    assert.match(sw, /['"]\.\/app\/index\.html['"]/u);
    assert.match(packageJson, /"test:m7-02"/u);
    assert.match(packageJson, /tools\/m7-02-release\.test\.mjs/u);
    assert.match(report, /f1d0fdc/u);
    assert.match(report, /v2\.22\.0/u);
    assert.match(report, /v2\.22\.1/u);
    assert.match(report, /iOS.*différ|différ.*iOS/isu);
    assert.match(report, /remettre[\s\S]*start_url: `?\.\/index\.html/u);
    assert.match(report, /ne restaure ni Firestore ni Storage/u);
});

test('le statut global de synchronisation n est pas dupliqué dans les vues PNJ', () => {
    const listView = read('js/mobile/views/pnjs-list.js');
    const detailView = read('js/mobile/views/pnj-detail.js');
    assert.doesNotMatch(listView, /m-sync-badge|publicStatusMessage/u);
    assert.doesNotMatch(detailView, /m-sync-badge|publicStatusMessage/u);
    assert.match(read('app/index.html'), /id="m-status"/u);
});

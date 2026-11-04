import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('bureau : CSP conservée, ancienne fiche retirée', () => {
    const page = read('fiche.html');
    assert.ok(page.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/u));
    assert.doesNotMatch(page, /src="js\/fiche(?:-cloud)?\.js"/u);
    assert.match(page, /href="app\/index\.html#\/fiches"/u);
    for (const file of ['fiche-ancienne.html', 'js/fiche.js', 'js/fiche-cloud.js', 'js/fiche-client-bridge.js']) assert.ok(!existsSync(resolve(root, file)), file);
    assert.doesNotMatch(read('js/fiche-bureau/app.js'), /fiche-ancienne/u);
    assert.doesNotMatch(read('sw.js'), /fiche-ancienne|js\/fiche\.js|fiche-cloud|fiche-client-bridge/u);
});

test('bureau : page et graphe local précachés, livraison v2.38.3 cohérente', () => {
    const sw = read('sw.js');
    assert.match(sw, /APP_VERSION = 'v2.38.3'/u);
    assert.match(read('js/layout.js'), /APP_VERSION = 'v2.38.3'/u);
    assert.match(read('CHANGELOG.md'), /^## \[2.38.3\]/u);
    const assets = new Set([...sw.matchAll(/['"]\.\/([^'"]+)['"]/gu)].map(match => match[1]));
    for (const file of ['fiche.html', 'css/fiche-bureau.css', 'css/equipment.css', 'js/data/equipment-catalog.json', 'docs/memo-armures.pdf']) assert.ok(assets.has(file), file);
    const pending = ['js/fiche-bureau/app.js'];
    const visited = new Set();
    while (pending.length) {
        const file = pending.pop();
        if (visited.has(file)) continue;
        visited.add(file);
        assert.ok(existsSync(resolve(root, file)), file);
        assert.ok(assets.has(file), `Précache : ${file}`);
        for (const match of read(file).matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/gu)) {
            if (!match[1].startsWith('.')) continue;
            const path = resolve(dirname(resolve(root, file)), match[1]).slice(root.length + 1).replaceAll('\\', '/');
            pending.push(path);
        }
    }
});

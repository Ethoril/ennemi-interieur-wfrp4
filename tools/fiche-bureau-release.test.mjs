import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(resolve(root, name), 'utf8');

test('bureau : CSP conservée et ancienne page raccordée aux modules historiques', () => {
    const page = read('fiche.html');
    const previous = read('fiche-ancienne.html');
    const csp = html => html.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/u)?.[0];
    assert.ok(csp(page));
    assert.equal(csp(page), csp(previous));
    assert.match(previous, /src="js\/fiche\.js"/u);
    assert.match(previous, /src="js\/fiche-cloud\.js"/u);
    assert.match(previous, /href="css\/fiche\.css"/u);
    assert.doesNotMatch(page, /src="js\/fiche(?:-cloud)?\.js"/u);
    assert.match(page, /href="app\/index\.html#\/fiches"/u);
    assert.match(read('js/fiche-bureau/app.js'), /fiche-ancienne\.html\?/u);
});

test('bureau : page et graphe local précachés, livraison v2.35.0 cohérente', () => {
    const sw = read('sw.js');
    assert.match(sw, /APP_VERSION = 'v2\.35\.0'/u);
    assert.match(read('js/layout.js'), /APP_VERSION = 'v2\.35\.0'/u);
    assert.match(read('CHANGELOG.md'), /^## \[2\.35\.0\]/u);
    const assets = new Set([...sw.matchAll(/['"]\.\/([^'"]+)['"]/gu)].map(match => match[1]));
    for (const file of ['fiche.html', 'fiche-ancienne.html', 'css/fiche-bureau.css']) assert.ok(assets.has(file), file);
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

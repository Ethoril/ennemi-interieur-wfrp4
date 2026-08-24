import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function localImports(source) {
    const imports = [];
    const pattern = /(?:from\s*|import\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+?)\1/gu;
    for (const match of source.matchAll(pattern)) imports.push(match[2]);
    return imports;
}

function localAssetList() {
    const sw = read('sw.js');
    const block = sw.match(/const ASSETS_LOCAUX\s*=\s*\[([\s\S]*?)\n\];/u)?.[1];
    assert.ok(block, 'ASSETS_LOCAUX doit rester lisible');
    return [...block.matchAll(/['"](\.\/[^'"]+)['"]/gu)].map(match => match[1]);
}

test('la version et le précache couvrent le graphe local des pages bureau', () => {
    assert.deepEqual(localImports("import './effet.js'; import('./dynamique.js'); export { valeur } from './reexport.js';"),
        ['./effet.js', './dynamique.js', './reexport.js']);
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const changelog = read('CHANGELOG.md');
    assert.match(layout, /APP_VERSION\s*=\s*['"]v2\.17\.0['"]/u);
    assert.match(sw, /APP_VERSION\s*=\s*['"]v2\.17\.0['"]/u);
    assert.match(sw, /CACHE_NAME\s*=\s*['"]wfrp-cache-['"]\s*\+\s*APP_VERSION/u);
    assert.match(changelog, /^## \[2\.17\.0\] - 2026-08-25\r?\n/u);

    const assets = localAssetList();
    assert.equal(new Set(assets).size, assets.length, 'ASSETS_LOCAUX ne doit pas contenir de doublon');
    const pending = ['js/pnjs.js', 'js/enquetes.js'];
    const visited = new Set();
    while (pending.length) {
        const relative = pending.pop();
        if (visited.has(relative)) continue;
        visited.add(relative);
        const absolute = path.join(root, relative);
        assert.ok(fs.existsSync(absolute), `module local absent: ${relative}`);
        assert.ok(assets.includes(`./${relative.replaceAll(path.sep, '/')}`), `module non précaché: ${relative}`);
        for (const specifier of localImports(fs.readFileSync(absolute, 'utf8'))) {
            const child = path.normalize(path.join(path.dirname(relative), specifier));
            assert.ok(child.startsWith('js' + path.sep) || child === 'js', `import local hors js/: ${relative} -> ${specifier}`);
            pending.push(child);
        }
    }
});

test('les pages ne contournent pas la composition par des primitives Firebase', () => {
    for (const relative of ['js/pnjs.js', 'js/enquetes.js']) {
        const source = read(relative);
        assert.doesNotMatch(source, /firebase-(?:firestore|storage)\.js/u, relative);
        assert.doesNotMatch(source, /\b(?:collection|doc|getDoc|getDocs|runTransaction|writeBatch|updateDoc|deleteDoc|deleteObject|ref)\s*\(/u, relative);
        assert.doesNotMatch(source, /from\s+['"][^'"]*firebase-init\.js['"]/u, relative);
    }
    for (const file of fs.readdirSync(path.join(root, 'js/data')).filter(name => name.endsWith('.js'))) {
        assert.doesNotMatch(read(`js/data/${file}`), /firebase-init\.js|firebase-(?:firestore|storage)\.js/u,
            `js/data/${file} ne doit pas dépendre d'un singleton Firebase`);
    }
    const packageJson = JSON.parse(read('package.json'));
    assert.match(packageJson.scripts.check, /tools\/m2-05-integration\.test\.mjs/u);
    assert.match(packageJson.scripts.check, /tools\/m2-05-release\.test\.mjs/u);
});

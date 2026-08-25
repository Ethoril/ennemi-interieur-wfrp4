import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function localImports(source) {
    const imports = [];
    const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/gu;
    for (const match of source.matchAll(pattern)) imports.push(match[2]);
    return imports;
}

function moduleSources(html) {
    const sources = [];
    const pattern = /<script\b[^>]*>/giu;
    for (const match of html.matchAll(pattern)) {
        const tag = match[0];
        if (!/\btype\s*=\s*['"]module['"]/iu.test(tag)) continue;
        const source = tag.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/iu)?.[2];
        if (source) sources.push(source);
    }
    return sources;
}

function resolveLocalModule(from, specifier) {
    const relative = path.normalize(path.join(path.dirname(from), specifier));
    const absolute = path.resolve(root, relative);
    assert.ok(absolute === root || absolute.startsWith(`${root}${path.sep}`),
        `import local hors dépôt : ${from} -> ${specifier}`);
    return relative.replaceAll(path.sep, '/');
}

function assertModuleSyntax(relative) {
    assert.equal(path.extname(relative), '.js', `module mobile inattendu : ${relative}`);
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(root, relative)], {
        encoding: 'utf8',
        stdio: 'pipe',
    }), `syntaxe invalide : ${relative}`);
}

test('M6-02 aligne le cache et précache la coque mobile dans le worker racine', () => {
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const changelog = read('CHANGELOG.md');
    const layoutVersion = layout.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
    const swVersion = sw.match(/const APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
    assert.equal(layoutVersion, 'v2.21.8');
    assert.equal(swVersion, layoutVersion);
    assert.match(sw, /const CACHE_NAME\s*=\s*['"]wfrp-cache-['"]\s*\+\s*APP_VERSION/u);
    assert.match(changelog, /^## \[2\.21\.8\] - 2026-08-25\r?\n/u);
    const assetsBlock = sw.match(/const ASSETS_LOCAUX\s*=\s*\[([\s\S]*?)\n\];/u)?.[1] ?? '';
    assert.match(assetsBlock, /['"]\.\/app\/index\.html['"]/u);
    assert.match(assetsBlock, /['"]\.\/js\/mobile\/app\.js['"]/u);
});

test('la coque /app existe, ses modules référencés sont syntaxiquement valides et son graphe local est fermé', () => {
    const html = read('app/index.html');
    const sources = moduleSources(html);
    assert.deepEqual(sources, ['../js/mobile/app.js'], 'app/index.html doit garder un point d’entrée module unique');
    assert.ok(fs.existsSync(path.join(root, 'app/index.html')));
    assert.ok(fs.existsSync(path.join(root, 'css/mobile-app.css')));

    const pending = sources.map(source => resolveLocalModule('app/index.html', source));
    const visited = new Set();
    while (pending.length) {
        const relative = pending.pop();
        if (visited.has(relative)) continue;
        visited.add(relative);
        const absolute = path.join(root, relative);
        assert.ok(fs.existsSync(absolute), `module local absent : ${relative}`);
        assertModuleSyntax(relative);
        const source = fs.readFileSync(absolute, 'utf8');
        if (relative !== 'js/mobile/pwa.js') {
            assert.doesNotMatch(source, /(?:navigator\.)?serviceWorker(?:\.register)?/iu,
                `${relative} ne doit pas enregistrer le Service Worker directement`);
        }
        for (const specifier of localImports(source)) {
            pending.push(resolveLocalModule(relative, specifier));
        }
    }
    assert.ok(visited.has('js/mobile/views/pnjs-list.js'));
    assert.ok(visited.has('js/mobile/views/pnj-detail.js'));
});

test('la consultation mobile partage le manifeste sans annoncer /app ni service worker', () => {
    const publicHtml = fs.readdirSync(root)
        .filter(name => name.endsWith('.html'))
        .map(name => [name, read(name)]);
    for (const [name, source] of publicHtml) {
        assert.doesNotMatch(source, /(?:^|["'=\s])(?:\.\.\/|\.\/)?\/?app(?:\/|["'#?\s])/iu,
            `${name} ne doit pas annoncer /app/`);
    }
    const manifest = read('manifest.json');
    assert.doesNotMatch(manifest, /(?:start_url|src)\s*['"]?\s*:\s*['"][^'"]*\/?app(?:\/|['"])/iu,
        'le manifeste bureau ne doit pas cibler /app/');
    assert.doesNotMatch(manifest, /\/?app\//iu);
    assert.match(read('app/index.html'), /rel="manifest" href="\.\.\/manifest\.json"/u);
    assert.doesNotMatch(read('app/index.html'), /serviceWorker|navigator\.serviceWorker/iu);
});

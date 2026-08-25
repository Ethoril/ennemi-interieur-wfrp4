import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function moduleSources(html) {
    const sources = [];
    for (const match of html.matchAll(/<script\b[^>]*>/giu)) {
        const tag = match[0];
        if (!/\btype\s*=\s*['"]module['"]/iu.test(tag)) continue;
        const source = tag.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/iu)?.[2];
        if (source) sources.push(source);
    }
    return sources;
}

function localImports(source) {
    const imports = [];
    const pattern = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/gu;
    for (const match of source.matchAll(pattern)) imports.push(match[2]);
    return imports;
}

function resolveModule(from, specifier) {
    const relative = path.normalize(path.join(path.dirname(from), specifier));
    const absolute = path.resolve(root, relative);
    assert.ok(absolute === root || absolute.startsWith(`${root}${path.sep}`),
        `import local hors dépôt : ${from} -> ${specifier}`);
    return relative.replaceAll(path.sep, '/');
}

test('M5-03 aligne version, cache, méta et documentation de clôture', () => {
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const html = read('app/index.html');
    const changelog = read('CHANGELOG.md');
    const layoutVersion = layout.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
    const swVersion = sw.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
    assert.equal(layoutVersion, 'v2.21.5');
    assert.equal(swVersion, layoutVersion);
    assert.match(sw, /CACHE_NAME\s*=\s*['"]wfrp-cache-['"]\s*\+\s*APP_VERSION/u);
    assert.match(html, /app-version"\s+content="v2\.21.5"/u);
    assert.match(changelog, /^## \[2\.21\.5\] - 2026-08-25\r?\n/u);
    assert.ok(fs.existsSync(path.join(root, 'docs/mobile/M5-03-cloture-enquetes.md')));
});

test('le graphe M5 est fermé et tous les parcours enquêtes restent syntaxiquement contrôlés', () => {
    const sources = moduleSources(read('app/index.html'));
    assert.deepEqual(sources, ['../js/mobile/app.js']);
    const pending = sources.map(source => resolveModule('app/index.html', source));
    const visited = new Set();
    while (pending.length) {
        const relative = pending.pop();
        if (visited.has(relative)) continue;
        visited.add(relative);
        const absolute = path.join(root, relative);
        assert.ok(fs.existsSync(absolute), `module local absent : ${relative}`);
        assert.equal(path.extname(relative), '.js');
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', absolute], { stdio: 'pipe' }),
            `syntaxe invalide : ${relative}`);
        const source = fs.readFileSync(absolute, 'utf8');
        if (relative !== 'js/mobile/pwa.js') {
            assert.doesNotMatch(source, /(?:navigator\.)?serviceWorker(?:\.register)?/iu,
                `${relative} ne doit pas enregistrer le Service Worker directement`);
        }
        for (const specifier of localImports(source)) pending.push(resolveModule(relative, specifier));
    }
    for (const relative of [
        'js/mobile/views/enquetes-list.js',
        'js/mobile/views/enquete-detail.js',
        'js/mobile/views/enquetes-mj-list.js',
        'js/mobile/views/enquete-edit.js',
        'js/mobile/components/pnj-picker.js',
        'js/mobile/components/portrait-editor.js',
        'js/mobile/enquete-admin-list-model.js',
        'js/mobile/enquetes-drafts-store.js',
    ]) assert.ok(visited.has(relative), `module M5 absent du graphe : ${relative}`);
});

test('la CSP mobile couvre les services utilisés sans exposer de données au précache', () => {
    const html = read('app/index.html');
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/iu)?.[1] ?? '';
    assert.match(csp, /script-src 'self'/u);
    assert.match(csp, /style-src 'self'/u);
    assert.match(csp, /img-src 'self' data: blob:/u);
    assert.match(csp, /connect-src[^;]*firestore\.googleapis\.com/u);
    assert.match(csp, /connect-src[^;]*firebasestorage\.googleapis\.com/u);
    assert.match(csp, /connect-src[^;]*cloudfunctions\.net/u);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/iu);
    const assets = read('sw.js').match(/const ASSETS_LOCAUX\s*=\s*\[([\s\S]*?)\n\];/u)?.[1] ?? '';
    assert.match(assets, /['"]\.\/app\/index\.html['"]/u);
    assert.match(assets, /['"]\.\/js\/mobile\/app\.js['"]/u);
    for (const name of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
        if (name === 'app') continue;
        assert.doesNotMatch(read(name), /(?:^|["'=\s])(?:\.\.\/|\.\/)?\/?app(?:\/|["'#?\s])/iu,
            `${name} ne doit pas annoncer /app/`);
    }
    assert.doesNotMatch(read('manifest.json'), /\/?app\//iu);
});

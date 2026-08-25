import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documentTitleForRoute, parseRoute } from '../js/mobile/router.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function localImports(source) {
    return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/gu)]
        .map(match => match[2]);
}

function resolveModule(from, specifier) {
    const relative = path.normalize(path.join(path.dirname(from), specifier));
    const absolute = path.resolve(root, relative);
    assert.ok(absolute === root || absolute.startsWith(`${root}${path.sep}`),
        `import local hors dépôt : ${from} -> ${specifier}`);
    return relative.replaceAll(path.sep, '/');
}

test('M7-01 garde le candidat local v2.21.4 cohérent avec la référence déployée v2.21.3', () => {
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const app = read('app/index.html');
    const manifest = JSON.parse(read('manifest.json'));
    const changelog = read('CHANGELOG.md');
    const report = read('docs/mobile/M7-01-recette-deploiement-progressif.md');
    assert.equal(layout.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1], 'v2.21.4');
    assert.equal(sw.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1], 'v2.21.4');
    assert.match(app, /app-version"\s+content="v2\.21\.4"/u);
    assert.match(sw, /CACHE_NAME\s*=\s*['"]wfrp-cache-['"]\s*\+\s*APP_VERSION/u);
    assert.match(changelog, /^## \[2\.21\.4\]/mu);
    assert.equal(manifest.start_url, './index.html');
    assert.match(report, /712417f/u);
    assert.match(report, /387d1cf/u);
    assert.match(report, /v2\.21\.3/u);
    assert.match(report, /v2\.21\.4/u);
    assert.match(report, /5376782/u);
    assert.match(report, /Non exécuté|Non exécutée|Non revendiqué/iu);
});

test('M7-01 garde le graphe mobile syntaxique et le précache fermé', () => {
    const sw = read('sw.js');
    const assets = new Set([...sw.matchAll(/['"](\.\/[^'"]+)['"]/gu)].map(match => match[1]));
    const pending = ['js/mobile/app.js'];
    const visited = new Set();
    while (pending.length) {
        const relative = pending.pop();
        if (visited.has(relative) || !relative.endsWith('.js')) continue;
        visited.add(relative);
        const absolute = path.join(root, relative);
        assert.ok(fs.existsSync(absolute), `module mobile absent : ${relative}`);
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', absolute], { stdio: 'pipe' }),
            `syntaxe invalide : ${relative}`);
        for (const specifier of localImports(read(relative))) {
            const imported = resolveModule(relative, specifier);
            assert.ok(assets.has(`./${imported}`), `import hors précache : ${relative} -> ${specifier}`);
            pending.push(imported);
        }
    }
    assert.ok(visited.has('js/mobile/pwa.js'));
    assert.ok(visited.has('js/mobile/pwa-banner.js'));
    assert.match(sw, /['"]\.\/app\/index\.html['"]/u);
});

test('M7-01 ne rend pas la coque publique avant M7-02', () => {
    assert.doesNotMatch(read('manifest.json'), /\/app\//iu);
    for (const page of fs.readdirSync(root).filter(file => file.endsWith('.html'))) {
        assert.doesNotMatch(read(page), /(?:href|src|content)=["'][^"']*\/?app\//iu,
            `${page} annonce /app/`);
    }
    assert.doesNotMatch(read('js/layout.js'), /Ouvrir la version mobile|Installer l’application/iu);
});

test('les routes mobiles donnent un titre document générique et sans identifiant', () => {
    const cases = [
        ['#/pnjs', 'PNJs — L\'Ennemi Intérieur'],
        ['#/pnjs/secret-42', 'PNJ — L\'Ennemi Intérieur'],
        ['#/pnjs/nouveau', 'Nouveau PNJ — L\'Ennemi Intérieur'],
        ['#/pnjs/secret-42/modifier', 'Modifier un PNJ — L\'Ennemi Intérieur'],
        ['#/enquetes', 'Enquêtes — L\'Ennemi Intérieur'],
        ['#/enquetes/dossier-42', 'Enquête — L\'Ennemi Intérieur'],
        ['#/enquetes/nouveau', 'Nouvelle enquête — L\'Ennemi Intérieur'],
        ['#/enquetes/dossier-42/modifier', 'Modifier une enquête — L\'Ennemi Intérieur'],
        ['#/reglages', 'Réglages — L\'Ennemi Intérieur'],
        ['#/route-inconnue', 'Écran introuvable — L\'Ennemi Intérieur'],
    ];
    for (const [hash, expected] of cases) {
        const title = documentTitleForRoute(parseRoute(hash));
        assert.equal(title, expected, hash);
        assert.doesNotMatch(title, /secret-42|dossier-42/u);
    }
});

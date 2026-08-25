import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('M6-03 aligne version, cache, méta et rapport honnête', () => {
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const app = read('app/index.html');
    const changelog = read('CHANGELOG.md');
    const report = read('docs/mobile/M6-03-validation-pwa-cloture.md');
    const layoutVersion = layout.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
    const swVersion = sw.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/u)?.[1];
    assert.equal(layoutVersion, 'v2.22.2');
    assert.equal(swVersion, layoutVersion);
    assert.match(sw, /CACHE_NAME\s*=\s*['"]wfrp-cache-['"]\s*\+\s*APP_VERSION/u);
    assert.match(app, /app-version"\s+content="v2\.22\.2"/u);
    assert.match(app, /script-src[^;]*https:\/\/apis\.google\.com/u);
    assert.match(changelog, /^## \[2\.22\.2\] - 2026-08-25\r?\n/u);
    assert.match(report, /Android physique n’est donc pas déclaré validé/u);
    assert.match(report, /v2\.21\.7/u);
    assert.match(report, /v2\.21\.8/u);
    assert.match(report, /v2\.22\.1/u);
    assert.match(report, /v2\.22\.2/u);
    assert.match(report, /d42e1cd/u);
    assert.match(report, /5dc077b/u);
    assert.match(report, /f9f4a71/u);
    assert.match(report, /58fe964/u);
    assert.match(report, /actuellement publiée/u);
    assert.match(report, /Synchronisé avec le serveur/u);
    assert.match(report, /session MJ active/u);
    assert.match(report, /v2\.21\.3/u);
    assert.match(report, /iOS.*différée|différée.*iOS/isu);
    assert.match(report, /inspection réelle de Cache Storage/iu);
    assert.match(report, /122 entrées/iu);
    assert.match(report, /autorisation spécifique/iu);
});

test('M6-03 conserve l identité historique pendant l activation finale mobile', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.equal(manifest.id, './index.html');
    assert.equal(manifest.start_url, './app/index.html');
    assert.equal(manifest.scope, './');
    assert.match(read('sw.js'), /['"]\.\/app\/index\.html['"]/u);
    assert.match(read('js/layout.js'), /href: 'app\/'[^\n]*Version mobile/u);
});

test('M6-03 garde la coque et le Service Worker syntaxiquement contrôlables', () => {
    assert.ok(fs.existsSync(path.join(root, 'app/index.html')));
    assert.ok(fs.existsSync(path.join(root, 'js/mobile/pwa.js')));
    assert.ok(fs.existsSync(path.join(root, 'js/mobile/pwa-banner.js')));
    for (const relative of ['sw.js', 'js/layout.js', 'js/mobile/pwa.js', 'js/mobile/pwa-banner.js']) {
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', path.join(root, relative)], {
            stdio: 'pipe',
        }), `syntaxe invalide : ${relative}`);
    }
    assert.match(read('app/index.html'), /id="m-pwa-banner"[^>]+aria-live="polite"/u);
});

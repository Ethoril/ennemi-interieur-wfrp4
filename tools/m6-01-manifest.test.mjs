/* global Buffer, URL */
import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function parsePng(relative) {
    const bytes = fs.readFileSync(path.join(root, relative));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relative} signature PNG`);
    let offset = 8;
    let width;
    let height;
    let bitDepth;
    let colorType;
    const idat = [];
    while (offset < bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const data = bytes.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') break;
    }
    assert.equal(bitDepth, 8, `${relative} bit depth`);
    assert.equal(colorType, 6, `${relative} RGBA color type`);
    const stride = width * 4;
    const raw = inflateSync(Buffer.concat(idat));
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        const source = y * (stride + 1);
        const filter = raw[source];
        assert.ok(filter >= 0 && filter <= 4, `${relative} supported PNG filter`);
        for (let x = 0; x < stride; x += 1) {
            const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
            const above = y > 0 ? pixels[(y - 1) * stride + x] : 0;
            const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
            const value = raw[source + 1 + x];
            let decoded = value;
            if (filter === 1) decoded = (value + left) & 255;
            if (filter === 2) decoded = (value + above) & 255;
            if (filter === 3) decoded = (value + Math.floor((left + above) / 2)) & 255;
            if (filter === 4) {
                const estimate = left + above - upperLeft;
                const pa = Math.abs(estimate - left);
                const pb = Math.abs(estimate - above);
                const pc = Math.abs(estimate - upperLeft);
                decoded = (value + (pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft)) & 255;
            }
            pixels[y * stride + x] = decoded;
        }
    }
    return { width, height, pixels };
}

test('le manifeste conserve l’identité historique et lance l interface mobile sous le même scope', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const deploymentBase = 'https://ethoril.github.io/ennemi-interieur-wfrp4/';
    const deploymentOrigin = new URL('/', deploymentBase);
    assert.equal(new URL(manifest.id, deploymentOrigin).href, 'https://ethoril.github.io/index.html');
    assert.equal(new URL(manifest.start_url, deploymentBase).href, `${deploymentBase}app/index.html`);
    assert.equal(new URL(manifest.scope, deploymentBase).href, deploymentBase);
    assert.equal(manifest.id, './index.html');
    assert.equal(manifest.start_url, './app/index.html');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.orientation, undefined, 'aucune orientation forcée sans preuve d’usage');
    assert.equal(manifest.icons.length, 3);
    const appHtml = read('app/index.html');
    assert.equal((appHtml.match(/<link rel="manifest"/gu) ?? []).length, 1);
    assert.match(appHtml, /<meta name="theme-color" content="#07070d">/u);
    assert.match(appHtml, /<link rel="manifest" href="\.\.\/manifest\.json">/u);
    assert.match(appHtml, /<link rel="apple-touch-icon" sizes="180x180" href="\.\.\/icons\/apple-touch-icon\.png">/u);
    assert.doesNotMatch(appHtml, /app\/manifest\.json/u);
    const desktopPages = fs.readdirSync(root)
        .filter(name => name.endsWith('.html'))
        .map(name => [name, read(name)])
        .filter(([, html]) => html.includes('<link rel="manifest"'));
    assert.equal(desktopPages.length, 11);
    for (const [name, html] of desktopPages) {
        assert.equal((html.match(/<link rel="manifest"/gu) ?? []).length, 1, `${name} manifeste unique`);
        assert.match(html, /<link rel="manifest" href="manifest\.json">/u, `${name} manifeste racine`);
        assert.match(html, /<meta name="theme-color" content="#07070d">/u, `${name} thème`);
        assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon\.png">/u,
            `${name} Apple Touch`);
    }
});

test('les icônes PNG ont de vraies dimensions, un canal alpha et une zone maskable opaque', () => {
    const manifest = JSON.parse(read('manifest.json'));
    const entries = new Map(manifest.icons.map(icon => [icon.src, icon]));
    for (const [src, expected] of [
        ['icons/icon-192.png', [192, 192]],
        ['icons/icon-512.png', [512, 512]],
        ['icons/icon-maskable-512.png', [512, 512]],
    ]) {
        const image = parsePng(src);
        assert.deepEqual([image.width, image.height], expected, `${src} dimensions`);
        assert.equal(entries.get(src)?.type, 'image/png');
    }
    assert.equal(entries.get('icons/icon-192.png')?.purpose, 'any');
    assert.equal(entries.get('icons/icon-512.png')?.purpose, 'any');
    assert.equal(entries.get('icons/icon-maskable-512.png')?.purpose, 'maskable');
    const any = parsePng('icons/icon-192.png');
    const alpha = [];
    for (let i = 3; i < any.pixels.length; i += 4) alpha.push(any.pixels[i]);
    assert.ok(alpha.some(value => value === 0), 'les icônes any gardent des coins transparents');
    const upperCutoff = Math.floor(any.height * 9 / 32);
    let hasUpperGold = false;
    for (let y = 0; y < upperCutoff; y += 1) {
        for (let x = 0; x < any.width; x += 1) {
            const index = (y * any.width + x) * 4;
            if (any.pixels[index] === 201 && any.pixels[index + 1] === 168
                && any.pixels[index + 2] === 76 && any.pixels[index + 3] > 0) hasUpperGold = true;
        }
    }
    assert.ok(hasUpperGold, 'le sommet doré du symbole ne doit pas être tronqué');
    const maskable = parsePng('icons/icon-maskable-512.png');
    const center = maskable.width / 2;
    const safeRadius = maskable.width * 0.40 + 2;
    for (let y = 0; y < maskable.height; y += 1) {
        for (let x = 0; x < maskable.width; x += 1) {
            const index = (y * maskable.width + x) * 4;
            const isGold = maskable.pixels[index] === 201 && maskable.pixels[index + 1] === 168
                && maskable.pixels[index + 2] === 76 && maskable.pixels[index + 3] > 0;
            if (isGold) assert.ok(Math.hypot(x - center, y - center) <= safeRadius,
                `motif maskable hors zone sûre : ${x},${y}`);
        }
    }
    for (let y = 64; y < 448; y += 32) {
        for (let x = 64; x < 448; x += 32) assert.equal(maskable.pixels[(y * 512 + x) * 4 + 3], 255);
    }
    const apple = parsePng('icons/apple-touch-icon.png');
    assert.deepEqual([apple.width, apple.height], [180, 180]);
    assert.ok(fs.existsSync(path.join(root, 'icons/icon-source.svg')));
});

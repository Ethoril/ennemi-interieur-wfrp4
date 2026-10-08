/* global document, innerHeight, location, requestAnimationFrame */
// Recette géométrique dans Chromium : vraie coque HTML et fiche à données fictives.
// MOBILE_SCROLL_QA_URL : serveur tools/dev-server.mjs ; PLAYWRIGHT_MODULE : module installé.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = process.env.MOBILE_SCROLL_QA_URL || 'http://127.0.0.1:4183';
const out = resolve(process.env.MOBILE_SCROLL_QA_OUTPUT || 'tools/.runtime/mobile-scroll');
await mkdir(out, { recursive: true });
const [appHtml, fixtureHtml, fixtureScript] = await Promise.all(['/app/index.html', '/tools/fixtures/fiche-mobile-qa.html', '/tools/fixtures/fiche-mobile-qa.js']
    .map(async path => { const response = await fetch(base + path); assert.ok(response.ok); return response.text(); }));
const shellPattern = /  <div class="m-app"[\s\S]*?(?=  <script type="module")/u;
assert.ok(appHtml.match(shellPattern));
const fixtureWithProductionShell = fixtureHtml.replace(shellPattern, appHtml.match(shellPattern)[0]);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true });
const errors = [];
let ficheCases = 0;
let shellCases = 0;
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/tools/fixtures/fiche-mobile-qa.html*', route => route.fulfill({ contentType: 'text/html', body: fixtureWithProductionShell }));
    await page.goto(`${base}/tools/fixtures/fiche-mobile-qa.html?qa-equipment=1`);
    await page.locator('.m-fiche-tabs').waitFor();
    await page.evaluate(async () => {
        await document.fonts.ready;
        document.querySelector('.fiche-mobile-qa').hidden = true;
        document.querySelector('.m-bottom-nav').hidden = true;
        document.querySelector('#m-pwa-banner-text').textContent = 'Une nouvelle version est disponible.';
        document.querySelector('#m-pwa-update').hidden = false;
        document.querySelector('#m-pwa-dismiss').hidden = false;
    });
    const geometry = async () => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        return page.evaluate(() => {
        const main = document.querySelector('#m-main');
        main.scrollTop = main.scrollHeight;
        const panel = document.querySelector('.m-fiche-panel');
        const last = panel ? [...panel.children].filter(element => !element.hidden).at(-1) : main.lastElementChild;
        const nav = document.querySelector('.m-fiche-tabs') || document.querySelector('.m-bottom-nav');
        return { lastBottom: last.getBoundingClientRect().bottom, mainBottom: main.getBoundingClientRect().bottom,
            mainHeight: main.clientHeight, navTop: nav.getBoundingClientRect().top, navBottom: nav.getBoundingClientRect().bottom,
            viewport: innerHeight, documentHeight: document.documentElement.scrollHeight, hash: location.hash };
        });
    };
    const check = (g, label) => {
        assert.ok(g.mainHeight > 0, `${label}: contenu sans hauteur ${JSON.stringify(g)}`);
        assert.ok(g.lastBottom <= g.mainBottom + 1, `${label}: fin hors du défilement ${JSON.stringify(g)}`);
        assert.ok(g.mainBottom <= g.navTop + 1, `${label}: contenu derrière les onglets ${JSON.stringify(g)}`);
        assert.ok(Math.abs(g.navBottom - g.viewport) <= 1, `${label}: navigation hors écran ${JSON.stringify(g)}`);
        assert.ok(g.documentHeight <= g.viewport + 1, `${label}: défilement parasite du document ${JSON.stringify(g)}`);
    };
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        for (const fontSize of [16, 32]) for (const theme of ['dark', 'parchment']) for (const safeArea of [0, 24]) for (const banner of [false, true]) {
            await page.evaluate(({ fontSize, theme, safeArea, banner }) => {
                const root = document.documentElement;
                root.style.fontSize = `${fontSize}px`;
                root.dataset.theme = theme;
                root.style.setProperty('--m-safe-top', `${safeArea}px`);
                root.style.setProperty('--m-safe-bottom', `${safeArea}px`);
                document.querySelector('#m-pwa-banner').hidden = !banner;
            }, { fontSize, theme, safeArea, banner });
            for (let tab = 0; tab < 5; tab += 1) {
                await page.locator('.m-fiche-tab').nth(tab).click();
                const expectedHash = await page.locator('.m-fiche-tab').nth(tab).getAttribute('href');
                await page.waitForFunction(hash => location.hash === hash && document.querySelector('.m-fiche-tab[aria-current="page"]').getAttribute('href') === hash, expectedHash);
                check(await geometry(), JSON.stringify({ viewport, fontSize, theme, safeArea, banner, tab }));
                ficheCases += 1;
            }
        }
    }
    // Le défaut initial : petit écran, texte doublé, bandeau présent. Vérifier aussi un vrai geste tactile Chromium.
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('.m-fiche-tab').nth(1).click();
    await page.evaluate(() => { document.querySelector('#m-main').scrollTop = 0; });
    const cdp = await context.newCDPSession(page);
    const swipeUp = async () => {
        const box = await page.locator('#m-main').boundingBox();
        const x = box.x + box.width / 2;
        const y = box.y + box.height - 12;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 12; step += 1) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (box.height - 24) * step / 12 }] });
            await page.waitForTimeout(16);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(150);
    };
    await swipeUp();
    assert.ok(await page.locator('#m-main').evaluate(main => main.scrollTop > 0), 'le geste tactile fait défiler le contenu');
    await page.locator('#m-main').evaluate(main => { main.scrollTop = main.scrollHeight - main.clientHeight - 40; });
    await swipeUp();
    const touch = await page.locator('#m-main').evaluate(main => ({ top: main.scrollTop, max: main.scrollHeight - main.clientHeight }));
    assert.ok(touch.max > 0 && touch.top >= touch.max - 1, `geste tactile : ${JSON.stringify(touch)}`);
    check(await geometry(), 'après geste tactile');
    await page.screenshot({ path: resolve(out, 'aptitudes-bas-320-texte-200.png') });
    // Ouverture et fermeture d'un dialogue : les onglets et le défilement restent utilisables.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '16px'; document.querySelector('#m-pwa-banner').hidden = true; });
    await page.locator('#m-header-action').click();
    await page.locator('.m-fiche-menu[open]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.m-fiche-menu').waitFor({ state: 'hidden' });
    await page.locator('.m-fiche-tab').nth(3).click();
    check(await geometry(), 'après fermeture du menu');
    // Sortir de la fiche enlève sa navigation externe.
    await page.evaluate(() => { location.hash = '#/pnjs'; });
    await page.locator('.m-fiche-tabs').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#m-navigation .m-fiche-tabs').count(), 0);
    // Navigation générale : vraie page de production, démarrage réseau neutralisé, longue liste locale.
    const shell = await context.newPage();
    shell.on('pageerror', error => errors.push(error.message));
    await shell.route('**/js/mobile/app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await shell.goto(`${base}/app/index.html`);
    await shell.evaluate(() => {
        for (let index = 0; index < 60; index += 1) {
            const row = document.createElement('p'); row.textContent = `Contenu local ${index}`;
            document.querySelector('#m-main').append(row);
        }
        document.querySelector('#m-pwa-banner-text').textContent = 'Une nouvelle version est disponible.';
        document.querySelector('#m-pwa-update').hidden = false;
    });
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
        await shell.setViewportSize(viewport);
        for (const fontSize of [16, 32]) for (const banner of [false, true]) {
            const g = await shell.evaluate(({ fontSize, banner }) => {
                document.documentElement.style.fontSize = `${fontSize}px`;
                document.querySelector('#m-pwa-banner').hidden = !banner;
                const main = document.querySelector('#m-main'); main.scrollTop = main.scrollHeight;
                const nav = document.querySelector('.m-bottom-nav');
                return { lastBottom: main.lastElementChild.getBoundingClientRect().bottom, mainBottom: main.getBoundingClientRect().bottom,
                    mainHeight: main.clientHeight, navTop: nav.getBoundingClientRect().top, navBottom: nav.getBoundingClientRect().bottom,
                    viewport: innerHeight, documentHeight: document.documentElement.scrollHeight };
            }, { fontSize, banner });
            check(g, 'navigation générale'); shellCases += 1;
        }
    }
    // Chargement volontairement bloqué : une fiche ne doit jamais supprimer toute navigation.
    const delayed = await context.newPage();
    delayed.on('pageerror', error => errors.push(error.message));
    await delayed.route('**/tools/fixtures/fiche-mobile-qa.html*', route => route.fulfill({ contentType: 'text/html', body: fixtureWithProductionShell }));
    const gatedScript = fixtureScript.replace('loadRuntime: async () => ({ repository })',
        'loadRuntime: async () => { await new Promise(resolve => { globalThis.qaReleaseRuntime = resolve; }); return { repository }; }');
    assert.notEqual(gatedScript, fixtureScript, 'le test retarde vraiment le chargement de la fiche');
    await delayed.route('**/tools/fixtures/fiche-mobile-qa.js', route => route.fulfill({ contentType: 'application/javascript', body: gatedScript }));
    await delayed.goto(base + '/tools/fixtures/fiche-mobile-qa.html');
    await delayed.waitForFunction(() => typeof globalThis.qaReleaseRuntime === 'function');
    assert.equal(await delayed.locator('.m-fiche-tabs').count(), 0);
    assert.equal(await delayed.locator('.m-bottom-nav').isVisible(), true, 'navigation disponible pendant le chargement');
    await delayed.evaluate(() => globalThis.qaReleaseRuntime());
    await delayed.locator('.m-fiche-tabs').waitFor();
    await delayed.waitForFunction(() => document.querySelector('.m-bottom-nav').hidden);
    assert.equal(await delayed.locator('.m-fiche-tab').count(), 5);
    await delayed.evaluate(() => { location.hash = '#/reglages'; });
    await delayed.locator('.m-fiche-tabs').waitFor({ state: 'detached' });
    await delayed.waitForFunction(() => !document.querySelector('.m-bottom-nav').hidden);
    await delayed.close();
    // Démarrage réel : vérifier les boutons après navigation, avec la coque courante
    // et une coque HTML antérieure conservée pendant une mise à jour.
    const legacyHtml = appHtml
        .replace(/    <div class="m-topbar">([\s\S]*?)    <\/div>\s*(?=    <main)/u, '$1')
        .replace(/    <div class="m-navigation" id="m-navigation">\n([\s\S]*?<\/nav>)\n    <\/div>/u, '$1');
    assert.doesNotMatch(legacyHtml, /class="m-topbar"/u);
    assert.doesNotMatch(legacyHtml, /id="m-navigation"/u);
    for (const legacy of [false, true]) {
        const runtime = await context.newPage();
        runtime.on('pageerror', error => errors.push(error.message));
        if (legacy) await runtime.route('**/app/index.html*', route => route.fulfill({ contentType: 'text/html', body: legacyHtml }));
        await runtime.goto(base + '/app/index.html#/pnjs');
        await runtime.waitForFunction(() => document.querySelector('#m-main').childElementCount > 0);
        assert.equal(await runtime.locator('.m-topbar').count(), 1);
        assert.equal(await runtime.locator('#m-navigation').count(), 1);
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await runtime.setViewportSize(viewport);
            for (const section of ['pnjs', 'enquetes', 'fiches', 'reglages', 'pnjs']) {
                await runtime.locator('.m-bottom-nav a[data-route="' + section + '"]').click();
                await runtime.waitForFunction(section => document.querySelector('.m-bottom-nav a[aria-current="page"]').dataset.route === section, section);
                const navigation = await runtime.evaluate(() => {
                    const nav = document.querySelector('.m-bottom-nav');
                    const rect = nav.getBoundingClientRect();
                    return { hidden: nav.hidden, top: rect.top, bottom: rect.bottom, viewport: innerHeight,
                        usable: [...nav.querySelectorAll('a')].every(link => {
                            const box = link.getBoundingClientRect();
                            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
                            return hit === link || link.contains(hit);
                        }) };
                });
                assert.equal(navigation.hidden, false);
                assert.ok(navigation.top >= 0 && navigation.bottom <= navigation.viewport + 1, JSON.stringify(navigation));
                assert.equal(navigation.usable, true, 'les boutons de navigation sont visibles et atteignables');
            }
        }
        await runtime.close();
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, ficheCases, shellCases, runtimeCases: 20, delayedLoadCases: 2, touch, screenshots: out }));
} finally { await browser.close(); }

/* global document, navigator, dispatchEvent, Event, innerWidth */
// Recette locale sur les vraies pages : dépôts fictifs, aucune donnée privée ni écriture Firebase.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { resolve } from 'node:path';
import { buildBureauQaSession } from './fixtures/fiche-bureau-session.mjs';
const { chromium } = await import(pathToFileURL(process.env.BUREAU_PLAYWRIGHT_MODULE).href);
const base = process.env.BUREAU_QA_URL || 'http://127.0.0.1:4179';
const out = resolve(process.env.EQUIPMENT_QA_OUTPUT || '../tmp/equipment-qa');
await mkdir(out, { recursive: true });
const catalogue = JSON.parse(await readFile(new URL('../js/data/equipment-catalog.json', import.meta.url), 'utf8'));
const get = (name, category) => catalogue.items.find(item => item.name === name && (!category || item.category === category));
const weapon = catalogue.items.find(item => item.kind === 'weapon' && item.damage.replace(/\s/gu, '').toUpperCase() === 'BF+4');
const seed = [weapon, get('Veste de cuir'), get('Cotte de mailles'), get('Plastron', 'Plates'), get('Justaucorps de cuir'), get('Bouclier')]
    .map((item, i) => ({ ...item, id: `fixture_${i}` }));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [];
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/js/fiche-bureau/session.js', route => route.fulfill({ contentType: 'application/javascript', body: buildMock }));
    await page.route('**/js/layout.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/js/main.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    const buildMock = await buildBureauQaSession();
    await page.goto(`${base}/fiche.html?char=test&qa-role=mj`);
    await page.locator('.bureau-carac').first().waitFor();
    await page.evaluate(rows => globalThis.qaSetEquipment(rows), seed);
    assert.match(await page.locator('#bureau-weapons').innerText(), /BF\s*\+\s*4 = 7/u);
    assert.match(await page.locator('.eq-zone-body').innerText(), /5 PA/u);
    assert.match(await page.locator('.eq-zone-rightArm').innerText(), /3 PA/u);
    assert.match(await page.locator('.eq-shield-note').innerText(), /\+ 2 PA si applicable/u);
    await page.locator('.eq-zone-body').click();
    const detail = page.locator('.eq-dialog[open]');
    assert.match(await detail.innerText(), /Justaucorps de cuir : Cette couche est déjà comptée/u);
    await detail.getByRole('button', { name: 'Points faibles', exact: true }).click();
    assert.match(await detail.innerText(), /Critique/u);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.eqFocus), 'zone:body');

    async function addWeapon(name = 'Lame de recette', model = false) {
        await page.locator('#bureau-weapons').getByRole('button', { name: '+ Ajouter', exact: true }).click();
        const modal = page.locator('.eq-dialog[open]');
        await modal.getByRole('searchbox').fill(model ? name : weapon.name);
        await modal.getByRole('button', { name: model ? `${name} · ${weapon.category} · Modèle MJ` : `${weapon.name} · ${weapon.category}`, exact: true }).click();
        if (!model) {
            await modal.locator('[name="name"]').fill(name);
            await modal.locator('[name="damage"]').fill('BF + 8');
            await modal.getByRole('combobox', { name: 'Ajouter un mot clé' }).selectOption('solide');
            await modal.getByRole('button', { name: 'Ajouter le mot clé', exact: true }).click();
            await modal.getByRole('textbox', { name: /Paramètre de Solide/u }).fill('3');
            await modal.getByRole('button', { name: 'Enregistrer comme modèle MJ', exact: true }).click();
            await page.waitForFunction(() => document.querySelector('.eq-feedback').textContent.includes('Modèle enregistré'));
        }
        await modal.getByRole('button', { name: 'Enregistrer sur la fiche', exact: true }).click();
        await modal.waitFor({ state: 'hidden' });
    }
    await addWeapon();
    assert.equal(await page.evaluate(() => document.activeElement.dataset.eqFocus), 'add:weapon');
    assert.match(await page.locator('.eq-item').filter({ hasText: 'Lame de recette' }).innerText(), /BF \+ 8 = 11/u);
    await addWeapon('Lame de recette', true);
    assert.equal(await page.locator('.eq-item h3').filter({ hasText: 'Lame de recette' }).count(), 2);

    const customRow = page.locator('.eq-item').filter({ hasText: 'Lame de recette' }).first();
    await customRow.getByRole('button', { name: 'Modifier', exact: true }).click();
    await page.locator('.eq-dialog[open] [name="name"]').fill('Édition périmée');
    await page.evaluate(() => {
        const rows = globalThis.qaController.getState().data.equipment.map(item => item.name === 'Lame de recette' ? { ...item, name: 'Modifié ailleurs' } : item);
        globalThis.qaSetEquipment(rows);
    });
    await page.locator('.eq-dialog[open]').getByRole('button', { name: 'Enregistrer sur la fiche', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.eq-feedback').textContent.includes('Fermez puis rouvrez'));
    assert.equal(await page.evaluate(() => globalThis.qaController.getState().data.equipment.some(item => item.name === 'Édition périmée')), false);
    await page.keyboard.press('Escape');

    await page.locator('#bureau-weapons').getByRole('button', { name: '+ Ajouter', exact: true }).click();
    await page.locator('.eq-dialog[open]').getByRole('searchbox').fill(weapon.name);
    await page.locator('.eq-dialog[open]').getByRole('button', { name: `${weapon.name} · ${weapon.category}`, exact: true }).click();
    await page.locator('.eq-dialog[open] [name="name"]').fill('Arme réponse perdue');
    const countBefore = await page.evaluate(() => globalThis.qaController.getState().data.equipment.length);
    await page.evaluate(() => { globalThis.qaEquipmentUncertain = true; });
    await page.locator('.eq-dialog[open]').getByRole('button', { name: 'Enregistrer sur la fiche', exact: true }).click();
    await page.locator('.eq-retry').waitFor();
    await page.locator('.eq-retry').click();
    await page.locator('.eq-dialog[open]').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => globalThis.qaController.getState().data.equipment.length), countBefore + 1);
    assert.equal(await page.evaluate(() => globalThis.qaController.getState().data.xpLog.length), 1);

    const reset = page.locator('.eq-item').filter({ hasText: 'Modifié ailleurs' }).first();
    await reset.getByRole('button', { name: 'Actualiser la base', exact: true }).click();
    await page.locator('.eq-dialog[open]').getByRole('button', { name: 'Appliquer le profil de base', exact: true }).click();
    await page.locator('.eq-dialog[open]').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => globalThis.qaController.getState().data.equipment.filter(item => item.name === 'Modifié ailleurs').length), 1);
    await page.locator('.eq-item').filter({ hasText: 'Modifié ailleurs' }).getByRole('button', { name: 'Retirer', exact: true }).click();
    await page.locator('.eq-dialog[open]').getByRole('button', { name: 'Retirer de la fiche', exact: true }).click();
    await page.locator('.eq-dialog[open]').waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Comprendre le cumul des armures', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Télécharger le mémo PDF', exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(`${out}/memo-download.pdf`);
    assert.equal((await readFile(`${out}/memo-download.pdf`)).subarray(0, 4).toString(), '%PDF');
    await page.keyboard.press('Escape');
    for (const theme of ['dark', 'parchment']) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        await page.screenshot({ path: `${out}/desktop-${theme}.png`, fullPage: true });
        await page.locator('#bureau-armours').screenshot({ path: `${out}/armours-desktop-${theme}.png` });
    }
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); dispatchEvent(new Event('offline')); });
    assert.equal(await page.locator('#bureau-weapons').getByRole('button', { name: '+ Ajouter', exact: true }).isDisabled(), true);
    await page.goto(`${base}/fiche.html?char=test`);
    await page.locator('.bureau-carac').first().waitFor();
    await page.evaluate(rows => globalThis.qaSetEquipment(rows), seed);
    assert.equal(await page.locator('#bureau-weapons [data-eq-edit]').count(), 0);
    assert.equal(await page.evaluate(async () => { try { await globalThis.qaController.executeOnlineCommand('equipment', {}); return false; } catch { return true; } }), true);

    await page.goto(`${base}/tools/fixtures/fiche-mobile-qa.html#/fiches/test/equipement`);
    await page.getByRole('link', { name: 'Équipement', exact: true }).waitFor();
    assert.equal(await page.locator('.m-fiche-tab').count(), 5);
    await page.evaluate(rows => globalThis.ficheMobileQa.setEquipment(rows), seed);
    assert.match(await page.locator('.eq-zone-body').innerText(), /5 PA/u);
    assert.equal(await page.locator('.eq-section [data-eq-edit]').count(), 0);
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        for (const theme of ['dark', 'parchment']) {
            await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Débordement ${width}, ${theme}`);
            await page.screenshot({ path: `${out}/mobile-${width}-${theme}.png`, fullPage: true });
            await page.locator('.eq-section').last().screenshot({ path: `${out}/armours-mobile-${width}-${theme}.png` });
        }
    }
    await page.locator('.eq-zone-body').click();
    assert.match(await page.locator('.eq-dialog[open]').innerText(), /Corps : 5 PA/u);
    await page.keyboard.press('Escape');
    await page.locator('.fiche-mobile-qa summary').click();
    await page.getByRole('button', { name: 'MJ', exact: true }).click();
    await page.locator('.eq-section').first().getByRole('button', { name: '+ Ajouter', exact: true }).click();
    await page.locator('.eq-dialog[open]').getByRole('searchbox').fill('Bouclier');
    await page.locator('.eq-dialog[open]').getByRole('button', { name: 'Bouclier · Bouclier', exact: true }).click();
    await page.locator('.eq-dialog[open]').getByRole('spinbutton', { name: 'Paramètre de Protectrice X', exact: true }).fill('4');
    assert.equal(await page.locator('.eq-dialog[open] [name="ap"]').inputValue(), '4');
    await page.locator('.eq-dialog[open] [name="name"]').fill('Bouclier mobile');
    await page.locator('.eq-dialog[open]').getByRole('button', { name: 'Enregistrer sur la fiche', exact: true }).click();
    await page.locator('.eq-dialog[open]').waitFor({ state: 'hidden' });
    assert.match(await page.locator('.eq-shield-note').innerText(), /\+ 4 PA/u);
    await page.getByRole('button', { name: 'Joueur', exact: true }).click();
    assert.equal(await page.locator('.eq-section [data-eq-edit]').count(), 0);
    await page.getByRole('link', { name: 'Principal', exact: true }).click();
    assert.equal(await page.locator('.eq-panel').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, errors, screenshots: out }));
} finally { await browser.close(); }

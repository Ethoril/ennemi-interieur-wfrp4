/* global navigator, document, dispatchEvent, Event, scrollTo, innerWidth, getComputedStyle */
// Vérification navigateur locale : runtime Playwright fourni par Codex, aucun accès Firebase.
// BUREAU_PLAYWRIGHT_MODULE pointe sur le module Playwright du poste.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { resolve } from 'node:path';
const { chromium } = await import(pathToFileURL(process.env.BUREAU_PLAYWRIGHT_MODULE).href);
const out = resolve(process.env.BUREAU_QA_OUTPUT || 'tmp/fiche-bureau-qa');
await mkdir(out, { recursive: true });
const base = process.env.BUREAU_QA_URL || 'http://localhost:8011';
const original = await readFile(new URL('../js/fiche-bureau/session.js', import.meta.url), 'utf8');
const loader = original.slice(original.indexOf('export async function loadBureauCatalogues'), original.indexOf('export function connectBureau'));
const mock = `import { createPublishedCatalogueEngine } from '../fiche/published-catalogue-engine.js';
import { createFicheController } from '../fiche-controller.js';
import { createFicheDraftStore } from '../fiche-draft-store.js';
${loader}
export function connectBureau({charId,onState}) {
 const keys=['cc','ct','f','e','i','ag','dex','int','fm','soc'];
 const role=new URLSearchParams(location.search).get('qa-role')||'joueur';
 let envelope={schemaVersion:2,revision:1,data:{nom:'Hanna Vogt',race:'humain',carriere:'Agitateur',rang:new URLSearchParams(location.search).get('qa-rank')||'1',destin:'2',chance:'2',resilience:'1',determination:'1',blessuresAct:'10',corruption:'0',possessions:'Une plume, un carnet et quelques pièces.',basicSpecs:{},chosenVariants:{},careerOverrides:{},carac:Object.fromEntries(keys.map(k=>[k,{base:30,adv:3}])),skillsBasic:{Charme:3,Esquive:0},skillsAdvanced:[],talentsAcq:[],talentsAvail:[],sorts:[],prieres:[],careers:[],xpLog:[{id:'g',kind:'gain',raison:'Expérience de test',montant:5000}]}};
 if(new URLSearchParams(location.search).has('qa-talent-duplicate')) envelope.data.talentsAcq=[{id:'vision-old',nom:'Vision sacrée',note:'Première prise'},{id:'vision-new',nom:'Visions sacrées',note:'Doublon'}];
 let notify; let engine; const receipts=new Map();
 const repository={subscribe(id,callback){notify=callback;queueMicrotask(()=>callback({exists:true,envelope}));return ()=>{};},async execute(command){
 if(receipts.has(command.operationId))return receipts.get(command.operationId);
 if(globalThis.qaReject){globalThis.qaReject=false;throw Object.assign(new Error('Test'),{code:'failed-precondition',details:{kind:'price-changed'}});}
 let applied;
 if(command.type==='patch') {
  const next=structuredClone(envelope.data);
  for(const [path,value] of Object.entries(command.payload.changes)) {
   const parts=path.split('.').map(decodeURIComponent);let row=next;
   for(const key of parts.slice(0,-1))row=row[key]||=( {} );
   row[parts.at(-1)]=value;
  }
  applied={data:next,result:{}};
 } else applied=engine.applyCommand(envelope.data,command,{uid:'qa-user',role});
 envelope={...envelope,data:applied.data,revision:envelope.revision+1};
 const receipt={revision:envelope.revision,...applied.result};receipts.set(command.operationId,receipt);
 setTimeout(()=>notify({exists:true,envelope}),10);return receipt;
 }};
 const controller=createFicheController({repository,draftStore:createFicheDraftStore(),onChange:state=>onState(new URLSearchParams(location.search).has('qa-readonly')?{...state,phase:state.data?'legacy-readonly':state.phase}:state),receiptTimeoutMs:100});
 globalThis.qaController=controller;
 loadBureauCatalogues().then(c=>{engine=c.engine;controller.setSession({charId,uid:'qa-user',role});});
 return controller;
}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    const contrasts = {};
    const checkContrast = async theme => {
        const result = await page.evaluate(() => {
            const rgb = value => value.match(/[\d.]+/gu)?.map(Number) || [0, 0, 0];
            const mix = (front, back) => front.slice(0, 3).map((c, i) => c * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
            const background = node => {
                if (!node) return [7, 7, 13];
                const color = rgb(getComputedStyle(node).backgroundColor);
                return (color[3] ?? 1) === 1 ? color : mix(color, background(node.parentElement));
            };
            const luminance = color => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
            const rows = [...document.querySelectorAll('#bureau-content *')].filter(node => [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) && node.getClientRects().length && !node.closest('[hidden]') && !node.disabled && !(node.closest('details:not([open])') && !node.closest('summary'))).map(node => {
                const style = getComputedStyle(node); const bg = background(node); const fg = mix(rgb(style.color), bg);
                const a = luminance(bg), b = luminance(fg); const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
                return { text: node.textContent.trim().slice(0, 40), ratio, fg, bg, required: 4.5 };
            });
            return { minimum: Math.min(...rows.map(row => row.ratio)), failures: rows.filter(row => row.ratio < row.required) };
        });
        contrasts[theme] = result;
        assert.deepEqual(result.failures, [], theme + ' : contraste des textes');
    };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/js/fiche-bureau/session.js', route => route.fulfill({ contentType: 'application/javascript', body: mock }));
    await page.route('**/js/layout.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/js/main.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.goto(`${base}/fiche.html?char=test&return=mobile`);
    await page.locator('#bureau-content').waitFor({ state: 'visible' });
    await page.locator('.bureau-carac').first().waitFor();
    assert.equal(await page.getByRole('button', { name: 'Corriger l’identité', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '+ Gain d’XP', exact: true }).count(), 0);
    await page.locator('#skill-query').fill('resistance alc');
    assert.match(await page.locator('#bureau-skills').innerText(), /alcool/iu);
    await page.locator('#skill-query').fill('');
    const carac = page.locator('.bureau-carac').last();
    await carac.click();
    assert.match(await page.locator('#bureau-inspector').innerText(), /Sociabilité 30 \+ 3 avances = 33/u);
    await page.getByRole('button', { name: 'Augmenter le nombre d’avances' }).click();
    await page.locator('[data-action="purchase"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.carac.soc.adv === 5);
    await page.waitForFunction(() => document.getElementById('bureau-status').textContent === 'Modification enregistrée.');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.classList.contains('bureau-carac')), true);
    await page.locator('.bureau-chip').first().click();
    await page.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});dispatchEvent(new Event('offline')); });
    assert.equal(await page.locator('[data-action="purchase"]').isDisabled(), true);
    assert.match(await page.locator('#bureau-purchase-reason').innerText(), /une fois en ligne/u);
    await page.evaluate(() => { Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});dispatchEvent(new Event('online')); });
    await page.evaluate(() => { globalThis.qaReject = true; });
    await page.locator('[data-action="purchase"]').click();
    await page.locator('[data-action="retry"]').waitFor();
    await page.locator('[data-action="retry"]').click();
    await page.waitForFunction(() => document.getElementById('bureau-status').textContent === 'Modification enregistrée.');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Charme,/u }).click();
    await page.locator('[data-action="purchase"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.skillsBasic.Charme === 4);
    await page.keyboard.press('Escape');
    await page.locator('.bureau-talent').filter({ hasText: /^Sociable/u }).click();
    await page.locator('[data-action="purchase"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.talentsAcq.some(row => row.nom === 'Sociable'));
    await page.keyboard.press('Escape');
    for (const [kind, collection] of [['sort', 'sorts'], ['miracle', 'prieres']]) {
        await page.locator('[data-action="search"][data-kind="' + kind + '"]').click();
        await page.locator('#bureau-results button').first().click();
        await page.locator('[data-action="purchase"]').click();
        await page.waitForFunction(key => globalThis.qaController.getState().data[key].length === 1, collection);
        await page.keyboard.press('Escape');
    }
    await checkContrast('dark');
    await page.screenshot({ path: `${out}/desk-dark.png`, fullPage: true });
    const geometry = await page.evaluate(() => {
        const journal = document.getElementById('journal').getBoundingClientRect();
        const left = document.getElementById('bureau-left').getBoundingClientRect();
        const center = document.querySelector('.bureau-center').getBoundingClientRect();
        return { journalLeft: journal.left, left: left.left, journalRight: journal.right, centerRight: center.right };
    });
    assert.equal(geometry.journalLeft, geometry.left);
    assert.equal(geometry.journalRight, geometry.centerRight);
    await page.evaluate(() => scrollTo(0,500));
    assert.ok((await page.locator('.bureau-rail').boundingBox()).y >= 79);
    await page.evaluate(() => { document.documentElement.dataset.theme='parchment';scrollTo(0,0); });
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await checkContrast('parchment');
    await page.screenshot({ path: `${out}/desk-parchment.png`, fullPage: true });
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${out}/desk-320.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('button', { name: /^Rang 2/u }).click();
    await page.locator('[data-action="purchase"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.rang === '2');
    await page.goto(`${base}/fiche.html?char=test&qa-rank=4`);
    await page.locator('.bureau-carac').first().waitFor();
    await page.locator('.bureau-talent').filter({ hasText: /Savoir-vivre/u }).click();
    assert.equal(await page.locator('[data-action="purchase"]').isDisabled(), true);
    await page.locator('[data-action="talent-pick"]').filter({ hasText: 'Guilde' }).first().click();
    await page.locator('[data-action="purchase"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.talentsAcq.some(row => row.nom === 'Savoir-vivre (Guilde)'));
    await page.goto(`${base}/fiche.html?char=test&qa-readonly=1`);
    await page.locator('.bureau-carac').first().waitFor();
    await page.locator('.bureau-carac').first().click();
    assert.equal(await page.locator('[data-action="purchase"]').isDisabled(), true);
    assert.equal(await page.locator('#blessures-act').isDisabled(), true);
    await page.goto(`${base}/fiche.html?char=test&qa-role=mj`);
    await page.locator('.bureau-carac').last().waitFor();
    await page.getByRole('button', { name: 'Corriger l’identité', exact: true }).click();
    await page.locator('input[name="nom"]').fill('Hanna corrigée');
    await page.getByRole('button', { name: 'Ajouter aux corrections MJ', exact: true }).click();
    await page.locator('#bureau-correction-reason').fill('Correction de test');
    await page.locator('[data-action="submit-corrections"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.nom === 'Hanna corrigée');
    assert.equal(await page.getByRole('button', { name: '+ Gain d’XP', exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    const ask = (text, amount) => page.on('dialog', dialog => { void dialog.accept(dialog.message().includes('Nombre') ? String(amount) : text); });
    ask('Gain de test', 100);
    await page.getByRole('button', { name: '+ Gain d’XP', exact: true }).click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.xpLog.some(row => row.raison === 'Gain de test'));
    page.removeAllListeners('dialog');
    await page.locator('.bureau-carac').last().click();
    await page.locator('[data-action="purchase"]').click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.carac.soc.adv === 4);
    await page.locator('[data-action="cancel"]').first().click();
    await page.waitForFunction(() => globalThis.qaController.getState().data.carac.soc.adv === 3);
    const before = await page.evaluate(() => globalThis.qaController.getState().data.xpLog.length);
    ask('Dépense de test', 20);
    await page.getByRole('button', { name: 'Dépense libre', exact: true }).click();
    await page.waitForFunction(size => globalThis.qaController.getState().data.xpLog.length > size, before);
    page.removeAllListeners('dialog');
    await page.locator('#possessions').fill('Notes sauvegardées automatiquement');
    await page.waitForFunction(() => globalThis.qaController.getState().envelope.data.possessions === 'Notes sauvegardées automatiquement');
    for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/fiche.html?char=test&qa-role=mj&qa-talent-duplicate=1`);
        await page.locator('.bureau-talent').filter({ hasText: 'Visions sacrées' }).click();
        for (const theme of ['dark', 'parchment']) {
            await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
            await page.getByRole('button', { name: 'Corriger', exact: true }).click();
            const taken = page.locator('input[name="taken"]');
            const add = page.getByRole('button', { name: 'Ajouter aux corrections MJ', exact: true });
            assert.equal(await taken.inputValue(), '2', 'Le formulaire compte les deux alias');
            await add.click();
            assert.match(await page.locator('#bureau-correction-feedback').innerText(), /Aucun changement/u);
            assert.match(await page.locator('#bureau-corrections summary').innerText(), /· 0/u);
            await taken.fill('1');
            await add.click();
            assert.equal(await taken.inputValue(), '1');
            assert.match(await page.locator('#bureau-correction-feedback').innerText(), /Correction ajoutée/u);
            assert.match(await page.locator('#bureau-corrections summary').innerText(), /· 1/u);
            await add.click();
            assert.match(await page.locator('#bureau-corrections summary').innerText(), /· 1/u, 'Un second clic remplace la même cible');
            assert.equal(await page.evaluate(() => globalThis.qaController.getState().envelope.data.talentsAcq.length), 2, 'Le brouillon ne modifie pas la fiche enregistrée');
            await taken.fill('0');
            await add.click();
            assert.match(await page.locator('#bureau-corrections summary').innerText(), /· 2/u);
            await taken.fill('1');
            await add.click();
            assert.match(await page.locator('#bureau-corrections summary').innerText(), /· 1/u, 'Le changement de nombre remplace aussi les suppressions par alias');
            await page.screenshot({ path: `${out}/correction-alias-${width}-${theme}.png`, fullPage: true });
            await taken.fill('2');
            await add.click();
            assert.match(await page.locator('#bureau-corrections summary').innerText(), /· 0/u, 'Retour au nombre enregistré : retrait du brouillon');
        }
        const beforeCorrection = await page.evaluate(() => ({ data: globalThis.qaController.getState().data, revision: globalThis.qaController.getState().envelope.revision }));
        await page.locator('input[name="taken"]').fill('1');
        await page.getByRole('button', { name: 'Ajouter aux corrections MJ', exact: true }).click();
        await page.getByRole('link', { name: 'Consulter les corrections MJ dans le journal' }).click();
        await page.locator('#bureau-correction-reason').fill('Retrait du doublon de Visions sacrées');
        await page.locator('[data-action="submit-corrections"]').click();
        await page.waitForFunction(() => globalThis.qaController.getState().envelope.data.talentsAcq.length === 1);
        const afterCorrection = await page.evaluate(() => ({ data: globalThis.qaController.getState().data, revision: globalThis.qaController.getState().envelope.revision }));
        assert.deepEqual(afterCorrection.data.talentsAcq, [beforeCorrection.data.talentsAcq[0]], 'La première prise et sa note sont conservées');
        assert.equal(afterCorrection.revision, beforeCorrection.revision + 1, 'Une seule commande serveur');
        assert.equal(afterCorrection.data.xpLog.length, beforeCorrection.data.xpLog.length + 1, 'Correction tracée dans le journal');
        assert.equal(afterCorrection.data.xpLog.at(-1).cout, 0, 'Aucun débit ou remboursement XP');
        assert.deepEqual(afterCorrection.data.xpLog.slice(0, -1), beforeCorrection.data.xpLog, 'Historique XP préservé');
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, geometry, contrasts, errors, screenshots: out }));
    await context.close();
} finally { await browser.close(); }

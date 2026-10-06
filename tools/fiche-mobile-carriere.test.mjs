import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { careerChangeBlock, careerChangeOptions, careerProgress } from '../js/mobile/fiche-career-model.js';
import { purchaseErrorMessage, purchasePayload, purchasePreview, purchaseTarget } from '../js/mobile/fiche-purchase.js';
import { createCareerChangeSheet } from '../js/mobile/views/fiche-career-change.js';
import { createCareerPanel } from '../js/mobile/views/fiche-carriere.js';
import { createPurchaseSheet } from '../js/mobile/views/fiche-purchase-sheet.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();
const { careers } = catalogue;
const agitateur = careers.find(career => career.nom === 'Agitateur');
const keys = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];

const data = (extra = {}) => ({
    carriere: 'Agitateur', rang: '1', basicSpecs: {}, chosenVariants: {}, careerOverrides: {},
    carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: 0 }])),
    skillsBasic: {}, skillsAdvanced: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [], careers: [],
    xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: 5000 }], ...extra,
});
// Rang 1 d'Agitateur achevé : ct, int, soc à 5 ; les huit compétences à 5 (lignes avancées, adressées par leur nom principal) ; un talent du rang.
const complete = (extra = {}) => data({
    carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: ['ct', 'int', 'soc'].includes(key) ? 5 : 0 }])),
    skillsAdvanced: agitateur.rangs[0].skills.map((nom, index) => ({ id: `s${index}`, nom, carac: 'int', adv: 5 })),
    talentsAcq: [{ id: 't1', nom: 'Sociable' }], ...extra,
});
const progress = (d, source = careers) => careerProgress(d, engine, source);

test('jauges d’un rang incomplet : caractéristiques, compétences à compléter, talent', () => {
    const d = data({
        carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: { ct: 4, int: 5, soc: 7 }[key] ?? 0 }])),
        skillsBasic: { Charme: 5, Marchandage: 3 },
        skillsAdvanced: [{ id: 'a1', nom: 'Savoir (Politique)', carac: 'int', adv: 5 }, { id: 'a2', nom: 'Métier (Imprimerie)', carac: 'dex', adv: 2 }],
        talentsAcq: [{ id: 't1', nom: 'Sociable' }],
    });
    const result = progress(d);
    assert.deepEqual([result.career, result.title, result.statut, result.rank, result.complete], ['Agitateur', 'Pamphlétaire', 'Cuivre 1', 1, false]);
    const [caracs, skills, talent] = result.gauges;
    assert.deepEqual([caracs.label, caracs.done, caracs.total, caracs.detail], ['Caractéristiques à +5', 2, 3, 'CT +4 sur 5 · Int ✓ · Soc ✓']);
    assert.deepEqual([skills.label, skills.done, skills.total], ['Compétences à +5', 2, 8]);
    assert.match(skills.detail, /^Manquent : /u);
    assert.ok(skills.detail.includes('Marchandage +3'), skills.detail);
    assert.ok(skills.detail.includes('Métier (Imprimerie) +2'), skills.detail);
    assert.ok(skills.detail.includes('Subornation'), skills.detail);
    assert.ok(!skills.detail.includes('Charme'), skills.detail);
    assert.deepEqual([talent.done, talent.total, talent.detail], [1, 1, 'Sociable ✓']);
    assert.equal(result.nextCost, 200);
    assert.equal(result.hasNext, true);
    assert.deepEqual(result.history, [{ nom: 'Agitateur', rang: 1, current: true }]);
});

test('jauges d’un rang achevé : coût 100, objectifs atteints', () => {
    const result = progress(complete());
    assert.equal(result.complete, true);
    assert.deepEqual(result.gauges.map(gauge => [gauge.done, gauge.total]), [[3, 3], [8, 8], [1, 1]]);
    assert.equal(result.gauges[1].detail, 'Objectif atteint');
    assert.equal(result.nextCost, 100);
    assert.equal(result.nextRank, 2);
    assert.deepEqual(result.next.map(variant => [variant.title, variant.statut, variant.caracs]), [['Agitateur', 'Cuivre 2', ['Ag']]]);
    assert.ok(result.next[0].skills.includes('Calme'));
});

test('emplacements tous remplis mais moins de huit compétences : texte de repli au lieu de « Manquent : » vide', () => {
    const few = [{ ...agitateur, rangs: [{ ...agitateur.rangs[0], skills: agitateur.rangs[0].skills.slice(0, 3) }] }];
    const d = complete({ skillsAdvanced: agitateur.rangs[0].skills.slice(0, 3).map((nom, index) => ({ id: `s${index}`, nom, carac: 'int', adv: 5 })) });
    assert.equal(progress(d, few).gauges[1].detail, '5 compétences de carrière supplémentaires à +5');
});

test('talent du rang manquant : liste des talents à acquérir', () => {
    const result = progress(complete({ talentsAcq: [] }));
    assert.equal(result.complete, false);
    assert.deepEqual([result.gauges[2].done, result.gauges[2].detail.startsWith('À acquérir : Baratiner')], [0, true]);
});

test('rang maximal : aucun rang suivant, ni au rang 4 d’une carrière sans rang 5, ni au rang 5', () => {
    assert.equal(progress(data({ rang: '4' })).hasNext, false);
    assert.equal(progress(data({ carriere: 'Mage (HE)', rang: '5' })).hasNext, false);
    assert.equal(progress(data({ carriere: 'Mage (HE)', rang: '4' })).hasNext, true);
    assert.equal(purchaseTarget(data({ rang: '4' }), engine, careers, { kind: 'rank', rankMode: 'advanceRank' }), null);
    assert.equal(progress(data({ carriere: 'Inconnue' })), null);
    assert.equal(careerProgress(data(), null, careers), null);
});

test('historique : carrières archivées puis carrière en cours', () => {
    const result = progress(data({ rang: '2', careers: [{ id: 'c1', nom: 'Ratier', rang: 3 }, { id: 'c2', nom: 'Mage (HE)', rang: '2' }, { id: 'c3' }] }));
    assert.deepEqual(result.history, [
        { nom: 'Ratier', rang: 3, current: false }, { nom: 'Mage (HE)', rang: 2, current: false }, { nom: 'Agitateur', rang: 2, current: true },
    ]);
});

// ── Accord avec le moteur ──────────────────────────────────────────

const ctx = { uid: 'u', role: 'joueur' };
const apply = (d, payload, id = 'op') => engine.applyCommand(globalThis.structuredClone(d), { type: 'purchase', operationId: id, payload }, ctx);
const payloadOf = (d, spec, count = 1) => purchasePayload(purchaseTarget(d, engine, careers, spec), count, engine);

test('rang suivant : coût prévu et payload acceptés par le moteur (rang achevé 100 XP, sinon 200 XP)', () => {
    for (const [d, cost] of [[complete(), 100], [data(), 200]]) {
        const target = purchaseTarget(d, engine, careers, { kind: 'rank', rankMode: 'advanceRank' });
        assert.deepEqual(purchasePreview(target, 1, 1000), { cost, newTotal: null, after: 1000 - cost, affordable: true });
        const payload = purchasePayload(target, 1, engine);
        assert.deepEqual(payload, { kind: 'rank', rankMode: 'advanceRank', targetRank: 2, count: 1, expectedCost: cost, catalogVersion: engine.catalogVersion });
        const applied = apply(d, payload);
        assert.equal(applied.data.rang, '2');
        assert.equal(applied.result.cost, cost);
        assert.equal(target.summary, 'Agitateur (rang 1) → Agitateur (rang 2 · Agitateur)');
    }
    // Un coût périmé est refusé : l'aperçu doit rester celui du serveur.
    const stale = { ...payloadOf(data(), { kind: 'rank', rankMode: 'advanceRank' }), expectedCost: 100 };
    assert.throws(() => apply(data(), stale), error => error.details.kind === 'price-changed' && error.details.currentCost === 200);
});

test('changement de carrière : payload, archivage et coût selon l’achèvement de la carrière actuelle', () => {
    const target = careers.find(career => career.nom === 'Artisan') || careers.find(career => !career.prereq && career.id !== agitateur.id);
    for (const [d, cost] of [[complete(), 100], [data(), 200]]) {
        const spec = { kind: 'rank', rankMode: 'changeCareer', careerId: target.id, targetRank: 2 };
        const payload = payloadOf(d, spec);
        assert.deepEqual(payload, { kind: 'rank', rankMode: 'changeCareer', careerId: target.id, targetRank: 2, count: 1, expectedCost: cost, catalogVersion: engine.catalogVersion });
        const applied = apply(d, payload);
        assert.deepEqual([applied.data.carriere, applied.data.rang, applied.result.cost], [target.nom, '2', cost]);
        assert.deepEqual(applied.data.careers.map(({ nom, rang }) => [nom, rang]), [['Agitateur', 1]]);
    }
});

// Le filtre doit répondre comme le serveur pour toutes les carrières et tous les rangs d’entrée.
test('filtrage des prérequis identique au serveur (toutes carrières, rangs 1 à 5, trois fiches)', () => {
    const scenarios = {
        'sans historique': data(),
        'archivée Mage (HE) rang 2': data({ careers: [{ id: 'c', nom: 'mage (he)', rang: 2 }] }),
        'archivée Mage (HE) rang 1': data({ careers: [{ id: 'c', nom: 'Mage (HE)', rang: 1 }] }),
        'active Mage (HE) rang 2': data({ carriere: 'Mage (HE)', rang: '2' }),
        'active Mage (HE) rang 1': data({ carriere: 'Mage (HE)', rang: '1' }),
    };
    let accepted = 0;
    let refused = 0;
    for (const [label, d] of Object.entries(scenarios)) {
        const career = careers.find(item => item.nom === d.carriere);
        const rank = Number(d.rang);
        for (const target of careers) {
            for (let targetRank = 1; targetRank <= 5; targetRank += 1) {
                const reason = careerChangeBlock(d, career, rank, target, targetRank);
                let serverOk = true;
                try {
                    apply(d, { kind: 'rank', rankMode: 'changeCareer', careerId: target.id, targetRank, count: 1, expectedCost: 200, catalogVersion: engine.catalogVersion });
                } catch (error) {
                    // Un refus de prix ou de solde prouverait que toutes les vérifications de rang et de prérequis sont passées.
                    serverOk = error.details?.kind === 'price-changed';
                }
                assert.equal(!reason, serverOk, `${label} → ${target.nom} rang ${targetRank} : ${reason}`);
                if (serverOk) accepted += 1; else refused += 1;
            }
        }
    }
    assert.ok(accepted > 100 && refused > 100, `${accepted} acceptés, ${refused} refusés`);
});

test('prérequis : une carrière bloquée est listée avec sa raison, une carrière permise est cochée', () => {
    const named = (d, nom, targetRank) => careerChangeOptions(d, careers, { query: nom, targetRank }).find(option => option.nom === nom);
    const blocked = [named(data(), 'Maître du Savoir de Hoeth (HE)', 3)];
    assert.deepEqual([blocked[0].ok, blocked[0].reason], [false, 'Prérequis : Mage (HE), rang 2 minimum']);
    assert.equal(named(data(), 'Maître du Savoir de Hoeth (HE)', 1).reason, 'Pas de rang 1');
    assert.throws(
        () => apply(data(), { kind: 'rank', rankMode: 'changeCareer', careerId: blocked[0].id, targetRank: 3, count: 1, expectedCost: 200, catalogVersion: engine.catalogVersion }),
        error => error.details.kind === 'career-prerequisite');
    assert.equal(purchaseTarget(data(), engine, careers, { kind: 'rank', rankMode: 'changeCareer', careerId: blocked[0].id, targetRank: 3 }), null);
    assert.match(purchaseErrorMessage(Object.assign(new Error('x'), { code: 'failed-precondition', details: { kind: 'career-prerequisite' } })), /Prérequis/u);

    const mage = data({ carriere: 'Mage (HE)', rang: '2' });
    const open = [named(mage, 'Maître du Savoir de Hoeth (HE)', 3)];
    assert.equal(open[0].ok, true);
    const accepted = apply(mage,
        { kind: 'rank', rankMode: 'changeCareer', careerId: open[0].id, targetRank: 3, count: 1, expectedCost: 200, catalogVersion: engine.catalogVersion });
    assert.equal(accepted.data.carriere, 'Maître du Savoir de Hoeth (HE)');
});

test('options : recherche sans accents ni casse, ordre alphabétique, rang absent et carrière actuelle bloqués', () => {
    assert.deepEqual(careerChangeOptions(data(), careers, { query: 'PAMPHLETAIRE' }).map(option => option.nom), ['Agitateur']);
    assert.equal(careerChangeOptions(data(), careers, { query: 'agitateur', targetRank: 1 })[0].reason, 'Carrière et rang actuels');
    assert.equal(careerChangeOptions(data(), careers, { query: 'agitateur', targetRank: 2 })[0].ok, true);
    assert.equal(careerChangeOptions(data(), careers, { query: 'agitateur', targetRank: 5 })[0].reason, 'Pas de rang 5');
    const all = careerChangeOptions(data(), careers);
    assert.equal(all.length, careers.length);
    assert.deepEqual(all.map(option => option.nom), [...all.map(option => option.nom)].sort((a, b) => a.localeCompare(b, 'fr')));
    assert.deepEqual(careerChangeOptions(data({ carriere: 'Inconnue' }), careers), []);
});

// ── Vues, sur un faux DOM minimal ─────────────────────────────────

class FakeElement {
    constructor(documentRef, tagName) {
        Object.assign(this, {
            ownerDocument: documentRef, tagName, children: [], parentNode: null, attributes: new Map(), listeners: new Map(),
            className: '', textContent: '', hidden: false, disabled: false, open: false, value: '', id: '',
            style: { setProperty(name, value) { this[name] = value; } },
        });
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { this.ownerDocument.activeElement = this; }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    dispatch(type, extra = {}) {
        const event = { type, target: this, preventDefault() {}, ...extra };
        for (let node = this; node; node = node.parentNode) for (const listener of node.listeners.get(type) || []) listener(event);
    }
    click() { this.dispatch('click'); }
    all() { return this.children.flatMap(child => [child, ...child.all()]); }
    querySelectorAll() { return this.all().filter(node => node.tagName === 'button' && !node.disabled && !node.hidden); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    byClass(name) { return this.all().find(node => node.className.split(' ').includes(name)); }
    allByClass(name) { return this.all().filter(node => node.className.split(' ').includes(name)); }
}

function fakeDocument() {
    const documentRef = {
        activeElement: null, defaultView: null,
        body: { classList: { add() {}, remove() {} } },
        createElement: tag => new FakeElement(documentRef, tag),
        addEventListener() {}, removeEventListener() {},
    };
    return documentRef;
}

const buttonLabelled = (root, label) => root.all().find(node => node.tagName === 'button' && node.textContent === label);

test('panneau : jauges en texte, barre décorative, bouton du rang suivant, aperçu et historique', () => {
    const documentRef = fakeDocument();
    const calls = [];
    const panel = createCareerPanel({
        documentRef, onBuyRank: trigger => calls.push(['buy', trigger.textContent]),
        onChangeCareer: () => calls.push(['change']), onOpenAll: () => calls.push(['all']),
    });
    panel.update({ data: data({ carac: complete().carac }), careers, engine });
    const root = panel.element;
    assert.equal(root.byClass('m-career-title').textContent, 'Pamphlétaire');
    assert.equal(root.byClass('m-career-rank').textContent, 'Rang 1');
    const gauges = root.byClass('m-career-gauges').children;
    assert.deepEqual(gauges.map(li => li.byClass('m-career-gauge-head').children[1].textContent), ['3 / 3', '0 / 8', '0 / 1']);
    assert.equal(gauges[0].byClass('m-career-bar').getAttribute('aria-hidden'), 'true');
    assert.equal(gauges[0].byClass('m-career-fill').style['--gauge'], '100');
    assert.equal(gauges[1].byClass('m-career-fill').style['--gauge'], '0');
    const buy = buttonLabelled(root, 'Passer au rang 2 — 200 XP');
    assert.ok(buy && !buy.hidden);
    assert.equal(root.byClass('m-career-max').hidden, true);
    assert.equal(root.byClass('m-career-summary').textContent, 'Rang 2 · Agitateur');
    assert.ok(root.byClass('m-career-preview-body').all().some(node => node.textContent.includes('Calme')));
    assert.deepEqual(root.byClass('m-career-history-list').children.map(li => li.children.map(node => node.textContent)), [['Agitateur', 'Rang 1 · en cours']]);
    buy.click();
    buttonLabelled(root, 'Changer de carrière').click();
    buttonLabelled(root, 'Toutes les carrières').click();
    assert.deepEqual(calls, [['buy', 'Passer au rang 2 — 200 XP'], ['change'], ['all']]);

    // Rang maximal : plus de bouton ni d'aperçu, le même bouton de changement reste disponible.
    panel.update({ data: data({ rang: '4' }), careers, engine });
    assert.equal(buy.hidden, true);
    assert.equal(root.byClass('m-career-max').hidden, false);
    assert.equal(root.byClass('m-career-preview').hidden, true);
    // Sans carrière reconnue : message, seule la visionneuse reste atteignable.
    panel.update({ data: data({ carriere: 'Inconnue' }), careers, engine });
    assert.equal(root.children[0].hidden, false);
    assert.deepEqual([root.byClass('m-career-card').hidden, buttonLabelled(root, 'Changer de carrière').hidden, buttonLabelled(root, 'Toutes les carrières').hidden], [true, true, false]);
});

function sheetSetup({ gain = 5000, execute, careersData = careers, d = data() } = {}) {
    const documentRef = fakeDocument();
    const announces = [];
    const context = {
        state: { phase: 'ready', data: { ...d, xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: gain }] }, pendingOperationId: null },
        careers: careersData, engine, online: true,
        controller: { executeOnlineCommand: execute || (async () => ({ status: 'confirmed' })), retryPendingCommand: async () => ({ status: 'confirmed' }) },
    };
    const purchase = createPurchaseSheet({ documentRef, getContext: () => context, announce: message => announces.push(message) });
    const change = createCareerChangeSheet({ documentRef, getContext: () => context, onChoose: (spec, trigger) => purchase.open(spec, trigger) });
    const trigger = documentRef.createElement('button');
    return { documentRef, announces, context, purchase, change, trigger };
}

test('volet d’achat d’un rang : récapitulatif, coût, achat envoyé et annoncé', async () => {
    const sent = [];
    const setup = sheetSetup({ execute: async (type, payload) => { sent.push([type, payload]); return { status: 'confirmed' }; } });
    setup.purchase.open({ kind: 'rank', rankMode: 'advanceRank' }, setup.trigger);
    const text = name => setup.purchase.element.byClass(name).textContent;
    assert.equal(text('m-purchase-title'), 'Passer au rang 2');
    assert.equal(text('m-purchase-formula'), 'Agitateur (rang 1) → Agitateur (rang 2 · Agitateur)');
    assert.equal(setup.purchase.element.byClass('m-purchase-stepper').hidden, true);
    assert.equal(text('m-purchase-note'), 'Rang non achevé : 200 XP');
    const buy = setup.purchase.element.all().find(node => /^Acheter/u.test(node.textContent));
    assert.equal(buy.textContent, 'Acheter pour 200 XP');
    buy.click();
    await sleep(0);
    assert.deepEqual(sent, [['purchase', { kind: 'rank', rankMode: 'advanceRank', targetRank: 2, count: 1, expectedCost: 200, catalogVersion: engine.catalogVersion }]]);
    assert.ok(!setup.purchase.element.open);
    assert.deepEqual(setup.announces, ['Agitateur (rang 1) → Agitateur (rang 2 · Agitateur) : achat enregistré']);
    assert.equal(setup.documentRef.activeElement, setup.trigger);
});

test('volet d’achat d’un rang : XP insuffisants et hors ligne désactivent le bouton avec la raison', () => {
    const poor = sheetSetup({ gain: 150 });
    poor.purchase.open({ kind: 'rank', rankMode: 'advanceRank' }, poor.trigger);
    const buy = poor.purchase.element.all().find(node => /^Acheter/u.test(node.textContent));
    assert.ok(buy.disabled);
    assert.match(poor.purchase.element.byClass('m-purchase-reason').textContent, /il manque 50 XP/u);
    poor.context.online = false;
    poor.purchase.update();
    assert.equal(poor.purchase.element.byClass('m-purchase-reason').textContent, 'Achat possible une fois en ligne');
});

test('volet d’achat d’un rang : la cible périmée par le snapshot ne ferme pas en silence', async () => {
    // Le rang acheté invalide sa propre cible (rang suivant) : l'annonce « Achat confirmé » doit quand même venir.
    const setup = sheetSetup({ execute: async () => {
        setup.context.state = { ...setup.context.state, pendingOperationId: 'op-1' };
        return { status: 'awaiting-snapshot' };
    } });
    setup.purchase.open({ kind: 'rank', rankMode: 'advanceRank' }, setup.trigger);
    setup.purchase.element.all().find(node => /^Acheter/u.test(node.textContent)).click();
    await sleep(0);
    assert.ok(setup.purchase.element.open);
    assert.deepEqual(setup.announces, []);
    setup.context.state = { ...setup.context.state, data: { ...setup.context.state.data, rang: '4' }, pendingOperationId: 'op-1' };
    setup.purchase.update();
    assert.ok(!setup.purchase.element.open);
    assert.deepEqual(setup.announces, ['Achat confirmé']);
});

test('volet de changement : rang d’entrée, recherche, ligne bloquée désactivée, choix ouvrant la confirmation', async () => {
    const sent = [];
    const setup = sheetSetup({ execute: async (type, payload) => { sent.push(payload); return { status: 'confirmed' }; } });
    setup.change.open(setup.trigger);
    const root = setup.change.element;
    assert.match(root.byClass('m-purchase-note').textContent, /Coût : 200 XP \(rang actuel non achevé\)/u);
    const rows = () => root.allByClass('m-career-row');
    assert.equal(rows().length, 40);
    assert.match(root.byClass('m-result-count').textContent, /précisez la recherche/u);
    const search = root.all().find(node => node.type === 'search');
    buttonLabelled(root, 'Rang 3').click();
    search.value = 'maitre du savoir de hoeth';
    search.dispatch('input');
    assert.equal(rows().length, 1);
    assert.ok(rows()[0].disabled);
    assert.match(root.byClass('m-apt-detail').textContent, /Prérequis : Mage \(HE\), rang 2 minimum/u);

    search.value = 'artisan';
    search.dispatch('input');
    assert.equal(buttonLabelled(root, 'Rang 3').getAttribute('aria-pressed'), 'true');
    assert.equal(buttonLabelled(root, 'Rang 1').getAttribute('aria-pressed'), 'false');
    const row = rows().find(node => !node.disabled);
    assert.ok(row);
    row.click();
    // Le volet de recherche est fermé, la confirmation d'achat ouverte sur la carrière choisie, focus rendu au bouton d'origine à la fin.
    assert.ok(!root.open);
    assert.ok(setup.purchase.element.open);
    assert.equal(setup.purchase.element.byClass('m-purchase-title').textContent, 'Changer de carrière');
    assert.match(setup.purchase.element.byClass('m-purchase-nature').textContent, /Artisan.* · rang 3/u);
    setup.purchase.element.all().find(node => /^Acheter/u.test(node.textContent)).click();
    await sleep(0);
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].rankMode, sent[0].targetRank, typeof sent[0].careerId, sent[0].expectedCost], ['changeCareer', 3, 'string', 200]);
    assert.equal(setup.documentRef.activeElement, setup.trigger);
});

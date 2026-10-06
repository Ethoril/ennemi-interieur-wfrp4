import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { loadFicheCatalogue } from '../js/mobile/fiche-catalogue.js';
import { topSkills } from '../js/mobile/fiche-model.js';
import { purchaseErrorMessage, purchasePayload, purchasePreview, purchaseTarget } from '../js/mobile/fiche-purchase.js';

const read = path => JSON.parse(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8'));
const catalogue = await loadFicheCatalogue({ load: url => read(`js/${url.replace('../', '')}`) });
const engine = catalogue.getEngine();
const { careers } = catalogue;
const agitateurSkills = careers.find(career => career.nom === 'Agitateur').rangs[0].skills;

const keys = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const data = (carriere, extra = {}) => ({
    carriere, rang: '1', basicSpecs: {}, chosenVariants: {}, careerOverrides: {},
    carac: Object.fromEntries(keys.map(key => [key, { base: 30, adv: 3 }])),
    skillsBasic: { Charme: 3, Esquive: 3, 'Corps à corps (Base)': 3 }, skillsAdvanced: [],
    talentsAcq: [], talentsAvail: [], sorts: [], prieres: [], careers: [],
    xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: 5000 }], ...extra,
});
const rowOf = (d, nom) => ({ kind: 'skill', ...topSkills(d, engine, 200).find(row => row.nom === nom) });

// Le coût prévu doit être celui que le moteur (construit comme l'application) accepte sans « price-changed ».
function assertAgrees(label, d, spec, count, expectInCareer) {
    const target = purchaseTarget(d, engine, careers, spec);
    assert.ok(target, `${label} : cible introuvable`);
    assert.equal(target.inCareer, expectInCareer, `${label} : appartenance à la carrière`);
    const preview = purchasePreview(target, count, 5000);
    const payload = purchasePayload(target, count, engine);
    assert.equal(payload.expectedCost, preview.cost);
    assert.equal(payload.catalogVersion, engine.catalogVersion);
    const applied = engine.applyCommand(globalThis.structuredClone(d), { type: 'purchase', operationId: `op-${label.replace(/[^a-z]/giu, "_")}`, payload }, { uid: 'u', role: 'joueur' });
    assert.equal(applied.result.cost, preview.cost, label);
    assert.equal(applied.data.xpLog.at(-1).cout, preview.cost, label);
    return target;
}

test('le coût prévu égale le coût accepté par le moteur', () => {
    const agitateur = data('Agitateur');
    const noble = data('Noble', { basicSpecs: { 'Corps à corps (Base)': 'Escrime' } });
    assertAgrees('carac carrière', agitateur, { kind: 'carac', key: 'soc' }, 3, true);
    assertAgrees('carac hors carrière', agitateur, { kind: 'carac', key: 'cc' }, 3, false);
    assertAgrees('carac franchit un palier', agitateur, { kind: 'carac', key: 'int' }, 4, true);
    assertAgrees('base carrière', agitateur, rowOf(agitateur, 'Charme'), 4, true);
    assertAgrees('base hors carrière', agitateur, rowOf(agitateur, 'Esquive'), 2, false);
    const escrime = rowOf(noble, 'Corps à corps (Escrime)');
    assert.equal(escrime.row, 'Corps à corps (Base)');
    // Corps à corps (Base) et Corps à corps (Escrime) sont deux compétences distinctes : avancer la ligne de base,
    // même avec la spécialité Escrime, reste hors carrière pour un Noble. L'aperçu suit le serveur.
    assertAgrees('base avec spécialité', noble, escrime, 2, false);
    const savoir = data('Agitateur', { skillsAdvanced: [
        { id: 'a1', nom: 'Savoir (Politique)', carac: 'int', adv: 4 }, { id: 'a2', nom: 'Savoir (Loi)', carac: 'int', adv: 4 },
    ] });
    assertAgrees('avancée carrière', savoir, rowOf(savoir, 'Savoir (Politique)'), 3, true);
    assertAgrees('avancée hors carrière', savoir, rowOf(savoir, 'Savoir (Loi)'), 3, false);
    assertAgrees('talent carrière', agitateur, { kind: 'talent', nom: 'Sociable' }, 1, true);
    assertAgrees('talent hors carrière', agitateur, { kind: 'talent', nom: 'Dur à cuire' }, 1, false);
});

test('une compétence de base absente de skillsBasic reste achetable (targetId omis)', () => {
    const d = data('Agitateur', { skillsBasic: {} });
    const target = assertAgrees('base sans clé', d, { kind: 'skill', row: 'Charme' }, 2, true);
    assert.equal(purchasePayload(target, 2, engine).targetId, undefined);
});

test('une forme reliée est adressée par son identifiant et son nom stocké', () => {
    const resolver = engine.skillResolver;
    const { aliases } = read('js/catalogue/referentiel-public.json').skills;
    const linked = aliases.filter(({ label }) => {
        const resolved = resolver.resolve(label);
        return resolved.status === 'resolved' && resolved.entry.nom !== label && !resolved.entry.basic;
    });
    const inCareer = item => agitateurSkills.includes(resolver.resolve(item.label).entry.nom);
    for (const [alias, expectInCareer] of [[linked.find(inCareer), true], [linked.find(item => !inCareer(item)), false]]) {
        assert.ok(alias, `forme reliée de test introuvable (${expectInCareer})`);
        const d = data('Agitateur', { skillsAdvanced: [{ id: 'linked-1', nom: alias.label, carac: 'int', adv: 4 }] });
        const row = topSkills(d, engine, 200).find(item => item.targetId === 'linked-1');
        assert.notEqual(row.nom, alias.label);
        const target = assertAgrees(`forme reliée ${expectInCareer}`, d, { kind: 'skill', ...row }, 2, expectInCareer);
        assert.deepEqual([target.name, target.targetId], [alias.label, 'linked-1']);
    }
});

test('aperçu : nouveau total, XP restante, solde insuffisant', () => {
    const target = purchaseTarget(data('Agitateur'), engine, careers, { kind: 'carac', key: 'soc' });
    assert.deepEqual(purchasePreview(target, 2, 100), { cost: 50, newTotal: 35, after: 50, affordable: true });
    assert.deepEqual(purchasePreview(target, 2, 49), { cost: 50, newTotal: 35, after: -1, affordable: false });
    const talent = purchaseTarget(data('Agitateur'), engine, careers, { kind: 'talent', nom: 'Dur à cuire' });
    assert.deepEqual(purchasePreview(talent, 1, 250), { cost: 200, newTotal: null, after: 50, affordable: true });
    assert.equal(purchasePayload(talent, 5, engine).count, 1);
});

test('cibles inconnues : null', () => {
    const d = data('Agitateur');
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'carac', key: 'zz' }), null);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'skill', targetId: 'absent' }), null);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'skill', row: 'Inconnue' }), null);
});

test('messages d’erreur', () => {
    const error = (code, kind, details = {}) => Object.assign(new Error('x'), { code, details: { kind, ...details } });
    assert.match(purchaseErrorMessage(error('failed-precondition', 'price-changed', { currentCost: 60 })), /Le coût a changé : 60 XP\. Vérifiez et réessayez\./u);
    assert.match(purchaseErrorMessage(error('failed-precondition', 'insufficient-xp', { cost: 50, balance: 10 })), /50 requis, 10 disponibles/u);
    assert.match(purchaseErrorMessage(error('failed-precondition', 'catalog-version-unsupported')), /Rechargez/u);
    assert.match(purchaseErrorMessage(error('aborted', 'conflict')), /changé entre-temps/u);
    assert.match(purchaseErrorMessage(error('permission-denied')), /droit/u);
    assert.match(purchaseErrorMessage(error('unavailable')), /Réessayer/u);
    assert.match(purchaseErrorMessage(new Error('?')), /Achat impossible/u);
});

test('talent à spécialité : nom composé, coût prévu égal au coût accepté par le moteur', () => {
    const agitateur = data('Agitateur', { rang: '4' });
    const slot = 'Savoir-vivre (au choix)';
    const unpicked = purchaseTarget(agitateur, engine, careers, { kind: 'talent', nom: slot });
    assert.equal(unpicked.needsChoice, true);
    assert.ok(unpicked.choice.free && unpicked.choice.specs.includes('Guilde'));
    assert.throws(() => purchasePayload(unpicked, 1, engine), /Spécialité du talent à choisir/u);

    for (const [pick, label] of [['Guilde', 'liste'], ['  Nains (Karaz) ', 'texte libre']]) {
        const target = assertAgrees(`savoir-vivre ${label}`, agitateur, { kind: 'talent', nom: slot, pick }, 1, true);
        assert.equal(target.needsChoice, false);
        assert.equal(target.name, `Savoir-vivre (${pick.replace(/[()]/gu, '').trim()})`);
        assert.equal(purchasePayload(target, 1, engine).name, target.name);
    }
    // Une spécialité déjà acquise reste achetable (le serveur accepte plusieurs prises) et est signalée.
    const twice = data('Agitateur', { rang: '4', talentsAcq: [{ id: 't1', nom: 'Savoir-vivre (Guilde)' }] });
    const again = assertAgrees('savoir-vivre repris', twice, { kind: 'talent', nom: slot, pick: 'Guilde' }, 1, true);
    assert.equal(again.taken, 1);
    assert.equal(again.choice.options.find(({ spec }) => spec === 'Guilde').taken, 1);
    assert.equal(twice.talentsAcq.length, 1);
});

test('talent « A ou B » : seuls les choix listés sont acceptés, tarif identique au serveur', () => {
    const artisan = data('Artisan', { rang: '4' });
    const slot = 'Sens aiguisé (Goût ou Toucher)';
    const target = purchaseTarget(artisan, engine, careers, { kind: 'talent', nom: slot });
    assert.deepEqual([target.choice.free, target.choice.specs, target.needsChoice], [false, ['Goût', 'Toucher'], true]);
    // Une saisie hors liste n'est pas un choix.
    assert.equal(purchaseTarget(artisan, engine, careers, { kind: 'talent', nom: slot, pick: 'Odorat' }).needsChoice, true);
    const picked = purchaseTarget(artisan, engine, careers, { kind: 'talent', nom: slot, pick: 'Toucher' });
    assert.equal(picked.name, 'Sens aiguisé (Toucher)');
    // Le serveur tarife le nom composé : même résultat que l'aperçu, quel que soit le rattachement à la carrière.
    assertAgrees('sens aiguisé', artisan, { kind: 'talent', nom: slot, pick: 'Toucher' }, 1, true);
    // Option listée = talent de carrière (100 XP) ; le serveur et l'aperçu s'accordent.
    assert.equal(picked.inCareer, true);
    assert.equal(purchasePreview(picked, 1, 5000).cost, 100);
    // Hors liste : rangs du Rang 3 de l'Artisan, un autre sens reste hors carrière (200 XP).
    const sense = { kind: 'talent', nom: 'Sens aiguisé (Odorat)' };
    assertAgrees('sens hors liste', artisan, sense, 1, false);
});

test('achèvement de rang : une option choisie d’une alternative compte comme talent du rang', () => {
    const r3 = data('Artisan', { rang: '3' });
    const withTalent = nom => engine.evaluateCareerCompletion({ ...r3, talentsAcq: [{ id: 't', nom }] }, careers.find(c => c.nom === 'Artisan'), 3);
    assert.equal(withTalent('Sens aiguisé (Goût)').hasTalent, true);
    assert.equal(withTalent('Sens aiguisé (Odorat)').hasTalent, false);
    assert.equal(withTalent('Bricoleur').hasTalent, true);
});

// Sorts (mineur, domaine avec palier) et miracle : l'aperçu égale le coût accepté par le moteur, le payload est exact.
const unique = (rules, ok) => rules.filter(rule => ok(rule) && rules.filter(other => other.nom === rule.nom).length === 1);
const spells = engine.ruleCatalog.spells;
const petty = unique(spells, rule => /mineur|petite magie/iu.test(rule.type))[0];
const aqshy = unique(spells, rule => rule.type.startsWith('Aqshy'));
const asKnown = rule => ({ id: `k-${rule.nom}`, nom: rule.nom, vent: 'Aqshy', cn: rule.cn });

test('sort mineur : coût 50 prévu = coût accepté, payload exact', () => {
    const d = data('Agitateur');
    const target = purchaseTarget(d, engine, careers, { kind: 'sort', nom: petty.nom });
    assert.deepEqual([target.kind, target.name, target.maxCount, target.newTotal], ['sort', petty.nom, 1, undefined]);
    assert.equal(purchasePreview(target, 1, 5000).newTotal, null);
    const payload = purchasePayload(target, 1, engine);
    assert.deepEqual(payload, { kind: 'sort', name: petty.nom, count: 1, expectedCost: 50, catalogVersion: engine.catalogVersion });
    const applied = engine.applyCommand(globalThis.structuredClone(d), { type: 'purchase', operationId: 'op-petty', payload }, { uid: 'u', role: 'joueur' });
    assert.equal(applied.result.cost, 50);
    assert.equal(applied.data.sorts.at(-1).nom, petty.nom);
    assert.equal(target.description[0].startsWith('NI '), true);
});

test('sort de domaine : palier selon les sorts connus du même domaine, mineurs exclus du décompte', () => {
    const known = aqshy.slice(0, 6).map(asKnown);
    for (const [label, sorts, expected] of [['aucun connu', [], 100], ['six connus', known, 200], ['six connus + un mineur', [...known, asKnown(petty)], 200]]) {
        const d = data('Agitateur', { sorts });
        const target = purchaseTarget(d, engine, careers, { kind: 'sort', nom: aqshy[6].nom });
        assert.equal(target.cost, expected, label);
        const payload = purchasePayload(target, 1, engine);
        const applied = engine.applyCommand(globalThis.structuredClone(d), { type: 'purchase', operationId: `op-${label.length}`, payload }, { uid: 'u', role: 'joueur' });
        assert.equal(applied.result.cost, purchasePreview(target, 1, 5000).cost, label);
        assert.equal(applied.result.cost, expected, label);
    }
});

test('miracle : coût prévu = coût accepté, les bénédictions ne comptent pas', () => {
    const [miracle, second] = engine.ruleCatalog.miracles;
    const prieres = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, nom: `Miracle ${index}`, type: 'Miracle' }));
    for (const [label, extra, expected] of [['aucun', [], 100], ['six miracles', prieres, 200],
        ['six miracles + bénédictions', [...prieres, ...Array.from({ length: 5 }, (_, index) => ({ id: `b${index}`, nom: `Bénédiction ${index}`, type: 'Bénédiction' }))], 200]]) {
        const d = data('Agitateur', { prieres: extra });
        const target = purchaseTarget(d, engine, careers, { kind: 'miracle', nom: miracle.nom });
        const payload = purchasePayload(target, 1, engine);
        assert.deepEqual(payload, { kind: 'miracle', name: miracle.nom, count: 1, expectedCost: expected, catalogVersion: engine.catalogVersion });
        const applied = engine.applyCommand(globalThis.structuredClone(d), { type: 'purchase', operationId: `op-m${expected}${extra.length}`, payload }, { uid: 'u', role: 'joueur' });
        assert.equal(applied.result.cost, purchasePreview(target, 1, 5000).cost, label);
        assert.equal(applied.result.cost, expected, label);
    }
    assert.ok(second);
});

test('sort ou miracle : introuvable, ambigu ou déjà connu = pas de cible', () => {
    const d = data('Agitateur');
    const ambiguous = spells.find(rule => spells.filter(other => other.nom === rule.nom).length > 1);
    assert.ok(ambiguous);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'sort', nom: ambiguous.nom }), null);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'sort', nom: 'Inconnu' }), null);
    assert.equal(purchaseTarget(d, engine, careers, { kind: 'miracle', nom: petty.nom }), null);
    const owned = data('Agitateur', { sorts: [asKnown(petty)] });
    assert.equal(purchaseTarget(owned, engine, careers, { kind: 'sort', nom: petty.nom.toUpperCase() }), null);
});

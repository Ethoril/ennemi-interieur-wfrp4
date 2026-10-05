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
    // Le serveur adresse cette ligne par « Groupe (Base) (Spé) », nom que le référentiel ne résout pas : tarif hors carrière,
    // même pour Escrime chez un Noble. L'aperçu doit suivre le serveur, pas l'intuition.
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

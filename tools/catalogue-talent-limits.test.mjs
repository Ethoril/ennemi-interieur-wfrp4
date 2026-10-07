import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { createPublishedCatalogueEngine } from '../js/fiche/published-catalogue-engine.js';
import { parseTalentLimit, ARCANE_WINDS } from '../js/catalogue/talent-source.js';
import { talentChoices, talentRows, talentTaken, learnRows, spellRows } from '../js/mobile/fiche-aptitudes-model.js';
import { purchasePayload, purchaseTarget } from '../js/mobile/fiche-purchase.js';
import { blessuresMax } from '../js/fiche/derived.js';
import { isTalentInCareer, getEffectiveTalents, isCaracInCareer, findCareerByName } from '../js/fiche/career-model.js';
import { xpBandCost, CARAC_XP_BANDS } from '../js/fiche/xp.js';
import { cancelErrorMessage } from '../js/mobile/fiche-purchase.js';
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const careers = read('js/data/careers.json');
const skills = read('js/data/skills.json');
const spells = read('js/data/fiche-catalog.json');
const snapshot = read('js/catalogue/talents-sheet-snapshot.json');
const catalogue = read('js/catalogue/referentiel-public.json');
const engine = { ...createPublishedCatalogueEngine({ catalogue, careers, skills, spells, talentSheetSnapshot: snapshot }), ruleCatalog: spells };
const data = extra => ({ race: 'humain', carriere: 'Agitateur', rang: '4',
    carac: Object.fromEntries(['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'].map(key => [key, { base: 30, adv: 0 }])),
    talentsAcq: [], talentsAvail: [], sorts: [], prieres: [], skillsBasic: {}, skillsAdvanced: [], careers: [],
    chosenVariants: {}, careerOverrides: {}, xpLog: [{ id: 'gain', kind: 'gain', montant: 10000 }], ...extra });
let sequence = 0;
const buy = (state, name, pick) => {
    const target = purchaseTarget(state, engine, careers, { kind: 'talent', nom: name, pick });
    return engine.applyCommand(state, { type: 'purchase', operationId: `talent-${++sequence}`,
        payload: purchasePayload(target, 1, engine) }, { uid: 'mj', role: 'mj' });
};
const status = (state, name) => engine.talentResolver.purchaseStatus(state, name);

test('chaque marqueur du Drive, y compris une alternative, reste une option à compléter', () => {
    for (const entry of snapshot.entries.filter(row => row.specializationLabel)) {
        for (const marker of [entry.specializationLabel, `${entry.specializationLabel} au choix`]) {
            for (const name of [`${entry.nom} [${marker}]`, `${entry.nom} (${marker})`]) {
                assert.equal(engine.resolveTalent(name).open, true, name);
                assert.equal(status(data(), name).allowed, false, name);
                assert.ok(talentChoices(careers, data(), name, engine), name);
                assert.throws(() => engine.applyCommand(data(), {type: 'purchase', operationId: `marker-${++sequence}`,
                    payload: {kind: 'talent', name, count: 1, expectedCost: 200, catalogVersion: engine.catalogVersion}},
                {uid: 'mj', role: 'mj'}), /spécialité/iu);
            }
        }
    }
    for (const [base, pick] of [['Rancune Ancestrale', 'Elfes noirs'], ["Sang d'Aenarion", 'Prodige martial'], ['Magie des Runes de Maître', 'Rune majeure de défense']]) {
        const acquired = buy(data(), base, pick).data;
        assert.equal(acquired.talentsAcq.at(-1).nom, `${engine.resolveTalent(base).entry.nom} (${pick})`);
    }
});

test('Béni (Isha) est le talent Béni par Isha et bloque sa seconde acquisition', () => {
    for (const name of ['Béni (Isha)', 'Béni [Isha]', 'béni (isha)']) {
        const resolved = engine.resolveTalent(name);
        assert.equal(resolved.entry.englishName, 'Blessed by Isha');
        assert.equal(resolved.displayedName, 'Béni par Isha');
        const state = data({talentsAcq: [{id: 'old', nom: name}]});
        assert.equal(status(state, 'Béni par Isha').reached, true);
        assert.throws(() => buy(state, 'Béni par Isha'), /Limite atteinte/u);
    }
    assert.equal(engine.resolveTalent('Béni (Sigmar)').entry.englishName, 'Bless');
});

test('les apostrophes partagent aussi le compteur et les lignes mobiles de spécialité', () => {
    const state = data({talentsAcq: [{id: 'a', nom: "Sans peur (L'armée)"}, {id: 'b', nom: 'Sans peur (L’armée)'}]});
    assert.equal(talentTaken(state, engine, "Sans peur (L'armee)"), 2);
    const rows = talentRows(state, engine, []);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 2);
});

test('les cinq marqueurs ajoutés exigent une spécialité et ne peuvent être achetés tels quels', () => {
    for (const marker of ['Cause', 'Vent', 'Rune', 'Groupe social', 'Cible']) {
        const entry = snapshot.entries.find(row => row.specializationLabel === marker);
        assert.ok(entry, marker);
        for (const name of [`${entry.nom} [${marker}]`, `${entry.nom} (${marker})`]) {
            assert.equal(engine.resolveTalent(name).open, true, name);
            assert.equal(status(data(), name).allowed, false, name);
            assert.throws(() => buy(data(), name), /spécialité/iu);
            const state = data(), before = globalThis.structuredClone(state);
            assert.throws(() => engine.applyCommand(state, { type: 'purchase', operationId: `placeholder-${++sequence}`,
                payload: { kind: 'talent', name, count: 1, expectedCost: 200, catalogVersion: engine.catalogVersion } },
            { uid: 'mj', role: 'mj' }), /spécialité/iu);
            assert.deepEqual(state, before);
        }
    }
});

test('29 anciens libellés partagent leur compteur et leur tarif de carrière avec le nom du Drive', () => {
    const aliases = snapshot.legacyAliases.filter(row => row.provenance === 'correspondance-explicite-anciens-libelles-carrieres-2026-10-07');
    assert.equal(aliases.length, 29);
    for (const alias of aliases) {
        const resolved = engine.resolveTalent(alias.label);
        assert.equal(resolved.entry.englishName, alias.englishName, alias.label);
        const state = data({ talentsAcq: [{ id: 'old', nom: alias.label }] });
        assert.equal(status(state, resolved.entry.nom).totalTaken, 1, alias.label);
        const career = { id: 'alias-test', rangs: [{ rang: 1, talents: [alias.label] }] };
        assert.equal(isTalentInCareer(career, 1, resolved.entry.nom, {}, {}, engine.talentResolver), true, alias.label);
        const limit = status(state, resolved.entry.nom).max;
        if (Number.isFinite(limit)) {
            state.talentsAcq = Array.from({ length: limit }, (_, n) => ({ id: `old-${n}`, nom: alias.label }));
            assert.equal(status(state, resolved.entry.nom).reached, true, alias.label);
            const name = resolved.entry.specializationLabel ? `${resolved.entry.nom} (Option réelle)` : resolved.entry.nom;
            assert.throws(() => buy(state, name), /Limite atteinte/u);
        }
    }
    assert.equal(engine.resolveTalent('Maître artisan').entry.englishName, 'Craftsman');
});

test('les deux rapprochements sans preuve restent des noms historiques sans règle d’achat', () => {
    for (const name of ['Vivant', 'Bon sens']) {
        const state = data({talentsAcq: [{id: 'old', nom: name}]});
        const before = globalThis.structuredClone(state);
        assert.equal(status(state, name).known, false);
        assert.throws(() => buy(state, name), /limite inconnue/u);
        assert.deepEqual(state, before);
        assert.equal(talentRows(state, engine, [])[0].nom, name);
    }
});

test('annuler une avance ne peut créer ni aggraver un dépassement de plafond par Bonus', () => {
    const entry = snapshot.entries.find(row => parseTalentLimit(row.limitText).kind === 'bonus' && !row.specializationLabel);
    const carac = parseTalentLimit(entry.limitText).caracs[0];
    const initial = data();
    initial.carac[carac].base = 29;
    const raised = engine.applyCommand(initial, {type: 'purchase', operationId: `bonus-${++sequence}`,
        payload: {kind: 'carac', name: carac, count: 1, expectedCost: xpBandCost(CARAC_XP_BANDS, 0, 1,
            isCaracInCareer(findCareerByName(careers, initial.carriere), 4, carac)), catalogVersion: engine.catalogVersion}},
    {uid: 'joueur', role: 'joueur'}).data;
    const purchaseId = raised.xpLog.at(-1).purchaseId;
    raised.talentsAcq = Array.from({length: status(raised, entry.nom).max}, (_, n) => ({id: `old-${n}`, nom: entry.nom}));
    const before = globalThis.structuredClone(raised);
    for (const role of ['mj', 'joueur']) {
        assert.throws(() => engine.applyCommand(raised, {type: 'cancel', operationId: `refuse-${++sequence}`, payload: {purchaseId}},
            {uid: 'joueur', role}), error => error.details.kind === 'cancel-talent-limit'
                && /plafond/u.test(cancelErrorMessage(error)));
        assert.deepEqual(raised, before);
    }
    raised.talentsAcq.push({id: 'historical-over', nom: entry.nom});
    assert.throws(() => engine.applyCommand(raised, {type: 'cancel', operationId: `aggrave-${++sequence}`, payload: {purchaseId}},
        {uid: 'joueur', role: 'mj'}), error => error.details.kind === 'cancel-talent-limit');
    raised.talentsAcq = raised.talentsAcq.slice(0, 1);
    const cancelled = engine.applyCommand(raised, {type: 'cancel', operationId: `allowed-${++sequence}`, payload: {purchaseId}},
        {uid: 'joueur', role: 'mj'});
    assert.equal(cancelled.data.carac[carac].adv, 0);
    assert.equal(cancelled.result.refunded, raised.xpLog.at(-1).cout);
});

test('Tout et Tous désignent une seule spécialité de Sans peur', () => {
    const state = data({ talentsAcq: [{ id: 'old', nom: 'Sans peur (Tout)' }] });
    assert.equal(engine.resolveTalent('Sans peur (Tout)').purchaseName, 'Sans peur (Tous)');
    assert.equal(status(state, 'Sans peur [Tous]').taken, 1);
    assert.equal(status(state, 'Fearless (Everything)').taken, 1);
    assert.equal(status(state, 'Sans peur [Tous]').allowed, false);
    assert.throws(() => buy(state, 'Sans peur (Tous)'), /déjà été acquise/u);
});

test('accent et apostrophe ne changent ni le tarif de carrière ni un retrait de talent', () => {
    const career = { id: 'punctuation', rangs: [{ rang: 1, talents: ["Talent (L’armée)"] }] };
    assert.equal(isTalentInCareer(career, 1, "talent (l'armee)"), true);
    assert.deepEqual(getEffectiveTalents(career, 1, career.rangs[0], { punctuation: { 1: { talentsRemoved: ["talent (l'armee)"] } } }), []);
    const state = data({ careerOverrides: { agitateur: { 4: { talentsAdded: ['Sans peur (L’armée)'] } } } });
    assert.equal(buy(state, "Sans peur (l'armee)").result.cost, 100);
});

test('les 206 descriptions ont un plafond interprétable et les carrières se résolvent en français', () => {
    assert.equal(snapshot.entries.length, 206);
    for (const entry of snapshot.entries) { assert.ok(entry.description); assert.ok(parseTalentLimit(entry.limitText)); }
    for (const career of careers) for (const rank of career.rangs) for (const name of rank.talents) {
        const resolved = engine.resolveTalent(name);
        assert.equal(resolved.sourceRule, true, `${career.nom}: ${name}`);
        assert.ok(resolved.description);
        assert.equal(resolved.displayedName.includes(`(${resolved.entry.englishName})`), false);
    }
    assert.equal(engine.resolveTalent('Sapeur').entry.englishName, 'Underminer');
    assert.equal(engine.resolveTalent('Démolisseur').entry.englishName, 'Demolisher');
    assert.equal(engine.resolveTalent('Vision sacrée').entry.id, engine.resolveTalent('Visions sacrées').entry.id);
    assert.equal(engine.resolveTalent('Acute Sense (Sight)').displayedName, 'Sens aiguisé [Vue]');
    assert.equal(engine.resolveTalent('Sens aiguisé').displayedName, 'Sens aiguisé [Sens]');
});

for (const limit of [1, 2, 3, 4]) test(`plafond ${limit} : serveur, refus sans mutation et prix fixe`, () => {
    const entry = snapshot.entries.find(row => row.limitText === String(limit) && !row.specializationLabel && row.englishName !== 'Hardy');
    let state = data();
    for (let n = 0; n < limit; n++) {
        const applied = buy(state, entry.nom); state = applied.data;
        assert.ok([100, 200].includes(applied.result.cost));
    }
    const before = globalThis.structuredClone(state);
    assert.equal(status(state, entry.englishName).allowed, false);
    assert.throws(() => buy(state, entry.nom), /Limite atteinte/u);
    assert.deepEqual(state, before);
});

test('bonus de caractéristiques, somme des bonus, et plafond réévalué après une avance', () => {
    for (const entry of snapshot.entries.filter(row => parseTalentLimit(row.limitText).kind === 'bonus')) {
        const rule = parseTalentLimit(entry.limitText), state = data();
        const name = entry.specializationLabel ? `${entry.nom} (Choix précis)` : entry.nom;
        for (const carac of rule.caracs) state.carac[carac] = { base: 29, adv: 0 };
        const max = 2 * rule.caracs.length;
        state.talentsAcq = Array.from({ length: max }, (_, n) => ({ id: `old-${n}`, nom: name }));
        assert.equal(status(state, name).max, max);
        assert.equal(status(state, name).allowed, false);
        state.carac[rule.caracs[0]].adv = 1;
        assert.equal(status(state, name).max, max + 1);
        assert.equal(status(state, name).allowed, true);
    }
    assert.throws(() => parseTalentLimit('à deviner'), /non reconnue/u);
});

test('une spécialité déjà acquise disparaît, FR/EN et crochets comptent la même prise', () => {
    const state = data({ talentsAcq: [{ id: 'old', nom: 'Acute Sense (Sight)' }] });
    assert.equal(status(state, 'Sens aiguisé [Vue]').allowed, false);
    assert.equal(status(state, 'Sens aiguisé [Goût]').allowed, true);
    const applied = buy(state, 'Sens aiguisé (au choix)', 'Goût');
    assert.equal(applied.data.talentsAcq.at(-1).nom, 'Sens aiguisé (Goût)');
    assert.deepEqual(applied.data.talentsAcq[0], state.talentsAcq[0]);
    assert.throws(() => buy(applied.data, 'Sens aiguisé [Goût]'), /déjà été acquise/u);
});

test('les Elfes ont huit Vents, une prise par Vent, et Qhaysh séparé une fois', () => {
    for (const race of ['haut-elfe', 'elfe-sylvain', 'elfe']) {
        let state = data({ race, carriere: 'Mage (HE)', rang: '3' });
        for (const wind of ARCANE_WINDS) state = buy(state, 'Magie des Arcanes', wind).data;
        assert.throws(() => buy(state, 'Magie des Arcanes (Aqshy)'), /déjà été acquise|Limite atteinte/u);
        const choices = talentChoices(careers, state, 'Magie des Arcanes', engine);
        assert.deepEqual(choices.specs, ['Qhaysh']);
        state = buy(state, 'Magie des Arcanes', 'Qhaysh').data;
        assert.equal(state.talentsAcq.length, 9);
        assert.throws(() => buy(state, 'Magie des Arcanes (Qhaysh)'), /Limite atteinte/u);
        assert.equal(status(state, 'Magie des Arcanes').reached, true);
    }
    const human = buy(data(), 'Magie des Arcanes', 'Aqshy').data;
    assert.throws(() => buy(human, 'Magie des Arcanes (Ghyran)'), /Limite atteinte/u);
});

test('Hellaya : deux acquisitions précisées laissent exactement six Vents et Qhaysh', () => {
    const state = data({ race: 'haut-elfe', talentsAcq: [{ id: 'a', nom: 'Magie des Arcanes [Aqshy]' }, { id: 'b', nom: 'Magie des Arcanes [Ghyran]' }] });
    assert.deepEqual(talentChoices(careers, state, 'Magie des Arcanes', engine).specs,
        ['Azyr', 'Chamon', 'Ghur', 'Hysh', 'Shyish', 'Ulgu', 'Qhaysh']);
    assert.equal(status(state, 'Magie des Arcanes (Aqshy - Feu)').allowed, false);
});

test('anciennes prises et XP intacts ; doublons signalés, inconnus bloqués', () => {
    const state = data({ talentsAcq: [{ id: 'a', nom: 'Tir précis' }, { id: 'b', nom: 'tir précis' }, { id: 'c', nom: 'Talent personnalisé' }] });
    const before = globalThis.structuredClone(state);
    const rows = talentRows(state, engine, careers);
    assert.match(rows.find(row => row.nom === 'Tir précis').issue, /historiques/u);
    assert.throws(() => buy(state, 'Tir précis'), /Limite atteinte/u);
    assert.throws(() => buy(state, 'Talent personnalisé'), /limite inconnue/u);
    assert.deepEqual(state, before);
});

test('aucun nouveau bonus automatique ; Hardy conserve son calcul et prévient le MJ', () => {
    const state = data(), affable = buy(state, 'Affable');
    assert.deepEqual(affable.data.carac, state.carac);
    const hardy = buy(state, 'Dur à cuire').data;
    assert.equal(blessuresMax(hardy) - blessuresMax(state), 3);
    assert.match(status(state, 'Dur à cuire').warning, /déjà prises en compte/u);
});

test('annuler une prise rouvre le plafond sans réécrire son coût historique', () => {
    const applied = buy(data(), 'Lire/Écrire');
    assert.equal(applied.result.cost, 100);
    const purchaseId = applied.data.xpLog.at(-1).purchaseId;
    const cancelled = engine.applyCommand(applied.data, { type: 'cancel', operationId: `cancel-${++sequence}`, payload: { purchaseId } }, { uid: 'mj', role: 'mj' });
    assert.equal(status(cancelled.data, 'Read/Write').allowed, true);
    assert.equal(cancelled.data.xpLog.find(row => row.purchaseId === purchaseId).cout, 100);
    assert.equal(buy(cancelled.data, 'Read/Write').result.cost, 100);
});

test('sort renommé : achat en double refusé ; sorts retirés conservés et exclus des achats', () => {
    const state = data({ sorts: [{ id: 'old', nom: 'Sanguine Swords', vent: 'Aqshy', cn: 8 }] });
    assert.equal(learnRows(engine, state, 'sort', { query: 'epées sanguines' }).length, 0);
    for (const name of ['Couronne de Flammes', 'L’Or des fous', 'Fauche-démon']) {
        assert.equal(learnRows(engine, state, 'sort', { query: name }).length, 0);
        assert.throws(() => engine.applyCommand(state, { type: 'purchase', operationId: `spell-${++sequence}`,
            payload: { kind: 'sort', name, count: 1, expectedCost: 100, catalogVersion: engine.catalogVersion } }, { uid: 'mj', role: 'mj' }), /retiré/u);
    }
    assert.equal(state.sorts[0].nom, 'Sanguine Swords');
    const displayed = spellRows(state, engine).spells[0];
    const rule = spells.spells.find(row => row.nom === 'Epées Sanguines');
    assert.equal(displayed.nom, rule.nom);
    assert.equal(displayed.resume, rule.desc);
    assert.ok(displayed.details.some(([label, value]) => label === 'Cible' && value === rule.cible));
});

test('domaines anglais et alternatives fermées : identité et tarif de carrière préservés', () => {
    assert.equal(engine.resolveTalent('Arcane Magic (Lore of Metal)').purchaseName, 'Magie des Arcanes (Chamon)');
    assert.equal(engine.resolveTalent('Arcane Magic (Beasts or Heavens)').displayedName, 'Magie des Arcanes [Ghur ou Azyr]');
    const state = data({ carriere: 'Oracle', rang: '3' });
    assert.equal(buy(state, 'Magie des Arcanes (Ghur ou Azyr)', 'Azyr').result.cost, 100);
    assert.equal(buy(state, 'Magie des Arcanes (Ghur)').result.cost, 100);
    assert.equal(buy(state, 'Magie des Arcanes (Chamon)').result.cost, 200);
    assert.equal(status(state, 'Magie des Arcanes (Ghur ou Azyr)').allowed, false);
});


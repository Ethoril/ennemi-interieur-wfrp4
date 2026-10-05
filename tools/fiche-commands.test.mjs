import test from 'node:test';
import assert from 'node:assert/strict';

import { createFicheCommandEngine, FicheCommandError, evaluateCareerCompletion } from '../js/fiche/commands.js';

const PLAYER = { uid: 'player-1', role: 'joueur' };
const MJ = { uid: 'mj-1', role: 'mj' };
const catalogVersion = 'rules-2026-10-04';
const clone = value => JSON.parse(JSON.stringify(value));

function careerFixture() {
    return {
        id: 'career-a', nom: 'Carrière A', carac: ['cc'], rangs: [
            { rang: 1, titre: 'Rang 1', caracs: ['cc'], skills: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage', 'Ragot'], talents: ['Résistance'] },
            { rang: 2, titre: 'Rang 2', caracs: ['fm'], skills: ['Orientation'], talents: ['Vigilance'] },
        ],
    };
}

function fixture(overrides = {}) {
    const career = careerFixture();
    const data = {
        nom: 'Test', race: 'humain', carriere: career.nom, rang: 1,
        carac: { cc: { base: 30, adv: 4 }, ct: { base: 30, adv: 0 }, f: { base: 30, adv: 0 }, e: { base: 30, adv: 0 }, i: { base: 30, adv: 0 }, ag: { base: 30, adv: 0 }, dex: { base: 30, adv: 0 }, int: { base: 30, adv: 0 }, fm: { base: 30, adv: 0 }, soc: { base: 30, adv: 0 } },
        skillsBasic: { Esquive: 0, Athlétisme: 0, Calme: 0, Charme: 0, Intuition: 0, Perception: 0, Marchandage: 0, Ragot: 0 },
        skillsAdvanced: [], careers: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [],
        xpLog: [{ id: 'gain-start', kind: 'gain', montant: 500, raison: 'Départ' }],
        basicSpecs: {}, chosenVariants: {}, careerOverrides: {},
    };
    Object.assign(data, overrides);
    return { career, data };
}

function engine(options = {}) {
    return createFicheCommandEngine({ careers: [careerFixture()], skills: [], spells: { spells: [], miracles: [] }, catalogVersion, ...options });
}

function command(type, payload, operationId = 'op-1') {
    return { type, operationId, payload };
}

function assertError(promise, code, kind) {
    return assert.rejects(promise, error => error instanceof FicheCommandError
        && error.code === code && (kind === undefined || error.details?.kind === kind));
}

test('achat caractéristique recalcule le coût de carrière, le solde et conserve les champs', () => {
    const { data } = fixture({ possessions: 'épée', customSpecs: { Métier: ['Forge'] } });
    const before = clone(data);
    const result = engine().applyCommand(data, command('purchase', {
        kind: 'carac', name: 'cc', targetId: 'cc', count: 2, expectedCost: 55, catalogVersion,
    }), PLAYER);
    assert.equal(data.carac.cc.adv, 4);
    assert.equal(result.data.carac.cc.adv, 6);
    assert.equal(result.data.possessions, 'épée');
    assert.deepEqual(result.data.customSpecs, { Métier: ['Forge'] });
    assert.deepEqual(data, before);
    assert.equal(result.data.xpLog.at(-1).origin, 'command');
    assert.equal(result.data.xpLog.at(-1).actorUid, PLAYER.uid);
    assert.equal(result.data.xpLog.at(-1).purchaseId, 'op-1:purchase');
    assert.deepEqual(result.data.xpLog.at(-1).effects[0], { path: 'carac.cc.adv', before: 4, after: 6 });
});

test('prix périmé, solde insuffisant et count invalide refusent sans mutation', async () => {
    const { data } = fixture();
    const before = clone(data);
    const mismatched = engine().applyCommand(data, command('purchase', {
        kind: 'carac', name: 'cc', count: 1, expectedCost: 25, catalogVersion,
    }), PLAYER);
    assert.equal(mismatched.data.carac.cc.adv, 5);
    await assertError(Promise.resolve().then(() => engine().applyCommand(data, command('purchase', {
        kind: 'carac', name: 'cc', count: 1, expectedCost: 26, catalogVersion,
    }), PLAYER)), 'failed-precondition', 'price-changed');
    await assertError(Promise.resolve().then(() => engine().applyCommand(data, command('purchase', {
        kind: 'carac', name: 'ct', count: 1, expectedCost: 49, catalogVersion,
    }), PLAYER)), 'failed-precondition', 'price-changed');
    await assertError(Promise.resolve().then(() => engine().applyCommand({ ...data, xpLog: [] }, command('purchase', {
        kind: 'carac', name: 'ct', count: 1, expectedCost: 50, catalogVersion,
    }), PLAYER)), 'failed-precondition', 'insufficient-xp');
    for (const count of [0, -1, 1.5, '2', 101]) {
        await assertError(Promise.resolve().then(() => engine().applyCommand(data, command('purchase', {
            kind: 'carac', name: 'cc', count, expectedCost: 0, catalogVersion,
        }), PLAYER)), 'invalid-argument');
    }
    assert.deepEqual(data, before);
});

test('le contrôle de solde inclut la dernière dépense déjà inscrite au journal', () => {
    const { data } = fixture({ xpLog: [
        { id: 'gain', kind: 'gain', montant: 500 },
        { id: 'last-spend', kind: 'purchase', cout: 490, applied: true },
    ] });
    assert.throws(() => engine().applyCommand(data, command('purchase', {
        kind: 'carac', name: 'cc', count: 1, expectedCost: 25, catalogVersion,
    }), PLAYER), error => error.details?.kind === 'insufficient-xp' && error.details.balance === 10);
});

test('achat de compétence distingue la ligne de base, canonise les spécialités et crée une ligne stable', () => {
    const { data } = fixture();
    const result = engine().applyCommand(data, command('purchase', {
        kind: 'skill', name: 'Savoir (Art de la guerre)', count: 2, expectedCost: 40, catalogVersion,
    }), PLAYER);
    const row = result.data.skillsAdvanced[0];
    assert.equal(row.id, 'op-1:skill');
    assert.equal(row.nom, 'Savoir (Guerre)');
    assert.equal(row.carac, 'int');
    assert.equal(row.adv, 2);
    assert.equal(result.data.xpLog.at(-1).targetStorage, 'skillsAdvanced');
});

test('coûts des talents et des sorts/miracles viennent du moteur et du snapshot', async () => {
    const { data } = fixture({ xpLog: [{ kind: 'gain', montant: 1000 }] });
    const fullRules = {
        spells: [
            { nom: 'Sort mineur A', type: 'Mineur', ni: 0, portee: 'Toucher', duree: 'Instantanée', description: 'Effet.' },
            { nom: 'Sort mineur B', type: 'Petite magie', ni: 0, portee: '', duree: '', description: 'Effet.' },
            { nom: 'Sort Aqshy', type: 'Aqshy', ni: 1, portee: '10 mètres', duree: 'Une minute', description: 'Une ligne.\n\nLe reste.' },
        ],
        miracles: [{ nom: 'Bénédiction de test', portee: 'Toucher', cible: 'Allié', duree: 'Instantanée', effet: 'Lumière.' }],
    };
    const rulesEngine = engine({ spells: fullRules });
    const pettyOne = rulesEngine.applyCommand(data, command('purchase', { kind: 'sort', name: 'Sort mineur A', count: 1, expectedCost: 50, catalogVersion }, 'spell-1'), PLAYER);
    const pettyTwo = rulesEngine.applyCommand(pettyOne.data, command('purchase', { kind: 'sort', name: 'Sort mineur B', count: 1, expectedCost: 50, catalogVersion }, 'spell-2'), PLAYER);
    assert.equal(pettyTwo.data.sorts[1].vent, 'Magie Commune');
    const spell = rulesEngine.applyCommand(pettyTwo.data, command('purchase', { kind: 'sort', name: 'Sort Aqshy', count: 1, expectedCost: 100, catalogVersion }, 'spell-3'), PLAYER);
    assert.equal(spell.data.sorts[2].resume, 'Une ligne.');
    const miracle = rulesEngine.applyCommand(spell.data, command('purchase', { kind: 'miracle', name: 'Bénédiction de test', count: 1, expectedCost: 100, catalogVersion }, 'miracle-1'), PLAYER);
    assert.equal(miracle.data.prieres[0].type, 'Miracle');
    assert.equal(miracle.data.prieres[0].resume, 'Portée : Toucher · Cible : Allié · Durée : Instantanée — Lumière.');
    await assertError(Promise.resolve().then(() => engine().applyCommand(data, command('purchase', {
        kind: 'sort', name: 'Absent', count: 1, expectedCost: 50, catalogVersion,
    }), PLAYER)), 'not-found', 'target-not-found');
    await assertError(Promise.resolve().then(() => rulesEngine.applyCommand(data, command('purchase', {
        kind: 'miracle', name: 'Absent', count: 1, expectedCost: 100, catalogVersion,
    }), PLAYER)), 'not-found', 'target-not-found');
});

test('la complétion de carrière exige toutes les caractéristiques, huit compétences distinctes et un talent du rang courant', () => {
    const { career, data } = fixture();
    const fullyAdvanced = {
        ...data,
        carac: { ...data.carac, cc: { base: 30, adv: 5 } },
        skillsAdvanced: [
            { id: 's1', nom: 'Esquive', adv: 5 }, { id: 's2', nom: 'Athlétisme', adv: 5 },
            { id: 's3', nom: 'Calme', adv: 5 }, { id: 's4', nom: 'Charme', adv: 5 },
            { id: 's5', nom: 'Intuition', adv: 5 }, { id: 's6', nom: 'Perception', adv: 5 },
            { id: 's7', nom: 'Marchandage', adv: 5 }, { id: 's8', nom: 'Ragot', adv: 5 },
        ],
        talentsAcq: [{ id: 't1', nom: 'Résistance' }],
    };
    assert.equal(evaluateCareerCompletion(fullyAdvanced, career, 1).complete, true);
    const noCurrentTalent = { ...fullyAdvanced, talentsAcq: [{ id: 'old', nom: 'Vigilance' }] };
    assert.equal(evaluateCareerCompletion(noCurrentTalent, career, 1).hasTalent, false);
    const duplicateAliasSkills = {
        ...fullyAdvanced,
        skillsAdvanced: [
            { id: 's1', nom: 'Chevaucher', adv: 5 }, { id: 's2', nom: 'Chevaucher (Cheval)', adv: 5 },
            { id: 's3', nom: 'Athlétisme', adv: 5 }, { id: 's4', nom: 'Calme', adv: 5 },
            { id: 's5', nom: 'Charme', adv: 5 }, { id: 's6', nom: 'Intuition', adv: 5 },
            { id: 's7', nom: 'Perception', adv: 5 }, { id: 's8', nom: 'Marchandage', adv: 5 },
            { id: 's9', nom: 'Ragot', adv: 5 },
        ],
    };
    const result = evaluateCareerCompletion(duplicateAliasSkills, career, 1);
    assert.equal(result.complete, false);
    assert.equal(result.missingSkills, 1);
});

test('le rang 2 compte les prérequis cumulés du rang 1 au seuil 10', () => {
    const career = {
        id: 'career-cumulative', nom: 'Carrière cumulative', carac: ['cc'], rangs: [
            { rang: 1, titre: 'Rang 1', caracs: ['cc'], skills: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage'], talents: ['Résistance'] },
            { rang: 2, titre: 'Rang 2', caracs: ['fm'], skills: ['Ragot'], talents: ['Vigilance'] },
        ],
    };
    const { data } = fixture({ carriere: career.nom, rang: '2' });
    const skillsAtThreshold = ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage', 'Ragot']
        .map((nom, index) => ({ id: `cumulative-${index}`, nom, adv: 10 }));
    const rankOneOnlyTalent = {
        ...data,
        carac: { ...data.carac, cc: { base: 30, adv: 10 }, fm: { base: 30, adv: 10 } },
        skillsAdvanced: skillsAtThreshold,
        talentsAcq: [{ id: 'rank-one-talent', nom: 'Résistance' }],
    };

    assert.equal(evaluateCareerCompletion(rankOneOnlyTalent, career, 2).complete, false);
    assert.equal(evaluateCareerCompletion(rankOneOnlyTalent, career, 2).hasTalent, false);

    const oneSkillShort = {
        ...rankOneOnlyTalent,
        skillsAdvanced: skillsAtThreshold.map((skill, index) => index === 0 ? { ...skill, adv: 9 } : skill),
        talentsAcq: [{ id: 'rank-two-talent', nom: 'Vigilance' }],
    };
    const incomplete = evaluateCareerCompletion(oneSkillShort, career, 2);
    assert.equal(incomplete.complete, false);
    assert.equal(incomplete.qualifiedSkills.length, 7);

    const complete = evaluateCareerCompletion({ ...rankOneOnlyTalent, talentsAcq: [
        { id: 'rank-one-talent', nom: 'Résistance' }, { id: 'rank-two-talent', nom: 'Vigilance' },
    ] }, career, 2);
    assert.equal(complete.complete, true);
    assert.equal(complete.threshold, 10);
});

test('les variantes ambiguës sont évaluées comme parcours séparés avec overrides', () => {
    const career = {
        id: 'branching', nom: 'Parcours', carac: [], rangs: [
            { rang: 1, titre: 'Voie caractéristiques', caracs: ['cc'], skills: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage'], talents: ['Résistance'] },
            { rang: 1, titre: 'Voie compétences', caracs: ['fm'], skills: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage', 'Ragot'], talents: ['Vigilance'] },
        ],
    };
    const { data } = fixture({ carriere: career.nom, careerOverrides: {} });
    const sevenAndEight = { ...data,
        carac: { ...data.carac, cc: { base: 30, adv: 5 }, fm: { base: 30, adv: 0 } },
        skillsAdvanced: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage', 'Ragot']
            .map((nom, i) => ({ id: `s${i}`, nom, adv: 5 })),
        talentsAcq: [{ id: 't', nom: 'Résistance' }],
    };
    const engineEval = evaluateCareerCompletion(sevenAndEight, career, 1);
    assert.equal(engineEval.complete, false);
    const completeBranch = { ...sevenAndEight, carac: { ...sevenAndEight.carac, fm: { base: 30, adv: 5 } } };
    const selected = { branching: { 1: 'Voie compétences' } };
    const completedVariant = { ...completeBranch, talentsAcq: [{ id: 't', nom: 'Vigilance' }] };
    const result = evaluateCareerCompletion(completedVariant, career, 1, selected, {});
    assert.equal(result.complete, true);
    assert.equal(result.selections[1], 'Voie compétences');
});

test('rang ignore currentRankDone du client et utilise le calcul automatique ou la politique pending', () => {
    const { career, data } = fixture();
    const completed = {
        ...data,
        carac: { ...data.carac, cc: { base: 30, adv: 5 } },
        skillsAdvanced: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage', 'Ragot']
            .map((nom, i) => ({ id: `s${i}`, nom, adv: 5 })),
        talentsAcq: [{ id: 't', nom: 'Résistance' }],
    };
    const result = engine().applyCommand(completed, command('purchase', {
        kind: 'rank', name: career.nom, count: 1, expectedCost: 100, catalogVersion,
        rankMode: 'advanceRank', targetRank: 2, currentRankDone: false,
    }), PLAYER);
    assert.equal(result.data.rang, '2');
    assert.equal(result.data.xpLog.at(-1).cout, 100);
    const pending = engine({ rankCompletionPolicy: 'pending' });
    assert.throws(() => pending.applyCommand(completed, command('purchase', {
        kind: 'rank', name: career.nom, count: 1, expectedCost: 100, catalogVersion,
        rankMode: 'advanceRank', targetRank: 2, currentRankDone: true,
    }), PLAYER), error => error.details?.kind === 'rank-policy-pending');
});

test('une sous-carrière exige un prérequis atteint dans la carrière active ou archivée', () => {
    const mage = { id: 'mage-he', nom: 'Mage (HE)', carac: [], rangs: [
        { rang: 1, titre: 'Apprenti', caracs: [], skills: [], talents: [] },
        { rang: 2, titre: 'Mage', caracs: [], skills: [], talents: [] },
    ] };
    const vaul = { id: 'vaul-he', nom: 'Prêtre-Forgeron de Vaul (HE)', prereq: { career: 'Mage (HE)', minRang: 2 }, carac: [], rangs: [
        { rang: 3, titre: 'Prêtre-Forgeron', caracs: [], skills: [], talents: [] },
    ] };
    const rulesEngine = engine({ careers: [mage, vaul] });
    const { data } = fixture({ carriere: mage.nom, rang: '1' });
    const change = command('purchase', { kind: 'rank', careerId: vaul.id, rankMode: 'changeCareer', targetRank: 3, count: 1, expectedCost: 200, catalogVersion }, 'change-1');
    assert.throws(() => rulesEngine.applyCommand(data, change, PLAYER), error => error.details?.kind === 'career-prerequisite');
    const activeQualified = { ...data, rang: '2' };
    const changed = rulesEngine.applyCommand(activeQualified, change, PLAYER);
    assert.equal(changed.data.carriere, vaul.nom);
    const archivedQualified = { ...data, careers: [{ id: 'old-mage', nom: mage.nom, rang: 2 }] };
    assert.equal(rulesEngine.applyCommand(archivedQualified, change, PLAYER).data.carriere, vaul.nom);
});

test('annulation marque l’achat, rembourse par gain compensatoire et ignore un gain postérieur', () => {
    const { data } = fixture();
    const purchased = engine().applyCommand(data, command('purchase', {
        kind: 'carac', name: 'cc', count: 1, expectedCost: 25, catalogVersion,
    }, 'buy-1'), PLAYER);
    const afterGain = engine().applyCommand(purchased.data, command('gain', { amount: 25, reason: 'Récompense' }, 'gain-2'), MJ);
    const cancelled = engine().applyCommand(afterGain.data, command('cancel', { purchaseId: 'buy-1:purchase' }, 'cancel-3'), PLAYER);
    assert.equal(cancelled.data.carac.cc.adv, 4);
    assert.equal(cancelled.data.xpLog.find(entry => entry.purchaseId === 'buy-1:purchase').cancelledByOperationId, 'cancel-3');
    assert.equal(cancelled.data.xpLog.at(-1).cancelledPurchaseId, 'buy-1:purchase');
    assert.equal(cancelled.data.xpLog.at(-1).montant, 25);
    assert.equal(cancelled.data.xpLog.filter(entry => entry.purchaseId === 'buy-1:purchase').length, 1);
});

test('annulation bloque un achat explicitement marqué par une migration de référentiel', () => {
    const { data } = fixture();
    const purchased = engine().applyCommand(data, command('purchase', {
        kind: 'skill', name: 'Savoir (Guerre)', count: 1, expectedCost: 20, catalogVersion,
    }, 'migration-buy'), PLAYER);
    const migrated = { ...purchased.data, catalogueMigrationBarriers: [{
        operationId: 'catalogue-publish', catalogVersion: 'sha256:new', purchaseIds: ['migration-buy:purchase'],
    }] };
    assert.throws(() => engine().applyCommand(migrated, command('cancel', {
        purchaseId: 'migration-buy:purchase',
    }, 'migration-undo'), PLAYER), error => error.details?.kind === 'purchase-not-reversible');
});

test('annulation utilise le chemin structuré pour un identifiant historique contenant un point', () => {
    const { data } = fixture({ skillsAdvanced: [{ id: 'legacy.skill.1', nom: 'Savoir (Guerre)', adv: 0 }] });
    const bought = engine().applyCommand(data, command('purchase', {
        kind: 'skill', name: 'Savoir (Guerre)', targetId: 'legacy.skill.1', count: 1, expectedCost: 20, catalogVersion,
    }, 'dot-id-buy'), PLAYER);
    assert.deepEqual(bought.data.xpLog.at(-1).effects[0].pathParts, ['skillsAdvanced', 'legacy.skill.1', 'adv']);
    const undone = engine().applyCommand(bought.data, command('cancel', { purchaseId: 'dot-id-buy:purchase' }, 'dot-id-undo'), PLAYER);
    assert.equal(undone.data.skillsAdvanced[0].adv, 0);
});

test('annulation joueur bloque achat ultérieur propre, cible modifiée, héritage et double remboursement', async () => {
    const { data } = fixture();
    const first = engine().applyCommand(data, command('purchase', { kind: 'carac', name: 'cc', count: 1, expectedCost: 25, catalogVersion }, 'buy-1'), PLAYER);
    const second = engine().applyCommand(first.data, command('purchase', { kind: 'carac', name: 'ct', count: 1, expectedCost: 50, catalogVersion }, 'buy-2'), PLAYER);
    await assertError(Promise.resolve().then(() => engine().applyCommand(second.data, command('cancel', { purchaseId: 'buy-1:purchase' }, 'cancel-old'), PLAYER)), 'failed-precondition', 'purchase-not-reversible');
    const changed = { ...first.data, carac: { ...first.data.carac, cc: { ...first.data.carac.cc, adv: 6 } } };
    await assertError(Promise.resolve().then(() => engine().applyCommand(changed, command('cancel', { purchaseId: 'buy-1:purchase' }, 'cancel-changed'), PLAYER)), 'failed-precondition', 'purchase-not-reversible');
    const legacy = { ...data, xpLog: [...data.xpLog, { type: 'Caractéristique', cout: 25, applied: true, targetNom: 'cc' }] };
    await assertError(Promise.resolve().then(() => engine().applyCommand(legacy, command('cancel', { purchaseId: 'missing' }, 'cancel-legacy'), PLAYER)), 'failed-precondition', 'purchase-not-reversible');
    const once = engine().applyCommand(first.data, command('cancel', { purchaseId: 'buy-1:purchase' }, 'cancel-once'), PLAYER);
    await assertError(Promise.resolve().then(() => engine().applyCommand(once.data, command('cancel', { purchaseId: 'buy-1:purchase' }, 'cancel-twice'), PLAYER)), 'failed-precondition', 'purchase-not-reversible');
});

test('annulation bloque les dépendances de rang, de carrière et de palier magique', () => {
    const { career, data } = fixture();
    const careerUndoEngine = engine({ careers: [career, { id: 'other', nom: 'Autre', rangs: [{ rang: 1, titre: 'Nouveau', caracs: [], skills: [], talents: [] }] }] });
    const rank = careerUndoEngine.applyCommand(data, command('purchase', {
        kind: 'rank', rankMode: 'advanceRank', targetRank: 2, count: 1, expectedCost: 200, catalogVersion,
    }, 'rank-before-spend'), PLAYER);
    const laterSpend = careerUndoEngine.applyCommand(rank.data, command('purchase', {
        kind: 'carac', name: 'ct', count: 1, expectedCost: 50, catalogVersion,
    }, 'mj-spend'), MJ);
    assert.throws(() => careerUndoEngine.applyCommand(laterSpend.data, command('cancel', {
        purchaseId: 'rank-before-spend:purchase',
    }, 'undo-rank'), MJ), error => error.details?.kind === 'purchase-not-reversible');

    const rankReady = {
        ...data,
        carac: { ...data.carac, cc: { base: 30, adv: 5 } },
        skillsAdvanced: ['Esquive', 'Athlétisme', 'Calme', 'Charme', 'Intuition', 'Perception', 'Marchandage']
            .map((nom, i) => ({ id: `ready-${i}`, nom, adv: 5 })),
        talentsAcq: [{ id: 'rank-talent', nom: 'Résistance' }],
    };
    const skillBuy = engine().applyCommand(rankReady, command('purchase', {
        kind: 'skill', name: 'Ragot', count: 5, expectedCost: 50, catalogVersion,
    }, 'skill-enables-rank'), PLAYER);
    const rankBuy = engine().applyCommand(skillBuy.data, command('purchase', {
        kind: 'rank', rankMode: 'advanceRank', targetRank: 2, count: 1, expectedCost: 100, catalogVersion,
    }, 'rank-after-skill'), PLAYER);
    assert.throws(() => engine().applyCommand(rankBuy.data, command('cancel', {
        purchaseId: 'skill-enables-rank:purchase',
    }, 'undo-skill'), MJ), error => error.details?.kind === 'purchase-not-reversible');

    const magic = engine({ spells: { spells: [
        { nom: 'Mineur 1', type: 'Mineur', ni: 0 }, { nom: 'Mineur 2', type: 'Petite magie', ni: 0 },
    ], miracles: [] } });
    const one = magic.applyCommand(data, command('purchase', { kind: 'sort', name: 'Mineur 1', count: 1, expectedCost: 50, catalogVersion }, 'magic-tier-1'), PLAYER);
    const two = magic.applyCommand(one.data, command('purchase', { kind: 'sort', name: 'Mineur 2', count: 1, expectedCost: 50, catalogVersion }, 'magic-tier-2'), MJ);
    assert.throws(() => magic.applyCommand(two.data, command('cancel', {
        purchaseId: 'magic-tier-1:purchase',
    }, 'undo-magic-tier'), MJ), error => error.details?.kind === 'purchase-not-reversible');
});

test('gain, corrections et import exigent un MJ, un motif et un schéma fermé', async () => {
    const { data } = fixture();
    const gained = engine().applyCommand(data, command('gain', { amount: 50, reason: 'Séance' }), MJ);
    assert.equal(gained.data.xpLog.at(-1).montant, 50);
    await assertError(Promise.resolve().then(() => engine().applyCommand(data, command('gain', { amount: 50, reason: 'x' }), PLAYER)), 'permission-denied');
    const corrected = engine().applyCommand(data, command('correct', { kind: 'carac', name: 'cc', adv: 7, reason: 'Correction fiche' }, 'correct-1'), MJ);
    assert.equal(corrected.data.carac.cc.adv, 7);
    await assertError(Promise.resolve().then(() => engine().applyCommand(data, command('import', { reason: 'Import validé', data: { ...data, admin: true } }), MJ)), 'invalid-argument');
});

test('correction MJ batch valide chemins structurés, garde les autres données et trace les changements', () => {
    const { career, data } = fixture({ talentsAcq: [{ id: 'tal-1', nom: 'Résistance', note: '' }] });
    const before = clone(data);
    const corrected = engine().applyCommand(data, command('correct', {
        kind: 'batch', reason: 'Ajustement MJ après vérification', changes: [
            { pathParts: ['carac', 'cc', 'base'], value: 32 },
            { pathParts: ['talentsAcq', 'tal-1', 'note'], value: 'Acquis hors carrière' },
            { pathParts: ['skillsAdvanced', '@new'], value: { nom: 'Savoir (Guerre)', carac: 'int', adv: 2 } },
            { pathParts: ['chosenVariants', career.id, '1'], value: 'Rang 1' },
            { pathParts: ['careerOverrides', career.id, '1', 'skillsAdded'], value: ['Orientation'] },
            { pathParts: ['basicSpecs', 'Chevaucher'], value: 'Cheval' },
        ],
    }, 'batch-correct-1'), MJ);
    assert.equal(data.carac.cc.base, 30);
    assert.deepEqual(data, before);
    assert.equal(corrected.data.carac.cc.base, 32);
    assert.equal(corrected.data.talentsAcq[0].note, 'Acquis hors carrière');
    assert.equal(corrected.data.skillsAdvanced[0].id, 'batch-correct-1:batch-2');
    assert.equal(corrected.data.chosenVariants[career.id][1], 'Rang 1');
    assert.deepEqual(corrected.data.careerOverrides[career.id][1].skillsAdded, ['Orientation']);
    assert.equal(corrected.data.basicSpecs.Chevaucher, 'Cheval');
    const journal = corrected.data.xpLog.at(-1);
    assert.equal(journal.kind, 'correction');
    assert.equal(journal.cout, 0);
    assert.equal(journal.reason, 'Ajustement MJ après vérification');
    assert.deepEqual(corrected.summary.fields, ['carac.cc.base', 'talentsAcq.tal-1.note', 'skillsAdvanced.batch-correct-1:batch-2', `chosenVariants.${career.id}.1`, `careerOverrides.${career.id}.1.skillsAdded`, 'basicSpecs.Chevaucher']);
});

test('correction MJ batch refuse XP bruts, variantes inconnues, collisions IDs et spécialisation possédée', () => {
    const { career, data } = fixture();
    const denied = changes => assert.throws(() => engine().applyCommand(data, command('correct', {
        kind: 'batch', reason: 'Motif contrôlé', changes,
    }), MJ), FicheCommandError);
    denied([{ pathParts: ['xpLog'], value: [] }]);
    denied([{ pathParts: ['chosenVariants', career.id, '1'], value: 'Rang absent' }]);
    denied([{ pathParts: ['skillsAdvanced', '@new'], value: { id: 'client-id', nom: 'Savoir (Guerre)', carac: 'int', adv: 1 } }]);
    const owned = { ...data, skillsBasic: { Chevaucher: 1 } };
    assert.throws(() => engine().applyCommand(owned, command('correct', {
        kind: 'batch', reason: 'Spécialisation possédée', changes: [{ pathParts: ['basicSpecs', 'Chevaucher'], value: 'Cheval' }],
    }), MJ), error => error instanceof FicheCommandError);
    const inconsistentCareer = [{ pathParts: ['carriere'], value: 'Carrière inconnue' }];
    denied(inconsistentCareer);
});

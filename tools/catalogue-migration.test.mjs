import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSkillEntries, collectLegacySkillAliases, createSkillResolver } from '../js/catalogue/skill-resolver.js';
import { applySkillMigrationDecisions, planSkillMigration, proposeCollisionAdvances, skillMigrationRecordKey } from '../js/catalogue/skill-migration.js';

const skills = JSON.parse(readFileSync(new globalThis.URL('../js/data/skills.json', import.meta.url), 'utf8'));
const entries = buildSkillEntries(skills);
const resolver = createSkillResolver({ version: 'skills-v1', entries,
    aliases: collectLegacySkillAliases(['Conn. Histoire'], entries) });

test('aperçu conserve les lignes par fiche et ne déclare collision que dans le même tableau', () => {
    const plan = planSkillMigration({ resolver, fromVersion: 'legacy', toVersion: 'skills-v1', records: [
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'a', nom: 'Conn. Histoire', advances: 0 },
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'b', nom: 'Savoir (Histoire)', advances: 3 },
        { scopeId: 'char-2', collection: 'skillsAdvanced', id: 'c', nom: 'Savoir (Histoire)', advances: 2 },
    ] });
    assert.equal(plan.collisions.length, 1);
    assert.equal(plan.collisions[0].records.length, 2);
    assert.equal(plan.collisions[0].scopeId, 'char-1');
    assert.equal(plan.requiresDecisions, true);
    assert.throws(() => applySkillMigrationDecisions(plan, []), error => error.code === 'decision-required');
    const keepRecordKey = skillMigrationRecordKey(plan.collisions[0].records[0]);
    const outcome = applySkillMigrationDecisions(plan, [{ key: plan.collisions[0].key, keepRecordKey,
        storageCollection: 'skillsAdvanced', advances: 0 }]);
    assert.equal(outcome.records.find(record => record.scopeId === 'char-1').advances, 0);
    assert.equal(outcome.records.find(record => record.scopeId === 'char-2').advances, 2);
    assert.deepEqual(outcome.dropped.map(record => record.id), ['b']);
});

test('une collision exige une décision même quand toutes les avances sont nulles', () => {
    const plan = planSkillMigration({ resolver, toVersion: 'skills-v1', records: [
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'a', nom: 'Conn. Histoire', advances: 0 },
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'b', nom: 'Savoir (Histoire)', advances: 0 },
    ] });
    assert.throws(() => applySkillMigrationDecisions(plan, []), error => error.code === 'decision-required');
});

test('la proposition d’avances exige une chaîne XP continue et concordante', () => {
    const plan = planSkillMigration({ resolver, toVersion: 'skills-v1', records: [
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'a', nom: 'Conn. Histoire', advances: 3,
            history: [{ origin: 'command', purchaseId: 'p1', operationId: 'o1', kind: 'purchase', cout: 20,
                effects: [{ path: 'skillsAdvanced.a.adv', pathParts: ['skillsAdvanced', 'a', 'adv'], before: 1, after: 2 }] },
            { origin: 'command', purchaseId: 'p2', operationId: 'o2', kind: 'purchase', cout: 25,
                effects: [{ path: 'skillsAdvanced.a.adv', pathParts: ['skillsAdvanced', 'a', 'adv'], before: 2, after: 3 }] }] },
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'b', nom: 'Savoir (Histoire)', advances: 3,
            history: [{ origin: 'command', purchaseId: 'p3', operationId: 'o3', kind: 'purchase', cout: 25,
                effects: [{ path: 'skillsAdvanced.b.adv', pathParts: ['skillsAdvanced', 'b', 'adv'], before: 2, after: 3 }] }] },
    ] });
    assert.equal(plan.collisions[0].proposal.status, 'demonstrated');
    assert.equal(plan.collisions[0].proposal.advances, 3);
    assert.equal(plan.collisions[0].proposal.evidence[0].purchases.length, 2);
});

test('la proposition ne choisit ni valeur courante ni somme quand l’historique manque ou diverge', () => {
    const records = [
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'a', nom: 'A', advances: 4,
            history: [{ origin: 'legacy', id: 'legacy-1', cout: 100 }] },
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'b', nom: 'B', advances: 8, history: [] },
    ];
    assert.equal(proposeCollisionAdvances(records).status, 'insufficient-history');
    const demonstratedButDivergent = records.map((record, index) => ({ ...record, history: [
        { origin: 'command', kind: 'purchase', purchaseId: `p${index}`, effects: [{ pathParts: ['skillsAdvanced', record.id, 'adv'],
            before: record.advances - 1, after: record.advances }] },
    ] }));
    assert.equal(proposeCollisionAdvances(demonstratedButDivergent).status, 'conflicting-history');
});

test('un libellé inconnu bloque la migration et une décision de collision étrangère est rejetée', () => {
    const unresolved = planSkillMigration({ resolver, toVersion: 'skills-v1', affectedLabels: ['Compétence inventée'], records: [
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'a', nom: 'Compétence inventée', advances: 4 },
    ] });
    assert.throws(() => applySkillMigrationDecisions(unresolved, []), error => error.code === 'unresolved-skills');

    const plan = planSkillMigration({ resolver, toVersion: 'skills-v1', records: [
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'a', nom: 'Conn. Histoire', advances: 0 },
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'b', nom: 'Savoir (Histoire)', advances: 0 },
    ] });
    assert.throws(() => applySkillMigrationDecisions(plan, [{ key: 'unrelated', keepRecordKey: 'a', storageCollection: 'skillsAdvanced', advances: 0 }]));
});

test('compétence de base et avancée identiques forment une collision logique unique', () => {
    const plan = planSkillMigration({ resolver, toVersion: 'skills-v1', records: [
        { scopeId: 'char-1', collection: 'skillsBasic', id: 'same-id', nom: 'Esquive', advances: 0 },
        { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'same-id', nom: 'Esquive', advances: 4 },
    ] });
    assert.equal(plan.collisions.length, 1);
    assert.equal(plan.collisions[0].collection, 'skillsOwned');
    const advanced = plan.collisions[0].records.find(record => record.collection === 'skillsAdvanced');
    const decision = { key: plan.collisions[0].key, keepRecordKey: skillMigrationRecordKey(advanced), advances: 3 };
    assert.throws(() => applySkillMigrationDecisions(plan, [{ ...decision, storageCollection: 'skillsAdvanced' }]), /stockage cible/);
    const outcome = applySkillMigrationDecisions(plan, [{ ...decision, storageCollection: 'skillsBasic' }]);
    assert.equal(outcome.records.length, 1);
    assert.equal(outcome.records[0].id, 'same-id');
    assert.equal(outcome.records[0].sourceCollection, 'skillsAdvanced');
    assert.equal(outcome.records[0].collection, 'skillsBasic');
    assert.equal(outcome.records[0].advances, 3);
    assert.equal(outcome.dropped[0].collection, 'skillsBasic');
});

test('une forme personnalisée inconnue sans rapport reste intacte hors migration ciblée', () => {
    const targetId = entries.find(entry => entry.nom === 'Savoir (Histoire)').id;
    const plan = planSkillMigration({ resolver, toVersion: 'skills-v1', affectedTargetIds: [targetId],
        affectedLabels: ['Conn. Histoire'], records: [
            { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'history', nom: 'Conn. Histoire', advances: 2 },
            { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'custom-spec', nom: 'Art (Gravure runique)', advances: 4 },
            { scopeId: 'char-1', collection: 'skillsAdvanced', id: 'custom', nom: 'Compétence personnalisée', advances: 7 },
        ] });
    assert.equal(plan.unresolved.length, 1);
    assert.equal(plan.customSpecializations.length, 1);
    const result = applySkillMigrationDecisions(plan, []);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].id, 'history');
    assert.equal(result.unresolved[0].id, 'custom');
    assert.equal(result.customSpecializations[0].id, 'custom-spec');
});

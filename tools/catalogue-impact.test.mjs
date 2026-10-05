import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillEntries, createSkillResolver } from '../js/catalogue/skill-resolver.js';
import { buildTalentEntries, createTalentResolver } from '../js/catalogue/talent-resolver.js';
import { buildCatalogueImpactReport } from '../js/catalogue/impact-report.js';

test('impact report couvre carrières, slots, possessions, overrides, talents et historiques sans muter les fiches', () => {
    const skillRows = [
        { group: 'Art', spec: 'Calligraphie', nom: 'Art (Calligraphie)', carac: 'dex', basic: true },
        { group: 'Art', spec: 'Gravure', nom: 'Art (Gravure)', carac: 'dex', basic: true },
        { group: 'Athlétisme', spec: '', nom: 'Athlétisme', carac: 'ag', basic: true },
    ];
    const skills = createSkillResolver({ version: 's1', entries: buildSkillEntries(skillRows, [{ nom: 'Art', carac: 'dex' }]) });
    const sheet = { entries: [{ nom: 'Affable', description: 'Description.' }] };
    const talents = createTalentResolver({ version: 't1', entries: buildTalentEntries({ sheetSnapshot: sheet,
        careers: [{ rangs: [{ talents: ['Affable'] }] }] }), sheetSnapshot: sheet });
    const careers = [{ id: 'career-1', nom: 'Carrière', rangs: [{ rang: 1, titre: 'Rang 1',
        skills: ['Art (au choix)', 'Art (Calligraphie ou Gravure)', 'Athlétisme'], talents: ['Affable'] }] }];
    const data = {
        skillsBasic: { Art: 2 }, basicSpecs: { Art: 'Calligraphie' },
        skillsAdvanced: [{ id: 'custom-id', nom: 'Art (Gravure runique)', adv: 3 }],
        careerOverrides: { 'career-1': { 1: { skillsAdded: ['Athlétisme'], skillsRemoved: [] } } },
        talentsAcq: [{ id: 'talent-1', nom: 'Affable' }, { id: 'talent-missing', nom: 'Absent' }],
        xpLog: [{ id: 'historique', targetType: 'skill-adv', targetNom: 'Art (Calligraphie)', purchaseId: 'purchase-1' }],
    };
    const before = JSON.stringify(data);
    const report = buildCatalogueImpactReport({ skillResolver: skills, talentResolver: talents,
        careers, characters: [{ charId: 'char-1', data }] });

    assert.equal(JSON.stringify(data), before);
    assert.equal(report.openCareerSlots.length, 1);
    assert.equal(report.skills.find(item => item.name === 'Art (Gravure runique)').status, 'custom-specialization');
    assert.equal(report.skills.some(item => item.name === 'Art (Calligraphie)'
        && item.occurrences.some(occurrence => occurrence.historical)), true);
    assert.ok(report.skills.some(item => item.kind === 'career-override' && item.name === 'Athlétisme'));
    assert.equal(report.counts.unresolvedTalentLabels, 1);
});

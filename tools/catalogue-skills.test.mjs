import test from 'node:test';
import assert from 'node:assert/strict';
import * as browserResolver from '../js/catalogue/skill-resolver.js';
import * as serverResolver from '../functions/src/catalogue/skill-resolver.mjs';

const skillRows = [
    { group: 'Athlétisme', spec: '', nom: 'Athlétisme', carac: 'ag', basic: true },
    { group: 'Savoir', spec: 'Histoire', nom: 'Savoir (Histoire)', carac: 'int', basic: false },
    { group: 'Art', spec: 'Calligraphie', nom: 'Art (Calligraphie)', carac: 'dex', basic: true },
    { group: 'Art', spec: 'Gravure', nom: 'Art (Gravure)', carac: 'dex', basic: true },
    { group: 'Chevaucher', spec: 'Cheval', nom: 'Chevaucher (Cheval)', carac: 'ag', basic: true },
];

test('compétences et spécialisations reçoivent des identités distinctes', () => {
    const entries = browserResolver.buildSkillEntries(skillRows, [{ nom: 'Art', carac: 'dex' }, { nom: 'Chevaucher', carac: 'ag' }]);
    const byName = new Map(entries.map(entry => [entry.nom, entry]));
    assert.notEqual(byName.get('Art').id, byName.get('Art (Calligraphie)').id);
    assert.notEqual(byName.get('Art (Calligraphie)').specializationId, byName.get('Art (Gravure)').specializationId);
    assert.equal(byName.get('Art (Calligraphie)').groupId, byName.get('Art (Gravure)').groupId);
});

test('alias exact déjà codé, choix de carrière et suggestions ne lient pas une forme approchante', () => {
    const entries = browserResolver.buildSkillEntries(skillRows, [{ nom: 'Chevaucher', carac: 'ag' }]);
    const aliases = browserResolver.collectLegacySkillAliases(['Conn. Histoire', 'Art (Calligraphie ou Gravure)'], entries);
    const resolver = browserResolver.createSkillResolver({ version: 'v1', entries, aliases });
    assert.equal(resolver.resolve('Conn. Histoire').entry.nom, 'Savoir (Histoire)');
    assert.equal(resolver.resolve('athletisme').status, 'unknown');
    assert.ok(resolver.suggest('athletisme').some(candidate => candidate.label === 'Athlétisme'));
    const choice = resolver.resolveCareerSlot('Art (Calligraphie ou Gravure)');
    assert.equal(choice.status, 'resolved');
    assert.deepEqual(choice.alternatives.map(item => item.entry.nom), ['Art (Calligraphie)', 'Art (Gravure)']);
    const open = resolver.resolveCareerSlot('Savoir (Région)');
    assert.equal(open.status, 'resolved');
    assert.equal(open.open, true);
    assert.equal(open.base.group, 'Savoir');
    const customSpecialty = resolver.resolveOwnedSkill('Art (Gravure runique)');
    assert.equal(customSpecialty.status, 'custom-specialization');
    assert.equal(customSpecialty.entry.carac, 'dex');
    assert.equal(resolver.resolveOwnedSkill('Art (Sculpture ou Gravure)').status, 'unknown');
    assert.equal(resolver.resolveOwnedSkill('Groupe inconnu (Spécialité)').status, 'unknown');
});

test('alias cyclique ou concurrent est ambigu, les alias historiques explicites restent prioritaires', () => {
    const entries = browserResolver.buildSkillEntries(skillRows, [{ nom: 'Chevaucher', carac: 'ag' }]);
    const horse = entries.find(entry => entry.nom === 'Chevaucher (Cheval)');
    const base = entries.find(entry => entry.nom === 'Chevaucher');
    const cyclic = browserResolver.createSkillResolver({
        version: 'v1', entries,
        aliases: [{ label: 'Alias A', targetId: 'Alias B' }, { label: 'Alias B', targetId: 'Alias A' }],
    });
    assert.equal(cyclic.resolve('Alias A').status, 'ambiguous');
    assert.ok(cyclic.aliasErrors.some(error => error.reason === 'cycle'));

    const competing = browserResolver.createSkillResolver({ version: 'v1', entries,
        aliases: [{ label: 'Autre nom', targetId: horse.id }, { label: 'Autre nom', targetId: base.id }] });
    assert.equal(competing.resolve('Autre nom').status, 'ambiguous');

    const collision = browserResolver.createSkillResolver({ version: 'v1', entries,
        aliases: [{ label: 'Chevaucher (Cheval)', targetId: base.id }] });
    assert.equal(collision.resolve('Chevaucher (Cheval)').entry.id, base.id);
});

test('implémentation serveur et navigateur donnent le même résultat', () => {
    const aliases = [{ label: 'ancien nom', targetId: browserResolver.buildSkillEntries(skillRows).find(entry => entry.nom === 'Savoir (Histoire)').id }];
    const browserEntries = browserResolver.buildSkillEntries(skillRows);
    const serverEntries = serverResolver.buildSkillEntries(skillRows);
    const browser = browserResolver.createSkillResolver({ version: 'v1', entries: browserEntries, aliases });
    const server = serverResolver.createSkillResolver({ version: 'v1', entries: serverEntries, aliases });
    for (const label of ['Savoir (Histoire)', 'ancien nom', 'Athlétisme', 'inconnu']) {
        assert.deepEqual(server.resolve(label), browser.resolve(label));
    }
    assert.deepEqual(server.suggest('histoir'), browser.suggest('histoir'));
});

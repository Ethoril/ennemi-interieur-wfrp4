import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillForms, linkSkillForms, skillFormsResolver, publishedSkillRows, primarySkillLabel } from '../js/catalogue/skill-forms.js';
import { createPublishedCatalogueEngine } from '../js/fiche/published-catalogue-engine.js';

const entry = (id, nom) => ({ id, nom, group: nom.split('(')[0].trim(), groupId: id + '-group',
    specialization: 'Guerre', specializationId: id + '-spec', basic: false, carac: 'fm', aliases: [] });
const skills = () => ({ entries: [entry('a', 'Savoir (Guerre)'), entry('b', 'Connaissance (Guerre)'), entry('c', 'Autre')],
    aliases: [{ label: 'Ancien savoir', targetId: 'a' }, { label: 'Ancienne connaissance', targetId: 'b' }] });

test('inventaire couvre catalogue, variantes, carrières, fiches et historiques sans modifier les sources', () => {
    const source = skills(); const before = JSON.stringify(source);
    const report = { skills: [
        { name: 'Libellé inédit', occurrences: [{ kind: 'owned-advanced', scopeId: 'bhelgi' }] },
        { name: 'Ancien savoir', occurrences: [{ kind: 'career', careerName: 'Érudit', rank: 1 }] },
        { name: 'Archive', occurrences: [{ kind: 'history', historical: true, scopeId: 'wren' }] },
    ] };
    const forms = buildSkillForms(source, report);
    assert.equal(forms.find(row => row.label === 'Libellé inédit').status, 'unknown');
    assert.equal(forms.find(row => row.label === 'Ancien savoir').primary, 'Savoir (Guerre)');
    assert.deepEqual(forms.find(row => row.label === 'Archive').sources, ['Historique XP']);
    assert.equal(JSON.stringify(source), before);
});

test('regroupement conserve les identifiants, relie toutes les variantes et ne propose qu’une principale', () => {
    const source = skills(); const before = JSON.stringify(source);
    const result = linkSkillForms(source, ['Ancien savoir', 'Connaissance (Guerre)', 'Inédit'], 'Connaissance (Guerre)');
    const resolver = skillFormsResolver(result.skills);
    for (const label of ['Savoir (Guerre)', 'Ancien savoir', 'Ancienne connaissance', 'Inédit']) assert.equal(resolver.resolve(label).entry.id, 'b');
    assert.equal(resolver.resolve('a').entry.id, 'b');
    assert.deepEqual(publishedSkillRows(resolver).map(row => row.nom), ['Connaissance (Guerre)', 'Autre']);
    assert.deepEqual(result.skills.entries.map(row => row.id), ['a', 'b', 'c']);
    assert.equal(JSON.stringify(source), before);
    assert.equal(primarySkillLabel(resolver, 'Ancien savoir', true), 'Connaissance (Guerre)');
});

test('une variante peut devenir principale puis une ancienne entrée peut reprendre ce rôle', () => {
    let next = linkSkillForms(skills(), ['Savoir (Guerre)', 'Connaissance (Guerre)'], 'Connaissance (Guerre)').skills;
    next = linkSkillForms(next, ['Connaissance (Guerre)', 'Ancienne connaissance'], 'Ancienne connaissance').skills;
    assert.equal(skillFormsResolver(next).resolve('Ancien savoir').entry.nom, 'Ancienne connaissance');
    next = linkSkillForms(next, ['Ancienne connaissance', 'Savoir (Guerre)'], 'Savoir (Guerre)').skills;
    assert.equal(skillFormsResolver(next).resolve('Ancienne connaissance').entry.id, 'a');
    assert.equal(skillFormsResolver(next).primaryEntries.filter(row => row.id !== 'c').length, 1);
});

test('un alias qui renvoie vers une entrée elle-même redirigée suit la principale ; les cycles sont refusés', () => {
    const source = skills(); source.aliases.push({ label: 'Savoir (Guerre)', targetId: 'b' });
    assert.equal(skillFormsResolver(source).resolve('Ancien savoir').entry.id, 'b');
    source.aliases.push({ label: 'Connaissance (Guerre)', targetId: 'a' });
    assert.equal(skillFormsResolver(source).resolve('Savoir (Guerre)').status, 'ambiguous');
    assert.ok(skillFormsResolver(source).aliasErrors.length);
});

test('un groupe inconnu ou une principale hors sélection ne modifie aucune donnée', () => {
    const source = skills(); const before = JSON.stringify(source);
    assert.throws(() => linkSkillForms(source, ['Inconnu', 'Autre inconnu'], 'Inconnu'), /caractéristique/);
    assert.throws(() => linkSkillForms(source, ['Ancien savoir'], 'Autre'), /sélectionnées/);
    assert.equal(JSON.stringify(source), before);
});

test('achat via une ancienne forme : nom principal, caractéristique et prix carrière publiés', () => {
    const source = skills();
    const linked = linkSkillForms(source, ['Savoir (Guerre)', 'Connaissance (Guerre)'], 'Connaissance (Guerre)').skills;
    const catalogue = { catalogVersion: 'forms-v2', skills: linked, talents: { entries: [], aliases: [] } };
    const careers = [{ id: 'scholar', nom: 'Érudit', rangs: [{ rang: 1, skills: ['Ancien savoir'], talents: [], caracs: [] }] }];
    const engine = createPublishedCatalogueEngine({ catalogue, careers, skills: [], spells: { catalogVersion: 'rules-v1', spells: [], miracles: [] } });
    const data = { carriere: 'Érudit', rang: '1', xpLog: [{ kind: 'gain', montant: 500 }], skillsBasic: {}, skillsAdvanced: [], talentsAcq: [] };
    const result = engine.applyCommand(data, { operationId: 'forms-purchase', type: 'purchase', payload: {
        kind: 'skill', name: 'Ancien savoir', count: 1, expectedCost: 10, catalogVersion: engine.catalogVersion,
    } }, { uid: 'player', role: 'joueur' });
    assert.equal(result.data.skillsAdvanced[0].nom, 'Connaissance (Guerre)');
    assert.equal(result.data.skillsAdvanced[0].carac, 'fm');
    const second = engine.applyCommand(result.data, { operationId: 'forms-next', type: 'purchase', payload: {
        kind: 'skill', name: 'Savoir (Guerre)', count: 1, expectedCost: 10, catalogVersion: engine.catalogVersion,
    } }, { uid: 'player', role: 'joueur' });
    assert.equal(second.data.skillsAdvanced.length, 1);
    assert.equal(second.data.skillsAdvanced[0].adv, 2);
});

test('deux principales distinctes ne sont pas reliées par les anciennes équivalences codées en dur', () => {
    const source = skills(); const resolver = skillFormsResolver(source);
    assert.equal(resolver.resolveCareerSlot('Connaissance (Guerre)').entry.id, 'b');
    const catalogue = { catalogVersion: 'forms-separated', skills: source, talents: { entries: [], aliases: [] } };
    const careers = [{ id: 'scholar', nom: 'Érudit', rangs: [{ rang: 1, skills: ['Connaissance (Guerre)'], talents: [], caracs: [] }] }];
    const engine = createPublishedCatalogueEngine({ catalogue, careers, skills: [], spells: { catalogVersion: 'rules-v1', spells: [], miracles: [] } });
    const data = { carriere: 'Érudit', rang: '1', xpLog: [{ kind: 'gain', montant: 500 }], skillsBasic: {},
        skillsAdvanced: [{ id: 'owned-a', nom: 'Savoir (Guerre)', carac: 'fm', adv: 2 }], talentsAcq: [] };
    const result = engine.applyCommand(data, { operationId: 'separate-purchase', type: 'purchase', payload: {
        kind: 'skill', name: 'Connaissance (Guerre)', count: 1, expectedCost: 10, catalogVersion: engine.catalogVersion,
    } }, { uid: 'player', role: 'joueur' });
    assert.equal(result.data.skillsAdvanced.length, 2);
    assert.equal(result.data.skillsAdvanced[1].nom, 'Connaissance (Guerre)');
});


test('création explicite de deux formes hors catalogue : identité stable, anciennes formes reconnues et achats possibles', () => {
    const source = skills(); const before = JSON.stringify(source);
    const labels = ['Conn. (Théologie)', 'Conn. Théologie'];
    const next = linkSkillForms(source, labels, labels[1], { newSkill: { carac: 'int' } }).skills;
    assert.equal(JSON.stringify(source), before);
    const resolver = skillFormsResolver(next);
    const created = resolver.resolve(labels[0]).entry;
    assert.equal(created.nom, labels[1]); assert.equal(created.basic, false); assert.equal(created.carac, 'int');
    assert.equal(created.id, resolver.resolve(labels[1]).entry.id);
    assert.equal(resolver.primaryEntries.length, source.entries.length + 1);
    assert.deepEqual(linkSkillForms(source, labels, labels[1], { newSkill: { carac: 'int' } }).skills, next);
    const catalogue = { catalogVersion: 'new-forms', skills: next, talents: { entries: [], aliases: [] } };
    const engine = createPublishedCatalogueEngine({ catalogue, careers: [], skills: [], spells: { catalogVersion: 'rules-v1', spells: [], miracles: [] } });
    const result = engine.applyCommand({ xpLog: [{ kind: 'gain', montant: 500 }], skillsBasic: {}, skillsAdvanced: [], talentsAcq: [] },
        { operationId: 'new-theology', type: 'purchase', payload: { kind: 'skill', name: labels[0], count: 1, expectedCost: 20, catalogVersion: engine.catalogVersion } }, { uid: 'player', role: 'joueur' });
    assert.equal(result.data.skillsAdvanced[0].nom, labels[1]); assert.equal(result.data.skillsAdvanced[0].carac, 'int');
});


test('les identifiants de création restent compatibles avec le serveur pour un long nom principal', () => {
    const label = 'Connaissance (' + 'Théologie '.repeat(15).trim() + ')';
    const created = linkSkillForms(skills(), [label], label, { newSkill: { carac: 'int' } }).skills.entries.at(-1);
    for (const id of [created.id, created.groupId, created.specializationId]) {
        assert.ok(id.length <= 200); assert.match(id, /^[A-Za-z0-9_-]+$/u);
    }
});

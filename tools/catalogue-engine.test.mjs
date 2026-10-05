import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishedCatalogueEngine } from '../js/fiche/published-catalogue-engine.js';

const catalogue = {
    catalogVersion: 'sha256:published',
    skills: {
        entries: [
            { id: 'skill-savoir-guerre', groupId: 'group-savoir', group: 'Savoir', specializationId: 'spec-guerre',
                specialization: 'Guerre', nom: 'Savoir (Guerre)', carac: 'int', basic: false, aliases: [] },
            { id: 'skill-cc-halberd', groupId: 'group-corps-a-corps', group: 'Corps à corps',
                specializationId: 'spec-arme-hast', specialization: 'Arme d\'hast',
                nom: 'Corps à corps (Arme d\'hast)', carac: 'cc', basic: true, aliases: [] },
        ],
        aliases: [
            { label: 'Ancienne compétence', targetId: 'skill-savoir-guerre', provenance: 'mj' },
            { label: 'Ancienne attaque', targetId: 'skill-cc-halberd', provenance: 'mj' },
        ],
    },
    talents: {
        entries: [{ id: 'talent-vigilance', key: 'vigilance', nom: 'Vigilance', sources: ['sheet'] }],
        aliases: [{ label: 'Ancien talent', targetId: 'talent-vigilance', provenance: 'mj' }],
        templates: [], localDescriptions: [],
    },
};
const careers = [{ id: 'career-a', nom: 'Érudit', rangs: [{ rang: 1, titre: 'Apprenti', caracs: [],
    skills: ['Ancienne compétence'], talents: ['Ancien talent'] }] }];
const skills = [{ group: 'Savoir', spec: 'Guerre', nom: 'Savoir (Guerre)', carac: 'int', basic: false }];
const spells = { catalogVersion: 'sha256:rules', spells: [], miracles: [] };
const data = () => ({ carriere: 'Érudit', rang: '1', xpLog: [{ kind: 'gain', montant: 500 }],
    skillsBasic: {}, basicSpecs: {}, skillsAdvanced: [], talentsAcq: [], chosenVariants: {}, careerOverrides: {} });

test('le moteur composé applique les alias publiés aux achats et aux tarifs carrière', () => {
    const engine = createPublishedCatalogueEngine({ catalogue, careers, skills, spells, talentSheetSnapshot: { entries: [] } });
    const original = data();
    const skill = engine.applyCommand(original, { type: 'purchase', operationId: 'alias-skill', payload: {
        kind: 'skill', name: 'Ancienne compétence', count: 1, expectedCost: 10, catalogVersion: engine.catalogVersion,
    } }, { uid: 'joueur', role: 'joueur' });
    assert.equal(skill.data.skillsAdvanced[0].nom, 'Savoir (Guerre)');
    assert.equal(skill.data.xpLog.at(-1).cout, 10);
    const talent = engine.applyCommand(original, { type: 'purchase', operationId: 'alias-talent', payload: {
        kind: 'talent', name: 'Ancien talent', count: 1, expectedCost: 100, catalogVersion: engine.catalogVersion,
    } }, { uid: 'joueur', role: 'joueur' });
    assert.equal(talent.data.talentsAcq[0].nom, 'Vigilance');
    assert.equal(talent.data.xpLog.at(-1).cout, 100);
    const basic = engine.applyCommand(original, { type: 'purchase', operationId: 'alias-basic', payload: {
        kind: 'skill', name: 'Ancienne attaque', targetId: 'skill-cc-halberd', count: 1,
        expectedCost: 20, catalogVersion: engine.catalogVersion,
    } }, { uid: 'joueur', role: 'joueur' });
    assert.equal(basic.data.skillsBasic['Corps à corps (Base)'], 1);
    assert.equal(basic.data.skillsAdvanced.length, 0);
    assert.deepEqual(original.skillsAdvanced, []);
});

test('un prix ne passe pas avec une version publiée ou magique périmée', () => {
    const engine = createPublishedCatalogueEngine({ catalogue, careers, skills, spells, talentSheetSnapshot: { entries: [] } });
    assert.throws(() => engine.applyCommand(data(), { type: 'purchase', operationId: 'stale', payload: {
        kind: 'skill', name: 'Ancienne compétence', count: 1, expectedCost: 10,
        catalogVersion: 'skills:sha256:old|rules:sha256:rules',
    } }, { uid: 'joueur', role: 'joueur' }), error => error.details?.kind === 'catalog-version-unsupported');
});

test('validatePatch valide les spécialités et variantes depuis le snapshot publié', () => {
    const engine = createPublishedCatalogueEngine({ catalogue, careers, skills, spells, talentSheetSnapshot: { entries: [] } });
    assert.equal(engine.validatePatch(data(), { changes: {
        'basicSpecs.Corps%20%C3%A0%20corps%20%28Base%29': 'Arme d\'hast',
        'chosenVariants.career-a.1': 'Apprenti',
    } }), true);
    assert.throws(() => engine.validatePatch(data(), { changes: {
        'chosenVariants.career-a.1': 'Inconnue',
    } }), error => error.details?.kind === 'career-variant-invalid');
    assert.throws(() => engine.validatePatch(data(), { changes: {
        'basicSpecs.Corps%20%C3%A0%20corps%20%28Base%29': 'Spécialité inventée',
    } }), error => error.details?.kind === 'basic-specialization-invalid');
    assert.throws(() => engine.validatePatch({ ...data(), skillsBasic: { 'Corps à corps (Base)': 1 } }, { changes: {
        'basicSpecs.Corps%20%C3%A0%20corps%20%28Base%29': 'Arme d\'hast',
    } }), error => error.details?.kind === 'specialization-has-advances');
});

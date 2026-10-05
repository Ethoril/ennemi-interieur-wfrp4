import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSkillEntries, collectLegacySkillAliases, createSkillResolver } from '../src/catalogue/skill-resolver.mjs';
import { planSkillMigration, applySkillMigrationDecisions } from '../src/catalogue/skill-migration.mjs';
import { buildTalentEntries, createTalentResolver } from '../src/catalogue/talent-resolver.mjs';

const readJson = path => JSON.parse(readFileSync(new globalThis.URL(path, import.meta.url), 'utf8'));
const skills = readJson('../src/data/skills.json');
const careers = readJson('../src/data/careers.json');
const skillSnapshot = readJson('../src/catalogue/referentiel-public.json').skills;
const talentSnapshot = readJson('../src/catalogue/talents-sheet-snapshot.json');
const allCareerSkills = careers.flatMap(career => career.rangs.flatMap(rank => rank.skills || []));

test('le résolveur serveur construit les mêmes identités et suit les alias historiques publiés', () => {
    const entries = buildSkillEntries(skills);
    const aliases = collectLegacySkillAliases([...skills.map(row => row.nom), ...allCareerSkills], entries);
    const resolver = createSkillResolver({ version: skillSnapshot.version, entries, aliases });
    assert.equal(entries.length, skillSnapshot.entries.length);
    assert.equal(aliases.length, skillSnapshot.aliases.length);
    assert.equal(resolver.resolve('Savoir (Prophéties)').entry.nom, 'Savoir (Prophétie)');
    assert.equal(resolver.resolve('Dressage (Chiens)').aliasProvenance, 'alias-historique-du-site');
    assert.equal(resolver.resolveCareerSlot('Savoir (Région)').open, true);
});

test('plan serveur bloque chaque collision, même à zéro, jusqu’à décision MJ explicite', () => {
    const entries = buildSkillEntries(skills);
    const aliases = collectLegacySkillAliases([...skills.map(row => row.nom), ...allCareerSkills], entries);
    const resolver = createSkillResolver({ version: skillSnapshot.version, entries, aliases });
    const plan = planSkillMigration({ resolver, fromVersion: 'legacy', toVersion: skillSnapshot.version, records: [
        { scopeId: 'bhelgi', collection: 'skillsAdvanced', id: 'old', nom: 'Dressage (Chiens)', advances: 0 },
        { scopeId: 'bhelgi', collection: 'skillsAdvanced', id: 'new', nom: 'Dressage (Chien)', advances: 0 },
    ] });
    assert.equal(plan.collisions.length, 1);
    assert.throws(() => applySkillMigrationDecisions(plan, []), error => error.code === 'decision-required');
});

test('résolveur serveur sépare les descriptions de talent absentes et source indisponible', () => {
    const entries = buildTalentEntries({ sheetSnapshot: talentSnapshot, careers });
    const available = createTalentResolver({ version: 'v1', entries, sheetSnapshot: talentSnapshot });
    assert.equal(available.resolve('Affable').descriptionSource, 'sheet');
    assert.equal(available.resolve('Savoir-vivre (au choix)').descriptionStatus, 'missing-reference');
    const unavailable = createTalentResolver({ version: 'v1', entries, sheetSnapshot: null });
    assert.equal(unavailable.resolve('Affable').descriptionStatus, 'source-unavailable');
});

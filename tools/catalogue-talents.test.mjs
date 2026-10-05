import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildTalentEntries, createTalentResolver } from '../js/catalogue/talent-resolver.js';

const sheet = JSON.parse(readFileSync(new globalThis.URL('../js/catalogue/talents-sheet-snapshot.json', import.meta.url), 'utf8'));
const careers = JSON.parse(readFileSync(new globalThis.URL('../js/data/careers.json', import.meta.url), 'utf8'));

test('le snapshot des talents contient son empreinte et des lignes publiques sans données de fiches', () => {
    assert.match(sheet.catalogVersion, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(sheet.entries.length, 175);
    assert.ok(sheet.entries.every(row => typeof row.nom === 'string' && typeof row.description === 'string'));
    assert.equal(Object.hasOwn(sheet, 'characters'), false);
    assert.equal(Object.hasOwn(sheet, 'uid'), false);
    assert.equal(sheet.catalogVersion, `sha256:${createHash('sha256').update(JSON.stringify(sheet.entries)).digest('hex')}`);
    const entries = buildTalentEntries({ sheetSnapshot: sheet, careers });
    assert.ok(entries.length >= sheet.entries.length);
    assert.ok(entries.every(entry => entry.id && Array.isArray(entry.sources)));
});

test('résolution exacte, alias explicitement publié, statut de source et correction locale prioritaire', () => {
    const entries = buildTalentEntries({ sheetSnapshot: sheet, careers });
    const affable = entries.find(entry => entry.nom === 'Affable');
    const resolver = createTalentResolver({
        version: 'talents-v1', entries,
        aliases: [{ label: 'Talent traduit', targetId: affable.id }],
        localDescriptions: [{ talentId: affable.id, description: 'Description corrigée.' }],
        sheetSnapshot: sheet,
    });
    assert.equal(resolver.resolve('Talent traduit').description, 'Description corrigée.');
    assert.equal(resolver.resolve('Talent traduit').descriptionSource, 'site');
    assert.equal(resolver.resolve('affable').status, 'resolved');
    assert.equal(resolver.resolve('Affablé').status, 'unknown');
    assert.ok(resolver.suggest('Affablé').some(item => item.label === 'Affable'));

    const unavailable = createTalentResolver({ version: 'v1', entries, sheetSnapshot: null });
    assert.equal(unavailable.resolve('Affable').descriptionStatus, 'source-unavailable');
    assert.equal(resolver.resolve('Talent d’une fiche').status, 'unknown');
});

test('description vide et talent absent du tableau restent distincts', () => {
    const entries = buildTalentEntries({ sheetSnapshot: sheet, careers });
    const custom = entries.find(entry => entry.nom === 'Savoir-vivre (au choix)');
    const affable = entries.find(entry => entry.nom === 'Affable');
    const resolver = createTalentResolver({ version: 'v1', entries, sheetSnapshot: sheet,
        localDescriptions: [{ talentId: affable.id, description: '' }] });
    assert.equal(resolver.resolve('Affable').descriptionStatus, 'empty-local');
    assert.equal(resolver.resolve(custom.nom).descriptionStatus, 'missing-reference');
});

test('les modèles spécialisés sont strictement déclarés et ne reposent pas sur un préfixe', () => {
    const entries = [{ id: 'talent-arcane', nom: 'Magie des Arcanes' }];
    const sheetSnapshot = { entries: [{ nom: 'Magie des Arcanes', description: 'Arcanes liées au domaine choisi.' }] };
    const resolver = createTalentResolver({ version: 'v1', entries, sheetSnapshot,
        templates: [{ id: 'arcane-specialization', pattern: 'Magie des Arcanes ({specialization})', descriptionTalentId: 'talent-arcane' }] });
    const specialized = resolver.resolve('Magie des Arcanes (Bêtes)');
    assert.equal(specialized.status, 'resolved');
    assert.equal(specialized.template, true);
    assert.equal(specialized.specialization, 'Bêtes');
    assert.equal(resolver.resolve('Magie des Arcanes Bêtes').status, 'unknown');
    assert.throws(() => createTalentResolver({ version: 'v1', entries, templates: [
        { id: 'bad', pattern: 'Magie des Arcanes ({specialization}) ({specialization})', descriptionTalentId: 'talent-arcane' },
    ] }));
});

test('un alias publié explicite est prioritaire et les cycles restent ambigus', () => {
    const entries = [{ id: 'talent-one', nom: 'Un' }, { id: 'talent-two', nom: 'Deux' }];
    const resolver = createTalentResolver({ version: 'v1', entries, aliases: [
        { label: 'Un', targetId: 'talent-two' },
        { label: 'cycle-a', targetId: 'cycle-b' },
        { label: 'cycle-b', targetId: 'cycle-a' },
    ] });
    assert.equal(resolver.resolve('Un').entry.id, 'talent-two');
    assert.equal(resolver.resolve('cycle-a').status, 'ambiguous');
    assert.ok(resolver.aliasErrors.length >= 2);
});

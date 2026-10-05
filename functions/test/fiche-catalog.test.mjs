import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import catalog from '../src/data/fiche-catalog.json' with { type: 'json' };
import careers from '../src/data/careers.json' with { type: 'json' };
import skills from '../src/data/skills.json' with { type: 'json' };
import { ficheCommandEngine, validateFichePatch } from '../src/domain/fiche/engine.mjs';

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

test('catalogue magique est versionné sur son contenu et ne transporte que sorts et miracles publics', () => {
    assert.match(catalog.catalogVersion, /^sha256:[a-f0-9]{64}$/u);
    const digest = createHash('sha256').update(stableJson({ careers, skills, spells: catalog.spells, miracles: catalog.miracles })).digest('hex');
    assert.equal(catalog.catalogVersion, `sha256:${digest}`);
    assert.ok(catalog.spells.length > 0);
    assert.ok(catalog.miracles.length > 0);
    assert.equal(Object.hasOwn(catalog, 'talents'), false);
    assert.equal(typeof ficheCommandEngine.applyCommand, 'function');
    assert.ok(catalog.spells.every(spell => typeof spell.nom === 'string' && Number.isSafeInteger(spell.cn)));
    assert.ok(catalog.miracles.every(miracle => typeof miracle.nom === 'string'));
});

test('validation des patches protège les bases de coûts et les choix de variante', () => {
    const basic = skills.find(skill => skill.basic && skill.spec);
    assert.ok(basic);
    validateFichePatch({ skillsBasic: { [basic.group]: 0 } }, { changes: { [`basicSpecs.${encodeURIComponent(basic.group)}`]: basic.spec } });
    assert.throws(() => validateFichePatch({ skillsBasic: { [basic.group]: 1 } }, {
        changes: { [`basicSpecs.${encodeURIComponent(basic.group)}`]: basic.spec },
    }), { code: 'failed-precondition' });
    assert.throws(() => validateFichePatch({ skillsBasic: { [basic.group]: 0 } }, {
        changes: { [`basicSpecs.${encodeURIComponent(basic.group)}`]: 'spécialité inventée' },
    }), { code: 'invalid-argument' });

    const career = careers.find(item => item.rangs.filter(rank => rank.rang === 1).length > 1);
    assert.ok(career);
    const variant = career.rangs.find(rank => rank.rang === 1);
    validateFichePatch({}, { changes: { [`chosenVariants.${career.id}.1`]: variant.titre } });
    assert.throws(() => validateFichePatch({}, { changes: { [`chosenVariants.${career.id}.1`]: 'carrière étrangère' } }), { code: 'invalid-argument' });
    assert.throws(() => validateFichePatch({ careers: [{ id: 'other', note: '' }] }, {
        changes: { 'careers.absent.note': 'note' },
    }), { code: 'failed-precondition' });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadMobileFixture, validateMobileFixture } from './mobile-fixture.mjs';

const fixture = await loadMobileFixture();
const copyFixture = () => JSON.parse(JSON.stringify(fixture));
const errorsFor = data => validateMobileFixture(data).join('\n');

test('le jeu fictif couvre exactement le contrat M0-01', () => {
    assert.deepEqual(validateMobileFixture(fixture), []);
    assert.equal(fixture.pnjs.filter(pnj => pnj.visibleJoueurs).length, 4);
    assert.equal(fixture.pnjs_prives.length, 2);
    assert.ok(fixture.relations.every(relation => 'source' in relation && 'cible' in relation));
    assert.ok(fixture.indices.every(indice => Array.isArray(indice.pnjsLies)));
});

test('les références cassées restent explicitement identifiées', () => {
    assert.ok(fixture.relations.some(relation => relation.fixtureCase === 'broken-reference'
        && relation.cible === 'fixture-inexistant'));
});

test('un tableau mal formé est refusé sans parcourir son contenu', () => {
    const data = copyFixture();
    data.pnjs = { id: 'pas-un-tableau' };
    assert.match(errorsFor(data), /pnjs doit être un tableau/);
});

test('des éléments null ou primitifs dans un tableau sont refusés sans exception', () => {
    const data = copyFixture();
    data.pnjs.push(null, 'pas-un-objet');
    const errors = errorsFor(data);
    assert.match(errors, /pnjs\[5\] doit être un objet/);
    assert.match(errors, /pnjs\[6\] doit être un objet/);
});

test('un doublon d’identifiant est refusé', () => {
    const data = copyFixture();
    data.pnjs.push(JSON.parse(JSON.stringify(data.pnjs[0])));
    assert.match(errorsFor(data), /pnjs contient un doublon/);
});

test('un média référencé manquant est refusé', () => {
    const data = copyFixture();
    data.storage = data.storage.filter(file => file.path !== 'indices/fixture-indice-secret/symbole.webp');
    assert.match(errorsFor(data), /média référencé absent/);
});

test('une protection Storage incohérente est refusée', () => {
    const data = copyFixture();
    data.storage.find(file => file.ownerId === 'fixture-masque').shouldBeProtected = false;
    assert.match(errorsFor(data), /protection Storage incorrecte/);
});

test('une note privée dans un PNJ public est refusée', () => {
    const data = copyFixture();
    data.pnjs[0].notes = 'fuite';
    assert.match(errorsFor(data), /fuite privée dans le PNJ public/);
});

test('la clé privateNotes est considérée comme une fuite privée', () => {
    const data = copyFixture();
    data.pnjs[0].privateNotes = 'fuite';
    assert.match(errorsFor(data), /fuite privée dans le PNJ public/);
});

test('une relation publique vers un PNJ masqué est refusée', () => {
    const data = copyFixture();
    data.relations[0].cible = 'fixture-masque';
    data.relations[0].visibleJoueurs = true;
    assert.match(errorsFor(data), /relation publique vers un PNJ masqué ou absent/);
});

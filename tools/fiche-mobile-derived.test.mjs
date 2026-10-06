import test from 'node:test';
import assert from 'node:assert/strict';
import { blessuresMax, caracBonus, caracTotal, mouvement, xpBalance } from '../js/fiche/derived.js';

const caracs = values => Object.fromEntries(
    ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'].map((key, index) => [key, values[index] ?? { base: 30, adv: 0 }]));

// Valeurs attendues recalculées à la main d'après updateBlessuresMax() et recalc() de js/fiche.js :
// B.Force + 2 × B.Endurance + B.Force Mentale + (prises de « Dur à cuire » × B.Endurance).
const humain = {
    race: 'humain',
    carac: caracs([null, null, { base: 28, adv: 3 }, { base: 30, adv: 3 }, null, null, null, null, { base: 29, adv: 3 }]),
    talentsAcq: [{ nom: 'Sociable' }],
};

test('total et bonus de caractéristique', () => {
    assert.equal(caracTotal(humain, 'f'), 31);
    assert.equal(caracBonus(humain, 'f'), 3);
    assert.equal(caracBonus(humain, 'e'), 3);
    assert.equal(caracTotal({}, 'soc'), 0);
    assert.equal(caracBonus({ carac: { soc: { base: 9, adv: 0 } } }, 'soc'), 0);
});

test('blessures maximales d\'un humain : 3 + 2×3 + 3 = 12', () => {
    assert.equal(blessuresMax(humain), 12);
});

test('un halfelin n\'ajoute pas son bonus de Force (2×3 + 3 = 9), « halfling » non plus', () => {
    assert.equal(blessuresMax({ ...humain, race: 'halfelin' }), 9);
    assert.equal(blessuresMax({ ...humain, race: 'halfling' }), 9);
});

test('« Dur à cuire » ajoute le bonus d\'Endurance à chaque prise, sans tenir compte des accents ni de la casse', () => {
    const once = { ...humain, talentsAcq: [{ nom: 'Dur à cuire' }] };
    const twice = { ...humain, talentsAcq: [{ nom: 'Dur à cuire' }, { nom: ' DUR A CUIRE ' }, { nom: 'Sociable' }] };
    assert.equal(blessuresMax(once), 15);
    assert.equal(blessuresMax(twice), 18);
    assert.equal(blessuresMax({ ...twice, race: 'halfelin' }), 15);
});

test('mouvement : table des races, rétrocompatibilité et défaut à 4', () => {
    assert.equal(mouvement({ race: 'nain' }), 3);
    assert.equal(mouvement({ race: 'ogre' }), 6);
    assert.equal(mouvement({ race: 'haut-elfe' }), 5);
    assert.equal(mouvement({ race: 'elfe' }), 5);
    assert.equal(mouvement({ race: 'halfling' }), 4);
    assert.equal(mouvement({ race: 'inconnue' }), 4);
    assert.equal(mouvement({}), 4);
});

test('solde d\'XP : gains, dépenses, valeurs numériques en chaîne', () => {
    const data = {
        xpLog: [
            { kind: 'gain', montant: 250 }, { kind: 'gain', montant: '150' },
            { kind: 'purchase', cout: 155 }, { kind: 'purchase', cout: '100' }, { kind: 'purchase', cout: 'x' },
        ],
    };
    assert.deepEqual(xpBalance(data), { gagne: 400, depense: 255, libre: 145 });
    assert.deepEqual(xpBalance({}), { gagne: 0, depense: 0, libre: 0 });
});

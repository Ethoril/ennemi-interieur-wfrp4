import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { ficheIdentity } from '../js/mobile/fiche-model.js';

const careers = JSON.parse(readFileSync(fileURLToPath(new URL('../js/data/careers.json', import.meta.url)), 'utf8'));

test('identité : carrière, titre et statut du rang courant', () => {
    assert.deepEqual(ficheIdentity({ nom: ' Ilsa ', carriere: 'Agitateur', rang: '1' }, careers),
        { nom: 'Ilsa', carriere: 'Agitateur', titreRang: 'Pamphlétaire', rang: 1, statut: 'Cuivre 1' });
    assert.equal(ficheIdentity({ carriere: 'Agitateur', rang: '2' }, careers).titreRang, 'Agitateur');
});

test('identité : un titre de rang retrouve sa carrière, un rang hors limites est borné', () => {
    assert.equal(ficheIdentity({ carriere: 'Pamphlétaire', rang: '1' }, careers).carriere, 'Agitateur');
    assert.equal(ficheIdentity({ carriere: 'Agitateur', rang: '9' }, careers).rang, 4);
});

test('identité : carrière inconnue ou fiche vide sans exception', () => {
    assert.deepEqual(ficheIdentity({ nom: 'X', carriere: 'Inventée', rang: '3' }, careers),
        { nom: 'X', carriere: 'Inventée', titreRang: '', rang: 3, statut: '' });
    assert.deepEqual(ficheIdentity(null, careers), { nom: '', carriere: '', titreRang: '', rang: 1, statut: '' });
    assert.equal(ficheIdentity({ carriere: 'Agitateur' }).titreRang, '');
});

test('préférence de genre : affichage sans changer la carrière ni la variante', () => {
    const data = { carriere: 'Agitateur', rang: '2', genreAffichage: 'feminin', chosenVariants: {} };
    const original = globalThis.structuredClone(data);
    const identity = ficheIdentity(data, careers);
    assert.equal(identity.carriere, 'Agitatrice');
    assert.equal(identity.titreRang, 'Agitatrice');
    assert.deepEqual(data, original);
    assert.equal(ficheIdentity({ ...data, genreAffichage: 'masculin' }, careers).carriere, 'Agitateur');
});

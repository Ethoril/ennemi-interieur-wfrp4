// Logique pure de l'outil d'ajout de notes MJ par lot (tools/pnj-notes-lot.mjs). Données fictives uniquement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ENTRIES, MAX_NOTES, planNotesLot, validateLot } from './lib/pnj-notes-lot-plan.mjs';

const entree = (extra = {}) => ({ pnjId: 'abc-123', nom: 'Prénom Nom', notes: 'LIGNE UNE\nLIGNE DEUX', ...extra });
const lot = (...entries) => ({ version: 1, entries });
const etat = (extra = {}) => new Map([['abc-123', { exists: true, nom: 'Prénom Nom', notes: '', ...extra }]]);

test('validateLot accepte un lot conforme', () => {
    const l = lot(entree(), entree({ pnjId: 'def_456' }));
    assert.equal(validateLot(l), l);
    assert.doesNotThrow(() => validateLot(lot(entree({ notes: 'x'.repeat(MAX_NOTES) }))));
});

test('validateLot rejette chaque cas invalide avec un message explicite', () => {
    const cas = [
        [null, /objet/],
        [{ version: 2, entries: [entree()] }, /version/],
        [{ version: 1 }, /entries/],
        [{ version: 1, entries: 'abc' }, /entries/],
        [lot(), /entre 1 et 200/],
        [lot(...Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => entree({ pnjId: `id-${i}` }))), /entre 1 et 200/],
        [lot(null), /entrée 1/],
        [lot(entree({ pnjId: 'a b' })), /pnjId/],
        [lot(entree({ pnjId: '' })), /pnjId/],
        [lot(entree({ pnjId: 'a'.repeat(151) })), /pnjId/],
        [lot(entree({ pnjId: 12 })), /pnjId/],
        [lot(entree({ nom: '' })), /nom/],
        [lot(entree({ nom: '   ' })), /nom/],
        [lot(entree({ notes: '' })), /notes/],
        [lot(entree({ notes: undefined })), /notes/],
        [lot(entree({ notes: 'x'.repeat(MAX_NOTES + 1) })), /30000/],
        [lot(entree(), entree()), /en double/],
    ];
    for (const [donnees, motif] of cas) assert.throws(() => validateLot(donnees), motif);
});

test('planNotesLot : write quand les notes existantes sont vides', () => {
    const [a] = planNotesLot(lot(entree()), etat({ notes: '  \n ' }));
    assert.equal(a.action, 'write');
    assert.equal(a.notes, 'LIGNE UNE\nLIGNE DEUX');
    assert.equal(a.pnjId, 'abc-123');
    assert.equal(a.nom, 'Prénom Nom');
    assert.ok(a.reason);
});

test('planNotesLot : append conserve l\'existant intact, sépare par deux sauts de ligne', () => {
    const [a] = planNotesLot(lot(entree()), etat({ notes: 'Existant A\nExistant B  \n\n' }));
    assert.equal(a.action, 'append');
    assert.equal(a.notes, 'Existant A\nExistant B\n\nLIGNE UNE\nLIGNE DEUX');
    assert.ok(a.notes.startsWith('Existant A\nExistant B'));
});

test('planNotesLot : skip-present, y compris fins de ligne \\r\\n et lignes vides en tête', () => {
    const [a] = planNotesLot(lot(entree({ notes: '\n\nLIGNE UNE\nLIGNE DEUX' })), etat({ notes: 'avant\r\nLIGNE UNE\r\nLIGNE DEUX' }));
    assert.equal(a.action, 'skip-present');
    assert.equal(a.notes, undefined);
});

test('planNotesLot : rejouable, la seconde application donne skip-present', () => {
    const premier = planNotesLot(lot(entree()), etat({ notes: 'Existant' }))[0];
    assert.equal(premier.action, 'append');
    const second = planNotesLot(lot(entree()), etat({ notes: premier.notes }))[0];
    assert.equal(second.action, 'skip-present');
    const depuisVide = planNotesLot(lot(entree()), etat())[0];
    assert.equal(planNotesLot(lot(entree()), etat({ notes: depuisVide.notes }))[0].action, 'skip-present');
});

test('planNotesLot : skip-missing quand la fiche n\'existe pas', () => {
    const [a] = planNotesLot(lot(entree()), etat({ exists: false }));
    assert.equal(a.action, 'skip-missing');
    const [b] = planNotesLot(lot(entree()), new Map());
    assert.equal(b.action, 'skip-missing');
});

test('planNotesLot : skip-name-mismatch si le nom de la fiche ne correspond pas', () => {
    const [a] = planNotesLot(lot(entree()), etat({ nom: 'Autre Personne' }));
    assert.equal(a.action, 'skip-name-mismatch');
    assert.equal(a.notes, undefined);
});

test('planNotesLot : garde de nom insensible aux accents et à la casse, dans les deux sens', () => {
    const accents = planNotesLot(lot(entree({ nom: 'Hélène DE-ÉTÉ' })), etat({ nom: 'helene de-ete' }))[0];
    assert.equal(accents.action, 'write');
    const dernierMotDansFiche = planNotesLot(lot(entree({ nom: 'Jean Dupont' })), etat({ nom: 'Dupont-Müller' }))[0];
    assert.equal(dernierMotDansFiche.action, 'write');
    const dernierMotDeFicheDansLot = planNotesLot(lot(entree({ nom: 'Sire Jean Dupont-Muller' })), etat({ nom: 'Jean Muller' }))[0];
    assert.equal(dernierMotDeFicheDansLot.action, 'write');
    const sansLien = planNotesLot(lot(entree({ nom: 'Jean Dupont' })), etat({ nom: 'Jean Martin' }))[0];
    assert.equal(sansLien.action, 'skip-name-mismatch');
});

test('planNotesLot : skip-too-long si le résultat dépasserait 30000 caractères', () => {
    const [a] = planNotesLot(lot(entree({ notes: 'y'.repeat(100) })), etat({ notes: 'x'.repeat(MAX_NOTES - 50) }));
    assert.equal(a.action, 'skip-too-long');
    const [b] = planNotesLot(lot(entree({ notes: 'y'.repeat(100) })), etat({ notes: 'x'.repeat(MAX_NOTES - 102) }));
    assert.equal(b.action, 'append');
    assert.equal(b.notes.length, MAX_NOTES);
});

test('planNotesLot : une action par entrée, dans l\'ordre du lot', () => {
    const l = lot(entree(), entree({ pnjId: 'def-456', nom: 'Autre Personne' }), entree({ pnjId: 'ghi-789' }));
    const etats = new Map([
        ['abc-123', { exists: true, nom: 'Prénom Nom', notes: '' }],
        ['def-456', { exists: true, nom: 'Prénom Nom', notes: '' }],
    ]);
    const plan = planNotesLot(l, etats);
    assert.deepEqual(plan.map(p => [p.pnjId, p.action]), [['abc-123', 'write'], ['def-456', 'skip-name-mismatch'], ['ghi-789', 'skip-missing']]);
});

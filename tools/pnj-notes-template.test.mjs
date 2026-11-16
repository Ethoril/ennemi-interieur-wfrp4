import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_TEMPLATE_LABELS, insertNotesTemplate } from '../js/pnj-notes-template.js';

const GABARIT = NOTES_TEMPLATE_LABELS.map(label => label.padEnd(11, ' ')).join('\n');

test('champ vide ou blanc : le gabarit seul', () => {
    for (const current of ['', '   ', '\n\n \t']) {
        assert.deepEqual(insertNotesTemplate(current), { text: GABARIT, alreadyPresent: false });
    }
});

test('dix libellés dans l’ordre, alignés sur 11 colonnes', () => {
    assert.deepEqual(NOTES_TEMPLATE_LABELS, ['JOUER', 'VEUT', 'SAIT', 'CROIT', 'TENU PAR', 'BASCULE', 'OUVRE', 'VOIX', 'BONUS', 'ABORDER']);
    const lignes = insertNotesTemplate('').text.split('\n');
    assert.equal(lignes.length, 10);
    lignes.forEach((ligne, i) => {
        assert.equal(ligne.length, 11);
        assert.equal(ligne.trimEnd(), NOTES_TEMPLATE_LABELS[i]);
    });
    assert.equal(lignes[0], 'JOUER      ');
    assert.equal(lignes[4], 'TENU PAR   ');
});

test('texte existant conservé en tête, deux sauts de ligne, puis le gabarit', () => {
    const existant = 'Ligne un\n  Ligne deux indentée';
    assert.equal(insertNotesTemplate(existant).text, `${existant}\n\n${GABARIT}`);
});

test('blancs finaux de l’existant retirés', () => {
    assert.equal(insertNotesTemplate('Note  \n\n \t\n').text, `Note\n\n${GABARIT}`);
});

test('alreadyPresent : ligne commençant par JOUER suivi d’un espace ou d’une fin de ligne', () => {
    assert.equal(insertNotesTemplate('Avant\nJOUER  cynique').alreadyPresent, true);
    assert.equal(insertNotesTemplate('Avant\nJOUER').alreadyPresent, true);
    assert.equal(insertNotesTemplate('JOUER\nautre').alreadyPresent, true);
});

test('alreadyPresent faux : JOUER au milieu d’une ligne ou préfixe d’un autre mot', () => {
    assert.equal(insertNotesTemplate('Il faut JOUER finement').alreadyPresent, false);
    assert.equal(insertNotesTemplate('JOUERA bien').alreadyPresent, false);
    assert.equal(insertNotesTemplate('').alreadyPresent, false);
});

test('alreadyPresent vrai : text reste la version complétée', () => {
    const r = insertNotesTemplate('JOUER x');
    assert.equal(r.alreadyPresent, true);
    assert.equal(r.text, `JOUER x\n\n${GABARIT}`);
});

test('null et undefined traités comme vides', () => {
    assert.deepEqual(insertNotesTemplate(null), { text: GABARIT, alreadyPresent: false });
    assert.deepEqual(insertNotesTemplate(undefined), { text: GABARIT, alreadyPresent: false });
});

test('deux applications : la seconde signale alreadyPresent et conserve la première', () => {
    const premiere = insertNotesTemplate('Note');
    assert.equal(premiere.alreadyPresent, false);
    const seconde = insertNotesTemplate(premiere.text);
    assert.equal(seconde.alreadyPresent, true);
    assert.ok(seconde.text.startsWith(premiere.text.trimEnd()));
    assert.equal(seconde.text, `${premiere.text.trimEnd()}\n\n${GABARIT}`);
});

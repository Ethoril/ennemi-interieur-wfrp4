import test from 'node:test';
import assert from 'node:assert/strict';
import { specialtyControlsHtml, freeSpecialtyName } from '../js/fiche-bureau/specialty-html.js';

const group = { kind: 'group', group: 'Langue', options: [{ nom: 'Langue (Tiléen)', spec: 'Tiléen' }, { nom: 'Langue (Reikspiel)', spec: 'Reikspiel' }] };
const basic = { kind: 'basic', row: 'Art', value: 'Peinture', options: ['Peinture', 'Calligraphie'], locked: false };

test('bureau : les spécialités connues d’un groupe sont des boutons visibles, plus un champ « Nouvelle spécialité »', () => {
    const html = specialtyControlsHtml(group, { name: 'Langue (Tiléen)', editable: true });
    assert.doesNotMatch(html, /<select|<datalist|list=/u);
    assert.match(html, /data-action="skill-spec-pick" data-value="Langue \(Tiléen\)" aria-pressed="true"[^>]*>Tiléen</u);
    assert.match(html, /data-action="skill-spec-pick" data-value="Langue \(Reikspiel\)" aria-pressed="false"[^>]*>Reikspiel</u);
    assert.match(html, /Nouvelle spécialité<input id="bureau-skill-free"/u);
    assert.match(html, /data-action="skill-spec-free"/u);
});

test('bureau : spécialités de base en boutons, nouvelle spécialité libre, verrou après avances', () => {
    const html = specialtyControlsHtml(basic, { editable: true });
    assert.doesNotMatch(html, /<select|<datalist|list=/u);
    assert.match(html, /data-action="basic-spec-pick" data-value="Peinture" aria-pressed="true"/u);
    assert.match(html, /data-action="basic-spec-pick" data-value="Calligraphie" aria-pressed="false"/u);
    assert.match(html, /id="bureau-basic-free"/u);
    assert.doesNotMatch(html, /disabled/u);
    for (const locked of [specialtyControlsHtml({ ...basic, locked: true }, { editable: true }), specialtyControlsHtml(basic, { editable: false })]) {
        assert.equal(locked.match(/<button[^>]*>/gu).every(tag => /disabled/u.test(tag)), true);
        assert.match(locked, /<input[^>]* disabled/u);
    }
    assert.match(specialtyControlsHtml({ ...basic, locked: true }, { editable: true }), /aucune avance/u);
});

test('bureau : les valeurs sont échappées', () => {
    const html = specialtyControlsHtml({ ...basic, options: ['<img src=x>'] }, { editable: true });
    assert.doesNotMatch(html, /<img/u);
});

test('bureau : nom libre de groupe, sans parenthèses ni « au choix »', () => {
    assert.equal(freeSpecialtyName('Langue', '  Gobelin '), 'Langue (Gobelin)');
    for (const bad of ['', '  ', 'au choix', 'Au  Choix', 'x (y)', 'x'.repeat(200)]) assert.equal(freeSpecialtyName('Langue', bad), null, bad);
});

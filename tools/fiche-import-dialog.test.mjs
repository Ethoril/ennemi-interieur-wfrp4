import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('l’import demande son motif dans la modale contrôlée et ne dépend pas de window.prompt', async () => {
    const source = await readFile(new globalThis.URL('../js/fiche.js', import.meta.url), 'utf8');
    const start = source.indexOf('async function importFromFile');
    const end = source.indexOf('// Debounce local de 400 ms', start);
    assert.ok(start >= 0 && end > start, 'fonction importFromFile retrouvée');
    const importer = source.slice(start, end);
    assert.match(importer, /confirmTextAction\(/u);
    assert.match(importer, /input:\s*\{\s*label:\s*'Motif de cet import MJ'/u);
    assert.match(importer, /typeof reason !== 'string' \|\| !reason\.trim\(\)/u);
    assert.doesNotMatch(importer, /window\.prompt/u);

    const dialog = await readFile(new globalThis.URL('../js/ui-confirm.js', import.meta.url), 'utf8');
    assert.match(dialog, /\.ui-confirm-input-wrap/u);
    assert.match(dialog, /textInput\.reportValidity\(\)/u);
    assert.match(dialog, /export function confirmTextAction/u);
});

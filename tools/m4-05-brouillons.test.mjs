import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPublicDraftStore, KEY_PREFIX, MAX_AGE_MS } from '../js/mobile/drafts-store.js';

function storage(initial = []) {
    const map = new Map(initial); return {
        get length() { return map.size; }, key: index => [...map.keys()][index] ?? null,
        getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map,
    };
}

test('le brouillon local ne persiste que les champs publics allowlistés', () => {
    let clock = 1000; const backend = storage(); const store = createPublicDraftStore({ storage: backend, now: () => clock });
    const result = store.save({ nom: 'Ada', description: 'Ligne\nDeux', visibleJoueurs: true, notes: 'secret', imagePath: 'portraits/a/x.webp', blob: {} }, { pnjId: 'a' });
    assert.equal(result.ok, true); assert.equal(result.draft.pnjId, 'a'); assert.match(result.draft.draftId, /^draft:/u);
    const raw = [...backend.map.values()][0]; assert.doesNotMatch(raw, /secret|portraits|blob|imagePath|notes/u); assert.deepEqual(Object.keys(result.draft.values).sort(), ['description', 'nom', 'visibleJoueurs']);
    clock += 10; assert.equal(store.find('a').values.nom, 'Ada');
});

test('format hostile, version ancienne et âge dépassé sont ignorés puis purgés', () => {
    let clock = 10_000; const backend = storage([
        [`${KEY_PREFIX}old`, JSON.stringify({ version: 0, draftId: 'draft:abcdefgh', updatedAt: clock, values: { nom: 'x' } })],
        [`${KEY_PREFIX}bad`, '{not-json'],
        [`${KEY_PREFIX}age`, JSON.stringify({ version: 1, draftId: 'draft:abcdefgh', pnjId: null, updatedAt: clock - MAX_AGE_MS - 1, values: { nom: 'x' } })],
    ]); const store = createPublicDraftStore({ storage: backend, now: () => clock });
    assert.deepEqual(store.list(), []); assert.equal(backend.map.size, 0);
});

test('limite le nombre, conserve l’identifiant de création et efface explicitement', () => {
    let clock = 100; const backend = storage(); const store = createPublicDraftStore({ storage: backend, now: () => clock }); let first = null;
    for (let index = 0; index < 15; index += 1) { const saved = store.save({ nom: `PNJ ${index}` }, { pnjId: null }); if (index === 0) first = saved.draft; clock += 1; }
    assert.equal(store.list().length, 12); const updated = store.save({ nom: 'Modifié' }, { draftId: first.draftId, pnjId: null }); assert.equal(updated.ok, true); assert.equal(store.find(null).values.nom, 'Modifié');
    assert.equal(store.clear(), 12); assert.equal(store.list().length, 0);
});

test('quota ou stockage indisponible ne transforme pas le brouillon en fausse synchronisation', () => {
    const unavailable = createPublicDraftStore({ storage: null }); assert.equal(unavailable.save({ nom: 'Ada' }).ok, false);
    const backend = storage(); backend.setItem = () => { throw new Error('quota'); }; const store = createPublicDraftStore({ storage: backend });
    assert.deepEqual(store.save({ nom: 'Ada' }), { ok: false, reason: 'quota' });
});

test('les valeurs de type array/object/undefined sont refusées sans coercition', () => {
    const store = createPublicDraftStore({ storage: storage() });
    assert.equal(store.save({ nom: ['Ada'] }).ok, false); assert.equal(store.save({ nom: undefined }).ok, false); assert.equal(store.save({ description: {} }).ok, false);
});

test('un brouillon sans champ public n’est jamais confirmé', () => {
    const store = createPublicDraftStore({ storage: storage(), now: () => 100 });
    const result = store.save({ notes: 'privé', imagePath: 'portraits/a/x.webp' });
    assert.equal(result.ok, false); assert.equal(result.reason, 'invalid'); assert.equal(result.draft, undefined);
});

test('les dates, enums et clés incohérentes sont refusées puis réellement purgées', () => {
    let clock = 1_000; const backend = storage([
        [`${KEY_PREFIX}hostile`, JSON.stringify({ version: 1, draftId: 'draft:abcdefgh', pnjId: null, createdAt: clock, updatedAt: clock, values: { nom: 'faux' } })],
        [`${KEY_PREFIX}bad-date`, JSON.stringify({ version: 1, draftId: 'draft:abcdefgh', pnjId: null, createdAt: 'now', updatedAt: clock, values: { nom: 'faux' } })],
        [`${KEY_PREFIX}bad-enum`, JSON.stringify({ version: 1, draftId: 'draft:bad-enum', pnjId: null, createdAt: clock, updatedAt: clock, values: { nom: 'faux', statut: 'admin' } })],
    ]); const store = createPublicDraftStore({ storage: backend, now: () => clock });
    assert.deepEqual(store.list(), []); assert.equal(backend.map.size, 0);
    assert.equal(store.save({ nom: 'A', statut: 'admin' }).ok, false);
    assert.equal(store.save({ nom: 'A', statut: 'inconnu' }).ok, false);
    assert.equal(store.save({ nom: 'A', vivant: 'maybe' }).ok, false);
});

test('le refus de restauration ne supprime pas le brouillon', () => {
    const backend = storage(); const store = createPublicDraftStore({ storage: backend, now: () => 100 });
    const saved = store.save({ nom: 'Conserver' }); assert.equal(saved.ok, true);
    assert.equal(store.find(null)?.values.nom, 'Conserver');
    // L’UI peut refuser une restauration sans transformer ce choix en abandon.
    assert.equal(store.list().length, 1);
});

test('la release M4-05 aligne meta/cache/changelog et garde /app hors annonce', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const read = name => fs.readFileSync(path.join(root, name), 'utf8');
    const html = read('app/index.html');
    const layout = read('js/layout.js');
    const sw = read('sw.js');
    const changelog = read('CHANGELOG.md');
    assert.match(html, /app-version" content="v2\.21\.8"/u);
    assert.match(layout, /APP_VERSION = 'v2\.21\.8'/u); assert.match(sw, /APP_VERSION = 'v2\.21\.8'/u);
    assert.match(changelog, /^## \[2\.21\.8\]/mu);
    const currentEntry = changelog.match(/^## \[2\.19\.0\][\s\S]*?(?=^## \[2\.18\.0\])/mu)?.[0] ?? '';
    assert.doesNotMatch(currentEntry, /\/app/iu);
    assert.match(read('js/mobile/app.js'), /drafts-store\.js/u);
});

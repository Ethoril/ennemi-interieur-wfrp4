import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createFicheCommandEngine } from '../js/fiche/commands.js';
import { BASE_KEYWORDS } from '../js/data/creature-keywords.js';
import { FICHE_EXPORT_KEYS } from '../js/fiche/export-import.js';
import {
    counterError, familiersError, familiersResume, migrerFicheV5, motsClesError, motsClesResume, MOT_CLE_CIBLES, v5FieldError,
} from '../js/fiche/v5.js';

const homoncule = { id: 'fam_1', systeme: 'homunculus', type: 'spell', vent: 'ulgu', espece: null, nom: 'Brindille', destinSacrifie: 1 };
const animal = { id: 'fam_2', systeme: 'animal', type: 'power', vent: null, espece: 'raven', nom: 'Noiraude', destinSacrifie: 3 };

test('compteurs Fortune, Péché, Corruption : chaîne de chiffres, vide accepté', () => {
    for (const value of ['', '0', '3', '9999']) assert.equal(counterError(value), null, value);
    for (const value of ['-1', '1.5', 'deux', 3, null, '10000']) assert.ok(counterError(value), String(value));
    for (const path of ['fortune', 'peche', 'corruption']) assert.ok(v5FieldError(path, '-2'), path);
    assert.equal(v5FieldError('possessions', 'texte libre'), null, 'les autres champs ne sont pas concernés');
});

test('familiers : homoncule avec Vent, animal toujours de puissance avec espèce, Destin sacrifié ≥ 1', () => {
    assert.equal(familiersError([]), null);
    assert.equal(familiersError([homoncule, animal]), null);
    for (const type of ['combat', 'power', 'spell']) assert.equal(familiersError([{ ...homoncule, type }]), null, type);
    const refused = [
        [{ ...animal, type: 'combat' }, /toujours de puissance/u],
        [{ ...animal, espece: 'dragon' }, /espèce/u],
        [{ ...animal, vent: 'azyr' }, /pas de Vent/u],
        [{ ...homoncule, vent: null }, /Vent/u],
        [{ ...homoncule, vent: 'dhar' }, /Vent/u],
        [{ ...homoncule, espece: 'cat' }, /pas d’espèce/u],
        [{ ...homoncule, systeme: 'demon' }, /système/u],
        [{ ...homoncule, destinSacrifie: 0 }, /Destin/u],
        [{ ...homoncule, destinSacrifie: '1' }, /Destin/u],
        [{ ...homoncule, resilience: 1 }, /familier invalide/u],
        [{ ...homoncule, id: '' }, /identifiant/u],
    ];
    for (const [row, message] of refused) assert.match(familiersError([row]), message, JSON.stringify(row));
    assert.match(familiersError([homoncule, { ...animal, id: homoncule.id }]), /identifiant/u, 'identifiants uniques');
    assert.ok(familiersError({}), 'une liste est attendue');
});

test('mots-clés : type connu, cible du référentiel de l’outil, sans doublon', () => {
    assert.equal(motsClesError([{ id: 'haine', cible: 'peaux-vertes' }, { id: 'sans-peur', cible: 'chien' }, { id: 'haine', cible: 'skaven' }]), null);
    assert.ok(motsClesError([{ id: 'haine', cible: 'peaux-vertes' }, { id: 'haine', cible: 'peaux-vertes' }]));
    assert.ok(motsClesError([{ id: 'colere', cible: 'nain' }]));
    assert.ok(motsClesError([{ id: 'haine', cible: 'Peaux-vertes' }]), 'identifiant, pas libellé');
    assert.ok(motsClesError([{ id: 'haine', cible: 'nain', note: 'x' }]));
    assert.equal(Object.keys(MOT_CLE_CIBLES).length, BASE_KEYWORDS.length);
    assert.equal(motsClesResume({ motsCles: [{ id: 'prejuge', cible: 'etranger' }, { id: 'animosite', cible: 'elfe' }] }), 'Préjugé (Étranger), Animosité (Elfe)');
    assert.equal(familiersResume({ familiers: [homoncule, animal] }),
        'Familiers : Brindille (Homoncule, Familier de sort, Ulgu) ; Noiraude (Familier animal, Familier de puissance, Corbeau)');
    assert.equal(familiersResume({}), '');
});

test('référentiel des mots-clés identique à celui de l’outil MJ quand son dépôt est présent', t => {
    const tool = 'E:/Outil MJ Warhammer/js/data/creature-keywords.js';
    if (!existsSync(tool)) { t.skip('dépôt de l’outil absent'); return; }
    const local = readFileSync(new globalThis.URL('../js/data/creature-keywords.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
    assert.equal(local.split('\n').slice(2).join('\n'), readFileSync(tool, 'utf8').replaceAll('\r\n', '\n'));
});

test('migration : Fortune reprend Chance sans rien effacer, idempotente', () => {
    const legacy = { destin: '3', chance: '2', resilience: '1', determination: '0' };
    const migrated = migrerFicheV5(legacy);
    assert.deepEqual(migrated, { ...legacy, fortune: '2' });
    assert.equal(legacy.fortune, undefined, 'source intacte');
    assert.equal(migrerFicheV5(migrated), migrated);
    const already = { chance: '2', fortune: '0' };
    assert.equal(migrerFicheV5(already), already, 'Fortune déjà saisie : Chance ignorée');
    const fresh = { destin: '1' };
    assert.equal(migrerFicheV5(fresh), fresh);
    assert.equal(migrerFicheV5(null), null);
});

test('import : nouveaux champs acceptés et validés, anciens exports avec Chance relus', () => {
    assert.ok(['fortune', 'peche', 'familiers', 'motsCles', 'chance'].every(key => FICHE_EXPORT_KEYS.includes(key)));
    const engine = createFicheCommandEngine({ careers: [], catalogVersion: 'v5-test' });
    const run = data => engine.applyCommand({}, {
        type: 'import', operationId: 'import-v5', charId: 'test', baseRevision: 0, payload: { reason: 'Import V5', data },
    }, { uid: 'mj-1', role: 'mj', catalogVersion: 'v5-test' });
    const data = { nom: 'Ilsa', fortune: '2', peche: '1', familiers: [homoncule], motsCles: [{ id: 'haine', cible: 'mutant' }] };
    assert.deepEqual(run(data).data.familiers, [homoncule]);
    assert.equal(run({ nom: 'Ilsa', chance: '2', resilience: '1' }).data.chance, '2');
    assert.throws(() => run({ ...data, familiers: [{ ...animal, type: 'spell' }] }), /familiers/u);
    assert.throws(() => run({ ...data, motsCles: [{ id: 'haine', cible: 'inconnu' }] }), /motsCles/u);
    assert.throws(() => run({ ...data, peche: '-1' }), /peche/u);
});

test('contrôleur : la fiche lue est migrée, un patch Fortune part avec l’ancienne Chance pour base', async () => {
    const { createFicheController } = await import('../js/fiche-controller.js');
    const { createFicheDraftStore } = await import('../js/fiche-draft-store.js');
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
        key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
    const listeners = [];
    const sent = [];
    const repository = {
        subscribe(_id, next) { listeners.push(next); return () => {}; },
        async execute(command) { sent.push(command); return { revision: 2 }; },
    };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage }), isOnline: () => true, receiptTimeoutMs: 1 });
    controller.setSession({ uid: 'u', charId: 'test', role: 'joueur' });
    for (const next of listeners) next({ exists: true, envelope: { schemaVersion: 2, revision: 1, tombstone: false, data: { destin: '3', chance: '2' } } });
    assert.equal(controller.getState().data.fortune, '2');
    assert.equal(controller.stagePatch({ familiers: [homoncule], fortune: '1' }).ok, true);
    assert.deepEqual(controller.stagePatch({ chance: '1' }), { ok: false, reason: 'field-forbidden' }, 'Chance n’est plus modifiable');
    await controller.submitPatch();
    assert.deepEqual(sent[0].payload, { changes: { fortune: '1', familiers: [homoncule] }, baseValues: { fortune: '2', familiers: null } });
    controller.close();
});

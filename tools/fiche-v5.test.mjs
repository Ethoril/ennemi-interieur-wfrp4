import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createFicheCommandEngine } from '../js/fiche/commands.js';
import { BASE_KEYWORDS } from '../js/data/creature-keywords.js';
import { FICHE_EXPORT_KEYS } from '../js/fiche/export-import.js';
import { MONTURES_FICHES } from '../js/data/montures-fiches.js';
import {
    counterError, familiersError, familiersResume, migrerFicheV5, MONTURE_INCONNUE, montureAEnvoyer, montureError, montureResume, motsClesError, motsClesResume, MOT_CLE_CIBLES, MOT_CLE_TYPES, v5FieldError,
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

test('monture : null (retrait) ou { espece de la liste fermée, nom facultatif de 200 caractères au plus }, rien d’autre', () => {
    const { cle, libelle } = MONTURES_FICHES[0];
    assert.equal(montureError({ espece: cle }), null, 'sans nom');
    assert.equal(montureError({ espece: cle, nom: 'Pie' }), null, 'avec nom');
    assert.equal(montureError({ espece: cle, nom: 'x'.repeat(200) }), null, '200 caractères');
    assert.equal(montureError(null), null, 'retrait explicite');
    assert.ok(MONTURES_FICHES.every(monture => montureError({ espece: monture.cle }) === null), 'toute la liste est acceptée');
    for (const value of [{ espece: 'inconnue' }, { espece: libelle }, { espece: 3 }, {}, { nom: 'Pie' }, { espece: cle, nom: 'x'.repeat(201) },
        { espece: cle, nom: 4 }, { espece: cle, nom: null }, { espece: cle, pv: 10 }, 'cheval', [], 0, undefined]) {
        assert.ok(montureError(value), JSON.stringify(value));
    }
    assert.equal(v5FieldError('monture', null), null);
    assert.ok(v5FieldError('monture', { espece: 'inconnue' }));
    assert.equal(montureResume({ monture: { espece: cle, nom: 'Pie' } }), `Monture : Pie (${libelle})`);
    assert.equal(montureResume({ monture: { espece: cle } }), `Monture : ${libelle}`);
    assert.equal(montureResume({ monture: { espece: 'disparue', nom: 'Pie' } }), 'Monture : Pie (monture inconnue)');
    assert.equal(montureResume({ monture: { espece: 'disparue' } }), 'Monture : monture inconnue');
    assert.equal(montureResume({ monture: null }), '');
    assert.equal(montureResume({}), '');
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

test('mots-clés : copies générées par l’outil MJ, intactes (en-tête et empreinte), sans le dépôt de l’outil', () => {
    for (const file of ['creature-keywords.js', 'mots-cles-types.js']) {
        const text = readFileSync(new globalThis.URL(`../js/data/${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
        const [first, second, ...rest] = text.split('\n');
        assert.match(first, /^\/\/ Fichier généré par node tools\/build-fiche-keywords\.mjs depuis l'outil MJ \(commit [0-9a-f]{7}\)/, file);
        const sha = second.match(/sha256 du corps : ([0-9a-f]{64})$/)?.[1];
        assert.ok(sha, `${file} : empreinte absente`);
        assert.equal(createHash('sha256').update(rest.join('\n')).digest('hex'), sha, `${file} modifié à la main : régénérer depuis l’outil`);
    }
    assert.deepEqual(Object.keys(MOT_CLE_TYPES), ['haine', 'animosite', 'prejuge', 'sans-peur']);
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
    assert.ok(['fortune', 'peche', 'familiers', 'monture', 'motsCles', 'chance'].every(key => FICHE_EXPORT_KEYS.includes(key)));
    const engine = createFicheCommandEngine({ careers: [], catalogVersion: 'v5-test' });
    const run = data => engine.applyCommand({}, {
        type: 'import', operationId: 'import-v5', charId: 'test', baseRevision: 0, payload: { reason: 'Import V5', data },
    }, { uid: 'mj-1', role: 'mj', catalogVersion: 'v5-test' });
    const data = { nom: 'Ilsa', fortune: '2', peche: '1', familiers: [homoncule], motsCles: [{ id: 'haine', cible: 'mutant' }] };
    assert.deepEqual(run(data).data.familiers, [homoncule]);
    assert.equal(run({ nom: 'Ilsa', chance: '2', resilience: '1' }).data.chance, '2');
    const monture = { espece: MONTURES_FICHES[0].cle, nom: 'Pie' };
    assert.deepEqual(run({ ...data, monture }).data.monture, monture, 'la monture survit à un import');
    assert.equal(run({ ...data, monture: null }).data.monture, null, 'le retrait aussi');
    assert.throws(() => run({ ...data, monture: { espece: 'inconnue' } }), /monture/u);
    assert.throws(() => run({ ...data, familiers: [{ ...animal, type: 'spell' }] }), /familiers/u);
    assert.throws(() => run({ ...data, motsCles: [{ id: 'haine', cible: 'inconnu' }] }), /motsCles/u);
    assert.throws(() => run({ ...data, peche: '-1' }), /peche/u);
});

test('bureau : espèce inconnue + frappe dans le nom = rien d’envoyé ; choix explicite = objet ou null', () => {
    const { cle } = MONTURES_FICHES[0];
    assert.equal(montureAEnvoyer(MONTURE_INCONNUE, 'Pie'), undefined);
    assert.deepEqual(montureAEnvoyer(cle, 'Pie'), { espece: cle, nom: 'Pie' });
    assert.deepEqual(montureAEnvoyer(cle, ''), { espece: cle });
    assert.equal(montureAEnvoyer('', 'Pie'), null);
});

test('contrôleur : monture accepte null, aucun autre champ ne l’accepte', async () => {
    const { createFicheController } = await import('../js/fiche-controller.js');
    const { createFicheDraftStore } = await import('../js/fiche-draft-store.js');
    const values = new Map();
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key),
        key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
    const listeners = [];
    const sent = [];
    const repository = { subscribe(_id, next) { listeners.push(next); return () => {}; }, async execute(command) { sent.push(command); return { revision: 2 }; } };
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore({ storage }), isOnline: () => true, receiptTimeoutMs: 1 });
    controller.setSession({ uid: 'u', charId: 'test', role: 'joueur' });
    const monture = { espece: MONTURES_FICHES[0].cle };
    for (const next of listeners) next({ exists: true, envelope: { schemaVersion: 2, revision: 1, tombstone: false, data: { destin: '3', monture } } });
    assert.equal(controller.stagePatch({ monture: null }).ok, true);
    assert.deepEqual(controller.stagePatch({ fortune: null }), { ok: false, reason: 'field-forbidden' });
    await controller.submitPatch();
    assert.deepEqual(sent[0].payload, { changes: { monture: null }, baseValues: { monture } });
    controller.close();
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

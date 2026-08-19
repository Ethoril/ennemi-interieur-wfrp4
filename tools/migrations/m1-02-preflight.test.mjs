import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, validateSnapshot, validateTarget } from './m1-02-preflight.mjs';

const timestamp = { seconds: 1, nanoseconds: 0 };
const validPnj = (id, visibleJoueurs = true) => ({ id, data: {
    nom: id, visibleJoueurs, createdAt: timestamp, updatedAt: timestamp,
} });

test('préflight accepte le contrat M1-01 valide sans écrire', () => {
    const result = validateSnapshot({
        pnjs: [validPnj('public'), validPnj('hidden', false)],
        relations: [{ id: 'relation-hidden', data: {
            source: 'public', cible: 'hidden', type: 'secret', visibleJoueurs: false,
            createdAt: timestamp, updatedAt: timestamp,
        } }],
        indices: [{ id: 'indice', data: {
            titre: 'Indice', decouvert: false, pnjsLies: ['hidden'],
            createdAt: timestamp, updatedAt: timestamp,
        } }],
        pnjs_prives: [{ id: 'hidden', data: { notes: 'privé', updatedAt: timestamp } }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.signaux.length, 0);
});

test('préflight détecte les fuites, types et références sans imprimer les notes', () => {
    const secret = 'NE_DOIT_JAMAIS_SORTIR';
    const result = validateSnapshot({
        pnjs: [{ id: 'masked', data: {
            nom: 'Masqué', visibleJoueurs: false, createdAt: timestamp, updatedAt: timestamp,
            notesMJ: secret, champInconnu: true,
        } }],
        relations: [{ id: 'public-bad', data: {
            source: 'masked', cible: 'absent', type: 'rumeur', visibleJoueurs: true,
            createdAt: timestamp, updatedAt: timestamp,
        } }],
        indices: [{ id: 'indice-bad', data: {
            titre: 'Indice', decouvert: true, pnjsLies: ['masked', 42],
            createdAt: timestamp, updatedAt: timestamp,
        } }],
        pnjs_prives: [{ id: 'orphan', data: { notes: secret, updatedAt: timestamp } }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.signaux.some(signal => signal.includes('legacy-prive-notesMJ')));
    assert.ok(result.signaux.some(signal => signal.includes('source-masque')));
    assert.ok(result.signaux.some(signal => signal.includes('cible-inexistante')));
    assert.ok(result.signaux.some(signal => signal.includes('pnjsLies-1-invalide')));
    assert.ok(result.signaux.some(signal => signal.includes('orphelin')));
    assert.equal(result.signaux.some(signal => signal.includes(secret)), false);
});

test('préflight contrôle dateDecouverte, ordre et limites des liens', () => {
    const links = Array.from({ length: 101 }, () => 'public');
    const result = validateSnapshot({
        pnjs: [validPnj('public')], relations: [], pnjs_prives: [],
        indices: [{ id: 'bad', data: {
            titre: 'Indice', decouvert: true, pnjsLies: links,
            dateDecouverte: 'hier', ordre: 'premier', createdAt: timestamp, updatedAt: timestamp,
        } }],
    });
    assert.ok(result.signaux.includes('indices/bad:pnjsLies-invalide'));
    assert.ok(result.signaux.includes('indices/bad:dateDecouverte-invalide'));
    assert.ok(result.signaux.includes('indices/bad:ordre-invalide'));
});

test('préflight reste robuste sur documents primitifs et types optionnels invalides', () => {
    const result = validateSnapshot({
        pnjs: [null, { id: 'bad', data: null }, { id: 'p', data: {
            nom: 'PNJ', visibleJoueurs: true, createdAt: timestamp, updatedAt: timestamp,
            statut: 1, description: null, imageUrl: [], ordre: 'un',
        } }],
        relations: [{ id: 'r', data: {
            source: 'p', cible: 'p', type: 'ok', label: null, color: 4, visibleJoueurs: false,
            createdAt: timestamp, updatedAt: timestamp,
        } }],
        indices: [{ id: 'i', data: {
            titre: 'Indice', description: null, imagePath: 4, source: null, type: [],
            decouvert: false, pnjsLies: [], createdAt: timestamp, updatedAt: timestamp,
        } }],
        pnjs_prives: [],
    });
    assert.equal(result.ok, false);
    assert.ok(result.signaux.includes('pnjs/p:statut-invalide'));
    assert.ok(result.signaux.includes('pnjs/p:description-invalide'));
    assert.ok(result.signaux.includes('relations/r:label-invalide'));
    assert.ok(result.signaux.includes('indices/i:source-invalide'));
});

test('préflight exige des timestamps strictement numériques et bornés', () => {
    const result = validateSnapshot({
        pnjs: [{ id: 'bad-time', data: {
            nom: 'PNJ', visibleJoueurs: true,
            createdAt: { seconds: '1', nanoseconds: 0 },
            updatedAt: { seconds: 1, nanoseconds: 1000000000 },
        } }], relations: [], indices: [], pnjs_prives: [],
    });
    assert.ok(result.signaux.includes('pnjs/bad-time:createdAt-invalide'));
    assert.ok(result.signaux.includes('pnjs/bad-time:updatedAt-invalide'));
});

test('la collecte du préflight n utilise que des lectures', async () => {
    const calls = [];
    const db = { collection(name) {
        return { get: async () => {
            calls.push(`get:${name}`);
            return { docs: [] };
        } };
    } };
    const result = await readSnapshot(db);
    assert.deepEqual(Object.keys(result).sort(), ['indices', 'pnjs', 'pnjs_prives', 'relations']);
    assert.deepEqual(calls, ['get:pnjs', 'get:relations', 'get:indices', 'get:pnjs_prives']);
});

test('cible production exige une confirmation de lecture explicite', () => {
    const options = { project: 'campagne-wrpg', bucket: 'campagne-wrpg.firebasestorage.app', execute: false };
    assert.ok(validateTarget(options, { env: {} }).some(error => error.includes('confirm-production')));
    assert.deepEqual(validateTarget({ ...options, confirmProduction: 'campagne-wrpg' }, { env: {} }), []);
    assert.ok(validateTarget({ ...options, confirmProduction: 'campagne-wrpg', execute: true }, { env: {} }).some(error => error.includes('--execute')));
});

test('hors production le préflight exige l émulateur', () => {
    const options = { project: 'demo-m1-02', bucket: 'demo-m1-02.appspot.com', execute: false };
    assert.ok(validateTarget(options, { env: {} }).some(error => error.includes('FIRESTORE_EMULATOR_HOST')));
    assert.deepEqual(validateTarget(options, { env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } }), []);
});

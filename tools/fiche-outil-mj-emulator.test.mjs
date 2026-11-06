// Chantier H, T3 : lancé par tools/fiche-outil-mj-emulator.mjs (npm run test:outil-mj-emulator).
// Appelle la vraie fonction callable `executeFicheCommand` sous l'émulateur Functions, en HTTP, comme le SDK client.
// L'émulateur ne vérifie pas la signature des jetons (skipTokenVerification) mais exige leur présence :
// App Check reste imposé (un appel sans jeton App Check est refusé, voir le premier scénario).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import equipmentCatalogue from '../js/data/equipment-catalog.json' with { type: 'json' };

const projectId = process.env.GCLOUD_PROJECT || '';
const functionUrl = process.env.OUTIL_MJ_FUNCTIONS_URL || '';
if (projectId !== 'demo-outil-mj' || !process.env.FIRESTORE_EMULATOR_HOST || !functionUrl.startsWith('http://127.0.0.1:')
    || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_QUOTA_PROJECT) {
    throw new Error('Recette refusée : exige demo-outil-mj, FIRESTORE_EMULATOR_HOST et l’émulateur Functions local, sans identifiants ADC.');
}

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../functions/package.json'));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }, `outil-mj-emulator-${Date.now()}`);
const db = getFirestore(app);

const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsignedJwt = payload => `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.c2lnbmF0dXJl`;
const now = Math.floor(Date.now() / 1000);
const idToken = (uid, email) => unsignedJwt({ sub: uid, email, email_verified: true, iat: now, exp: now + 3600,
    aud: projectId, iss: `https://securetoken.google.com/${projectId}` });
const MJ = idToken('mj-1', 'ethoril@gmail.com');
const PLAYER = idToken('player-1', 'player@example.test');
const APP_CHECK = unsignedJwt({ sub: '1:000000000000:web:demo', iat: now, exp: now + 3600 });

async function call(command, token, { appCheck = APP_CHECK } = {}) {
    const response = await fetch(functionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(appCheck ? { 'X-Firebase-AppCheck': appCheck } : {}) },
        body: JSON.stringify({ data: command }),
    });
    const body = await response.json();
    return { status: response.status, result: body.result, error: body.error };
}

const PRIERE = { id: 'priere', nom: 'Prière', carac: 'fm', adv: 10 };
const BENI = { id: 't-beni', nom: 'Béni (Sigmar)', note: '' };
const MARTEAU = { ...equipmentCatalogue.items.find(item => item.kind === 'weapon'), id: 'eq-1' };
const PENITENCE = { id: 'outil:pen-1', categorie: 'penitence', libelle: 'Jeûne de Sigmar', detail: 'Sept jours sans viande.' };

function outilMj(changes, { sendId, baseRevision, undoOf }) {
    return { charId: 'bhelgi', operationId: `outilmj-${sendId}-bhelgi`, baseRevision, type: 'outil-mj',
        payload: { reason: 'Fin de séance du 06/11 (outil MJ)', sendId, ...(undoOf ? { undoOf } : {}), changes } };
}
const invert = changes => changes.map(change => ({ ...change, base: change.value, value: change.base }));
const fiche = async () => (await db.doc('fiches/bhelgi').get()).data();

test('outil-mj de bout en bout : fonction réelle, Firestore émulé', async t => {
    t.after(async () => { await deleteApp(app); });
    await db.doc('campagne/acces').set({ bhelgi: ['player@example.test'], caelel: [], elysia: [], hellaya: [], wren: [] });
    await db.doc('fiches/bhelgi').set({ schemaVersion: 2, revision: 0, data: {
        nom: 'Bhelgi', race: 'Nain', destin: '2', fortune: '1', peche: '0', corruption: '3', possessions: '',
        carac: { ag: { base: 30, adv: 5 } }, skillsAdvanced: [PRIERE], talentsAcq: [BENI], equipment: [MARTEAU], xpLog: [],
        optVisible: { 'section-sorts': false, 'section-prieres': false },
    } });

    const send = [
        { op: 'counter', field: 'fortune', base: '1', value: '2', label: 'Fortune gagnée' },
        { op: 'counter', field: 'destin', base: '2', value: '1', label: 'Création du familier' },
        { op: 'carac', carac: 'ag', base: 30, value: 25, label: 'Séquelle : pied perdu' },
        { op: 'skill-adv', id: 'priere', base: 10, value: 0, label: 'Excommunication' },
        { op: 'row', collection: 'talentsAcq', id: 't-beni', base: BENI, value: null, label: 'Excommunication' },
        { op: 'row', collection: 'equipment', id: 'eq-1', base: MARTEAU, value: null, label: 'Courroux : objet retenu' },
        { op: 'suivi', id: PENITENCE.id, base: null, value: PENITENCE, label: 'Pénitence imposée' },
    ];
    const request = outilMj(send, { sendId: 'send-1', baseRevision: 0 });

    await t.test('App Check imposé : sans jeton App Check, refus', async () => {
        const response = await call(request, MJ, { appCheck: null });
        assert.equal(response.error?.status, 'UNAUTHENTICATED');
        assert.equal((await fiche()).revision, 0);
    });

    await t.test('CA8 : un joueur est refusé, même sur sa propre fiche', async () => {
        const response = await call(request, PLAYER);
        assert.equal(response.error?.status, 'PERMISSION_DENIED');
        assert.equal((await fiche()).revision, 0);
    });

    await t.test('MJ accepté ; historique avant/après ; rejeu sans double application (CA6, CA9)', async () => {
        const response = await call(request, MJ);
        assert.deepEqual(response.result, { operationId: 'outilmj-send-1-bhelgi', charId: 'bhelgi', revision: 1 });
        const { data, revision } = await fiche();
        assert.equal(revision, 1);
        assert.equal(data.fortune, '2');
        assert.equal(data.destin, '1');
        assert.deepEqual(data.carac.ag, { base: 25, adv: 5 });
        assert.equal(data.skillsAdvanced[0].adv, 0);
        assert.deepEqual(data.talentsAcq, []);
        assert.deepEqual(data.equipment, []);
        assert.deepEqual(data.suiviMj, [PENITENCE]);
        const history = (await db.doc('fiches/bhelgi/history/outilmj-send-1-bhelgi').get()).data();
        assert.equal(history.type, 'outil-mj');
        assert.equal(history.reason, 'Fin de séance du 06/11 (outil MJ)');
        assert.ok(history.createdAt instanceof Timestamp);
        assert.deepEqual(history.changes['counter:fortune'], { before: '1', after: '2', label: 'Fortune gagnée' });
        assert.deepEqual(history.changes['row:equipment:eq-1'], { before: MARTEAU, after: null, label: 'Courroux : objet retenu' });
        assert.equal(Object.keys(history.changes).length, 7);

        const replay = await call(request, MJ);
        assert.deepEqual(replay.result, response.result);
        assert.equal((await fiche()).revision, 1);
    });

    await t.test('CA10 : conflit après une modification du joueur, rien n’est écrit', async () => {
        const patch = await call({ charId: 'bhelgi', operationId: 'patch-joueur-1', baseRevision: 1, type: 'patch',
            payload: { changes: { fortune: '0' }, baseValues: { fortune: '2' } } }, PLAYER);
        assert.equal(patch.result?.revision, 2);
        const response = await call(outilMj([
            { op: 'counter', field: 'peche', base: '0', value: '1', label: 'Péché' },
            { op: 'counter', field: 'fortune', base: '2', value: '3', label: 'Fortune' },
        ], { sendId: 'send-2', baseRevision: 1 }), MJ);
        assert.equal(response.error?.status, 'ABORTED');
        assert.deepEqual(response.error.details, { kind: 'conflict', revision: 2, fields: ['counter:fortune'] });
        const { data, revision } = await fiche();
        assert.equal(revision, 2);
        assert.equal(data.peche, '0');
        assert.equal((await db.doc('fiches/bhelgi/operations/outilmj-send-2-bhelgi').get()).exists, false);
    });

    await t.test('CA13 : annulation ; l’annulation d’une annulation est refusée ; objet rendu à l’identique', async () => {
        // La Fortune a changé côté joueur : l'annulation porte sur le reste de l'envoi.
        const undoChanges = invert(send.filter(change => change.field !== 'fortune'));
        const undo = await call(outilMj(undoChanges, { sendId: 'undo-1', baseRevision: 2, undoOf: 'outilmj-send-1-bhelgi' }), MJ);
        assert.equal(undo.result?.revision, 3);
        const { data } = await fiche();
        assert.equal(data.destin, '2');
        assert.deepEqual(data.carac.ag, { base: 30, adv: 5 });
        assert.equal(data.skillsAdvanced[0].adv, 10);
        assert.deepEqual(data.talentsAcq, [BENI]);
        assert.deepEqual(data.equipment, [MARTEAU]);
        assert.deepEqual(data.suiviMj, []);
        const history = (await db.doc('fiches/bhelgi/history/outilmj-undo-1-bhelgi').get()).data();
        assert.equal(history.summary.undoOf, 'outilmj-send-1-bhelgi');

        const undoOfUndo = await call(outilMj(invert(undoChanges), { sendId: 'undo-2', baseRevision: 3, undoOf: 'outilmj-undo-1-bhelgi' }), MJ);
        assert.equal(undoOfUndo.error?.status, 'FAILED_PRECONDITION');
        assert.equal(undoOfUndo.error.details?.kind, 'undo-invalid');
        assert.equal((await fiche()).revision, 3);
    });
});

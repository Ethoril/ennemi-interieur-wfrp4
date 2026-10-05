import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeFicheCommand } from '../functions/src/fiche/service.mjs';
import { createCatalogueService } from '../functions/src/catalogue/service.mjs';
import { mutatePublicContent, getContentEditContext, trashPublicContent, restorePublicContent } from '../functions/src/contributions/service.mjs';

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || '';
if (!/^demo-j2-services$/u.test(projectId) || !process.env.FIRESTORE_EMULATOR_HOST
    || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_QUOTA_PROJECT
    || projectId === 'campagne-wrpg') {
    throw new Error('Suite Admin Emulator refusée : exige uniquement demo-j2-services et FIRESTORE_EMULATOR_HOST, sans identifiants ADC.');
}

const require = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../functions/package.json'));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const app = initializeApp({ projectId }, `j2-admin-emulator-${Date.now()}`);
const db = getFirestore(app);
const adminRequest = { auth: { uid: 'admin-mj', token: { email: 'ethoril@gmail.com', email_verified: true } } };
const playerRequest = { auth: { uid: 'player-1', token: { email: 'player@example.test', email_verified: true } } };
const timestamp = () => FieldValue.serverTimestamp();

function minimalCatalogue() {
    return {
        catalogVersion: 'qa-v1', sources: { skills: 'qa' },
        skills: { entries: [{ id: 'skill-athle', nom: 'Athlétisme', group: 'Athlétisme', groupId: 'group-athle',
            specialization: null, specializationId: null, carac: 'ag', basic: true, aliases: [] }], aliases: [] },
        talents: { entries: [], aliases: [], templates: [], localDescriptions: [] },
    };
}

test('services F1/R3/J2 utilisent Admin SDK et FieldValue contre Firestore Emulator demo', async t => {
    t.after(async () => { await deleteApp(app); });
    const access = { bhelgi: ['player@example.test'], caelel: [], elysia: [], hellaya: [], wren: [] };
    await db.doc('campagne/acces').set(access);
    for (const charId of ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']) {
        await db.doc(`fiches/${charId}`).set({ schemaVersion: 2, revision: 0,
            data: { nom: charId, race: 'Humain', possessions: '', optVisible: { 'section-sorts': false, 'section-prieres': false } } });
    }

    const ficheResponse = await executeFicheCommand({ charId: 'bhelgi', operationId: 'emulator-f1-patch', baseRevision: 0,
        type: 'patch', payload: { changes: { possessions: 'Épée de test' }, baseValues: { possessions: '' } } }, playerRequest,
    { db, timestamp });
    assert.equal(ficheResponse.revision, 1);
    const ficheSnapshot = await db.doc('fiches/bhelgi').get();
    assert.equal(ficheSnapshot.get('data.possessions'), 'Épée de test');
    assert.ok(ficheSnapshot.get('updatedAt') instanceof Timestamp, 'la transformation serverTimestamp doit devenir un vrai Timestamp');
    assert.ok((await db.doc('fiches/bhelgi/history/emulator-f1-patch').get()).get('createdAt') instanceof Timestamp);

    const catalogue = minimalCatalogue();
    const catalogueService = createCatalogueService({ db, timestamp, initialCatalogue: catalogue, sheetSnapshot: { entries: [] }, careers: [] });
    const load = await catalogueService.executeCatalogueCommand({ operationId: 'emulator-r3-load', baseRevision: 0,
        type: 'load', payload: {} }, adminRequest);
    const saved = await catalogueService.executeCatalogueCommand({ operationId: 'emulator-r3-draft', baseRevision: load.draftRevision,
        type: 'saveDraft', payload: { catalogue } }, adminRequest);
    assert.equal(saved.revision, 1);
    assert.ok((await db.doc('referentiel_drafts/mj').get()).get('updatedAt') instanceof Timestamp);
    assert.ok((await db.doc('referentiel_history/emulator-r3-draft').get()).get('createdAt') instanceof Timestamp);

    const contributionDeps = { db, timestamp, deleteField: () => FieldValue.delete() };
    const created = await mutatePublicContent({ kind: 'pnj', action: 'create', id: 'emulator-pnj', operationId: 'emulator-j2-create',
        baseRevision: 0, changes: { nom: 'PNJ Emulator' } }, playerRequest, contributionDeps);
    assert.equal(created.revision, 1);
    const context = await getContentEditContext({ ...playerRequest, data: { kind: 'pnj', id: 'emulator-pnj' } }, contributionDeps);
    await mutatePublicContent({ kind: 'pnj', action: 'update', id: 'emulator-pnj', operationId: 'emulator-j2-update',
        baseRevision: context.revision, baseValues: { description: '' }, changes: { description: 'Écriture Admin réelle' } }, playerRequest, contributionDeps);
    const trash = await trashPublicContent({ kind: 'pnj', id: 'emulator-pnj', operationId: 'emulator-j2-trash', baseRevision: 2 }, playerRequest, contributionDeps);
    assert.equal(trash.revision, 3);
    assert.equal((await db.doc('pnjs/emulator-pnj').get()).exists, false);
    const restored = await restorePublicContent({ kind: 'pnj', id: 'emulator-pnj', operationId: 'emulator-j2-restore', baseRevision: 3 }, playerRequest, contributionDeps);
    assert.equal(restored.revision, 4);
    assert.equal((await db.doc('pnjs/emulator-pnj').get()).get('description'), 'Écriture Admin réelle');
    assert.ok((await db.doc('content_metadata/pnj_emulator-pnj').get()).get('updatedAt') instanceof Timestamp);
});

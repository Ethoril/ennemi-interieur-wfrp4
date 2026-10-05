import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogueService } from '../src/catalogue/service.mjs';

function createDb(initial = {}) {
    const values = new Map(Object.entries(initial));
    const doc = path => {
        if (path.split('/').length % 2 !== 0) throw new TypeError(`Chemin Firestore document invalide: ${path}`);
        return { path, collection(name) { return { doc: id => doc(`${path}/${name}/${id}`) }; } };
    };
    return {
        values,
        doc,
        async runTransaction(callback) {
            const writes = [];
            const transaction = {
                async get(reference) {
                    const value = values.get(reference.path);
                    return { exists: value !== undefined, data: () => structuredClone(value) };
                },
                set(reference, value) { writes.push([reference.path, structuredClone(value)]); },
            };
            const result = await callback(transaction);
            for (const [path, value] of writes) values.set(path, value);
            return result;
        },
    };
}

function request(email = 'ethoril@gmail.com') {
    return { auth: { uid: 'mj-uid', token: { email, email_verified: true } } };
}

function makeCatalogue() {
    return {
        catalogVersion: 'sha256:old',
        sources: { skills: 'public' },
        skills: {
            entries: [{ id: 'skill-athle', nom: 'Athlétisme', group: 'Athlétisme', groupId: 'group-athle',
                specialization: null, specializationId: null, carac: 'ag', basic: true, aliases: [] }],
            aliases: [],
        },
        talents: { entries: [], aliases: [], templates: [], localDescriptions: [] },
    };
}

function makeDbData(catalogue) {
    const initial = {
        'referentiels/public': { revision: 3, catalogue },
        'referentiel_drafts/mj': { revision: 1, catalogue },
    };
    for (const charId of ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']) {
        initial[`fiches/${charId}`] = { schemaVersion: 2, revision: 4, data: {
            xpLog: [{ id: `${charId}-legacy`, purchaseId: `${charId}-purchase`, targetType: 'skill-adv', amount: 25, targetNom: 'Athlétisme ancien' }],
            skillsBasic: { Athlétisme: 2 }, basicSpecs: {}, skillsAdvanced: [{ id: `${charId}-skill`, nom: 'Athlétisme ancien', adv: 4 }],
        } };
    }
    return initial;
}

const requestBase = {
    uid: 'mj-uid',
    auth: { uid: 'mj-uid', token: { email: 'ethoril@gmail.com', email_verified: true } },
};

test('les commandes de référentiel sont réservées au MJ vérifié', async () => {
    const catalogue = makeCatalogue();
    const service = createCatalogueService({ db: createDb(makeDbData(catalogue)), timestamp: () => new Date(), initialCatalogue: catalogue });
    await assert.rejects(service.executeCatalogueCommand({ operationId: 'draft-1', baseRevision: 1,
        type: 'saveDraft', payload: { catalogue } }, request('joueur@example.org')), { code: 'permission-denied' });
});

test('la publication est atomique, contrôle les cinq révisions et ne réécrit pas les journaux XP', async () => {
    const base = makeCatalogue();
    const db = createDb(makeDbData(base));
    const service = createCatalogueService({ db, timestamp: () => new Date('2026-10-04T20:00:00Z'),
        initialCatalogue: base, careers: [], sheetSnapshot: { entries: [] } });
    const candidate = structuredClone(base);
    candidate.skills.aliases = [{ label: 'Athlétisme ancien', targetId: 'skill-athle', provenance: 'mj' }];
    const draft = await service.executeCatalogueCommand({ operationId: 'draft-1', baseRevision: 1,
        type: 'saveDraft', payload: { catalogue: candidate } }, requestBase);
    assert.equal(draft.revision, 2);

    const expected = Object.fromEntries(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren'].map(id => [id, 4]));
    const preview = await service.executeCatalogueCommand({ operationId: 'preview-1', baseRevision: 2,
        type: 'previewMigration', payload: {} }, requestBase);
    const decisions = preview.migration.collisions.map(collision => {
        const winner = collision.records.find(record => record.collection === 'skillsAdvanced');
        return { key: collision.key, keepRecordKey: `${winner.scopeId}\u0000${winner.collection}\u0000${winner.id}`,
            storageCollection: collision.targetBasic ? 'skillsBasic' : 'skillsAdvanced', advances: winner.advances };
    });
    const published = await service.executeCatalogueCommand({ operationId: 'publish-1', baseRevision: 2,
        type: 'publish', payload: { publishedRevision: 3, characterRevisions: expected,
            decisions, reason: 'Alias validé en revue' } }, requestBase);
    assert.equal(published.publishedRevision, 4);
    assert.equal(db.values.get('referentiels/public').catalogue.skills.aliases[0].label, 'Athlétisme ancien');
    for (const charId of Object.keys(expected)) {
        const envelope = db.values.get(`fiches/${charId}`);
        assert.equal(envelope.revision, 5);
        assert.deepEqual(envelope.data.xpLog, [{ id: `${charId}-legacy`, purchaseId: `${charId}-purchase`, targetType: 'skill-adv', amount: 25, targetNom: 'Athlétisme ancien' }]);
        assert.equal(envelope.data.skillsBasic.Athlétisme, 4);
        assert.equal(envelope.data.skillsAdvanced.length, 0);
        assert.deepEqual(envelope.data.catalogueMigrationBarriers[0].purchaseIds, [`${charId}-purchase`]);
        assert.equal(Object.hasOwn(envelope.data.catalogueMigrationBarriers[0], 'createdAt'), false);
        assert.equal(envelope.catalogVersion, published.catalogVersion);
        assert.ok(db.values.has(`fiches/${charId}/history/catalogue-publish-1`));
        assert.ok(db.values.has(`fiches/${charId}/catalogue_backups/publish-1`));
    }
    assert.ok(db.values.has('referentiel_history/publish-1'));
});

test('la prévisualisation et la publication refusent les révisions périmées', async () => {
    const catalogue = makeCatalogue();
    const db = createDb(makeDbData(catalogue));
    const service = createCatalogueService({ db, timestamp: () => new Date(), initialCatalogue: catalogue, sheetSnapshot: { entries: [] } });
    await assert.rejects(service.executeCatalogueCommand({ operationId: 'publish-stale', baseRevision: 0,
        type: 'publish', payload: { publishedRevision: 3, characterRevisions: {}, decisions: [], reason: 'Motif valide' } }, requestBase),
    { code: 'aborted' });
});

test('les brouillons et snapshots publics filtrent les champs privés fournis par le client', async () => {
    const base = makeCatalogue();
    const db = createDb(makeDbData(base));
    const service = createCatalogueService({ db, timestamp: () => new Date(), initialCatalogue: base, sheetSnapshot: { entries: [] } });
    const candidate = structuredClone(base);
    candidate.uid = 'private-user';
    candidate.skills.entries[0].uid = 'private-user';
    candidate.sources.talents = { kind: 'google-sheets-public-snapshot', spreadsheetId: 'public-id', email: 'private@example.org' };
    const result = await service.executeCatalogueCommand({ operationId: 'draft-private', baseRevision: 1,
        type: 'saveDraft', payload: { catalogue: candidate } }, requestBase);
    const saved = db.values.get('referentiel_drafts/mj').catalogue;
    assert.equal(result.revision, 2);
    assert.equal(Object.hasOwn(saved, 'uid'), false);
    assert.equal(Object.hasOwn(saved.skills.entries[0], 'uid'), false);
    assert.equal(Object.hasOwn(saved.sources.talents, 'email'), false);
});

test('une fusion garde la clé de stockage BASIC_SKILLS et conserve une ligne avancée invalide intacte', async () => {
    const base = makeCatalogue();
    base.skills.entries.push({ id: 'skill-corps-base', nom: 'Corps à corps', group: 'Corps à corps',
        groupId: 'group-corps', specialization: null, specializationId: null, carac: 'cc', basic: true, aliases: [] });
    const initial = {
        'referentiels/public': { revision: 1, catalogue: base },
        'referentiel_drafts/mj': { revision: 1, catalogue: base },
    };
    for (const charId of ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']) {
        initial[`fiches/${charId}`] = { schemaVersion: 2, revision: 0, data: {
            xpLog: [], skillsBasic: {}, basicSpecs: {}, skillsAdvanced: [],
        } };
    }
    initial['fiches/bhelgi'].data.skillsBasic = { 'Corps à corps (Base)': 5 };
    initial['fiches/bhelgi'].data.skillsAdvanced = [
        { id: 'rename-me', nom: 'Athlétisme ancien', adv: 3 },
        { id: 'keep-invalid', nom: 'Compétence inconnue', adv: '5', note: 'conserver exactement' },
    ];
    const db = createDb(initial);
    const service = createCatalogueService({ db, timestamp: () => new Date('2026-10-04T20:00:00Z'),
        initialCatalogue: base, sheetSnapshot: { entries: [] } });
    const candidate = structuredClone(base);
    candidate.skills.aliases = [
        { label: 'Corps à corps (Base)', targetId: 'skill-corps-base', provenance: 'mj' },
        { label: 'Athlétisme ancien', targetId: 'skill-athle', provenance: 'mj' },
    ];
    await service.executeCatalogueCommand({ operationId: 'draft-storage', baseRevision: 1,
        type: 'saveDraft', payload: { catalogue: candidate } }, requestBase);
    const expected = Object.fromEntries(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren'].map(id => [id, 0]));
    await service.executeCatalogueCommand({ operationId: 'publish-storage', baseRevision: 2,
        type: 'publish', payload: { publishedRevision: 1, characterRevisions: expected, decisions: [], reason: 'Correction de libellés' } }, requestBase);
    const data = db.values.get('fiches/bhelgi').data;
    assert.equal(data.skillsBasic['Corps à corps (Base)'], 5);
    assert.deepEqual(data.skillsAdvanced.find(row => row.id === 'keep-invalid'),
        { id: 'keep-invalid', nom: 'Compétence inconnue', adv: '5', note: 'conserver exactement' });
    assert.equal(data.skillsAdvanced.find(row => row.id === 'rename-me').nom, 'Athlétisme');
});

test('une publication de descriptions sans migration de compétence ne réécrit aucune fiche', async () => {
    const base = makeCatalogue();
    base.talents.entries.push({ id: 'talent-lore', key: 'lore', nom: 'Connaissance', sources: ['career'] });
    const db = createDb(makeDbData(base));
    const service = createCatalogueService({ db, timestamp: () => new Date(), initialCatalogue: base, sheetSnapshot: { entries: [] } });
    const candidate = structuredClone(base);
    candidate.talents.localDescriptions.push({ talentId: 'talent-lore', description: 'Description locale.' });
    await service.executeCatalogueCommand({ operationId: 'draft-description', baseRevision: 1,
        type: 'saveDraft', payload: { catalogue: candidate } }, requestBase);
    const expected = Object.fromEntries(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren'].map(id => [id, 4]));
    const result = await service.executeCatalogueCommand({ operationId: 'publish-description', baseRevision: 2,
        type: 'publish', payload: { publishedRevision: 3, characterRevisions: expected, decisions: [], reason: 'Description validée' } }, requestBase);
    assert.equal(result.characterRevisions.bhelgi, 4);
    assert.equal(db.values.has('fiches/bhelgi/catalogue_backups/publish-description'), false);
    assert.equal(db.values.get('fiches/bhelgi').revision, 4);
});

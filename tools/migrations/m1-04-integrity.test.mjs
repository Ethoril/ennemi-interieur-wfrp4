import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
    commitCascadeBatches, relationExists, relationId, reconcileFilterSets, splitCascadeOperations, panelIsStillCurrent,
    safeRelationColorValue,
} from '../../js/pnj-integrity.js';

const files = await Promise.all([
    readFile('js/pnjs.js', 'utf8'),
    readFile('js/enquetes.js', 'utf8'),
    readFile('js/data/pnjs-repository.js', 'utf8'),
    readFile('js/data/relations-repository.js', 'utf8'),
    readFile('js/bureau-data.js', 'utf8'),
    readFile('js/image-lifecycle.js', 'utf8'),
    readFile('js/protected-upload-recovery.js', 'utf8'),
    readFile('pnjs.html', 'utf8'),
    readFile('firestore.rules', 'utf8'),
    readFile('js/storage-reference.js', 'utf8'),
    readFile('js/protected-upload-journal.js', 'utf8'),
]);
const [pnjs, enquetes, pnjRepository, relationsRepository, bureauData, lifecycle, recovery, pnjsHtml, rules, storageReference, journal] = files;

test('les relations bidirectionnelles sont préparées dans une transaction et refusent l’auto-relation', () => {
    assert.match(relationsRepository, /runTransaction\(db, callback\)/u);
    assert.match(relationsRepository, /const primaryRef = documentRef\(sdk, db, 'relations', relationId\(primary\)\)/u);
    assert.match(relationsRepository, /transaction\.set\(primaryRef, \{ \.\.\.primary/u);
    assert.match(pnjs, /if \(sourceId === cibleId\)/u);
    assert.match(pnjs, /capturedSession|capturedGeneration/u);
    assert.match(pnjs, /Création de la relation impossible/u);
    assert.doesNotMatch(pnjs, /await addDoc\(collection\(db, 'relations'\)/u);
    assert.match(enquetes, /repository\.create|repository\.update/u);
});

test('la suppression PNJ retire indices, relations et privé avant le portrait', () => {
    assert.match(pnjRepository, /pnjsLies: arrayRemoveValue\(sdk, id\)/u);
    assert.match(pnjRepository, /commitCascadeBatches\(operations/u);
    assert.match(pnjRepository, /finalBatch\.delete\(privateRef\)/u);
    assert.match(pnjRepository, /finalBatch\.delete\(pnjRef\)/u);
    assert.match(bureauData, /cleanupUnreferencedImage/u);
    assert.match(pnjs, /function clearPnjAdminStatuses/u);
    assert.match(pnjs, /resumeRemoval/u);
    assert.match(pnjs, /safeRelationColor/u);
    assert.match(rules, /suppressionEnCours/u);
    assert.match(rules, /!resource\.data\.get\('suppressionEnCours', false\)/u);
    assert.match(rules, /integrity_locks\/\{id\}/u);
    assert.match(rules, /lockAfterTargetsPnj/u);
    assert.match(rules, /cascadeIndiceUpdate/u);
    assert.match(rules, /ownerId\.matches\('\^\[A-Za-z0-9_-\]\+\$'\)/u);
    assert.match(pnjRepository, /integrity_locks', 'pnj-deletion'/u);
    assert.match(pnjRepository, /unlockBatch\.delete\(lockRef\)/u);
    assert.match(pnjRepository, /imagePaths/u);
    assert.match(pnjRepository, /legacyImageSkipped/u);
    assert.match(rules, /legacyImageSkipped is bool/u);
    assert.match(rules, /publicRelationEndpointsExist\(request\.resource\.data\)/u);
    assert.match(rules, /relationEndpointsExist\(request\.resource\.data\)/u);
    assert.match(pnjRepository, /relationSnapshots/u);
});

test('le cycle de vie compare des références canoniques et peut reprendre automatiquement', () => {
    assert.match(lifecycle, /safeStorageReference\(storage, value\)/u);
    assert.match(lifecycle, /safeStorageReference\(storage, value\)\?\.fullPath === path/u);
    assert.match(lifecycle, /integrity_locks', 'images'/u);
    assert.match(recovery, /integrity_locks', 'images'/u);
    assert.match(recovery, /cleanupUnreferencedImage/u);
    assert.match(recovery, /RETRY_DELAY_MS/u);
    assert.match(bureauData, /cleanupUnreferencedImage/u);
    assert.match(storageReference, /segment !== '\.' && segment !== '\.\.'/u);
    assert.match(journal, /validJournalPath/u);
});

test('les filtres PNJ sont réconciliés et leur état est visible', () => {
    assert.match(pnjs, /reconcileFilterSets\(state\.active, available\)/u);
    assert.match(pnjs, /pnj-filter-count/u);
    assert.match(pnjsHtml, /id="pnj-filter-count"/u);
});

test('les réouvertures de panneau vérifient la génération après rechargement', () => {
    assert.match(pnjs, /panelIsStillCurrent\(/u);
    assert.match(pnjs, /capturedPanelGeneration/u);
});

test('les lots >500 sont bornés et une panne ne produit pas de faux succès', async () => {
    const operations = Array.from({ length: 1001 }, (_, index) => index);
    assert.deepEqual(splitCascadeOperations(operations).map(batch => batch.length), [498, 498, 5]);
    const committed = [];
    await assert.rejects(() => commitCascadeBatches(operations, async batch => {
        committed.push(batch);
        if (committed.length === 2) throw new Error('simulated batch refusal');
    }), /simulated batch refusal/u);
    assert.equal(committed.length, 2);
});

test('les relations exactes et les filtres invalidés sont détectés par des fonctions pures', () => {
    const relation = { source: 'a', cible: 'b', type: 'allié', label: 'allié', color: '#fff', style: 'solid', visibleJoueurs: true };
    assert.equal(relationExists([relation], relation), true);
    assert.equal(relationExists([{ ...relation, source: 'b', cible: 'a' }], relation, true), true);
    assert.equal(relationExists([relation], { ...relation, type: 'rival', label: 'rival' }), false);
    assert.equal(relationId(relation), relationId({ ...relation, type: ' ALLIÉ ' }));
    assert.notEqual(relationId(relation), relationId({ ...relation, cible: 'c' }));
    assert.notEqual(relationId({ ...relation, source: 'a|b', cible: 'c' }),
        relationId({ ...relation, source: 'a', cible: 'b|c' }));
    const active = { lieu: new Set(['port', 'disparu']), statut: new Set(['allié']) };
    assert.equal(reconcileFilterSets(active, { lieu: ['port'], statut: ['allié'] }), 2);
    assert.deepEqual([...active.lieu], ['port']);
    assert.equal(panelIsStillCurrent({ capturedGeneration: 1, currentGeneration: 2, capturedId: 'a', currentId: 'a' }), false);
    assert.equal(safeRelationColorValue('#c9a84c', '#000'), '#c9a84c');
    assert.equal(safeRelationColorValue('red;--chip-color:url(javascript:1)', '#000'), '#000');
    assert.equal(safeRelationColorValue('#12345', '#000'), '#000');
});

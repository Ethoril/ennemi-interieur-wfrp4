import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pages = await Promise.all(['js/pnjs.js', 'js/enquetes.js'].map(path => readFile(path, 'utf8')));
const lifecycle = await import('../js/bureau-view-lifecycle.js');

test('les pages bureau ne chargent plus directement les SDK Firebase de données', () => {
    for (const source of pages) {
        assert.doesNotMatch(source, /gstatic\.com\/firebase-(?:firestore|storage)\.js/u);
        assert.match(source, /createBureauData/u);
    }
});

test('les pages détachent leurs abonnements et leurs images à la fermeture', () => {
    assert.match(pages[0], /unsubscribePnjs\?\.\(\)/u);
    assert.match(pages[0], /unsubscribeRelations\?\.\(\)/u);
    assert.match(pages[0], /unsubscribeLinkedIndices\?\.\(\)|cancelLinkedIndices\(\)/u);
    assert.match(pages[0], /renderedImageHandles\.forEach/u);
    assert.match(pages[1], /unsubscribeIndices\?\.\(\)/u);
    assert.match(pages[1], /bureauData\?\.close\(\)/u);
    assert.match(pages[0], /closePnjModal\(\)/u);
    assert.match(pages[0], /f-notes-privees.*value = ''/su);
    assert.match(pages[1], /closeClueModal\(\)/u);
});

test('la session MJ exige une identité vérifiée comme les règles Firebase', async () => {
    const source = await readFile('js/auth.js', 'utf8');
    assert.match(source, /user\.emailVerified === true/u);
    assert.doesNotMatch(source, /createAuthLifecycle/u);
});

test('la composition fabrique les quatre dépôts et ferme le client', async () => {
    const source = await readFile('js/bureau-data.js', 'utf8');
    for (const factory of [
        'createMjPnjRepository', 'createPublicPnjRepository',
        'createMjRelationsRepository', 'createPublicRelationsRepository',
        'createMjIndicesRepository', 'createPublicIndicesRepository',
        'createMjImagesRepository', 'createPublicImagesRepository',
    ]) assert.match(source, new RegExp(factory, 'u'));
    assert.match(source, /const close = async \(\)/u);
    assert.match(source, /cleanupPnjImages: async \(\{ pnjId, imagePaths/u);
});

test('les mutations gardent leur identité et le portrait passe toujours par replace', () => {
    const [pnjs] = pages;
    assert.match(pnjs, /images\.replace\(previousImagePath \|\| null/u);
    assert.doesNotMatch(pnjs, /images\.uploadPortrait/u);
    assert.doesNotMatch(pnjs, /images\.cleanupImage/u);
    assert.match(pnjs, /const stillCurrent = \(\) => capturedSession/u);
    assert.match(pnjs, /reciprocalId/u);
    assert.match(pnjs, /if \(!ok \|\| !stillCurrent\(\)\) return/u);
    assert.match(pnjs, /const capturedGeneration = bureauGeneration/u);
    assert.match(pnjs, /const capturedRepository = capturedData\.pnjs/u);
    assert.match(pnjs, /createPendingRecovery/u);
    assert.match(pnjs, /imageState\.commitDone/u);
    assert.match(pnjs, /pnj-image-recovery-status/u);
});

test('les gardes de rendu ignorent une émission obsolète et préservent les cases encore disponibles', () => {
    const gate = lifecycle.createRenderGate();
    const first = gate.next();
    const second = gate.next();
    assert.equal(gate.isCurrent(first), false);
    assert.equal(gate.isCurrent(second), true);
    assert.deepEqual(
        lifecycle.preserveCheckedValues(['a', 'a', 'missing'], ['a', 'b']),
        ['a'],
    );
});

test('une nouvelle génération relance une reprise PNJ encore en vol', async () => {
    let release;
    const runs = [];
    const coordinator = lifecycle.createPendingRecovery(async generation => {
        runs.push(generation);
        if (generation === 1) await new Promise(resolve => { release = resolve; });
    });
    void coordinator.request(1);
    await Promise.resolve();
    coordinator.request(2);
    release();
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(runs, [1, 2]);
});

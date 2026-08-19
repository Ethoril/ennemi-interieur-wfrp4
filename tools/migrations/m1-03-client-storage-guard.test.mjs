import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('les écrans protégés utilisent uniquement le dépôt callable et autorisent son origine CSP', async () => {
    const [pnjs, enquetes, protectedImages, protectedUpload, firebaseInit, pnjsHtml, enquetesHtml, sw] = await Promise.all([
        readFile(resolve('js/pnjs.js'), 'utf8'),
        readFile(resolve('js/enquetes.js'), 'utf8'),
        readFile(resolve('js/protected-images.js'), 'utf8'),
        readFile(resolve('js/protected-upload.js'), 'utf8'),
        readFile(resolve('js/firebase-init.js'), 'utf8'),
        readFile(resolve('pnjs.html'), 'utf8'),
        readFile(resolve('enquetes.html'), 'utf8'),
        readFile(resolve('sw.js'), 'utf8'),
    ]);
    assert.doesNotMatch(pnjs, /getDownloadURL/u);
    assert.doesNotMatch(enquetes, /getDownloadURL/u);
    assert.doesNotMatch(pnjs, /uploadBytes|updateMetadata|getMetadata/u);
    assert.doesNotMatch(enquetes, /uploadBytes|updateMetadata|getMetadata/u);
    for (const screen of [pnjs, enquetes]) {
        assert.match(screen, /editorSession/u);
        assert.match(screen, /authSessionKey/u);
        assert.match(screen, /identityChanged/u);
        assert.match(screen, /capturedEditingId/u);
        assert.match(screen, /requireCurrentEditor/u);
        assert.match(screen, /safeStorageReference\(storage, oldReference\)/u);
        assert.match(screen, /deleteObject\(uploadedImage/u);
        assert.match(screen, /rememberProtectedUpload/u);
        assert.match(screen, /forgetProtectedUpload/u);
        assert.match(screen, /recoverPendingProtectedUploads/u);
        assert.doesNotMatch(screen, /randomUUID/u);
    }
    assert.match(pnjs, /protected-upload\.js/u);
    assert.match(enquetes, /protected-upload\.js/u);
    assert.match(pnjs, /deletionStillCurrent/u);
    assert.match(enquetes, /deletionStillCurrent/u);
    assert.match(enquetes, /deleteDoc\(doc\(db, 'indices', capturedEditingId\)\)/u);
    assert.match(protectedImages, /getBlob\(ref\(storage, imagePath\)\)/u);
    assert.match(protectedUpload, /httpsCallable\(functions, 'uploadProtectedImage'\)/u);
    assert.match(firebaseInit, /getFunctions\(app, 'europe-west1'\)/u);
    assert.match(sw, /['"]\.\/js\/storage-reference\.js['"]/u);
    assert.match(sw, /['"]\.\/js\/protected-upload-journal\.js['"]/u);
    assert.match(sw, /['"]\.\/js\/protected-upload-recovery\.js['"]/u);
    assert.match(pnjsHtml, /https:\/\/europe-west1-campagne-wrpg\.cloudfunctions\.net/u);
    assert.match(enquetesHtml, /https:\/\/europe-west1-campagne-wrpg\.cloudfunctions\.net/u);
});

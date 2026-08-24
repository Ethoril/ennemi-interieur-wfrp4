import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('les écrans protégés utilisent uniquement le dépôt callable et autorisent son origine CSP', async () => {
    const [pnjs, enquetes, protectedImages, protectedUpload, firebaseInit, imageLifecycle, pnjsHtml, enquetesHtml, sw] = await Promise.all([
        readFile(resolve('js/pnjs.js'), 'utf8'),
        readFile(resolve('js/enquetes.js'), 'utf8'),
        readFile(resolve('js/protected-images.js'), 'utf8'),
        readFile(resolve('js/protected-upload.js'), 'utf8'),
        readFile(resolve('js/firebase-init.js'), 'utf8'),
        readFile(resolve('js/image-lifecycle.js'), 'utf8'),
        readFile(resolve('pnjs.html'), 'utf8'),
        readFile(resolve('enquetes.html'), 'utf8'),
        readFile(resolve('sw.js'), 'utf8'),
    ]);
    assert.doesNotMatch(pnjs, /getDownloadURL/u);
    assert.doesNotMatch(enquetes, /getDownloadURL/u);
    assert.doesNotMatch(pnjs, /uploadBytes|updateMetadata|getMetadata/u);
    assert.doesNotMatch(enquetes, /uploadBytes|updateMetadata|getMetadata/u);
    for (const screen of [pnjs, enquetes]) {
        assert.doesNotMatch(screen, /import\s*\{[^}]*\b(?:collection|doc|getDoc|getDocs|runTransaction|updateDoc|deleteDoc|writeBatch|ref|deleteObject)\b[^}]*\}\s*from ['"]\.\/bureau-data\.js['"]/su);
        assert.doesNotMatch(screen, /(?:collection|doc|getDoc|getDocs|runTransaction|updateDoc|deleteDoc|writeBatch|ref|deleteObject)\s*\(/u);
        assert.match(screen, /editorSession/u);
        assert.match(screen, /authSessionKey/u);
        assert.match(screen, /identityChanged/u);
        assert.match(screen, /capturedEditingId/u);
        assert.match(screen, /requireCurrentEditor|stillCurrent/u);
        assert.match(screen, /createBureauData/u);
        assert.doesNotMatch(screen, /randomUUID/u);
    }
    const bureauData = await readFile(resolve('js/bureau-data.js'), 'utf8');
    assert.match(bureauData, /uploadProtectedImage/u);
    assert.match(bureauData, /cleanupUnreferencedImage/u);
    assert.match(pnjs, /inspectRemovalLock|resumeRemoval/u);
    assert.match(enquetes, /repository\.remove/u);
    assert.match(protectedImages, /getBlob\(ref\(storage, imagePath\)\)/u);
    assert.match(protectedUpload, /httpsCallable\(functions, 'uploadProtectedImage'\)/u);
    assert.match(imageLifecycle, /safeStorageReference\(storage, reference\)/u);
    assert.match(firebaseInit, /getFunctions\(app, FIREBASE_FUNCTIONS_REGION\)/u);
    assert.match(firebaseInit, /from '\.\/firebase-config\.js'/u);
    assert.match(sw, /['"]\.\/js\/storage-reference\.js['"]/u);
    assert.match(sw, /['"]\.\/js\/protected-upload-journal\.js['"]/u);
    assert.match(sw, /['"]\.\/js\/protected-upload-recovery\.js['"]/u);
    assert.match(sw, /['"]\.\/js\/image-lifecycle\.js['"]/u);
    assert.match(sw, /['"]\.\/js\/firebase-config\.js['"]/u);
    assert.match(pnjsHtml, /https:\/\/europe-west1-campagne-wrpg\.cloudfunctions\.net/u);
    assert.match(enquetesHtml, /https:\/\/europe-west1-campagne-wrpg\.cloudfunctions\.net/u);
});

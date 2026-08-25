import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processPortraitFile, validatePortraitFile, createPortraitEditor } from '../js/mobile/components/portrait-editor.js';
import { createProtectedImageUploader } from '../js/protected-upload.js';
import { protectedUploadOperationId } from '../js/protected-upload-id.js';

const bytes = (...values) => new Uint8Array(values).buffer;
const decoder = async () => ({ width: 1200, height: 800, close() {} });

test('validation portrait vérifie signature, MIME réel, taille et décodabilité', async () => {
    const file = new globalThis.Blob([bytes(0xff, 0xd8, 0xff, 0xe0, 1)], { type: 'image/jpeg' });
    const result = await validatePortraitFile(file, { decodeImage: decoder });
    assert.equal(result.contentType, 'image/jpeg'); assert.deepEqual(result.dimensions, { width: 1200, height: 800 });
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob(['<svg></svg>'], { type: 'image/svg+xml' }), { decodeImage: decoder }), /prise en charge/u);
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)], { type: 'image/jpeg' }), { decodeImage: decoder }), /type réel/u);
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob([bytes(1, 2, 3)], { type: 'image/jpeg' }), { decodeImage: decoder }), /prise en charge/u);
});

test('traitement portrait recadre au centre, compresse et libère bitmap/canvas', async () => {
    let closed = 0; let drawn = null; let cleared = false;
    const bitmap = { width: 1200, height: 800, close: () => { closed += 1; } };
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: (...args) => { drawn = args; } }),
        toBlob: (resolve, type) => resolve(new globalThis.Blob([new Uint8Array([1, 2])], { type })), remove: () => { cleared = true; } };
    const file = new globalThis.Blob([bytes(0xff, 0xd8, 0xff, 0xe0, 1)], { type: 'image/jpeg' });
    const result = await processPortraitFile(file, { decodeImage: async () => bitmap, createCanvas: () => canvas });
    assert.equal(result.width, 800); assert.equal(result.height, 800); assert.equal(result.blob.type, 'image/webp');
    assert.deepEqual(drawn.slice(1, 5), [200, 0, 800, 800]); assert.equal(closed, 2); assert.equal(cleared, true); assert.equal(canvas.width, 0);
});

test('une source de plus de 2 Mo peut être compressée, mais une bombe source est refusée', async () => {
    const large = new Uint8Array(3 * 1024 * 1024); large.set([0xff, 0xd8, 0xff], 0);
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: resolve => resolve(new globalThis.Blob([new Uint8Array([1])], { type: 'image/webp' })) };
    const result = await processPortraitFile(new globalThis.Blob([large], { type: 'image/jpeg' }), { decodeImage: decoder, createCanvas: () => canvas });
    assert.ok(result.originalBytes > 2 * 1024 * 1024); assert.ok(result.finalBytes < 2 * 1024 * 1024);
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/jpeg' }), { decode: false }), /20 Mo/u);
});

test('validation ferme le bitmap exactement une fois sur abort et dimensions excessives', async () => {
    let closed = 0; const bitmap = { width: 100, height: 100, close: () => { closed += 1; } };
    const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), { decodeImage: async () => bitmap, signal: controller.signal }), /annulé/u);
    assert.equal(closed, 0);
    const lateController = new globalThis.AbortController(); const lateBitmap = { width: 100, height: 100, close: () => { closed += 1; } };
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), { decodeImage: async () => { lateController.abort(); return lateBitmap; }, signal: lateController.signal }), /annulé/u);
    assert.equal(closed, 1);
    await assert.rejects(() => validatePortraitFile(new globalThis.Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), { decodeImage: async () => ({ width: 100000, height: 100000, close: () => { closed += 1; } }) }), /excessives/u);
    assert.equal(closed, 2);
});

class Element {
    constructor(documentRef, tagName) { this.ownerDocument = documentRef; this.tagName = tagName; this.children = []; this.listeners = new Map(); this.parentNode = null; this.dataset = {}; this.hidden = false; this.value = ''; this.files = []; this.textContent = ''; this.attributes = new Map(); }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    addEventListener(type, fn) { this.listeners.set(type, fn); }
    dispatch(type) { this.listeners.get(type)?.({ target: this }); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    remove() { this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1); }
}
function documentRef() { const document = { defaultView: { confirm: () => true }, createElement: tag => new Element(document, tag) }; return document; }

test('deux sélections ne conservent que la dernière et libèrent l’aperçu précédent', async () => {
    const doc = documentRef(); const container = new Element(doc, 'main'); const changes = [];
    let resolveFirst; const first = new Promise(resolve => { resolveFirst = resolve; });
    let calls = 0;
    const editor = createPortraitEditor({ container, document: doc, onChange: state => changes.push(state), processFile: async file => {
        calls += 1; if (calls === 1) return first; return { blob: file, finalBytes: file.size, width: 10, height: 10 };
    } });
    const input = container.children[0].children.find(node => node.tagName === 'fieldset').children.find(node => node.tagName === 'label').children[1];
    const oldUrl = globalThis.URL; let revoked = 0; globalThis.URL = { createObjectURL: () => `blob:${calls}`, revokeObjectURL: () => { revoked += 1; } };
    input.files = [new globalThis.Blob([bytes(1)], { type: 'image/jpeg' })]; input.dispatch('change');
    input.files = [new globalThis.Blob([bytes(2)], { type: 'image/jpeg' })]; input.dispatch('change'); await Promise.resolve();
    assert.equal(editor.getState().file.size, 1); // the injected second result is the selected file
    resolveFirst({ blob: new globalThis.Blob([bytes(3)], { type: 'image/jpeg' }), finalBytes: 1, width: 10, height: 10 }); await Promise.resolve();
    assert.equal(calls, 2); assert.equal(editor.getState().file.size, 1); assert.ok(changes.length >= 1); editor.destroy(); assert.ok(revoked >= 1); globalThis.URL = oldUrl;
});

test('annulation ou fichier invalide ne salit pas le brouillon et désactive les contrôles', async () => {
    const doc = documentRef(); const container = new Element(doc, 'main'); let changes = 0;
    const editor = createPortraitEditor({ container, document: doc, onChange: () => { changes += 1; }, processFile: async () => { throw new Error('invalide'); } });
    const root = container.children[0]; const input = root.children.find(node => node.tagName === 'fieldset').children.find(node => node.tagName === 'label').children[1]; const remove = root.children.find(node => node.tagName === 'button');
    editor.setDisabled(true); assert.equal(input.disabled, true); assert.equal(remove.disabled, true);
    input.files = []; input.dispatch('change'); await Promise.resolve(); assert.equal(changes, 0); assert.equal(editor.getState().removalRequested, false);
    editor.setDisabled(false); input.files = [new globalThis.Blob([new Uint8Array([1])], { type: 'image/jpeg' })]; input.dispatch('change'); await Promise.resolve(); await Promise.resolve();
    assert.equal(changes, 0); assert.equal(editor.getState().file, null); editor.destroy();
});

test('la caméra et la photothèque sont deux sources accessibles du même pipeline', async () => {
    const doc = documentRef(); const container = new Element(doc, 'main'); let changes = 0;
    const editor = createPortraitEditor({ container, document: doc, onChange: () => { changes += 1; }, processFile: async file => ({ blob: file, finalBytes: file.size, width: 10, height: 10 }) });
    const fieldset = container.children[0].children[0]; const labels = fieldset.children.filter(node => node.tagName === 'label'); const camera = labels[0].children[1]; const library = labels[1].children[1];
    assert.equal(fieldset.children[0].tagName, 'legend'); assert.equal(labels.length, 2);
    assert.equal(camera.attributes.get('capture'), 'environment'); assert.equal(library.attributes.get('capture'), undefined);
    const oldUrl = globalThis.URL; globalThis.URL = { createObjectURL: () => 'blob:library', revokeObjectURL: () => {} };
    library.files = [new globalThis.Blob([bytes(1)], { type: 'image/jpeg' })]; library.dispatch('change'); await Promise.resolve(); await Promise.resolve();
    assert.equal(changes, 1); assert.equal(editor.getState().file.size, 1); editor.destroy(); globalThis.URL = oldUrl;
});

test('une annulation et un changement de portrait invalident le traitement en cours', async () => {
    const doc = documentRef(); const container = new Element(doc, 'main'); let resolve;
    const editor = createPortraitEditor({ container, document: doc, processFile: () => new Promise(done => { resolve = done; }) });
    const labels = container.children[0].children[0].children.filter(node => node.tagName === 'label');
    const camera = labels[0].children[1]; const library = labels[1].children[1];
    camera.files = [new globalThis.Blob([bytes(1)], { type: 'image/jpeg' })]; camera.dispatch('change');
    assert.equal(editor.getState().processing, true);
    library.files = []; library.dispatch('change');
    assert.equal(editor.getState().processing, false);
    resolve?.({ blob: new globalThis.Blob([bytes(2)], { type: 'image/webp' }), finalBytes: 1, width: 10, height: 10 }); await Promise.resolve();
    assert.equal(editor.getState().file, null);
    camera.files = [new globalThis.Blob([bytes(3)], { type: 'image/jpeg' })]; camera.dispatch('change');
    assert.equal(editor.getState().processing, true);
    await editor.setCurrentPath('portraits/a/portrait.webp', { loadObjectUrl: async () => ({ url: 'blob:a', release() {} }) });
    assert.equal(editor.getState().processing, false); editor.destroy();
});

test('retirer un portrait vide les deux sélecteurs pour permettre le même fichier', () => {
    const doc = documentRef(); const container = new Element(doc, 'main');
    const editor = createPortraitEditor({ container, document: doc, currentPath: 'portraits/a/portrait.webp' });
    const labels = container.children[0].children[0].children.filter(node => node.tagName === 'label');
    labels[0].children[1].value = 'same'; labels[1].children[1].value = 'same';
    container.children[0].children.find(node => node.tagName === 'button').dispatch('click');
    assert.equal(labels[0].children[1].value, ''); assert.equal(labels[1].children[1].value, ''); editor.destroy();
});

test('les lectures de portrait A puis B ne laissent pas A écraser B', async () => {
    const doc = documentRef(); const container = new Element(doc, 'main'); let resolveA; let resolveB;
    const service = { loadObjectUrl: path => path === 'portraits/a/a.webp' ? new Promise(resolve => { resolveA = resolve; }) : new Promise(resolve => { resolveB = resolve; }) };
    const editor = createPortraitEditor({ container, document: doc });
    const a = editor.setCurrentPath('portraits/a/a.webp', service); const b = editor.setCurrentPath('portraits/b/b.webp', service);
    resolveA?.({ url: 'blob:a', release() {} }); resolveB?.({ url: 'blob:b', release() {} }); await Promise.all([a, b]);
    assert.equal(editor.getState().currentPath, 'portraits/b/b.webp'); editor.destroy();
});

test('uploader protégé utilise la callable injectée et ne propose aucune primitive Storage', async () => {
    const blob = new globalThis.Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
    let callableArgs = null; const operationId = await protectedUploadOperationId(blob);
    const uploader = createProtectedImageUploader({ functions: { named: true }, httpsCallable: (functions, name) => {
        assert.deepEqual(functions, { named: true }); assert.equal(name, 'uploadProtectedImage');
        return async payload => { callableArgs = payload; return { data: { imagePath: `portraits/p1/portrait-${operationId}.webp` } }; };
    } });
    const result = await uploader(blob, { kind: 'portrait', ownerId: 'p1', contentType: 'image/webp' });
    assert.equal(result.imagePath, `portraits/p1/portrait-${operationId}.webp`); assert.equal(callableArgs.ownerId, 'p1'); assert.equal(callableArgs.base64.length > 0, true);
});

test('la composition raccorde Functions à la même app mobile-mj et le runtime ne réintroduit pas d upload Storage direct', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const runtime = fs.readFileSync(path.join(root, 'js/mobile/mj-runtime.js'), 'utf8');
    const composition = fs.readFileSync(path.join(root, 'js/mobile/mj-composition.js'), 'utf8');
    assert.match(runtime, /getFunctions, httpsCallable/u); assert.match(runtime, /name === 'mobile-mj'/u);
    assert.match(composition, /functions: client\.functions, httpsCallable: sdk\.httpsCallable/u);
    assert.doesNotMatch(runtime, /uploadBytes|deleteObject|getDownloadURL/u);
});

/* global URL */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createPwaController } from '../js/mobile/pwa.js';
import { createPwaBanner } from '../js/mobile/pwa-banner.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function localImports(source) {
    return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(['"])(\.{1,2}\/[^'"]+)\1/gu)]
        .map(match => match[2]);
}

function swAssets() {
    const block = read('sw.js').match(/const ASSETS_LOCAUX\s*=\s*\[([\s\S]*?)\n\];/u)?.[1] ?? '';
    return new Set([...block.matchAll(/['"](\.\/[^'"]+)['"]/gu)].map(match => match[1]));
}

function createWorkerHarness() {
    const listeners = new Map();
    const entries = new Map();
    const puts = [];
    const deleted = [];
    const fetchResponses = new Map();
    let putError = null;
    let putDelay = null;
    let waitUntilCalls = 0;
    const origin = 'https://example.test';
    class ResponseFake {
        constructor(body = '', options = {}) {
            this.body = body;
            this.status = options.status ?? 200;
            this.ok = this.status >= 200 && this.status < 300;
            this.type = options.type || 'basic';
        }
        clone() { return this; }
    }
    class RequestFake {
        constructor(request) { Object.assign(this, request); }
    }
    const cache = {
        async addAll(paths) {
            for (const relative of paths) entries.set(new URL(relative, `${origin}/`).href, { response: new ResponseFake('asset') });
        },
        async add() { throw new Error('CDN indisponible'); },
        async keys() { return [...entries.keys()].map(url => ({ url })); },
        async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.response; },
        async put(request, response) {
            if (putDelay) await putDelay;
            if (putError) throw putError;
            puts.push(request.url);
            entries.set(request.url, { response });
        },
        async delete(request) { deleted.push(typeof request === 'string' ? request : request.url); entries.delete(typeof request === 'string' ? request : request.url); return true; },
    };
    const context = {
        URL,
        Promise,
        console,
        Request: RequestFake,
        Response: ResponseFake,
        self: {
            location: { origin, href: `${origin}/sw.js` },
            clients: { claim: async () => {} },
            addEventListener(type, listener) { listeners.set(type, listener); },
        },
        caches: {
            async open() { return cache; },
            async keys() { return ['wfrp-cache-v2.22.2']; },
            async match(request) { return cache.match(request); },
        },
        fetch: async request => {
            if (request.url.includes('/cdn/')) return new ResponseFake('opaque', { type: 'opaque' });
            if (fetchResponses.has(request.url)) return fetchResponses.get(request.url);
            throw new Error('offline');
        },
    };
    vm.runInNewContext(read('sw.js'), context, { filename: 'sw.js' });
    const dispatch = async (type, event) => {
        const waits = [];
        let responsePromise = null;
        const wrapped = {
            ...event,
            waitUntil(promise) { waitUntilCalls += 1; waits.push(Promise.resolve(promise)); },
            respondWith(promise) { responsePromise = Promise.resolve(promise); },
        };
        listeners.get(type)?.(wrapped);
        await Promise.all(waits);
        return responsePromise ? responsePromise : null;
    };
    return { cache, entries, puts, deleted, dispatch, origin, fetchResponses,
        setPutError: error => { putError = error; },
        setPutDelay: promise => { putDelay = promise; },
        get waitUntilCalls() { return waitUntilCalls; } };
}

class EventTargetFake {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event); }
}

class ElementFake extends EventTargetFake {
    constructor() {
        super();
        this.hidden = false;
        this.disabled = false;
        this.textContent = '';
    }
    click() { this.dispatch('click', { currentTarget: this }); }
}

function createBannerDocument() {
    const elements = new Map([
        ['#m-pwa-banner', new ElementFake()],
        ['#m-pwa-banner-text', new ElementFake()],
        ['#m-pwa-update', new ElementFake()],
        ['#m-pwa-install', new ElementFake()],
        ['#m-pwa-dismiss', new ElementFake()],
    ]);
    return { elements, querySelector: selector => elements.get(selector) || null };
}

test('le précache mobile est fermé, existant et suit toutes les importations locales', () => {
    const appHtml = read('app/index.html');
    assert.match(appHtml, /id="m-pwa-banner"[^>]+aria-live="polite"/u);
    assert.match(appHtml, /id="m-pwa-update"[^>]*>Mettre à jour/u);
    assert.match(appHtml, /id="m-pwa-install"[^>]*>Installer l’application/u);
    assert.match(read('js/mobile/app.js'), /createPwaBanner/u);
    const assets = swAssets();
    assert.ok(assets.has('./app/index.html'));
    assert.ok(assets.has('./css/mobile-app.css'));
    assert.ok(assets.has('./js/mobile/app.js'));
    for (const relative of assets) assert.ok(fs.existsSync(path.join(root, relative.slice(2))), `précache absent : ${relative}`);
    const pending = ['js/mobile/app.js'];
    const visited = new Set();
    while (pending.length) {
        const relative = pending.pop();
        if (visited.has(relative) || !relative.endsWith('.js')) continue;
        visited.add(relative);
        const source = read(relative);
        for (const specifier of localImports(source)) {
            const imported = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
            assert.ok(assets.has(`./${imported}`), `import mobile hors précache : ${relative} -> ${specifier}`);
            if (imported.endsWith('.js')) pending.push(imported);
        }
    }
    assert.ok(visited.has('js/mobile/pwa.js'));
    assert.ok(visited.has('js/mobile/pwa-banner.js'));
});

test('le worker racine protège les données et garde l activation volontaire', () => {
    const source = read('sw.js');
    assert.doesNotMatch(source.slice(0, source.indexOf("self.addEventListener('activate'")), /self\.skipWaiting\(\)/u);
    assert.match(source, /event\.data\?\.type === 'SKIP_WAITING'/u);
    assert.match(source, /hostname === 'firestore\.googleapis\.com'/u);
    assert.match(source, /hostname === 'identitytoolkit\.googleapis\.com'/u);
    assert.match(source, /hostname === 'securetoken\.googleapis\.com'/u);
    assert.match(source, /hostname === 'firebaseappcheck\.googleapis\.com'/u);
    assert.match(source, /hostname\.endsWith\('\.cloudfunctions\.net'\)/u);
    assert.match(source, /hostname === 'www\.gstatic\.com' && url\.pathname\.startsWith\('\/firebasejs\/'\)/u);
    assert.match(source, /hostname === 'www\.gstatic\.com' && url\.pathname\.startsWith\('\/recaptcha\/'\)/u);
    assert.match(source, /response\.type !== 'opaque'/u);
    assert.match(source, /pathname\.endsWith\('\/app\/'\)/u);
    assert.equal((source.match(/navigator\.serviceWorker\.register/gu) || []).length, 0);
    assert.equal((read('js/main.js').match(/serviceWorker\.register/gu) || []).length, 1);
    assert.match(source, /const response = await cache\.match\(request\)/u);
    assert.match(source, /response\?\.type === 'opaque'/u);
    assert.match(source, /Promise\.allSettled\(ASSETS_CDN\.map/u);
});

test('harness SW : purge migration, réseau protégé, opaque, offline app et CDN en panne', async () => {
    const harness = createWorkerHarness();
    const protectedUrl = 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel';
    const recaptchaUrl = 'https://www.gstatic.com/recaptcha/releases/test/recaptcha__fr.js';
    const opaqueUrl = `${harness.origin}/cdn/private-image.webp`;
    harness.entries.set(protectedUrl, { response: { type: 'basic' } });
    harness.entries.set(recaptchaUrl, { response: { type: 'cors' } });
    harness.entries.set(opaqueUrl, { response: { type: 'opaque' } });
    await harness.dispatch('activate', {});
    assert.ok(harness.deleted.includes(protectedUrl));
    assert.ok(harness.deleted.includes(recaptchaUrl));
    assert.ok(harness.deleted.includes(opaqueUrl));

    const protectedEvent = {
        request: { method: 'GET', url: 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel', mode: 'cors', headers: { get: () => '' } },
    };
    assert.equal(await harness.dispatch('fetch', protectedEvent), null);
    const recaptchaEvent = {
        request: { method: 'GET', url: recaptchaUrl, mode: 'cors', headers: { get: () => '' } },
    };
    assert.equal(await harness.dispatch('fetch', recaptchaEvent), null,
        'reCAPTCHA gstatic doit rester entièrement hors Cache Storage');
    const opaqueEvent = {
        request: { method: 'GET', url: opaqueUrl, mode: 'no-cors', headers: { get: () => '' } },
    };
    await harness.dispatch('fetch', opaqueEvent);
    assert.deepEqual(harness.puts, []);

    harness.entries.set(`${harness.origin}/app/index.html`, { response: { body: 'APP SHELL', type: 'basic' } });
    const appResponse = await harness.dispatch('fetch', {
        request: { method: 'GET', url: `${harness.origin}/app/`, mode: 'navigate', headers: { get: () => 'text/html' } },
    });
    assert.equal(appResponse.body, 'APP SHELL');
    const missingResponse = await harness.dispatch('fetch', {
        request: { method: 'GET', url: `${harness.origin}/missing/`, mode: 'navigate', headers: { get: () => 'text/html' } },
    });
    assert.equal(missingResponse.status, 503);
    const missingAssetResponse = await harness.dispatch('fetch', {
        request: { method: 'GET', url: `${harness.origin}/missing.webp`, mode: 'no-cors', headers: { get: () => '' } },
    });
    assert.equal(missingAssetResponse.status, 504, 'un SWR hors ligne doit toujours renvoyer une Response');

    const codeUrl = `${harness.origin}/fresh.js`;
    harness.fetchResponses.set(codeUrl, new (class extends Object {
        constructor() { super(); this.body = 'fresh'; this.status = 200; this.ok = true; this.type = 'basic'; }
        clone() { return this; }
    })());
    let releasePut;
    harness.setPutDelay(new Promise(resolve => { releasePut = resolve; }));
    const codeFetch = harness.dispatch('fetch', {
        request: { method: 'GET', url: codeUrl, mode: 'same-origin', headers: { get: () => '' } },
    });
    await Promise.resolve();
    releasePut();
    assert.equal((await codeFetch).body, 'fresh');
    harness.setPutDelay(null);
    harness.setPutError(new Error('quota')); 
    const swrUrl = `${harness.origin}/illustration.webp`;
    harness.fetchResponses.set(swrUrl, new (class extends Object {
        constructor() { super(); this.body = 'network'; this.status = 200; this.ok = true; this.type = 'basic'; }
        clone() { return this; }
    })());
    const swrResponse = await harness.dispatch('fetch', {
        request: { method: 'GET', url: swrUrl, mode: 'no-cors', headers: { get: () => '' } },
    });
    assert.equal(swrResponse.body, 'network');
    assert.ok(harness.waitUntilCalls >= 1, 'SWR doit rattacher sa mise à jour à waitUntil');
    harness.setPutError(null);

    const installHarness = createWorkerHarness();
    await installHarness.dispatch('install', {});
    assert.ok(installHarness.entries.has(`${installHarness.origin}/app/index.html`), 'CDN en panne ne doit pas annuler le précache local');
});

test('la mise à jour attend une action, respecte beforeLeave et ne recharge qu une fois', async () => {
    const windowRef = new EventTargetFake();
    let reloads = 0;
    windowRef.navigator = { userAgent: 'Android', onLine: true };
    windowRef.location = { reload: () => { reloads += 1; } };
    windowRef.matchMedia = () => ({ matches: false });
    windowRef.setTimeout = callback => { globalThis.queueMicrotask(callback); return 1; };
    class Port {
        constructor() { this.peer = null; this.onmessage = null; }
        postMessage(data) { this.peer?.onmessage?.({ data }); }
        close() {}
    }
    windowRef.MessageChannel = class {
        constructor() {
            this.port1 = new Port();
            this.port2 = new Port();
            this.port1.peer = this.port2;
            this.port2.peer = this.port1;
        }
    };
    const serviceWorker = new EventTargetFake();
    const messages = [];
    const waiting = new EventTargetFake();
    waiting.state = 'installed';
    waiting.postMessage = message => messages.push(message);
    waiting.addEventListener = EventTargetFake.prototype.addEventListener;
    const registration = new EventTargetFake();
    registration.waiting = waiting;
    registration.active = { postMessage: (_message, ports) => ports?.[0]?.postMessage({ version: 'v2.22.2' }) };
    registration.update = async () => {};
    serviceWorker.controller = {};
    serviceWorker.register = async (url, options) => {
        assert.equal(url, '../sw.js');
        assert.deepEqual(options, { scope: '../', updateViaCache: 'none' });
        return registration;
    };
    windowRef.navigator.serviceWorker = serviceWorker;
    let canLeave = false;
    const announcements = [];
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, router: { canLeaveCurrent: () => canLeave }, announce: message => announcements.push(message) });
    await pwa.start();
    assert.equal(pwa.getState().updateAvailable, true);
    assert.equal(pwa.getDiagnostics().workerVersion, 'v2.22.2');
    assert.equal(pwa.applyUpdate(), false);
    assert.deepEqual(messages, []);
    assert.match(announcements.at(-1), /différée/u);
    canLeave = true;
    assert.equal(pwa.applyUpdate(), true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'SKIP_WAITING');
    serviceWorker.dispatch('controllerchange');
    serviceWorker.dispatch('controllerchange');
    assert.equal(reloads, 1);
    pwa.stop();
});

test('l aide d installation Android est non obligatoire et le prompt est contrôlé', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android', onLine: true };
    windowRef.matchMedia = () => ({ matches: false });
    windowRef.setTimeout = callback => { callback(); return 1; };
    const serviceWorker = new EventTargetFake();
    serviceWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
    windowRef.navigator.serviceWorker = serviceWorker;
    let prompted = 0;
    let prevented = 0;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator });
    await pwa.start();
    windowRef.dispatch('beforeinstallprompt', {
        preventDefault: () => { prevented += 1; },
        prompt: async () => { prompted += 1; },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    assert.equal(prevented, 1);
    assert.equal(pwa.getInstallationHint()?.kind, 'android');
    assert.equal(await pwa.promptInstall(), true);
    assert.equal(prompted, 1);
    pwa.stop();
});

test('Réglages conserve une aide d installation quand Chrome ne fournit pas son prompt', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0' };
    windowRef.matchMedia = () => ({ matches: false });
    const serviceWorker = new EventTargetFake();
    serviceWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
    windowRef.navigator.serviceWorker = serviceWorker;
    const announcements = [];
    const pwa = createPwaController({
        windowRef,
        navigatorRef: windowRef.navigator,
        announce: message => announcements.push(message),
    });
    await pwa.start();
    assert.equal(pwa.getState().installAvailable, false);
    assert.equal(pwa.getInstallationHint()?.kind, 'manual');
    assert.match(pwa.getInstallationHint()?.text || '', /menu ⋮/u);
    assert.equal(await pwa.promptInstall(), false);
    assert.match(announcements.at(-1), /Installer l’application/u);
    assert.match(read('js/mobile/app.js'), /hint\.kind === 'android' \|\| hint\.kind === 'manual'/u);
    assert.match(read('js/mobile/app.js'), /Voir comment installer/u);
    pwa.stop();
});

test('un prompt Android qui échoue conserve une aide réessayable sans faux succès', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    windowRef.matchMedia = () => ({ matches: false });
    const serviceWorker = new EventTargetFake();
    serviceWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
    windowRef.navigator.serviceWorker = serviceWorker;
    const announcements = [];
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, announce: message => announcements.push(message) });
    await pwa.start();
    let attempts = 0;
    windowRef.dispatch('beforeinstallprompt', {
        preventDefault() {},
        prompt: async () => { attempts += 1; throw new Error('prompt unavailable'); },
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    assert.equal(await pwa.promptInstall(), false);
    assert.equal(attempts, 1);
    assert.equal(pwa.getInstallationHint()?.kind, 'android');
    assert.equal(pwa.getState().installError, true);
    assert.match(announcements.at(-1), /Réessayez/u);
    windowRef.dispatch('beforeinstallprompt', {
        preventDefault() {},
        prompt: async () => {},
        userChoice: Promise.reject(new Error('choice unavailable')),
    });
    assert.equal(await pwa.promptInstall(), false);
    assert.equal(pwa.getInstallationHint()?.kind, 'android');
    pwa.stop();
});

test('un rejet register arrivé après stop ne publie ni erreur ni état tardif', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    const serviceWorker = new EventTargetFake();
    let rejectRegister;
    serviceWorker.register = () => new Promise((_resolve, reject) => { rejectRegister = reject; });
    windowRef.navigator.serviceWorker = serviceWorker;
    const announcements = [];
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, announce: message => announcements.push(message) });
    const started = pwa.start();
    pwa.stop();
    rejectRegister(new Error('late offline'));
    await started;
    assert.equal(pwa.getState().error, null);
    assert.deepEqual(announcements, []);
});

test('le bandeau PWA rend la mise à jour et nettoie ses listeners', () => {
    const documentRef = createBannerDocument();
    const calls = [];
    let state = { updateAvailable: true, updateRequested: false };
    const pwa = {
        subscribe(listener) { listener(state); return () => { calls.push('unsubscribe'); }; },
        getInstallationHint: () => ({ kind: 'android', text: 'Installer maintenant.' }),
        applyUpdate: () => calls.push('update'),
        promptInstall: () => calls.push('install'),
        dismissInstall: () => calls.push('dismiss'),
    };
    const banner = createPwaBanner({ documentRef, pwa });
    const elements = documentRef.elements;
    assert.equal(elements.get('#m-pwa-banner').hidden, false);
    assert.equal(elements.get('#m-pwa-update').hidden, false);
    assert.equal(elements.get('#m-pwa-install').hidden, true);
    assert.equal(elements.get('#m-pwa-dismiss').hidden, true);
    elements.get('#m-pwa-update').click();
    assert.deepEqual(calls.slice(0, 1), ['update']);
    state = { updateAvailable: true, updateRequested: true };
    assert.equal(elements.get('#m-pwa-update').disabled, false, 'le rendu est piloté par les émissions');
    // Recréer le composant avec l état verrouillé vérifie le disabled visuel.
    banner.stop();
    const lockedPwa = {
        ...pwa,
        subscribe(listener) { listener(state); return () => {}; },
    };
    const locked = createPwaBanner({ documentRef, pwa: lockedPwa });
    assert.equal(elements.get('#m-pwa-update').disabled, true);
    locked.stop();
    state = { updateAvailable: false, updateRequested: false };
    lockedPwa.getInstallationHint = () => ({ kind: 'ios', text: 'Safari : Ajouter à l’écran d’accueil.' });
    const iosBanner = createPwaBanner({ documentRef, pwa: lockedPwa });
    // Une aide iOS seule reste dans Réglages et ne maintient pas le bandeau de mise à jour.
    assert.equal(elements.get('#m-pwa-install').hidden, true);
    iosBanner.stop();
    state = { updateAvailable: false, updateRequested: false };
    lockedPwa.getInstallationHint = () => ({ kind: 'android', text: 'Installer.' });
    const androidOnly = createPwaBanner({ documentRef, pwa: lockedPwa });
    assert.equal(elements.get('#m-pwa-banner').hidden, true);
    androidOnly.stop();
    assert.equal(elements.get('#m-pwa-banner').hidden, true);
    assert.ok(calls.includes('unsubscribe'));
});

test('le bouton du bandeau passe par la même action que Réglages et disparaît après activation', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    windowRef.matchMedia = () => ({ matches: false });
    let reloads = 0;
    windowRef.location = { reload() { reloads += 1; } };
    const serviceWorker = new EventTargetFake();
    serviceWorker.controller = {};
    const messages = [];
    const waiting = new EventTargetFake();
    waiting.state = 'installed';
    waiting.postMessage = message => messages.push(message);
    const registration = new EventTargetFake();
    registration.waiting = waiting;
    registration.active = { postMessage: (_message, ports) => ports?.[0]?.postMessage({ version: 'v2.22.2' }) };
    registration.update = async () => {};
    serviceWorker.register = async () => registration;
    windowRef.navigator.serviceWorker = serviceWorker;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator });
    await pwa.start();
    const documentRef = createBannerDocument();
    const banner = createPwaBanner({ documentRef, pwa });
    assert.equal(documentRef.elements.get('#m-pwa-banner').hidden, false);
    documentRef.elements.get('#m-pwa-update').click();
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'SKIP_WAITING');
    assert.equal(pwa.getState().updateRequested, true);
    waiting.state = 'activated';
    waiting.dispatch('statechange');
    assert.equal(reloads, 1);
    assert.equal(pwa.getState().updateRequested, false);
    assert.equal(documentRef.elements.get('#m-pwa-banner').hidden, true);
    serviceWorker.dispatch('controllerchange');
    assert.equal(pwa.getState().updateAvailable, false);
    assert.equal(reloads, 1, 'controllerchange ne doit pas recharger une seconde fois');
    assert.equal(documentRef.elements.get('#m-pwa-banner').hidden, true);
    banner.stop();
    pwa.stop();
});

test('le bandeau explique une mise à jour différée par une saisie sale', async () => {
    const documentRef = createBannerDocument();
    const state = { updateAvailable: true, updateRequested: false };
    const pwa = {
        subscribe(listener) { listener(state); return () => {}; },
        requestUpdate: async () => false,
        getState: () => state,
    };
    const banner = createPwaBanner({ documentRef, pwa });
    documentRef.elements.get('#m-pwa-update').click();
    await Promise.resolve();
    assert.equal(documentRef.elements.get('#m-pwa-banner-text').textContent,
        'Mise à jour impossible ou différée. Terminez votre saisie, puis réessayez.');
    assert.equal(documentRef.elements.get('#m-pwa-banner').hidden, false);
    banner.stop();
});

test('un résultat async obsolète du bandeau ne repeint pas après stop et un rejet reste absorbé', async () => {
    const documentRef = createBannerDocument();
    const state = { updateAvailable: true, updateRequested: false };
    let resolveRequest;
    const pwa = {
        subscribe(listener) { listener(state); return () => {}; },
        requestUpdate: () => new Promise(resolve => { resolveRequest = resolve; }),
        getState: () => state,
    };
    const banner = createPwaBanner({ documentRef, pwa });
    documentRef.elements.get('#m-pwa-update').click();
    banner.stop();
    resolveRequest(false);
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(documentRef.elements.get('#m-pwa-banner').hidden, true);
    assert.equal(documentRef.elements.get('#m-pwa-banner-text').textContent, 'Mise à jour disponible.');

    const rejectedDocument = createBannerDocument();
    const rejectedPwa = {
        subscribe(listener) { listener(state); return () => {}; },
        requestUpdate: async () => { throw new Error('offline'); },
        getState: () => state,
    };
    const rejectedBanner = createPwaBanner({ documentRef: rejectedDocument, pwa: rejectedPwa });
    rejectedDocument.elements.get('#m-pwa-update').click();
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.match(rejectedDocument.elements.get('#m-pwa-banner-text').textContent, /impossible|différée/u);
    rejectedBanner.stop();
});

test('stop pendant requestUpdate empêche tout SKIP_WAITING tardif', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    windowRef.matchMedia = () => ({ matches: false });
    let reloads = 0;
    windowRef.location = { reload() { reloads += 1; } };
    const serviceWorker = new EventTargetFake();
    serviceWorker.controller = {};
    const waiting = new EventTargetFake();
    waiting.state = 'installed';
    const messages = [];
    waiting.postMessage = message => messages.push(message);
    const registration = new EventTargetFake();
    registration.waiting = waiting;
    registration.active = { postMessage: (_message, ports) => ports?.[0]?.postMessage({ version: 'v2.22.2' }) };
    let resolveUpdate;
    registration.update = () => new Promise(resolve => { resolveUpdate = resolve; });
    serviceWorker.register = async () => registration;
    windowRef.navigator.serviceWorker = serviceWorker;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator });
    await pwa.start();
    const request = pwa.requestUpdate();
    pwa.stop();
    resolveUpdate();
    assert.equal(await request, false);
    assert.deepEqual(messages, []);
    assert.equal(reloads, 0);
});

test('un stop avant la résolution register ne laisse aucun listener ni diagnostic tardif', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    const serviceWorker = new EventTargetFake();
    let resolveRegister;
    serviceWorker.register = () => new Promise(resolve => { resolveRegister = resolve; });
    windowRef.navigator.serviceWorker = serviceWorker;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator });
    const start = pwa.start();
    pwa.stop();
    const registration = new EventTargetFake();
    const worker = new EventTargetFake();
    worker.state = 'installed';
    registration.installing = worker;
    registration.active = { postMessage() { throw new Error('diagnostic tardif'); } };
    resolveRegister(registration);
    await start;
    assert.equal(registration.listeners.get('updatefound')?.length || 0, 0);
    assert.equal(worker.listeners.get('statechange')?.length || 0, 0);
});

test('controllerchange externe masque le waiting sans recharger, et les aides respectent le contexte', async () => {
    const windowRef = new EventTargetFake();
    let reloads = 0;
    windowRef.location = { reload: () => { reloads += 1; } };
    windowRef.matchMedia = () => ({ matches: false });
    windowRef.navigator = { userAgent: 'iPhone' };
    const serviceWorker = new EventTargetFake();
    serviceWorker.controller = {};
    serviceWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
    windowRef.navigator.serviceWorker = serviceWorker;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator });
    await pwa.start();
    assert.equal(pwa.getInstallationHint()?.kind, 'ios');
    serviceWorker.dispatch('controllerchange');
    assert.equal(reloads, 0);
    assert.equal(pwa.getState().updateAvailable, false);
    pwa.stop();

    const standaloneWindow = new EventTargetFake();
    standaloneWindow.matchMedia = () => ({ matches: true });
    standaloneWindow.navigator = { userAgent: 'Android' };
    const standaloneWorker = new EventTargetFake();
    standaloneWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
    standaloneWindow.navigator.serviceWorker = standaloneWorker;
    const standalone = createPwaController({ windowRef: standaloneWindow, navigatorRef: standaloneWindow.navigator });
    await standalone.start();
    assert.equal(standalone.getInstallationHint(), null);
    standalone.stop();
});

test('un rejet d installation futur hostile n écarte pas durablement l aide', async () => {
    const storage = { value: String(2_000), getItem: () => storage.value, setItem: (_key, value) => { storage.value = value; } };
    const windowRef = new EventTargetFake();
    windowRef.matchMedia = () => ({ matches: false });
    windowRef.navigator = { userAgent: 'Android' };
    const serviceWorker = new EventTargetFake();
    serviceWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
    windowRef.navigator.serviceWorker = serviceWorker;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, storage, now: () => 1_000 });
    await pwa.start();
    windowRef.dispatch('beforeinstallprompt', { preventDefault() {}, prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    assert.equal(pwa.getInstallationHint()?.kind, 'android');
    pwa.dismissInstall();
    assert.equal(pwa.getInstallationHint()?.kind, 'manual');
    pwa.stop();
});

test('la rétention de l aide ignore les timestamps nuls, NaN, futurs et expirés', async () => {
    const values = [0, 'NaN', 1_000 + 1, 999, 1_000 - (7 * 24 * 60 * 60 * 1000), 1_000 - (7 * 24 * 60 * 60 * 1000) - 1];
    for (const value of values) {
        const storage = { value: String(value), getItem: () => storage.value };
        const windowRef = new EventTargetFake();
        windowRef.navigator = { userAgent: 'Android' };
        windowRef.matchMedia = () => ({ matches: false });
        const serviceWorker = new EventTargetFake();
        serviceWorker.register = async () => ({ addEventListener() {}, update: async () => {} });
        windowRef.navigator.serviceWorker = serviceWorker;
        const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, storage, now: () => 1_000 });
        await pwa.start();
        windowRef.dispatch('beforeinstallprompt', { preventDefault() {} });
        assert.equal(pwa.getInstallationHint()?.kind, value === 999 ? 'manual' : 'android');
        pwa.stop();
    }
});

test('Rechercher une mise à jour réenregistre un worker absent ou en échec', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    const serviceWorker = new EventTargetFake();
    let attempts = 0;
    serviceWorker.register = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
        return { addEventListener() {}, update: async () => {} };
    };
    windowRef.navigator.serviceWorker = serviceWorker;
    const announcements = [];
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, announce: message => announcements.push(message) });
    await pwa.start();
    assert.equal(pwa.getState().registered, false);
    assert.equal(await pwa.checkForUpdate(), true);
    assert.equal(attempts, 2);
    assert.match(announcements.at(-1), /reconnecté/u);
    pwa.stop();
});

test('checkForUpdate neutralise les mises à jour et retries obsolètes', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    const serviceWorker = new EventTargetFake();
    const updates = [];
    const registration = new EventTargetFake();
    registration.update = () => new Promise(resolve => updates.push(resolve));
    serviceWorker.register = async () => registration;
    windowRef.navigator.serviceWorker = serviceWorker;
    const announcements = [];
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator, announce: message => announcements.push(message) });
    await pwa.start();
    const first = pwa.checkForUpdate();
    const second = pwa.checkForUpdate();
    updates[0]();
    assert.equal(await first, false);
    updates[1]();
    assert.equal(await second, true);
    assert.equal(announcements.filter(message => /mise à jour disponible|Aucune mise à jour/u.test(message)).length, 1);
    const beforeStop = announcements.length;
    const stoppedUpdate = pwa.checkForUpdate();
    pwa.stop();
    updates[2]();
    assert.equal(await stoppedUpdate, false);
    assert.equal(announcements.length, beforeStop);

    const retryWindow = new EventTargetFake();
    retryWindow.navigator = { userAgent: 'Android' };
    const retryWorker = new EventTargetFake();
    const registrations = [];
    retryWorker.register = () => new Promise(resolve => registrations.push(resolve));
    retryWindow.navigator.serviceWorker = retryWorker;
    const retryAnnouncements = [];
    const retryPwa = createPwaController({ windowRef: retryWindow, navigatorRef: retryWindow.navigator, announce: message => retryAnnouncements.push(message) });
    const start = retryPwa.start();
    registrations[0]?.({ addEventListener() {} });
    await start;
    const retryOne = retryPwa.checkForUpdate();
    const retryTwo = retryPwa.checkForUpdate();
    registrations[1]({ addEventListener() {} });
    assert.equal(await retryOne, false);
    registrations[2]({ addEventListener() {}, update: async () => {} });
    assert.equal(await retryTwo, true);
    assert.equal(retryAnnouncements.filter(message => /reconnecté|indisponible/u.test(message)).length, 1);
    retryPwa.stop();
});

test('une recherche ne rend pas obsolète le listener installing lifecycle', async () => {
    const windowRef = new EventTargetFake();
    windowRef.navigator = { userAgent: 'Android' };
    const serviceWorker = new EventTargetFake();
    const installing = new EventTargetFake();
    installing.state = 'installing';
    const registration = new EventTargetFake();
    registration.installing = installing;
    registration.update = async () => {};
    serviceWorker.controller = {};
    serviceWorker.register = async () => registration;
    windowRef.navigator.serviceWorker = serviceWorker;
    const pwa = createPwaController({ windowRef, navigatorRef: windowRef.navigator });
    await pwa.start();
    assert.equal(pwa.getState().updateAvailable, false);
    assert.equal(await pwa.checkForUpdate(), true);
    installing.state = 'installed';
    installing.dispatch('statechange');
    assert.equal(pwa.getState().updateAvailable, true);
    pwa.stop();
});

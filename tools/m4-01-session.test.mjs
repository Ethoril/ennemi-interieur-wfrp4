import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMjSession, createSafeInitialRoute } from '../js/mobile/session.js';
import { createRouter, parseRoute, routeToHash, ROUTE_NAMES } from '../js/mobile/router.js';
import { createMjSessionComposition } from '../js/mobile/mj-composition.js';
import { createMjMobileClient } from '../js/data/firebase-clients.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function fakeAuth({ redirect = null, redirectError = null, currentUser = null } = {}) {
    let observer = null;
    const calls = { redirect: 0, signOut: 0, closes: 0, created: 0 };
    const auth = { currentUser };
    const sdk = {
        getRedirectResult: async () => {
            calls.redirect += 1;
            if (redirectError) throw redirectError;
            return redirect ? { user: redirect } : null;
        },
        onAuthStateChanged: (_auth, callback) => { observer = callback; return () => { observer = null; }; },
        signInWithRedirect: async () => {},
        signOut: async () => { calls.signOut += 1; auth.currentUser = null; observer?.(null); },
        GoogleAuthProvider: class {},
    };
    return { auth, sdk, calls, emit: user => { auth.currentUser = user; observer?.(user); } };
}

const gm = Object.freeze({ uid: 'gm', email: 'ethoril@gmail.com', emailVerified: true, displayName: 'MJ' });
const player = Object.freeze({ uid: 'player', email: 'player@example.test', emailVerified: true });
const privateFactory = async () => ({ client: { cache: { mode: 'memory', persistent: false }, close() {} }, repositories: {} });

test('getRedirectResult est consommé avant le premier état définitif et restaure une route sûre', async () => {
    const storage = new Map([['route', '#/pnjs/p1']]);
    const route = createSafeInitialRoute({ storage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }, key: 'route' });
    const fake = fakeAuth({ redirect: gm });
    const states = [];
    const navigated = [];
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, route, privateFactory, onNavigate: value => navigated.push(value), onChange: state => states.push(state.status) });
    await session.start();
    assert.equal(fake.calls.redirect, 1);
    assert.deepEqual(states.slice(0, 3), ['checking', 'checking', 'gm']);
    assert.deepEqual(navigated, ['#/pnjs/p1']);
    assert.equal(route.read(), null);
});

test('annulation et erreur de redirection ne donnent jamais un accès MJ', async () => {
    const cancelFake = fakeAuth({ redirectError: Object.assign(new Error('cancel'), { code: 'auth/redirect-cancelled-by-user' }) });
    const cancelSession = createMjSession({ auth: cancelFake.auth, authSdk: cancelFake.sdk });
    await cancelSession.start();
    assert.equal(cancelSession.getState().status, 'visitor');
    const errorFake = fakeAuth({ redirectError: Object.assign(new Error('network'), { code: 'auth/network-request-failed' }) });
    const errorSession = createMjSession({ auth: errorFake.auth, authSdk: errorFake.sdk });
    await errorSession.start();
    assert.equal(errorSession.getState().status, 'error');
    assert.equal(errorSession.getState().error.kind, 'offline');
});

test('un ancien retour nul est migré sans boucle et ouvre la popup au geste suivant', async () => {
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) || null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
    const route = createSafeInitialRoute({ storage });
    route.markRedirectPending();
    const fake = fakeAuth();
    let popupCalls = 0;
    fake.sdk.signInWithPopup = async () => { popupCalls += 1; return { user: gm }; };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, route, privateFactory });
    await session.start();
    assert.equal(session.getState().status, 'visitor');
    assert.equal(session.getState().error, null);
    assert.equal(values.size, 0);
    await session.signIn();
    assert.equal(popupCalls, 1);
    assert.equal(session.getState().status, 'gm');
});

test('la popup est le premier geste et reste relançable après déconnexion', async () => {
    const fake = fakeAuth();
    let popupCalls = 0;
    fake.sdk.signInWithPopup = async () => { popupCalls += 1; return { user: gm }; };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory });
    await session.start();
    await session.signIn();
    assert.equal(popupCalls, 1);
    assert.equal(session.getState().status, 'gm');
    await session.signOut();
    assert.equal(fake.calls.signOut, 1);
    assert.equal(session.getState().status, 'visitor');
    await session.signIn();
    assert.equal(popupCalls, 2, 'un cycle popup → déconnexion → popup reste relançable');
    assert.equal(session.getState().status, 'gm');
});

test('popup qui émet l’observer avant sa résolution ne crée qu’un contexte privé nettoyé', async () => {
    const fake = fakeAuth();
    fake.sdk.signInWithPopup = async () => {
        fake.emit(gm);
        return { user: gm };
    };
    let factories = 0;
    let closes = 0;
    const session = createMjSession({
        auth: fake.auth,
        authSdk: fake.sdk,
        privateFactory: async () => {
            factories += 1;
            return { client: { cache: { mode: 'memory', persistent: false }, close: () => { closes += 1; } }, repositories: {} };
        },
    });
    await session.start();
    await session.signIn();
    assert.equal(factories, 1);
    await session.stop();
    assert.equal(closes, 1);
});

test('une erreur popup est humaine, sans basculer silencieusement en redirection, puis peut être réessayée', async () => {
    const fake = fakeAuth();
    let popupCalls = 0;
    let redirects = 0;
    fake.sdk.signInWithPopup = async () => {
        popupCalls += 1;
        if (popupCalls === 1) throw Object.assign(new Error('popup blocked'), { code: 'auth/popup-blocked' });
        return { user: gm };
    };
    fake.sdk.signInWithRedirect = async () => { redirects += 1; };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory });
    await session.start();
    await session.signIn();
    assert.equal(session.getState().status, 'error');
    assert.equal(session.getState().error.kind, 'unknown');
    await session.signIn();
    assert.equal(popupCalls, 2);
    assert.equal(redirects, 0);
    assert.equal(session.getState().status, 'gm');
});

test('la redirection reste le seul fallback quand le SDK ne fournit pas de popup', async () => {
    const fake = fakeAuth();
    let redirects = 0;
    fake.sdk.signInWithRedirect = async () => { redirects += 1; };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory });
    await session.start();
    await session.signIn();
    assert.equal(redirects, 1);
    assert.equal(session.getState().status, 'signing-in');
});

test('une première erreur de connexion popup laisse le bouton Réessayer fonctionnel', async () => {
    const fake = fakeAuth();
    let attempts = 0;
    fake.sdk.signInWithPopup = async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('network'), { code: 'auth/network-request-failed' });
        return { user: gm };
    };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory });
    await session.start();
    await session.signIn();
    assert.equal(session.getState().status, 'error');
    await session.signIn();
    assert.equal(attempts, 2);
    assert.equal(session.getState().status, 'gm');
});

test('une double action de connexion popup est sérialisée par la session', async () => {
    const fake = fakeAuth();
    let popups = 0;
    fake.sdk.signInWithPopup = async () => { popups += 1; return { user: gm }; };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory });
    await session.start();
    await Promise.all([session.signIn(), session.signIn()]);
    assert.equal(popups, 1);
});

test('un compte non MJ reste joueur et ne monte aucun dépôt privé', async () => {
    const fake = fakeAuth({ redirect: player });
    let factories = 0;
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory: async () => { factories += 1; } });
    await session.start();
    assert.equal(session.getState().status, 'authenticated-non-gm');
    assert.equal(session.getState().private, null);
    assert.equal(factories, 0);
});

test('déconnexion pendant le privé invalide la génération et ferme listeners, images, dépôts et client', async () => {
    const fake = fakeAuth({ redirect: gm });
    const released = [];
    const session = createMjSession({
        auth: fake.auth, authSdk: fake.sdk,
        privateFactory: async () => ({
            unsubs: [() => released.push('listener')],
            images: { revokeAll: () => released.push('images') },
            repositories: { close: () => released.push('repos') },
            client: { cache: { mode: 'memory', persistent: false }, close: () => released.push('client') },
        }),
    });
    await session.start();
    const generation = session.getState().generation;
    await session.signOut();
    assert.equal(session.getState().status, 'visitor');
    assert.ok(session.getState().generation > generation);
    assert.deepEqual(released.sort(), ['client', 'images', 'listener', 'repos']);
    assert.equal(fake.calls.signOut, 1);
});

test('une identité B invalide la factory privée A et ferme son contexte complet', async () => {
    const fake = fakeAuth();
    let resolveA;
    const closed = [];
    const factory = async ({ user }) => {
        if (user.uid === 'a') {
            await new Promise(resolve => { resolveA = resolve; });
            return {
                unsubs: [() => closed.push('listener-a')],
                images: { revokeAll: () => closed.push('images-a') },
                repositories: { close: () => closed.push('repos-a') },
                client: { cache: { mode: 'memory' }, close: () => closed.push('client-a') },
            };
        }
        return { repositories: {}, client: { cache: { mode: 'memory' }, close: () => closed.push('client-b') } };
    };
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory: factory });
    await session.start();
    fake.emit({ ...gm, uid: 'a' });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    fake.emit({ ...gm, uid: 'b' });
    resolveA();
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(session.getState().user.uid, 'b');
    assert.equal(session.getState().status, 'gm');
    assert.deepEqual(closed.sort(), ['client-a', 'images-a', 'listener-a', 'repos-a']);
});

test('un contexte privé non conforme est fermé intégralement une seule fois', async () => {
    const fake = fakeAuth({ redirect: gm });
    const closed = [];
    const session = createMjSession({
        auth: fake.auth,
        authSdk: fake.sdk,
        privateFactory: async () => ({
            unsubs: [() => closed.push('listener')],
            images: { revokeAll: () => closed.push('images') },
            client: { cache: { mode: 'persistent', persistent: true }, close: () => closed.push('client') },
        }),
    });
    await session.start();
    assert.equal(session.getState().status, 'error');
    assert.deepEqual(closed.sort(), ['client', 'images', 'listener']);
});

test('trois cycles de connexion/déconnexion ne doublent ni observer ni client et MJ reste mémoire', async () => {
    const fake = fakeAuth();
    let factories = 0;
    let closes = 0;
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory: async () => {
        factories += 1;
        return { client: { cache: { mode: 'memory', persistent: false }, close: () => { closes += 1; } }, repositories: {} };
    } });
    for (let cycle = 0; cycle < 3; cycle += 1) {
        if (!session.getState().generation) await session.start();
        fake.emit(gm);
        await new Promise(resolve => globalThis.setTimeout(resolve, 0));
        await session.signOut();
    }
    assert.equal(factories, 3);
    assert.equal(closes, 3);
    assert.equal(session.getState().status, 'visitor');
});

test('stop dispose une app Auth possédée une seule fois, tandis que signOut ne la supprime pas', async () => {
    const fake = fakeAuth({ redirect: gm });
    let disposed = 0;
    const session = createMjSession({ auth: fake.auth, authSdk: fake.sdk, privateFactory, dispose: () => { disposed += 1; } });
    await session.start();
    await session.signOut();
    assert.equal(disposed, 0);
    await session.stop();
    await session.stop();
    assert.equal(disposed, 1);
});

test('préférences de route hostiles ne persistent ni courriel ni jeton', () => {
    const value = [];
    const storage = { getItem: () => value[0] || null, setItem: (_key, next) => { value[0] = next; }, removeItem: () => {} };
    const route = createSafeInitialRoute({ storage, key: 'route' });
    assert.equal(route.capture('#/pnjs/p1?email=secret@example.test'), null);
    assert.equal(route.capture('#/pnjs/p1'), '#/pnjs/p1');
    assert.match(value[0], /pnjs\/p1/u);
    assert.doesNotMatch(value[0], /email|secret|token/iu);
    for (const hostile of ['#/inconnu', '#/pnjs/p1/nope', '#/pnjs/p1?email=x', '#/pnjs/p1/modifier?token=x']) {
        assert.equal(route.capture(hostile), null, hostile);
    }
});

test('la composition ferme le client si un dépôt MJ ne peut pas être construit', async () => {
    let closed = 0;
    let observer;
    const sdk = {
        auth: { currentUser: null },
        getRedirectResult: async () => null,
        onAuthStateChanged: (_auth, callback) => { observer = callback; return () => {}; },
        onSnapshot() {},
    };
    const client = { cache: { mode: 'memory', persistent: false }, close: async () => { closed += 1; } };
    const builders = {
        client: async () => client,
        pnjs: () => { throw new Error('builder'); },
        relations: () => ({}),
        indices: () => ({}),
    };
    const session = createMjSessionComposition({ sdk, config: {}, builders });
    await session.start();
    observer({ ...gm });
    await new Promise(resolve => globalThis.setTimeout(resolve, 0));
    assert.equal(session.getState().status, 'error');
    assert.equal(closed, 1);
});

test('un relogin recrée une Firestore mémoire après terminate sans supprimer ni déconnecter l’app', async () => {
    const apps = [];
    const databases = new Map();
    const calls = { terminate: 0, deleteApp: 0, signOut: 0 };
    const sdk = {
        getApps: () => apps,
        initializeApp: (options, name) => { const app = { name, options: { ...options } }; apps.push(app); return app; },
        initializeFirestore: (app, options) => {
            const db = { app, options, terminated: false };
            databases.set(app, db);
            return db;
        },
        memoryLocalCache: () => ({ type: 'memory' }),
        getAuth: app => ({ app }),
        getStorage: app => ({ app }),
        terminate: async db => { calls.terminate += 1; db.terminated = true; databases.delete(db.app); },
        deleteApp: async () => { calls.deleteApp += 1; },
        signOut: async () => { calls.signOut += 1; },
    };
    const config = { projectId: 'relogin-project', appId: 'relogin-app' };
    const first = await createMjMobileClient({ sdk, config, appName: 'mobile-mj-relogin', deleteApplicationOnClose: false, signOutOnClose: false });
    const firstDb = first.db;
    await first.close();
    const second = await createMjMobileClient({ sdk, config, appName: 'mobile-mj-relogin', deleteApplicationOnClose: false, signOutOnClose: false });
    assert.notEqual(second.db, firstDb);
    assert.equal(firstDb.terminated, true);
    assert.equal(second.db.terminated, false);
    assert.equal(calls.terminate, 1);
    assert.equal(calls.deleteApp, 0);
    assert.equal(calls.signOut, 0);
    await second.close();
});

test('runtime public et runtime MJ restent séparés et les actions privées sont fail-closed', () => {
    assert.doesNotMatch(read('js/mobile/public-runtime.js'), /getAuth|signInWithRedirect|GoogleAuthProvider/iu);
    assert.match(read('js/mobile/mj-runtime.js'), /firebase-auth/iu);
    assert.match(read('js/mobile/mj-runtime.js'), /signInWithPopup/u);
    assert.match(read('js/mobile/mj-runtime.js'), /if \(!existing\)/u);
    for (const method of ['getDoc', 'getDocs', 'runTransaction', 'writeBatch', 'serverTimestamp', 'arrayRemove', 'deleteField']) {
        assert.match(read('js/mobile/mj-runtime.js'), new RegExp(`\\b${method}\\b`, 'u'), method);
    }
    assert.match(read('js/mobile/mj-runtime.js'), /firebase-app\.js'[\s\S]*deleteApp/u);
    const runtimeSource = read('js/mobile/mj-runtime.js');
    const firestoreEnd = runtimeSource.indexOf("from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'");
    const firestoreImport = runtimeSource.slice(runtimeSource.lastIndexOf('import {', firestoreEnd), firestoreEnd);
    assert.doesNotMatch(firestoreImport, /\bdeleteApp\b/u);
    assert.match(read('js/mobile/mj-composition.js'), /deleteApplicationOnClose:\s*false/u);
    assert.match(read('js/mobile/mj-composition.js'), /signOutOnClose:\s*false/u);
    assert.match(read('app/index.html'), /frame-src\s+https:\/\/campagne-wrpg\.firebaseapp\.com/u);
    assert.match(read('js/mobile/app.js'), /ROUTE_NAMES\.PNJ_EDIT/u);
});

test('la CSP mobile autorise le chargement Google réellement requis par Firebase Auth', () => {
    const runtime = read('js/mobile/mj-runtime.js');
    const html = read('app/index.html');
    const csp = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/iu)?.[1] ?? '';
    const directives = Object.fromEntries(csp.split(';').map(part => {
        const tokens = part.trim().split(/\s+/u);
        return [tokens.shift() ?? '', tokens];
    }).filter(([name]) => name));
    assert.match(runtime, /firebase-auth\.js['"]/u, 'le contrat testé doit suivre le vrai runtime Firebase Auth');
    assert.ok(directives['script-src']?.includes('https://apis.google.com'),
        'Firebase Auth charge https://apis.google.com/js/api.js dynamiquement');
    assert.ok(!directives['connect-src']?.includes('https://apis.google.com'),
        'connect-src ne doit pas être élargi sans requête réseau démontrée');
    assert.ok(!directives['frame-src']?.includes('https://apis.google.com'),
        'frame-src ne doit pas être élargi sans iframe démontrée');
    assert.doesNotMatch(directives['script-src']?.join(' ') ?? '', /\*|unsafe-inline|unsafe-eval/u);
});

test('la route de modification est explicite et reste protégée avant le rendu', () => {
    assert.deepEqual(parseRoute('#/pnjs/p1/modifier'), { name: ROUTE_NAMES.PNJ_EDIT, id: 'p1' });
    assert.equal(routeToHash({ name: ROUTE_NAMES.PNJ_EDIT, id: 'p1' }), '#/pnjs/p1/modifier');
    assert.equal(parseRoute('#/pnjs/p1/modifier?email=x').name, ROUTE_NAMES.UNKNOWN);
    assert.match(read('js/mobile/app.js'), /status\.status !== 'gm'/u);
    assert.match(read('js/mobile/app.js'), /action\.disabled = busy/u);
    assert.match(read('js/mobile/app.js'), /router\.refresh\(\)/u);
});

test('refresh remonte une route identique après checking puis replace une édition refusée', () => {
    const mounts = [];
    const listeners = new Map();
    const windowRef = {
        location: { hash: '#/pnjs/p1/modifier' },
        history: { replaceState: (_state, _title, hash) => { windowRef.location.hash = hash; } },
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: name => listeners.delete(name),
    };
    const router = createRouter({ windowRef, mountRoute: route => ({ mount: () => mounts.push(route.name), unmount() {} }) });
    router.start();
    router.refresh();
    assert.deepEqual(mounts, [ROUTE_NAMES.PNJ_EDIT, ROUTE_NAMES.PNJ_EDIT]);
    router.navigate({ name: ROUTE_NAMES.PNJ, id: 'p1' }, { replace: true });
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJ);
    router.stop();
});

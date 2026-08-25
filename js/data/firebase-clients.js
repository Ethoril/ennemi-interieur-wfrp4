import { FIREBASE_CONFIG, FIREBASE_FUNCTIONS_REGION } from '../firebase-config.js';
import { FirebaseClientError, ERROR_KINDS, classifyFirebaseError, normalizeFirebaseError } from './firebase-errors.js';

const APP_NAMES = Object.freeze({ public: 'mobile-public', mj: 'mobile-mj' });
const firestoreByApp = new WeakMap();
const firestoreInitializationByApp = new WeakMap();
const lifecycleByApp = new WeakMap();
const closingBySdk = new WeakMap();

function closingMap(sdk) {
    let map = closingBySdk.get(sdk);
    if (!map) {
        map = new Map();
        closingBySdk.set(sdk, map);
    }
    return map;
}

function registerClosing(sdk, appName, promise) {
    const map = closingMap(sdk);
    map.set(appName, promise);
    promise.then(result => {
        // Une suppression échouée est un verrou fail-closed : une nouvelle fabrique
        // doit rester refusée tant que deleteApp n’a pas abouti.
        if (result?.deleted === false) return;
        if (map.get(appName) === promise) map.delete(appName);
        if (map.size === 0) closingBySdk.delete(sdk);
    }, () => { /* Une fermeture inattendue reste également bloquante. */ });
}

async function waitForClosing(sdk, appName) {
    const pending = closingBySdk.get(sdk)?.get(appName);
    if (!pending) return;
    const result = await pending;
    if (result?.deleted === false) {
        throw normalizeFirebaseError(result.error, { operation: 'reopen-app' });
    }
}

function sameConfig(app, config) {
    return Object.entries(config).every(([key, value]) => app?.options?.[key] === value);
}

function getOrCreateNamedAppWithOwnership(sdk, config, name) {
    if (!sdk || typeof sdk.initializeApp !== 'function' || typeof sdk.getApps !== 'function') {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'initialize-app' });
    }
    const existing = sdk.getApps().find(candidate => candidate.name === name);
    if (existing) {
        if (!sameConfig(existing, config)) {
            throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'initialize-app' });
        }
        return { app: existing, created: false };
    }
    return { app: sdk.initializeApp(config, name), created: true };
}

export function getOrCreateNamedApp(sdk, config, name) {
    return getOrCreateNamedAppWithOwnership(sdk, config, name).app;
}

async function finalizeLifecycleClose({ sdk, app, auth, db, signOutOnClose, deleteApplication = true }) {
    let firstError = null;
    let deleted = false;
    try {
        if (signOutOnClose && auth && typeof sdk?.signOut === 'function') await sdk.signOut(auth);
    } catch (error) {
        firstError = error;
    }
    try {
        if (typeof sdk?.terminate === 'function' && db) await sdk.terminate(db);
    } catch (error) {
        firstError ??= error;
    }
    if (deleteApplication) {
        try {
            if (typeof sdk?.deleteApp !== 'function') throw new Error('deleteApp unavailable');
            await sdk.deleteApp(app);
            deleted = true;
        } catch (error) {
            firstError ??= error;
        }
    } else {
        // Firestore est terminé mais l'application Auth reste vivante pour
        // permettre une nouvelle connexion après une déconnexion MJ.
        deleted = true;
    }
    return { error: firstError, deleted };
}

function createClientHandle({ mode, sdk, app, appName = null, auth = null, db, storage = null, functions = null, cache = null, signOutOnClose = false, deleteApplication = true }) {
    const listeners = new Set();
    let closed = false;
    const listen = (...args) => {
        if (closed) throw new FirebaseClientError(ERROR_KINDS.CONFLICT, { operation: 'listen' });
        if (typeof sdk?.onSnapshot !== 'function') throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'listen' });
        const [target, onNext, onError, ...rest] = args;
        let active = true;
        const safeNext = value => { if (active && typeof onNext === 'function') onNext(value); };
        const safeError = error => { if (active && typeof onError === 'function') onError(error); };
        const rawUnsubscribe = sdk.onSnapshot(target, safeNext, safeError, ...rest);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            active = false;
            listeners.delete(release);
            if (typeof rawUnsubscribe === 'function') rawUnsubscribe();
        };
        listeners.add(release);
        return release;
    };
    const close = async () => {
        if (closed) return;
        closed = true;
        try {
            for (const unsubscribe of listeners) {
                try { unsubscribe(); } catch { /* Un abonnement défaillant ne doit pas bloquer le nettoyage. */ }
            }
            listeners.clear();
        }
        catch { /* Un abonnement défaillant ne doit pas empêcher la fermeture globale. */ }

        const lifecycle = lifecycleByApp.get(app);
        if (!lifecycle) return;
        lifecycle.references -= 1;
        if (lifecycle.references > 0) return;

        lifecycleByApp.delete(app);
        firestoreByApp.delete(app);
        firestoreInitializationByApp.delete(app);
        const closing = scheduleClosing(sdk, appName, () => finalizeLifecycleClose({
            sdk, app, auth, db, signOutOnClose, deleteApplication,
        }));
        const result = await closing;
        if (result.error) throw normalizeFirebaseError(result.error, { operation: 'close' });
    };
    return Object.freeze({ mode, app, appName, auth, db, storage, functions, cache, listen, close });
}

function retainApp(app, db) {
    const lifecycle = lifecycleByApp.get(app) ?? { references: 0, db };
    lifecycle.references += 1;
    lifecycle.db = db;
    lifecycleByApp.set(app, lifecycle);
}

export function createBureauClient({ sdk, app, auth, db, storage = null, functions = null } = {}) {
    return createClientHandle({ mode: 'bureau', sdk, app, auth, db, storage, functions });
}

export const createDesktopClient = createBureauClient;

function rememberFirestore(app, db, cache) {
    const value = { db, cache };
    firestoreByApp.set(app, value);
    return value;
}

function existingFirestore(app) {
    return firestoreByApp.get(app) ?? null;
}

function memoryFallback(cause) {
    return {
        mode: 'memory-fallback',
        persistent: false,
        fallback: true,
        reason: classifyFirebaseError(cause),
    };
}

function scheduleClosing(sdk, appName, task) {
    let resolveClosing;
    const closing = new Promise(resolve => { resolveClosing = resolve; });
    registerClosing(sdk, appName, closing);
    Promise.resolve().then(task).then(resolveClosing, error => resolveClosing({ error, deleted: false }));
    return closing;
}

async function cleanupUnretainedApp({ sdk, app, appName, db, owned }) {
    if (!owned) return { deleted: true, error: null };
    return scheduleClosing(sdk, appName, async () => {
        // Le handle concurrent peut être retenu après l’appel à cette fonction mais
        // avant l’exécution de la tâche : la relecture doit précéder toute suppression.
        if ((lifecycleByApp.get(app)?.references ?? 0) > 0) return { deleted: true, error: null };
        firestoreByApp.delete(app);
        firestoreInitializationByApp.delete(app);
        return finalizeLifecycleClose({ sdk, app, auth: null, db, signOutOnClose: false });
    });
}

function createMemoryFirestore(sdk, app) {
    if (typeof sdk.initializeFirestore !== 'function' || typeof sdk.memoryLocalCache !== 'function') {
        throw new FirebaseClientError(ERROR_KINDS.VALIDATION, { operation: 'initialize-memory-firestore' });
    }
    return sdk.initializeFirestore(app, { localCache: sdk.memoryLocalCache() });
}

async function initializePublicFirestoreOnce(sdk, app, config, appName, appOwned) {
    const known = existingFirestore(app);
    if (known) return { app, ...known, owned: appOwned };
    let db = null;
    try {
        if (typeof sdk.initializeFirestore === 'function'
            && typeof sdk.persistentLocalCache === 'function'
            && typeof sdk.persistentMultipleTabManager === 'function') {
            db = sdk.initializeFirestore(app, {
                localCache: sdk.persistentLocalCache({ tabManager: sdk.persistentMultipleTabManager() }),
            });
            // L’appel est un point d’injection testable qui force l’ouverture du client avant le signal succès.
            if (typeof sdk.enableNetwork !== 'function') throw new Error('persistence probe unavailable');
            await sdk.enableNetwork(db);
            return {
                app,
                ...rememberFirestore(app, db, { mode: 'persistent-multi-tab', persistent: true, fallback: false, cause: null }),
                owned: appOwned,
            };
        }
        // Compatibilité limitée avec une version Firebase qui ne fournit pas encore l’API moderne.
        db = sdk.getFirestore(app);
        if (typeof sdk.enableMultiTabIndexedDbPersistence !== 'function') throw new Error('persistence unavailable');
        await sdk.enableMultiTabIndexedDbPersistence(db);
        return {
            app,
            ...rememberFirestore(app, db, { mode: 'persistent-multi-tab', persistent: true, fallback: false, cause: null }),
            owned: appOwned,
        };
    } catch (cause) {
        // Une application externe ne peut pas être arrêtée puis réinitialisée par cette fabrique :
        // le fallback mémoire recréé est réservé à une app dont nous maîtrisons le cycle de vie.
        if (!appOwned) throw normalizeFirebaseError(cause, { operation: 'initialize-public-firestore' });
        let cleanupResult = { deleted: true, error: null };
        cleanupResult = await cleanupUnretainedApp({ sdk, app, appName, db, owned: true });
        let memoryAppInfo = null;
        let memoryApp = null;
        let memoryDb = null;
        try {
            if (cleanupResult.error) throw normalizeFirebaseError(cleanupResult.error, { operation: 'initialize-public-firestore' });
            memoryAppInfo = appOwned
                ? getOrCreateNamedAppWithOwnership(sdk, config, appName)
                : { app, created: false };
            memoryApp = memoryAppInfo.app;
            memoryDb = createMemoryFirestore(sdk, memoryApp);
            return {
                app: memoryApp,
                ...rememberFirestore(memoryApp, memoryDb, memoryFallback(cause)),
                owned: memoryAppInfo.created,
            };
        } catch (fallbackCause) {
            if (memoryApp) {
                await cleanupUnretainedApp({
                    sdk, app: memoryApp, appName, db: memoryDb, owned: memoryAppInfo.created,
                });
            }
            if (fallbackCause instanceof FirebaseClientError) throw fallbackCause;
            throw new FirebaseClientError(ERROR_KINDS.UNKNOWN, { cause: fallbackCause, operation: 'initialize-public-firestore' });
        }
    }
}

function initializePublicFirestore(sdk, app, config, appName, appOwned) {
    if (firestoreInitializationByApp.has(app)) return firestoreInitializationByApp.get(app);
    const promise = initializePublicFirestoreOnce(sdk, app, config, appName, appOwned);
    firestoreInitializationByApp.set(app, promise);
    return promise;
}

function initializeMjFirestore(sdk, app) {
    const known = existingFirestore(app);
    if (known) return known;
    try {
        const db = createMemoryFirestore(sdk, app);
        return rememberFirestore(app, db, { mode: 'memory', persistent: false, fallback: false, cause: null });
    } catch (cause) {
        if (cause instanceof FirebaseClientError) throw cause;
        throw new FirebaseClientError(classifyFirebaseError(cause), { cause, operation: 'initialize-mj-firestore' });
    }
}

export async function createPublicMobileClient({ sdk, config = FIREBASE_CONFIG, appName = APP_NAMES.public } = {}) {
    await waitForClosing(sdk, appName);
    const appInfo = getOrCreateNamedAppWithOwnership(sdk, config, appName);
    let initialized = null;
    try {
        initialized = await initializePublicFirestore(sdk, appInfo.app, config, appName, appInfo.created);
        const storage = sdk.getStorage(initialized.app);
        retainApp(initialized.app, initialized.db);
        return createClientHandle({
            mode: 'mobile-public', sdk, app: initialized.app, appName, db: initialized.db, storage,
            cache: initialized.cache,
        });
    } catch (cause) {
        if (initialized) {
            await cleanupUnretainedApp({
                sdk, app: initialized.app, appName, db: initialized.db, owned: initialized.owned,
            });
        }
        if (cause instanceof FirebaseClientError) throw cause;
        throw normalizeFirebaseError(cause, { operation: 'create-public-client' });
    }
}

export async function createMjMobileClient({ sdk, config = FIREBASE_CONFIG, appName = APP_NAMES.mj, deleteApplicationOnClose = true, signOutOnClose = true } = {}) {
    await waitForClosing(sdk, appName);
    const appInfo = getOrCreateNamedAppWithOwnership(sdk, config, appName);
    let db = null;
    let retained = false;
    try {
        db = initializeMjFirestore(sdk, appInfo.app).db;
        const auth = sdk.getAuth(appInfo.app);
        const storage = sdk.getStorage(appInfo.app);
        const functions = typeof sdk.getFunctions === 'function' ? sdk.getFunctions(appInfo.app, FIREBASE_FUNCTIONS_REGION) : null;
        retainApp(appInfo.app, db);
        retained = true;
        return createClientHandle({
            mode: 'mobile-mj', sdk, app: appInfo.app, appName, auth, db, storage, functions,
            cache: { mode: 'memory', persistent: false, fallback: false }, deleteApplication: deleteApplicationOnClose,
            signOutOnClose,
        });
    } catch (cause) {
        if (!retained) {
            await cleanupUnretainedApp({ sdk, app: appInfo.app, appName, db, owned: appInfo.created });
        }
        if (cause instanceof FirebaseClientError) throw cause;
        throw normalizeFirebaseError(cause, { operation: 'create-mj-client' });
    }
}

import { createPublicStore } from './store.js';
import { ADMIN_EMAIL } from '../firebase-config.js';

// Ces états sont volontairement distincts : « checking » masque les actions
// privées tant que le retour Google n'a pas été consommé.
export const MOBILE_SESSION_STATES = Object.freeze([
    'checking', 'visitor', 'authenticated-non-gm', 'gm', 'signing-in', 'signing-out', 'error',
]);

const AUTH_CANCEL_CODES = Object.freeze([
    'auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled',
    'auth/redirect-cancelled-by-user',
]);

function authError(error, fallback = 'unknown') {
    const code = typeof error?.code === 'string' ? error.code : fallback;
    const normalized = code.toLowerCase();
    if (AUTH_CANCEL_CODES.includes(normalized) || normalized.includes('cancel')) return { kind: 'cancelled', code };
    if (normalized.includes('network') || normalized.includes('offline') || normalized.includes('timeout')) {
        return { kind: 'offline', code };
    }
    if (normalized.includes('permission') || normalized.includes('unauthorized')) return { kind: 'permission', code };
    return { kind: 'unknown', code };
}

function safeIdentity(user) {
    if (!user || typeof user !== 'object') return null;
    return Object.freeze({
        uid: typeof user.uid === 'string' ? user.uid : null,
        displayName: typeof user.displayName === 'string' ? user.displayName : '',
        email: typeof user.email === 'string' ? user.email : null,
        emailVerified: user.emailVerified === true,
    });
}

function isGmUser(user, adminEmail) {
    return !!user && user.email === adminEmail && user.emailVerified === true;
}

export { isGmUser };

export function safeRouteHash(value) {
    if (typeof value !== 'string' || value.length > 500 || !value.startsWith('#/')) return null;
    if (/[?&](?:email|token|access_token|id_token|code)=/iu.test(value)) return null;
    if (/^#\/pnjs$/u.test(value) || /^#\/enquetes$/u.test(value) || /^#\/reglages$/u.test(value)) return value;
    if (value === '#/pnjs/nouveau' || value === '#/enquetes/nouveau') return value;
    if (/^#\/(?:pnjs|enquetes)\/[A-Za-z0-9_-]{1,150}$/u.test(value)) return value;
    if (/^#\/pnjs\/[A-Za-z0-9_-]{1,150}\/modifier$/u.test(value)) return value;
    if (/^#\/enquetes\/[A-Za-z0-9_-]{1,150}\/modifier$/u.test(value)) return value;
    return null;
}

export function createSafeInitialRoute({ windowRef = globalThis.window, storage = undefined, key = 'wfrp-mobile-initial-route-v1' } = {}) {
    let target = storage;
    if (target === undefined) {
        try { target = windowRef?.sessionStorage; } catch { target = null; }
    }
    const read = () => {
        try { return safeRouteHash(target?.getItem?.(key)); } catch { return null; }
    };
    const capture = value => {
        const route = safeRouteHash(value);
        if (!route) return null;
        try { target?.setItem?.(key, route); } catch { /* La session reste correcte sans stockage de route. */ }
        return route;
    };
    const pendingKey = `${key}-redirect-pending`;
    const markRedirectPending = () => {
        try { target?.setItem?.(pendingKey, '1'); } catch { /* Le retour sera traité comme une session normale. */ }
    };
    const consumeRedirectPending = () => {
        let pending = false;
        try { pending = target?.getItem?.(pendingKey) === '1'; } catch { /* Stockage indisponible. */ }
        try { target?.removeItem?.(pendingKey); } catch { /* Nettoyage best-effort. */ }
        return pending;
    };
    const clearRedirectPending = () => {
        try { target?.removeItem?.(pendingKey); } catch { /* Nettoyage best-effort. */ }
    };
    const consume = fallback => {
        const route = read() || safeRouteHash(fallback) || '#/pnjs';
        try { target?.removeItem?.(key); } catch { /* Le stockage peut être indisponible en mode privé. */ }
        return route;
    };
    return Object.freeze({ capture, read, consume, key, markRedirectPending, consumeRedirectPending, clearRedirectPending });
}

export function createMobileSession({ onChange = () => {} } = {}) {
    let state = Object.freeze({ status: 'anonymous', role: 'public', user: null });
    let active = true;
    const emit = () => { if (active) onChange(state); };
    const setState = next => {
        if (!active || !next || typeof next !== 'object') return state;
        const authenticated = next.status === 'authenticated';
        state = Object.freeze({
            status: authenticated ? 'authenticated' : 'anonymous',
            role: authenticated && next.role === 'mj' ? 'mj' : 'public',
            user: authenticated && next.user && typeof next.user === 'object' ? next.user : null,
        });
        emit();
        return state;
    };
    const stop = () => { active = false; };
    return Object.freeze({
        getState: () => state,
        setState,
        reset: () => setState({ status: 'anonymous', role: 'public', user: null }),
        stop,
    });
}

export function createPublicMobileSession(options = {}) {
    const store = createPublicStore(options);
    return Object.freeze({
        store,
        start: () => store.start(),
        stop: () => store.stop(),
        restart: () => store.restart(),
        subscribe: listener => store.subscribe(listener),
        getState: () => store.getState(),
        setPreferences: value => store.setPreferences(value),
        inspect: () => store.inspect(),
        getImages: () => store.getService('images'),
    });
}

/**
 * Session Auth mobile injectable. Le module ne connaît ni le DOM ni le SDK
 * Firebase concret : cela permet de tester les cycles et le nettoyage sans
 * navigateur, et garde le runtime public sans Auth.
 */
export function createMjSession({
    auth = null,
    authSdk = {},
    adminEmail = ADMIN_EMAIL,
    privateFactory = null,
    onChange = () => {},
    route = null,
    windowRef = globalThis.window,
    storage = undefined,
    initialRouteKey = 'wfrp-mobile-initial-route-v1',
    onNavigate = () => {},
    cleanup = null,
    dispose = null,
} = {}) {
    if (!auth || typeof authSdk !== 'object') throw new TypeError('auth et SDK Auth requis');
    const routeStore = route || createSafeInitialRoute({ windowRef, storage, key: initialRouteKey });
    const listeners = new Set();
    const privateCleanups = new Set();
    let state = Object.freeze({
        status: 'checking', role: 'public', user: null, error: null, generation: 0,
        private: null, initialRoute: routeStore.read(),
    });
    let active = true;
    let started = false;
    let redirectChecked = false;
    let redirectFailure = false;
    let observerUser = undefined;
    let processingUid = null;
    let observerUnsubscribe = null;
    let privateContext = null;
    let disposed = false;
    let generation = 0;
    let operation = Promise.resolve();
    let authOperation = false;

    const emit = () => {
        if (!active) return;
        onChange(state);
        for (const listener of [...listeners]) {
            try { listener(state); } catch { /* Une vue défaillante ne bloque pas la session. */ }
        }
    };
    const setState = next => {
        if (!active || !next) return state;
        const status = next.status || state.status;
        if (['gm', 'visitor', 'authenticated-non-gm', 'error'].includes(status)) authOperation = false;
        state = Object.freeze({ ...state, ...next, status, role: status === 'gm' ? 'mj' : 'public', generation });
        emit();
        return state;
    };
    const current = token => active && token === generation;
    const closeOne = async value => {
        if (!value) return;
        try {
            if (typeof value === 'function') await value();
            else if (typeof value.close === 'function') await value.close();
            else if (typeof value.unsubscribe === 'function') await value.unsubscribe();
            else if (typeof value.revokeAll === 'function') await value.revokeAll();
            else if (typeof value.clear === 'function') await value.clear();
        } catch { /* Un nettoyage partiel ne doit jamais conserver la session privée. */ }
    };
    const closeContext = async context => {
        if (!context) return;
        for (const value of context.unsubs || []) await closeOne(value);
        await closeOne(context.images);
        await closeOne(context.formState);
        await closeOne(context.notes);
        await closeOne(context.errors);
        await closeOne(context.cache);
        await closeOne(context.repositories);
        await closeOne(context.client);
    };
    const cleanupPrivate = async ({ invalidate = true } = {}) => {
        if (invalidate) generation += 1;
        const context = privateContext;
        privateContext = null;
        state = Object.freeze({ ...state, generation, private: null });
        for (const release of [...privateCleanups]) {
            privateCleanups.delete(release);
            await closeOne(release);
        }
        if (context) {
            await closeContext(context);
        }
        await closeOne(cleanup && (() => cleanup({ context, generation })));
    };

    const finishUserInternal = async user => {
        if (!active || !redirectChecked) return;
        const token = generation;
        observerUser = user;
        if (!user) {
            await cleanupPrivate({ invalidate: false });
            if (current(token)) setState({ status: 'visitor', user: null, error: null });
            return;
        }
        const identity = safeIdentity(user);
        if (!isGmUser(user, adminEmail)) {
            await cleanupPrivate({ invalidate: false });
            if (current(token)) setState({ status: 'authenticated-non-gm', user: identity, error: null });
            return;
        }
        if (typeof privateFactory !== 'function') {
            setState({ status: 'error', user: identity, error: { kind: 'unknown', code: 'private-client-unavailable' } });
            return;
        }
        setState({ status: 'checking', user: identity, error: null, private: null });
        processingUid = identity?.uid || null;
        let createdContext = null;
        let contextAdopted = false;
        try {
            createdContext = await privateFactory({ user, generation: token, signal: { get aborted() { return !current(token); } } });
            if (!current(token) || processingUid !== identity?.uid) {
                await closeContext(createdContext);
                createdContext = null;
                return;
            }
            if (!createdContext?.client || !createdContext?.repositories || createdContext.client.cache?.mode !== 'memory'
                || createdContext.client.cache?.persistent === true) {
                throw Object.assign(new Error('private client contract'), { code: 'private-client-contract' });
            }
            privateContext = {
                ...createdContext,
                unsubs: Array.isArray(createdContext?.unsubs) ? [...createdContext.unsubs] : [],
            };
            contextAdopted = true;
            setState({ status: 'gm', private: Object.freeze({ repositories: createdContext.repositories, cache: createdContext.client.cache || { mode: 'memory', persistent: false } }) });
        } catch (error) {
            if (createdContext && !contextAdopted) await closeContext(createdContext);
            await cleanupPrivate({ invalidate: false });
            if (current(token)) setState({ status: 'error', user: identity, error: authError(error, 'private-client') });
        } finally {
            if (processingUid === identity?.uid) processingUid = null;
        }
    };

    // Firebase may publish the popup result through onAuthStateChanged just
    // before signInWithPopup resolves (or just after redirectChecked flips).
    // Both paths must share one finalization promise, otherwise two private
    // Firestore clients can be created and one can escape cleanup.
    let finishInFlight = null;
    let finishInFlightUid = null;
    const finishUser = user => {
        const uid = typeof user?.uid === 'string' ? user.uid : null;
        if (uid && finishInFlight && finishInFlightUid === uid) return finishInFlight;
        const promise = finishUserInternal(user);
        if (!uid) return promise;
        finishInFlightUid = uid;
        finishInFlight = promise.finally(() => {
            if (finishInFlightUid === uid) {
                finishInFlight = null;
                finishInFlightUid = null;
            }
        });
        return finishInFlight;
    };

    const inspectRedirect = async token => {
        let result = null;
        let redirectError = null;
        const redirectPending = routeStore.consumeRedirectPending?.() === true;
        try {
            if (typeof authSdk.getRedirectResult === 'function') result = await authSdk.getRedirectResult(auth);
        } catch (error) { redirectError = error; }
        if (!current(token)) return;
        redirectChecked = true;
        const resultUser = result?.user || null;
        if (redirectError) {
            const normalized = authError(redirectError);
            if (normalized.kind !== 'cancelled') {
                redirectFailure = true;
                setState({ status: 'error', user: null, error: normalized });
                return;
            }
        }
        // A pending marker can be left by v2.21.5 when the browser never
        // completed the cross-origin redirect.  It is consumed above and is
        // deliberately treated as a normal visitor state: the next explicit
        // gesture must be able to open the popup without a second, confusing
        // recovery action or a redirect loop.
        if (redirectPending && !result?.user && !(observerUser || auth.currentUser)) {
            setState({ status: 'visitor', user: null, error: null });
            return;
        }
        routeStore.clearRedirectPending?.();
        await finishUser(resultUser || (observerUser === undefined ? auth.currentUser || null : observerUser));
        if (current(token) && state.status === 'gm') {
            const target = routeStore.consume(state.initialRoute);
            if (target) onNavigate(target);
        }
    };

    const start = async () => {
        if (started) return state;
        started = true;
        active = true;
        const token = ++generation;
        redirectChecked = false;
        redirectFailure = false;
        setState({ status: 'checking', user: null, error: null, private: null, initialRoute: routeStore.read() });
        try {
            if (typeof authSdk.onAuthStateChanged === 'function') {
                observerUnsubscribe = authSdk.onAuthStateChanged(auth, user => {
                    observerUser = user;
                    if (state.status === 'signing-out') return;
                    if (redirectChecked && !redirectFailure) {
                        if (state.status === 'gm' && state.user?.uid === user?.uid) return;
                        if (processingUid && processingUid === user?.uid) return;
                        const changeGeneration = ++generation;
                        setState({ status: 'checking', user: safeIdentity(user), private: null, error: null });
                        operation = operation.then(async () => {
                            await cleanupPrivate({ invalidate: false });
                            if (current(changeGeneration)) await finishUser(user);
                        });
                    }
                });
            }
            await inspectRedirect(token);
        } catch (error) {
            if (current(token)) {
                redirectChecked = true;
                setState({ status: 'error', user: null, error: authError(error) });
            }
        }
        return state;
    };
    const signIn = async ({ route: targetRoute = windowRef?.location?.hash } = {}) => {
        if (authOperation) return state;
        authOperation = true;
        routeStore.capture(targetRoute || windowRef?.location?.hash || state.initialRoute);
        redirectFailure = false;
        setState({ status: 'signing-in', error: null });
        let provider = {};
        try {
            provider = typeof authSdk.GoogleAuthProvider === 'function'
                ? new authSdk.GoogleAuthProvider() : (typeof authSdk.googleProvider === 'function' ? authSdk.googleProvider() : {});
            // Popup is the primary flow.  It stays within the page origin and
            // avoids the third-party-storage failure of Firebase redirects on
            // modern mobile browsers.  A redirect is retained only for SDKs
            // that do not expose the popup API at all.
            if (typeof authSdk.signInWithPopup === 'function') {
                const result = await authSdk.signInWithPopup(auth, provider);
                routeStore.clearRedirectPending?.();
                redirectChecked = true;
                await finishUser(result?.user || auth.currentUser || null);
                if (state.status === 'gm') onNavigate(routeStore.consume(state.initialRoute));
                return state;
            }
            if (typeof authSdk.signInWithRedirect !== 'function') throw Object.assign(new Error('redirect unavailable'), { code: 'auth/operation-not-supported' });
            routeStore.markRedirectPending?.();
            await authSdk.signInWithRedirect(auth, provider);
            return state;
        } catch (error) {
            const normalized = authError(error);
            routeStore.clearRedirectPending?.();
            setState({ status: normalized.kind === 'cancelled' ? 'visitor' : 'error', error: normalized });
            return state;
        }
    };
    const signOut = async () => {
        if (authOperation) return state;
        authOperation = true;
        const token = ++generation;
        setState({ status: 'signing-out', error: null, private: null });
        await cleanupPrivate({ invalidate: false });
        routeStore.clearRedirectPending?.();
        try {
            if (typeof authSdk.signOut === 'function') await authSdk.signOut(auth);
            if (current(token)) setState({ status: 'visitor', user: null, error: null });
        } catch (error) {
            if (current(token)) setState({ status: 'error', user: null, error: authError(error) });
        }
        return state;
    };
    const registerCleanup = release => {
        if (typeof release !== 'function' && !release) return () => {};
        privateCleanups.add(release);
        return () => privateCleanups.delete(release);
    };
    const stop = async () => {
        if (!started) {
            if (!disposed) { disposed = true; await closeOne(dispose); }
            return;
        }
        started = false;
        active = false;
        generation += 1;
        try { observerUnsubscribe?.(); } catch { /* Le listener Auth est déjà obsolète. */ }
        observerUnsubscribe = null;
        await cleanupPrivate({ invalidate: false });
        if (!disposed) { disposed = true; await closeOne(dispose); }
        listeners.clear();
    };
    const subscribe = listener => {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        try { listener(state); } catch { /* Isolation des vues. */ }
        return () => listeners.delete(listener);
    };
    return Object.freeze({
        start, stop, close: stop, signIn, login: signIn, signOut, logout: signOut, subscribe,
        getState: () => state,
        registerCleanup,
        captureInitialRoute: routeStore.capture,
        consumeInitialRoute: routeStore.consume,
        inspect: () => Object.freeze({ status: state.status, generation: state.generation, hasPrivate: !!privateContext }),
    });
}

export const createMobileAuthSession = createMjSession;

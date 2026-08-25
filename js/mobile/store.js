const RESOURCE_NAMES = Object.freeze(['pnjs', 'relations', 'indices']);
const FILTER_NAMES = Object.freeze(['statut', 'groupe', 'lieu']);
const DEFAULT_FILTERS = Object.freeze({
    search: '',
    statut: Object.freeze([]),
    groupe: Object.freeze([]),
    lieu: Object.freeze([]),
});
const DEFAULT_PREFERENCES = Object.freeze({
    version: 1,
    theme: 'dark',
    lastSection: 'pnjs',
    filters: DEFAULT_FILTERS,
});

function freezeValue(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeValue));
    if (value && typeof value === 'object'
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
        return Object.freeze(Object.fromEntries(Object.entries(value)
            .map(([key, item]) => [key, freezeValue(item)])));
    }
    return value;
}

function freezeItems(items) {
    return Object.freeze((Array.isArray(items) ? items : []).map(freezeValue));
}

function emptyResource() {
    return Object.freeze({
        status: 'loading',
        items: Object.freeze([]),
        metadata: Object.freeze({ fromCache: false, hasPendingWrites: false }),
        lastServerAt: null,
        error: null,
    });
}

function initialResources() {
    return Object.freeze(Object.fromEntries(RESOURCE_NAMES.map(name => [name, emptyResource()])));
}

function uiError(error) {
    return Object.freeze({
        kind: typeof error?.kind === 'string' ? error.kind : 'unknown',
        code: typeof error?.technicalCode === 'string' ? error.technicalCode : null,
    });
}

function defaultStorage(storage) {
    if (storage !== undefined) return storage;
    try { return globalThis.localStorage; } catch { return null; }
}

function safeString(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeFilterList(value) {
    if (!Array.isArray(value)) return Object.freeze([]);
    const unique = new Set();
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const normalized = item.trim().slice(0, 100);
        if (normalized) unique.add(normalized);
        if (unique.size >= 20) break;
    }
    return Object.freeze([...unique]);
}

function safeFilters(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_FILTERS;
    return Object.freeze({
        search: safeString(value.search, 120),
        ...Object.fromEntries(FILTER_NAMES.map(name => [name, safeFilterList(value[name])])),
    });
}

export function sanitizePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
        return DEFAULT_PREFERENCES;
    }
    const preferences = {
        version: 1,
        theme: value.theme === 'parchment' ? 'parchment' : 'dark',
        lastSection: ['pnjs', 'enquetes', 'reglages'].includes(value.lastSection)
            ? value.lastSection : 'pnjs',
        filters: safeFilters(value.filters),
    };
    // Cette clé est ajoutée à la première saisie Enquêtes afin de conserver la
    // forme historique des préférences PNJ lors d'une migration silencieuse.
    if (Object.hasOwn(value, 'enqueteSearch')) preferences.enqueteSearch = safeString(value.enqueteSearch, 120);
    return Object.freeze(preferences);
}

export function createPreferenceStore({ storage = undefined, key = 'wfrp-mobile-preferences-v1' } = {}) {
    const target = defaultStorage(storage);
    const read = () => {
        if (!target || typeof target.getItem !== 'function') return DEFAULT_PREFERENCES;
        try { return sanitizePreferences(JSON.parse(target.getItem(key) || 'null')); }
        catch { return DEFAULT_PREFERENCES; }
    };
    const write = value => {
        const preferences = sanitizePreferences(value);
        if (target && typeof target.setItem === 'function') {
            try { target.setItem(key, JSON.stringify(preferences)); }
            catch { /* Navigation privée et quota refusé : les préférences restent en mémoire. */ }
        }
        return preferences;
    };
    return Object.freeze({ read, write, defaults: DEFAULT_PREFERENCES, key });
}

function publicState({ generation, resources, connection, cache, preferences, running, error = null }) {
    return Object.freeze({
        generation,
        resources,
        connection: Object.freeze({ ...connection }),
        cache: Object.freeze({ ...cache }),
        preferences,
        running,
        error,
    });
}

function hasData(resources) {
    return RESOURCE_NAMES.some(name => resources[name].items.length > 0);
}

function allServerConfirmed(resources) {
    return RESOURCE_NAMES.every(name => {
        const resource = resources[name];
        return (resource.status === 'ready' || resource.status === 'empty')
            && resource.metadata.fromCache === false
            && resource.metadata.hasPendingWrites === false
            && resource.lastServerAt !== null;
    });
}

function confirmedAt(resources, fallback) {
    if (!allServerConfirmed(resources)) return fallback;
    return Math.min(...RESOURCE_NAMES.map(name => resources[name].lastServerAt));
}

function aggregateConnection(previous, resources, { browserOnline = previous.browserOnline, forceSync = false } = {}) {
    const server = allServerConfirmed(resources);
    const pending = RESOURCE_NAMES.some(name => resources[name].metadata.hasPendingWrites);
    const cached = RESOURCE_NAMES.some(name => resources[name].metadata.fromCache);
    const error = RESOURCE_NAMES.some(name => resources[name].status === 'error');
    const loading = RESOURCE_NAMES.some(name => resources[name].status === 'loading');
    let phase;
    if (!browserOnline) phase = hasData(resources) ? 'offline-cache' : 'offline-empty';
    else if (forceSync) phase = 'syncing';
    else if (server) phase = 'ready';
    else if (error) phase = 'error';
    else if (pending || cached) phase = 'syncing';
    else phase = loading ? 'loading' : 'syncing';
    return {
        ...previous,
        browserOnline,
        phase,
        sync: server ? 'server' : pending ? 'pending' : cached ? 'cache' : previous.sync,
        lastServerAt: confirmedAt(resources, previous.lastServerAt),
    };
}

function createAbortController() {
    if (typeof globalThis.AbortController === 'function') return new globalThis.AbortController();
    let aborted = false;
    return Object.freeze({
        signal: Object.freeze({ get aborted() { return aborted; } }),
        abort: () => { aborted = true; },
    });
}

function validationError() {
    const error = new Error('public repositories unavailable');
    error.kind = 'validation';
    return error;
}

export function createPublicStore({
    clientFactory,
    repositoryFactories,
    navigatorRef = globalThis.navigator,
    storage = undefined,
    clock = () => Date.now(),
} = {}) {
    if (typeof clientFactory !== 'function'
        || (!repositoryFactories || (typeof repositoryFactories !== 'object'
            && typeof repositoryFactories !== 'function'))) {
        throw new TypeError('clientFactory et repositoryFactories requis');
    }
    const preferenceStore = createPreferenceStore({ storage });
    const listeners = new Set();
    let state = publicState({
        generation: 0,
        resources: initialResources(),
        connection: {
            browserOnline: navigatorRef?.onLine !== false,
            sync: 'unknown',
            phase: 'idle',
            lastServerAt: null,
        },
        cache: { mode: 'unknown', persistent: false, fallback: false, reason: null },
        preferences: preferenceStore.read(),
        running: false,
    });
    let generation = 0;
    let activeRun = null;

    const emit = () => {
        for (const listener of [...listeners]) {
            try { listener(state); }
            catch { /* Un écran défaillant ne bloque pas les autres abonnés. */ }
        }
    };
    const update = updater => { state = updater(state); emit(); };
    const current = run => activeRun === run && generation === run.generation && !run.closed;
    const cleanupRun = async run => {
        if (!run || run.closed) return null;
        run.closed = true;
        run.controller.abort?.();
        for (const unsubscribe of run.unsubs.splice(0)) {
            try { unsubscribe(); }
            catch { /* Le nettoyage continue même si un dépôt tiers se comporte mal. */ }
        }
        run.navigator?.removeEventListener?.('online', run.onlineHandler);
        run.navigator?.removeEventListener?.('offline', run.offlineHandler);
        let closeError = null;
        try { await run.repositories?.images?.close?.(); }
        catch (error) { closeError = error; }
        try { await run.client?.close?.(); }
        catch (error) { closeError ??= error; }
        run.client = null;
        run.repositories = null;
        return closeError;
    };
    const setResource = (run, name, next) => {
        if (!current(run) || !RESOURCE_NAMES.includes(name)) return;
        update(previous => {
            const resources = Object.freeze({ ...previous.resources, [name]: Object.freeze(next) });
            return publicState({
                ...previous,
                resources,
                connection: aggregateConnection(previous.connection, resources),
            });
        });
    };
    const markRelationError = (run, error) => {
        if (!current(run)) return;
        const resource = state.resources.relations;
        setResource(run, 'relations', { ...resource, status: 'error', error: uiError(error) });
    };
    const onData = (run, name) => (items, metadata = {}) => {
        if (!current(run)) return;
        const fromCache = metadata.fromCache === true;
        const hasPendingWrites = metadata.hasPendingWrites === true;
        const normalizedItems = freezeItems(items);
        const resource = state.resources[name];
        const nextResource = {
            ...resource,
            status: normalizedItems.length ? 'ready' : 'empty',
            items: normalizedItems,
            metadata: Object.freeze({ fromCache, hasPendingWrites }),
            lastServerAt: fromCache || hasPendingWrites ? resource.lastServerAt : clock(),
            error: null,
        };
        if (name === 'pnjs') {
            const visibleIds = new Set(normalizedItems.map(item => item.id));
            update(previous => {
                const currentRelations = previous.resources.relations;
                const relationItems = Object.freeze(currentRelations.items
                    .filter(relation => visibleIds.has(relation.source) && visibleIds.has(relation.cible)));
                const relations = relationItems.length === currentRelations.items.length
                    ? currentRelations
                    : Object.freeze({
                        ...currentRelations,
                        items: relationItems,
                        status: currentRelations.status === 'ready' && relationItems.length === 0
                            ? 'empty' : currentRelations.status,
                    });
                const resources = Object.freeze({
                    ...previous.resources,
                    pnjs: Object.freeze(nextResource),
                    relations,
                });
                return publicState({
                    ...previous,
                    resources,
                    connection: aggregateConnection(previous.connection, resources),
                });
            });
            try { run.repositories?.relations?.setVisiblePnjIds?.(normalizedItems.map(item => item.id)); }
            catch (error) { markRelationError(run, error); }
            return;
        }
        setResource(run, name, nextResource);
    };
    const onError = (run, name) => error => {
        if (!current(run)) return;
        const resource = state.resources[name];
        setResource(run, name, { ...resource, status: 'error', error: uiError(error) });
    };
    const subscribeResource = (run, name) => {
        const repository = run.repositories[name];
        const next = onData(run, name);
        const error = onError(run, name);
        if (name === 'pnjs') return repository.subscribeVisible(next, error);
        if (name === 'relations') {
            return repository.subscribeVisible(next, error, {
                visiblePnjIds: state.resources.pnjs.items.map(item => item.id),
            });
        }
        return repository.subscribeDiscovered(next, error);
    };
    const start = async () => {
        if (activeRun && !activeRun.closed) return state;
        const run = {
            generation: ++generation,
            controller: createAbortController(),
            client: null,
            repositories: null,
            unsubs: [],
            navigator: navigatorRef,
            onlineHandler: null,
            offlineHandler: null,
            closed: false,
        };
        activeRun = run;
        const browserOnline = navigatorRef?.onLine !== false;
        update(previous => publicState({
            ...previous,
            generation: run.generation,
            running: true,
            resources: initialResources(),
            connection: {
                ...previous.connection,
                browserOnline,
                phase: browserOnline ? 'loading' : 'offline-empty',
                sync: 'unknown',
            },
            error: null,
        }));
        run.onlineHandler = () => {
            if (!current(run)) return;
            update(previous => publicState({
                ...previous,
                connection: aggregateConnection(previous.connection, previous.resources, {
                    browserOnline: true,
                    forceSync: true,
                }),
            }));
        };
        run.offlineHandler = () => {
            if (!current(run)) return;
            update(previous => publicState({
                ...previous,
                connection: aggregateConnection(previous.connection, previous.resources, {
                    browserOnline: false,
                }),
            }));
        };
        navigatorRef?.addEventListener?.('online', run.onlineHandler);
        navigatorRef?.addEventListener?.('offline', run.offlineHandler);
        try {
            const createdClient = await clientFactory({ signal: run.controller.signal });
            if (!current(run)) {
                try { await createdClient?.close?.(); }
                catch { /* Un client obsolète ne doit jamais ressusciter la session courante. */ }
                return state;
            }
            run.client = createdClient;
            update(previous => publicState({
                ...previous,
                cache: {
                    mode: run.client?.cache?.mode || 'unknown',
                    persistent: run.client?.cache?.persistent === true,
                    fallback: run.client?.cache?.fallback === true,
                    reason: run.client?.cache?.reason || null,
                },
            }));
            const createdRepositories = typeof repositoryFactories === 'function'
                ? await repositoryFactories({ client: run.client, signal: run.controller.signal })
                : repositoryFactories;
            if (!current(run)) {
                run.repositories = createdRepositories;
                await cleanupRun(run);
                return state;
            }
            if (!createdRepositories?.pnjs || !createdRepositories?.relations || !createdRepositories?.indices) {
                throw validationError();
            }
            run.repositories = createdRepositories;
            for (const name of RESOURCE_NAMES) {
                const unsubscribe = subscribeResource(run, name);
                if (typeof unsubscribe === 'function') run.unsubs.push(unsubscribe);
            }
            return state;
        } catch (error) {
            if (!current(run)) {
                await cleanupRun(run);
                return state;
            }
            activeRun = null;
            const closeError = await cleanupRun(run);
            update(previous => {
                const connection = aggregateConnection(previous.connection, previous.resources);
                return publicState({
                    ...previous,
                    running: false,
                    connection: {
                        ...connection,
                        phase: connection.browserOnline ? 'error' : connection.phase,
                    },
                    error: uiError(error || closeError),
                });
            });
            return state;
        }
    };
    const stop = async () => {
        const run = activeRun;
        activeRun = null;
        const stopGeneration = ++generation;
        await cleanupRun(run);
        if (generation !== stopGeneration || activeRun) return state;
        update(previous => publicState({
            ...previous,
            generation: stopGeneration,
            running: false,
            connection: { ...previous.connection, phase: 'idle' },
        }));
        return state;
    };
    const restart = async () => { await stop(); return start(); };
    const subscribe = listener => {
        if (typeof listener !== 'function') return () => {};
        let active = true;
        listeners.add(listener);
        try { listener(state); } catch { /* L'abonné reste isolé. */ }
        return () => {
            if (!active) return;
            active = false;
            listeners.delete(listener);
        };
    };
    const setPreferences = value => {
        const preferences = preferenceStore.write({
            ...state.preferences,
            ...(value && typeof value === 'object' ? value : {}),
            version: 1,
            filters: value?.filters ?? state.preferences.filters,
        });
        update(previous => publicState({ ...previous, preferences }));
        return preferences;
    };
    const inspect = () => Object.freeze({
        generation: state.generation,
        running: state.running,
        cache: state.cache,
        connection: state.connection,
        resources: Object.freeze(Object.fromEntries(RESOURCE_NAMES.map(name => [name, Object.freeze({
            status: state.resources[name].status,
            count: state.resources[name].items.length,
            metadata: state.resources[name].metadata,
            errorKind: state.resources[name].error?.kind ?? null,
        })]))),
    });
    return Object.freeze({
        start,
        stop,
        restart,
        subscribe,
        getState: () => state,
        setPreferences,
        inspect,
        preferenceStore,
        getService: name => activeRun?.repositories?.[name] ?? null,
    });
}

export { DEFAULT_PREFERENCES, RESOURCE_NAMES };

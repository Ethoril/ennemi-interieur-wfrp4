const ROUTE_ID = /^[A-Za-z0-9_-]{1,150}$/u;

const ROUTE_NAMES = Object.freeze({
    PNJS: 'pnjs-list',
    PNJ: 'pnj-detail',
    PNJ_NEW: 'pnj-new',
    PNJ_EDIT: 'pnj-edit',
    ENQUETES: 'enquetes-list',
    ENQUETE: 'enquete-detail',
    REGLAGES: 'reglages',
    UNKNOWN: 'unknown',
});

function decodeSegment(segment) {
    if (!segment || segment.includes('/') || segment.includes('\\')) return null;
    try {
        const decoded = decodeURIComponent(segment);
        return ROUTE_ID.test(decoded) ? decoded : null;
    } catch {
        return null;
    }
}

export function parseRoute(hash = '') {
    const source = String(hash ?? '').replace(/^#/, '');
    if (source === '' || source === '/') return Object.freeze({ name: ROUTE_NAMES.PNJS });
    if (!source.startsWith('/') || source.includes('?')) return Object.freeze({ name: ROUTE_NAMES.UNKNOWN });
    const segments = source.slice(1).split('/');
    if (segments.length > 3 || segments.some(segment => segment === '')) {
        return Object.freeze({ name: ROUTE_NAMES.UNKNOWN });
    }
    const section = segments[0];
    if (section === 'pnjs') {
        if (segments.length === 1) return Object.freeze({ name: ROUTE_NAMES.PNJS });
        if (segments.length === 2 && segments[1] === 'nouveau') return Object.freeze({ name: ROUTE_NAMES.PNJ_NEW });
        const id = decodeSegment(segments[1]);
        if (!id) return Object.freeze({ name: ROUTE_NAMES.UNKNOWN });
        if (segments.length === 2) return Object.freeze({ name: ROUTE_NAMES.PNJ, id });
        return segments[2] === 'modifier'
            ? Object.freeze({ name: ROUTE_NAMES.PNJ_EDIT, id })
            : Object.freeze({ name: ROUTE_NAMES.UNKNOWN });
    }
    if (section === 'enquetes') {
        if (segments.length === 1) return Object.freeze({ name: ROUTE_NAMES.ENQUETES });
        const id = decodeSegment(segments[1]);
        return id ? Object.freeze({ name: ROUTE_NAMES.ENQUETE, id }) : Object.freeze({ name: ROUTE_NAMES.UNKNOWN });
    }
    if (section === 'reglages' && segments.length === 1) return Object.freeze({ name: ROUTE_NAMES.REGLAGES });
    return Object.freeze({ name: ROUTE_NAMES.UNKNOWN });
}

export function routeKey(route) {
    if (!route || typeof route.name !== 'string') return ROUTE_NAMES.UNKNOWN;
    return route.id ? `${route.name}:${route.id}` : route.name;
}

export function routeToHash(route) {
    switch (route?.name) {
        case ROUTE_NAMES.PNJS: return '#/pnjs';
        case ROUTE_NAMES.PNJ: return ROUTE_ID.test(route.id) ? `#/pnjs/${encodeURIComponent(route.id)}` : '#/pnjs';
        case ROUTE_NAMES.PNJ_NEW: return '#/pnjs/nouveau';
        case ROUTE_NAMES.PNJ_EDIT: return ROUTE_ID.test(route.id) ? `#/pnjs/${encodeURIComponent(route.id)}/modifier` : '#/pnjs';
        case ROUTE_NAMES.ENQUETES: return '#/enquetes';
        case ROUTE_NAMES.ENQUETE: return ROUTE_ID.test(route.id) ? `#/enquetes/${encodeURIComponent(route.id)}` : '#/enquetes';
        case ROUTE_NAMES.REGLAGES: return '#/reglages';
        default: return '#/pnjs';
    }
}

function safeScrollValue(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function createAbortController(windowRef) {
    const Constructor = windowRef?.AbortController || globalThis.AbortController;
    if (typeof Constructor === 'function') return new Constructor();
    let aborted = false;
    const listeners = new Set();
    const signal = {
        get aborted() { return aborted; },
        addEventListener: (_name, listener) => { if (typeof listener === 'function') listeners.add(listener); },
        removeEventListener: (_name, listener) => { listeners.delete(listener); },
    };
    return { signal, abort: () => { if (aborted) return; aborted = true; listeners.forEach(listener => listener()); } };
}

export function createRouter({ windowRef = globalThis, mountRoute, onRoute, announce = () => {}, getScrollY, setScrollY } = {}) {
    if (typeof mountRoute !== 'function') throw new TypeError('mountRoute requis');
    const scrollPositions = new Map();
    let currentRoute = null;
    let currentView = null;
    let currentController = null;
    let started = false;
    let renderToken = 0;
    const unmountedViews = new WeakSet();

    const unmountView = view => {
        if (!view || unmountedViews.has(view)) return;
        unmountedViews.add(view);
        view.unmount?.();
    };

    const readScroll = () => typeof getScrollY === 'function' ? getScrollY() : safeScrollValue(windowRef.scrollY);
    const writeScroll = value => {
        if (typeof setScrollY === 'function') setScrollY(value);
        else if (typeof windowRef.scrollTo === 'function') windowRef.scrollTo(0, value);
    };

    const restoreCurrentLocation = () => {
        const hash = currentRoute ? routeToHash(currentRoute) : '#/pnjs';
        windowRef.history?.replaceState?.({}, '', hash);
        return currentRoute;
    };
    const canLeave = skipGuard => skipGuard || !currentView?.beforeLeave || currentView.beforeLeave() !== false;
    const render = (hash = windowRef.location?.hash ?? '', { force = false, skipGuard = false } = {}) => {
        const nextRoute = parseRoute(hash);
        const nextKey = routeKey(nextRoute);
        if (!force && currentRoute && routeKey(currentRoute) === nextKey) return currentRoute;
        if (!canLeave(skipGuard)) return restoreCurrentLocation();
        const token = ++renderToken;
        if (currentRoute) scrollPositions.set(routeKey(currentRoute), safeScrollValue(readScroll()));
        currentController?.abort?.();
        unmountView(currentView);
        currentRoute = nextRoute;
        currentView = mountRoute(nextRoute) || null;
        if (currentView) unmountedViews.delete(currentView);
        currentController = createAbortController(windowRef);
        const view = currentView;
        const mounted = view?.mount?.({ signal: currentController.signal });
        if (mounted && typeof mounted.then === 'function') {
            mounted.then(() => {
                if (token !== renderToken) unmountView(view);
            }, () => {
                if (token !== renderToken) unmountView(view);
            });
        }
        const saved = scrollPositions.get(nextKey);
        if (saved !== undefined && [ROUTE_NAMES.PNJS, ROUTE_NAMES.ENQUETES].includes(nextRoute.name)) writeScroll(saved);
        onRoute?.(nextRoute);
        announce(nextRoute.name === ROUTE_NAMES.UNKNOWN ? 'Écran introuvable.' : 'Écran chargé.');
        return nextRoute;
    };

    const onLocationChange = () => render(windowRef.location?.hash ?? '');
    const start = () => {
        if (started) return stop;
        started = true;
        windowRef.addEventListener?.('hashchange', onLocationChange);
        windowRef.addEventListener?.('popstate', onLocationChange);
        render(undefined, { skipGuard: true });
        return stop;
    };
    const stop = () => {
        if (!started) return;
        started = false;
        windowRef.removeEventListener?.('hashchange', onLocationChange);
        windowRef.removeEventListener?.('popstate', onLocationChange);
        currentController?.abort?.();
        unmountView(currentView);
        currentView = null;
        currentController = null;
        currentRoute = null;
        renderToken += 1;
    };
    const navigate = (route, { replace = false, skipGuard = false } = {}) => {
        const hash = routeToHash(route);
        const currentHash = windowRef.location?.hash ?? '';
        if (!canLeave(skipGuard)) return currentRoute;
        if (hash === currentHash) return render(hash, { skipGuard: true });
        if (replace) windowRef.history?.replaceState?.({}, '', hash);
        else windowRef.history?.pushState?.({}, '', hash);
        return render(hash, { skipGuard: true });
    };
    const back = ({ skipGuard = false } = {}) => {
        if (currentRoute?.name === ROUTE_NAMES.PNJ_NEW) {
            return navigate({ name: ROUTE_NAMES.PNJS }, { replace: true, skipGuard });
        }
        if (currentRoute?.name === ROUTE_NAMES.PNJ_EDIT) {
            return navigate({ name: ROUTE_NAMES.PNJ, id: currentRoute.id }, { replace: true, skipGuard });
        }
        if (currentRoute?.name === ROUTE_NAMES.PNJ || currentRoute?.name === ROUTE_NAMES.ENQUETE) {
            return navigate({ name: currentRoute.name === ROUTE_NAMES.PNJ ? ROUTE_NAMES.PNJS : ROUTE_NAMES.ENQUETES }, { replace: true, skipGuard });
        }
        return navigate({ name: ROUTE_NAMES.PNJS }, { replace: true, skipGuard });
    };

    return Object.freeze({ start, stop, navigate, back, render, refresh: ({ skipGuard = true } = {}) => render(windowRef.location?.hash ?? '', { force: true, skipGuard }), getRoute: () => currentRoute, getScrollPositions: () => new Map(scrollPositions) });
}

export { ROUTE_NAMES };

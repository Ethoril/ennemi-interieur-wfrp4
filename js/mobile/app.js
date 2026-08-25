import { createAppLifecycle } from './lifecycle.js';
import { createRouter, ROUTE_NAMES } from './router.js';
import { createDefaultPublicSession } from './public-runtime.js';
import { announce, createDialogController, publicStatusKind, publicStatusMessage, renderState } from './ui.js';
import { createPnjsListView } from './views/pnjs-list.js';
import { createPnjDetailView } from './views/pnj-detail.js';

function placeholderView({ container, title, message, actionLabel = '', onAction = null }) {
    let mounted = false;
    return Object.freeze({
        mount({ signal } = {}) {
            if (mounted || signal?.aborted) return;
            mounted = true;
            container.replaceChildren();
            const screen = container.ownerDocument.createElement('section');
            screen.className = 'm-screen';
            const heading = container.ownerDocument.createElement('h2');
            heading.textContent = title;
            if (signal?.aborted) return;
            screen.append(heading);
            renderState(screen, { state: 'empty', title: 'Bientôt disponible', message, actionLabel, onAction });
            container.append(screen);
        },
        unmount() { container.replaceChildren(); mounted = false; },
    });
}

function sectionForRoute(route) {
    if (route?.name?.startsWith('enquete')) return 'enquetes';
    if (route?.name === ROUTE_NAMES.REGLAGES) return 'reglages';
    return 'pnjs';
}

function sectionHash(section) {
    if (section === 'enquetes') return '#/enquetes';
    if (section === 'reglages') return '#/reglages';
    return '#/pnjs';
}

function applyTheme(documentRef, theme, toggle) {
    const normalized = theme === 'parchment' ? 'parchment' : 'dark';
    documentRef.documentElement.dataset.theme = normalized;
    if (toggle) {
        toggle.textContent = normalized === 'parchment'
            ? 'Passer au thème sombre' : 'Passer au thème parchemin';
    }
    return normalized;
}

function cacheMessage(state) {
    if (state?.cache?.persistent) return 'Les données publiques peuvent être relues hors connexion sur cet appareil.';
    if (state?.cache?.fallback) return 'Le cache durable est indisponible : gardez une connexion pour actualiser les données.';
    return 'Le mode de cache sera indiqué après le premier chargement.';
}

function boot(documentRef = globalThis.document, windowRef = globalThis.window) {
    const container = documentRef?.querySelector?.('#m-main');
    const status = documentRef?.querySelector?.('#m-status');
    const routeStatus = documentRef?.querySelector?.('#m-route-status');
    const title = documentRef?.querySelector?.('#m-title');
    const back = documentRef?.querySelector?.('#m-back');
    const headerAction = documentRef?.querySelector?.('#m-header-action');
    const dialogElement = documentRef?.querySelector?.('#m-dialog');
    const dialogClose = documentRef?.querySelector?.('#m-dialog-close');
    const dialogOk = documentRef?.querySelector?.('#m-dialog-ok');
    const themeToggle = documentRef?.querySelector?.('#m-theme-toggle');
    const cacheNote = documentRef?.querySelector?.('#m-cache-note');
    if (!container || !windowRef || !title || !back || !headerAction || !dialogElement) return null;

    const session = createDefaultPublicSession({ navigatorRef: windowRef.navigator });
    const store = session.store;
    const initialPreferences = session.getState().preferences;
    applyTheme(documentRef, initialPreferences.theme, themeToggle);
    if (!windowRef.location?.hash) {
        windowRef.history?.replaceState?.({}, '', sectionHash(initialPreferences.lastSection));
    }

    const dialog = createDialogController({ dialog: dialogElement, documentRef });
    let router;
    const retry = () => session.restart();
    const views = {
        [ROUTE_NAMES.PNJS]: () => createPnjsListView({ container, store, onRetry: retry }),
        [ROUTE_NAMES.PNJ]: route => createPnjDetailView({
            container,
            id: route.id,
            store,
            onBack: () => router.back(),
            onRetry: retry,
        }),
        [ROUTE_NAMES.ENQUETES]: () => placeholderView({
            container,
            title: 'Enquêtes',
            message: 'La liste des enquêtes arrivera dans un prochain lot.',
        }),
        [ROUTE_NAMES.ENQUETE]: () => placeholderView({
            container,
            title: 'Enquête',
            message: 'La fiche d’enquête arrivera dans un prochain lot.',
        }),
        [ROUTE_NAMES.REGLAGES]: () => placeholderView({
            container,
            title: 'Réglages',
            message: 'Le thème et l’état du cache public sont disponibles ici.',
            actionLabel: 'Ouvrir les réglages',
            onAction: () => dialog.show(headerAction),
        }),
        [ROUTE_NAMES.UNKNOWN]: () => placeholderView({
            container,
            title: 'Écran introuvable',
            message: 'Cette adresse ne correspond pas à un écran mobile.',
            actionLabel: 'Retour',
            onAction: () => router.back(),
        }),
    };
    router = createRouter({
        windowRef,
        mountRoute: route => (views[route.name] || views[ROUTE_NAMES.UNKNOWN])(route),
        announce: message => announce(routeStatus, message),
        setScrollY: value => { container.scrollTop = value; },
        getScrollY: () => container.scrollTop,
        onRoute: route => {
            const section = sectionForRoute(route);
            title.textContent = section === 'pnjs' ? 'PNJs' : section === 'enquetes' ? 'Enquêtes' : 'Réglages';
            title.focus?.({ preventScroll: true });
            back.hidden = !(route.name === ROUTE_NAMES.PNJ
                || route.name === ROUTE_NAMES.ENQUETE || route.name === ROUTE_NAMES.UNKNOWN);
            headerAction.hidden = route.name !== ROUTE_NAMES.REGLAGES;
            documentRef.querySelectorAll('.m-bottom-nav a[data-route]').forEach(link => {
                if (link.dataset.route === section) link.setAttribute('aria-current', 'page');
                else link.removeAttribute('aria-current');
            });
            if (route.name !== ROUTE_NAMES.UNKNOWN
                && store.getState().preferences.lastSection !== section) {
                session.setPreferences({ lastSection: section });
            }
        },
    });

    const onBack = () => router.back();
    const onHeaderAction = event => dialog.show(event.currentTarget);
    const onDialogClose = () => dialog.close();
    const onDialogCancel = event => { event.preventDefault(); dialog.close(); };
    const onThemeToggle = () => {
        const current = store.getState().preferences.theme;
        const nextTheme = current === 'parchment' ? 'dark' : 'parchment';
        session.setPreferences({ theme: nextTheme });
        announce(routeStatus, nextTheme === 'parchment'
            ? 'Thème parchemin activé.' : 'Thème sombre activé.');
    };
    back.addEventListener('click', onBack);
    dialogClose?.addEventListener('click', onDialogClose);
    dialogOk?.addEventListener('click', onDialogClose);
    dialogElement.addEventListener('cancel', onDialogCancel);
    headerAction.addEventListener('click', onHeaderAction);
    themeToggle?.addEventListener('click', onThemeToggle);

    const stopRouter = router.start();
    const unsubscribeSession = session.subscribe(state => {
        announce(status, publicStatusMessage(state));
        if (status) status.dataset.kind = publicStatusKind(state);
        applyTheme(documentRef, state.preferences.theme, themeToggle);
        if (cacheNote) cacheNote.textContent = cacheMessage(state);
    });
    session.start();
    let stopPromise = null;
    const stop = () => {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => {
            stopRouter();
            unsubscribeSession();
            dialog.close();
            back.removeEventListener('click', onBack);
            dialogClose?.removeEventListener('click', onDialogClose);
            dialogOk?.removeEventListener('click', onDialogClose);
            dialogElement.removeEventListener('cancel', onDialogCancel);
            headerAction.removeEventListener('click', onHeaderAction);
            themeToggle?.removeEventListener('click', onThemeToggle);
            await session.stop();
        })();
        return stopPromise;
    };
    return Object.freeze({ router, session, stop });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    createAppLifecycle({ windowRef: window, startApp: () => boot(document, window) });
}

export { boot };

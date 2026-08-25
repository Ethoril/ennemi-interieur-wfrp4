import { createAppLifecycle } from './lifecycle.js';
import { createRouter, ROUTE_NAMES } from './router.js';
import { createDefaultPublicSession } from './public-runtime.js';
import { createDefaultMjSession } from './mj-runtime.js';
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

function createSettingsView({ container, publicSession, mjSession, documentRef }) {
    let unsubscribePublic = null;
    let unsubscribeMj = null;
    let mounted = false;
    const render = () => {
        if (!mounted) return;
        container.replaceChildren();
        const section = documentRef.createElement('section');
        section.className = 'm-screen m-settings';
        const heading = documentRef.createElement('h2');
        heading.textContent = 'Réglages';
        section.append(heading);
        const authStatus = documentRef.createElement('p');
        authStatus.setAttribute('role', 'status');
        const state = mjSession.getState();
        const account = state.user?.displayName || 'compte Google';
        authStatus.textContent = state.error?.kind === 'redirect-unavailable'
            ? 'Le retour Google n’a pas été récupéré. Réessayez avec une fenêtre au premier plan.'
            : state.status === 'gm' ? `Mode MJ actif — ${account}`
            : state.status === 'authenticated-non-gm' ? 'Compte connecté, sans accès MJ.'
                : state.status === 'checking' || state.status === 'signing-in' ? 'Vérification de la session…'
                    : state.status === 'signing-out' ? 'Déconnexion en cours…' : 'Mode joueur — aucune session MJ.';
        section.append(authStatus);
        if (state.error) {
            const error = documentRef.createElement('p');
            error.className = 'm-settings-error';
            error.textContent = state.error.kind === 'offline'
                ? 'Connexion indisponible. Réessayez lorsque le réseau sera revenu.'
                : 'La connexion MJ n’a pas abouti. Vous pouvez réessayer.';
            section.append(error);
        }
        const action = documentRef.createElement('button');
        action.type = 'button';
        action.className = 'm-button m-button-primary';
        const busy = ['checking', 'signing-in', 'signing-out'].includes(state.status);
        action.disabled = busy;
        action.setAttribute('aria-disabled', String(busy));
        action.textContent = state.status === 'gm' || state.status === 'authenticated-non-gm'
            ? 'Déconnexion' : state.error?.kind === 'redirect-unavailable'
                ? 'Réessayer avec une fenêtre' : 'Connexion Google';
        action.addEventListener('click', () => {
            if (busy) return;
            return state.status === 'gm' || state.status === 'authenticated-non-gm'
                ? mjSession.signOut() : mjSession.signIn();
        });
        section.append(action);
        const cache = documentRef.createElement('p');
        cache.textContent = cacheMessage(publicSession.getState());
        section.append(cache);
        const version = documentRef.createElement('p');
        const versionMeta = documentRef.querySelector?.('meta[name="app-version"]');
        version.textContent = `Version ${versionMeta?.content || 'inconnue'}`;
        section.append(version);
        container.append(section);
    };
    return Object.freeze({
        mount() {
            if (mounted) return;
            mounted = true;
            unsubscribePublic = publicSession.subscribe(render);
            unsubscribeMj = mjSession.subscribe(render);
            render();
        },
        unmount() {
            mounted = false;
            unsubscribePublic?.();
            unsubscribeMj?.();
            unsubscribePublic = null;
            unsubscribeMj = null;
            container.replaceChildren();
        },
    });
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
    let router;
    let pendingInitialRoute = null;
    const mjSession = createDefaultMjSession({
        windowRef,
        onNavigate: target => {
            if (!router) { pendingInitialRoute = target; return; }
            windowRef.history?.replaceState?.({}, '', target);
            router.render(target);
        },
    });
    const store = session.store;
    const initialPreferences = session.getState().preferences;
    applyTheme(documentRef, initialPreferences.theme, themeToggle);
    if (!windowRef.location?.hash) {
        windowRef.history?.replaceState?.({}, '', sectionHash(initialPreferences.lastSection));
    }

    const dialog = createDialogController({ dialog: dialogElement, documentRef });
    const retry = () => session.restart();
    const views = {
        [ROUTE_NAMES.PNJS]: () => createPnjsListView({
            container,
            store,
            getImageService: () => session.getImages(),
            onRetry: retry,
        }),
        [ROUTE_NAMES.PNJ]: route => createPnjDetailView({
            container,
            id: route.id,
            store,
            getImageService: () => session.getImages(),
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
            container, title: 'Réglages', message: 'Chargement des réglages…',
        }),
        [ROUTE_NAMES.PNJ_EDIT]: route => {
            const status = mjSession.getState();
            if (status.status === 'checking' || status.status === 'signing-in' || status.status === 'signing-out') {
                return placeholderView({ container, title: 'Vérification', message: 'Vérification de la session MJ…' });
            }
            if (status.status !== 'gm') {
                return placeholderView({ container, title: 'Accès MJ requis', message: 'Cette action est réservée au MJ.', actionLabel: 'Retour', onAction: () => router.back() });
            }
            return placeholderView({ container, title: 'Modification du PNJ', message: `Le formulaire du PNJ ${route.id} arrivera dans le prochain lot.` });
        },
        [ROUTE_NAMES.UNKNOWN]: () => placeholderView({
            container,
            title: 'Écran introuvable',
            message: 'Cette adresse ne correspond pas à un écran mobile.',
            actionLabel: 'Retour',
            onAction: () => router.back(),
        }),
    };
    views[ROUTE_NAMES.REGLAGES] = () => createSettingsView({ container, publicSession: session, mjSession, documentRef });
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
            back.hidden = !(route.name === ROUTE_NAMES.PNJ || route.name === ROUTE_NAMES.PNJ_EDIT
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
    if (pendingInitialRoute) {
        const target = pendingInitialRoute;
        pendingInitialRoute = null;
        windowRef.history?.replaceState?.({}, '', target);
        router.render(target);
    }

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
    mjSession.start();
    const unsubscribeMj = mjSession.subscribe(() => {
        const route = router.getRoute();
        if (route?.name !== ROUTE_NAMES.PNJ_EDIT) return;
        const next = mjSession.getState();
        if (['checking', 'signing-in', 'signing-out'].includes(next.status) || next.status === 'gm') {
            router.refresh();
        } else {
            router.navigate({ name: ROUTE_NAMES.PNJ, id: route.id }, { replace: true });
            announce(routeStatus, 'Accès MJ indisponible : la fiche publique est affichée.');
        }
    });
    let stopPromise = null;
    const stop = () => {
        if (stopPromise) return stopPromise;
        stopPromise = (async () => {
            stopRouter();
            unsubscribeSession();
            unsubscribeMj();
            dialog.close();
            back.removeEventListener('click', onBack);
            dialogClose?.removeEventListener('click', onDialogClose);
            dialogOk?.removeEventListener('click', onDialogClose);
            dialogElement.removeEventListener('cancel', onDialogCancel);
            headerAction.removeEventListener('click', onHeaderAction);
            themeToggle?.removeEventListener('click', onThemeToggle);
            await session.stop();
            await mjSession.stop();
        })();
        return stopPromise;
    };
    return Object.freeze({ router, session, mjSession, stop });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    createAppLifecycle({ windowRef: window, startApp: () => boot(document, window) });
}

export { boot };

import { createRouter, ROUTE_NAMES } from './router.js';
import { createMobileSession } from './session.js';
import { announce, createDialogController, renderState } from './ui.js';
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

function boot(documentRef = globalThis.document, windowRef = globalThis.window) {
    const container = documentRef.querySelector('#m-main');
    const status = documentRef.querySelector('#m-status');
    const title = documentRef.querySelector('#m-title');
    const back = documentRef.querySelector('#m-back');
    const headerAction = documentRef.querySelector('#m-header-action');
    if (!container || !windowRef) return null;
    const session = createMobileSession();
    const views = {
        [ROUTE_NAMES.PNJS]: route => createPnjsListView({ container, route }),
        [ROUTE_NAMES.PNJ]: route => createPnjDetailView({ container, id: route.id, onBack: () => router.back() }),
        [ROUTE_NAMES.ENQUETES]: () => placeholderView({ container, title: 'Enquêtes', message: 'La liste des enquêtes arrivera dans un prochain lot.' }),
        [ROUTE_NAMES.ENQUETE]: () => placeholderView({ container, title: 'Enquête', message: 'La fiche d’enquête arrivera dans un prochain lot.' }),
        [ROUTE_NAMES.REGLAGES]: () => placeholderView({ container, title: 'Réglages', message: 'Les préférences seront disponibles dans un prochain lot.', actionLabel: 'Ouvrir le dialogue', onAction: () => dialog.show(headerAction) }),
        [ROUTE_NAMES.UNKNOWN]: () => placeholderView({ container, title: 'Écran introuvable', message: 'Cette adresse ne correspond pas à un écran mobile.', actionLabel: 'Retour', onAction: () => router.back() }),
    };
    const router = createRouter({
        windowRef,
        mountRoute: route => (views[route.name] || views[ROUTE_NAMES.UNKNOWN])(route),
        announce: message => announce(status, message),
        setScrollY: value => { container.scrollTop = value; },
        getScrollY: () => container.scrollTop,
        onRoute: route => {
            title.textContent = route.name.startsWith('pnj') ? 'PNJs' : route.name.startsWith('enquete') ? 'Enquêtes' : route.name === ROUTE_NAMES.REGLAGES ? 'Réglages' : 'PNJs';
            title.focus?.({ preventScroll: true });
            back.hidden = !(route.name === ROUTE_NAMES.PNJ || route.name === ROUTE_NAMES.ENQUETE || route.name === ROUTE_NAMES.UNKNOWN);
            headerAction.hidden = route.name !== ROUTE_NAMES.REGLAGES;
            documentRef.querySelectorAll('.m-bottom-nav a[data-route]').forEach(link => {
                const active = link.dataset.route === (route.name.startsWith('pnj') ? 'pnjs' : route.name.startsWith('enquete') ? 'enquetes' : route.name === ROUTE_NAMES.REGLAGES ? 'reglages' : '');
                if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
            });
        },
    });
    const dialog = createDialogController({ dialog: documentRef.querySelector('#m-dialog'), documentRef });
    const dialogClose = documentRef.querySelector('#m-dialog-close');
    const dialogOk = documentRef.querySelector('#m-dialog-ok');
    const themeToggle = documentRef.querySelector('#m-theme-toggle');
    const onBack = () => router.back();
    const onHeaderAction = event => dialog.show(event.currentTarget);
    const onDialogClose = () => dialog.close();
    const onDialogCancel = event => { event.preventDefault(); dialog.close(); };
    const onThemeToggle = () => {
        const parchment = documentRef.documentElement.dataset.theme === 'parchment';
        const nextTheme = parchment ? 'dark' : 'parchment';
        documentRef.documentElement.dataset.theme = nextTheme;
        themeToggle.textContent = nextTheme === 'parchment' ? 'Passer au thème sombre' : 'Passer au thème parchemin';
        announce(status, nextTheme === 'parchment' ? 'Thème parchemin activé.' : 'Thème sombre activé.');
    };
    back.addEventListener('click', onBack);
    dialogClose?.addEventListener('click', onDialogClose);
    dialogOk?.addEventListener('click', onDialogClose);
    documentRef.querySelector('#m-dialog')?.addEventListener('cancel', onDialogCancel);
    headerAction?.addEventListener('click', onHeaderAction);
    themeToggle?.addEventListener('click', onThemeToggle);
    const stopRouter = router.start();
    return Object.freeze({ router, session, stop: () => {
        stopRouter();
        session.stop();
        dialog.close();
        back.removeEventListener('click', onBack);
        dialogClose?.removeEventListener('click', onDialogClose);
        dialogOk?.removeEventListener('click', onDialogClose);
        documentRef.querySelector('#m-dialog')?.removeEventListener('cancel', onDialogCancel);
        headerAction?.removeEventListener('click', onHeaderAction);
        themeToggle?.removeEventListener('click', onThemeToggle);
    } });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') boot();

export { boot };

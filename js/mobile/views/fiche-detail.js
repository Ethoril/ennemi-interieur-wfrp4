import { createFicheController } from '../../fiche-controller.js';
import { createFicheDraftStore } from '../../fiche-draft-store.js';
import { xpBalance } from '../../fiche/derived.js';
import { ficheIdentity } from '../fiche-model.js';
import { createPrincipalPanel } from './fiche-principal.js';
import { createPurchaseSheet } from './fiche-purchase-sheet.js';
import { parseRoute, routeToHash, ROUTE_NAMES } from '../router.js';
import { createDialogController, renderState } from '../ui.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TABS = Object.freeze([
    { key: 'principal', label: 'Principal', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z' },
    { key: 'aptitudes', label: 'Aptitudes', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
    { key: 'carriere', label: 'Carrière', icon: 'M3 20h5v-5h5v-5h5V5h3' },
    { key: 'journal', label: 'Journal', icon: 'M5 5a2 2 0 0 1 2-2h12v16H7a2 2 0 0 0-2 2zM5 21V5' },
]);
const READY_PHASES = new Set(['ready', 'saving', 'awaiting-snapshot', 'command-pending', 'legacy-readonly']);

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function makeIcon(documentRef, path) {
    const create = tag => (documentRef.createElementNS ? documentRef.createElementNS(SVG_NS, tag) : documentRef.createElement(tag));
    const svg = create('svg');
    for (const [name, value] of Object.entries({
        class: 'm-fiche-tab-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
    })) svg.setAttribute(name, value);
    const shape = create('path');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
}

function safeStorage(windowRef) {
    try { return windowRef?.localStorage || null; } catch { return null; }
}

/**
 * Fiche de personnage mobile : coque (identité, onglets, menu ⋯) et données (contrôleur fiche).
 * Les panneaux d'onglet sont des emplacements ; les briefs suivants les remplissent.
 */
export function createFicheDetailView({
    container, documentRef = container?.ownerDocument, windowRef = globalThis.window, route,
    getClient, signIn, loadRuntime, loadCatalogue, setTitle = () => {}, announce = () => {}, navigate = () => {},
} = {}) {
    if (!container || !documentRef || !route?.id || typeof getClient !== 'function'
        || typeof loadRuntime !== 'function' || typeof loadCatalogue !== 'function') {
        throw new TypeError('container, document, route fiche, client et chargeurs requis');
    }
    const charId = route.id;
    let tab = route.tab || 'principal';
    let mounted = false;
    let abortSignal = null;
    let generation = 0;
    let stopWatch = null;
    let backend = null;
    let controller = null;
    let catalogue = null;
    let stopCatalogue = null;
    let stopEngine = null;
    let role = null;
    let sessionKey = '';
    let accessGeneration = 0;
    let screen = { name: 'loading' };
    let controllerState = null;
    let online = windowRef?.navigator?.onLine !== false;
    let shownKey = '';
    let shell = null;

    // Le menu vit hors du rendu des écrans : un état qui change ne doit pas fermer le menu ouvert.
    const menuDialog = make(documentRef, 'dialog', '', 'm-dialog m-fiche-menu');
    menuDialog.setAttribute('aria-labelledby', 'm-fiche-menu-title');
    const menu = createDialogController({ dialog: menuDialog, documentRef });
    const importButton = make(documentRef, 'button', 'Importer une fiche', 'm-button');
    const buildMenu = () => {
        const card = make(documentRef, 'div', '', 'm-dialog-card');
        const heading = make(documentRef, 'div', '', 'm-dialog-heading');
        const title = make(documentRef, 'h2', 'Menu de la fiche');
        title.id = 'm-fiche-menu-title';
        const close = make(documentRef, 'button', '×', 'm-icon-button');
        close.type = 'button';
        close.setAttribute('aria-label', 'Fermer');
        close.addEventListener('click', () => menu.close());
        heading.append(title, close);
        const exportButton = make(documentRef, 'button', 'Exporter la fiche', 'm-button');
        const note = make(documentRef, 'p', 'L’export et l’import arrivent bientôt.', 'm-fiche-menu-note');
        for (const button of [exportButton, importButton]) {
            button.type = 'button';
            button.disabled = true;
        }
        importButton.hidden = true;
        const legacy = make(documentRef, 'a', 'Ancienne fiche', 'm-button');
        legacy.href = `../fiche.html?char=${encodeURIComponent(charId)}&return=mobile`;
        card.append(heading, exportButton, importButton, note, legacy);
        menuDialog.append(card);
        menuDialog.addEventListener('cancel', event => { event.preventDefault(); menu.close(); });
        // Un clic sur le fond (le <dialog> lui-même) ferme, comme les autres feuilles de l'application.
        menuDialog.addEventListener('click', event => { if (event.target === menuDialog) menu.close(); });
    };
    buildMenu();

    const purchase = createPurchaseSheet({
        documentRef, announce,
        getContext: () => ({
            state: controllerState, careers: catalogue?.careers, engine: catalogue?.getEngine(), online, controller,
        }),
    });

    const tabHref = key => routeToHash({ name: ROUTE_NAMES.FICHE, id: charId, tab: key });
    const tabLabel = key => TABS.find(item => item.key === key)?.label || '';
    const identity = () => ficheIdentity(controllerState?.data, catalogue?.careers);

    // Remplace l'écran seulement quand sa nature change ; les mises à jour de données se font sur place.
    const present = (key, build) => {
        if (key !== shownKey) {
            menu.close();
            purchase.close();
            shownKey = key;
            shell = null;
            build();
            container.append(menuDialog, purchase.element);
        }
    };
    const showState = (key, options) => present(`state:${key}`, () => renderState(container, options));

    const updateShell = () => {
        if (!shell) return;
        const { carriere, titreRang, rang, nom } = identity();
        const line = [carriere, titreRang, `Rang ${rang}`].filter(Boolean).join(' · ');
        shell.identity.textContent = line;
        const libre = xpBalance(controllerState?.data).libre;
        shell.xpValue.textContent = String(libre);
        shell.xp.setAttribute('aria-label', `${libre} XP libres, ouvrir le journal`);
        setTitle(nom || 'Fiche');
        const legacy = controllerState?.phase === 'legacy-readonly';
        shell.notice.textContent = legacy ? 'Fiche à migrer par le MJ depuis le bureau : lecture seule.'
            : online ? '' : 'Hors connexion.';
        shell.notice.hidden = !shell.notice.textContent;
        updatePrincipal();
        purchase.update();
    };

    const updatePrincipal = () => {
        if (!shell || !controllerState?.data) return;
        shell.principal.update({ data: controllerState.data, careers: catalogue?.careers, engine: catalogue?.getEngine() });
    };

    const updatePanel = () => {
        if (!shell) return;
        shell.panelTitle.textContent = tabLabel(tab);
        shell.panelTitle.className = tab === 'principal' ? 'visually-hidden' : '';
        shell.principal.element.hidden = tab !== 'principal';
        shell.soon.hidden = tab === 'principal';
        for (const [key, link] of shell.links) {
            if (key === tab) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
    };

    const buildShell = () => {
        container.replaceChildren();
        const root = make(documentRef, 'div', '', 'm-fiche');
        const strip = make(documentRef, 'div', '', 'm-fiche-identity');
        const identityLine = make(documentRef, 'p', '', 'm-fiche-identity-line');
        const xp = make(documentRef, 'a', '', 'm-fiche-xp');
        xp.href = tabHref('journal');
        const xpValue = make(documentRef, 'strong');
        xp.append(xpValue, make(documentRef, 'span', 'XP libres'));
        strip.append(identityLine, xp);
        const notice = make(documentRef, 'p', '', 'm-fiche-notice');
        notice.setAttribute('role', 'status');
        notice.hidden = true;
        const panel = make(documentRef, 'section', '', 'm-fiche-panel');
        const panelTitle = make(documentRef, 'h2');
        const soon = make(documentRef, 'p', 'Bientôt disponible.', 'm-fiche-soon');
        const principal = createPrincipalPanel({
            documentRef, aptitudesHref: tabHref('aptitudes'),
            onOpenCarac: (key, trigger) => purchase.open({ kind: 'carac', key }, trigger),
        });
        panel.append(panelTitle, principal.element, soon);
        const nav = make(documentRef, 'nav', '', 'm-fiche-tabs');
        nav.setAttribute('aria-label', 'Sections de la fiche');
        const links = new Map();
        for (const item of TABS) {
            const link = make(documentRef, 'a', '', 'm-fiche-tab');
            link.href = tabHref(item.key);
            link.append(makeIcon(documentRef, item.icon), make(documentRef, 'span', item.label));
            links.set(item.key, link);
            nav.append(link);
        }
        root.append(strip, notice, panel, nav);
        container.append(root);
        shell = { identity: identityLine, xp, xpValue, notice, panelTitle, principal, soon, links };
        updateShell();
        updatePanel();
    };

    const render = () => {
        if (!mounted) return;
        if (screen.name === 'loading') {
            showState('loading', { state: 'loading', title: 'Chargement de la fiche', message: 'Un instant…' });
        } else if (screen.name === 'signin') {
            showState('signin', {
                state: 'empty', title: 'Connexion requise',
                message: 'Connectez-vous avec le compte Google qui a accès à votre fiche.',
                actionLabel: 'Connexion Google',
                onAction: async () => {
                    try { await signIn?.(); } catch { announce('Connexion impossible. Réessayez.'); }
                },
            });
        } else if (screen.name === 'unavailable') {
            showState('unavailable', {
                state: 'empty', title: 'Fiche indisponible',
                message: 'Cette fiche n’est pas accessible avec ce compte.',
                actionLabel: 'Mes fiches', onAction: () => navigate({ name: ROUTE_NAMES.FICHES }),
            });
        } else if (screen.name === 'failed') {
            showState('failed', {
                state: 'error', title: 'Fiche injoignable',
                message: 'Impossible de charger la fiche. Vérifiez la connexion puis réessayez.',
                actionLabel: 'Réessayer', onAction: () => { void connect(); },
            });
        } else renderSession();
    };

    const renderSession = () => {
        const phase = controllerState?.phase;
        if (READY_PHASES.has(phase)) {
            present('ready', buildShell);
            updateShell();
        } else if (phase === 'error' && controllerState.error === 'permission-denied') {
            screen = { name: 'unavailable' };
            render();
        } else if (phase === 'error') {
            showState('read-failed', {
                state: 'error', title: 'Fiche injoignable',
                message: 'Impossible de lire la fiche. Réessayez dans un instant.',
                actionLabel: 'Réessayer', onAction: () => { sessionKey = ''; void connect(); },
            });
        } else if (phase === 'missing' || phase === 'tombstone') {
            showState('missing', {
                state: 'empty', title: 'Fiche non initialisée',
                message: 'Cette fiche n’a pas encore de contenu. Le MJ doit l’importer depuis le bureau.',
                actionLabel: 'Mes fiches', onAction: () => navigate({ name: ROUTE_NAMES.FICHES }),
            });
        } else {
            showState('loading', { state: 'loading', title: 'Chargement de la fiche', message: 'Un instant…' });
        }
    };

    // Chargeurs et contrôleur : une fois par montage, réessayables après un échec.
    const ensureBackend = () => {
        backend ??= Promise.all([loadRuntime(), loadCatalogue()]).then(([runtime, service]) => {
            if (!mounted) return;
            catalogue = service;
            controller = createFicheController({
                repository: runtime.repository,
                draftStore: createFicheDraftStore({ storage: safeStorage(windowRef) }),
                isOnline: () => online,
                onChange: next => { controllerState = next; render(); },
            });
            stopCatalogue = service.watch(runtime.repository);
            stopEngine = service.subscribe(() => { updatePrincipal(); purchase.update(); });
        }, error => { backend = null; throw error; });
        return backend;
    };

    const onAccess = async (value, isCurrent) => {
        const access = ++accessGeneration;
        const user = value?.user || null;
        const capabilities = value?.capabilities || { role: 'public', characterIds: [] };
        if (!user) {
            controller?.close();
            sessionKey = '';
            screen = { name: 'signin' };
        } else if (!(capabilities.characterIds || []).includes(charId)) {
            controller?.close();
            sessionKey = '';
            screen = { name: 'unavailable' };
        } else {
            const nextRole = capabilities.role === 'mj' ? 'mj' : 'joueur';
            const key = `${user.uid}:${nextRole}`;
            role = nextRole;
            importButton.hidden = nextRole !== 'mj';
            if (key === sessionKey) {
                // Après un échec transitoire (Réessayer), la session tourne déjà : rétablir l'écran.
                if (screen.name !== 'session') { screen = { name: 'session' }; render(); }
                return;
            }
            try { await ensureBackend(); } catch {
                if (!isCurrent()) return;
                screen = { name: 'failed' };
                render();
                return;
            }
            // Une déconnexion ou un autre compte arrivé pendant le chargement périme cet accès.
            if (!isCurrent() || access !== accessGeneration || !controller) return;
            sessionKey = key;
            screen = { name: 'session' };
            controller.setSession({ uid: user.uid, charId, role });
            return;
        }
        render();
    };

    const connect = async () => {
        const current = ++generation;
        const isCurrent = () => mounted && !abortSignal?.aborted && current === generation;
        stopWatch?.();
        stopWatch = null;
        screen = { name: 'loading' };
        render();
        try {
            const client = await getClient();
            if (!isCurrent()) return;
            if (!client || typeof client.watch !== 'function') throw new Error('Session fiche indisponible');
            const stop = client.watch(value => { if (isCurrent()) void onAccess(value, isCurrent); }, () => {
                // L'erreur ne concerne que la vérification d'accès : une fiche déjà affichée reste affichée.
                if (!isCurrent() || sessionKey) return;
                screen = { name: 'failed' };
                render();
            });
            if (isCurrent()) stopWatch = stop;
            else stop?.();
        } catch {
            if (!isCurrent()) return;
            screen = { name: 'failed' };
            render();
        }
    };

    // Les onglets sont de vrais liens : le routeur ne remonte pas la vue, c'est elle qui suit le hash.
    const onHashChange = () => {
        const next = parseRoute(windowRef.location?.hash ?? '');
        if (next.name !== ROUTE_NAMES.FICHE || next.id !== charId || next.tab === tab) return;
        tab = next.tab;
        updatePanel();
        container.scrollTop = 0;
        announce(`Onglet ${tabLabel(tab)}`);
    };
    const onOnline = () => {
        online = true;
        updateShell();
        if (controller?.getState().hasDraft) void Promise.resolve(controller.submitPatch()).catch(() => {});
    };
    const onOffline = () => { online = false; updateShell(); };

    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        generation += 1;
        windowRef?.removeEventListener?.('hashchange', onHashChange);
        windowRef?.removeEventListener?.('online', onOnline);
        windowRef?.removeEventListener?.('offline', onOffline);
        stopWatch?.();
        stopWatch = null;
        stopCatalogue?.();
        stopCatalogue = null;
        stopEngine?.();
        stopEngine = null;
        menu.close();
        purchase.close();
        controller?.close();
        abortSignal?.removeEventListener?.('abort', unmount);
        abortSignal = null;
        container.replaceChildren();
    };

    return Object.freeze({
        mount({ signal } = {}) {
            if (mounted || signal?.aborted) return;
            mounted = true;
            abortSignal = signal || null;
            abortSignal?.addEventListener?.('abort', unmount, { once: true });
            windowRef?.addEventListener?.('hashchange', onHashChange);
            windowRef?.addEventListener?.('online', onOnline);
            windowRef?.addEventListener?.('offline', onOffline);
            void connect();
        },
        unmount,
        focusTarget() { return null; },
        routeAnnouncement() {
            const nom = identity().nom;
            return nom ? `Fiche de ${nom}` : null;
        },
        openMenu(trigger) { menu.show(trigger); },
    });
}

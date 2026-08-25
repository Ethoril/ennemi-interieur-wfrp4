import { mountIndiceImage } from '../components/indice-image.js';
import { createEnquetesAdminListModel } from '../enquete-admin-list-model.js';
import { errorForUi } from '../../data/firebase-errors.js';

const listMemory = new Map();

export function clearEnquetesMjListMemory(uid = null) {
    if (typeof uid === 'string' && uid) listMemory.delete(uid);
    else listMemory.clear();
}

function isMj(getSession) {
    const candidate = typeof getSession === 'function' ? getSession() : getSession;
    const state = candidate?.getState?.() || candidate || {};
    return state.status === 'gm' && state.role === 'mj'
        && typeof state.user?.uid === 'string' && state.user.uid.length > 0;
}

export function createEnquetesMjListView({
    container,
    getRepository = () => null,
    getImageService = () => null,
    onCreate = () => {},
    onEdit = () => {},
    getSession = () => ({}),
} = {}) {
    let mounted = false;
    let unsubscribe = () => {};
    let items = [];
    const session = typeof getSession === 'function' ? getSession() : getSession;
    const sessionState = session?.getState?.() || session || {};
    const memoryKey = typeof sessionState.user?.uid === 'string' ? sessionState.user.uid : null;
    const remembered = memoryKey ? listMemory.get(memoryKey) : null;
    let filter = remembered?.filter || 'all';
    let search = remembered?.search || '';
    let refs = null;
    let imageDisposers = [];
    let signalRef = null;
    let abortHandler = null;
    let dataSignature = '';
    let subscriptionGeneration = 0;

    const disposeImages = () => {
        imageDisposers.forEach(handle => handle?.dispose?.());
        imageDisposers = [];
    };

    const renderCard = item => {
        const row = refs.document.createElement('li');
        const card = refs.document.createElement('article');
        card.className = 'm-enquete-card m-enquete-admin-card';
        const image = refs.document.createElement('span');
        image.className = 'm-enquete-thumbnail';
        imageDisposers.push(mountIndiceImage({
            container: image, item, imageService: getImageService(), size: 72, lazy: true,
        }));
        const copy = refs.document.createElement('div');
        copy.className = 'm-enquete-card-copy';
        const link = refs.document.createElement('a');
        link.href = `#/enquetes/${encodeURIComponent(item.id)}/modifier`;
        link.textContent = item.titre;
        link.setAttribute('aria-label', `Modifier l’enquête ${item.titre}`);
        link.addEventListener('click', event => {
            event.preventDefault();
            if (isMj(getSession)) onEdit(item.id);
        });
        const status = refs.document.createElement('span');
        status.className = item.decouvert
            ? 'm-enquete-status m-enquete-status-public'
            : 'm-enquete-status m-enquete-status-secret';
        status.textContent = item.decouvert ? '✦ Découvert' : '◌ Secret';
        status.setAttribute('aria-label', item.decouvert
            ? 'Statut : découvert' : 'Statut : secret');
        copy.append(link, status);
        card.append(image, copy);
        row.append(card);
        return row;
    };

    const render = () => {
        if (!mounted || signalRef?.aborted || !refs) return;
        const nextSignature = JSON.stringify({ items, filter, search });
        if (nextSignature === dataSignature) return;
        dataSignature = nextSignature;
        const model = createEnquetesAdminListModel({ items, filter, search });
        refs.count.textContent = `${model.results.length} enquête${model.results.length === 1 ? '' : 's'} · `
            + `${model.counts.discovered} découverte${model.counts.discovered === 1 ? '' : 's'} · `
            + `${model.counts.secret} secret${model.counts.secret === 1 ? '' : 's'}`;
        refs.list.replaceChildren();
        disposeImages();
        if (!model.results.length) {
            const empty = refs.document.createElement('p');
            empty.className = 'm-detail-empty';
            empty.textContent = model.emptyState === 'no-results'
                ? 'Aucune enquête ne correspond à la recherche.'
                : 'Aucune enquête enregistrée.';
            refs.list.append(empty);
            return;
        }
        const list = refs.document.createElement('ul');
        list.className = 'm-public-list m-enquete-list';
        model.results.forEach(item => list.append(renderCard(item)));
        refs.list.append(list);
    };

    const subscribe = repository => {
        unsubscribe();
        unsubscribe = () => {};
        dataSignature = '';
        const localGeneration = ++subscriptionGeneration;
        unsubscribe = repository.subscribeAll(next => {
            if (!mounted || localGeneration !== subscriptionGeneration || !isMj(getSession)) return;
            items = Array.isArray(next) ? next : [];
            render();
        }, error => {
            if (!mounted || localGeneration !== subscriptionGeneration || !isMj(getSession)) return;
            disposeImages();
            dataSignature = '';
            refs.list.replaceChildren();
            const message = refs.document.createElement('p');
            message.textContent = errorForUi(error).message;
            refs.list.append(message);
            const retry = refs.document.createElement('button');
            retry.type = 'button';
            retry.className = 'm-button';
            retry.textContent = 'Réessayer';
            retry.addEventListener('click', () => {
                if (!mounted || !isMj(getSession)) return;
                subscribe(repository);
            });
            refs.list.append(retry);
        });
    };

    const mount = ({ signal } = {}) => {
        if (mounted || !container || signal?.aborted) return;
        mounted = true;
        signalRef = signal ?? null;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'enquetes-mj-list';
        const heading = documentRef.createElement('h2');
        heading.textContent = 'Enquêtes — MJ';
        const toolbar = documentRef.createElement('div');
        toolbar.className = 'm-list-toolbar';
        const create = documentRef.createElement('button');
        create.type = 'button';
        create.className = 'm-button m-button-primary';
        create.textContent = 'Nouvelle enquête';
        create.addEventListener('click', () => { if (isMj(getSession)) onCreate(); });
        const count = documentRef.createElement('output');
        count.className = 'm-result-count';
        count.setAttribute('aria-live', 'polite');
        toolbar.append(create, count);
        const searchControl = documentRef.createElement('input');
        searchControl.type = 'search';
        searchControl.className = 'm-search-input';
        searchControl.placeholder = 'Rechercher';
        searchControl.value = search;
        searchControl.setAttribute('aria-label', 'Rechercher une enquête');
        const tabs = documentRef.createElement('div');
        tabs.className = 'm-enquete-admin-filters';
        const buttons = {};
        [['all', 'Tous'], ['discovered', 'Découverts'], ['secret', 'Secrets']].forEach(([key, label]) => {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'm-button';
            button.textContent = label;
            button.dataset.filter = key;
            button.addEventListener('click', () => {
                if (!mounted || signalRef?.aborted || !isMj(getSession)) return;
                    filter = key;
                    if (memoryKey) listMemory.set(memoryKey, { filter, search });
                Object.entries(buttons).forEach(([name, node]) => {
                    node.setAttribute('aria-pressed', String(name === key));
                });
                render();
            });
            buttons[key] = button;
            tabs.append(button);
        });
        Object.entries(buttons).forEach(([name, node]) => {
            node.setAttribute('aria-pressed', String(name === filter));
        });
        const list = documentRef.createElement('div');
        list.className = 'm-list-state';
        screen.append(heading, toolbar, searchControl, tabs, list);
        container.append(screen);
        refs = { document: documentRef, count, list };
        searchControl.addEventListener('input', () => {
            if (!mounted || signalRef?.aborted || !isMj(getSession)) return;
            search = searchControl.value;
            if (memoryKey) listMemory.set(memoryKey, { filter, search });
            render();
        });
        abortHandler = () => unmount();
        signal?.addEventListener?.('abort', abortHandler, { once: true });
        const repository = getRepository();
        if (!isMj(getSession) || typeof repository?.subscribeAll !== 'function') {
            list.textContent = 'Session MJ requise.';
            return;
        }
        subscribe(repository);
        render();
    };

    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        subscriptionGeneration += 1;
        unsubscribe();
        unsubscribe = () => {};
        disposeImages();
        signalRef?.removeEventListener?.('abort', abortHandler);
        container.replaceChildren();
        dataSignature = '';
        refs = null;
        signalRef = null;
        abortHandler = null;
    };

    return Object.freeze({ mount, unmount });
}

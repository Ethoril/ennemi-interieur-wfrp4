import { mountIndiceImage } from '../components/indice-image.js';
import { selectEnquetesListModel } from '../enquete-list-model.js';
import { publicStatusMessage, renderState } from '../ui.js';

function excerpt(value, maximum = 180) {
    const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
    return text.length > maximum ? `${text.slice(0, maximum - 1).trimEnd()}…` : text;
}

function renderLinkedPnjs(documentRef, pnjs) {
    const people = documentRef.createElement('div');
    people.className = 'm-enquete-pnjs';
    const label = documentRef.createElement('span');
    label.className = 'visually-hidden';
    label.textContent = 'PNJs liés : ';
    people.append(label);
    pnjs.forEach((pnj, index) => {
        if (index) {
            const separator = documentRef.createTextNode?.(', ') ?? documentRef.createElement('span');
            if (!documentRef.createTextNode) separator.textContent = ', ';
            people.append(separator);
        }
        const link = documentRef.createElement('a');
        link.href = `#/pnjs/${encodeURIComponent(pnj.id)}`;
        link.textContent = pnj.nom;
        link.setAttribute('aria-label', `Ouvrir la fiche publique de ${pnj.nom}`);
        people.append(link);
    });
    return people;
}

function renderCards({ documentRef, target, items, imageService, onOpen }) {
    target.replaceChildren();
    const list = documentRef.createElement('ul');
    list.className = 'm-public-list m-enquete-list';
    const disposers = [];
    for (const item of items) {
        const row = documentRef.createElement('li');
        const card = documentRef.createElement('article');
        card.className = 'm-enquete-card';
        const image = documentRef.createElement('span');
        image.className = 'm-enquete-thumbnail';
        disposers.push(mountIndiceImage({ container: image, item, imageService, size: 72, lazy: true }));
        const copy = documentRef.createElement('div');
        copy.className = 'm-enquete-card-copy';
        const link = documentRef.createElement('a');
        link.href = `#/enquetes/${encodeURIComponent(item.id)}`;
        link.setAttribute('aria-label', `Ouvrir l’enquête « ${item.titre} »`);
        link.addEventListener('click', event => {
            event.preventDefault();
            onOpen(item.id);
        });
        const title = documentRef.createElement('strong');
        title.textContent = item.titre;
        link.append(title);
        if (item.description) {
            const description = documentRef.createElement('span');
            description.textContent = excerpt(item.description);
            link.append(description);
        }
        copy.append(link);
        if (item.pnjs.length) copy.append(renderLinkedPnjs(documentRef, item.pnjs));
        card.append(image, copy);
        row.append(card);
        list.append(row);
    }
    target.append(list);
    return disposers;
}

function modelSignature(model) {
    return JSON.stringify({ search: model.search, emptyState: model.emptyState, items: model.items, results: model.results });
}

export function createEnquetesListView({
    container,
    store,
    getImageService = () => null,
    onRetry = () => store?.restart?.(),
    onOpen = () => {},
} = {}) {
    let mounted = false;
    let search = null;
    let target = null;
    let resultCount = null;
    let badge = null;
    let warning = null;
    let warningText = null;
    let retryButton = null;
    let unsubscribe = () => {};
    let imageDisposers = [];
    let searchTimer = null;
    let contentSignature = null;
    let stateSignature = null;
    let signalRef = null;
    let abortHandler = null;
    let activeGeneration = null;

    const disposeImages = () => {
        imageDisposers.forEach(handle => handle?.dispose?.());
        imageDisposers = [];
    };

    const renderEmptySearch = () => renderState(target, {
        state: 'empty',
        title: 'Aucun résultat',
        message: 'Aucune enquête ne correspond à cette recherche.',
        actionLabel: 'Effacer la recherche',
        onAction: () => store.setPreferences({ enqueteSearch: '' }),
    });

    const render = state => {
        if (!mounted || signalRef?.aborted) return;
        if (typeof state?.generation === 'number') {
            if (activeGeneration !== null && state.generation < activeGeneration) return;
            activeGeneration = state.generation;
        }
        const selected = selectEnquetesListModel(state);
        const nextStateSignature = JSON.stringify([selected.kind, selected.message, selected.warning, publicStatusMessage(state)]);
        if (stateSignature !== nextStateSignature) {
            badge.textContent = publicStatusMessage(state) || '';
            badge.hidden = !badge.textContent;
            warningText.textContent = selected.warning || '';
            warning.hidden = selected.kind !== 'ready' || !selected.warning;
            resultCount.textContent = selected.kind === 'ready'
                ? `${selected.list.results.length} enquête${selected.list.results.length === 1 ? '' : 's'}${selected.list.results.length !== selected.list.items.length ? ` sur ${selected.list.items.length}` : ''}`
                : '';
            stateSignature = nextStateSignature;
        }
        if (selected.kind !== 'ready') {
            const kindSignature = `${selected.kind}\u001f${selected.message}`;
            if (contentSignature !== kindSignature) {
                disposeImages();
                renderState(target, {
                    state: selected.kind === 'offline-empty' ? 'offline' : selected.kind,
                    title: selected.kind === 'offline-empty' ? 'Connexion initiale requise' : 'Enquêtes',
                    message: selected.message,
                    actionLabel: selected.retry ? 'Réessayer' : '',
                    onAction: selected.retry ? onRetry : null,
                });
                contentSignature = kindSignature;
            }
            return;
        }
        const model = selected.list;
        if (container.ownerDocument.activeElement !== search) search.value = model.search;
        resultCount.textContent = `${model.results.length} enquête${model.results.length === 1 ? '' : 's'}${model.results.length !== model.items.length ? ` sur ${model.items.length}` : ''}`;
        const nextSignature = modelSignature(model);
        if (nextSignature === contentSignature) return;
        const scrollTop = container.scrollTop;
        disposeImages();
        if (model.emptyState === 'none-discovered') {
            renderState(target, { state: 'empty', title: 'Aucun indice découvert', message: 'Les indices apparaîtront ici lorsqu’ils seront partagés avec les joueurs.' });
        } else if (model.emptyState === 'no-results') {
            renderEmptySearch();
        } else {
            imageDisposers = renderCards({ documentRef: container.ownerDocument, target, items: model.results, imageService: getImageService(), onOpen });
        }
        container.scrollTop = scrollTop;
        contentSignature = nextSignature;
    };

    const commitSearch = () => store.setPreferences({ enqueteSearch: search.value });
    const onSearch = () => {
        const timers = container.ownerDocument.defaultView || globalThis;
        if (searchTimer !== null) timers.clearTimeout?.(searchTimer);
        searchTimer = null;
        if (!search.value) {
            commitSearch();
            return;
        }
        searchTimer = timers.setTimeout?.(() => { searchTimer = null; commitSearch(); }, 100) ?? null;
    };

    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        signalRef = signal ?? null;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'enquetes-list';
        const heading = documentRef.createElement('h2');
        heading.textContent = 'Enquêtes';
        const label = documentRef.createElement('label');
        label.className = 'm-search';
        const labelText = documentRef.createElement('span');
        labelText.textContent = 'Rechercher une enquête';
        search = documentRef.createElement('input');
        search.type = 'search';
        search.placeholder = 'Titre, texte ou PNJ lié';
        search.autocomplete = 'off';
        search.enterKeyHint = 'search';
        search.value = store.getState()?.preferences?.enqueteSearch ?? '';
        label.append(labelText, search);
        const toolbar = documentRef.createElement('div');
        toolbar.className = 'm-list-toolbar';
        resultCount = documentRef.createElement('output');
        resultCount.className = 'm-result-count';
        resultCount.setAttribute('aria-live', 'polite');
        toolbar.append(resultCount);
        badge = documentRef.createElement('p');
        badge.className = 'm-sync-badge';
        badge.hidden = true;
        warning = documentRef.createElement('p');
        warning.className = 'm-inline-warning';
        warning.setAttribute('role', 'alert');
        warning.hidden = true;
        warningText = documentRef.createElement('span');
        retryButton = documentRef.createElement('button');
        retryButton.type = 'button';
        retryButton.className = 'm-button';
        retryButton.textContent = 'Réessayer';
        retryButton.addEventListener('click', onRetry);
        warning.append(warningText, retryButton);
        target = documentRef.createElement('div');
        target.className = 'm-list-state';
        screen.append(heading, label, toolbar, badge, warning, target);
        container.append(screen);
        abortHandler = () => unmount();
        signal?.addEventListener?.('abort', abortHandler, { once: true });
        search.addEventListener('input', onSearch);
        unsubscribe = store.subscribe(state => render(state));
    };

    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        const timers = container.ownerDocument.defaultView || globalThis;
        if (searchTimer !== null) timers.clearTimeout?.(searchTimer);
        searchTimer = null;
        unsubscribe();
        unsubscribe = () => {};
        disposeImages();
        search?.removeEventListener('input', onSearch);
        retryButton?.removeEventListener('click', onRetry);
        signalRef?.removeEventListener?.('abort', abortHandler);
        container.replaceChildren();
        search = null;
        target = null;
        resultCount = null;
        badge = null;
        warning = null;
        warningText = null;
        retryButton = null;
        contentSignature = null;
        stateSignature = null;
        signalRef = null;
        abortHandler = null;
        activeGeneration = null;
    };

    return Object.freeze({ mount, unmount });
}

export { selectEnquetesListModel };

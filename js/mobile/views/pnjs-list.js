import { publicStatusMessage, renderState } from '../ui.js';

function includesSearch(item, search) {
    if (!search) return true;
    const folded = search.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    return [item.nom, item.lieu, item.groupe].some(value => String(value ?? '')
        .normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().includes(folded));
}

export function selectPnjsListModel(state) {
    const resource = state?.resources?.pnjs;
    const connection = state?.connection ?? {};
    if (connection.phase === 'offline-empty') {
        return Object.freeze({ kind: 'offline-empty', items: Object.freeze([]), retry: true,
            message: 'Une première connexion est nécessaire pour charger les PNJs.' });
    }
    if (state?.error) {
        return Object.freeze({ kind: 'error', items: Object.freeze([]), retry: true,
            message: state.error.kind === 'permission'
                ? 'L’accès aux données publiques a été refusé.'
                : 'Les données publiques ne peuvent pas être initialisées.' });
    }
    if (!resource || resource.status === 'loading') {
        return Object.freeze({ kind: 'loading', items: Object.freeze([]), retry: false,
            message: 'Chargement des données publiques…' });
    }
    if (resource.status === 'error' && resource.items.length === 0) {
        const permission = resource.error?.kind === 'permission';
        return Object.freeze({ kind: 'error', items: Object.freeze([]), retry: true,
            message: permission ? 'L’accès aux PNJs publics a été refusé.' : 'Les PNJs ne peuvent pas être chargés.' });
    }
    if (resource.items.length === 0) {
        return Object.freeze({ kind: 'empty', items: Object.freeze([]), retry: false,
            message: 'Aucun PNJ public n’est disponible.' });
    }
    const search = String(state?.preferences?.filters?.search ?? '').trim();
    const items = Object.freeze(resource.items.filter(item => includesSearch(item, search)));
    return Object.freeze({
        kind: 'ready',
        items,
        retry: resource.status === 'error',
        warning: resource.status === 'error' ? 'Mise à jour impossible : les données déjà reçues restent consultables.' : '',
        badge: publicStatusMessage(state),
    });
}

function renderList(container, model, onRetry) {
    container.replaceChildren();
    if (model.kind !== 'ready') {
        renderState(container, {
            state: model.kind === 'offline-empty' ? 'offline' : model.kind,
            title: model.kind === 'offline-empty' ? 'Connexion initiale requise' : 'PNJs',
            message: model.message,
            actionLabel: model.retry ? 'Réessayer' : '',
            onAction: model.retry ? onRetry : null,
        });
        return;
    }
    const documentRef = container.ownerDocument;
    if (model.badge) {
        const badge = documentRef.createElement('p');
        badge.className = 'm-sync-badge';
        badge.textContent = model.badge;
        container.append(badge);
    }
    if (model.warning) {
        const warning = documentRef.createElement('p');
        warning.className = 'm-inline-warning';
        warning.setAttribute('role', 'alert');
        warning.textContent = model.warning;
        container.append(warning);
    }
    if (model.items.length === 0) {
        renderState(container, { state: 'empty', title: 'Aucun résultat', message: 'Modifiez votre recherche.' });
        return;
    }
    const list = documentRef.createElement('ul');
    list.className = 'm-public-list';
    for (const pnj of model.items) {
        const row = documentRef.createElement('li');
        const link = documentRef.createElement('a');
        link.href = `#/pnjs/${encodeURIComponent(pnj.id)}`;
        const name = documentRef.createElement('strong');
        name.textContent = pnj.nom || 'Sans nom';
        const context = documentRef.createElement('span');
        context.textContent = [pnj.lieu, pnj.groupe].filter(Boolean).join(' · ') || 'Lieu inconnu';
        link.append(name, context);
        row.append(link);
        list.append(row);
    }
    container.append(list);
}

export function createPnjsListView({ container, store, onRetry = () => store?.restart?.() } = {}) {
    let mounted = false;
    let search = null;
    let stateContainer = null;
    let unsubscribeStore = () => {};
    let onSearch = null;
    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        container.replaceChildren();
        const documentRef = container.ownerDocument;
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnjs-list';
        const heading = documentRef.createElement('h2');
        heading.textContent = 'PNJs';
        const label = documentRef.createElement('label');
        label.className = 'm-search';
        label.textContent = 'Rechercher un PNJ';
        search = documentRef.createElement('input');
        search.type = 'search';
        search.placeholder = 'Nom, lieu ou groupe';
        search.autocomplete = 'off';
        search.value = store.getState()?.preferences?.filters?.search ?? '';
        onSearch = () => store.setPreferences({ filters: {
            ...store.getState().preferences.filters,
            search: search.value,
        } });
        search.addEventListener('input', onSearch);
        label.append(search);
        stateContainer = documentRef.createElement('div');
        stateContainer.className = 'm-list-state';
        screen.append(heading, label, stateContainer);
        if (signal?.aborted) return;
        container.append(screen);
        unsubscribeStore = store.subscribe(state => {
            if (signal?.aborted || !mounted) return;
            if (documentRef.activeElement !== search) search.value = state.preferences.filters.search;
            renderList(stateContainer, selectPnjsListModel(state), onRetry);
        });
    };
    const unmount = () => {
        if (!mounted) return;
        unsubscribeStore();
        unsubscribeStore = () => {};
        search?.removeEventListener('input', onSearch);
        container.replaceChildren();
        search = null;
        stateContainer = null;
        onSearch = null;
        mounted = false;
    };
    return Object.freeze({ mount, unmount });
}

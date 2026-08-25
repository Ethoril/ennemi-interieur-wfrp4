import { publicStatusMessage, renderState } from '../ui.js';

export function selectPnjDetailModel(state, id) {
    const resource = state?.resources?.pnjs;
    const connection = state?.connection ?? {};
    if (connection.phase === 'offline-empty') {
        return Object.freeze({ kind: 'offline-empty', retry: true, item: null,
            message: 'Une première connexion est nécessaire pour charger cette fiche.' });
    }
    if (state?.error) {
        return Object.freeze({ kind: 'error', retry: true, item: null,
            message: state.error.kind === 'permission'
                ? 'L’accès aux données publiques a été refusé.'
                : 'Les données publiques ne peuvent pas être initialisées.' });
    }
    const item = resource?.items?.find(candidate => candidate.id === id) || null;
    if (!resource || resource.status === 'loading') {
        return Object.freeze({ kind: 'loading', retry: false, item: null,
            message: 'Chargement de la fiche…' });
    }
    if (!item && resource.status === 'error') {
        return Object.freeze({ kind: 'error', retry: true, item: null,
            message: resource.error?.kind === 'permission'
                ? 'L’accès aux PNJs publics a été refusé.'
                : 'Impossible de charger cette fiche.' });
    }
    if (!item) {
        return Object.freeze({ kind: 'empty', retry: false, item: null,
            message: 'Ce PNJ n’est plus public ou n’existe pas.' });
    }
    return Object.freeze({
        kind: 'ready',
        item,
        retry: resource.status === 'error',
        warning: resource.status === 'error'
            ? 'Mise à jour impossible : la dernière fiche reçue reste consultable.' : '',
        badge: publicStatusMessage(state),
    });
}

function appendField(documentRef, parent, label, value) {
    if (typeof value !== 'string' || value.trim() === '') return;
    const row = documentRef.createElement('p');
    const strong = documentRef.createElement('strong');
    strong.textContent = `${label} : `;
    row.append(strong, documentRef.createTextNode(value));
    parent.append(row);
}

function renderDetail(container, model, onRetry) {
    container.replaceChildren();
    if (model.kind !== 'ready') {
        renderState(container, {
            state: model.kind === 'offline-empty' ? 'offline' : model.kind,
            title: model.kind === 'empty' ? 'PNJ introuvable' : 'Fiche indisponible',
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
    const heading = documentRef.createElement('h3');
    heading.textContent = typeof model.item.nom === 'string' && model.item.nom.trim()
        ? model.item.nom : 'PNJ sans nom';
    container.append(heading);
    appendField(documentRef, container, 'Statut', model.item.statut);
    appendField(documentRef, container, 'Lieu', model.item.lieu);
    appendField(documentRef, container, 'Groupe', model.item.groupe);
    appendField(documentRef, container, 'Description', model.item.description);
}

export function createPnjDetailView({ container, id, store, onBack,
    onRetry = () => store?.restart?.() } = {}) {
    let mounted = false;
    let backButton = null;
    let content = null;
    let unsubscribe = () => {};
    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        container.replaceChildren();
        const documentRef = container.ownerDocument;
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnj-detail';
        const heading = documentRef.createElement('h2');
        heading.textContent = 'PNJ';
        content = documentRef.createElement('article');
        content.className = 'm-detail-content m-hero-card';
        backButton = documentRef.createElement('button');
        backButton.type = 'button';
        backButton.className = 'm-button';
        backButton.textContent = 'Retour à la liste';
        backButton.addEventListener('click', onBack);
        screen.append(heading, content, backButton);
        if (signal?.aborted) return;
        container.append(screen);
        unsubscribe = store.subscribe(state => {
            if (!mounted || signal?.aborted) return;
            renderDetail(content, selectPnjDetailModel(state, id), onRetry);
        });
    };
    const unmount = () => {
        if (!mounted) return;
        unsubscribe();
        unsubscribe = () => {};
        backButton?.removeEventListener('click', onBack);
        container.replaceChildren();
        backButton = null;
        content = null;
        mounted = false;
    };
    return Object.freeze({ mount, unmount });
}

import { createFilterSheet } from '../components/filter-sheet.js';
import { mountPnjPortrait } from '../components/portrait.js';
import { createPnjListModel, FILTER_DIMENSIONS } from '../pnj-list-model.js';
import { renderState } from '../ui.js';

const FILTER_LABELS = Object.freeze({ groupe: 'Groupe', statut: 'Statut', lieu: 'Lieu' });

function selectedFilters(preferences) {
    return Object.fromEntries(FILTER_DIMENSIONS.map(name => [name,
        Array.isArray(preferences?.filters?.[name]) ? preferences.filters[name] : []]));
}

function sameFilters(left, right) {
    return FILTER_DIMENSIONS.every(name => {
        const a = Array.isArray(left?.[name]) ? left[name] : [];
        const b = Array.isArray(right?.[name]) ? right[name] : [];
        return a.length === b.length && a.every((value, index) => value === b[index]);
    });
}

function listSignature(model) {
    const rows = model.results.map(item => [
        item.id, item.ordre, item.nom, item.statut, item.vivant, item.lieu, item.groupe,
        item.image?.path, item.image?.legacy, item.image?.invalid,
    ].map(value => String(value ?? '')).join('\u001f')).join('\u001e');
    return `${model.search}\u001d${FILTER_DIMENSIONS.map(name => model.filters[name].join('\u001f')).join('\u001e')}\u001d${rows}`;
}

export function selectPnjsListModel(state) {
    const resource = state?.resources?.pnjs;
    const connection = state?.connection ?? {};
    if (connection.phase === 'offline-empty') {
        return Object.freeze({ kind: 'offline-empty', retry: true,
            message: 'Une première connexion est nécessaire pour charger les PNJs.' });
    }
    if (state?.error) {
        return Object.freeze({ kind: 'error', retry: true,
            message: state.error.kind === 'permission'
                ? 'L’accès aux données publiques a été refusé.'
                : 'Les données publiques ne peuvent pas être initialisées.' });
    }
    if (!resource || resource.status === 'loading') {
        return Object.freeze({ kind: 'loading', retry: false,
            message: 'Chargement des données publiques…' });
    }
    if (resource.status === 'error' && resource.items.length === 0) {
        return Object.freeze({ kind: 'error', retry: true,
            message: resource.error?.kind === 'permission'
                ? 'L’accès aux PNJs publics a été refusé.' : 'Les PNJs ne peuvent pas être chargés.' });
    }
    const list = createPnjListModel({
        items: resource.items,
        search: state?.preferences?.filters?.search,
        filters: selectedFilters(state?.preferences),
    }).getState();
    return Object.freeze({
        kind: 'ready',
        list,
        retry: resource.status === 'error',
        warning: resource.status === 'error'
            ? 'Mise à jour impossible : les données déjà reçues restent consultables.' : '',
    });
}

function appendBadge(documentRef, parent, value) {
    if (typeof value !== 'string' || !value.trim()) return;
    const badge = documentRef.createElement('span');
    badge.className = 'm-pnj-badge';
    badge.textContent = value;
    parent.append(badge);
}

function renderPnjCards({ documentRef, target, model, imageService, portraits }) {
    const fragment = documentRef.createDocumentFragment();
    const list = documentRef.createElement('ul');
    list.className = 'm-public-list';
    for (const pnj of model.results) {
        const row = documentRef.createElement('li');
        const link = documentRef.createElement('a');
        link.className = 'm-pnj-card';
        link.href = `#/pnjs/${encodeURIComponent(pnj.id)}`;
        const nameText = typeof pnj.nom === 'string' && pnj.nom.trim() ? pnj.nom : 'PNJ sans nom';
        link.setAttribute('aria-label', `Ouvrir la fiche de ${nameText}`);
        const portrait = documentRef.createElement('span');
        portrait.className = 'm-pnj-portrait';
        portrait.setAttribute('aria-hidden', 'true');
        portraits.add(mountPnjPortrait({ container: portrait, item: pnj, imageService }));
        const copy = documentRef.createElement('span');
        copy.className = 'm-pnj-card-copy';
        const name = documentRef.createElement('strong');
        name.textContent = nameText;
        const context = documentRef.createElement('span');
        context.className = 'm-pnj-context';
        context.textContent = [pnj.groupe, pnj.lieu].filter(value => typeof value === 'string' && value.trim())
            .join(' · ') || 'Lieu et groupe inconnus';
        const badges = documentRef.createElement('span');
        badges.className = 'm-pnj-badges';
        appendBadge(documentRef, badges, pnj.statut);
        if (pnj.vivant !== pnj.statut) appendBadge(documentRef, badges, pnj.vivant);
        copy.append(name, context);
        if (badges.childNodes.length) copy.append(badges);
        const chevron = documentRef.createElement('span');
        chevron.className = 'm-pnj-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '›';
        link.append(portrait, copy, chevron);
        row.append(link);
        list.append(row);
    }
    fragment.append(list);
    target.replaceChildren(fragment);
}

export function createPnjsListView({
    container,
    store,
    getImageService = () => null,
    onRetry = () => store?.restart?.(),
    getSession = () => null,
    onCreate = null,
} = {}) {
    let mounted = false;
    let search = null;
    let filterButton = null;
    let resultCount = null;
    let warning = null;
    let warningText = null;
    let retryButton = null;
    let listTarget = null;
    let unsubscribeStore = () => {};
    let searchTimer = null;
    let lastSignature = null;
    let currentModel = null;
    const portraits = new Set();
    let sheet = null;
    let unsubscribeSession = () => {};
    let createButton = null;

    const renderCreateAction = state => {
        if (!createButton) return;
        const allowed = state?.status === 'gm' && state?.role === 'mj'
            && typeof state.user?.uid === 'string' && state.user.uid.length > 0;
        createButton.hidden = !allowed;
        createButton.disabled = !allowed;
    };

    const releasePortraits = () => {
        for (const portrait of portraits) portrait.dispose();
        portraits.clear();
    };
    const updatePreferences = patch => store.setPreferences({
        filters: { ...store.getState().preferences.filters, ...patch },
    });
    const clearCriteria = () => updatePreferences({
        search: '',
        ...Object.fromEntries(FILTER_DIMENSIONS.map(name => [name, []])),
    });
    const renderList = model => {
        const scrollTop = container.scrollTop;
        const signature = listSignature(model);
        if (signature !== lastSignature) {
            releasePortraits();
            if (model.emptyState) {
                renderState(listTarget, {
                    state: 'empty',
                    title: model.emptyState === 'no-published' ? 'Aucun PNJ publié' : 'Aucun résultat',
                    message: model.emptyState === 'no-published'
                        ? 'Aucun personnage n’est actuellement disponible pour les joueurs.'
                        : 'Modifiez votre recherche ou vos filtres.',
                    actionLabel: model.emptyState === 'no-results' ? 'Tout effacer' : '',
                    onAction: model.emptyState === 'no-results' ? clearCriteria : null,
                });
            } else {
                renderPnjCards({
                    documentRef: container.ownerDocument,
                    target: listTarget,
                    model,
                    imageService: getImageService(),
                    portraits,
                });
            }
            container.scrollTop = scrollTop;
            lastSignature = signature;
        }
        resultCount.textContent = `${model.results.length} résultat${model.results.length === 1 ? '' : 's'}`
            + (model.results.length !== model.items.length ? ` sur ${model.items.length}` : '');
        filterButton.textContent = model.activeFilterCount
            ? `Filtres (${model.activeFilterCount})` : 'Filtres';
        filterButton.setAttribute('aria-label', model.activeFilterCount
            ? `Filtres, ${model.activeFilterCount} actifs` : 'Ouvrir les filtres');
        sheet.update({ nextFacets: model.facets });
    };
    const render = state => {
        if (!mounted || !listTarget) return;
        const selected = selectPnjsListModel(state);
        warningText.textContent = selected.warning ?? '';
        warning.hidden = !selected.warning;
        retryButton.hidden = !selected.retry;
        if (selected.kind !== 'ready') {
            sheet?.close();
            currentModel = null;
            lastSignature = null;
            releasePortraits();
            resultCount.textContent = '';
            filterButton.hidden = true;
            renderState(listTarget, {
                state: selected.kind === 'offline-empty' ? 'offline' : selected.kind,
                title: selected.kind === 'offline-empty' ? 'Connexion initiale requise' : 'PNJs',
                message: selected.message,
                actionLabel: selected.retry ? 'Réessayer' : '',
                onAction: selected.retry ? onRetry : null,
            });
            return;
        }
        const requested = selectedFilters(state.preferences);
        if (!sameFilters(requested, selected.list.filters)) {
            updatePreferences(selected.list.filters);
            return;
        }
        currentModel = selected.list;
        filterButton.hidden = false;
        if (container.ownerDocument.activeElement !== search) search.value = selected.list.search;
        renderList(selected.list);
    };
    const commitSearch = () => updatePreferences({ search: search.value });
    const onSearch = () => {
        const timers = container.ownerDocument.defaultView || globalThis;
        if (searchTimer !== null) timers.clearTimeout?.(searchTimer);
        if (!search.value) { searchTimer = null; commitSearch(); return; }
        searchTimer = timers.setTimeout?.(() => { searchTimer = null; commitSearch(); }, 100) ?? null;
    };
    const onOpenFilters = () => {
        if (!currentModel) return;
        sheet.open({
            nextFacets: currentModel.facets,
            filters: currentModel.filters,
            trigger: filterButton,
        });
    };
    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnjs-list';
        const heading = documentRef.createElement('h2');
        heading.textContent = 'PNJs';
        const label = documentRef.createElement('label');
        label.className = 'm-search';
        const searchLabel = documentRef.createElement('span');
        searchLabel.textContent = 'Rechercher un PNJ';
        search = documentRef.createElement('input');
        search.type = 'search';
        search.placeholder = 'Nom, lieu ou groupe';
        search.autocomplete = 'off';
        search.enterKeyHint = 'search';
        search.value = store.getState()?.preferences?.filters?.search ?? '';
        label.append(searchLabel, search);
        const toolbar = documentRef.createElement('div');
        toolbar.className = 'm-list-toolbar';
        filterButton = documentRef.createElement('button');
        filterButton.type = 'button';
        filterButton.className = 'm-button m-filter-button';
        filterButton.textContent = 'Filtres';
        resultCount = documentRef.createElement('output');
        resultCount.className = 'm-result-count';
        resultCount.setAttribute('aria-live', 'polite');
        toolbar.append(filterButton, resultCount);
        if (typeof onCreate === 'function') {
            createButton = documentRef.createElement('button');
            createButton.type = 'button';
            createButton.className = 'm-button m-button-primary';
            createButton.textContent = 'Nouveau PNJ';
            createButton.addEventListener('click', onCreate);
            toolbar.append(createButton);
        }
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
        listTarget = documentRef.createElement('div');
        listTarget.className = 'm-list-state';
        screen.append(heading, label, toolbar, warning, listTarget);
        if (signal?.aborted) { mounted = false; return; }
        container.append(screen);
        sheet = createFilterSheet({
            documentRef,
            dimensions: FILTER_DIMENSIONS.map(key => ({ key, label: FILTER_LABELS[key] })),
            title: 'Filtrer les PNJs',
            onApply: filters => updatePreferences(filters),
        });
        sheet.mount(documentRef.body || screen);
        search.addEventListener('input', onSearch);
        filterButton.addEventListener('click', onOpenFilters);
        unsubscribeStore = store.subscribe(state => {
            if (!signal?.aborted && mounted) render(state);
        });
        const sessionSource = typeof getSession === 'function' ? getSession() : getSession;
        if (sessionSource?.subscribe) {
            renderCreateAction(sessionSource.getState?.() || {});
            unsubscribeSession = sessionSource.subscribe(renderCreateAction);
        } else {
            unsubscribeSession = () => {};
            renderCreateAction(sessionSource);
        }
    };
    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        const timers = container.ownerDocument.defaultView || globalThis;
        if (searchTimer !== null) timers.clearTimeout?.(searchTimer);
        searchTimer = null;
        unsubscribeStore();
        unsubscribeStore = () => {};
        unsubscribeSession();
        unsubscribeSession = () => {};
        search?.removeEventListener('input', onSearch);
        filterButton?.removeEventListener('click', onOpenFilters);
        retryButton?.removeEventListener('click', onRetry);
        createButton?.removeEventListener('click', onCreate);
        sheet?.destroy();
        sheet = null;
        releasePortraits();
        container.replaceChildren();
        search = null;
        filterButton = null;
        resultCount = null;
        warning = null;
        warningText = null;
        retryButton = null;
        listTarget = null;
        createButton = null;
        currentModel = null;
        lastSignature = null;
    };
    return Object.freeze({ mount, unmount });
}

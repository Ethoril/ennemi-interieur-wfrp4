import { statutLabel, vivantLabel } from '../../seal.js';
import { createFilterSheet } from '../components/filter-sheet.js';
import { mountPnjPortrait } from '../components/portrait.js';
import { createPnjListModel, DEFAULT_QUICK, FILTER_DIMENSIONS, QUICK_FILTERS, vivantKey } from '../pnj-list-model.js';
import { renderState } from '../ui.js';
import { groupLabel } from '../../pnj-groups.js';

const FILTER_LABELS = Object.freeze({ groupe: 'Groupe', statut: 'Statut', lieu: 'Lieu' });
const QUICK_LABELS = Object.freeze({ tous: 'Tous', allie: 'Alliés', neutre: 'Neutres', ennemi: 'Ennemis', decede: 'Décédés' });
const SVG_NS = 'http://www.w3.org/2000/svg';
// Entonnoir dessiné au trait : currentColor suit le thème sans couleur dans le code.
const FUNNEL_PATH = 'M4 5h16l-6.2 7.4v5.1l-3.6 1.8v-6.9z';

// Carte ouverte depuis la liste : la vue suivante la retrouve au retour pour y rendre le focus.
let _lastOpenedId = null;

/** Oublie la carte ouverte : un changement de section rend le focus au h1, pas à une ancienne carte. */
export function forgetOpenedPnjCard() {
    _lastOpenedId = null;
}

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
        item.id, item.ordre, item.nom, item.statut, item.vivant, item.lieu, groupLabel(item),
        item.image?.path, item.image?.legacy, item.image?.invalid,
    ].map(value => String(value ?? '')).join('\u001f')).join('\u001e');
    return `${model.search}\u001d${model.quick}\u001d${FILTER_DIMENSIONS.map(name => model.filters[name].join('\u001f')).join('\u001e')}\u001d${rows}`;
}

function countLabel(model) {
    const total = model.items.length;
    const plural = total === 1 ? '' : 's';
    return model.criteriaActive
        ? `${model.results.length} sur ${total} personnage${plural}`
        : `${total} personnage${plural}`;
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
        quick: state?.preferences?.filters?.quick,
    }).getState();
    return Object.freeze({
        kind: 'ready',
        list,
        retry: resource.status === 'error',
        warning: resource.status === 'error'
            ? 'Mise à jour impossible : les données déjà reçues restent consultables.' : '',
    });
}

function stateTitle(kind) {
    if (kind === 'offline-empty') return 'Connexion initiale requise';
    if (kind === 'loading') return 'Chargement des PNJs…';
    return 'PNJs indisponibles';
}

function appendBadge(documentRef, parent, value, prefix = '') {
    if (typeof value !== 'string' || !value.trim()) return;
    const badge = documentRef.createElement('span');
    badge.className = 'm-pnj-badge';
    // Préfixe masqué : « Inconnu » seul ne dit pas au lecteur d'écran de quoi il s'agit.
    if (prefix) {
        const hidden = documentRef.createElement('span');
        hidden.className = 'visually-hidden';
        hidden.textContent = prefix;
        const text = documentRef.createElement('span');
        text.textContent = value;
        badge.append(hidden, text);
    } else badge.textContent = value;
    parent.append(badge);
}

function createFunnelIcon(documentRef) {
    if (typeof documentRef.createElementNS !== 'function') return null;
    const svg = documentRef.createElementNS(SVG_NS, 'svg');
    for (const [name, value] of Object.entries({ class: 'm-filter-icon', viewBox: '0 0 24 24', width: '22', height: '22',
        'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
    const path = documentRef.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', FUNNEL_PATH);
    svg.append(path);
    return svg;
}

function renderPnjCard({ documentRef, pnj, imageService, portraits, links }) {
    const row = documentRef.createElement('li');
    const link = documentRef.createElement('a');
    link.className = 'm-pnj-card';
    link.href = `#/pnjs/${encodeURIComponent(pnj.id)}`;
    link.dataset.pnjId = pnj.id;
    const nameText = typeof pnj.nom === 'string' && pnj.nom.trim() ? pnj.nom : 'PNJ sans nom';
    const portrait = documentRef.createElement('span');
    portrait.className = 'm-pnj-portrait';
    portrait.setAttribute('aria-hidden', 'true');
    portraits.add(mountPnjPortrait({ container: portrait, item: pnj, imageService,
        marks: { statut: pnj.statut, vivant: pnj.vivant, sealSize: 20, morrSize: 18 } }));
    const copy = documentRef.createElement('span');
    copy.className = 'm-pnj-card-copy';
    const name = documentRef.createElement('strong');
    name.textContent = nameText;
    // Le lieu est dans l'en-tête du groupe : la carte ne garde que le groupe.
    const context = documentRef.createElement('span');
    context.className = 'm-pnj-context';
    context.textContent = groupLabel(pnj) || 'Groupe inconnu';
    // Le sceau est masqué avec le portrait : son statut est redit en texte pour les lecteurs d'écran.
    const statut = documentRef.createElement('span');
    statut.className = 'visually-hidden';
    statut.textContent = `Statut : ${statutLabel(pnj.statut)}`;
    copy.append(name, context, statut);
    const vivant = vivantKey(pnj.vivant);
    if (vivant === 'decede' || vivant === 'inconnu') {
        const badges = documentRef.createElement('span');
        badges.className = 'm-pnj-badges';
        appendBadge(documentRef, badges, vivantLabel(pnj.vivant), 'État vital : ');
        copy.append(badges);
    }
    const chevron = documentRef.createElement('span');
    chevron.className = 'm-pnj-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    link.append(portrait, copy, chevron);
    row.append(link);
    links.set(pnj.id, link);
    return row;
}

function renderPnjCards({ documentRef, target, model, imageService, portraits, links }) {
    const fragment = documentRef.createDocumentFragment();
    links.clear();
    for (const group of model.groups) {
        const section = documentRef.createElement('section');
        section.className = 'm-lieu-group';
        const heading = documentRef.createElement('h2');
        heading.className = 'm-lieu-heading';
        const label = documentRef.createElement('span');
        label.textContent = group.label;
        const count = documentRef.createElement('span');
        count.className = 'm-lieu-count';
        count.textContent = String(group.count);
        const countLabelText = documentRef.createElement('span');
        countLabelText.className = 'visually-hidden';
        countLabelText.textContent = group.count === 1 ? ' personnage' : ' personnages';
        count.append(countLabelText);
        heading.append(label, count);
        const list = documentRef.createElement('ul');
        list.className = 'm-public-list';
        for (const pnj of group.items) list.append(renderPnjCard({ documentRef, pnj, imageService, portraits, links }));
        section.append(heading, list);
        fragment.append(section);
    }
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
    let filterCount = null;
    let resultCount = null;
    let quickRow = null;
    const quickButtons = new Map();
    let warning = null;
    let warningText = null;
    let retryButton = null;
    let listTarget = null;
    let unsubscribeStore = () => {};
    let searchTimer = null;
    let lastSignature = null;
    let currentModel = null;
    const portraits = new Set();
    const cardLinks = new Map();
    let sheet = null;
    let unsubscribeSession = () => {};
    let createButton = null;
    let focusPending = false;

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
        cardLinks.clear();
    };
    const updatePreferences = patch => store.setPreferences({
        filters: { ...store.getState().preferences.filters, ...patch },
    });
    const clearCriteria = () => updatePreferences({
        search: '',
        quick: DEFAULT_QUICK,
        ...Object.fromEntries(FILTER_DIMENSIONS.map(name => [name, []])),
    });
    const setCriteriaVisible = visible => {
        filterButton.hidden = !visible;
        quickRow.hidden = !visible;
    };
    const renderQuickFilters = model => {
        for (const [key, refs] of quickButtons) {
            refs.button.setAttribute('aria-pressed', String(model.quick === key));
            refs.count.textContent = String(model.quickCounts[key] ?? 0);
        }
    };
    // Données arrivées après le montage : la carte ouverte reprend le focus, sauf si
    // l'utilisateur l'a déjà porté ailleurs que sur le h1 posé par l'application.
    const restorePendingFocus = () => {
        if (!focusPending) return;
        focusPending = false;
        const link = _lastOpenedId ? cardLinks.get(_lastOpenedId) : null;
        _lastOpenedId = null;
        const active = container.ownerDocument.activeElement;
        const untouched = !active || active === container.ownerDocument.body || active.id === 'm-title';
        if (link && untouched) link.focus?.();
    };
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
                    links: cardLinks,
                });
            }
            container.scrollTop = scrollTop;
            lastSignature = signature;
            restorePendingFocus();
        }
        resultCount.textContent = countLabel(model);
        filterCount.textContent = model.activeFilterCount ? String(model.activeFilterCount) : '';
        filterCount.hidden = !model.activeFilterCount;
        filterButton.setAttribute('aria-label', model.activeFilterCount
            ? `Filtres, ${model.activeFilterCount} actifs` : 'Ouvrir les filtres');
        renderQuickFilters(model);
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
            setCriteriaVisible(false);
            renderState(listTarget, {
                state: selected.kind === 'offline-empty' ? 'offline' : selected.kind,
                title: stateTitle(selected.kind),
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
        setCriteriaVisible(true);
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
    const onQuick = event => {
        const button = event.target?.closest?.('button[data-quick]') || event.target;
        const key = button?.dataset?.quick;
        if (!QUICK_FILTERS.includes(key) || !currentModel || currentModel.quick === key) return;
        updatePreferences({ quick: key });
    };
    const onListClick = event => {
        const link = event.target?.closest?.('a[data-pnj-id]');
        if (link) _lastOpenedId = link.dataset.pnjId;
    };
    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnjs-list';
        // Le h1 de l'en-tête dit déjà « PNJs » : les lieux portent les titres de niveau 2.
        const searchRow = documentRef.createElement('div');
        searchRow.className = 'm-search-row';
        const label = documentRef.createElement('label');
        label.className = 'm-search';
        const searchLabel = documentRef.createElement('span');
        searchLabel.className = 'visually-hidden';
        searchLabel.textContent = 'Rechercher un PNJ';
        search = documentRef.createElement('input');
        search.type = 'search';
        search.placeholder = 'Nom, lieu ou groupe';
        search.autocomplete = 'off';
        search.enterKeyHint = 'search';
        search.value = store.getState()?.preferences?.filters?.search ?? '';
        label.append(searchLabel, search);
        filterButton = documentRef.createElement('button');
        filterButton.type = 'button';
        filterButton.className = 'm-icon-button m-filter-button';
        filterButton.setAttribute('aria-label', 'Ouvrir les filtres');
        const funnel = createFunnelIcon(documentRef);
        if (funnel) filterButton.append(funnel);
        filterCount = documentRef.createElement('span');
        filterCount.className = 'm-filter-count';
        filterCount.setAttribute('aria-hidden', 'true');
        filterCount.hidden = true;
        filterButton.append(filterCount);
        searchRow.append(label, filterButton);
        const meta = documentRef.createElement('div');
        meta.className = 'm-list-meta';
        resultCount = documentRef.createElement('output');
        resultCount.className = 'm-result-count';
        resultCount.setAttribute('aria-live', 'polite');
        meta.append(resultCount);
        if (typeof onCreate === 'function') {
            createButton = documentRef.createElement('button');
            createButton.type = 'button';
            createButton.className = 'm-button m-button-primary m-create-button';
            const plus = documentRef.createElement('span');
            plus.setAttribute('aria-hidden', 'true');
            plus.textContent = '＋ ';
            const createLabel = documentRef.createElement('span');
            createLabel.textContent = 'Nouveau PNJ';
            createButton.append(plus, createLabel);
            createButton.hidden = true;
            createButton.addEventListener('click', onCreate);
            meta.append(createButton);
        }
        quickRow = documentRef.createElement('div');
        quickRow.className = 'm-quick-filters';
        quickRow.setAttribute('role', 'group');
        quickRow.setAttribute('aria-label', 'Filtres rapides');
        for (const key of QUICK_FILTERS) {
            const button = documentRef.createElement('button');
            button.type = 'button';
            button.className = 'm-chip';
            button.dataset.quick = key;
            button.setAttribute('aria-pressed', 'false');
            const text = documentRef.createElement('span');
            text.textContent = QUICK_LABELS[key];
            const count = documentRef.createElement('span');
            count.className = 'm-chip-count';
            button.append(text, count);
            quickRow.append(button);
            quickButtons.set(key, { button, count });
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
        screen.append(searchRow, meta, quickRow, warning, listTarget);
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
        quickRow.addEventListener('click', onQuick);
        listTarget.addEventListener('click', onListClick);
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
        quickRow?.removeEventListener('click', onQuick);
        listTarget?.removeEventListener('click', onListClick);
        retryButton?.removeEventListener('click', onRetry);
        createButton?.removeEventListener('click', onCreate);
        sheet?.destroy();
        sheet = null;
        releasePortraits();
        container.replaceChildren();
        search = null;
        filterButton = null;
        filterCount = null;
        resultCount = null;
        quickRow = null;
        quickButtons.clear();
        warning = null;
        warningText = null;
        retryButton = null;
        listTarget = null;
        createButton = null;
        currentModel = null;
        lastSignature = null;
        focusPending = false;
    };
    // Retour depuis une fiche : le focus revient sur la carte ouverte si elle est encore affichée.
    // L'identifiant n'est consommé qu'une fois la carte trouvée : une liste encore en chargement
    // ou hors ligne le garde pour rendre le focus à l'arrivée des données (voir renderList).
    const focusTarget = () => {
        const link = mounted && _lastOpenedId ? cardLinks.get(_lastOpenedId) : null;
        if (!link) {
            focusPending = mounted && _lastOpenedId !== null;
            return null;
        }
        _lastOpenedId = null;
        return link;
    };
    return Object.freeze({ mount, unmount, focusTarget });
}

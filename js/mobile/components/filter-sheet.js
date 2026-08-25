import { createDialogController } from '../ui.js';

function cleanSelection(values, allowed) {
    const allowedValues = new Set(Array.isArray(allowed) ? allowed : []);
    return [...new Set((Array.isArray(values) ? values : [])
        .filter(value => typeof value === 'string' && allowedValues.has(value)))];
}

function selectionFor(dimensions, facets, filters) {
    return Object.fromEntries(dimensions.map(({ key }) => [key,
        cleanSelection(filters?.[key], facets?.[key])]));
}

export function createFilterSheet({
    documentRef = globalThis.document,
    dimensions = [],
    title = 'Filtres',
    onApply = () => {},
} = {}) {
    if (!documentRef?.createElement || !Array.isArray(dimensions)) throw new TypeError('document et dimensions requis');
    const dialog = documentRef.createElement('dialog');
    dialog.className = 'm-dialog m-filter-sheet';
    dialog.setAttribute('aria-labelledby', 'm-filter-sheet-title');
    const card = documentRef.createElement('div');
    card.className = 'm-dialog-card';
    const headingRow = documentRef.createElement('div');
    headingRow.className = 'm-dialog-heading';
    const heading = documentRef.createElement('h2');
    heading.id = 'm-filter-sheet-title';
    heading.textContent = title;
    const closeButton = documentRef.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'm-icon-button';
    closeButton.setAttribute('aria-label', 'Fermer les filtres');
    closeButton.textContent = '×';
    headingRow.append(heading, closeButton);
    const form = documentRef.createElement('form');
    form.className = 'm-filter-form';
    const actions = documentRef.createElement('div');
    actions.className = 'm-filter-actions';
    const clearButton = documentRef.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'm-button';
    clearButton.textContent = 'Tout effacer';
    const applyButton = documentRef.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'm-button m-button-primary';
    applyButton.textContent = 'Appliquer';
    actions.append(clearButton, applyButton);
    card.append(headingRow, form, actions);
    dialog.append(card);
    const controller = createDialogController({ dialog, documentRef });
    let facets = {};
    let draft = {};
    let mounted = false;

    const render = () => {
        const active = documentRef.activeElement;
        const focusKey = active?.dataset?.filterKey;
        const focusValue = active?.value;
        const fragment = documentRef.createDocumentFragment();
        for (const dimension of dimensions) {
            const fieldset = documentRef.createElement('fieldset');
            fieldset.className = 'm-filter-group';
            const legend = documentRef.createElement('legend');
            legend.textContent = dimension.label;
            fieldset.append(legend);
            const values = Array.isArray(facets[dimension.key]) ? facets[dimension.key] : [];
            if (!values.length) {
                const empty = documentRef.createElement('p');
                empty.textContent = 'Aucune option disponible.';
                fieldset.append(empty);
            }
            for (const value of values) {
                const label = documentRef.createElement('label');
                label.className = 'm-filter-option';
                const input = documentRef.createElement('input');
                input.type = 'checkbox';
                input.dataset.filterKey = dimension.key;
                input.value = value;
                input.checked = draft[dimension.key]?.includes(value) === true;
                const text = documentRef.createElement('span');
                text.textContent = value;
                label.append(input, text);
                fieldset.append(label);
            }
            fragment.append(fieldset);
        }
        form.replaceChildren(fragment);
        if (focusKey && focusValue) {
            [...form.querySelectorAll('input')]
                .find(input => input.dataset.filterKey === focusKey && input.value === focusValue)?.focus?.();
        }
    };
    const onChange = event => {
        const input = event.target;
        const key = input?.dataset?.filterKey;
        if (!key || !Object.hasOwn(draft, key)) return;
        const values = new Set(draft[key]);
        if (input.checked) values.add(input.value); else values.delete(input.value);
        draft = { ...draft, [key]: [...values] };
    };
    const close = () => controller.close();
    const clear = () => {
        draft = Object.fromEntries(dimensions.map(({ key }) => [key, []]));
        render();
    };
    const apply = () => { onApply(selectionFor(dimensions, facets, draft)); close(); };
    const onCancel = event => { event.preventDefault(); close(); };
    const onBackdrop = event => { if (event.target === dialog) close(); };

    const mount = parent => {
        if (mounted || !parent?.append) return;
        mounted = true;
        parent.append(dialog);
        form.addEventListener('change', onChange);
        closeButton.addEventListener('click', close);
        clearButton.addEventListener('click', clear);
        applyButton.addEventListener('click', apply);
        dialog.addEventListener('cancel', onCancel);
        dialog.addEventListener('click', onBackdrop);
    };
    const open = ({ nextFacets = {}, filters = {}, trigger = null } = {}) => {
        facets = nextFacets;
        draft = selectionFor(dimensions, facets, filters);
        render();
        controller.show(trigger);
    };
    const update = ({ nextFacets = facets, filters = draft } = {}) => {
        facets = nextFacets;
        draft = selectionFor(dimensions, facets, filters);
        if (controller.isOpen()) render();
    };
    const destroy = () => {
        if (!mounted) return;
        close();
        mounted = false;
        form.removeEventListener('change', onChange);
        closeButton.removeEventListener('click', close);
        clearButton.removeEventListener('click', clear);
        applyButton.removeEventListener('click', apply);
        dialog.removeEventListener('cancel', onCancel);
        dialog.removeEventListener('click', onBackdrop);
        dialog.remove();
    };
    return Object.freeze({ mount, open, update, close, destroy, isOpen: controller.isOpen });
}

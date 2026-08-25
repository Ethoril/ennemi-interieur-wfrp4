function fold(value) {
    return typeof value === 'string'
        ? value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim()
        : '';
}

function publicStatus(item) {
    return item?.visibleJoueurs === true && item?.suppressionEnCours !== true
        ? 'Public' : 'Masqué';
}

export function createPnjPicker({
    documentRef = globalThis.document,
    getRepository = () => null,
    initial = [],
    onChange = () => {},
} = {}) {
    let mounted = false;
    let values = [...new Set(Array.isArray(initial)
        ? initial.filter(value => typeof value === 'string') : [])];
    let items = [];
    let unsubscribe = () => {};
    let search = null;
    let panel = null;
    let list = null;
    let openButton = null;
    let closeButton = null;
    let disabled = false;
    let restoreFocus = null;
    let previousOverflow = null;
    let ownsScrollLock = false;
    let isOpen = false;
    let errorMessage = '';
    const idPattern = /^[A-Za-z0-9_-]{1,150}$/u;

    const render = () => {
        if (!list) return;
        list.replaceChildren();
        const needle = fold(search?.value);
        const visibleItems = items.filter(item => !needle || fold(item.nom).includes(needle));
        visibleItems.forEach(item => {
            const label = documentRef.createElement('label');
            label.className = 'm-pnj-picker-option';
            const input = documentRef.createElement('input');
            input.type = 'checkbox';
            input.value = item.id;
            input.checked = values.includes(item.id);
            input.disabled = disabled;
            input.addEventListener('change', () => {
                if (disabled) return;
                values = input.checked
                    ? [...new Set([...values, item.id])].slice(0, 100)
                    : values.filter(id => id !== item.id);
                onChange([...values]);
            });
            const copy = documentRef.createElement('span');
            copy.textContent = `${item.nom} — ${publicStatus(item)}`;
            label.append(input, copy);
            list.append(label);
        });
        if (!list.children.length) {
            const empty = documentRef.createElement('p');
            empty.textContent = 'Aucun PNJ correspondant.';
            list.append(empty);
        }
        if (errorMessage) {
            const error = documentRef.createElement('p');
            error.className = 'm-form-error';
            error.setAttribute('role', 'alert');
            error.textContent = errorMessage;
            list.append(error);
        }
    };

    const onData = next => {
        items = (Array.isArray(next) ? next : [])
            .filter(item => typeof item?.id === 'string' && idPattern.test(item.id)
                && typeof item.nom === 'string' && item.nom.trim()
                && (!Array.isArray(item.issues) || item.issues.length === 0))
            .map(item => ({
                id: item.id,
                nom: item.nom.trim(),
                visibleJoueurs: item.visibleJoueurs === true,
                suppressionEnCours: item.suppressionEnCours === true,
            }));
        render();
    };

    const open = () => {
        if (!panel || !openButton || disabled || isOpen) return;
        isOpen = true;
        restoreFocus = documentRef.activeElement || openButton;
        panel.hidden = false;
        openButton.setAttribute('aria-expanded', 'true');
        const body = documentRef.body;
        const classes = String(body?.className || '').split(/\s+/u).filter(Boolean);
        ownsScrollLock = !classes.includes('m-scroll-locked');
        if (body && ownsScrollLock) body.className = [...classes, 'm-scroll-locked'].join(' ');
        previousOverflow = body?.style?.overflow ?? null;
        if (body?.style) body.style.overflow = 'hidden';
        search?.focus?.();
        render();
    };

    const close = () => {
        if (!panel || !openButton || !isOpen) return;
        isOpen = false;
        panel.hidden = true;
        openButton.setAttribute('aria-expanded', 'false');
        if (documentRef.body?.style) documentRef.body.style.overflow = previousOverflow ?? '';
        if (documentRef.body && ownsScrollLock) {
            documentRef.body.className = String(documentRef.body.className || '').split(/\s+/u)
                .filter(value => value && value !== 'm-scroll-locked').join(' ');
        }
        previousOverflow = null;
        ownsScrollLock = false;
        restoreFocus?.focus?.();
        restoreFocus = null;
    };

    const mount = parent => {
        if (mounted || !parent?.append) return;
        mounted = true;
        openButton = documentRef.createElement('button');
        openButton.type = 'button';
        openButton.className = 'm-button';
        openButton.textContent = 'Choisir les PNJs liés';
        openButton.setAttribute('aria-expanded', 'false');
        panel = documentRef.createElement('section');
        panel.className = 'm-pnj-picker-sheet';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'PNJs liés');
        const heading = documentRef.createElement('h3');
        heading.textContent = 'PNJs liés';
        search = documentRef.createElement('input');
        search.type = 'search';
        search.placeholder = 'Rechercher un PNJ';
        search.setAttribute('aria-label', 'Rechercher un PNJ');
        list = documentRef.createElement('div');
        list.className = 'm-pnj-picker-list';
        closeButton = documentRef.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'm-button';
        closeButton.textContent = 'Fermer';
        closeButton.addEventListener('click', close);
        panel.append(heading, search, list, closeButton);
        parent.append(openButton, panel);
        openButton.addEventListener('click', open);
        search.addEventListener('input', render);
        panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusables = [search, ...(list?.querySelectorAll?.('input') || []), closeButton]
                .filter(node => node && !node.disabled);
            const index = focusables.indexOf(documentRef.activeElement);
            if (!focusables.length) return;
            if (event.shiftKey && index <= 0) {
                event.preventDefault();
                focusables.at(-1).focus?.();
            } else if (!event.shiftKey && index === focusables.length - 1) {
                event.preventDefault();
                focusables[0].focus?.();
            }
        });
        const repository = getRepository();
        if (typeof repository?.subscribeAll === 'function') {
            unsubscribe = repository.subscribeAll(onData, () => { errorMessage = 'Les PNJs ne sont pas disponibles.'; render(); });
        } else if (typeof repository?.subscribeVisible === 'function') {
            unsubscribe = repository.subscribeVisible(onData, () => { errorMessage = 'Les PNJs ne sont pas disponibles.'; render(); });
        }
        render();
    };

    const setValues = next => {
        values = [...new Set(Array.isArray(next)
            ? next.filter(value => typeof value === 'string' && idPattern.test(value)).slice(0, 100) : [])];
        render();
    };

    const setDisabled = value => {
        disabled = value === true;
        if (openButton) openButton.disabled = disabled;
        if (search) search.disabled = disabled;
        if (closeButton) closeButton.disabled = false;
        render();
    };

    const destroy = () => {
        if (!mounted) return;
        close();
        mounted = false;
        unsubscribe();
        unsubscribe = () => {};
        openButton?.remove?.();
        panel?.remove?.();
        panel = null;
        search = null;
        list = null;
        openButton = null;
        closeButton = null;
        isOpen = false;
    };

    const getPublicCount = () => values.filter(id => items.some(item => item.id === id
        && item.visibleJoueurs === true && item.suppressionEnCours !== true)).length;

    return Object.freeze({
        mount,
        destroy,
        setValues,
        setDisabled,
        getValues: () => [...values],
        getPublicCount,
        isOpen: () => isOpen,
        open,
        close,
    });
}

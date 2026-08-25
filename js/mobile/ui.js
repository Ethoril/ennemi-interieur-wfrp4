export function announce(element, message) {
    if (!element) return;
    element.textContent = String(message ?? '');
}

function resourceErrorKinds(state) {
    return Object.values(state?.resources || {})
        .map(resource => resource?.error?.kind)
        .filter(kind => typeof kind === 'string');
}

function serverDate(value) {
    if (!Number.isFinite(value)) return '';
    try {
        return new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(new Date(value));
    } catch {
        return '';
    }
}

export function publicStatusKind(state) {
    const errors = resourceErrorKinds(state);
    if (state?.error || errors.length || state?.connection?.phase === 'error') return 'error';
    if (state?.connection?.phase === 'offline-empty' || state?.connection?.phase === 'offline-cache') return 'offline';
    if (state?.connection?.phase === 'syncing' || state?.connection?.phase === 'loading') return 'syncing';
    return state?.connection?.sync === 'server' ? 'server' : 'idle';
}

export function publicStatusMessage(state) {
    const resourceErrors = resourceErrorKinds(state);
    if (state?.error?.kind === 'permission' || resourceErrors.includes('permission')) return 'Accès public refusé. Réessayez plus tard.';
    if (state?.connection?.phase === 'offline-empty') return 'Hors connexion : une première connexion est nécessaire pour charger les données.';
    if (state?.connection?.phase === 'offline-cache') {
        const date = serverDate(state?.connection?.lastServerAt);
        return date ? `Hors connexion — données enregistrées du ${date}.` : 'Hors connexion — données enregistrées.';
    }
    if (state?.error || state?.connection?.phase === 'error' || resourceErrors.length) return 'Une ressource ne répond pas. Réessayez.';
    if (state?.connection?.phase === 'loading') return 'Chargement des données publiques…';
    if (state?.connection?.sync === 'cache') return 'Données enregistrées — synchronisation en attente.';
    if (state?.connection?.sync === 'pending') return 'Synchronisation en cours…';
    if (state?.connection?.phase === 'syncing') return 'Synchronisation en cours…';
    if (state?.cache?.fallback) return 'Cache local limité — les données restent accessibles en ligne.';
    if (state?.connection?.sync === 'server') return 'Synchronisé avec le serveur.';
    return '';
}

export function renderState(container, { state = 'loading', title = '', message = '', actionLabel = '', onAction = null } = {}) {
    if (!container) return null;
    container.replaceChildren();
    const card = container.ownerDocument.createElement('section');
    card.className = 'm-state-card';
    card.dataset.state = state;
    card.setAttribute('role', state === 'error' ? 'alert' : 'status');
    if (title) {
        const heading = container.ownerDocument.createElement('h2');
        heading.textContent = title;
        card.append(heading);
    }
    if (message) {
        const text = container.ownerDocument.createElement('p');
        text.textContent = message;
        card.append(text);
    }
    if (actionLabel && typeof onAction === 'function') {
        const action = container.ownerDocument.createElement('button');
        action.type = 'button';
        action.className = 'm-button m-button-primary';
        action.textContent = actionLabel;
        action.addEventListener('click', onAction);
        card.append(action);
    }
    container.append(card);
    return card;
}

export function focusableElements(root) {
    if (!root?.querySelectorAll) return [];
    return [...root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
}

export function createDialogController({ dialog, documentRef = globalThis.document } = {}) {
    if (!dialog) throw new TypeError('dialog requis');
    let previousFocus = null;
    let open = false;
    const onKeydown = event => {
        if (!open) return;
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key !== 'Tab') return;
        const elements = focusableElements(dialog);
        if (!elements.length) return;
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && documentRef.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && documentRef.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const close = () => {
        if (!open) return;
        open = false;
        documentRef.removeEventListener?.('keydown', onKeydown);
        documentRef.body?.classList.remove('m-scroll-locked');
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        else dialog.removeAttribute('open');
        previousFocus?.focus?.();
        previousFocus = null;
    };
    const show = trigger => {
        if (open) return;
        previousFocus = trigger || documentRef.activeElement;
        open = true;
        documentRef.body?.classList.add('m-scroll-locked');
        documentRef.addEventListener?.('keydown', onKeydown);
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
        focusableElements(dialog)[0]?.focus?.();
    };
    return Object.freeze({ show, close, isOpen: () => open });
}

const CHARACTER_LABELS = Object.freeze({
    bhelgi: 'Bhelgi', caelel: 'Caelel', elysia: 'Elysia', hellaya: 'Hellaya', wren: 'Wren', test: 'Fiche de recette',
});
const ALLOWED_CHARACTER_IDS = new Set(Object.keys(CHARACTER_LABELS));

function make(documentRef, tag, text = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    return node;
}

/** Picker mobile. L'accès est décidé par le callable getCampaignCapabilities; aucune liste d'emails ne transite au client. */
export function createFicheAccessView({
    container, documentRef = container?.ownerDocument, getClient, signIn, onOpenFiche, announce = () => {},
} = {}) {
    if (!container || !documentRef || typeof getClient !== 'function' || typeof onOpenFiche !== 'function') {
        throw new TypeError('container, document, client et navigation fiche requis');
    }
    let mounted = false;
    let unsubscribe = null;
    let abortSignal = null;
    let connectionGeneration = 0;
    let state = { loading: true, user: null, capabilities: null, error: false };

    const render = () => {
        if (!mounted) return;
        container.replaceChildren();
        const section = make(documentRef, 'section');
        section.className = 'm-screen m-fiche-access';
        const heading = make(documentRef, 'h2', 'Mes fiches');
        heading.tabIndex = -1;
        section.append(heading);

        const status = make(documentRef, 'p');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        if (state.loading) {
            status.textContent = 'Vérification des accès fiche…';
            section.append(status);
        } else if (state.error) {
            status.textContent = 'Impossible de vérifier les accès. Réessayez lorsque la connexion sera disponible.';
            section.append(status);
            const retry = make(documentRef, 'button', 'Réessayer');
            retry.type = 'button';
            retry.className = 'm-button';
            retry.addEventListener('click', () => { void connect(); });
            section.append(retry);
        } else if (!state.user) {
            status.textContent = 'Connectez-vous avec le compte Google qui a accès à votre fiche.';
            section.append(status);
            const login = make(documentRef, 'button', 'Connexion Google');
            login.type = 'button';
            login.className = 'm-button m-button-primary';
            login.addEventListener('click', async () => {
                login.disabled = true;
                try { await signIn?.(); }
                catch { announce('Connexion impossible. Réessayez.'); }
                finally { login.disabled = false; }
            });
            section.append(login);
        } else {
            const role = state.capabilities?.role;
            const ids = [...new Set((state.capabilities?.characterIds || [])
                .filter(id => typeof id === 'string' && ALLOWED_CHARACTER_IDS.has(id)
                    && (id !== 'test' || role === 'mj')))];
            status.textContent = role === 'mj'
                ? 'Accès Maître du Jeu — toutes les fiches autorisées sont disponibles.'
                : 'Fiches autorisées pour ce compte.';
            section.append(status);
            if (!ids.length) {
                const empty = make(documentRef, 'p', 'Aucune fiche n’est autorisée pour ce compte.');
                section.append(empty);
            } else {
                const list = make(documentRef, 'div');
                list.className = 'm-fiche-list';
                for (const id of ids) {
                    const button = make(documentRef, 'button', CHARACTER_LABELS[id]);
                    button.type = 'button';
                    button.className = 'm-button m-button-primary m-fiche-open';
                    button.dataset.charId = id;
                    button.setAttribute('aria-label', `Ouvrir la fiche de ${CHARACTER_LABELS[id]}`);
                    button.addEventListener('click', () => onOpenFiche(id));
                    list.append(button);
                }
                section.append(list);
            }
        }
        container.append(section);
    };

    const connect = async () => {
        const generation = ++connectionGeneration;
        const isCurrent = () => mounted && !abortSignal?.aborted && generation === connectionGeneration;
        unsubscribe?.();
        unsubscribe = null;
        state = { loading: true, user: null, capabilities: null, error: false };
        render();
        try {
            const client = await getClient();
            if (!isCurrent()) return;
            if (!client || typeof client.watch !== 'function') throw new Error('Session fiche indisponible');
            const stop = client.watch(value => {
                if (!isCurrent()) return;
                state = {
                    loading: false,
                    user: value?.user || null,
                    capabilities: value?.capabilities || { role: 'public', characterIds: [] },
                    error: false,
                };
                render();
            }, () => {
                if (!isCurrent()) return;
                state = { loading: false, user: null, capabilities: null, error: true };
                render();
            });
            if (isCurrent()) unsubscribe = stop;
            else stop?.();
        } catch {
            if (!isCurrent()) return;
            state = { loading: false, user: null, capabilities: null, error: true };
            render();
        }
    };

    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        connectionGeneration += 1;
        unsubscribe?.();
        unsubscribe = null;
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
            render();
            void connect();
        },
        unmount,
        focusTarget() { return container.querySelector?.('h2') || null; },
    });
}

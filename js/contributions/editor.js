const FIELDS = Object.freeze({
    pnj: [
        ['nom', 'Nom', 'text', 200], ['statut', 'Statut', 'text', 64], ['vivant', 'État vital', 'text', 32],
        ['lieu', 'Lieu', 'text', 200], ['groupes', 'Groupes (un par ligne)', 'lines', 20], ['description', 'Description publique', 'textarea', 20000],
        ['visibleJoueurs', 'Visible par les joueurs', 'checkbox', 0],
        ['imagePath', 'Remplacer le portrait (JPEG, PNG, WebP, GIF ou AVIF · 2 Mio max)', 'file', 2 * 1024 * 1024],
    ],
    indice: [
        ['titre', 'Titre', 'text', 200], ['description', 'Description publique', 'textarea', 30000],
        ['source', 'Source', 'text', 150], ['type', 'Type', 'text', 100], ['dateDecouverte', 'Date de découverte', 'date', 10],
        ['pnjsLies', 'PNJ liés', 'pnj-multi', 100], ['decouvert', 'Découvert par les joueurs', 'checkbox', 0],
        ['imagePath', 'Remplacer l’illustration (JPEG, PNG, WebP, GIF ou AVIF · 5 Mio max)', 'file', 5 * 1024 * 1024],
    ],
    relation: [
        ['source', 'PNJ source', 'pnj-select', 0], ['cible', 'PNJ cible', 'pnj-select', 0],
        ['type', 'Type de relation', 'text', 100], ['label', 'Libellé', 'text', 300], ['color', 'Couleur', 'color', 0],
        ['style', 'Trait', 'style-select', 0], ['visibleJoueurs', 'Visible par les joueurs', 'checkbox', 0],
        ['pair', 'Créer aussi la relation réciproque', 'checkbox', 0],
    ],
});

function operationId(documentRef) {
    const value = documentRef.defaultView?.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 128);
}
function safeId(documentRef) {
    const value = documentRef.defaultView?.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    return value.replace(/-/gu, '').replace(/[^A-Za-z0-9_]/gu, '').slice(0, 150);
}
function text(documentRef, tag, value, className = '') {
    const element = documentRef.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
}
function publicValues(kind, data = {}) {
    return Object.fromEntries(FIELDS[kind].map(([field, , type]) => [field,
        type === 'file' ? null
            : type === 'checkbox' ? (field === 'pair' ? false : data[field] === true)
            : type === 'pnj-multi' ? (Array.isArray(data[field]) ? data[field] : [])
            : type === 'style-select' ? (data[field] === 'dashed' ? 'dashed' : 'solid')
            : type === 'color' ? (typeof data[field] === 'string' && /^#[0-9a-f]{6}$/iu.test(data[field]) ? data[field] : '#000000')
                : type === 'date' ? (data[field] instanceof Date ? data[field].toISOString().slice(0, 10)
                    : typeof data[field] === 'string' ? data[field].slice(0, 10) : '')
                    : (data[field] ?? ''),
    ]));
}
function parseField(type, value) {
    if (type === 'lines') return value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
    return value;
}

function contentActionLabel(kind, action) {
    const labels = {
        pnj: { create: 'Créer un PNJ', update: 'Modifier le PNJ' },
        indice: { create: 'Créer un indice', update: 'Modifier l’indice' },
        relation: { create: 'Créer une relation', update: 'Modifier la relation' },
    };
    return labels[kind][action];
}

function selectedValues(control) {
    return [...(control.selectedOptions || [])].map(option => option.value);
}

function setSelectedValues(control, values) {
    const selected = new Set(Array.isArray(values) ? values : [values]);
    for (const option of control.children || []) option.selected = selected.has(option.value);
    if (!control.multiple) control.value = selected.values().next().value || '';
}

function populatePnjChoices(control, choices, { multiple = false, selected = [] } = {}) {
    control.replaceChildren();
    if (!multiple) {
        const prompt = control.ownerDocument.createElement('option');
        prompt.value = '';
        prompt.textContent = 'Choisir un PNJ';
        prompt.disabled = true;
        prompt.selected = true;
        control.append(prompt);
    }
    const ids = new Set();
    for (const item of choices) {
        if (typeof item?.id !== 'string' || !item.id || typeof item.nom !== 'string' || !item.nom || ids.has(item.id)) continue;
        ids.add(item.id);
        const option = control.ownerDocument.createElement('option');
        option.value = item.id;
        option.textContent = item.nom;
        control.append(option);
    }
    for (const id of selected) {
        if (typeof id !== 'string' || !id || ids.has(id)) continue;
        const option = control.ownerDocument.createElement('option');
        option.value = id;
        option.textContent = 'PNJ actuel indisponible';
        option.selected = true;
        control.append(option);
    }
}

export function mountContributionButton({ container, client = null, getClient = null, signIn = null, kind, id = null, action = 'update', documentRef = container?.ownerDocument,
    announce = () => {}, onSaved = () => {} } = {}) {
    if (!container || (!client?.watch && typeof getClient !== 'function') || !FIELDS[kind] || !documentRef || !['create', 'update'].includes(action)
        || (action === 'update' && typeof id !== 'string')) throw new TypeError('conteneur, client et contenu requis');
    const button = text(documentRef, 'button', contentActionLabel(kind, action), 'm-button m-detail-edit');
    button.type = 'button';
    button.hidden = true;
    container.append(button);
    const launchStatus = text(documentRef, 'p', '', 'contribution-launch-status');
    launchStatus.setAttribute('role', 'alert');
    launchStatus.setAttribute('aria-live', 'polite');
    launchStatus.hidden = true;
    container.append(launchStatus);
    const dialog = documentRef.createElement('dialog');
    dialog.className = 'contribution-dialog';
    dialog.setAttribute('aria-labelledby', `contribution-title-${kind}-${id || 'new'}`);
    const form = documentRef.createElement('form');
    form.method = 'dialog';
    const heading = text(documentRef, 'h2', contentActionLabel(kind, action));
    heading.id = `contribution-title-${kind}-${id || 'new'}`;
    const status = text(documentRef, 'p', '', 'contribution-status');
    status.setAttribute('role', 'status');
    const fields = new Map();
    for (const [name, labelText, type, maximum] of FIELDS[kind]) {
        const label = documentRef.createElement('label');
        label.append(documentRef.createTextNode(`${labelText} `));
        const control = documentRef.createElement(type === 'textarea' ? 'textarea'
            : ['pnj-select', 'pnj-multi', 'style-select'].includes(type) ? 'select' : 'input');
        if (!['textarea', 'pnj-select', 'pnj-multi', 'style-select'].includes(type)) control.type = type === 'date' ? 'date'
            : type === 'file' ? 'file' : type === 'checkbox' ? 'checkbox' : type === 'color' ? 'color' : 'text';
        if (type === 'pnj-multi') control.multiple = true;
        if (type === 'pnj-multi') control.size = 6;
        if (type === 'pnj-select') control.required = true;
        if (type === 'style-select') {
            for (const [value, labelText] of [['solid', 'Plein'], ['dashed', 'Pointillé']]) {
                const option = documentRef.createElement('option');
                option.value = value;
                option.textContent = labelText;
                control.append(option);
            }
        }
        control.maxLength = type === 'lines' ? 6000 : maximum;
        control.dataset.field = name;
        control.autocomplete = 'off';
        if (type === 'textarea') control.rows = name === 'description' ? 8 : 3;
        label.append(control);
        if (name === 'pair') label.hidden = action === 'update';
        form.append(label);
        fields.set(name, { control, type });
    }
    const actions = documentRef.createElement('div');
    actions.className = 'contribution-actions';
    const save = text(documentRef, 'button', 'Enregistrer', 'm-button m-button-primary');
    save.type = 'submit';
    const history = text(documentRef, 'button', 'Historique', 'm-button');
    history.type = 'button';
    const remove = text(documentRef, 'button', 'Mettre en corbeille', 'm-button m-button-danger');
    remove.type = 'button';
    remove.hidden = action === 'create';
    const close = text(documentRef, 'button', 'Fermer', 'm-button');
    close.type = 'button';
    actions.append(save, history, remove, close);
    form.prepend(heading);
    form.append(status, actions);
    dialog.append(form);
    documentRef.body.append(dialog);

    let session = { user: null, capabilities: { role: 'public', contribution: false } };
    let clientRef = client;
    let loadingClient = null;
    let stopWatching = () => {};
    let context = null;
    let inFlight = false;
    let activeOperationId = null;
    let activeOperationPayload = null;
    let activeContentId = id;
    let activeImageOperationId = null;
    let active = true;
    let busyState = null;
    const setFormBusy = busy => {
        const controls = [...fields.values()].map(entry => entry.control).concat([save, history, remove, close]);
        if (busy) {
            if (busyState) return;
            busyState = controls.map(control => [control, control.disabled]);
            controls.forEach(control => { control.disabled = true; });
        } else if (busyState) {
            busyState.forEach(([control, wasDisabled]) => { control.disabled = wasDisabled; });
            busyState = null;
        }
    };
    const setStatus = value => {
        status.textContent = value;
        if (dialog.open) {
            launchStatus.textContent = '';
            launchStatus.hidden = true;
        } else {
            launchStatus.textContent = value;
            launchStatus.hidden = !value;
        }
    };
    const subscribe = value => {
        session = value;
        for (const [field, entry] of fields) {
            if (field === 'visibleJoueurs' || field === 'decouvert') {
                entry.control.closest('label').hidden = value.capabilities.role !== 'mj' || action === 'create';
            }
        }
        button.hidden = false;
        button.disabled = false;
        button.textContent = !value.user ? 'Se connecter pour contribuer'
            : value.capabilities.contribution ? contentActionLabel(kind, action) : 'Contribution indisponible';
        button.title = value.capabilities.contribution ? '' : value.user ? 'Ce compte ne figure pas dans les accès de contribution.' : '';
    };
    const ensureClient = async () => {
        if (clientRef) return clientRef;
        loadingClient ||= Promise.resolve().then(() => getClient()).then(value => {
            if (!value?.watch || !active) throw new Error('callable unavailable');
            clientRef = value;
            stopWatching = clientRef.watch(subscribe, () => {
                if (active) { button.hidden = false; button.disabled = false; button.textContent = 'Contribuer (connexion requise)'; }
            });
            return clientRef;
        });
        return loadingClient;
    };
    if (clientRef) stopWatching = clientRef.watch(subscribe, () => {
        if (active) { button.hidden = false; button.disabled = false; button.textContent = 'Contribuer (connexion requise)'; }
    });
    else void ensureClient().catch(() => {
        if (active) { button.hidden = false; button.textContent = 'Connexion pour contribuer'; }
    });

    const showHistory = async () => {
        if (!context?.canEdit) return;
        history.disabled = true;
        try {
            const page = await clientRef.getContentHistory({ kind, id, limit: 20 });
            const summary = (page?.events || page?.items || []).map(item => `Révision ${item.revision} · ${item.actor === 'self' ? 'vous' : item.role === 'mj' ? 'MJ' : 'contributeur'}`).join('\n');
            setStatus(summary || 'Aucun historique disponible.');
        } catch { setStatus('Historique momentanément indisponible.'); }
        finally { history.disabled = false; }
    };

    const open = async () => {
        try { await ensureClient(); }
        catch { setStatus('Service de contribution momentanément indisponible.'); return; }
        const currentUser = clientRef.currentUser?.();
        launchStatus.hidden = true;
        launchStatus.textContent = '';
        if (currentUser) {
            try {
                const capabilities = await clientRef.getCampaignCapabilities();
                session = {
                    user: { uid: currentUser.uid, displayName: currentUser.displayName || '', emailVerified: currentUser.emailVerified === true },
                    capabilities: {
                        role: ['mj', 'joueur'].includes(capabilities?.role) ? capabilities.role : 'public',
                        contribution: capabilities?.contribution === true,
                        characterIds: Array.isArray(capabilities?.characterIds) ? capabilities.characterIds : [],
                    },
                };
            } catch { setStatus('Vérification du compte impossible.'); return; }
        }
        if (!session.user) {
            try { await signIn?.(); } catch (error) { if (error?.code !== 'auth/popup-closed-by-user') setStatus('Connexion impossible.'); }
            return;
        }
        if (!session.capabilities.contribution) { setStatus('Ce compte ne dispose pas de l’accès de contribution.'); return; }
        button.disabled = true;
        setStatus('Chargement du contenu public…');
        try {
            context = action === 'create' ? { kind, id: null, data: {}, revision: 0, canEdit: true }
                : await clientRef.getContentEditContext({ kind, id });
            if (!context?.canEdit) throw new Error('access');
            let pnjChoices = null;
            if (FIELDS[kind].some(([, , type]) => type === 'pnj-select' || type === 'pnj-multi')) {
                if (typeof clientRef.getContentPnjChoices !== 'function') throw new Error('choices unavailable');
                const result = await clientRef.getContentPnjChoices();
                if (!Array.isArray(result?.pnjs)) throw new Error('choices unavailable');
                pnjChoices = result.pnjs;
            }
            const values = publicValues(kind, context.data);
            for (const [field, entry] of fields) {
                if (entry.type === 'pnj-select' || entry.type === 'pnj-multi') {
                    const selected = entry.type === 'pnj-multi' ? values[field] : [values[field]];
                    populatePnjChoices(entry.control, pnjChoices || [], { multiple: entry.type === 'pnj-multi', selected });
                    setSelectedValues(entry.control, selected);
                } else if (entry.type === 'checkbox') entry.control.checked = values[field] === true;
                else if (entry.type !== 'file') entry.control.value = values[field] ?? '';
            }
            activeOperationId = null;
            activeOperationPayload = null;
            activeContentId = id;
            save.disabled = false;
            history.hidden = action === 'create';
            remove.hidden = action === 'create' || context.canDelete !== true;
            setStatus(action === 'create' ? 'La création sera publiée dès l’enregistrement.'
                : `Révision ${context.revision} · seules les données publiques sont modifiables ici.`);
            dialog.showModal();
        } catch { setStatus('Ce contenu public est indisponible pour modification.'); }
        finally { button.disabled = false; }
    };

    button.addEventListener('click', open);
    close.addEventListener('click', () => dialog.close());
    history.addEventListener('click', showHistory);
    const removeContent = async () => {
        if (action !== 'update' || !context?.canDelete || !session.capabilities.contribution) return;
        if (!documentRef.defaultView?.confirm?.('Mettre ce contenu dans la corbeille ? Il pourra être restauré selon les droits du propriétaire et du MJ.')) return;
        remove.disabled = true;
        setStatus('Mise en corbeille…');
        try {
            await clientRef.trashPublicContent({ kind, id, operationId: operationId(documentRef), baseRevision: context.revision });
            setStatus('Contenu mis en corbeille.');
            dialog.close();
            announce('Contenu mis en corbeille.');
            onSaved({ kind, id, state: 'trashed' });
        } catch (error) {
            const code = error?.code || error?.details?.code;
            setStatus(code?.includes('aborted') ? 'Le contenu a changé depuis son ouverture. Rechargez-le avant de recommencer.'
                : code?.includes('permission') ? 'L’accès de suppression a été retiré.'
                    : 'La mise en corbeille a échoué. Réessayez.');
        } finally { remove.disabled = false; }
    };
    remove.addEventListener('click', removeContent);
    for (const entry of fields.values()) if (entry.type === 'file') {
        entry.control.addEventListener('change', () => { activeImageOperationId = null; activeOperationId = null; activeOperationPayload = null; });
    }
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (inFlight || !context || !session.capabilities.contribution) return;
        const changes = {};
        const baseValues = {};
        for (const [field, entry] of fields) {
            if (entry.type === 'file' || field === 'pair') continue;
            if (entry.type === 'checkbox') {
                const value = entry.control.checked;
                const before = publicValues(kind, context.data)[field];
                if (JSON.stringify(value) !== JSON.stringify(before)) {
                    changes[field] = value;
                    if (action === 'update') baseValues[field] = before;
                }
                continue;
            }
            const value = (field === 'dateDecouverte' && entry.control.value === '')
                ? null : entry.type === 'pnj-multi' ? selectedValues(entry.control) : parseField(entry.type, entry.control.value);
            const before = publicValues(kind, context.data)[field];
            const normalizedBefore = entry.type === 'lines' ? parseField(entry.type, before) : before;
            if (action === 'create' || JSON.stringify(value) !== JSON.stringify(normalizedBefore)) {
                changes[field] = value;
                if (action === 'update') baseValues[field] = field === 'dateDecouverte'
                    ? (context.data[field] ?? null) : normalizedBefore;
            }
        }
        const imageEntry = fields.get('imagePath');
        const imageFile = imageEntry?.control.files?.[0] || null;
        const pairWanted = fields.get('pair')?.control.checked === true;
        if (!Object.keys(changes).length && !imageFile) { setStatus('Aucune modification à enregistrer.'); return; }
        inFlight = true;
        setFormBusy(true);
        setStatus('Enregistrement…');
        if (action === 'create' && kind !== 'relation') activeContentId ||= safeId(documentRef);
        if (imageFile) {
            try {
                if (imageFile.size > FIELDS[kind].find(([field]) => field === 'imagePath')[3]) throw new Error('too-large');
                activeImageOperationId ||= operationId(documentRef);
                const bytes = new Uint8Array(await imageFile.arrayBuffer());
                let binary = '';
                for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                const base64 = documentRef.defaultView?.btoa?.(binary) || globalThis.btoa(binary);
                const upload = await clientRef.uploadContributionImage({
                    kind: kind === 'pnj' ? 'portrait' : 'indice', ownerId: activeContentId || id,
                    operationId: activeImageOperationId, contentType: imageFile.type, base64,
                });
                changes.imagePath = upload.imagePath;
                baseValues.imagePath = context.data.imagePath ?? null;
            } catch {
                inFlight = false; setFormBusy(false);
                setStatus('L’image n’a pas été téléversée. Vérifiez son format et sa taille.');
                return;
            }
        }
        const command = {
            kind, action, ...(activeContentId ? { id: activeContentId } : {}), baseRevision: context.revision,
            ...(kind === 'relation' && action === 'create' ? { pair: pairWanted } : {}),
            ...(kind === 'relation' && action === 'update' && context.data.reciprocalId
                ? { reciprocalId: context.data.reciprocalId, reciprocalBaseRevision: context.data.reciprocalRevision } : {}),
            ...(action === 'update' ? { baseValues } : {}), changes,
        };
        const commandSignature = JSON.stringify(command);
        if (commandSignature !== activeOperationPayload) {
            activeOperationId = operationId(documentRef);
            activeOperationPayload = commandSignature;
        }
        try {
            const mutate = session.capabilities.role === 'mj' && action === 'update'
                ? clientRef.mutateMjContent : clientRef.mutatePublicContent;
            const result = await mutate({
                ...command, operationId: activeOperationId,
            });
            setStatus(`${action === 'create' ? 'Contenu créé et publié' : 'Modification enregistrée'} à la révision ${result.revision}.`);
            activeOperationId = null;
            activeOperationPayload = null;
            activeImageOperationId = null;
            dialog.close();
            announce(action === 'create' ? 'Contenu public créé et publié.' : 'Modification publique enregistrée.');
            onSaved(result);
        } catch (error) {
            const code = error?.code || error?.details?.code;
            setStatus(code?.includes('aborted') ? 'Le contenu a changé depuis son ouverture. Rechargez-le avant de recommencer.'
                : code?.includes('permission') ? 'L’accès de contribution a été retiré.'
                    : 'La modification n’a pas été enregistrée. Réessayez.');
        } finally { inFlight = false; setFormBusy(false); }
    });

    return Object.freeze({ button, dialog, dispose() {
        active = false;
        stopWatching();
        button.removeEventListener('click', open);
        history.removeEventListener('click', showHistory);
        remove.removeEventListener('click', removeContent);
        dialog.remove();
        button.remove();
        launchStatus.remove();
    } });
}

export function mountContentTrashPanel({ container, client = null, getClient = null, signIn = null, documentRef = container?.ownerDocument,
    announce = () => {} } = {}) {
    if (!container || (!client?.watch && typeof getClient !== 'function') || !documentRef) throw new TypeError('conteneur et client requis');
    const button = text(documentRef, 'button', 'Corbeille', 'm-button m-detail-edit');
    button.type = 'button';
    button.hidden = true;
    container.append(button);
    const dialog = documentRef.createElement('dialog');
    dialog.className = 'contribution-dialog contribution-trash-dialog';
    const heading = text(documentRef, 'h2', 'Corbeille des contributions');
    const status = text(documentRef, 'p', '', 'contribution-status');
    status.setAttribute('role', 'status');
    const list = documentRef.createElement('div');
    list.className = 'contribution-trash-list';
    const cleanupSection = documentRef.createElement('section');
    cleanupSection.className = 'contribution-cleanup-resume';
    const cleanupHeading = text(documentRef, 'h3', 'Nettoyages à reprendre');
    const cleanupList = documentRef.createElement('div');
    cleanupList.className = 'contribution-trash-list';
    cleanupSection.append(cleanupHeading, cleanupList);
    const close = text(documentRef, 'button', 'Fermer', 'm-button');
    close.type = 'button';
    dialog.append(heading, status, list, cleanupSection, close);
    documentRef.body.append(dialog);
    let clientRef = client;
    let stopWatching = () => {};
    let loadingClient = null;
    let session = { user: null, capabilities: { role: 'public', contribution: false } };
    let active = true;
    let cursor = null;
    let cleanupCursor = null;

    const notifySession = value => {
        session = value;
        button.hidden = !value.capabilities.contribution;
        button.textContent = value.capabilities.role === 'mj' ? 'Corbeille MJ' : 'Ma corbeille';
    };
    const ensureClient = async () => {
        if (clientRef) return clientRef;
        loadingClient ||= Promise.resolve().then(getClient).then(value => {
            if (!value?.watch || !active) throw new Error('callable unavailable');
            clientRef = value;
            stopWatching = clientRef.watch(notifySession, () => {});
            return clientRef;
        });
        return loadingClient;
    };
    if (clientRef) stopWatching = clientRef.watch(notifySession, () => {});

    const renderEntries = entries => {
        list.replaceChildren();
        if (!entries.length) {
            list.append(text(documentRef, 'p', 'La corbeille est vide.', 'contribution-trash-empty'));
            return;
        }
        for (const entry of entries) {
            const item = documentRef.createElement('article');
            item.className = 'contribution-trash-entry';
            const label = `${entry.kind === 'pnj' ? 'PNJ' : entry.kind === 'indice' ? 'Indice' : 'Relation'} · ${typeof entry.summary === 'string' ? entry.summary : 'Contenu archivé'}`;
            item.append(text(documentRef, 'h3', label));
            item.append(text(documentRef, 'p', `Révision ${entry.revision}${entry.canRestore ? ' · restauration autorisée' : ' · restauration MJ'}`, 'contribution-trash-meta'));
            const actions = documentRef.createElement('div');
            actions.className = 'contribution-actions';
            const canRestore = entry.canRestore === true || session.capabilities.role === 'mj';
            if (canRestore) {
                const restore = text(documentRef, 'button', 'Restaurer', 'm-button m-button-primary');
                restore.type = 'button';
                restore.addEventListener('click', async () => {
                    restore.disabled = true;
                    status.textContent = 'Restauration…';
                    try {
                        await clientRef.restorePublicContent({ kind: entry.kind, id: entry.id, operationId: operationId(documentRef), baseRevision: entry.revision });
                        announce('Contenu restauré.');
                        if (await loadPage(null, false)) status.textContent = 'Contenu restauré. La corbeille a été actualisée.';
                    } catch { status.textContent = 'Restauration impossible : le contenu ou ses dépendances ont changé.'; restore.disabled = false; }
                });
                actions.append(restore);
            }
            if (session.capabilities.role === 'mj') {
                const visibility = text(documentRef, 'button', entry.ownerCanRestore === false ? 'Autoriser la restauration joueur' : 'Masquer de la corbeille joueur', 'm-button');
                visibility.type = 'button';
                visibility.addEventListener('click', async () => {
                    visibility.disabled = true;
                    try {
                        await clientRef.setTrashVisibility({ kind: entry.kind, id: entry.id, operationId: operationId(documentRef), baseRevision: entry.revision, ownerCanRestore: entry.ownerCanRestore === false });
                        if (await loadPage(null, false)) status.textContent = 'Droits de restauration actualisés.';
                    } catch { status.textContent = 'Impossible de modifier les droits de restauration.'; visibility.disabled = false; }
                });
                actions.append(visibility);
                const purge = text(documentRef, 'button', 'Purger définitivement', 'm-button m-button-danger');
                purge.type = 'button';
                const purgeCommand = { kind: entry.kind, id: entry.id, operationId: operationId(documentRef), baseRevision: entry.revision };
                let purgeCommitted = false;
                purge.addEventListener('click', async () => {
                    if (!purgeCommitted && !documentRef.defaultView?.confirm?.('Purger définitivement ce contenu et ses archives ? Cette action ne peut pas être annulée.')) return;
                    purge.disabled = true;
                    try {
                        const result = await clientRef.purgePublicContent(purgeCommand);
                        purgeCommitted = true;
                        const cleanup = result?.cleanup || { status: 'not-tracked', deleted: 0, missing: 0, retained: 0, pending: 0 };
                        const completed = cleanup.status === 'complete' || cleanup.status === 'not-tracked';
                        if (!completed) {
                            purge.textContent = cleanup.status === 'pending' ? 'Reprendre le nettoyage des images' : 'Vérifier les images conservées';
                            purge.disabled = false;
                            actions.replaceChildren(purge);
                            status.textContent = cleanup.status === 'pending'
                                ? `Contenu purgé. Nettoyage image en attente : ${cleanup.pending || 0} image(s) à reprendre.`
                                : `Contenu purgé. ${cleanup.retained || 0} image(s) sont conservées par prudence ; réessayez la vérification après résolution des références.`;
                            return;
                        }
                        if (await loadPage(null, false)) status.textContent = `Contenu purgé. ${cleanup.deleted || 0} image(s) nettoyée(s).`;
                    } catch {
                        if (purgeCommitted) {
                            purge.textContent = 'Reprendre le nettoyage des images';
                            actions.replaceChildren(purge);
                            status.textContent = 'Contenu purgé. Le nettoyage image n’a pas répondu ; réessayez.';
                        } else status.textContent = 'La purge a échoué. Vérifiez les dépendances puis réessayez.';
                        purge.disabled = false;
                    }
                });
                actions.append(purge);
            }
            item.append(actions);
            list.append(item);
        }
    };
    const renderPendingCleanups = entries => {
        cleanupList.replaceChildren();
        cleanupSection.hidden = session.capabilities.role !== 'mj';
        if (cleanupSection.hidden) return;
        if (!entries.length) {
            cleanupList.append(text(documentRef, 'p', 'Aucun nettoyage à reprendre.', 'contribution-trash-empty'));
            return;
        }
        for (const entry of entries) {
            const item = documentRef.createElement('article');
            item.className = 'contribution-trash-entry';
            const kindLabel = entry.kind === 'pnj' ? 'PNJ' : entry.kind === 'indice' ? 'Indice' : 'Relation';
            item.append(text(documentRef, 'h4', `${kindLabel} · ${typeof entry.summary === 'string' ? entry.summary : 'Contenu purgé'}`));
            const cleanup = entry.cleanup || {};
            const remaining = Number.isSafeInteger(cleanup.retryable) ? cleanup.retryable : cleanup.pending;
            item.append(text(documentRef, 'p', `Contenu déjà purgé. ${Number.isSafeInteger(remaining) ? remaining : 0} image(s) restent à vérifier.`, 'contribution-trash-meta'));
            const retry = text(documentRef, 'button', 'Reprendre le nettoyage', 'm-button m-button-primary');
            retry.type = 'button';
            retry.addEventListener('click', async () => {
                retry.disabled = true;
                status.textContent = 'Vérification et nettoyage des images…';
                try {
                    const result = await clientRef.purgePublicContent({ kind: entry.kind, id: entry.id,
                        operationId: entry.operationId, baseRevision: entry.baseRevision });
                    const next = result?.cleanup || {};
                    await loadPage(null, false);
                    if (next.status === 'complete' || next.status === 'not-tracked') {
                        status.textContent = `Nettoyage terminé. ${next.deleted || 0} image(s) supprimée(s).`;
                    } else if ((next.retryable ?? next.pending ?? 0) === 0) {
                        status.textContent = `Vérification terminée. ${next.retained || 0} image(s) sont conservées par prudence.`;
                    } else {
                        status.textContent = `Nettoyage toujours en attente : ${next.retryable ?? next.pending} élément(s) à reprendre.`;
                    }
                } catch {
                    status.textContent = 'Nettoyage non terminé. Vous pourrez le reprendre depuis cette liste.';
                    retry.disabled = false;
                }
            });
            item.append(retry);
            cleanupList.append(item);
        }
    };
    const loadPage = async (nextCursor, append) => {
        if (!session.capabilities.contribution) return;
        status.textContent = 'Chargement de la corbeille…';
        try {
            const page = await clientRef.listContentTrash({ limit: 50, ...(nextCursor ? { cursor: nextCursor } : {}) });
            renderEntries([...(append ? currentEntries : []), ...(page.entries || [])]);
            if (!append && session.capabilities.role === 'mj' && typeof clientRef.listPendingPurgeCleanups === 'function') {
                try {
                    const pending = await clientRef.listPendingPurgeCleanups({ limit: 50,
                        ...(cleanupCursor ? { cursor: cleanupCursor } : {}) });
                    renderPendingCleanups(pending.entries || []);
                    cleanupCursor = pending.nextCursor || null;
                } catch {
                    renderPendingCleanups([]);
                    cleanupList.replaceChildren(text(documentRef, 'p', 'La liste des nettoyages à reprendre est momentanément indisponible.', 'contribution-trash-empty'));
                }
            } else renderPendingCleanups([]);
            currentEntries = append ? [...currentEntries, ...(page.entries || [])] : (page.entries || []);
            cursor = page.nextCursor || null;
            status.textContent = cursor ? 'Voici les entrées les plus récentes.' : 'Liste à jour.';
            if (cursor) {
                const more = text(documentRef, 'button', 'Charger les entrées suivantes', 'm-button');
                more.type = 'button';
                more.addEventListener('click', async () => { more.disabled = true; await loadPage(cursor, true); });
                list.append(more);
            }
            return true;
        } catch { status.textContent = 'La corbeille est momentanément indisponible.'; return false; }
    };
    let currentEntries = [];
    const open = async () => {
        try { await ensureClient(); } catch { status.textContent = 'Service de corbeille indisponible.'; return; }
        const currentUser = clientRef.currentUser?.();
        if (currentUser) {
            try {
                const capabilities = await clientRef.getCampaignCapabilities();
                session = { user: currentUser, capabilities: {
                    role: ['mj', 'joueur'].includes(capabilities?.role) ? capabilities.role : 'public',
                    contribution: capabilities?.contribution === true,
                } };
            } catch { status.textContent = 'Vérification du compte impossible.'; return; }
        }
        if (!session.user) { try { await signIn?.(); } catch { status.textContent = 'Connexion impossible.'; } return; }
        if (!session.capabilities.contribution) { status.textContent = 'Compte sans accès de contribution.'; return; }
        cursor = null;
        cleanupCursor = null;
        currentEntries = [];
        await loadPage(null, false);
        dialog.showModal();
    };
    const onClose = () => { if (dialog.open) dialog.close(); };
    button.addEventListener('click', open);
    close.addEventListener('click', onClose);
    return Object.freeze({ button, dialog, dispose() {
        active = false;
        stopWatching();
        button.removeEventListener('click', open);
        close.removeEventListener('click', onClose);
        dialog.remove();
        button.remove();
    } });
}

export { FIELDS as CONTRIBUTION_EDITOR_FIELDS };

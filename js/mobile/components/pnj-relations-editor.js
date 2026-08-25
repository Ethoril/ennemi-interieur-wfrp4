const PALETTE = Object.freeze([
    { value: '', label: 'Automatique' },
    { value: '#c9a84c', label: 'Or' },
    { value: '#e8a87c', label: 'Pêche' },
    { value: '#d4756b', label: 'Corail' },
    { value: '#c4726e', label: 'Brique' },
    { value: '#c94c8e', label: 'Rose' },
    { value: '#8e4cc9', label: 'Violet' },
    { value: '#5a7ac9', label: 'Indigo' },
    { value: '#4c9ac9', label: 'Azur' },
    { value: '#4cc9c9', label: 'Cyan' },
    { value: '#4caf7d', label: 'Vert' },
    { value: '#7ac94c', label: 'Tilleul' },
    { value: '#a8965a', label: 'Bronze' },
    { value: '#8a7a6a', label: 'Taupe' },
    { value: '#9a9aaa', label: 'Argent' },
    { value: '#7a7a8a', label: 'Ardoise' },
    { value: '#c9b89a', label: 'Parchemin' },
]);
const STYLES = Object.freeze(['solid', 'dashed']);

function strictGm(getSession) {
    const value = typeof getSession === 'function' ? getSession() : getSession;
    const state = value?.getState?.() || value;
    return state?.status === 'gm' && state?.role === 'mj'
        && typeof state?.user?.uid === 'string' && state.user.uid.length > 0;
}

function sessionState(getSession) {
    const value = typeof getSession === 'function' ? getSession() : getSession;
    return value?.getState?.() || value || {};
}

function fold(value) {
    return String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr');
}

function text(documentRef, tag, value, className = '') {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    node.textContent = String(value ?? '');
    return node;
}

function safeError(error) {
    const kind = error?.kind || error?.code;
    if (kind === 'not-found' || kind === 'failed-precondition') return 'Cette relation n’est plus disponible. Vérifiez la fiche puis réessayez.';
    if (kind === 'permission' || kind === 'permission-denied') return 'Votre session MJ n’autorise plus cette action.';
    if (kind === 'unavailable' || kind === 'offline') return 'Connexion indisponible. Votre saisie est conservée.';
    if (kind === 'conflict') return 'La relation a changé ailleurs. Rechargez-la avant de poursuivre.';
    return 'La relation n’a pas pu être enregistrée. Votre saisie est conservée.';
}

function relationTarget(relation, id) {
    return relation.source === id ? relation.cible : relation.source;
}

function directionLabel(relation, id) { return relation.source === id ? 'Vers' : 'Depuis'; }

function createField(documentRef, form, labelText, name, type = 'text') {
    const wrapper = documentRef.createElement('div'); wrapper.className = 'm-relation-field';
    const id = `m-relation-${name}`;
    const label = documentRef.createElement('label'); label.setAttribute('for', id); label.textContent = labelText;
    const control = documentRef.createElement(type === 'select' ? 'select' : 'input');
    control.id = id; control.name = name; control.type = type === 'select' ? '' : type;
    const error = text(documentRef, 'p', '', 'm-relation-error'); error.id = `${id}-error`; error.hidden = true; error.setAttribute('role', 'alert');
    control.setAttribute('aria-describedby', error.id); wrapper.append(label, control, error); form.append(wrapper);
    return { wrapper, control, error, locked: false };
}

function validForm(values) {
    const errors = {};
    if (!values.target) errors.target = 'Choisissez une cible.';
    if (!['outgoing', 'incoming'].includes(values.direction)) errors.direction = 'Choisissez un sens valide.';
    if (!values.type || values.type.trim().length === 0 || values.type.length > 100) errors.type = 'Le type est obligatoire et limité à 100 caractères.';
    if (!values.label || values.label.trim().length === 0 || values.label.length > 300) errors.label = 'Le libellé est obligatoire et limité à 300 caractères.';
    if (!STYLES.includes(values.style)) errors.style = 'Choisissez un style valide.';
    if (values.color !== '' && !PALETTE.some(item => item.value === values.color)) errors.color = 'Choisissez une couleur de palette.';
    if (typeof values.visible !== 'boolean') errors.visible = 'La visibilité doit être explicite.';
    return { valid: Object.keys(errors).length === 0, errors };
}

export function createPnjRelationsEditor({ container, pnjId, getSession = () => null,
    getRelationsRepository = () => null, getPnjRepository = () => null,
    announce = () => {}, document: documentRef = container?.ownerDocument ?? globalThis.document } = {}) {
    if (!container || !documentRef?.createElement || typeof pnjId !== 'string' || !pnjId) throw new TypeError('Éditeur de relations requis');
    let mounted = false; let generation = 0; let controller = null; let externalSignal = null; let unsubs = [];
    let relations = []; let pnjs = []; let busy = false; let dirty = false; let externallyDisabled = false; let editor = null; let editorRelation = null; let editorPanel = null; let conflictActions = null;
    let lastFocus = null; let previousOverflow = null; let ownsScrollLock = false; let refs = null;

    const cleanup = () => { for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe?.(); } catch { /* best-effort */ } } };
    const capture = () => {
        const state = sessionState(getSession);
        if (!mounted || controller?.signal?.aborted || !strictGm(getSession)) return null;
        return Object.freeze({ generation, uid: state.user.uid });
    };
    const current = op => {
        const state = sessionState(getSession);
        return Boolean(op && mounted && !controller?.signal?.aborted && generation === op.generation
            && state.status === 'gm' && state.role === 'mj' && state.user?.uid === op.uid);
    };
    const setStatus = (message, kind = '') => { if (refs?.status) { refs.status.textContent = message; refs.status.dataset.kind = kind; } };
    const targetMap = () => new Map(pnjs.filter(item => item?.id && item.id !== pnjId).map(item => [item.id, item]));
    const showRelations = () => {
        if (!refs?.list) return;
        refs.list.replaceChildren();
        const own = relations.filter(item => item.source === pnjId || item.cible === pnjId);
        if (!own.length) refs.list.append(text(documentRef, 'li', 'Aucune relation pour ce PNJ.', 'm-relations-empty'));
        const targets = targetMap();
        for (const relation of own) {
            const item = documentRef.createElement('li'); item.className = 'm-relation-row';
            const target = targets.get(relationTarget(relation, pnjId));
            const title = text(documentRef, 'strong', `${directionLabel(relation, pnjId)} ${target?.nom || 'PNJ introuvable'}`);
            const detail = text(documentRef, 'span', `${relation.label || relation.type} · ${relation.style || 'solid'} · ${relation.visibleJoueurs === true ? 'visible joueurs' : 'MJ seulement'}`);
            item.append(title, detail);
            if (!target) { const anomaly = text(documentRef, 'span', 'Anomalie : cible absente, réparation MJ requise.', 'm-relation-anomaly'); anomaly.setAttribute('role', 'alert'); item.append(anomaly); }
            const actions = documentRef.createElement('div'); actions.className = 'm-relation-actions';
            const edit = documentRef.createElement('button'); edit.type = 'button'; edit.className = 'm-button'; edit.textContent = 'Modifier'; edit.disabled = externallyDisabled; edit.addEventListener('click', () => openEditor(relation));
            const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'm-button m-button-danger'; remove.textContent = relation.reciprocalId ? 'Supprimer ce sens' : 'Supprimer'; remove.disabled = externallyDisabled; remove.addEventListener('click', () => removeRelation(relation, false));
            actions.append(edit, remove);
            if (relation.reciprocalId) { const removePair = documentRef.createElement('button'); removePair.type = 'button'; removePair.className = 'm-button m-button-danger'; removePair.textContent = 'Supprimer la paire'; removePair.disabled = externallyDisabled; removePair.addEventListener('click', () => removeRelation(relation, true)); actions.append(removePair); }
            item.append(actions); refs.list.append(item);
        }
    };
    const renderTargets = (select, search) => {
        const query = fold(search.value); const items = [...targetMap().values()]
            .filter(item => !query || fold(`${item.nom} ${item.statut} ${item.lieu}`).includes(query))
            .sort((left, right) => fold(left.nom).localeCompare(fold(right.nom), 'fr'));
        select.replaceChildren();
        const placeholder = documentRef.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choisir un PNJ'; select.append(placeholder);
        for (const item of items) {
            const option = documentRef.createElement('option'); option.value = item.id;
            option.textContent = `${item.nom || item.id} — ${item.visibleJoueurs === true ? 'visible joueurs' : 'masqué joueurs'}`; select.append(option);
        }
    };
    const closeEditor = () => {
        if (!editor) return;
        editor.remove(); editor = null; editorRelation = null; editorPanel = null; conflictActions = null; dirty = false;
        if (documentRef.body?.style) documentRef.body.style.overflow = previousOverflow ?? '';
        if (documentRef.body && ownsScrollLock) {
            documentRef.body.className = String(documentRef.body.className || '').split(/\s+/u)
                .filter(value => value && value !== 'm-scroll-locked').join(' ');
        }
        previousOverflow = null; ownsScrollLock = false; lastFocus?.focus?.(); lastFocus = null;
    };
    const applyErrors = (fields, errors) => {
        for (const [key, field] of Object.entries(fields)) { const message = errors[key] || ''; field.error.textContent = message; field.error.hidden = !message; field.control.setAttribute('aria-invalid', message ? 'true' : 'false'); }
        const first = Object.keys(errors)[0]; if (first && fields[first]) fields[first].control.focus?.();
    };
    const canCloseEditor = () => {
        if (busy) return false;
        if (!dirty) return true;
        const confirm = documentRef.defaultView?.confirm;
        return typeof confirm !== 'function' || confirm('Des modifications de relation ne sont pas enregistrées. Quitter la feuille ?');
    };
    const lockScroll = () => {
        const body = documentRef.body;
        if (!body) return;
        const classes = String(body.className || '').split(/\s+/u).filter(Boolean);
        ownsScrollLock = !classes.includes('m-scroll-locked');
        if (ownsScrollLock) body.className = [...classes, 'm-scroll-locked'].join(' ');
        previousOverflow = body.style?.overflow ?? '';
        if (body.style) body.style.overflow = 'hidden';
    };
    const openEditor = relation => {
        if (!mounted || busy || externallyDisabled || !strictGm(getSession)) return;
        lastFocus = documentRef.activeElement; editor = documentRef.createElement('div'); editor.className = 'm-relation-sheet';
        editorRelation = relation || null; dirty = false;
        editor.setAttribute('role', 'dialog'); editor.setAttribute('aria-modal', 'true'); editor.setAttribute('aria-labelledby', 'm-relation-sheet-title');
        const panel = documentRef.createElement('section'); panel.className = 'm-relation-sheet-panel'; editorPanel = panel;
        const heading = text(documentRef, 'h3', relation ? 'Modifier la relation' : 'Ajouter une relation'); heading.id = 'm-relation-sheet-title';
        const form = documentRef.createElement('form'); form.noValidate = true;
        const fields = {
            search: createField(documentRef, form, 'Rechercher une cible', 'search'),
            target: createField(documentRef, form, 'Cible', 'target', 'select'),
            direction: createField(documentRef, form, 'Sens', 'direction', 'select'),
            type: createField(documentRef, form, 'Type', 'type'),
            label: createField(documentRef, form, 'Libellé', 'label'),
            style: createField(documentRef, form, 'Trait', 'style', 'select'),
            color: createField(documentRef, form, 'Couleur', 'color', 'select'),
        };
        const visible = createField(documentRef, form, 'Visible par les joueurs', 'visible', 'checkbox'); fields.visible = visible;
        const pairLabel = relation ? 'Modifier les deux sens' : 'Créer dans les deux sens';
        const pair = createField(documentRef, form, pairLabel, 'pair', 'checkbox'); fields.pair = pair;
        const directionOptions = [['outgoing', 'Vers'], ['incoming', 'Depuis']];
        directionOptions.forEach(([value, label]) => { const option = documentRef.createElement('option'); option.value = value; option.textContent = label; fields.direction.control.append(option); });
        STYLES.forEach(value => { const option = documentRef.createElement('option'); option.value = value; option.textContent = value === 'solid' ? 'Continu' : 'Pointillé'; fields.style.control.append(option); });
        PALETTE.forEach(item => { const option = documentRef.createElement('option'); option.value = item.value; option.textContent = item.label; fields.color.control.append(option); });
        const currentDirection = relation ? relation.source === pnjId ? 'outgoing' : 'incoming' : 'outgoing';
        fields.direction.control.value = currentDirection; fields.type.control.value = relation?.type || ''; fields.label.control.value = relation?.label || relation?.type || '';
        fields.style.control.value = relation?.style || 'solid'; fields.color.control.value = relation?.color || '';
        fields.visible.control.type = 'checkbox'; fields.visible.control.checked = relation ? relation.visibleJoueurs === true : true;
        fields.pair.control.type = 'checkbox'; fields.pair.control.checked = Boolean(relation?.reciprocalId);
        fields.pair.locked = Boolean(relation && !relation.reciprocalId); fields.pair.wrapper.hidden = fields.pair.locked; fields.pair.control.disabled = fields.pair.locked;
        const target = relationTarget(relation || { source: pnjId, cible: '' }, pnjId); fields.search.control.addEventListener('input', () => renderTargets(fields.target.control, fields.search.control));
        renderTargets(fields.target.control, fields.search.control); if (target) fields.target.control.value = target;
        fields.type.control.addEventListener('input', () => { if (!fields.label.control.value) fields.label.control.value = fields.type.control.value; });
        const status = text(documentRef, 'p', '', 'm-relation-sheet-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const actions = documentRef.createElement('div'); actions.className = 'm-relation-sheet-actions';
        const cancel = documentRef.createElement('button'); cancel.type = 'button'; cancel.className = 'm-button'; cancel.textContent = 'Annuler';
        const submit = documentRef.createElement('button'); submit.type = 'submit'; submit.className = 'm-button m-button-primary'; submit.textContent = 'Enregistrer'; actions.append(cancel, submit);
        form.append(actions); panel.append(heading, form, status); editor.append(panel); container.append(editor);
        form.addEventListener('input', event => { if (event.target?.name !== 'search') dirty = true; }); form.addEventListener('change', event => { if (event.target?.name !== 'search') dirty = true; });
        const close = () => { if (canCloseEditor()) closeEditor(); }; cancel.addEventListener('click', close); editor.addEventListener('click', event => { if (event.target === editor) close(); });
        editor.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            if (event.key === 'Tab') {
                const focusable = [...editor.querySelectorAll?.('button, input, select') || []].filter(node => !node.disabled);
                if (focusable.length && (event.shiftKey ? documentRef.activeElement === focusable[0] : documentRef.activeElement === focusable.at(-1))) { event.preventDefault(); (event.shiftKey ? focusable.at(-1) : focusable[0]).focus(); }
            }
        });
        lockScroll();
        fields.search.control.focus?.();
        form.addEventListener('submit', event => { event.preventDefault(); void saveRelation(relation, fields, status); });
    };
    const showConflictChoice = next => {
        if (!editorPanel || conflictActions) return;
        const explanation = text(documentRef, 'p', 'Cette relation a changé ailleurs. Rechargez la version distante ou conservez votre saisie pour laisser le serveur vérifier le conflit.', 'm-relation-conflict'); explanation.setAttribute('role', 'alert'); editorPanel.append(explanation);
        conflictActions = documentRef.createElement('div'); conflictActions.className = 'm-relation-conflict-actions';
        const reload = documentRef.createElement('button'); reload.type = 'button'; reload.className = 'm-button'; reload.textContent = 'Recharger la version distante';
        const keep = documentRef.createElement('button'); keep.type = 'button'; keep.className = 'm-button'; keep.textContent = 'Conserver ma saisie';
        reload.addEventListener('click', () => { closeEditor(); openEditor(next); });
        keep.addEventListener('click', () => { conflictActions?.remove?.(); conflictActions = null; setStatus('Votre saisie est conservée ; le contrôle serveur reste requis.', 'conflict'); });
        conflictActions.append(reload, keep); editorPanel.append(conflictActions);
    };
    const saveRelation = async (relation, fields, status) => {
        if (busy) return; const operation = capture(); if (!operation) { status.textContent = 'Session MJ invalide.'; return; }
        const values = { target: fields.target.control.value, direction: fields.direction.control.value, type: fields.type.control.value.trim(), label: fields.label.control.value.trim(), style: fields.style.control.value, color: fields.color.control.value, visible: fields.visible.control.checked === true };
        const validation = validForm(values); if (!validation.valid) { applyErrors(fields, validation.errors); return; }
        const target = targetMap().get(values.target);
        if (!target) { applyErrors(fields, { target: 'Cette cible n’est plus disponible.' }); return; }
        const sourcePnj = pnjs.find(item => item?.id === pnjId);
        if (values.visible && (target.visibleJoueurs !== true || sourcePnj?.visibleJoueurs !== true)) {
            status.textContent = 'Un endpoint est masqué aux joueurs : rendez la relation MJ seulement ou rendez les deux PNJ visibles.';
            fields.visible.control.focus?.(); return;
        }
        const source = values.direction === 'outgoing' ? pnjId : values.target; const cible = values.direction === 'outgoing' ? values.target : pnjId;
        const payload = { source, cible, type: values.type, label: values.label || values.type, style: values.style, color: values.color || null, visibleJoueurs: values.visible };
        busy = true; submitDisabled(fields, true); status.textContent = 'Enregistrement…';
        try {
            const repo = getRelationsRepository(); if (!repo) throw Object.assign(new Error('relations-unavailable'), { code: 'failed-precondition' });
            if (relation) {
                const pair = fields.pair.control.checked === true;
                const options = pair ? { pair, reciprocalId: relation.reciprocalId } : { pair: false };
                await repo.update(relation.id, payload, relation.updatedAt, options);
            }
            else await repo.create(payload, fields.pair.control.checked === true);
            if (!current(operation)) return;
            busy = false; closeEditor(); announce(relation ? 'Relation modifiée.' : 'Relation créée.');
        } catch (error) { if (current(operation)) { status.textContent = safeError(error); busy = false; submitDisabled(fields, false); } }
    };
    const submitDisabled = (fields, value) => {
        Object.values(fields).forEach(field => { if (field.control) field.control.disabled = value || externallyDisabled || field.locked === true; });
        editor?.querySelectorAll?.('button').forEach(button => { button.disabled = value || externallyDisabled; });
    };
    const removeRelation = async (relation, removePair = false) => {
        if (!mounted || busy || externallyDisabled || !strictGm(getSession)) return;
        const target = targetMap().get(relationTarget(relation, pnjId)); const pair = removePair === true && Boolean(relation.reciprocalId);
        if (!documentRef.defaultView?.confirm?.(`Supprimer la relation ${relation.label || relation.type} avec ${target?.nom || 'PNJ introuvable'}${pair ? ' dans les deux sens' : ' dans ce sens'} ?`)) return;
        const operation = capture(); if (!operation) return; busy = true; setStatus('Suppression en cours…');
        try { const repo = getRelationsRepository(); const options = pair ? { pair: true, reciprocalId: relation.reciprocalId } : { pair: false }; await repo.remove(relation.id, options); if (current(operation)) { busy = false; announce(pair ? 'Paire supprimée.' : 'Relation supprimée.'); } }
        catch (error) { if (current(operation)) { busy = false; setStatus(error?.kind === 'not-found' ? 'Cette relation était déjà supprimée.' : safeError(error), 'error'); } }
    };
    const subscribe = () => {
        const operation = capture(); if (!operation) { setStatus('Session MJ requise pour gérer les relations.', 'error'); return; }
        const relationsRepo = getRelationsRepository(); const pnjsRepo = getPnjRepository();
        if (!relationsRepo || !pnjsRepo) { setStatus('Les dépôts MJ sont indisponibles.', 'error'); return; }
        try {
            unsubs.push(relationsRepo.subscribeAll((items, metadata) => {
                if (!current(operation)) { if (!strictGm(getSession)) unmount(); return; }
                const nextRelations = Array.isArray(items) ? items : [];
                if (editorRelation) {
                    const next = nextRelations.find(item => item.id === editorRelation.id);
                    if (!next) { closeEditor(); setStatus('Cette relation a déjà été supprimée.'); }
                    else if (JSON.stringify(next) !== JSON.stringify(editorRelation)) {
                        if (dirty) { setStatus('La relation a changé ailleurs. Rechargez-la ou poursuivez avec votre saisie.', 'conflict'); showConflictChoice(next); }
                        else { closeEditor(); openEditor(next); }
                    }
                }
                relations = nextRelations; showRelations(); if (metadata?.fromCache) setStatus('Relations locales en cours de synchronisation.');
            }, error => { if (current(operation)) setStatus(safeError(error), 'error'); else if (!strictGm(getSession)) unmount(); }));
            unsubs.push(pnjsRepo.subscribeAll(items => { if (!current(operation)) { if (!strictGm(getSession)) unmount(); return; } pnjs = Array.isArray(items) ? items : []; showRelations(); }, error => { if (current(operation)) setStatus(safeError(error), 'error'); else if (!strictGm(getSession)) unmount(); }));
        } catch (error) { cleanup(); setStatus(safeError(error), 'error'); }
    };
    const mount = ({ signal } = {}) => {
        if (mounted || signal?.aborted) return; mounted = true; generation += 1; controller = new globalThis.AbortController();
        externalSignal = signal || null; signal?.addEventListener?.('abort', unmount, { once: true });
        const section = documentRef.createElement('section'); section.className = 'm-relations-editor';
        const heading = text(documentRef, 'h3', 'Relations MJ'); const add = documentRef.createElement('button'); add.type = 'button'; add.className = 'm-button m-button-primary'; add.textContent = 'Ajouter une relation'; add.disabled = externallyDisabled; add.addEventListener('click', () => openEditor(null));
        const status = text(documentRef, 'p', 'Chargement des relations…', 'm-relations-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const list = documentRef.createElement('ul'); list.className = 'm-relations-list'; section.append(heading, add, status, list); container.append(section); refs = { section, add, status, list };
        subscribe();
    };
    const beforeLeave = () => { if (!editor) return true; if (busy) return false; return canCloseEditor(); };
    const setDisabled = value => {
        externallyDisabled = value === true;
        if (refs) { refs.add.disabled = externallyDisabled; refs.section.querySelectorAll?.('button').forEach(button => { button.disabled = externallyDisabled; }); }
        if (editor) editor.querySelectorAll?.('input, select, button').forEach(control => {
            control.disabled = externallyDisabled || busy || control.name === 'pair' && editorRelation && !editorRelation.reciprocalId;
        });
    };
    const unmount = () => { if (!mounted) return; mounted = false; generation += 1; controller?.abort(); externalSignal?.removeEventListener?.('abort', unmount); externalSignal = null; cleanup(); closeEditor(); refs?.section?.remove?.(); refs = null; relations = []; pnjs = []; busy = false; externallyDisabled = false; };
    return Object.freeze({ mount, unmount, open: () => openEditor(null), beforeLeave, setDisabled });
}

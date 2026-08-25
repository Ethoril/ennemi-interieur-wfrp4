import { errorForUi, ERROR_KINDS } from '../../data/firebase-errors.js';
import { createPnjPicker } from '../components/pnj-picker.js';
import { createPortraitEditor, processPortraitFile } from '../components/portrait-editor.js';

const MAX = Object.freeze({ titre: 200, description: 30000 });

function normalizeParagraphs(value) {
    return typeof value === 'string' ? value.replace(/[^\S\r\n]+/gu, ' ').split(/\r?\n/u).map(line => line.trim()).join('\n').trim() : '';
}

export function defaultEnqueteFormValues() { return { titre: '', description: '', decouvert: false, ordre: null, pnjsLies: [], imagePath: null }; }

export function normalizeEnqueteFormValues(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const ordre = source.ordre === null || source.ordre === '' || source.ordre === undefined ? null : Number(source.ordre);
    return {
        titre: typeof source.titre === 'string' ? source.titre.replace(/\s+/gu, ' ').trim() : '',
        description: normalizeParagraphs(source.description),
        decouvert: source.decouvert === true,
        ordre: Number.isFinite(ordre) ? ordre : null,
        pnjsLies: [...new Set(Array.isArray(source.pnjsLies) ? source.pnjsLies.filter(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(id)) : [])].sort(),
        imagePath: typeof source.imagePath === 'string' && source.imagePath ? source.imagePath : null,
    };
}

export function validateEnqueteForm(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const values = normalizeEnqueteFormValues(source);
    const errors = {};
    if (typeof source.titre !== 'string' || !values.titre) errors.titre = 'Le titre est obligatoire.';
    if (values.titre.length > MAX.titre) errors.titre = `Le titre ne peut pas dépasser ${MAX.titre} caractères.`;
    if (typeof source.description !== 'string' || !values.description) errors.description = 'La description est obligatoire.';
    if (values.description.length > MAX.description) errors.description = `La description ne peut pas dépasser ${MAX.description} caractères.`;
    if (Object.hasOwn(source, 'decouvert') && typeof source.decouvert !== 'boolean') errors.decouvert = 'Le statut doit être découvert ou secret.';
    const ordreIsEmpty = source.ordre === null || source.ordre === '' || source.ordre === undefined;
    const ordreNumber = typeof source.ordre === 'number' ? source.ordre : Number(source.ordre);
    if (!ordreIsEmpty && (typeof source.ordre !== 'number' && typeof source.ordre !== 'string'
        || !Number.isFinite(ordreNumber))) errors.ordre = 'L’ordre doit être un nombre ou vide.';
    if (!Array.isArray(source.pnjsLies) || source.pnjsLies.length > 100
        || source.pnjsLies.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/u.test(id))) errors.pnjsLies = 'La sélection de PNJs est invalide.';
    return Object.freeze({ valid: Object.keys(errors).length === 0, values, errors: Object.freeze(errors) });
}

function sessionState(getSession) { const value = typeof getSession === 'function' ? getSession() : getSession; return value?.getState?.() || value || {}; }
function isMj(getSession) { const state = sessionState(getSession); return state.status === 'gm' && state.role === 'mj' && typeof state.user?.uid === 'string' && state.user.uid.length > 0; }
function makeText(documentRef, tag, value, className = '') { const node = documentRef.createElement(tag); node.className = className; node.textContent = value; return node; }
function set(control, value) { if (control.type === 'checkbox') control.checked = value === true; else control.value = value ?? ''; }
function timestampKey(value) {
    if (!value || typeof value !== 'object') return String(value ?? '');
    return `${value.seconds ?? ''}:${value.nanoseconds ?? ''}`;
}
function safeTimestamp(value) {
    return value && typeof value === 'object'
        && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)
        ? { seconds: value.seconds, nanoseconds: value.nanoseconds } : Number.isFinite(value) ? value : undefined;
}
const IMAGE_SKIP_REASONS = Object.freeze(new Set(['external-reference', 'owner-mismatch', 'legacy-invalid', 'legacy-reference']));
function safeImageSkipReason(state) {
    if (IMAGE_SKIP_REASONS.has(state?.skippedImagePathReason)) return state.skippedImagePathReason;
    if (state?.legacyImageInvalid === true) return 'legacy-invalid';
    if (state?.legacyImageSkipped === true) return 'legacy-reference';
    return null;
}
function imageSkipNotice(state) {
    if (state?.skippedImagePathInvalid === true) {
        return safeImageSkipReason(state) === 'external-reference'
            ? 'Une référence image externe a été conservée sans nettoyage.'
            : 'Une référence image non propriétaire a été conservée sans nettoyage.';
    }
    if (state?.legacyImageInvalid === true) return 'Une référence image héritée invalide a été conservée sans nettoyage.';
    if (state?.legacyImageSkipped === true) return 'Une référence image héritée a été conservée sans nettoyage.';
    return '';
}
function recoveryCompleted(result) {
    return result?.status === 'completed' && result?.retryNeeded !== true;
}
function projectRecoveryState(state, operation = '') {
    if (!state || typeof state !== 'object') return null;
    return Object.freeze({
        operation,
        commitUnknown: state.commitUnknown === true,
        firestoreDone: state.firestoreDone === true,
        imageCleanupPending: state.imageCleanupPending === true,
        cleanupPending: state.cleanupPending === true,
        journalPending: state.journalPending === true,
        creation: state.creation === true,
        indiceId: typeof state.indiceId === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(state.indiceId) ? state.indiceId : null,
        legacyImageSkipped: state.legacyImageSkipped === true,
        legacyImageInvalid: state.legacyImageInvalid === true,
        skippedImagePathInvalid: state.skippedImagePathInvalid === true,
        skippedImagePathReason: safeImageSkipReason(state),
        imagePath: (() => {
            const path = state.newImagePath || state.imagePath;
            return typeof path === 'string' && state.indiceId
                && new RegExp(`^indices/${state.indiceId}/[A-Za-z0-9._-]{1,128}$`, 'u').test(path)
                ? path : null;
        })(),
        expectedData: state.expectedData && typeof state.expectedData === 'object' ? state.expectedData : null,
        imageMode: ['replace', 'remove', 'unchanged'].includes(state.imageMode) ? state.imageMode : 'unchanged',
        previousUpdatedAt: safeTimestamp(state.previousUpdatedAt),
    });
}

export function createEnqueteEditView({
    container,
    id = null,
    getRepository = () => null,
    getPnjRepository = () => null,
    getImageService = () => null,
    getSession = () => ({}),
    draftStore = null,
    isOnline = () => true,
    onNavigate = () => {},
    onBack = () => {},
    announce = () => {},
} = {}) {
    let mounted = false;
    let signalRef = null;
    let abortHandler = null;
    let generation = 0;
    let unsubs = [];
    let refs = null;
    let picker = null;
    let portraitEditor = null;
    let initialized = id === null;
    let latestItem = null;
    let updatedAt;
    let dirty = false;
    let draftVersion = 0;
    let draftId = null;
    let draftTimer = null;
    let saving = false;
    let removing = false;
    let selectedImage = null;
    let removeImageRequested = false;
    let suppressPortraitChange = false;
    let recoveryState = null;
    let conflictButtons = [];
    let pendingIntent = null;

    const cleanups = () => { for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe?.(); } catch { /* best effort */ } } };
    const values = () => ({ titre: refs.titre.value, description: refs.description.value, decouvert: refs.decouvert.checked === true, ordre: refs.ordre.value, pnjsLies: picker?.getValues?.() || [] });
    const publicDraft = () => { const value = values(); return { titre: value.titre, description: value.description, decouvert: value.decouvert, ordre: value.ordre === '' ? null : Number(value.ordre), pnjsLies: value.pnjsLies }; };
    const persistDraft = () => {
        const result = draftStore?.save(publicDraft(), { indiceId: id, draftId });
        if (result?.ok && result.draft?.draftId) draftId = result.draft.draftId;
        return result;
    };
    const removeDrafts = () => {
        if (id && typeof draftStore?.removeForIndice === 'function') return draftStore.removeForIndice(id);
        return draftStore?.remove?.(draftId);
    };
    const scheduleDraft = () => {
        if (!draftStore || !dirty || saving) return;
        if (draftTimer) globalThis.clearTimeout?.(draftTimer);
        draftTimer = globalThis.setTimeout?.(() => { draftTimer = null; const result = persistDraft(); if (result?.ok) showStatus('Brouillon local — non synchronisé.', 'draft'); }, 400);
    };
    const showStatus = (message, kind = '') => { if (!refs) return; refs.status.textContent = message; refs.status.dataset.kind = kind; refs.status.setAttribute('aria-label', message); };
    const setBusy = busy => {
        saving = busy;
        if (!refs) return;
        refs.save.disabled = busy || removing || !!recoveryState;
        refs.cancel.disabled = busy || removing;
        refs.remove.disabled = busy || removing || !!recoveryState || !id;
        Object.values(refs.fields).forEach(control => { control.disabled = busy || removing || !!recoveryState; });
        picker?.setDisabled?.(busy || removing || !!recoveryState);
        portraitEditor?.setDisabled?.(busy || removing || !!recoveryState);
        conflictButtons.forEach(button => {
            button.disabled = busy || removing || !!recoveryState;
            button.setAttribute('aria-disabled', String(button.disabled));
        });
    };
    const renderErrors = errors => {
        refs.summary.replaceChildren();
        const keys = Object.keys(errors);
        refs.summary.hidden = !keys.length;
        if (keys.length) {
            refs.summary.append(makeText(container.ownerDocument, 'strong', 'Corrigez les erreurs suivantes :'));
            const list = container.ownerDocument.createElement('ul');
            keys.forEach(key => { const item = container.ownerDocument.createElement('li'); const link = container.ownerDocument.createElement('a'); link.href = `#${refs.fields[key]?.id || `m-enquete-${key}`}`; link.textContent = errors[key]; link.addEventListener('click', event => { event.preventDefault(); refs.fields[key]?.focus?.(); }); item.append(link); list.append(item); });
            refs.summary.append(list);
        }
        Object.entries(refs.fields).forEach(([key, control]) => { const message = errors[key] || ''; if (refs.errors[key]) { refs.errors[key].textContent = message; refs.errors[key].hidden = !message; } if (message) control.setAttribute('aria-invalid', 'true'); else control.removeAttribute('aria-invalid'); });
        if (keys.length) refs.fields[keys[0]]?.focus?.();
    };
    const fill = (item, { preserveServer = false } = {}) => {
        const values = normalizeEnqueteFormValues(item);
        set(refs.titre, values.titre); set(refs.description, values.description); set(refs.decouvert, values.decouvert); set(refs.ordre, values.ordre);
        picker?.setValues?.(values.pnjsLies);
        if (!preserveServer) {
            updatedAt = item?.updatedAt;
            latestItem = item;
        }
        dirty = false;
    };
    const captureOperation = () => {
        const state = sessionState(getSession);
        return mounted && isMj(getSession) ? { generation, uid: state.user.uid, draftVersion } : null;
    };
    const currentOperation = operation => {
        const state = sessionState(getSession);
        return !!operation && mounted && !signalRef?.aborted && operation.generation === generation && operation.uid === state.user?.uid && operation.draftVersion === draftVersion && isMj(getSession);
    };
    const publicationSummary = valuesForConfirmation => {
        const hasImage = !removeImageRequested && Boolean(selectedImage || latestItem?.image?.path);
        const imageLabel = hasImage ? 'avec une illustration' : 'sans illustration';
        const publicLinks = picker?.getPublicCount?.() ?? 0;
        return `« ${valuesForConfirmation.titre} » ${imageLabel} et ${publicLinks} lien(s) PNJ public(s)`;
    };
    const showConflict = () => {
        refs.conflict.replaceChildren(); refs.conflict.hidden = false;
        refs.conflict.append(makeText(container.ownerDocument, 'strong', 'Conflit : la fiche a changé ailleurs.'));
        refs.conflict.append(makeText(container.ownerDocument, 'p', 'Votre saisie locale est conservée. Rechargez ou forcez après confirmation MJ.'));
        const reload = container.ownerDocument.createElement('button'); reload.type = 'button'; reload.className = 'm-button'; reload.textContent = 'Recharger le serveur';
        const force = container.ownerDocument.createElement('button'); force.type = 'button'; force.className = 'm-button m-button-danger'; force.textContent = 'Forcer après confirmation MJ';
        reload.addEventListener('click', () => {
            if (saving || removing || recoveryState || !latestItem) return;
            suppressPortraitChange = true;
            portraitEditor?.reset?.();
            suppressPortraitChange = false;
            selectedImage = null;
            removeImageRequested = false;
            fill(latestItem);
            void portraitEditor?.setCurrentPath?.(latestItem.image?.path, getImageService?.());
            refs.conflict.hidden = true;
            showStatus('Version serveur rechargée.', 'saved');
        });
        force.addEventListener('click', () => {
            if (saving || removing || recoveryState) return;
            if (container.ownerDocument.defaultView?.confirm?.('Forcer cette écriture MJ ?')) void save({ force: true });
        });
        reload.disabled = false;
        force.disabled = false;
        refs.conflict.append(reload, force);
        conflictButtons = [reload, force];
    };
    const save = async ({ force = false } = {}) => {
        if (!mounted || saving || removing || recoveryState || !isMj(getSession)) return;
        if (id && !latestItem) { showStatus('Cette enquête n’existe plus sur le serveur. Elle ne sera pas recréée.', ERROR_KINDS.NOT_FOUND); return; }
        if (isOnline() === false) { showStatus('Hors ligne. La sauvegarde est interdite ; le brouillon reste local.', 'offline'); persistDraft(); return; }
        const validation = validateEnqueteForm(values());
        renderErrors(validation.errors);
        if (!validation.valid) return;
        if (!force && !id && validation.values.decouvert && !container.ownerDocument.defaultView?.confirm?.(`Publier ${publicationSummary(validation.values)} ?`)) return;
        if (!force && id && latestItem?.decouvert !== true && validation.values.decouvert && !container.ownerDocument.defaultView?.confirm?.(`Publier maintenant ${publicationSummary(validation.values)} ?`)) return;
        if (!force && id && latestItem?.decouvert === true && !validation.values.decouvert && !container.ownerDocument.defaultView?.confirm?.('Cet indice disparaîtra des appareils joueurs après synchronisation. Continuer ?')) return;
        const operation = captureOperation();
        if (!operation) return;
        setBusy(true); showStatus('Enregistrement…', 'saving');
        const repo = getRepository();
        try {
            const data = { titre: validation.values.titre, description: validation.values.description, decouvert: validation.values.decouvert, ordre: validation.values.ordre, pnjsLies: validation.values.pnjsLies };
            const imageOptions = selectedImage
                ? { imageFile: selectedImage }
                : removeImageRequested ? { removeImage: true } : {};
            pendingIntent = { expectedData: data, imageMode: selectedImage ? 'replace' : removeImageRequested ? 'remove' : 'unchanged', previousUpdatedAt: safeTimestamp(updatedAt) };
            const result = id
                ? force && typeof repo.forceUpdate === 'function'
                    ? await repo.forceUpdate(id, data, { ...imageOptions, confirmed: true })
                    : await repo.update(id, data, updatedAt, imageOptions)
                : await repo.create(data, imageOptions);
            if (!currentOperation(operation)) return;
            const savedId = id || result?.id;
            const imageNotice = imageSkipNotice(result);
            dirty = false; draftVersion += 1; removeDrafts(); draftId = null; selectedImage = null; removeImageRequested = false;
            pendingIntent = null;
            showStatus(imageNotice ? `Enregistré. ${imageNotice}` : 'Enregistré.', 'saved');
            announce(`${validation.values.decouvert ? 'Indice publié.' : 'Indice enregistré comme secret.'}${imageNotice ? ` ${imageNotice}` : ''}`);
            onNavigate(savedId ? `#/enquetes/${encodeURIComponent(savedId)}` : '#/enquetes');
        } catch (error) {
            if (!currentOperation(operation)) return;
            const kind = errorForUi(error).kind;
            if (kind === ERROR_KINDS.CONFLICT || error?.code === 'conflict') { setBusy(false); showStatus('Conflit : aucune donnée distante n’a été écrasée.', ERROR_KINDS.CONFLICT); showConflict(); return; }
            if (error?.state && (error.state.commitUnknown || error.state.firestoreDone || error.state.commitDone
                || error.state.journalPending || error.state.commitNotStarted || error.state.imageCleanupPending || error.state.cleanupPending)) {
                recoveryState = projectRecoveryState({ ...error.state, ...pendingIntent, indiceId: error.state.indiceId || id });
                setBusy(false); refs.recover.hidden = false;
                showStatus('Le résultat de l’enregistrement est incertain. Vérifiez puis reprenez le nettoyage.', ERROR_KINDS.CONFLICT);
                return;
            }
            setBusy(false); showStatus(errorForUi(error).message, kind);
        }
    };
    const recover = async () => {
        if (!recoveryState || !isMj(getSession) || isOnline() === false) { showStatus('Reprise indisponible hors connexion.', 'offline'); return; }
        const operation = captureOperation(); if (!operation) return;
        const wasRemoval = recoveryState.operation === 'remove';
        refs.recover.disabled = true; showStatus('Reprise du nettoyage…', 'saving');
        try {
            const repository = getRepository();
            const inspectId = recoveryState.indiceId || id;
            if (!wasRemoval && recoveryState.commitNotStarted && recoveryState.imagePath) {
                const imageService = getImageService();
                if (typeof imageService?.cleanupImage !== 'function') throw new Error('Nettoyage image indisponible');
                await imageService.cleanupImage(recoveryState.imagePath, {
                    collection: 'indices', ownerId: inspectId, skipJournal: true,
                });
                if (!currentOperation(operation)) return;
                recoveryState = null;
                refs.recover.hidden = true;
                setBusy(false);
                showStatus('Illustration non enregistrée nettoyée. Votre saisie est conservée.');
                return;
            }
            if (wasRemoval && inspectId && typeof repository?.inspectRemoval === 'function') {
                const inspected = await repository.inspectRemoval(inspectId);
                if (!currentOperation(operation)) return;
                if (inspected.status === 'not-committed') {
                    removing = false;
                    recoveryState = null;
                    refs.recover.hidden = true;
                    setBusy(false);
                    showStatus('La suppression n’a pas été confirmée. La fiche serveur est conservée.', ERROR_KINDS.CONFLICT);
                    return;
                }
                if (inspected.status === 'inconsistent') throw new Error('État de suppression incohérent');
                if (inspected.status === 'pending-cleanup' && typeof repository.resumeRemoval === 'function') {
                    await repository.resumeRemoval(inspectId);
                }
                if (!currentOperation(operation)) return;
                const imageNotice = imageSkipNotice(recoveryState);
                recoveryState = null;
                removing = false;
                refs.recover.hidden = true;
                setBusy(false);
                removeDrafts();
                onNavigate('#/enquetes');
                announce(`Suppression vérifiée.${imageNotice ? ` ${imageNotice}` : ''}`);
                return;
            }
            if (!wasRemoval && inspectId && typeof repository?.inspectCommit === 'function') {
                const inspected = await repository.inspectCommit(inspectId, {
                    creation: recoveryState.creation === true || id === null,
                    expectedData: recoveryState.expectedData,
                    imageMode: recoveryState.imageMode,
                    expectedImagePath: recoveryState.imagePath,
                    previousUpdatedAt: recoveryState.previousUpdatedAt,
                });
                if (!currentOperation(operation)) return;
                if (inspected.status === 'inconsistent') throw new Error('Résultat de commit incohérent');
                if (inspected.status === 'committed') {
                    const imageNotice = imageSkipNotice(recoveryState);
                    removeDrafts();
                    const imageRecovery = typeof getImageService()?.recover === 'function'
                        ? await getImageService().recover() : null;
                    if (!currentOperation(operation)) return;
                    if (!recoveryCompleted(imageRecovery)) {
                        refs.recover.disabled = false;
                        setBusy(false);
                        showStatus('Le nettoyage image reste en attente ; aucun succès n’est confirmé.', ERROR_KINDS.CONFLICT);
                        return;
                    }
                    recoveryState = null;
                    refs.recover.hidden = true;
                    setBusy(false);
                    onNavigate(`#/enquetes/${encodeURIComponent(inspectId)}`);
                    announce(`Enquête enregistrée ; nettoyage repris.${imageNotice ? ` ${imageNotice}` : ''}`);
                    return;
                }
            }
            if (recoveryState.operation === 'remove' && id && typeof repository?.resumeRemoval === 'function') {
                await repository.resumeRemoval(id);
            } else {
                if (typeof getImageService()?.recover !== 'function') throw new Error('Reprise du nettoyage indisponible');
                const imageRecovery = await getImageService().recover();
                if (!currentOperation(operation)) return;
                if (!recoveryCompleted(imageRecovery)) {
                    refs.recover.disabled = false;
                    setBusy(false);
                    showStatus('Le nettoyage image reste en attente ; aucun succès n’est confirmé.', ERROR_KINDS.CONFLICT);
                    return;
                }
            }
            if (!currentOperation(operation)) return;
            const recoveryNotice = imageSkipNotice(recoveryState);
            recoveryState = null;
            removing = false;
            refs.recover.hidden = true;
            setBusy(false);
            if (wasRemoval) {
                removeDrafts();
                onNavigate('#/enquetes');
                announce(`Nettoyage de la suppression repris.${recoveryNotice ? ` ${recoveryNotice}` : ''}`);
                return;
            }
            showStatus(`Nettoyage repris. Votre saisie est conservée.${recoveryNotice ? ` ${recoveryNotice}` : ''}`);
        } catch (error) {
            if (!currentOperation(operation)) return;
            refs.recover.disabled = false;
            showStatus(errorForUi(error).message, ERROR_KINDS.CONFLICT);
        }
    };
    const remove = async () => {
        if (!id || removing || saving || recoveryState || !latestItem || !isMj(getSession) || isOnline() === false) { showStatus('Hors ligne, mutation en cours ou session MJ indisponible. La suppression n’est pas lancée.', 'offline'); return; }
        const linkedTotalCount = picker?.getValues?.()?.length ?? 0;
        if (!container.ownerDocument.defaultView?.confirm?.(`Supprimer « ${latestItem?.titre || 'cet indice'} », son image et ${linkedTotalCount} lien(s) PNJ ?`)) return;
        const operation = captureOperation(); if (!operation) return;
        removing = true; setBusy(true); showStatus('Suppression en cours…', 'saving');
        try {
            const result = await getRepository().remove(id);
            if (!currentOperation(operation)) return;
            if (result?.imageCleanupPending || result?.lockRetained) {
                recoveryState = projectRecoveryState(result, 'remove');
                if (result.firestoreDone === true) removeDrafts();
                refs.recover.hidden = false;
                setBusy(false);
                const imageNotice = imageSkipNotice(recoveryState);
                showStatus(`Indice supprimé ; le nettoyage doit être repris.${imageNotice ? ` ${imageNotice}` : ''}`, ERROR_KINDS.CONFLICT);
                return;
            }
            if (result?.firestoreDone !== true) throw new Error('Suppression non confirmée');
            removeDrafts();
            const imageNotice = imageSkipNotice(result);
            onNavigate('#/enquetes');
            announce(`Indice supprimé.${imageNotice ? ` ${imageNotice}` : ''}`);
        } catch (error) {
            if (!currentOperation(operation)) return;
            if (error?.state?.commitUnknown || error?.state?.firestoreDone === true && error?.state?.imageCleanupPending) {
                recoveryState = projectRecoveryState(error.state, 'remove');
                if (error.state.firestoreDone === true) removeDrafts();
                refs.recover.hidden = false;
                removing = false;
                setBusy(false);
                const imageNotice = imageSkipNotice(recoveryState);
                showStatus(`Le résultat de la suppression est incertain. Reprenez la vérification.${imageNotice ? ` ${imageNotice}` : ''}`, ERROR_KINDS.CONFLICT);
                return;
            }
            removing = false;
            setBusy(false);
            showStatus(errorForUi(error).message, errorForUi(error).kind);
        }
    };
    const beforeLeave = () => {
        if (!mounted) return true;
        if (recoveryState) { showStatus('Une reprise de nettoyage est nécessaire avant de quitter cette fiche.', ERROR_KINDS.CONFLICT); return false; }
        if (saving || removing) { showStatus('Une mutation est en cours. Attendez sa confirmation.', ERROR_KINDS.CONFLICT); return false; }
        if (!dirty) return true;
        const persisted = persistDraft();
        return container.ownerDocument.defaultView?.confirm?.(persisted?.ok ? 'Les champs publics seront conservés en brouillon local. Quitter ?' : 'Quitter et perdre la saisie locale ?') ?? true;
    };
    const mount = ({ signal } = {}) => {
        if (mounted || !container || signal?.aborted) return;
        mounted = true; signalRef = signal ?? null; generation += 1;
        const documentRef = container.ownerDocument; container.replaceChildren();
        const screen = documentRef.createElement('section'); screen.className = 'm-screen m-pnj-form-screen'; screen.dataset.view = 'enquete-edit';
        const heading = makeText(documentRef, 'h2', id ? 'Modifier l’enquête' : 'Nouvelle enquête');
        const form = documentRef.createElement('form'); form.className = 'm-pnj-form'; form.noValidate = true;
        const summary = documentRef.createElement('div'); summary.className = 'm-form-summary'; summary.hidden = true; summary.setAttribute('role', 'alert');
        const conflict = documentRef.createElement('section'); conflict.className = 'm-form-conflict'; conflict.hidden = true; conflict.setAttribute('role', 'alert');
        const status = makeText(documentRef, 'p', '', 'm-form-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const publicSet = documentRef.createElement('fieldset'); publicSet.className = 'm-form-section'; publicSet.append(makeText(documentRef, 'legend', 'Contenu public'));
        const titre = documentRef.createElement('input'); titre.type = 'text'; titre.id = 'm-enquete-titre'; titre.maxLength = 200;
        const description = documentRef.createElement('textarea'); description.id = 'm-enquete-description'; description.rows = 9;
        const decouvert = documentRef.createElement('input'); decouvert.type = 'checkbox'; decouvert.id = 'm-enquete-decouvert';
        const ordre = documentRef.createElement('input'); ordre.type = 'number'; ordre.id = 'm-enquete-ordre'; ordre.step = '1';
        const errors = {};
        const addField = (label, control, key, help = '') => { const wrapper = documentRef.createElement('div'); wrapper.className = 'm-form-field'; const labelNode = documentRef.createElement('label'); labelNode.setAttribute('for', control.id); labelNode.textContent = label; wrapper.append(labelNode, control); if (help) wrapper.append(makeText(documentRef, 'span', help, 'm-form-help')); const error = makeText(documentRef, 'span', '', 'm-form-error'); error.hidden = true; error.setAttribute('role', 'alert'); wrapper.append(error); errors[key] = error; publicSet.append(wrapper); return control; };
        addField('Titre *', titre, 'titre'); addField('Description *', description, 'description');
        const publication = documentRef.createElement('fieldset'); publication.className = 'm-form-section'; publication.append(makeText(documentRef, 'legend', 'Publication et classement'));
        const statusLabel = documentRef.createElement('label'); statusLabel.className = 'm-visibility-field'; statusLabel.append(decouvert, makeText(documentRef, 'span', 'Découvert — publier immédiatement texte, image et liens publics')); publication.append(statusLabel);
        const orderWrap = documentRef.createElement('div'); orderWrap.className = 'm-form-field'; orderWrap.append(makeText(documentRef, 'label', 'Ordre éditorial', ''), ordre); publication.append(orderWrap);
        const pickerHost = documentRef.createElement('div'); pickerHost.className = 'm-pnj-picker';
        const media = documentRef.createElement('div'); media.className = 'm-form-portrait-placeholder';
        const actions = documentRef.createElement('div'); actions.className = 'm-form-actions'; const cancel = documentRef.createElement('button'); cancel.type = 'button'; cancel.className = 'm-button'; cancel.textContent = 'Annuler'; const saveButton = documentRef.createElement('button'); saveButton.type = 'submit'; saveButton.className = 'm-button m-button-primary'; saveButton.textContent = 'Enregistrer'; actions.append(cancel, saveButton);
        const danger = documentRef.createElement('section'); danger.className = 'm-danger-zone'; const removeButton = documentRef.createElement('button'); removeButton.type = 'button'; removeButton.className = 'm-button m-button-danger'; removeButton.textContent = 'Supprimer cet indice'; removeButton.hidden = !id; const recoverButton = documentRef.createElement('button'); recoverButton.type = 'button'; recoverButton.className = 'm-button'; recoverButton.textContent = 'Reprendre le nettoyage'; recoverButton.hidden = true; danger.append(removeButton, recoverButton);
        form.append(summary, conflict, publicSet, publication, pickerHost, media, actions); screen.append(heading, status, form, danger); container.append(screen);
        refs = { form, summary, conflict, status, save: saveButton, cancel, remove: removeButton, recover: recoverButton, titre, description, decouvert, ordre, fields: { titre, description, decouvert, ordre }, errors };
        picker = createPnjPicker({ documentRef, getRepository: getPnjRepository, initial: [], onChange: () => { dirty = true; draftVersion += 1; scheduleDraft(); } }); picker.mount(pickerHost);
        portraitEditor = createPortraitEditor({
            container: media,
            document: documentRef,
            label: 'Illustration',
            helpText: 'Photo ou photothèque, source 20 Mo maximum, illustration finale 4:3.',
            previewClass: 'm-portrait-preview m-enquete-preview',
            previewAlt: 'Aperçu de l’illustration',
            removeLabel: 'Retirer l’illustration',
            removeConfirm: 'Retirer l’illustration lors de l’enregistrement ?',
            readyText: 'Illustration prête à être enregistrée.',
            invalidText: 'Illustration invalide.',
            currentText: 'Illustration actuelle. Cadrage 4:3 centré ; choisissez un fichier pour la remplacer.',
            removalText: 'L’illustration sera retirée à l’enregistrement.',
            previewUnavailableText: 'Aperçu de l’illustration indisponible.',
            processFile: (file, options) => processPortraitFile(file, {
                ...options,
                aspectRatio: 4 / 3,
            }),
            announce: message => showStatus(message, ERROR_KINDS.VALIDATION),
            onChange: state => {
                if (suppressPortraitChange) return;
                selectedImage = state.file;
                removeImageRequested = state.removalRequested === true;
                dirty = true;
                draftVersion += 1;
                scheduleDraft();
            },
        });
        const markDirty = () => { dirty = true; draftVersion += 1; scheduleDraft(); };
        [titre, description, decouvert, ordre].forEach(control => { control.addEventListener('input', markDirty); control.addEventListener('change', markDirty); });
        form.addEventListener('submit', event => { event.preventDefault(); void save(); }); cancel.addEventListener('click', () => { if (beforeLeave()) onBack(); }); removeButton.addEventListener('click', () => void remove()); recoverButton.addEventListener('click', () => void recover());
        abortHandler = () => unmount(); signal?.addEventListener?.('abort', abortHandler, { once: true });
        if (!id) { initialized = true; showStatus('Saisissez les informations de la nouvelle enquête.'); const draft = draftStore?.find?.(null); if (draft) { draftId = draft.draftId; if (container.ownerDocument.defaultView?.confirm?.('Restaurer le brouillon local de cette enquête ?')) { fill(draft.values); dirty = true; } } return; }
        const repo = getRepository(); if (!isMj(getSession) || typeof repo?.subscribeOne !== 'function') { showStatus('Session MJ requise.', ERROR_KINDS.PERMISSION); return; }
        const localGeneration = generation;
        const unsubscribe = repo.subscribeOne(id, item => {
            if (!mounted || localGeneration !== generation || !isMj(getSession)) return;
            if (!item) {
                latestItem = null;
                updatedAt = undefined;
                if (!dirty && typeof repo.inspectRemoval === 'function') {
                    void repo.inspectRemoval(id).then(inspected => {
                        if (!mounted || localGeneration !== generation || !isMj(getSession) || latestItem !== null) return;
                        if (inspected?.status === 'pending-cleanup') {
                            recoveryState = projectRecoveryState({
                                firestoreDone: true,
                                imageCleanupPending: true,
                                indiceId: id,
                            }, 'remove');
                            setBusy(false);
                            refs.recover.hidden = false;
                            showStatus('Une suppression confirmée attend encore le nettoyage. Reprenez la vérification.', ERROR_KINDS.CONFLICT);
                        }
                    }).catch(() => {});
                }
                showStatus(dirty
                    ? 'La fiche a été supprimée sur le serveur. Votre saisie locale est conservée.'
                    : 'Indice indisponible.', ERROR_KINDS.NOT_FOUND);
                return;
            }
            if (Array.isArray(item.issues) && item.issues.length > 0) {
                latestItem = null;
                updatedAt = undefined;
                showStatus('Cette enquête est indisponible.', ERROR_KINDS.NOT_FOUND);
                return;
            }
            latestItem = item;
            if (initialized && !dirty && timestampKey(item.updatedAt) !== timestampKey(updatedAt)) {
                fill(item);
                void portraitEditor?.setCurrentPath?.(item.image?.path, getImageService?.());
                showStatus('Version serveur rechargée.', 'saved');
            } else if (initialized && dirty && timestampKey(item.updatedAt) !== timestampKey(updatedAt)) {
                showStatus('La version serveur a changé. Votre saisie locale est conservée.', ERROR_KINDS.CONFLICT);
            }
            if (!initialized) {
                fill(item);
                void portraitEditor?.setCurrentPath?.(item.image?.path, getImageService?.());
                initialized = true;
                const draft = draftStore?.find?.(id);
                if (draft) {
                    draftId = draft.draftId;
                    if (container.ownerDocument.defaultView?.confirm?.('Restaurer le brouillon local de cette enquête ?')) {
                        fill(draft.values, { preserveServer: true });
                        dirty = true;
                        showStatus('Brouillon local restauré — non synchronisé.', 'draft');
                    }
                } else {
                    showStatus('Version serveur chargée.', 'saved');
                }
            }
        }, error => {
            if (!mounted || signalRef?.aborted || localGeneration !== generation || !isMj(getSession)) return;
            const uiError = errorForUi(error);
            showStatus(uiError.message, uiError.kind);
        });
        if (typeof unsubscribe === 'function') unsubs.push(unsubscribe);
    };
    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        if (draftTimer) globalThis.clearTimeout?.(draftTimer);
        draftTimer = null;
        if (dirty && !saving && !removing) persistDraft();
        cleanups();
        picker?.destroy?.();
        picker = null;
        portraitEditor?.destroy?.();
        portraitEditor = null;
        selectedImage = null;
        removeImageRequested = false;
        latestItem = null;
        updatedAt = undefined;
        dirty = false;
        saving = false;
        removing = false;
        recoveryState = null;
        pendingIntent = null;
        draftId = null;
        refs?.form?.remove?.();
        conflictButtons = [];
        signalRef?.removeEventListener?.('abort', abortHandler);
        container.replaceChildren();
        refs = null;
        signalRef = null;
        abortHandler = null;
        generation += 1;
    };
    return Object.freeze({ mount, unmount, beforeLeave });
}

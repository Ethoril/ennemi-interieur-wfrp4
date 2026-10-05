import { errorForUi, ERROR_KINDS } from '../../data/firebase-errors.js';
import { createPortraitEditor } from '../components/portrait-editor.js';
import { createPnjRelationsEditor } from '../components/pnj-relations-editor.js';
import { createGroupPicker } from '../../pnj-group-picker.js';
import { normalizeGroups, groupCatalog, pnjGroups } from '../../pnj-groups.js';
import { loadContentEditContext, mutateContentThroughGateway, newContributionOperationId, trashManagedContent, uploadManagedImage } from '../../contributions/managed-commands.js';

const STATUSES = Object.freeze(['', 'allié', 'neutre', 'ennemi']);
const LIVING = Object.freeze(['oui', 'non', 'inconnu']);
const MAX = Object.freeze({ nom: 200, statut: 64, vivant: 32, lieu: 200, groupe: 200, description: 20000, notes: 30000 });
const REVEAL_PENDING_NOTICE = ' Certaines relations n’ont pas pu être rendues visibles ; réenregistrez le PNJ pour réessayer.';

export function defaultPnjFormValues() {
    // Le bureau crée un PNJ comme vivant ; l’état « inconnu » reste disponible explicitement.
    return { nom: '', statut: '', vivant: 'oui', lieu: '', groupe: '', groupes: [], description: '', visibleJoueurs: true, notes: '', imagePath: null };
}

function normalizeParagraphs(value) {
    return typeof value === 'string'
        ? value.replace(/[^\S\r\n]+/gu, ' ').split(/\r?\n/u).map(line => line.trim()).join('\n').trim()
        : '';
}

function normalizeOneLine(value) { return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : ''; }

export function normalizePnjFormValues(input = {}) {
    input = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const defaults = defaultPnjFormValues();
    const groupes = normalizeGroups(input.groupes ?? (input.groupe ? [input.groupe] : []));
    return {
        nom: normalizeOneLine(input.nom ?? defaults.nom),
        statut: normalizeOneLine(input.statut ?? defaults.statut),
        vivant: normalizeOneLine(input.vivant ?? defaults.vivant),
        lieu: normalizeOneLine(input.lieu ?? defaults.lieu),
        groupe: groupes[0] ?? '',
        groupes,
        description: normalizeParagraphs(input.description ?? defaults.description),
        visibleJoueurs: Object.hasOwn(input, 'visibleJoueurs') ? input.visibleJoueurs === true : defaults.visibleJoueurs,
        notes: normalizeParagraphs(input.notes ?? defaults.notes),
        imagePath: typeof input.imagePath === 'string' && input.imagePath ? input.imagePath : null,
    };
}

export function validatePnjForm(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const errors = {};
    for (const fieldName of ['nom', 'statut', 'vivant', 'lieu', 'groupe', 'description', 'notes']) {
        if (Object.hasOwn(source, fieldName) && typeof source[fieldName] !== 'string') errors[fieldName] = 'Ce champ doit être du texte.';
    }
    if (Object.hasOwn(source, 'groupes') && Array.isArray(source.groupes) && source.groupes.length > 20) errors.groupes = 'Un personnage peut avoir au maximum 20 groupes.';
    if (Object.hasOwn(source, 'groupes') && Array.isArray(source.groupes) && source.groupes.some(value => typeof value === 'string' && value.trim().length > 200)) errors.groupes = 'Un groupe ne peut pas dépasser 200 caractères.';
    if (Object.hasOwn(source, 'visibleJoueurs') && typeof source.visibleJoueurs !== 'boolean') {
        errors.visibleJoueurs = 'La visibilité doit être activée ou désactivée.';
    }
    if (Object.hasOwn(source, 'groupes') && (!Array.isArray(source.groupes) || source.groupes.some(value => typeof value !== 'string'))) errors.groupes = 'Les groupes doivent être une liste de textes.';
    const values = normalizePnjFormValues(source);
    if (values.groupes.length > 20) errors.groupes = 'Un personnage peut avoir au maximum 20 groupes.';
    if (values.groupes.some(group => group.length > 200)) errors.groupes = 'Un groupe ne peut pas dépasser 200 caractères.';
    if (!values.nom) errors.nom = 'Le nom est obligatoire.';
    for (const field of ['nom', 'statut', 'vivant', 'lieu', 'groupe', 'description', 'notes']) {
        if (typeof values[field] === 'string' && MAX[field] && values[field].length > MAX[field]) errors[field] = `Ce champ ne peut pas dépasser ${MAX[field]} caractères.`;
    }
    if (!STATUSES.includes(values.statut)) errors.statut = 'Choisissez un statut valide.';
    if (!LIVING.includes(values.vivant)) errors.vivant = 'Choisissez un état de vie valide.';
    if (!Object.hasOwn(source, 'visibleJoueurs')) errors.visibleJoueurs = 'La visibilité doit être activée ou désactivée.';
    return Object.freeze({ valid: Object.keys(errors).length === 0, values, errors: Object.freeze(errors) });
}

function isGm(getSession) {
    const value = typeof getSession === 'function' ? getSession() : getSession;
    const state = value?.getState?.() || value;
    return state?.status === 'gm' && state?.role === 'mj' && typeof state?.user?.uid === 'string' && state.user.uid.length > 0;
}

function safePortraitPath(value, ownerId) {
    if (typeof value !== 'string' || typeof ownerId !== 'string') return null;
    const prefix = `portraits/${ownerId}/`;
    if (!value.startsWith(prefix) || value.length <= prefix.length || value.length > prefix.length + 128) return null;
    const leaf = value.slice(prefix.length);
    return !['.', '..'].includes(leaf) && /^[A-Za-z0-9._-]+$/u.test(leaf) ? value : null;
}

function text(documentRef, tag, value, className = '') {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
}

function field(documentRef, form, { name, label, type = 'text', help = '', required = false, options = [] }) {
    const wrapper = documentRef.createElement('div');
    wrapper.className = 'm-form-field';
    const id = `m-pnj-${name}`;
    const labelNode = documentRef.createElement('label');
    labelNode.setAttribute('for', id);
    labelNode.textContent = label + (required ? ' *' : '');
    wrapper.append(labelNode);
    let control;
    if (type === 'textarea') {
        control = documentRef.createElement('textarea');
        control.rows = name === 'description' || name === 'notes' ? 7 : 3;
    } else if (type === 'select') {
        control = documentRef.createElement('select');
        for (const option of options) {
            const item = documentRef.createElement('option');
            item.value = option.value;
            item.textContent = option.label;
            control.append(item);
        }
    } else {
        control = documentRef.createElement('input');
        control.type = type;
    }
    control.id = id;
    control.name = name;
    control.dataset.field = name;
    if (required) control.required = true;
    if (MAX[name]) control.maxLength = MAX[name];
    const describedBy = [];
    if (help) {
        const helpNode = text(documentRef, 'span', help, 'm-form-help');
        helpNode.id = `${id}-help`;
        describedBy.push(helpNode.id);
        wrapper.append(control, helpNode);
    } else wrapper.append(control);
    const error = text(documentRef, 'span', '', 'm-form-error');
    error.id = `${id}-error`;
    error.setAttribute('role', 'alert');
    error.hidden = true;
    wrapper.append(error);
    describedBy.push(error.id);
    control.setAttribute('aria-describedby', describedBy.join(' '));
    form.append(wrapper);
    return { wrapper, control, error };
}

function readControl(control) {
    if (control.type === 'checkbox') return control.checked === true;
    return control.value;
}

function setControl(control, value) {
    if (control.type === 'checkbox') control.checked = value === true;
    else control.value = value ?? '';
}

function classify(error) {
    return errorForUi(error).kind;
}

function impactMessage(impact) {
    const parts = [`« ${impact.name || 'PNJ sans nom'} »`, `${impact.relationsCount} relation${impact.relationsCount === 1 ? '' : 's'}`, `${impact.indicesCount} indice${impact.indicesCount === 1 ? '' : 's'}`];
    if (impact.hasPortrait) parts.push('un portrait');
    if (impact.hasPrivateNotes) parts.push('des notes privées');
    return `La suppression retirera ${parts.join(', ')}. Cette action est irréversible.`;
}

export function createPnjEditView({ container, id = null, repository = null, getRepository = () => repository,
    getImageService = () => null, getRelationsRepository = () => null, getPnjRepository = getRepository,
    getContributionClient = () => null, portraitProcessor = null, draftStore = null, isOnline = () => true,
    getSession = () => ({ status: 'visitor' }), onNavigate = () => {}, onBack = () => {}, announce = () => {} } = {}) {
    let mounted = false;
    let generation = 0;
    let signalRef = null;
    let unsubs = [];
    let refs = null;
    let initialUpdatedAt;
    let initialPrivateUpdatedAt;
    let initialContributionContextPromise = null;
    let initialValues = defaultPnjFormValues();
    let saving = false;
    let removing = false;
    let initialized = false;
    let currentImpact = null;
    let loadedPublicSignature = null;
    let loadedPrivateSignature = null;
    let dirtyFields = new Set();
    let draftVersion = 0;
    let recoveryLocked = false;
    let portraitEditor = null;
    let initialPortraitReference = null;
    let reservedCreateId = null;
    let portraitDirty = false;
    let imageRecoveryLocked = false;
    let imageRecoveryState = null;
    let relationsEditor = null;
    let groupPicker = null;
    let draftTimer = null;
    let draftId = null;
    let draftPrompted = false;
    let latestPublicItem = null;
    let latestPrivateItem = null;
    let currentEditContext = null;

    const cleanup = () => { for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe?.(); } catch { /* best-effort */ } } };
    const setBusy = busy => {
        saving = busy;
        if (!refs) return;
        refs.save.disabled = busy || removing || recoveryLocked;
        refs.cancel.disabled = saving || removing;
        refs.remove.disabled = busy || removing || recoveryLocked;
        refs.conflict?.querySelectorAll?.('button').forEach(button => { button.disabled = busy || removing || recoveryLocked || imageRecoveryLocked; });
        refs.save.textContent = busy ? 'Enregistrement…' : 'Enregistrer';
        for (const { control } of Object.values(refs.fields)) control.disabled = busy || removing || recoveryLocked;
        groupPicker?.setDisabled?.(busy || removing || recoveryLocked);
        portraitEditor?.setDisabled?.(busy || removing || recoveryLocked || imageRecoveryLocked);
        relationsEditor?.setDisabled?.(busy || removing || recoveryLocked || imageRecoveryLocked);
    };
    const renderErrors = errors => {
        if (!refs) return;
        refs.summary.replaceChildren();
        const keys = Object.keys(errors);
        refs.summary.hidden = !keys.length;
        if (keys.length) {
            refs.summary.append(text(container.ownerDocument, 'strong', 'Corrigez les erreurs suivantes :'));
            const list = container.ownerDocument.createElement('ul');
            for (const key of keys) {
                const item = container.ownerDocument.createElement('li');
                const link = container.ownerDocument.createElement('a');
                const fieldKey = key === 'groupes' ? 'groupe' : key;
                link.href = `#m-pnj-${fieldKey}`;
                link.textContent = errors[key];
                link.addEventListener('click', event => {
                    event.preventDefault();
                    refs.fields[fieldKey]?.control?.focus?.();
                });
                item.append(link);
                list.append(item);
            }
            refs.summary.append(list);
        }
        for (const [key, value] of Object.entries(refs.fields)) {
            if (key === 'groupe' && groupPicker) { value.error.textContent = errors.groupes || errors.groupe || ''; value.error.hidden = !value.error.textContent; if (value.error.hidden) value.control.removeAttribute('aria-invalid'); else value.control.setAttribute('aria-invalid', 'true'); continue; }
            const message = errors[key] || '';
            value.error.textContent = message;
            value.error.hidden = !message;
            if (message) value.control.setAttribute('aria-invalid', 'true');
            else value.control.removeAttribute('aria-invalid');
        }
        if (keys.length) refs.fields[keys[0] === 'groupes' ? 'groupe' : keys[0]]?.control?.focus?.();
    };
    const fill = (values, fieldsToFill = null) => {
        for (const [key, value] of Object.entries(refs.fields)) {
            if (key === 'groupe' && groupPicker) { if (!fieldsToFill || fieldsToFill.has(key) || fieldsToFill.has('groupes')) groupPicker.setGroups(values.groupes ?? (values.groupe ? [values.groupe] : [])); continue; }
            if (!fieldsToFill || fieldsToFill.has(key)) setControl(value.control, values[key]);
        }
    };
    const valuesFromForm = () => { const values = Object.fromEntries(Object.entries(refs.fields).map(([key, value]) => [key, readControl(value.control)])); values.groupes = groupPicker?.getGroups?.() ?? normalizeGroups(values.groupe ? [values.groupe] : []); values.groupe = values.groupes[0] || ''; return values; };
    const hasChanges = () => JSON.stringify(normalizePnjFormValues(valuesFromForm())) !== JSON.stringify(normalizePnjFormValues(initialValues)) || portraitDirty;
    const beforeLeave = () => {
        if (!mounted || !refs) return true;
        if (saving || removing) {
            showStatus('Une mutation est en cours. Attendez sa confirmation avant de quitter.', ERROR_KINDS.CONFLICT);
            return false;
        }
        if (relationsEditor?.beforeLeave && !relationsEditor.beforeLeave()) return false;
        const confirm = container.ownerDocument.defaultView?.confirm;
        if (recoveryLocked || imageRecoveryLocked) return typeof confirm !== 'function' || confirm('Un nettoyage de portrait doit être repris avant de quitter cette fiche. Continuer ?');
        if (!hasChanges()) return true;
        // Le public est sauvegardé localement de façon synchrone avant le départ;
        // les notes et la photo restent volontairement en mémoire uniquement.
        const persisted = persistDraft();
        const message = persisted?.ok
            ? 'Les champs publics seront conservés localement ; les notes et la photo en mémoire seront perdus. Quitter ?'
            : 'La sauvegarde locale des champs publics a échoué ; quitter fera perdre la saisie, les notes et la photo. Quitter ?';
        showStatus(persisted?.ok ? 'Champs publics conservés localement ; notes et photo en mémoire seront perdus en quittant.' : 'Sauvegarde locale indisponible ; la saisie sera perdue en quittant.', persisted?.ok ? 'draft' : ERROR_KINDS.UNKNOWN);
        return typeof confirm !== 'function' || confirm(message);
    };
    const showStatus = (message, kind = '') => { if (!refs) return; refs.status.textContent = message; refs.status.dataset.kind = kind; refs.status.setAttribute('aria-label', message); };
    const draftValues = () => {
        if (!refs) return null;
        const values = valuesFromForm();
        return { nom: values.nom, statut: values.statut, vivant: values.vivant, lieu: values.lieu, groupe: values.groupe, groupes: values.groupes, description: values.description, visibleJoueurs: values.visibleJoueurs };
    };
    const persistDraft = () => {
        if (!draftStore || !dirtyFields.size) return null;
        const result = draftStore.save(draftValues(), { pnjId: id, draftId });
        if (result?.ok && result.draft) draftId = result.draft.draftId;
        return result;
    };
    const removeCurrentDraft = () => {
        if (!draftStore) return false;
        const candidates = new Set();
        if (draftId) candidates.add(draftId);
        if (id !== null && id !== undefined) {
            const current = draftStore.find?.(id);
            if (current?.draftId) candidates.add(current.draftId);
            for (const item of draftStore.list?.() || []) if (item?.pnjId === id && item.draftId) candidates.add(item.draftId);
        } else if (!candidates.size) {
            const local = draftStore.find?.(null);
            if (local?.draftId) candidates.add(local.draftId);
        }
        let removed = false;
        for (const candidate of candidates) removed = draftStore.remove?.(candidate) === true || removed;
        if (removed) draftId = null;
        return removed;
    };
    const flushDraft = () => {
        if (draftTimer) globalThis.clearTimeout?.(draftTimer);
        draftTimer = null;
        if (dirtyFields.size && !saving) persistDraft();
    };
    const scheduleDraft = () => {
        if (!draftStore || !mounted || !dirtyFields.size || saving) return;
        if (draftTimer) globalThis.clearTimeout?.(draftTimer);
        draftTimer = globalThis.setTimeout?.(() => {
            draftTimer = null;
            const result = persistDraft();
            if (result?.ok && result.draft) { draftId = result.draft.draftId; showStatus('✎ Brouillon local — non synchronisé.', 'draft'); announce('Brouillon local conservé.'); }
            else if (result && !result.ok) showStatus('Brouillon local indisponible. Les champs restent en mémoire.', ERROR_KINDS.UNKNOWN);
        }, 400);
    };
    const offerDraft = () => {
        if (!draftStore || draftPrompted || !mounted) return;
        draftPrompted = true;
        const draft = draftStore.find(id);
        if (!draft) return;
        const date = new Date(draft.updatedAt).toLocaleString('fr-FR');
        const restore = container.ownerDocument.defaultView?.confirm?.(`Un brouillon public local du ${date} est disponible. Restaurer les champs publics ?`);
        if (restore) {
            draftId = draft.draftId;
            const publicFields = new Set(['nom', 'statut', 'vivant', 'lieu', 'groupe', 'groupes', 'description', 'visibleJoueurs']);
            const restored = { ...initialValues, ...draft.values };
            if (!Object.hasOwn(draft.values, 'groupes') && Object.hasOwn(draft.values, 'groupe')) {
                restored.groupes = normalizeGroups([draft.values.groupe]);
            }
            fill(restored, publicFields); publicFields.forEach(fieldName => dirtyFields.add(fieldName)); draftVersion += 1;
            showStatus('✎ Brouillon local restauré — non synchronisé.', 'draft'); announce('Brouillon local restauré.');
        } else { draftId = draft.draftId; announce('Brouillon local conservé ; vous pourrez le restaurer depuis cette fiche.'); }
    };
    const clearConflict = () => { refs?.conflict?.replaceChildren(); refs?.conflict && (refs.conflict.hidden = true); };
    const showConflict = () => {
        if (!refs?.conflict) return;
        refs.conflict.replaceChildren(); refs.conflict.hidden = false;
        refs.conflict.append(text(container.ownerDocument, 'strong', 'Conflit : la fiche a changé ailleurs.'));
        const changed = Object.keys(valuesFromForm()).filter(fieldName => fieldName !== 'notes' && dirtyFields.has(fieldName));
        refs.conflict.append(text(container.ownerDocument, 'p', changed.length ? `Champs locaux modifiés : ${changed.join(', ')}.` : 'Votre saisie locale est conservée.'));
        const reload = container.ownerDocument.createElement('button'); reload.type = 'button'; reload.className = 'm-button'; reload.textContent = 'Recharger le serveur';
        const copy = container.ownerDocument.createElement('button'); copy.type = 'button'; copy.className = 'm-button'; copy.textContent = 'Copier le texte local';
        const force = container.ownerDocument.createElement('button'); force.type = 'button'; force.className = 'm-button m-button-danger'; force.textContent = 'Forcer après confirmation MJ';
        force.disabled = portraitDirty;
        if (portraitDirty) force.setAttribute('aria-label', 'Rechargez le conflit avant de forcer : le portrait local est encore en attente.');
        reload.addEventListener('click', () => {
            if (!latestPublicItem || saving || removing || recoveryLocked || imageRecoveryLocked) return;
            const server = { ...latestPublicItem, groupe: pnjGroups(latestPublicItem)[0] || '', groupes: latestPublicItem.groupes, notes: latestPrivateItem?.notes ?? '' };
            fill(server); initialValues = normalizePnjFormValues(server); initialUpdatedAt = latestPublicItem.updatedAt ?? null; initialPrivateUpdatedAt = latestPrivateItem?.updatedAt ?? null;
            initialPortraitReference = latestPublicItem.imagePath || latestPublicItem.imageUrl || null;
            loadedPublicSignature = JSON.stringify([latestPublicItem.nom, latestPublicItem.statut, latestPublicItem.vivant, latestPublicItem.lieu, latestPublicItem.groupe, latestPublicItem.groupes, latestPublicItem.description, latestPublicItem.visibleJoueurs, latestPublicItem.imagePath, latestPublicItem.updatedAt]);
            loadedPrivateSignature = JSON.stringify([latestPrivateItem?.updatedAt, latestPrivateItem?.notes ?? '']);
            dirtyFields.clear(); draftVersion += 1; portraitDirty = false; portraitEditor?.reset?.(); void portraitEditor?.setCurrentPath?.(initialPortraitReference, getImageService?.()); removeCurrentDraft(); clearConflict();
            if (!recoveryLocked && !imageRecoveryLocked && !saving && !removing) {
                for (const { control } of Object.values(refs.fields)) control.disabled = false;
                refs.save.disabled = false; refs.remove.disabled = false; groupPicker?.setDisabled?.(false); portraitEditor?.setDisabled?.(false); relationsEditor?.setDisabled?.(false);
            }
            showStatus('Version serveur rechargée.', 'saved');
        });
        copy.addEventListener('click', async () => {
            const values = draftValues(); const textValue = Object.entries(values).map(([key, value]) => `${key}: ${String(value)}`).join('\n');
            const operation = captureOperation();
            try { await globalThis.navigator?.clipboard?.writeText?.(textValue); if (currentOperation(operation)) announce('Texte public local copié.'); } catch { if (currentOperation(operation)) showStatus('Copie indisponible ; votre saisie reste conservée.', ERROR_KINDS.UNKNOWN); }
        });
        force.addEventListener('click', () => { if (container.ownerDocument.defaultView?.confirm?.('Forcer l’écriture et remplacer la version distante ? Cette action est réservée au MJ.')) void forceSaveConflict(); });
        refs.conflict.append(reload, copy, force);
    };
    const forceSaveConflict = async () => {
        if (!id || !getRepository()?.forceUpdate || portraitDirty || !isGm(getSession)
            || recoveryLocked || imageRecoveryLocked || saving || removing) return;
        if (isOnline?.() === false) { showStatus('Hors ligne. La version distante n’est pas modifiée.', 'offline'); return; }
        const operation = captureOperation(); if (!operation) return;
        setBusy(true); showStatus('Enregistrement…', 'saving');
        try {
            const values = validatePnjForm(valuesFromForm()); if (!values.valid) { renderErrors(values.errors); setBusy(false); return; }
            const forced = await getRepository().forceUpdate(id, {
                nom: values.values.nom, statut: values.values.statut, vivant: values.values.vivant, lieu: values.values.lieu,
                groupe: values.values.groupe, groupes: values.values.groupes, description: values.values.description, visibleJoueurs: values.values.visibleJoueurs,
            }, { notes: values.values.notes }, { confirmed: true });
            if (!currentOperation(operation)) return;
            if (draftVersion !== operation.draftVersion) { setBusy(false); showStatus('La saisie a changé pendant le forçage. Vérifiez puis relancez.', ERROR_KINDS.CONFLICT); return; }
            removeCurrentDraft(); clearConflict(); onNavigate(`#/pnjs/${encodeURIComponent(id)}`); announce(`PNJ enregistré après confirmation MJ.${forced?.relationsRevealPending === true ? REVEAL_PENDING_NOTICE : ''}`);
        } catch (error) {
            if (currentOperation(operation)) {
                setBusy(false);
                if (error?.kind === ERROR_KINDS.NOT_FOUND || error?.code === 'not-found') {
                    clearConflict(); showStatus('Ce PNJ a été supprimé ailleurs. Il ne sera pas recréé automatiquement.', ERROR_KINDS.NOT_FOUND);
                } else showStatus('Échec — réessayez.', ERROR_KINDS.UNKNOWN);
            }
        }
    };
    const fail = error => { const ui = errorForUi(error); showStatus(ui.message, ui.kind); setBusy(false); };
    const sessionState = () => {
        const value = typeof getSession === 'function' ? getSession() : getSession;
        return value?.getState?.() || value || {};
    };
    const captureOperation = () => {
        const state = sessionState();
        if (!mounted || signalRef?.aborted || state.status !== 'gm' || state.role !== 'mj'
            || typeof state.user?.uid !== 'string' || !state.user.uid) return null;
        return Object.freeze({ generation, uid: state.user.uid, userUid: state.user.uid, id, mountGeneration: generation, draftVersion });
    };
    const currentOperation = operation => {
        if (!operation || !mounted || signalRef?.aborted || generation !== operation.generation || id !== operation.id) return false;
        const state = sessionState();
        return state.status === 'gm' && state.role === 'mj' && state.user?.uid === operation.uid;
    };

    const save = async event => {
        event?.preventDefault?.();
        if (!mounted || saving || removing || recoveryLocked || imageRecoveryLocked) return;
        if (!isGm(getSession)) { showStatus('La session MJ n’est plus valide. Vos saisies sont conservées.', ERROR_KINDS.PERMISSION); return; }
        if (draftStore && dirtyFields.size) persistDraft();
        if (isOnline?.() === false) { showStatus('Hors ligne. Le brouillon public local est conservé ; aucune écriture MJ n’est lancée.', 'offline'); return; }
        const operation = captureOperation();
        if (!operation) { showStatus('La session MJ n’est plus valide. Vos saisies sont conservées.', ERROR_KINDS.PERMISSION); return; }
        if (!initialized) { showStatus('Le formulaire n’est pas encore prêt.', ERROR_KINDS.NOT_FOUND); return; }
        const result = validatePnjForm(valuesFromForm());
        renderErrors(result.errors);
        if (!result.valid) { showStatus('Le formulaire contient des erreurs.', ERROR_KINDS.VALIDATION); return; }
        const repo = getRepository();
        if (!repo) { showStatus('Le dépôt MJ est indisponible.', ERROR_KINDS.PERMISSION); return; }
        setBusy(true);
        showStatus('Enregistrement…', 'saving');
        try {
            const publicInput = { nom: result.values.nom, statut: result.values.statut, vivant: result.values.vivant,
                lieu: result.values.lieu, groupe: result.values.groupe, groupes: result.values.groupes, description: result.values.description,
                visibleJoueurs: result.values.visibleJoueurs };
            const privateInput = { notes: result.values.notes };
            const portraitState = portraitEditor?.getState?.() ?? { file: null, removalRequested: false };
            if (portraitState.processing) {
                setBusy(false); showStatus('Le portrait est encore en préparation. Attendez sa validation.', ERROR_KINDS.CONFLICT); return;
            }
            const imageService = getImageService?.();
            if (id) {
                const contributionClient = getContributionClient?.();
                const editContext = await initialContributionContextPromise;
                if (!currentOperation(operation)) return;
                if (!editContext) throw Object.assign(new Error('Contexte versionné indisponible.'), { code: 'failed-precondition' });
                const changes = {};
                const candidates = { nom: publicInput.nom, statut: publicInput.statut, vivant: publicInput.vivant, lieu: publicInput.lieu,
                    groupes: publicInput.groupes, description: publicInput.description, visibleJoueurs: publicInput.visibleJoueurs };
                for (const [field, value] of Object.entries(candidates)) {
                    const before = Object.hasOwn(editContext.data, field) ? editContext.data[field] : null;
                    if (JSON.stringify(value) !== JSON.stringify(before)) changes[field] = value;
                }
                if (portraitState.file) changes.imagePath = await uploadManagedImage(contributionClient, { kind: 'portrait', ownerId: id, file: portraitState.file });
                else if (portraitState.removalRequested && initialPortraitReference) changes.imagePath = null;
                if (Object.keys(changes).length) await mutateContentThroughGateway(contributionClient, editContext, {
                    kind: 'pnj', id, changes, operationId: newContributionOperationId(),
                });
                if (!currentOperation(operation)) return;
                if (draftVersion !== operation.draftVersion) {
                    setBusy(false);
                    persistDraft();
                    showStatus('Les champs ont changé pendant l’enregistrement. Votre saisie locale est conservée.', ERROR_KINDS.CONFLICT);
                    showConflict();
                    return;
                }
                if (privateInput.notes !== (latestPrivateItem?.notes ?? '')) {
                    await repo.updatePrivateOnly(id, privateInput, initialPrivateUpdatedAt);
                }
                if (Object.hasOwn(changes, 'imagePath') && initialPortraitReference && imageService?.remove) {
                    try { await imageService.remove(initialPortraitReference, { kind: 'portrait', ownerId: id, collection: 'pnjs' }); }
                    catch { showStatus('PNJ enregistré; le nettoyage de l’ancien portrait reste à reprendre.', ERROR_KINDS.CONFLICT); }
                }
                if (!currentOperation(operation)) return;
                removeCurrentDraft();
                onNavigate(`#/pnjs/${encodeURIComponent(id)}`);
                announce('PNJ enregistré par la passerelle versionnée.');
                return;
            }
            if (!reservedCreateId) {
                if (typeof repo.reserveId !== 'function') throw Object.assign(new Error('reserve-pnj-id-unavailable'), { code: 'failed-precondition' });
                reservedCreateId = repo.reserveId();
            }
            const client = getContributionClient?.();
            if (!client?.mutatePublicContent) throw Object.assign(new Error('Passerelle indisponible.'), { code: 'failed-precondition' });
            const operationId = newContributionOperationId();
            const changes = { ...publicInput };
            if (portraitState.file) changes.imagePath = await uploadManagedImage(client, { kind: 'portrait', ownerId: reservedCreateId,
                file: portraitState.file, operationId });
            if (!currentOperation(operation) || draftVersion !== operation.draftVersion) return;
            const created = await client.mutatePublicContent({ kind: 'pnj', action: 'create', id: reservedCreateId,
                operationId, baseRevision: 0, changes });
            if (!currentOperation(operation)) return;
            if (privateInput.notes) {
                try { await repo.updatePrivateOnly(reservedCreateId, privateInput); }
                catch { showStatus('PNJ public créé ; les notes privées n’ont pas pu être enregistrées.', ERROR_KINDS.CONFLICT); }
            }
            const savedId = created?.id || reservedCreateId;
            removeCurrentDraft();
            onNavigate(`#/pnjs/${encodeURIComponent(savedId)}`);
            announce('PNJ créé par la passerelle versionnée.');
            showStatus('✓ Enregistré.', 'saved');
        } catch (error) {
            if (!currentOperation(operation)) return;
            if (error?.state?.cleanupPending === true || error?.state?.commitUnknown === true || error?.state?.commitDone === true
                || error?.state?.journalPending === true || error?.state?.commitNotStarted === true) exposeImageRecovery(error.state);
            else if (error?.kind === ERROR_KINDS.CONFLICT || error?.code === 'conflict') { setBusy(false); showStatus('Conflit : aucune donnée distante n’a été écrasée.', ERROR_KINDS.CONFLICT); showConflict(); }
            else fail(error);
        }
    };

    const showImpact = async () => {
        if (!mounted || saving || removing || !id) return;
        if (isOnline?.() === false) { showStatus('Hors ligne. L’impact ne peut pas être recalculé.', 'offline'); return; }
        if (!isGm(getSession)) { showStatus('La session MJ n’est plus valide.', ERROR_KINDS.PERMISSION); return; }
        const operation = captureOperation();
        if (!operation) { showStatus('La session MJ n’est plus valide.', ERROR_KINDS.PERMISSION); return; }
        const repo = getRepository();
        if (!repo?.inspectRemovalImpact) { showStatus('L’aperçu de suppression est indisponible.'); return; }
        currentImpact = null;
        refs.confirmation.hidden = true;
        refs.confirmationButton.hidden = false;
        refs.confirmationButton.disabled = false;
        refs.resumeButton.hidden = true;
        refs.remove.disabled = true;
        showStatus('Calcul de l’impact…');
        try {
            const impact = await repo.inspectRemovalImpact(id);
            if (!currentOperation(operation)) return;
            currentEditContext = await initialContributionContextPromise;
            if (!currentEditContext) throw Object.assign(new Error('Contexte versionné indisponible.'), { code: 'failed-precondition' });
            currentImpact = { ...impact, managed: Boolean(currentEditContext) };
            refs.confirmation.hidden = false;
            refs.confirmationText.textContent = currentImpact.managed
                ? `« ${impact.name || 'Ce PNJ'} » et ses dépendances publiques seront placés en corbeille; restauration possible depuis la corbeille.`
                : impactMessage(currentImpact);
            refs.confirmationButton.focus?.();
            showStatus('Vérifiez l’impact avant de confirmer.');
        } catch (error) { if (currentOperation(operation)) fail(error); }
        finally { if (currentOperation(operation) && !removing) refs.remove.disabled = false; }
    };
    const exposeRecovery = state => {
        recoveryLocked = true;
        currentImpact = null;
        removing = false;
        setBusy(false);
        refs.save.disabled = true;
        refs.remove.disabled = true;
        for (const { control } of Object.values(refs.fields)) control.disabled = true;
        groupPicker?.setDisabled?.(true);
        refs.confirmation.hidden = false;
        refs.confirmationButton.hidden = true;
        refs.resumeButton.hidden = false;
        refs.resumeButton.disabled = false;
        refs.recoverImageButton.hidden = true; refs.recoverImageButton.textContent = 'Reprendre le nettoyage du portrait';
        if (state?.firestoreDone) showStatus('La suppression est enregistrée, mais le nettoyage reste à reprendre.', ERROR_KINDS.UNKNOWN);
        else showStatus('La suppression est interrompue et son verrou doit être repris.', ERROR_KINDS.CONFLICT);
    };
    const exposeImageRecovery = state => {
        imageRecoveryLocked = true;
        const ownerId = id || reservedCreateId;
        imageRecoveryState = Object.freeze({
            newPath: safePortraitPath(state?.newPath ?? state?.uploadedPath, ownerId),
            oldPath: safePortraitPath(state?.oldPath, ownerId) || safePortraitPath(initialPortraitReference, ownerId),
            creation: id === null,
            ownerId,
            commitDone: state?.commitDone === true,
            commitUnknown: state?.commitUnknown === true,
            commitNotStarted: state?.commitNotStarted === true || state?.journalPending === true,
            previousUpdatedAt: initialUpdatedAt,
            previousPrivateUpdatedAt: initialPrivateUpdatedAt,
        });
        saving = false; removing = false; currentImpact = null;
        setBusy(false);
        refs.save.disabled = true; refs.remove.disabled = true;
        refs.confirmation.hidden = false; refs.confirmationButton.hidden = true; refs.resumeButton.hidden = true;
        refs.recoverImageButton.hidden = false; refs.recoverImageButton.textContent = 'Reprendre le nettoyage du portrait'; refs.recoverImageButton.disabled = false;
        showStatus(state?.commitNotStarted || state?.journalPending
            ? 'Le portrait a été reçu mais son nettoyage sécurisé doit être repris avant toute nouvelle sauvegarde.'
            : state?.commitUnknown ? 'Le résultat de l’enregistrement du portrait est incertain. Reprenez le nettoyage avant toute nouvelle sauvegarde.'
                : 'Le portrait est enregistré mais son ancien fichier reste à nettoyer. Reprenez le nettoyage.', ERROR_KINDS.CONFLICT);
    };
    const recoverImage = async () => {
        if (!mounted || saving || removing) return;
        if (isOnline?.() === false) { showStatus('Hors ligne. La reprise est différée.', 'offline'); return; }
        const operation = captureOperation(); const imageService = getImageService?.(); const repo = getRepository();
        if (!operation || (typeof imageService?.recover !== 'function' && typeof imageService?.cleanupImage !== 'function')) return;
        const context = imageRecoveryState;
        saving = true; refs.recoverImageButton.disabled = true; showStatus('Reprise du nettoyage du portrait…');
        try {
            const acknowledge = path => { if (path && typeof imageService.ackUpload === 'function') imageService.ackUpload(path); };
            if (context?.commitNotStarted) {
                if (!context.newPath || typeof imageService.cleanupImage !== 'function') throw Object.assign(new Error('image-cleanup-service'), { code: 'failed-precondition' });
                const cleanupResult = await imageService.cleanupImage(context.newPath, { collection: 'pnjs', ownerId: context.ownerId, skipJournal: true });
                if (!currentOperation(operation)) return;
                if (cleanupResult?.retryNeeded === true || cleanupResult?.status === 'busy') {
                    saving = false; refs.recoverImageButton.disabled = false;
                    showStatus('Le nettoyage du portrait reste en attente ; aucun succès n’est confirmé.', ERROR_KINDS.CONFLICT);
                    return;
                }
                acknowledge(context.newPath);
                imageRecoveryLocked = false; imageRecoveryState = null; saving = false; refs.recoverImageButton.hidden = true; setBusy(false);
                showStatus('Le portrait non enregistré a été nettoyé. Votre saisie est conservée.');
                return;
            }
            if (!context?.newPath && context?.oldPath) {
                if (typeof imageService.cleanupImage !== 'function') throw Object.assign(new Error('image-cleanup-service'), { code: 'failed-precondition' });
                await imageService.cleanupImage(context.oldPath, { collection: 'pnjs', ownerId: context.ownerId, skipJournal: true });
                if (!currentOperation(operation)) return;
                acknowledge(context.oldPath);
                removeCurrentDraft();
                imageRecoveryLocked = false; imageRecoveryState = null; saving = false; refs.recoverImageButton.hidden = true; setBusy(false);
                onNavigate('#/pnjs'); announce('Nettoyage de l’ancien portrait repris ; liste rechargée.');
                return;
            }
            if (context?.newPath && context.ownerId && typeof repo?.inspectPortraitCommit === 'function') {
                const inspected = await repo.inspectPortraitCommit(context.ownerId, context.newPath, {
                    creation: context.creation,
                    previousUpdatedAt: context.previousUpdatedAt,
                    previousPrivateUpdatedAt: context.previousPrivateUpdatedAt,
                });
                if (!currentOperation(operation)) return;
                if (inspected.status === 'committed') {
                    if (context.oldPath && context.oldPath !== context.newPath) {
                        if (typeof imageService.cleanupImage !== 'function') throw Object.assign(new Error('image-cleanup-service'), { code: 'failed-precondition' });
                        await imageService.cleanupImage(context.oldPath, { collection: 'pnjs', ownerId: context.ownerId, skipJournal: true });
                        if (!currentOperation(operation)) return;
                    }
                    acknowledge(context.oldPath); acknowledge(context.newPath);
                    removeCurrentDraft();
                    onNavigate(context.creation ? `#/pnjs/${encodeURIComponent(context.ownerId)}` : `#/pnjs/${encodeURIComponent(context.ownerId)}`);
                    announce('Portrait enregistré ; fiche rechargée.');
                    return;
                }
                if (inspected.status === 'inconsistent') {
                    saving = false; refs.recoverImageButton.disabled = false;
                    showStatus('Le résultat du portrait reste incohérent. Aucune nouvelle écriture n’est autorisée.', ERROR_KINDS.CONFLICT);
                    return;
                }
                if (inspected.status === 'not-committed' && context.newPath) {
                    if (typeof imageService.cleanupImage !== 'function') throw Object.assign(new Error('image-cleanup-service'), { code: 'failed-precondition' });
                    await imageService.cleanupImage(context.newPath, { collection: 'pnjs', ownerId: context.ownerId, skipJournal: true });
                    if (!currentOperation(operation)) return;
                    acknowledge(context.oldPath); acknowledge(context.newPath);
                    imageRecoveryLocked = false; imageRecoveryState = null; saving = false; refs.recoverImageButton.hidden = true; setBusy(false);
                    showStatus('Le portrait non enregistré a été nettoyé. Votre saisie est conservée.');
                    return;
                }
            }
            const recovery = typeof imageService.recover === 'function' ? await imageService.recover() : null;
            if (!currentOperation(operation)) return;
            saving = false;
            if (recovery?.retryNeeded === true || recovery?.status === 'busy') {
                refs.recoverImageButton.disabled = false;
                showStatus('Le nettoyage du portrait reste en attente ; aucun succès n’est confirmé.', ERROR_KINDS.CONFLICT);
                return;
            }
            // Une reprise ne réactive jamais le brouillon courant : le commit peut
            // avoir abouti pendant la panne. Le remount relit public/private et ses
            // timestamps avant toute nouvelle écriture.
            if (context?.creation && context.ownerId) {
                // The image was certainly not referenced; keep the draft and ID
                // in this view after deterministic cleanup.
                imageRecoveryLocked = false; imageRecoveryState = null; refs.recoverImageButton.hidden = true; setBusy(false);
                showStatus('Le portrait non enregistré a été nettoyé. Votre saisie est conservée.');
                return;
            }
            onNavigate(id ? `#/pnjs/${encodeURIComponent(id)}` : '#/pnjs');
            removeCurrentDraft();
            announce('Nettoyage du portrait repris ; fiche rechargée.');
        } catch (error) {
            if (!currentOperation(operation)) return;
            saving = false; refs.recoverImageButton.disabled = false; showStatus(errorForUi(error).message, errorForUi(error).kind);
        }
    };
    const confirmRemoval = async () => {
        if (!mounted || removing || !id || !currentImpact) return;
        if (isOnline?.() === false) { showStatus('Hors ligne. La suppression n’est pas lancée.', 'offline'); return; }
        if (!isGm(getSession)) { showStatus('La session MJ n’est plus valide.', ERROR_KINDS.PERMISSION); return; }
        const operation = captureOperation();
        if (!operation) { showStatus('La session MJ n’est plus valide.', ERROR_KINDS.PERMISSION); return; }
        const repo = getRepository();
        if (!repo?.remove && !currentEditContext) { showStatus('La corbeille versionnée est indisponible.'); return; }
        removing = true;
        setBusy(true);
        refs.confirmationButton.disabled = true;
        showStatus('Suppression en cours…');
        try {
            const client = getContributionClient?.();
            const context = currentEditContext;
            if (!context) throw Object.assign(new Error('Contexte versionné indisponible.'), { code: 'failed-precondition' });
            await trashManagedContent(client, context, { kind: 'pnj', id });
            if (!currentOperation(operation)) return;
            onNavigate('#/pnjs');
            removeCurrentDraft();
            announce('PNJ placé en corbeille.');
        } catch (error) {
            if (!currentOperation(operation)) return;
            const state = error?.state;
            if (state?.lockRetained === true) {
                if (state.firestoreDone === true) removeCurrentDraft();
                exposeRecovery(state);
                announce(state.firestoreDone ? 'Suppression enregistrée ; reprise nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
            } else if (state?.cleanupPending === true || state?.commitDone === true || state?.commitUnknown === true) {
                if (state.firestoreDone === true || state.commitDone === true) removeCurrentDraft();
                exposeImageRecovery(state);
            } else {
                removing = false;
                setBusy(false);
                refs.confirmationButton.disabled = false;
                fail(error);
            }
        }
    };
    const resumeRemoval = async () => {
        if (!mounted || removing || !id || !isGm(getSession)) return;
        if (isOnline?.() === false) { showStatus('Hors ligne. La reprise est différée.', 'offline'); return; }
        const operation = captureOperation();
        const repo = getRepository();
        if (!operation || typeof repo?.resumeRemoval !== 'function') return;
        removing = true;
        setBusy(true);
        refs.resumeButton.disabled = true;
        showStatus('Reprise du nettoyage en cours…');
        try {
            const result = await repo.resumeRemoval(id);
            if (!currentOperation(operation)) return;
            if (result?.lockRetained === true) {
                if (result.firestoreDone === true) removeCurrentDraft();
                exposeRecovery(result);
                announce(result.firestoreDone ? 'Suppression enregistrée ; reprise nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
                return;
            }
            if (result?.firestoreDone !== true || result.imageCleanupPending) {
                if (result.firestoreDone === true) removeCurrentDraft();
                exposeRecovery(result);
                announce('La reprise du nettoyage reste nécessaire.');
                return;
            }
            removeCurrentDraft();
            onNavigate('#/pnjs');
            announce('Nettoyage du PNJ terminé.');
        } catch (error) {
            if (!currentOperation(operation)) return;
            const state = error?.state;
            if (state?.lockRetained === true) {
                if (state.firestoreDone === true) removeCurrentDraft();
                exposeRecovery(state);
                announce(state.firestoreDone ? 'Suppression enregistrée ; reprise nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
            } else if (state?.cleanupPending === true || state?.commitDone === true || state?.commitUnknown === true) {
                if (state.firestoreDone === true || state.commitDone === true) removeCurrentDraft();
                exposeImageRecovery(state);
            } else {
                removing = false; setBusy(false); refs.resumeButton.disabled = false;
                fail(error);
            }
        }
    };

    const mount = ({ signal } = {}) => {
        if (mounted || !container || signal?.aborted) return;
        mounted = true; signalRef = signal ?? null; generation += 1;
        dirtyFields = new Set();
        draftVersion = 0;
        recoveryLocked = false;
        initialized = false;
        initialUpdatedAt = undefined;
        initialPrivateUpdatedAt = undefined;
        initialContributionContextPromise = null;
        saving = false;
        removing = false;
        currentImpact = null;
        loadedPublicSignature = null;
        loadedPrivateSignature = null;
        initialPortraitReference = null;
        reservedCreateId = null;
        portraitDirty = false;
        imageRecoveryLocked = false;
        imageRecoveryState = null;
        const localGeneration = generation;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        if (!isGm(getSession)) {
            const safeScreen = documentRef.createElement('section');
            safeScreen.className = 'm-screen';
            safeScreen.append(text(documentRef, 'h2', 'Accès MJ requis'), text(documentRef, 'p', 'Vérification de la session MJ…'));
            container.append(safeScreen);
            signal?.addEventListener?.('abort', unmount, { once: true });
            return;
        }
        const screen = documentRef.createElement('section'); screen.className = 'm-screen m-pnj-form-screen'; screen.dataset.view = 'pnj-edit';
        const heading = text(documentRef, 'h2', id ? 'Modifier le PNJ' : 'Nouveau PNJ');
        const form = documentRef.createElement('form'); form.className = 'm-pnj-form'; form.noValidate = true;
        const summary = documentRef.createElement('div'); summary.className = 'm-form-summary'; summary.hidden = true; summary.setAttribute('role', 'alert');
        const conflict = documentRef.createElement('section'); conflict.className = 'm-form-conflict'; conflict.hidden = true; conflict.setAttribute('role', 'alert');
        const status = documentRef.createElement('p'); status.className = 'm-form-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        const publicSet = documentRef.createElement('fieldset'); publicSet.className = 'm-form-section'; publicSet.append(text(documentRef, 'legend', 'Public'));
        const privateSet = documentRef.createElement('fieldset'); privateSet.className = 'm-form-section'; privateSet.append(text(documentRef, 'legend', 'Privé'));
        const publicationSet = documentRef.createElement('fieldset'); publicationSet.className = 'm-form-section'; publicationSet.append(text(documentRef, 'legend', 'Publication'));
        const fields = {
            nom: field(documentRef, publicSet, { name: 'nom', label: 'Nom', required: true }),
            statut: field(documentRef, publicSet, { name: 'statut', label: 'Statut', type: 'select', options: STATUSES.map(value => ({ value, label: value || 'Non renseigné' })) }),
            vivant: field(documentRef, publicSet, { name: 'vivant', label: 'Vivant', type: 'select', options: LIVING.map(value => ({ value, label: value })) }),
            lieu: field(documentRef, publicSet, { name: 'lieu', label: 'Lieu' }),
            groupe: field(documentRef, publicSet, { name: 'groupe', label: 'Groupe' }),
            description: field(documentRef, publicSet, { name: 'description', label: 'Description publique', type: 'textarea', help: 'Visible par les joueurs si le PNJ est publié.' }),
            notes: field(documentRef, privateSet, { name: 'notes', label: 'Notes privées MJ', type: 'textarea', help: 'Ces notes ne sont jamais envoyées au client joueur.' }),
        };
        const visibleWrapper = documentRef.createElement('div'); visibleWrapper.className = 'm-form-field m-visibility-field';
        const visibleLabel = documentRef.createElement('label');
        const visible = documentRef.createElement('input'); visible.type = 'checkbox'; visible.name = 'visibleJoueurs'; visible.dataset.field = 'visibleJoueurs'; visible.id = 'm-pnj-visibleJoueurs';
        const visibleHelp = text(documentRef, 'span', 'Le PNJ, son portrait et ses relations compatibles seront visibles ou retirés du mode joueur.'); visibleHelp.id = 'm-pnj-visibleJoueurs-help';
        const visibleError = text(documentRef, 'span', '', 'm-form-error'); visibleError.id = 'm-pnj-visibleJoueurs-error'; visibleError.setAttribute('role', 'alert'); visibleError.hidden = true;
        visible.setAttribute('aria-describedby', `${visibleHelp.id} ${visibleError.id}`);
        visibleLabel.append(visible, text(documentRef, 'span', 'Publié pour les joueurs')); visibleWrapper.append(visibleLabel, visibleHelp, visibleError);
        fields.visibleJoueurs = { wrapper: visibleWrapper, control: visible, error: visibleError }; publicationSet.append(visibleWrapper);
        const portrait = documentRef.createElement('div'); portrait.className = 'm-form-portrait';
        const actions = documentRef.createElement('div'); actions.className = 'm-form-actions';
        const cancel = documentRef.createElement('button'); cancel.type = 'button'; cancel.className = 'm-button'; cancel.textContent = 'Annuler';
        const saveButton = documentRef.createElement('button'); saveButton.type = 'submit'; saveButton.className = 'm-button m-button-primary'; saveButton.textContent = 'Enregistrer';
        actions.append(cancel, saveButton);
        form.append(summary, conflict, publicSet, privateSet, publicationSet, actions, portrait);
        const relations = documentRef.createElement('div'); relations.className = 'm-pnj-relations';
        const danger = documentRef.createElement('section'); danger.className = 'm-danger-zone';
        const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'm-button m-button-danger'; remove.textContent = 'Supprimer ce PNJ'; remove.hidden = !id;
        const confirmation = documentRef.createElement('div'); confirmation.className = 'm-removal-confirmation'; confirmation.hidden = true; confirmation.setAttribute('role', 'alert');
        const confirmationText = text(documentRef, 'p', ''); const confirmationButton = documentRef.createElement('button'); confirmationButton.type = 'button'; confirmationButton.className = 'm-button m-button-danger'; confirmationButton.textContent = 'Confirmer la suppression';
        const resumeButton = documentRef.createElement('button'); resumeButton.type = 'button'; resumeButton.className = 'm-button'; resumeButton.textContent = 'Reprendre le nettoyage'; resumeButton.hidden = true;
        const recoverImageButton = documentRef.createElement('button'); recoverImageButton.type = 'button'; recoverImageButton.className = 'm-button'; recoverImageButton.textContent = 'Reprendre le nettoyage du portrait'; recoverImageButton.hidden = true;
        confirmation.append(confirmationText, confirmationButton, recoverImageButton, resumeButton); danger.append(remove, confirmation);
        screen.append(heading, status, form, relations, danger); container.append(screen);
        refs = { form, fields, summary, conflict, status, save: saveButton, cancel, remove, confirmation, confirmationText, confirmationButton, resumeButton, recoverImageButton };
        if (id) {
            form.inert = true;
            initialContributionContextPromise = Promise.resolve().then(async () => {
                const client = getContributionClient?.();
                const context = await loadContentEditContext(client, 'pnj', id);
                if (!context) throw Object.assign(new Error('Contexte versionné indisponible.'), { code: 'failed-precondition' });
                if (!mounted || localGeneration !== generation) return null;
                currentEditContext = context;
                if (!initialized) {
                    const serverValues = normalizePnjFormValues({ ...context.data, notes: valuesFromForm().notes });
                    fill(serverValues); initialValues = serverValues;
                }
                return context;
            }).catch(error => { showStatus(`Chargement du contexte versionné impossible : ${errorForUi(error).message}`, ERROR_KINDS.CONFLICT); return null; })
                .finally(() => { if (mounted && localGeneration === generation) form.inert = false; });
        } else {
            initialContributionContextPromise = Promise.resolve(null);
        }
        groupPicker = createGroupPicker({ documentRef, input: fields.groupe.control, onChange: () => {
            dirtyFields.add('groupe'); dirtyFields.add('groupes'); draftVersion += 1; scheduleDraft();
        } });
        const groupsRepository = getPnjRepository?.();
        if (typeof groupsRepository?.subscribeAll === 'function') {
            try { unsubs.push(groupsRepository.subscribeAll(items => groupPicker?.setCatalog?.(groupCatalog(items)), () => {})); }
            catch { /* suggestions are optional */ }
        }
        portraitEditor = createPortraitEditor({ container: portrait, document: documentRef,
            onChange: () => { portraitDirty = true; draftVersion += 1; }, ...(portraitProcessor ? { processFile: portraitProcessor } : {}) });
        if (id) {
            try {
                relationsEditor = createPnjRelationsEditor({ container: relations, pnjId: id, getSession, isOnline,
                    getRelationsRepository, getPnjRepository, getContributionClient, announce, document: documentRef });
                relationsEditor.mount({ signal });
                relationsEditor.setDisabled(true);
            } catch { relations.textContent = 'Les relations MJ sont indisponibles.'; }
        }
        if (id) { saveButton.disabled = true; remove.disabled = true; }
        fill(defaultPnjFormValues());
        for (const [fieldName, { control }] of Object.entries(fields)) {
            control.addEventListener('input', () => { dirtyFields.add(fieldName); if (fieldName === 'groupe') dirtyFields.add('groupes'); draftVersion += 1; if (fieldName !== 'notes') scheduleDraft(); });
            control.addEventListener('change', () => { dirtyFields.add(fieldName); if (fieldName === 'groupe') dirtyFields.add('groupes'); draftVersion += 1; if (fieldName !== 'notes') scheduleDraft(); });
        }
        form.addEventListener('submit', save);
        cancel.addEventListener('click', () => {
            if (beforeLeave()) onBack();
        });
        remove.addEventListener('click', showImpact); confirmationButton.addEventListener('click', confirmRemoval); resumeButton.addEventListener('click', resumeRemoval); recoverImageButton.addEventListener('click', recoverImage);
        signal?.addEventListener?.('abort', unmount, { once: true });
        if (!id) { initialized = true; showStatus('Saisissez les informations du nouveau PNJ.'); offerDraft(); return; }
        const repo = getRepository();
        if (!repo || !isGm(getSession)) { showStatus('Vérification de la session MJ…', 'loading'); return; }
        let publicReady = false; let privateReady = false; let publicItem = null; let privateItem = null; let loadError = null;
        const disableEditing = () => { refs.save.disabled = true; refs.remove.disabled = true; groupPicker?.setDisabled?.(true); portraitEditor?.setDisabled?.(true); relationsEditor?.setDisabled?.(true); };
        const finish = () => {
            if (!mounted || localGeneration !== generation || !publicReady || !privateReady) return;
            if (initialized) return;
            if (loadError) { disableEditing(); return; }
            if (!publicItem) { showStatus('Ce PNJ est introuvable.', ERROR_KINDS.NOT_FOUND); disableEditing(); return; }
            if (publicItem.suppressionEnCours === true) { showStatus('Ce PNJ est en cours de suppression.', ERROR_KINDS.CONFLICT); disableEditing(); return; }
            initialUpdatedAt = publicItem.updatedAt ?? null;
            initialPrivateUpdatedAt = privateItem?.updatedAt ?? null;
            initialPortraitReference = publicItem.imagePath || publicItem.imageUrl || null;
            void portraitEditor?.setCurrentPath?.(initialPortraitReference, getImageService?.());
            initialValues = {
                nom: publicItem.nom, statut: publicItem.statut, vivant: publicItem.vivant,
                lieu: publicItem.lieu, groupe: (publicItem.groupes?.[0] ?? publicItem.groupe ?? ''), groupes: publicItem.groupes ?? (publicItem.groupe ? [publicItem.groupe] : []), description: publicItem.description,
                visibleJoueurs: publicItem.visibleJoueurs, notes: privateItem?.notes ?? '',
            };
            const cleanFields = new Set(Object.keys(fields).filter(fieldName => !dirtyFields.has(fieldName)));
            fill(initialValues, cleanFields);
            loadedPublicSignature = JSON.stringify([publicItem.nom, publicItem.statut, publicItem.vivant, publicItem.lieu,
                publicItem.groupe, publicItem.groupes, publicItem.description, publicItem.visibleJoueurs, publicItem.imagePath, publicItem.updatedAt]);
            loadedPrivateSignature = JSON.stringify([privateItem?.updatedAt, privateItem?.notes ?? '']);
            initialized = true;
            if (!recoveryLocked && !imageRecoveryLocked) {
                for (const { control } of Object.values(refs.fields)) control.disabled = false;
                refs.save.disabled = false;
                refs.remove.disabled = false;
                groupPicker?.setDisabled?.(false);
                portraitEditor?.setDisabled?.(false);
                relationsEditor?.setDisabled?.(false);
            }
            showStatus('PNJ chargé.');
            offerDraft();
        };
        const subscribe = () => {
            try {
            unsubs.push(repo.subscribeOne(id, item => {
                latestPublicItem = item;
                if (item?.suppressionEnCours === true) { publicReady = true; publicItem = item; disableEditing(); showStatus('Ce PNJ est en cours de suppression.', ERROR_KINDS.CONFLICT); return; }
                if (item?.issues?.length) { publicReady = true; loadError = Object.assign(new Error('invalid-public-snapshot'), { code: 'invalid-argument' }); disableEditing(); showStatus(errorForUi(loadError).message, classify(loadError)); return; }
                const signature = item ? JSON.stringify([item.nom, item.statut, item.vivant, item.lieu, item.groupe, item.groupes,
                    item.description, item.visibleJoueurs, item.imagePath, item.updatedAt]) : null;
                if (initialized) {
                    if (!item) { clearConflict(); disableEditing(); showStatus('Cette fiche n’est plus disponible.', ERROR_KINDS.NOT_FOUND); return; }
                    if (signature !== loadedPublicSignature) { disableEditing(); showStatus('Conflit : le PNJ a changé ailleurs. Vos saisies sont conservées.', ERROR_KINDS.CONFLICT); showConflict(); }
                    return;
                }
                publicReady = true; publicItem = item; finish();
            }, error => { publicReady = true; loadError = error; disableEditing(); showStatus(errorForUi(error).message, classify(error)); finish(); }));
            unsubs.push(repo.subscribePrivate(id, item => {
                latestPrivateItem = item;
                if (!item) {
                    privateReady = true;
                    loadError = Object.assign(new Error('private-pnj-absent'), { code: 'not-found' });
                    if (initialized) clearConflict();
                    disableEditing();
                    showStatus('Les notes privées de ce PNJ sont indisponibles.', ERROR_KINDS.NOT_FOUND);
                    finish();
                    return;
                }
                if (item?.issues?.length) { privateReady = true; loadError = Object.assign(new Error('invalid-private-snapshot'), { code: 'invalid-argument' }); disableEditing(); showStatus(errorForUi(loadError).message, classify(loadError)); return; }
                const notes = item?.notes ?? '';
                const signature = JSON.stringify([item?.updatedAt, notes]);
                if (initialized) {
                    if (signature !== loadedPrivateSignature) { disableEditing(); showStatus('Conflit : les notes privées ont changé ailleurs. Vos saisies sont conservées.', ERROR_KINDS.CONFLICT); showConflict(); }
                    return;
                }
                privateReady = true; privateItem = item; finish();
            }, error => { privateReady = true; loadError = error; disableEditing(); showStatus(errorForUi(error).message, classify(error)); finish(); }));
            } catch (error) {
                loadError = error;
                disableEditing();
                cleanup();
                showStatus(errorForUi(error).message, classify(error));
            }
        };
        const inspectLockAndSubscribe = async () => {
            const operation = captureOperation();
            if (!operation) return;
            if (typeof repo.inspectRemovalLock !== 'function') { subscribe(); return; }
            try {
                const lock = await repo.inspectRemovalLock();
                if (!currentOperation(operation)) return;
                if (lock) {
                    if (lock.pnjId === id) {
                        exposeRecovery(lock);
                        showStatus('Une suppression interrompue doit être reprise avant toute édition.', ERROR_KINDS.CONFLICT);
                    } else {
                        disableEditing();
                        showStatus('Une autre suppression est en cours. Réessayez après sa reprise.', ERROR_KINDS.CONFLICT);
                    }
                    return;
                }
                subscribe();
            } catch (error) {
                if (!currentOperation(operation)) return;
                loadError = error;
                disableEditing();
                showStatus(errorForUi(error).message, classify(error));
            }
        };
        inspectLockAndSubscribe();
    };
    const unmount = () => {
        if (!mounted) return;
        flushDraft(); mounted = false; generation += 1; cleanup();
        relationsEditor?.unmount?.(); relationsEditor = null;
        groupPicker?.destroy?.(); groupPicker = null;
        portraitEditor?.destroy?.(); portraitEditor = null;
        signalRef?.removeEventListener?.('abort', unmount);
        refs = null; signalRef = null; latestPublicItem = null; latestPrivateItem = null;
        initialValues = defaultPnjFormValues(); initialUpdatedAt = undefined; initialPrivateUpdatedAt = undefined;
        loadedPublicSignature = null; loadedPrivateSignature = null; initialPortraitReference = null;
        currentImpact = null; imageRecoveryState = null; dirtyFields = new Set(); portraitDirty = false;
        recoveryLocked = false; imageRecoveryLocked = false; draftId = null; draftPrompted = false;
        container.replaceChildren();
    };
    return Object.freeze({ mount, unmount, beforeLeave });
}

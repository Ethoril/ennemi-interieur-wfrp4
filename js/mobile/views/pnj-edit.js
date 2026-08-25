import { errorForUi, ERROR_KINDS } from '../../data/firebase-errors.js';

const STATUSES = Object.freeze(['', 'allié', 'neutre', 'ennemi']);
const LIVING = Object.freeze(['oui', 'non', 'inconnu']);
const MAX = Object.freeze({ nom: 200, statut: 64, vivant: 32, lieu: 200, groupe: 200, description: 20000, notes: 30000 });

export function defaultPnjFormValues() {
    // Le bureau crée un PNJ comme vivant ; l’état « inconnu » reste disponible explicitement.
    return { nom: '', statut: '', vivant: 'oui', lieu: '', groupe: '', description: '', visibleJoueurs: true, notes: '', imagePath: null };
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
    return {
        nom: normalizeOneLine(input.nom ?? defaults.nom),
        statut: normalizeOneLine(input.statut ?? defaults.statut),
        vivant: normalizeOneLine(input.vivant ?? defaults.vivant),
        lieu: normalizeOneLine(input.lieu ?? defaults.lieu),
        groupe: normalizeOneLine(input.groupe ?? defaults.groupe),
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
    if (Object.hasOwn(source, 'visibleJoueurs') && typeof source.visibleJoueurs !== 'boolean') {
        errors.visibleJoueurs = 'La visibilité doit être activée ou désactivée.';
    }
    const values = normalizePnjFormValues(source);
    if (!values.nom) errors.nom = 'Le nom est obligatoire.';
    for (const field of ['nom', 'statut', 'vivant', 'lieu', 'groupe', 'description', 'notes']) {
        if (values[field].length > MAX[field]) errors[field] = `Ce champ ne peut pas dépasser ${MAX[field]} caractères.`;
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
    getSession = () => ({ status: 'visitor' }), onNavigate = () => {}, onBack = () => {}, announce = () => {} } = {}) {
    let mounted = false;
    let generation = 0;
    let signalRef = null;
    let unsubs = [];
    let refs = null;
    let initialUpdatedAt;
    let initialPrivateUpdatedAt;
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

    const cleanup = () => { for (const unsubscribe of unsubs.splice(0)) { try { unsubscribe?.(); } catch { /* best-effort */ } } };
    const setBusy = busy => {
        saving = busy;
        if (!refs) return;
        refs.save.disabled = busy || removing || recoveryLocked;
        refs.cancel.disabled = saving || removing;
        refs.remove.disabled = busy || removing || recoveryLocked;
        refs.save.textContent = busy ? 'Enregistrement…' : 'Enregistrer';
        for (const { control } of Object.values(refs.fields)) control.disabled = busy || removing || recoveryLocked;
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
                link.href = `#m-pnj-${key}`;
                link.textContent = errors[key];
                link.addEventListener('click', event => {
                    event.preventDefault();
                    refs.fields[key]?.control?.focus?.();
                });
                item.append(link);
                list.append(item);
            }
            refs.summary.append(list);
        }
        for (const [key, value] of Object.entries(refs.fields)) {
            const message = errors[key] || '';
            value.error.textContent = message;
            value.error.hidden = !message;
            if (message) value.control.setAttribute('aria-invalid', 'true');
            else value.control.removeAttribute('aria-invalid');
        }
        if (keys.length) refs.fields[keys[0]]?.control?.focus?.();
    };
    const fill = (values, fieldsToFill = null) => {
        for (const [key, value] of Object.entries(refs.fields)) {
            if (!fieldsToFill || fieldsToFill.has(key)) setControl(value.control, values[key]);
        }
    };
    const valuesFromForm = () => Object.fromEntries(Object.entries(refs.fields).map(([key, value]) => [key, readControl(value.control)]));
    const hasChanges = () => JSON.stringify(normalizePnjFormValues(valuesFromForm())) !== JSON.stringify(normalizePnjFormValues(initialValues));
    const beforeLeave = () => {
        if (!mounted || !refs) return true;
        const confirm = container.ownerDocument.defaultView?.confirm;
        if (recoveryLocked) return typeof confirm !== 'function' || confirm('Une suppression doit être reprise avant de quitter cette fiche. Continuer ?');
        if (!hasChanges()) return true;
        return typeof confirm !== 'function' || confirm('Des modifications ne sont pas enregistrées. Quitter cette fiche ?');
    };
    const showStatus = (message, kind = '') => { if (!refs) return; refs.status.textContent = message; refs.status.dataset.kind = kind; };
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
        if (!mounted || saving || removing) return;
        if (!isGm(getSession)) { showStatus('La session MJ n’est plus valide. Vos saisies sont conservées.', ERROR_KINDS.PERMISSION); return; }
        const operation = captureOperation();
        if (!operation) { showStatus('La session MJ n’est plus valide. Vos saisies sont conservées.', ERROR_KINDS.PERMISSION); return; }
        if (!initialized) { showStatus('Le formulaire n’est pas encore prêt.', ERROR_KINDS.NOT_FOUND); return; }
        const result = validatePnjForm(valuesFromForm());
        renderErrors(result.errors);
        if (!result.valid) { showStatus('Le formulaire contient des erreurs.', ERROR_KINDS.VALIDATION); return; }
        const repo = getRepository();
        if (!repo) { showStatus('Le dépôt MJ est indisponible.', ERROR_KINDS.PERMISSION); return; }
        setBusy(true);
        showStatus('Enregistrement en cours…');
        try {
            const publicInput = { nom: result.values.nom, statut: result.values.statut, vivant: result.values.vivant,
                lieu: result.values.lieu, groupe: result.values.groupe, description: result.values.description,
                visibleJoueurs: result.values.visibleJoueurs };
            if (result.values.imagePath) publicInput.imagePath = result.values.imagePath;
            const privateInput = { notes: result.values.notes };
            if (id && result.values.visibleJoueurs !== initialValues.visibleJoueurs) {
                if (result.values.visibleJoueurs === false) showStatus('Dépublication : les relations visibles compatibles seront retirées du mode joueur.');
                else showStatus('Publication : les relations vers un PNJ masqué resteront incompatibles avec le mode joueur.');
                if (typeof repo.inspectVisibilityImpact === 'function') {
                    const visibilityImpact = await repo.inspectVisibilityImpact(id);
                    if (!currentOperation(operation)) return;
                    if (draftVersion !== operation.draftVersion) {
                        setBusy(false);
                        showStatus('La saisie a changé pendant la vérification. Vérifiez puis relancez.', ERROR_KINDS.CONFLICT);
                        return;
                    }
                    if (result.values.visibleJoueurs === false && visibilityImpact.visibleRelationsCount > 0) {
                        showStatus(`${visibilityImpact.visibleRelationsCount} relation${visibilityImpact.visibleRelationsCount === 1 ? '' : 's'} visible${visibilityImpact.visibleRelationsCount === 1 ? '' : 's'} sera${visibilityImpact.visibleRelationsCount === 1 ? '' : 'ont'} révoquée${visibilityImpact.visibleRelationsCount === 1 ? '' : 's'} pour les joueurs.`);
                    }
                    if (result.values.visibleJoueurs === true && visibilityImpact.incompatibleVisibleRelationsCount > 0) {
                        showStatus(`${visibilityImpact.incompatibleVisibleRelationsCount} relation${visibilityImpact.incompatibleVisibleRelationsCount === 1 ? '' : 's'} visible${visibilityImpact.incompatibleVisibleRelationsCount === 1 ? '' : 's'} pointe${visibilityImpact.incompatibleVisibleRelationsCount === 1 ? '' : 'nt'} vers un PNJ masqué et restera${visibilityImpact.incompatibleVisibleRelationsCount === 1 ? '' : 'ont'} indisponible${visibilityImpact.incompatibleVisibleRelationsCount === 1 ? '' : 's'} aux joueurs.`);
                    }
                }
            }
            const output = id
                ? await repo.update(id, publicInput, privateInput, initialUpdatedAt, initialPrivateUpdatedAt)
                : await repo.create(publicInput, privateInput);
            if (!currentOperation(operation)) return;
            if (draftVersion !== operation.draftVersion) {
                setBusy(false);
                showStatus('La saisie a changé pendant l’enregistrement. Vérifiez puis relancez.', ERROR_KINDS.CONFLICT);
                return;
            }
            const savedId = id || output?.id;
            if (typeof savedId !== 'string' || !savedId) throw Object.assign(new Error('save-unconfirmed'), { code: 'unknown' });
            onNavigate(savedId ? `#/pnjs/${encodeURIComponent(savedId)}` : '#/pnjs');
            announce('PNJ enregistré.');
        } catch (error) { if (currentOperation(operation)) fail(error); }
    };

    const showImpact = async () => {
        if (!mounted || saving || removing || !id) return;
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
            currentImpact = impact;
            refs.confirmation.hidden = false;
            refs.confirmationText.textContent = impactMessage(currentImpact);
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
        refs.confirmation.hidden = false;
        refs.confirmationButton.hidden = true;
        refs.resumeButton.hidden = false;
        refs.resumeButton.disabled = false;
        if (state?.firestoreDone) showStatus('La suppression est enregistrée, mais le nettoyage reste à reprendre.', ERROR_KINDS.UNKNOWN);
        else showStatus('La suppression est interrompue et son verrou doit être repris.', ERROR_KINDS.CONFLICT);
    };
    const confirmRemoval = async () => {
        if (!mounted || removing || !id || !currentImpact) return;
        if (!isGm(getSession)) { showStatus('La session MJ n’est plus valide.', ERROR_KINDS.PERMISSION); return; }
        const operation = captureOperation();
        if (!operation) { showStatus('La session MJ n’est plus valide.', ERROR_KINDS.PERMISSION); return; }
        const repo = getRepository();
        if (!repo?.remove) { showStatus('La suppression est indisponible.'); return; }
        removing = true;
        setBusy(true);
        refs.confirmationButton.disabled = true;
        showStatus('Suppression en cours…');
        try {
            const result = await repo.remove(id);
            if (!currentOperation(operation)) return;
            if (result?.lockRetained === true) {
                exposeRecovery(result);
                announce(result.firestoreDone ? 'Suppression enregistrée ; reprise du nettoyage nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
                return;
            }
            if (result?.firestoreDone !== true) {
                throw Object.assign(new Error('La suppression n’a pas été confirmée par le dépôt.'), { kind: ERROR_KINDS.UNKNOWN });
            }
            if (result.imageCleanupPending) {
                exposeRecovery(result);
                showStatus('PNJ supprimé ; le nettoyage du portrait doit être repris.', ERROR_KINDS.UNKNOWN);
                announce('PNJ supprimé ; reprise du nettoyage nécessaire.');
                return;
            } else {
                let completionMessage = 'PNJ supprimé.';
                if (result.legacyImageSkipped === true) {
                    showStatus('PNJ supprimé ; un ancien portrait non canonique est conservé et devra être traité séparément.', ERROR_KINDS.UNKNOWN);
                    completionMessage = 'PNJ supprimé ; un ancien portrait reste à traiter.';
                }
                onNavigate('#/pnjs');
                announce(completionMessage);
            }
        } catch (error) {
            if (!currentOperation(operation)) return;
            const state = error?.state;
            if (state?.lockRetained === true) {
                exposeRecovery(state);
                announce(state.firestoreDone ? 'Suppression enregistrée ; reprise nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
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
                exposeRecovery(result);
                announce(result.firestoreDone ? 'Suppression enregistrée ; reprise nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
                return;
            }
            if (result?.firestoreDone !== true || result.imageCleanupPending) {
                exposeRecovery(result);
                announce('La reprise du nettoyage reste nécessaire.');
                return;
            }
            onNavigate('#/pnjs');
            announce('Nettoyage du PNJ terminé.');
        } catch (error) {
            if (!currentOperation(operation)) return;
            const state = error?.state;
            if (state?.lockRetained === true) {
                exposeRecovery(state);
                announce(state.firestoreDone ? 'Suppression enregistrée ; reprise nécessaire.' : 'Suppression interrompue ; reprise nécessaire.');
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
        saving = false;
        removing = false;
        currentImpact = null;
        loadedPublicSignature = null;
        loadedPrivateSignature = null;
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
        const portrait = documentRef.createElement('div'); portrait.className = 'm-form-portrait-placeholder'; portrait.append(text(documentRef, 'strong', 'Portrait'), text(documentRef, 'span', 'Présentation uniquement — ajout du portrait dans M4-03.')); publicSet.append(portrait);
        const actions = documentRef.createElement('div'); actions.className = 'm-form-actions';
        const cancel = documentRef.createElement('button'); cancel.type = 'button'; cancel.className = 'm-button'; cancel.textContent = 'Annuler';
        const saveButton = documentRef.createElement('button'); saveButton.type = 'submit'; saveButton.className = 'm-button m-button-primary'; saveButton.textContent = 'Enregistrer';
        actions.append(cancel, saveButton);
        form.append(summary, publicSet, privateSet, publicationSet, actions);
        const danger = documentRef.createElement('section'); danger.className = 'm-danger-zone';
        const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'm-button m-button-danger'; remove.textContent = 'Supprimer ce PNJ'; remove.hidden = !id;
        const confirmation = documentRef.createElement('div'); confirmation.className = 'm-removal-confirmation'; confirmation.hidden = true; confirmation.setAttribute('role', 'alert');
        const confirmationText = text(documentRef, 'p', ''); const confirmationButton = documentRef.createElement('button'); confirmationButton.type = 'button'; confirmationButton.className = 'm-button m-button-danger'; confirmationButton.textContent = 'Confirmer la suppression';
        const resumeButton = documentRef.createElement('button'); resumeButton.type = 'button'; resumeButton.className = 'm-button'; resumeButton.textContent = 'Reprendre le nettoyage'; resumeButton.hidden = true;
        confirmation.append(confirmationText, confirmationButton, resumeButton); danger.append(remove, confirmation);
        screen.append(heading, status, form, danger); container.append(screen);
        refs = { form, fields, summary, status, save: saveButton, cancel, remove, confirmation, confirmationText, confirmationButton, resumeButton };
        if (id) { saveButton.disabled = true; remove.disabled = true; }
        fill(defaultPnjFormValues());
        for (const [fieldName, { control }] of Object.entries(fields)) {
            control.addEventListener('input', () => { dirtyFields.add(fieldName); draftVersion += 1; });
            control.addEventListener('change', () => { dirtyFields.add(fieldName); draftVersion += 1; });
        }
        form.addEventListener('submit', save);
        cancel.addEventListener('click', () => {
            if (beforeLeave()) onBack();
        });
        remove.addEventListener('click', showImpact); confirmationButton.addEventListener('click', confirmRemoval); resumeButton.addEventListener('click', resumeRemoval);
        signal?.addEventListener?.('abort', unmount, { once: true });
        if (!id) { initialized = true; showStatus('Saisissez les informations du nouveau PNJ.'); return; }
        const repo = getRepository();
        if (!repo || !isGm(getSession)) { showStatus('Vérification de la session MJ…', 'loading'); return; }
        let publicReady = false; let privateReady = false; let publicItem = null; let privateItem = null; let loadError = null;
        const disableEditing = () => { refs.save.disabled = true; refs.remove.disabled = true; };
        const finish = () => {
            if (!mounted || localGeneration !== generation || !publicReady || !privateReady) return;
            if (initialized) return;
            if (loadError) { disableEditing(); return; }
            if (!publicItem) { showStatus('Ce PNJ est introuvable.', ERROR_KINDS.NOT_FOUND); disableEditing(); return; }
            if (publicItem.suppressionEnCours === true) { showStatus('Ce PNJ est en cours de suppression.', ERROR_KINDS.CONFLICT); disableEditing(); return; }
            initialUpdatedAt = publicItem.updatedAt ?? null;
            initialPrivateUpdatedAt = privateItem?.updatedAt ?? null;
            initialValues = {
                nom: publicItem.nom, statut: publicItem.statut, vivant: publicItem.vivant,
                lieu: publicItem.lieu, groupe: publicItem.groupe, description: publicItem.description,
                visibleJoueurs: publicItem.visibleJoueurs, notes: privateItem?.notes ?? '',
            };
            const cleanFields = new Set(Object.keys(fields).filter(fieldName => !dirtyFields.has(fieldName)));
            fill(initialValues, cleanFields);
            loadedPublicSignature = JSON.stringify([publicItem.nom, publicItem.statut, publicItem.vivant, publicItem.lieu,
                publicItem.groupe, publicItem.description, publicItem.visibleJoueurs, publicItem.imagePath, publicItem.updatedAt]);
            loadedPrivateSignature = JSON.stringify([privateItem?.updatedAt, privateItem?.notes ?? '']);
            initialized = true;
            refs.save.disabled = false;
            refs.remove.disabled = false;
            showStatus('PNJ chargé.');
        };
        const subscribe = () => {
            try {
            unsubs.push(repo.subscribeOne(id, item => {
                if (item?.suppressionEnCours === true) { publicReady = true; publicItem = item; disableEditing(); showStatus('Ce PNJ est en cours de suppression.', ERROR_KINDS.CONFLICT); return; }
                if (item?.issues?.length) { publicReady = true; loadError = Object.assign(new Error('invalid-public-snapshot'), { code: 'invalid-argument' }); disableEditing(); showStatus(errorForUi(loadError).message, classify(loadError)); return; }
                const signature = item ? JSON.stringify([item.nom, item.statut, item.vivant, item.lieu, item.groupe,
                    item.description, item.visibleJoueurs, item.imagePath, item.updatedAt]) : null;
                if (initialized) {
                    if (!item) { disableEditing(); showStatus('Cette fiche n’est plus disponible.', ERROR_KINDS.NOT_FOUND); return; }
                    if (signature !== loadedPublicSignature) { disableEditing(); showStatus('Le PNJ a changé ailleurs. Vos saisies sont conservées.', ERROR_KINDS.CONFLICT); }
                    return;
                }
                publicReady = true; publicItem = item; finish();
            }, error => { publicReady = true; loadError = error; disableEditing(); showStatus(errorForUi(error).message, classify(error)); finish(); }));
            unsubs.push(repo.subscribePrivate(id, item => {
                if (!item) {
                    privateReady = true;
                    loadError = Object.assign(new Error('private-pnj-absent'), { code: 'not-found' });
                    disableEditing();
                    showStatus('Les notes privées de ce PNJ sont indisponibles.', ERROR_KINDS.NOT_FOUND);
                    finish();
                    return;
                }
                if (item?.issues?.length) { privateReady = true; loadError = Object.assign(new Error('invalid-private-snapshot'), { code: 'invalid-argument' }); disableEditing(); showStatus(errorForUi(loadError).message, classify(loadError)); return; }
                const notes = item?.notes ?? '';
                const signature = JSON.stringify([item?.updatedAt, notes]);
                if (initialized) {
                    if (signature !== loadedPrivateSignature) { disableEditing(); showStatus('Les notes privées ont changé ailleurs. Vos saisies sont conservées.', ERROR_KINDS.CONFLICT); }
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
    const unmount = () => { if (!mounted) return; mounted = false; generation += 1; cleanup(); signalRef?.removeEventListener?.('abort', unmount); refs = null; signalRef = null; container.replaceChildren(); };
    return Object.freeze({ mount, unmount, beforeLeave });
}

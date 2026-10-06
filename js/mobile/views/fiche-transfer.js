import { pickFicheKeys } from '../../fiche/export-import.js';
import { migrateFicheDocument } from '../../fiche-schema.js';
import { createBottomSheet } from '../components/bottom-sheet.js';

const MIN_REASON = 3;

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/** Télécharge `text` sous `filename` : Blob, lien temporaire, adresse révoquée juste après. */
export function downloadJson(documentRef, filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = make(documentRef, 'a');
    link.href = url;
    link.download = filename;
    documentRef.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importErrorMessage(error) {
    switch (error?.details?.kind || error?.code) {
    case 'permission-denied':
        return 'L’import est réservé au MJ.';
    case 'unavailable': case 'deadline-exceeded': case 'internal': case 'unknown':
        return 'Réponse du serveur incertaine : l’import n’est peut-être pas enregistré. Utilisez Réessayer.';
    case 'conflict': case 'aborted':
        return 'La fiche a changé entre-temps. Réessayez.';
    default:
        return 'Import refusé ou impossible pour le moment. Vérifiez le fichier puis réessayez.';
    }
}

/**
 * Volet d'import MJ : fichier déjà lu et filtré (parseFicheImport), motif obligatoire, migration puis commande `import`.
 * `getContext()` → { state, online, controller, charId }. open({ fileName, data }, trigger).
 */
export function createImportSheet({ documentRef, getContext, announce = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-import-title' });
    let file = null;
    let busy = false;
    let error = '';
    let info = '';
    let nodes = null;

    const build = body => {
        const title = make(documentRef, 'h2', 'Importer une fiche', 'm-purchase-title');
        title.id = 'm-import-title';
        title.tabIndex = -1;
        const summary = make(documentRef, 'p', '', 'm-purchase-note');
        const field = make(documentRef, 'div', '', 'm-form-field');
        const label = make(documentRef, 'label', 'Motif de cet import MJ');
        label.htmlFor = 'm-import-reason';
        const reason = make(documentRef, 'input');
        reason.id = 'm-import-reason';
        reason.type = 'text';
        reason.maxLength = 1000;
        reason.setAttribute('placeholder', 'Motif requis');
        field.append(label, reason);
        const hint = make(documentRef, 'p', '', 'm-purchase-reason');
        const failure = make(documentRef, 'p', '', 'm-purchase-error');
        failure.setAttribute('role', 'alert');
        const confirm = make(documentRef, 'button', 'Importer', 'm-button m-button-danger');
        confirm.type = 'button';
        const retry = make(documentRef, 'button', 'Réessayer', 'm-button m-button-primary');
        retry.type = 'button';
        const cancel = make(documentRef, 'button', 'Annuler', 'm-button');
        cancel.type = 'button';
        reason.addEventListener('input', () => { error = ''; refresh(); });
        confirm.addEventListener('click', () => run(false));
        retry.addEventListener('click', () => run(true));
        cancel.addEventListener('click', () => sheet.close());
        body.replaceChildren(title, summary, field, hint, failure, confirm, retry, cancel);
        nodes = { summary, reason, hint, failure, confirm, retry };
    };

    function refresh() {
        const { state, online } = getContext();
        const pending = !!state.pendingOperationId && !busy;
        if (info && !state.pendingOperationId && !busy) {
            info = '';
            sheet.close();
            announce('Import confirmé par le serveur.');
            return;
        }
        nodes.summary.textContent = `Le contenu de « ${file.fileName} » sera transmis au serveur pour validation et remplacera la fiche actuelle.`;
        const short = nodes.reason.value.trim().length < MIN_REASON;
        const hint = !online ? 'Import possible une fois en ligne'
            : state.phase !== 'ready' && !pending && !busy ? 'Fiche indisponible pour un import'
            : short && !pending ? `Motif requis (${MIN_REASON} caractères minimum)` : info;
        nodes.hint.textContent = hint;
        nodes.hint.hidden = !hint;
        nodes.failure.textContent = error;
        nodes.failure.hidden = !error;
        nodes.reason.disabled = busy || pending;
        nodes.confirm.textContent = busy ? 'Import en cours…' : 'Importer';
        nodes.confirm.disabled = busy || !!hint;
        nodes.confirm.hidden = pending;
        nodes.retry.hidden = !pending;
        nodes.retry.disabled = !online;
    }

    async function run(retrying) {
        const context = getContext();
        if (busy) return;
        busy = true;
        error = '';
        info = '';
        refresh();
        try {
            let result;
            if (retrying) result = await context.controller.retryPendingCommand();
            else {
                const migrated = await migrateFicheDocument({ schemaVersion: 1, revision: 1, data: file.data }, { charId: context.charId });
                if (!migrated.canApply || !migrated.document?.data) {
                    error = 'Import bloqué : le fichier comporte des anomalies à examiner avant migration.';
                    return;
                }
                result = await context.controller.executeOnlineCommand('import', {
                    reason: nodes.reason.value.trim(), data: pickFicheKeys(migrated.document.data),
                });
            }
            if (result?.status === 'retry-required') error = 'Une commande précédente est en attente. Utilisez Réessayer.';
            else if (result?.status === 'awaiting-snapshot') info = 'Import en cours de confirmation…';
            else if (result?.status === 'confirmed') {
                sheet.close();
                announce('Import confirmé par le serveur.');
            }
        } catch (failure) {
            error = importErrorMessage(failure);
        } finally {
            busy = false;
            if (sheet.isOpen()) {
                refresh();
                const next = !nodes.retry.hidden ? nodes.retry : nodes.confirm.disabled ? null : nodes.confirm;
                next?.focus();
            }
        }
    }

    return Object.freeze({
        element: sheet.element,
        open(next, trigger) {
            file = next;
            busy = false;
            error = '';
            info = '';
            sheet.open({ trigger, render: body => { build(body); refresh(); } });
            nodes.reason.focus();
        },
        update() { if (sheet.isOpen()) refresh(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

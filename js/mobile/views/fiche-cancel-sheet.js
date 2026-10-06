import { createBottomSheet } from '../components/bottom-sheet.js';
import { cancelErrorMessage } from '../fiche-purchase.js';
import { xpLogRows } from '../fiche-model.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Confirmation d'annulation du dernier achat. `getContext()` → { state (contrôleur), engine, online, controller }.
 * open(purchaseId, trigger). Mêmes règles que le volet d'achat : hors ligne désactivé, un seul envoi, « Réessayer »
 * rejoue la commande en attente (même identifiant, pas de double remboursement).
 */
export function createCancelSheet({ documentRef, getContext, announce = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-cancel-title' });
    let purchaseId = '';
    let busy = false;
    let error = '';
    let info = '';
    let nodes = null;

    const build = body => {
        const title = make(documentRef, 'h2', 'Annuler cet achat', 'm-purchase-title');
        title.id = 'm-cancel-title';
        title.tabIndex = -1;
        const label = make(documentRef, 'p', '', 'm-purchase-nature');
        const summary = make(documentRef, 'p', '', 'm-purchase-formula');
        const note = make(documentRef, 'p', 'Les avances reviennent à leur valeur d’avant et le coût est remboursé.', 'm-purchase-note');
        const reason = make(documentRef, 'p', '', 'm-purchase-reason');
        const failure = make(documentRef, 'p', '', 'm-purchase-error');
        failure.setAttribute('role', 'alert');
        const confirm = make(documentRef, 'button', 'Annuler l’achat', 'm-button m-button-danger');
        confirm.type = 'button';
        const retry = make(documentRef, 'button', 'Réessayer', 'm-button m-button-primary');
        retry.type = 'button';
        const keep = make(documentRef, 'button', 'Garder l’achat', 'm-button');
        keep.type = 'button';
        confirm.addEventListener('click', () => run(context => context.controller.executeOnlineCommand('cancel', { purchaseId })));
        retry.addEventListener('click', () => run(context => context.controller.retryPendingCommand()));
        keep.addEventListener('click', () => sheet.close());
        body.replaceChildren(title, label, summary, note, reason, failure, confirm, retry, keep);
        nodes = { title, label, summary, reason, failure, confirm, retry };
    };

    const currentRow = context => xpLogRows(context.state?.data, context.engine, context.state?.uid)
        .find(row => row.purchaseId === purchaseId);

    const refresh = () => {
        const context = getContext();
        const pending = !!context.state.pendingOperationId && !busy;
        if (info && !context.state.pendingOperationId && !busy) {
            // Le snapshot attendu est arrivé : l'annulation est confirmée.
            info = '';
            sheet.close();
            announce('Annulation confirmée');
            return;
        }
        const row = currentRow(context);
        // Une fois annulé, l'achat n'est plus annulable : pendant l'envoi, run() ferme et annonce au retour.
        if (!row) {
            if (busy) return;
            const confirmed = info;
            info = '';
            sheet.close();
            if (confirmed) announce('Annulation confirmée');
            return;
        }
        nodes.label.textContent = row.label;
        nodes.summary.textContent = `${row.nature} · remboursement de ${-row.amount} XP`;
        const phase = context.state.phase;
        const reason = !context.online ? 'Annulation possible une fois en ligne'
            : phase === 'legacy-readonly' ? 'Fiche en lecture seule : annulation impossible'
            : !pending && !busy && phase !== 'ready' ? 'Fiche en cours de mise à jour…' : info;
        nodes.reason.textContent = reason;
        nodes.reason.hidden = !reason;
        nodes.failure.textContent = error;
        nodes.failure.hidden = !error;
        nodes.confirm.textContent = busy ? 'Annulation en cours…' : 'Annuler l’achat';
        nodes.confirm.disabled = busy || !!reason;
        nodes.confirm.hidden = pending;
        nodes.retry.hidden = !pending;
        nodes.retry.disabled = !context.online;
    };

    async function run(execute) {
        const context = getContext();
        const row = currentRow(context);
        if (busy || !row) return;
        const message = `${row.label} : achat annulé`;
        busy = true;
        error = '';
        info = '';
        refresh();
        try {
            const result = await execute(context);
            if (result?.status === 'retry-required') error = 'Une commande précédente est en attente. Utilisez Réessayer.';
            else if (result?.status === 'awaiting-snapshot') info = 'Annulation en cours de confirmation…';
            else if (result?.status === 'confirmed') {
                sheet.close();
                announce(message);
            }
        } catch (failure) {
            error = cancelErrorMessage(failure);
        } finally {
            busy = false;
            if (sheet.isOpen()) {
                refresh();
                // Le bouton était désactivé pendant l'envoi : le focus a été perdu.
                const next = !nodes.retry.hidden ? nodes.retry : nodes.confirm.disabled ? null : nodes.confirm;
                next?.focus();
            }
        }
    }

    return Object.freeze({
        element: sheet.element,
        open(id, trigger) {
            purchaseId = id;
            if (!currentRow(getContext())) return;
            busy = false;
            error = '';
            info = '';
            sheet.open({ trigger, render: body => { build(body); refresh(); } });
        },
        update() { if (sheet.isOpen()) refresh(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

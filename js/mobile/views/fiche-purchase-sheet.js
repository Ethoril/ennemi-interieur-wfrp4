import { xpBalance } from '../../fiche/derived.js';
import { createBottomSheet } from '../components/bottom-sheet.js';
import { purchaseErrorMessage, purchasePayload, purchasePreview, purchaseTarget } from '../fiche-purchase.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Volet d'achat d'avances (caractéristique, compétence) ou de talent.
 * `getContext()` → { state (contrôleur), careers, engine, online, controller }.
 * open(spec, trigger) : spec = { kind: 'carac', key } | { kind: 'skill', ...ligne de topSkills } | { kind: 'talent', nom }.
 * Le contenu est construit une fois par ouverture puis mis à jour sur place (le focus reste sur +/−).
 */
export function createPurchaseSheet({ documentRef, getContext, announce = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-purchase-title' });
    let spec = null;
    let count = 1;
    let busy = false;
    let error = '';
    let info = '';
    let nodes = null;

    const build = body => {
        const head = make(documentRef, 'div', '', 'm-purchase-head');
        head.setAttribute('data-sheet-drag', '');
        const titles = make(documentRef, 'div');
        const title = make(documentRef, 'h2', '', 'm-purchase-title');
        title.id = 'm-purchase-title';
        const nature = make(documentRef, 'p', '', 'm-purchase-nature');
        titles.append(title, nature);
        const total = make(documentRef, 'p', '', 'm-purchase-total');
        head.append(titles, total);
        const formula = make(documentRef, 'p', '', 'm-purchase-formula');

        const stepper = make(documentRef, 'div', '', 'm-purchase-stepper');
        const stepLabel = make(documentRef, 'span', 'Avances à acheter', 'm-purchase-step-label');
        const less = make(documentRef, 'button', '−', 'm-purchase-step');
        less.type = 'button';
        less.setAttribute('aria-label', 'Une avance de moins');
        const value = make(documentRef, 'span', '', 'm-purchase-count');
        value.setAttribute('role', 'status');
        const more = make(documentRef, 'button', '+', 'm-purchase-step');
        more.type = 'button';
        more.setAttribute('aria-label', 'Une avance de plus');
        stepper.append(stepLabel, less, value, more);

        const figures = make(documentRef, 'dl', '', 'm-purchase-figures');
        const figure = (label, className = '') => {
            const cell = make(documentRef, 'div');
            const dd = make(documentRef, 'dd', '', className);
            cell.append(make(documentRef, 'dt', label), dd);
            figures.append(cell);
            return dd;
        };
        const newTotal = figure('Nouveau total');
        const cost = figure('Coût', 'm-purchase-cost');
        const after = figure('Restera');

        const tariff = make(documentRef, 'p', '', 'm-purchase-note');
        const reason = make(documentRef, 'p', '', 'm-purchase-reason');
        const failure = make(documentRef, 'p', '', 'm-purchase-error');
        failure.setAttribute('role', 'alert');
        const buy = make(documentRef, 'button', '', 'm-button m-button-primary');
        buy.type = 'button';
        const retry = make(documentRef, 'button', 'Réessayer', 'm-button m-button-primary');
        retry.type = 'button';

        less.addEventListener('click', () => step(-1));
        more.addEventListener('click', () => step(1));
        buy.addEventListener('click', () => run(context => context.controller.executeOnlineCommand(
            'purchase', purchasePayload(target(context), count, context.engine)), true));
        retry.addEventListener('click', () => run(context => context.controller.retryPendingCommand(), false));

        body.replaceChildren(head, formula, stepper, figures, tariff, reason, failure, buy, retry);
        nodes = { title, nature, total, formula, stepper, less, value, more, newTotal, cost, after, tariff, reason, failure, buy, retry };
    };

    const target = context => purchaseTarget(context.state?.data, context.engine, context.careers, spec);

    const refresh = () => {
        const context = getContext();
        const current = target(context);
        if (!current) { sheet.close(); return; }
        const talent = current.kind === 'talent';
        count = Math.min(count, current.maxCount);
        const balance = xpBalance(context.state.data).libre;
        const preview = purchasePreview(current, count, balance);
        const pending = !!context.state.pendingOperationId && !busy;
        if (info && !context.state.pendingOperationId && !busy) {
            // Le snapshot attendu est arrivé : l'achat est confirmé.
            info = '';
            sheet.close();
            announce('Achat confirmé');
            return;
        }

        nodes.title.textContent = current.title;
        nodes.nature.textContent = `${current.nature}${current.inCareer ? ' · de carrière' : ''}`;
        nodes.total.textContent = talent ? '' : String(current.total);
        nodes.total.hidden = talent;
        nodes.formula.textContent = talent ? '' : `${current.baseLabel} ${current.baseValue} + ${current.adv} avances = ${current.total}`;
        nodes.formula.hidden = talent;
        nodes.stepper.hidden = talent;
        nodes.value.textContent = String(count);
        nodes.less.disabled = busy || count <= 1;
        nodes.more.disabled = busy || count >= current.maxCount;
        nodes.newTotal.textContent = talent ? 'Acquis' : String(preview.newTotal);
        nodes.cost.textContent = `${preview.cost} XP`;
        nodes.after.textContent = `${preview.after} XP`;
        nodes.after.className = preview.affordable ? '' : 'm-purchase-short';
        nodes.tariff.textContent = current.inCareer ? 'Tarif carrière' : 'Hors carrière : coût doublé';

        const phase = context.state.phase;
        const reason = !context.online ? 'Achat possible une fois en ligne'
            : phase === 'legacy-readonly' ? 'Fiche en lecture seule : achat impossible'
            : !pending && !busy && phase !== 'ready' ? 'Fiche en cours de mise à jour…'
            : !pending && !preview.affordable ? `XP insuffisants : il manque ${-preview.after} XP` : info;
        nodes.reason.textContent = reason;
        nodes.reason.hidden = !reason;
        nodes.failure.textContent = error;
        nodes.failure.hidden = !error;
        nodes.buy.textContent = busy ? 'Achat en cours…' : `Acheter pour ${preview.cost} XP`;
        nodes.buy.disabled = busy || !!reason;
        nodes.buy.hidden = pending;
        nodes.retry.hidden = !pending;
        nodes.retry.disabled = !context.online;
    };

    function step(delta) {
        const current = target(getContext());
        if (!current) return;
        count = Math.max(1, Math.min(current.maxCount, count + delta));
        error = '';
        refresh();
    }

    // Un achat n'est jamais renvoyé : « Réessayer » rejoue la commande en attente (même identifiant, pas de double débit).
    async function run(execute, fresh) {
        const context = getContext();
        const current = target(context);
        if (busy || !current) return;
        const message = current.kind === 'talent' ? `${current.title} : talent acheté`
            : `${current.title} : +${count} avance${count > 1 ? 's' : ''} achetée${count > 1 ? 's' : ''}`;
        busy = true;
        error = '';
        info = '';
        refresh();
        try {
            const result = await execute(context);
            if (result?.status === 'retry-required') error = 'Un achat précédent est en attente. Utilisez Réessayer.';
            else if (result?.status === 'awaiting-snapshot') info = 'Achat en cours de confirmation…';
            else if (result?.status === 'confirmed') {
                sheet.close();
                announce(fresh ? message : 'Achat confirmé');
            }
        } catch (failure) {
            error = purchaseErrorMessage(failure);
        } finally {
            busy = false;
            if (sheet.isOpen()) {
                refresh();
                // Le bouton était désactivé pendant l'envoi : le focus a été perdu.
                const next = !nodes.retry.hidden ? nodes.retry : nodes.buy.disabled ? null : nodes.buy;
                next?.focus();
            }
        }
    }

    return Object.freeze({
        element: sheet.element,
        open(next, trigger) {
            spec = next;
            if (!target(getContext())) return;
            count = 1;
            busy = false;
            error = '';
            sheet.open({ trigger, render: body => { build(body); refresh(); } });
        },
        update() { if (sheet.isOpen()) refresh(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

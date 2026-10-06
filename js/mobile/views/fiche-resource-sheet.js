import { createBottomSheet } from '../components/bottom-sheet.js';
import { resourceChange } from '../fiche-model.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

const points = n => `${n} point${n > 1 ? 's' : ''}`;

/**
 * Confirmation d'un changement de Destin ou de Résilience. `getContext()` → { state (contrôleur), online, controller }.
 * open({ maxKey, currentKey, maxLabel, label, value }, bouton) : `value` est la valeur proposée. Rien n'est écrit avant « Confirmer » ;
 * ensuite le brouillon est protégé (stagePatch, y compris hors ligne) puis envoyé si possible. onDone(maxKey) rend le focus.
 */
export function createResourceSheet({ documentRef, getContext, announce = () => {}, onDone = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-resource-title' });

    async function confirm(spec, changes) {
        const { controller, online } = getContext();
        const { maxKey, maxLabel, value } = spec;
        const staged = controller?.stagePatch(changes);
        sheet.close();
        if (!staged?.ok) announce('Modification impossible sur cette fiche.');
        else {
            let message = `${maxLabel} : ${value}`;
            try {
                if (!online) message += ', en attente de connexion';
                else {
                    let result = await controller.submitPatch();
                    if (result?.status === 'retry-required') result = await controller.retryPendingPatch();
                    if (result?.reason === 'conflict') message = `Conflit sur ${maxLabel} : la valeur a aussi changé sur le serveur`;
                    else if (result?.status === 'blocked') message += ', enregistrement en attente';
                }
            } catch {
                message += ', enregistrement en attente';
            }
            announce(message);
        }
        onDone(maxKey);
    }

    return Object.freeze({
        element: sheet.element,
        open(spec, trigger) {
            const { state } = getContext();
            const current = Number.parseInt(state?.data?.[spec.maxKey], 10) || 0;
            if (spec.value === current) return;
            const { changes, lowered } = resourceChange(state?.data, spec.maxKey, spec.currentKey, spec.value);
            const burn = spec.value < current;
            const delta = Math.abs(spec.value - current);
            const lead = burn ? `Brûler ${points(delta)} de ${spec.maxLabel} ?` : `Ajouter 1 point de ${spec.maxLabel} ?`;
            const warning = burn
                ? `Ce n'est pas anodin : ${delta > 1 ? 'les points sont perdus définitivement' : 'le point est perdu définitivement'}.`
                : '(normalement accordé par le MJ)';
            sheet.open({ trigger, render: body => {
                const title = make(documentRef, 'h2', lead, 'm-purchase-title');
                title.id = 'm-resource-title';
                title.tabIndex = -1;
                const note = make(documentRef, 'p', warning, 'm-purchase-note');
                const side = lowered === null ? null
                    : make(documentRef, 'p', `La ${spec.label} sera aussi ramenée de ${lowered} à ${spec.value}.`, 'm-purchase-formula');
                const ok = make(documentRef, 'button', 'Confirmer', burn ? 'm-button m-button-danger' : 'm-button m-button-primary');
                const cancel = make(documentRef, 'button', 'Annuler', 'm-button');
                for (const button of [ok, cancel]) button.type = 'button';
                ok.addEventListener('click', () => { void confirm(spec, changes); });
                cancel.addEventListener('click', () => sheet.close());
                body.replaceChildren(...[title, note, side, ok, cancel].filter(Boolean));
            } });
        },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

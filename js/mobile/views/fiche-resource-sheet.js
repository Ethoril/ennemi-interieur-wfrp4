import { createBottomSheet } from '../components/bottom-sheet.js';
import { submitDraft } from '../fiche-autosave.js';
import { count, resourceChange } from '../fiche-model.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

const points = n => `${n} point${n > 1 ? 's' : ''}`;
const isConflict = error => String(error?.code || '').split('/').at(-1) === 'aborted';

/**
 * Confirmation d'un changement de Destin ou de Résilience. `getContext()` → { state (contrôleur), online, controller }.
 * open({ maxKey, currentKey, maxLabel, label, value }, bouton) : `value` est la valeur proposée. Rien n'est écrit avant « Confirmer » ;
 * le patch est recalculé à ce moment-là sur la fiche courante, et s'il diffère de ce qui était affiché le texte est mis à jour
 * et un second toucher est demandé. Ensuite le brouillon est protégé (stagePatch, y compris hors ligne) puis envoyé si possible
 * (envois sérialisés, voir submitDraft). onDone(maxKey) rend le focus dès la fermeture.
 */
export function createResourceSheet({ documentRef, getContext, announce = () => {}, onDone = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-resource-title' });
    let nodes = null;
    let spec = null;
    let shown = '';

    // Texte du volet pour la fiche courante ; renvoie le patch affiché, ou null s'il n'y a plus rien à changer.
    function fill() {
        const data = getContext().state?.data;
        const current = count(data?.[spec.maxKey]);
        if (spec.value === current) return null;
        const { changes, lowered } = resourceChange(data, spec.maxKey, spec.currentKey, spec.value);
        const burn = spec.value < current;
        const delta = Math.abs(spec.value - current);
        nodes.title.textContent = burn ? `Brûler ${points(delta)} de ${spec.maxLabel} ?` : `Ajouter 1 point de ${spec.maxLabel} ?`;
        nodes.note.textContent = burn
            ? `Ce n'est pas anodin : ${delta > 1 ? 'les points sont perdus définitivement' : 'le point est perdu définitivement'}.`
            : '(normalement accordé par le MJ)';
        nodes.side.textContent = lowered === null ? '' : `La ${spec.label} sera aussi ramenée de ${lowered} à ${spec.value}.`;
        nodes.side.hidden = lowered === null;
        nodes.ok.className = burn ? 'm-button m-button-danger' : 'm-button m-button-primary';
        shown = JSON.stringify(changes);
        return changes;
    }

    async function confirm() {
        const before = shown;
        const changes = fill();
        if (!changes) { sheet.close(); onDone(spec.maxKey); return; }
        // La fiche a changé depuis l'ouverture : on montre le nouveau texte et on demande de confirmer à nouveau.
        if (shown !== before) { nodes.cancel.focus(); return; }
        const { controller, online } = getContext();
        const { maxKey, maxLabel, value } = spec;
        const staged = controller?.stagePatch(changes);
        sheet.close();
        onDone(maxKey);
        if (!staged?.ok) { announce('Modification impossible sur cette fiche.'); return; }
        let message = `${maxLabel} : ${value}`;
        if (!online) message += ', en attente de connexion';
        else {
            try {
                const result = await submitDraft(controller);
                if (result?.reason === 'conflict') message = `Conflit sur ${maxLabel} : la valeur a aussi changé sur le serveur`;
                else if (result?.status === 'blocked' || result?.status === 'retry-required') message += ', enregistrement en attente';
            } catch (error) {
                message = isConflict(error) ? 'Conflit : la valeur a changé ailleurs' : `${message}, enregistrement en attente`;
            }
        }
        announce(message);
    }

    const build = body => {
        const title = make(documentRef, 'h2', '', 'm-purchase-title');
        title.id = 'm-resource-title';
        title.tabIndex = -1;
        const note = make(documentRef, 'p', '', 'm-purchase-note');
        const side = make(documentRef, 'p', '', 'm-purchase-formula');
        const ok = make(documentRef, 'button', 'Confirmer');
        const cancel = make(documentRef, 'button', 'Annuler', 'm-button');
        for (const button of [ok, cancel]) button.type = 'button';
        ok.addEventListener('click', () => { void confirm(); });
        cancel.addEventListener('click', () => sheet.close());
        body.replaceChildren(title, note, side, ok, cancel);
        nodes = { title, note, side, ok, cancel };
    };

    return Object.freeze({
        element: sheet.element,
        open(next, trigger) {
            spec = next;
            if (spec.value === count(getContext().state?.data?.[spec.maxKey])) return;
            sheet.open({ trigger, render: body => { build(body); fill(); } });
            // Action destructive : le focus initial est sur « Annuler ».
            nodes.cancel.focus();
        },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

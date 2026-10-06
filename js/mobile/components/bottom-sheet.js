import { createDialogController } from '../ui.js';

const CLOSE_DISTANCE = 80;
const LEAVE_MS = 180;

function make(documentRef, tag, className) {
    const node = documentRef.createElement(tag);
    node.className = className;
    return node;
}

/**
 * Volet bas réutilisable : <dialog> modal (focus piégé, Échap, retour du focus par createDialogController),
 * fond cliquable, poignée. Un glissé vers le bas sur la poignée ou sur un élément `data-sheet-drag`
 * au-delà de CLOSE_DISTANCE ferme le volet. `render(body)` remplit le contenu : open() l'appelle une fois,
 * update() le rappelle (à lui de mettre à jour sur place pour garder le focus).
 */
export function createBottomSheet({ documentRef, labelledBy }) {
    const dialog = make(documentRef, 'dialog', 'm-dialog m-bottom-sheet');
    dialog.setAttribute('aria-labelledby', labelledBy);
    const handle = make(documentRef, 'div', 'm-sheet-handle');
    handle.setAttribute('aria-hidden', 'true');
    const body = make(documentRef, 'div', 'm-sheet-body');
    dialog.append(handle, body);
    const controller = createDialogController({ dialog, documentRef });
    const view = documentRef.defaultView;
    // Sans matchMedia (hors navigateur), on ne joue pas d'animation de sortie.
    const animated = () => view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === false;

    let drag = null;
    let leaving = null;
    const reset = () => {
        clearTimeout(leaving);
        leaving = null;
        drag = null;
        dialog.style.transition = '';
        dialog.style.transform = '';
    };
    const close = () => {
        if (!controller.isOpen()) return;
        reset();
        controller.close();
    };
    const dismiss = () => {
        if (!animated()) { close(); return; }
        dialog.style.transition = '';
        dialog.style.transform = 'translateY(100%)';
        leaving = setTimeout(close, LEAVE_MS);
    };

    const isDragZone = target => target === handle || !!target?.closest?.('[data-sheet-drag]');
    dialog.addEventListener('pointerdown', event => {
        if (leaving || !isDragZone(event.target)) return;
        drag = { startY: event.clientY, distance: 0 };
        dialog.style.transition = 'none';
        dialog.setPointerCapture?.(event.pointerId);
    });
    dialog.addEventListener('pointermove', event => {
        if (!drag) return;
        drag.distance = Math.max(0, event.clientY - drag.startY);
        dialog.style.transform = `translateY(${drag.distance}px)`;
    });
    const release = event => {
        if (!drag) return;
        const far = event.type === 'pointerup' && drag.distance > CLOSE_DISTANCE;
        drag = null;
        if (far) dismiss();
        else { dialog.style.transition = ''; dialog.style.transform = ''; }
    };
    dialog.addEventListener('pointerup', release);
    dialog.addEventListener('pointercancel', release);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('click', event => { if (event.target === dialog) close(); });

    return Object.freeze({
        element: dialog,
        open({ trigger, render }) {
            if (controller.isOpen()) return;
            reset();
            render(body);
            controller.show(trigger);
        },
        update(render) { if (controller.isOpen()) render(body); },
        close,
        isOpen: controller.isOpen,
        destroy() { close(); dialog.remove?.(); },
    });
}

import { createDialogController } from '../ui.js';
import { rubberband, velocityFrom, shouldDismiss, exitDuration } from './sheet-physics.js';

function make(documentRef, tag, className) {
    const node = documentRef.createElement(tag);
    node.className = className;
    return node;
}

/**
 * Volet bas réutilisable : <dialog> modal (focus piégé, Échap, retour du focus par createDialogController),
 * fond cliquable, poignée. Un glissé sur la poignée ou sur un élément `data-sheet-drag` suit le doigt
 * (élastique vers le haut) ; au relâchement, la vitesse projetée décide de la fermeture (sheet-physics.js)
 * et la sortie poursuit à la vitesse du doigt. Pendant la sortie, le volet peut être ressaisi sans saut.
 * `render(body)` remplit le contenu : open() l'appelle une fois,
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
    let lastOffset = 0;
    const reset = () => {
        clearTimeout(leaving);
        leaving = null;
        drag = null;
        lastOffset = 0;
        dialog.style.transition = '';
        dialog.style.transform = '';
    };
    const close = () => {
        if (!controller.isOpen()) return;
        reset();
        controller.close();
    };
    const heightOf = () => dialog.getBoundingClientRect?.().height || 0;
    // Position verticale réellement affichée (la sortie peut être en cours) ; repli sur le dernier décalage connu.
    const currentOffset = () => {
        const transform = view?.getComputedStyle?.(dialog)?.transform;
        const values = /^matrix(3d)?\((.+)\)$/.exec(transform || '')?.[2].split(',').map(Number);
        const y = values?.[values.length === 16 ? 13 : 5];
        return Number.isFinite(y) ? y : lastOffset;
    };
    const dismiss = (offset, velocity) => {
        if (!animated()) { close(); return; }
        const height = heightOf();
        const ms = exitDuration(height - offset, velocity);
        dialog.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0, 0, 1)`;
        dialog.style.transform = 'translateY(100%)';
        leaving = setTimeout(close, ms);
    };

    const isDragZone = target => target === handle || !!target?.closest?.('[data-sheet-drag]');
    dialog.addEventListener('pointerdown', event => {
        if (!isDragZone(event.target)) return;
        let base = 0;
        if (leaving) {
            base = currentOffset();
            clearTimeout(leaving);
            leaving = null;
        }
        drag = {
            startY: event.clientY,
            base,
            distance: base,
            samples: [{ t: event.timeStamp ?? Date.now(), y: event.clientY }],
        };
        lastOffset = base;
        dialog.style.transition = 'none';
        dialog.style.transform = `translateY(${base}px)`;
        dialog.setPointerCapture?.(event.pointerId);
    });
    dialog.addEventListener('pointermove', event => {
        if (!drag) return;
        drag.samples.push({ t: event.timeStamp ?? Date.now(), y: event.clientY });
        if (drag.samples.length > 5) drag.samples.shift();
        const raw = drag.base + event.clientY - drag.startY;
        drag.distance = raw >= 0 ? raw : -rubberband(-raw, heightOf());
        lastOffset = drag.distance;
        dialog.style.transform = `translateY(${drag.distance}px)`;
    });
    const release = event => {
        if (!drag) return;
        const { distance, samples } = drag;
        // Le relâché compte : un doigt immobile avant de lever n'a plus de vitesse.
        samples.push({ t: event.timeStamp ?? Date.now(), y: event.clientY ?? samples[samples.length - 1].y });
        const offset = Math.max(0, distance);
        const velocity = velocityFrom(samples);
        const far = event.type === 'pointerup' && shouldDismiss({ offset, velocity, height: heightOf() });
        drag = null;
        if (far) dismiss(offset, velocity);
        else { dialog.style.transition = ''; dialog.style.transform = ''; lastOffset = 0; }
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

import { createMorr, createSeal } from '../../seal.js';
import { vivantKey } from '../pnj-list-model.js';

const OWNER_ID = /^[A-Za-z0-9_-]{1,100}$/u;
const FILE_NAME = /^[A-Za-z0-9._-]{1,128}$/u;
// Illustration d'un PNJ sans portrait : carte entière pour le bandeau, médaillon
// recadré pour les vignettes. Un portrait invalide ou legacy garde les initiales.
const DEFAULT_PORTRAIT = new URL('../../../img/pnj-default.webp', import.meta.url).href;
const DEFAULT_MEDALLION = new URL('../../../img/pnj-default-medaillon.webp', import.meta.url).href;
const BANNER_SIZE = 160;

function ownedPortraitPath(item) {
    const path = item?.image?.path;
    if (item?.image?.invalid || item?.image?.legacy || typeof path !== 'string') return null;
    const parts = path.split('/');
    if (parts.length !== 3 || parts[0] !== 'portraits' || parts[1] !== item.id
        || !OWNER_ID.test(parts[1]) || !FILE_NAME.test(parts[2]) || ['.', '..'].includes(parts[2])) return null;
    return path;
}

function initials(name) {
    const parts = String(name ?? '').trim().split(/\s+/u).filter(Boolean);
    const value = parts.slice(0, 2).map(part => [...part][0] ?? '').join('').toLocaleUpperCase('fr-FR');
    return value || 'PNJ';
}

function once(callback) {
    let called = false;
    return () => {
        if (called) return;
        called = true;
        callback?.();
    };
}

// Sceau et porte de Morr sont posés à côté du cadre, pas dedans : le cadre rogne
// l'image en cercle, les marques doivent pouvoir déborder sur son pourtour.
// Sans createElementNS (faux documents des tests), seal.js rend null : rien n'est inséré.
function mountMarks(documentRef, frame, marks) {
    if (!marks || typeof marks !== 'object') return [];
    const vivant = vivantKey(marks.vivant);
    if (vivant === 'decede') frame.className += ' m-portrait-frame--decede';
    else if (vivant === 'inconnu') frame.className += ' m-portrait-frame--inconnu';
    const slots = [];
    const place = (className, mark) => {
        if (!mark) return;
        const slot = documentRef.createElement('span');
        slot.className = className;
        slot.append(mark);
        slots.push(slot);
    };
    if (Object.hasOwn(marks, 'statut')) place('m-portrait-seal', createSeal(documentRef, marks.statut, { size: marks.sealSize ?? 20 }));
    if (vivant === 'decede') place('m-portrait-morr', createMorr(documentRef, { size: marks.morrSize ?? 18 }));
    return slots;
}

export function mountPnjPortrait({ container, item, imageService, size = 56, marks = null } = {}) {
    if (!container?.ownerDocument) return Object.freeze({ dispose() {} });
    const documentRef = container.ownerDocument;
    const frame = documentRef.createElement('span');
    frame.className = 'm-portrait-frame';
    const placeholder = documentRef.createElement('span');
    placeholder.className = 'm-portrait-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.textContent = initials(item?.nom);
    frame.append(placeholder);
    const markSlots = mountMarks(documentRef, frame, marks);
    container.replaceChildren(frame, ...markSlots);
    const removeOwnNodes = () => {
        frame.remove();
        for (const slot of markSlots) slot.remove();
    };
    const path = ownedPortraitPath(item);
    const declared = item?.image;
    if (!declared?.path && declared?.legacy !== true && declared?.invalid !== true) {
        const illustration = documentRef.createElement('img');
        illustration.className = size >= BANNER_SIZE ? 'm-portrait-image m-portrait-image--defaut' : 'm-portrait-image';
        illustration.alt = '';
        illustration.width = size;
        illustration.height = size;
        illustration.decoding = 'async';
        illustration.src = size >= BANNER_SIZE ? DEFAULT_PORTRAIT : DEFAULT_MEDALLION;
        frame.append(illustration);
    }
    if (!path || typeof imageService?.loadObjectUrl !== 'function') {
        return Object.freeze({ dispose: once(removeOwnNodes) });
    }

    let active = true;
    let image = null;
    let release = () => {};
    try {
        const loading = imageService.loadObjectUrl(path);
        release = once(loading?.release);
        Promise.resolve(loading).then(handle => {
            if (!active) { release(); return; }
            if (!handle || typeof handle.url !== 'string' || !handle.url.startsWith('blob:')) {
                release();
                return;
            }
            image = documentRef.createElement('img');
            image.className = 'm-portrait-image';
            image.alt = '';
            image.width = size;
            image.height = size;
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => {
                if (!active) return;
                image?.remove();
                image = null;
                release();
            }, { once: true });
            image.src = handle.url;
            frame.append(image);
        }).catch(() => { release(); });
    } catch {
        release();
    }
    const dispose = once(() => {
        active = false;
        image?.remove();
        image = null;
        release();
        removeOwnNodes();
    });
    return Object.freeze({ dispose });
}

export { initials, ownedPortraitPath };

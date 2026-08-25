const OWNER_ID = /^[A-Za-z0-9_-]{1,100}$/u;
const FILE_NAME = /^[A-Za-z0-9._-]{1,128}$/u;

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

export function mountPnjPortrait({ container, item, imageService, size = 56 } = {}) {
    if (!container?.ownerDocument) return Object.freeze({ dispose() {} });
    const documentRef = container.ownerDocument;
    const frame = documentRef.createElement('span');
    frame.className = 'm-portrait-frame';
    const placeholder = documentRef.createElement('span');
    placeholder.className = 'm-portrait-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.textContent = initials(item?.nom);
    frame.append(placeholder);
    container.replaceChildren(frame);
    const path = ownedPortraitPath(item);
    if (!path || typeof imageService?.loadObjectUrl !== 'function') {
        return Object.freeze({ dispose() { frame.remove(); } });
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
        frame.remove();
    });
    return Object.freeze({ dispose });
}

export { initials, ownedPortraitPath };

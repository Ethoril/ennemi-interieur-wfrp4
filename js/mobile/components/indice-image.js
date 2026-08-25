const OWNER_ID = /^[A-Za-z0-9_-]{1,150}$/u;
const FILE_NAME = /^[A-Za-z0-9._-]{1,128}$/u;

function ownedIndicePath(item) {
    const path = item?.image?.path;
    if (item?.image?.legacy || item?.image?.invalid || typeof path !== 'string') return null;
    const parts = path.split('/');
    return parts.length === 3 && parts[0] === 'indices' && parts[1] === item.id
        && OWNER_ID.test(parts[1]) && FILE_NAME.test(parts[2]) && !['.', '..'].includes(parts[2]) ? path : null;
}

function once(callback) {
    let called = false;
    return () => {
        if (called) return;
        called = true;
        callback?.();
    };
}

export function mountIndiceImage({ container, item, imageService, size = 96, lazy = false } = {}) {
    if (!container?.ownerDocument) return Object.freeze({ dispose() {} });
    const documentRef = container.ownerDocument;
    const frame = documentRef.createElement('span');
    frame.className = 'm-indice-image-frame';
    frame.setAttribute('aria-hidden', 'true');
    const placeholder = documentRef.createElement('span');
    placeholder.className = 'm-indice-image-placeholder';
    placeholder.textContent = '✦';
    frame.append(placeholder);
    container.replaceChildren(frame);
    const path = ownedIndicePath(item);
    if (!path || typeof imageService?.loadObjectUrl !== 'function') {
        return Object.freeze({ dispose() { frame.remove(); } });
    }

    let active = true;
    let image = null;
    let release = () => {};
    let loadingStarted = false;
    let observer = null;

    const disconnect = once(() => observer?.disconnect?.());
    const load = () => {
        if (!active || loadingStarted) return;
        loadingStarted = true;
        disconnect();
        try {
            const loading = imageService.loadObjectUrl(path);
            release = once(loading?.release);
            Promise.resolve(loading).then(handle => {
                if (!active) {
                    release();
                    return;
                }
                if (!handle || typeof handle.url !== 'string' || !handle.url.startsWith('blob:')) {
                    release();
                    return;
                }
                image = documentRef.createElement('img');
                image.className = 'm-indice-image';
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
    };

    if (lazy) {
        const Observer = documentRef.defaultView?.IntersectionObserver || globalThis.IntersectionObserver;
        if (typeof Observer === 'function') {
            try {
                observer = new Observer(entries => {
                    if (entries.some(entry => entry?.isIntersecting || entry?.intersectionRatio > 0)) load();
                }, { rootMargin: '120px' });
                observer.observe(frame);
            } catch {
                observer = null;
                load();
            }
        } else {
            load();
        }
    } else {
        load();
    }

    return Object.freeze({ dispose: once(() => {
        active = false;
        disconnect();
        image?.remove();
        image = null;
        release();
        frame.remove();
    }) });
}

export { ownedIndicePath };

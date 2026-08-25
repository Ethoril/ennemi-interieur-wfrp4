export function createAppLifecycle({ windowRef = globalThis.window, startApp } = {}) {
    if (!windowRef || typeof startApp !== 'function') throw new TypeError('windowRef et startApp requis');
    let active = true;
    let runtime = null;
    let stopping = Promise.resolve();

    const mount = () => {
        if (!active || runtime) return runtime;
        runtime = startApp() || null;
        return runtime;
    };
    const release = () => {
        const previous = runtime;
        runtime = null;
        if (!previous) return stopping;
        stopping = stopping.then(() => previous.stop?.()).catch(() => {});
        return stopping;
    };
    const onPageHide = () => { release(); };
    const onPageShow = event => {
        if (event?.persisted !== true || !active) return;
        stopping.then(() => { if (active && !runtime) mount(); });
    };

    windowRef.addEventListener?.('pagehide', onPageHide);
    windowRef.addEventListener?.('pageshow', onPageShow);
    mount();

    const stop = async () => {
        if (!active) return stopping;
        active = false;
        windowRef.removeEventListener?.('pagehide', onPageHide);
        windowRef.removeEventListener?.('pageshow', onPageShow);
        return release();
    };
    return Object.freeze({ stop, getRuntime: () => runtime });
}

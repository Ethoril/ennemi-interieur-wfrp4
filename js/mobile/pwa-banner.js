export function createPwaBanner({ documentRef, pwa }) {
    const banner = documentRef?.querySelector?.('#m-pwa-banner');
    const text = documentRef?.querySelector?.('#m-pwa-banner-text');
    const update = documentRef?.querySelector?.('#m-pwa-update');
    const install = documentRef?.querySelector?.('#m-pwa-install');
    const dismiss = documentRef?.querySelector?.('#m-pwa-dismiss');
    if (!banner || !text || !update || !install || !dismiss || !pwa) {
        return Object.freeze({ stop() {} });
    }
    let active = true;
    let lifecycle = 0;

    const render = state => {
        const hasUpdate = state.updateAvailable === true;
        banner.hidden = !hasUpdate;
        text.textContent = hasUpdate ? 'Mise à jour disponible.' : '';
        update.hidden = !hasUpdate;
        update.disabled = state.updateRequested === true;
        install.hidden = true;
        dismiss.hidden = true;
    };

    const unsubscribe = pwa.subscribe(render);
    const onUpdate = async () => {
        const token = lifecycle;
        let result;
        try {
            result = pwa.requestUpdate
                ? await pwa.requestUpdate()
                : pwa.applyUpdate();
        } catch {
            if (!active || token !== lifecycle) return;
            result = false;
        }
        if (!active || token !== lifecycle) return;
        if (result === false && pwa.getState?.().updateAvailable) {
            banner.hidden = false;
            text.textContent = 'Mise à jour impossible ou différée. Terminez votre saisie, puis réessayez.';
        }
    };
    const onInstall = () => { void pwa.promptInstall(); };
    const onDismiss = () => { pwa.dismissInstall(); };
    update.addEventListener('click', onUpdate);
    install.addEventListener('click', onInstall);
    dismiss.addEventListener('click', onDismiss);

    return Object.freeze({
        stop() {
            active = false;
            lifecycle += 1;
            unsubscribe();
            update.removeEventListener('click', onUpdate);
            install.removeEventListener('click', onInstall);
            dismiss.removeEventListener('click', onDismiss);
            banner.hidden = true;
        },
    });
}

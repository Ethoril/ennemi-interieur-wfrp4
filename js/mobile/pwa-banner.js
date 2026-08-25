export function createPwaBanner({ documentRef, pwa }) {
    const banner = documentRef?.querySelector?.('#m-pwa-banner');
    const text = documentRef?.querySelector?.('#m-pwa-banner-text');
    const update = documentRef?.querySelector?.('#m-pwa-update');
    const install = documentRef?.querySelector?.('#m-pwa-install');
    const dismiss = documentRef?.querySelector?.('#m-pwa-dismiss');
    if (!banner || !text || !update || !install || !dismiss || !pwa) {
        return Object.freeze({ stop() {} });
    }

    const render = state => {
        const hint = pwa.getInstallationHint();
        const hasUpdate = state.updateAvailable === true;
        const hasInstall = Boolean(hint);
        banner.hidden = !hasUpdate && !hasInstall;
        text.textContent = hasUpdate && hasInstall
            ? 'Mise à jour disponible. Vous pouvez aussi installer l’application.'
            : hasUpdate ? 'Mise à jour disponible.' : hint?.text || '';
        update.hidden = !hasUpdate;
        update.disabled = state.updateRequested === true;
        install.hidden = hint?.kind !== 'android';
        dismiss.hidden = !hasInstall;
    };

    const unsubscribe = pwa.subscribe(render);
    const onUpdate = () => { pwa.applyUpdate(); };
    const onInstall = () => { void pwa.promptInstall(); };
    const onDismiss = () => { pwa.dismissInstall(); };
    update.addEventListener('click', onUpdate);
    install.addEventListener('click', onInstall);
    dismiss.addEventListener('click', onDismiss);

    return Object.freeze({
        stop() {
            unsubscribe();
            update.removeEventListener('click', onUpdate);
            install.removeEventListener('click', onInstall);
            dismiss.removeEventListener('click', onDismiss);
            banner.hidden = true;
        },
    });
}

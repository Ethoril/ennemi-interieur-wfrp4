/** Garder une navigation disponible et réserver sa hauteur, zone système comprise. */
export function observeMobileNavigation({ app, navigation, windowRef = globalThis.window } = {}) {
    if (!app || !navigation) return () => {};
    const globalNav = navigation.querySelector('.m-bottom-nav');
    const update = () => {
        // Les onglets remplacent la navigation générale uniquement une fois montés.
        if (globalNav) globalNav.hidden = Boolean(navigation.querySelector('.m-fiche-tabs'));
        const height = Math.ceil(navigation.getBoundingClientRect().height);
        app.style.setProperty('--m-navigation-height', height + 'px');
    };
    const observer = windowRef?.ResizeObserver ? new windowRef.ResizeObserver(update) : null;
    const mutations = windowRef?.MutationObserver ? new windowRef.MutationObserver(update) : null;
    observer?.observe(navigation, { box: 'border-box' });
    mutations?.observe(navigation, { childList: true, subtree: true });
    update();
    return () => {
        observer?.disconnect();
        mutations?.disconnect();
        app.style.removeProperty('--m-navigation-height');
    };
}

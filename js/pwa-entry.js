function isStandalone(windowRef, navigatorRef) {
    return navigatorRef?.standalone === true
        || windowRef?.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

export function legacyStandaloneMobileTarget({
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    navigatorRef = windowRef?.navigator,
} = {}) {
    if (!windowRef?.location?.href || !documentRef?.baseURI || !isStandalone(windowRef, navigatorRef)) return null;
    const current = new URL(windowRef.location.href);
    const legacyIndex = new URL('index.html', documentRef.baseURI);
    const legacyDirectory = new URL('./', legacyIndex);
    const isLegacyEntry = current.origin === legacyIndex.origin
        && (current.pathname === legacyIndex.pathname || current.pathname === legacyDirectory.pathname);
    return isLegacyEntry ? new URL('app/index.html', legacyIndex).href : null;
}

export function redirectLegacyStandaloneEntry(options = {}) {
    const target = legacyStandaloneMobileTarget(options);
    if (!target) return false;
    const locationRef = options.windowRef?.location || globalThis.window?.location;
    locationRef?.replace?.(target);
    return true;
}

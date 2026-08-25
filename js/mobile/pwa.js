const DISMISS_KEY = 'wfrp-pwa-install-dismissed-at';
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function isIos(windowRef, navigatorRef) {
    return /iphone|ipad|ipod/iu.test(navigatorRef?.userAgent || '')
        || (windowRef?.navigator?.platform === 'MacIntel' && navigatorRef?.maxTouchPoints > 1);
}

function isStandalone(windowRef, navigatorRef) {
    return navigatorRef?.standalone === true
        || windowRef?.matchMedia?.('(display-mode: standalone)')?.matches === true;
}

function readDismissed(storage, now) {
    try {
        const value = Number(storage?.getItem?.(DISMISS_KEY));
        return Number.isFinite(value) && value > 0 && value <= now && now - value < DISMISS_MS;
    } catch { return false; }
}

function safeMessage(announce, text) {
    if (typeof announce === 'function') announce(text);
}

export function createPwaController({
    windowRef = globalThis.window,
    navigatorRef = windowRef?.navigator,
    documentRef = windowRef?.document,
    router = null,
    announce = () => {},
    now = () => Date.now(),
    storage = (() => { try { return windowRef?.localStorage; } catch { return null; } })(),
} = {}) {
    let registration = null;
    let waiting = null;
    let deferredPrompt = null;
    let updateAvailable = false;
    let updateRequested = false;
    let reloadScheduled = false;
    let started = false;
    let stopped = false;
    let generation = 0;
    let checkGeneration = 0;
    let updateActionPromise = null;
    let workerVersion = null;
    let error = null;
    let installError = false;
    const listeners = new Set();
    const handlers = {};
    const installingListeners = new Map();

    const standalone = () => isStandalone(windowRef, navigatorRef);
    const ios = () => isIos(windowRef, navigatorRef);
    const canOfferInstall = () => !standalone() && !readDismissed(storage, now());
    const getState = () => Object.freeze({
        supported: Boolean(navigatorRef?.serviceWorker),
        registered: Boolean(registration),
        updateAvailable,
        updateRequested,
        installAvailable: Boolean(deferredPrompt) && canOfferInstall(),
        iosInstallHint: ios() && canOfferInstall(),
        standalone: standalone(),
        workerVersion,
        error,
        installError,
    });
    const emit = () => { const state = getState(); listeners.forEach(listener => listener(state)); };
    const subscribe = listener => {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        listener(getState());
        return () => listeners.delete(listener);
    };

    const askWorkerVersion = async (token = generation) => {
        if (stopped || !started || token !== generation) return null;
        const target = registration?.active || registration?.waiting;
        if (!target || typeof target.postMessage !== 'function') return null;
        if (typeof windowRef?.MessageChannel !== 'function' && typeof globalThis.MessageChannel !== 'function') return null;
        const Channel = windowRef?.MessageChannel || globalThis.MessageChannel;
        const channel = new Channel();
        const result = new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                channel.port1.close?.();
                channel.port2.close?.();
                resolve(value);
            };
            channel.port1.onmessage = event => finish(event.data?.version || null);
            windowRef?.setTimeout?.(() => finish(null), 800);
        });
        try { target.postMessage({ type: 'GET_VERSION' }, [channel.port2]); } catch { return null; }
        workerVersion = await result;
        if (stopped || !started || token !== generation) return null;
        emit();
        return workerVersion;
    };

    const markWaiting = (worker, token = generation) => {
        if (!worker || stopped || !started || token !== generation) return;
        waiting = worker;
        if (navigatorRef?.serviceWorker?.controller) {
            updateAvailable = true;
            safeMessage(announce, 'Mise à jour disponible. Vous pouvez l’appliquer depuis Réglages.');
            emit();
        }
    };

    const watchInstalling = (worker, token = generation) => {
        if (!worker?.addEventListener || stopped || !started || token !== generation) return;
        const previous = installingListeners.get(worker);
        if (previous) worker.removeEventListener('statechange', previous);
        const onStateChange = () => {
            if (stopped || !started || token !== generation) return;
            if (worker.state === 'installed') markWaiting(worker, token);
            if (worker.state === 'activated' && waiting === worker) completeUpdate();
        };
        worker.addEventListener('statechange', onStateChange);
        installingListeners.set(worker, onStateChange);
        if (worker.state === 'installed') onStateChange();
    };

    const clearWaiting = () => {
        const previous = waiting;
        waiting = null;
        updateAvailable = false;
        updateRequested = false;
        const listener = installingListeners.get(previous);
        if (listener) {
            previous.removeEventListener?.('statechange', listener);
            installingListeners.delete(previous);
        }
        emit();
    };

    const completeUpdate = () => {
        if (stopped) return;
        const shouldReload = updateRequested;
        clearWaiting();
        if (!shouldReload || reloadScheduled) return;
        reloadScheduled = true;
        windowRef?.location?.reload?.();
    };
    const onUpdateFound = () => watchInstalling(registration?.installing, generation);
    const onControllerChange = () => completeUpdate();
    const onBeforeInstallPrompt = event => {
        event.preventDefault?.();
        deferredPrompt = event;
        installError = false;
        emit();
    };
    const onAppInstalled = () => {
        deferredPrompt = null;
        installError = false;
        emit();
        safeMessage(announce, 'Application installée sur cet appareil.');
    };

    const register = async token => {
        if (!navigatorRef?.serviceWorker?.register) return null;
        try {
            const candidate = await navigatorRef.serviceWorker.register('../sw.js', {
                scope: '../', updateViaCache: 'none',
            });
            if (stopped || !started || token !== generation) return null;
            registration = candidate;
            error = null;
            registration.addEventListener?.('updatefound', onUpdateFound);
            if (registration.waiting) markWaiting(registration.waiting, token);
            watchInstalling(registration.waiting, token);
            watchInstalling(registration.installing, token);
            emit();
            await askWorkerVersion(token);
            return registration;
        } catch {
            if (stopped || !started || token !== generation) return null;
            error = 'registration-failed';
            emit();
            return null;
        }
    };

    const start = async () => {
        if (started || stopped) return getState();
        started = true;
        handlers.beforeInstallPrompt = onBeforeInstallPrompt;
        handlers.appInstalled = onAppInstalled;
        handlers.controllerChange = onControllerChange;
        windowRef?.addEventListener?.('beforeinstallprompt', handlers.beforeInstallPrompt);
        windowRef?.addEventListener?.('appinstalled', handlers.appInstalled);
        navigatorRef?.serviceWorker?.addEventListener?.('controllerchange', handlers.controllerChange);
        const token = ++generation;
        await register(token);
        return getState();
    };

    const checkForUpdate = async () => {
        if (!started || stopped) return false;
        const checkToken = ++checkGeneration;
        const currentRegistration = registration;
        if (!currentRegistration?.update) {
            const token = ++generation;
            const retried = await register(token);
            if (stopped || !started || token !== generation || checkToken !== checkGeneration) return false;
            const succeeded = Boolean(retried);
            safeMessage(announce, succeeded ? 'Service worker reconnecté.' : 'Service worker indisponible.');
            return succeeded;
        }
        try {
            await currentRegistration.update();
            if (stopped || !started || checkToken !== checkGeneration) return false;
            if (currentRegistration.waiting) markWaiting(currentRegistration.waiting, generation);
            if (stopped || !started || checkToken !== checkGeneration) return false;
            safeMessage(announce, updateAvailable ? 'Mise à jour disponible.' : 'Aucune mise à jour disponible.');
            return true;
        } catch {
            if (stopped || !started || checkToken !== checkGeneration) return false;
            safeMessage(announce, 'Recherche de mise à jour impossible hors connexion.');
            return false;
        }
    };

    const applyUpdate = () => {
        if (stopped || !started || !waiting || updateRequested) return false;
        if (router?.canLeaveCurrent?.() === false) {
            safeMessage(announce, 'Mise à jour différée : terminez ou enregistrez votre saisie.');
            return false;
        }
        updateRequested = true;
        emit();
        try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch { updateRequested = false; emit(); return false; }
        return true;
    };

    const requestUpdate = () => {
        if (updateActionPromise) return updateActionPromise;
        updateActionPromise = (async () => {
            const checked = await checkForUpdate();
            if (stopped || !started) return false;
            const activeWaiting = registration?.waiting || waiting;
            if (activeWaiting && waiting !== activeWaiting) markWaiting(activeWaiting, generation);
            if (!checked && !activeWaiting) { clearWaiting(); return false; }
            if (!waiting) return false;
            return applyUpdate();
        })().finally(() => { updateActionPromise = null; });
        return updateActionPromise;
    };

    const promptInstall = async () => {
        if (!deferredPrompt || !canOfferInstall()) return false;
        const prompt = deferredPrompt;
        deferredPrompt = null;
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            installError = false;
            if (choice?.outcome === 'dismissed') {
                try { storage?.setItem?.(DISMISS_KEY, String(now())); } catch { /* storage unavailable */ }
            }
            emit();
            return choice?.outcome === 'accepted';
        } catch {
            deferredPrompt = prompt;
            installError = true;
            safeMessage(announce, 'Installation impossible pour le moment. Réessayez.');
            emit();
            return false;
        }
    };

    const dismissInstall = () => {
        try { storage?.setItem?.(DISMISS_KEY, String(now())); } catch { /* storage unavailable */ }
        deferredPrompt = null;
        installError = false;
        emit();
    };

    const getInstallationHint = () => {
        if (!canOfferInstall()) return null;
        if (deferredPrompt) return {
            kind: 'android',
            text: installError
                ? 'Installation impossible pour le moment. Réessayez.'
                : 'Installez cette application sur votre appareil.',
        };
        if (ios()) return { kind: 'ios', text: 'Dans Safari : Partager, puis Sur l’écran d’accueil.' };
        return null;
    };

    const stop = () => {
        if (stopped) return;
        stopped = true;
        generation += 1;
        checkGeneration += 1;
        updateActionPromise = null;
        windowRef?.removeEventListener?.('beforeinstallprompt', handlers.beforeInstallPrompt);
        windowRef?.removeEventListener?.('appinstalled', handlers.appInstalled);
        navigatorRef?.serviceWorker?.removeEventListener?.('controllerchange', handlers.controllerChange);
        registration?.removeEventListener?.('updatefound', onUpdateFound);
        installingListeners.forEach((listener, worker) => worker.removeEventListener?.('statechange', listener));
        installingListeners.clear();
        listeners.clear();
    };

    return Object.freeze({
        start, stop, subscribe, getState, checkForUpdate, applyUpdate, requestUpdate, promptInstall, dismissInstall,
        getInstallationHint, getDiagnostics: () => ({ appVersion: documentRef?.querySelector?.('meta[name="app-version"]')?.content || null, workerVersion }),
    });
}

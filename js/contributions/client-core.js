export const CONTRIBUTION_HANDLERS = Object.freeze([
    'getCampaignCapabilities', 'getContentEditContext', 'getContentHistory', 'getContentPnjChoices', 'mutatePublicContent', 'mutateMjContent',
    'listContentTrash', 'listPendingPurgeCleanups', 'restorePublicContent', 'purgePublicContent', 'trashPublicContent',
    'setTrashVisibility', 'uploadContributionImage',
]);

export function createContributionClient({ auth, functions, sdk = {}, cacheTtlMs = 5 * 60 * 1000 } = {}) {
    if (!auth || !functions || typeof sdk.onAuthStateChanged !== 'function' || typeof sdk.httpsCallable !== 'function') {
        throw new TypeError('auth, functions et SDK callable requis');
    }
    const invoke = Object.fromEntries(CONTRIBUTION_HANDLERS.map(name => {
        const callable = sdk.httpsCallable(functions, name);
        return [name, async data => (await callable(data)).data];
    }));
    const PUBLIC_SESSION = Object.freeze({
        user: null,
        capabilities: Object.freeze({ role: 'public', contribution: false, characterIds: [] }),
    });
    const subscribers = new Set();
    let unsubscribeAuth = null;
    let requestGeneration = 0;
    let resolved = false;
    let lastValue = null;
    let lastError = null;
    let lastUid = undefined;
    let lastFetchedAt = 0;
    let inFlight = null;

    const notifyValue = value => {
        for (const sub of [...subscribers]) {
            if (!sub.active) continue;
            try { sub.listener(value); } catch { /* Isolation des abonnés. */ }
        }
    };
    const notifyError = error => {
        for (const sub of [...subscribers]) {
            if (!sub.active) continue;
            try { sub.onError(error); } catch { /* Isolation des abonnés. */ }
        }
    };

    const resolveUser = async (user, { force = false } = {}) => {
        const uid = user?.uid ?? null;
        if (!user) {
            requestGeneration += 1;
            inFlight = null;
            resolved = true;
            lastUid = null;
            lastValue = PUBLIC_SESSION;
            lastError = null;
            lastFetchedAt = Date.now();
            notifyValue(PUBLIC_SESSION);
            return PUBLIC_SESSION;
        }
        const now = Date.now();
        if (!force && resolved && lastValue?.user?.uid === uid && !lastError && (now - lastFetchedAt) < cacheTtlMs) {
            return lastValue;
        }
        if (!force && inFlight && lastUid === uid) return inFlight;
        const generation = ++requestGeneration;
        lastUid = uid;
        lastError = null;
        const run = (async () => {
            try {
                try { await user.reload?.(); } catch { /* Le callable valide le jeton côté serveur. */ }
                const capabilities = await invoke.getCampaignCapabilities();
                if (requestGeneration !== generation) return null;
                const value = Object.freeze({
                    user: Object.freeze({ uid: user.uid, displayName: user.displayName || '', emailVerified: user.emailVerified === true }),
                    capabilities: Object.freeze({
                        role: ['mj', 'joueur'].includes(capabilities?.role) ? capabilities.role : 'public',
                        contribution: capabilities?.contribution === true,
                        characterIds: Array.isArray(capabilities?.characterIds) ? capabilities.characterIds.filter(id => typeof id === 'string') : [],
                    }),
                });
                resolved = true;
                lastValue = value;
                lastError = null;
                lastFetchedAt = Date.now();
                notifyValue(value);
                return value;
            } catch (error) {
                if (requestGeneration !== generation) return null;
                lastError = error;
                const code = String(error?.code || '').toLowerCase();
                if (code.includes('unauthenticated') || code.includes('permission')) {
                    resolved = false;
                    lastValue = null;
                    lastFetchedAt = 0;
                }
                notifyError(error);
                return null;
            } finally {
                if (inFlight === run) inFlight = null;
            }
        })();
        inFlight = run;
        return run;
    };

    const ensureAuthSubscription = () => {
        if (unsubscribeAuth) return;
        unsubscribeAuth = sdk.onAuthStateChanged(
            auth,
            user => resolveUser(user),
            error => {
                lastError = error;
                notifyError(error);
            },
        );
    };

    const maybeReleaseAuthSubscription = () => {
        if (subscribers.size > 0) return;
        if (inFlight) {
            requestGeneration += 1;
            inFlight = null;
        }
        if (unsubscribeAuth) {
            unsubscribeAuth();
            unsubscribeAuth = null;
        }
    };

    const refreshCapabilities = () => resolveUser(auth.currentUser || null, { force: true });

    const watch = (listener, onError = () => {}) => {
        const sub = { listener, onError, active: true };
        subscribers.add(sub);
        const currentUid = auth.currentUser?.uid ?? null;
        const alreadySubscribed = Boolean(unsubscribeAuth);
        const cacheFresh = resolved && lastValue && !lastError
            && (lastValue.user?.uid ?? null) === currentUid
            && (Date.now() - lastFetchedAt) < cacheTtlMs;
        if (cacheFresh) {
            try { sub.listener(lastValue); } catch { /* Isolation des abonnés. */ }
            ensureAuthSubscription();
        } else {
            ensureAuthSubscription();
            if (alreadySubscribed && !inFlight && (lastError || resolved)) {
                void resolveUser(auth.currentUser || null, { force: Boolean(lastError) });
            }
        }
        return () => {
            if (!sub.active) return;
            sub.active = false;
            subscribers.delete(sub);
            maybeReleaseAuthSubscription();
        };
    };

    return Object.freeze({ ...invoke, watch, refreshCapabilities, currentUser: () => auth.currentUser || null });
}

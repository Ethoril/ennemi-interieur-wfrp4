export const CONTRIBUTION_HANDLERS = Object.freeze([
    'getCampaignCapabilities', 'getContentEditContext', 'getContentHistory', 'getContentPnjChoices', 'mutatePublicContent', 'mutateMjContent',
    'listContentTrash', 'listPendingPurgeCleanups', 'restorePublicContent', 'purgePublicContent', 'trashPublicContent',
    'setTrashVisibility', 'uploadContributionImage',
]);

export function createContributionClient({ auth, functions, sdk = {} } = {}) {
    if (!auth || !functions || typeof sdk.onAuthStateChanged !== 'function' || typeof sdk.httpsCallable !== 'function') {
        throw new TypeError('auth, functions et SDK callable requis');
    }
    const invoke = Object.fromEntries(CONTRIBUTION_HANDLERS.map(name => {
        const callable = sdk.httpsCallable(functions, name);
        return [name, async data => (await callable(data)).data];
    }));
    const watch = (listener, onError = () => {}) => {
        let active = true;
        let requestGeneration = 0;
        const unsubscribe = sdk.onAuthStateChanged(auth, async user => {
            const generation = ++requestGeneration;
            if (!active) return;
            if (!user) {
                listener(Object.freeze({ user: null, capabilities: Object.freeze({ role: 'public', contribution: false, characterIds: [] }) }));
                return;
            }
            try {
                await user.reload?.();
                const capabilities = await invoke.getCampaignCapabilities();
                if (!active || requestGeneration !== generation) return;
                listener(Object.freeze({
                    user: Object.freeze({ uid: user.uid, displayName: user.displayName || '', emailVerified: user.emailVerified === true }),
                    capabilities: Object.freeze({
                        role: ['mj', 'joueur'].includes(capabilities?.role) ? capabilities.role : 'public',
                        contribution: capabilities?.contribution === true,
                        characterIds: Array.isArray(capabilities?.characterIds) ? capabilities.characterIds.filter(id => typeof id === 'string') : [],
                    }),
                }));
            } catch (error) {
                if (active && requestGeneration === generation) onError(error);
            }
        }, error => { if (active) onError(error); });
        return () => { active = false; requestGeneration += 1; unsubscribe?.(); };
    };
    return Object.freeze({ ...invoke, watch, currentUser: () => auth.currentUser || null });
}

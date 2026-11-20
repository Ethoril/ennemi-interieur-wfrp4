// Vue MJ des PNJs : la liste et la fiche lisent le store public, limité aux PNJs visibles des
// joueurs. Session MJ ouverte, cette couche remplace les PNJs et les relations par ceux du dépôt
// MJ (masqués compris), en mémoire seulement : à la déconnexion, tout est oublié et le store
// public reprend la main. Préférences et relance restent celles du store public.

function isGm(state) {
    return state?.status === 'gm' && state?.role === 'mj'
        && typeof state.user?.uid === 'string' && state.user.uid.length > 0;
}

function resourceFrom(items, metadata = {}) {
    const list = Object.freeze((Array.isArray(items) ? items : [])
        .filter(item => item && item.suppressionEnCours !== true)
        .map(item => Object.freeze({ ...item })));
    return Object.freeze({
        status: list.length ? 'ready' : 'empty',
        items: list,
        metadata: Object.freeze({ fromCache: metadata?.fromCache === true, hasPendingWrites: metadata?.hasPendingWrites === true }),
        lastServerAt: null,
        error: null,
    });
}

export function createMjPnjsView({ store, mjSession } = {}) {
    const listeners = new Set();
    let mj = null; // { key, pnjs, relations, unsubs }
    let merged = null;
    let mergedFrom = null;
    let unsubscribeStore = null;
    let unsubscribeSession = null;

    const notify = () => {
        const state = getState();
        for (const listener of listeners) {
            try { listener(state); } catch { /* L'abonné reste isolé. */ }
        }
    };

    function getState() {
        const base = store.getState();
        if (!mj?.pnjs) return base;
        if (merged && mergedFrom?.base === base && mergedFrom.pnjs === mj.pnjs && mergedFrom.relations === mj.relations) return merged;
        merged = Object.freeze({
            ...base,
            mjView: true,
            resources: Object.freeze({
                ...base.resources,
                pnjs: mj.pnjs,
                relations: mj.relations ?? base.resources?.relations,
            }),
        });
        mergedFrom = { base, pnjs: mj.pnjs, relations: mj.relations };
        return merged;
    }

    const teardown = () => {
        if (!mj) return false;
        for (const unsubscribe of mj.unsubs) {
            try { unsubscribe?.(); } catch { /* Abonnement déjà fermé. */ }
        }
        mj = null;
        merged = null;
        mergedFrom = null;
        return true;
    };

    const sync = sessionState => {
        const repositories = sessionState?.private?.repositories;
        const pnjsRepo = repositories?.pnjs;
        if (!isGm(sessionState) || typeof pnjsRepo?.subscribeAll !== 'function') {
            if (teardown()) notify();
            return;
        }
        if (mj && mj.repo === pnjsRepo) return;
        teardown();
        const entry = { repo: pnjsRepo, pnjs: null, relations: null, unsubs: [] };
        mj = entry;
        const live = () => mj === entry;
        try {
            entry.unsubs.push(pnjsRepo.subscribeAll((items, metadata) => {
                if (!live()) return;
                entry.pnjs = resourceFrom(items, metadata);
                notify();
            }, () => {
                // Lecture MJ refusée ou rompue : on retombe sur les données publiques.
                if (!live()) return;
                entry.pnjs = null;
                notify();
            }));
        } catch { entry.pnjs = null; }
        const relationsRepo = repositories?.relations;
        if (typeof relationsRepo?.subscribeAll === 'function') {
            try {
                entry.unsubs.push(relationsRepo.subscribeAll((items, metadata) => {
                    if (!live()) return;
                    entry.relations = resourceFrom(items, metadata);
                    notify();
                }, () => {
                    if (!live()) return;
                    entry.relations = null;
                    notify();
                }));
            } catch { entry.relations = null; }
        }
    };

    const start = () => {
        if (!unsubscribeStore) unsubscribeStore = store.subscribe(() => notify());
        if (!unsubscribeSession && mjSession?.subscribe) unsubscribeSession = mjSession.subscribe(sync);
        sync(mjSession?.getState?.());
    };

    const stop = () => {
        unsubscribeStore?.();
        unsubscribeStore = null;
        unsubscribeSession?.();
        unsubscribeSession = null;
        teardown();
    };

    const subscribe = listener => {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        try { listener(getState()); } catch { /* L'abonné reste isolé. */ }
        return () => { listeners.delete(listener); };
    };

    return Object.freeze({
        start,
        stop,
        subscribe,
        getState,
        setPreferences: value => store.setPreferences(value),
        restart: options => store.restart(options),
        isMjView: () => Boolean(mj?.pnjs),
    });
}

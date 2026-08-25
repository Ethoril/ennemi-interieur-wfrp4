import { createPublicStore } from './store.js';

export function createMobileSession({ onChange = () => {} } = {}) {
    let state = Object.freeze({ status: 'anonymous', role: 'public', user: null });
    let active = true;
    const emit = () => { if (active) onChange(state); };
    const setState = next => {
        if (!active || !next || typeof next !== 'object') return state;
        const authenticated = next.status === 'authenticated';
        state = Object.freeze({
            status: authenticated ? 'authenticated' : 'anonymous',
            role: authenticated && next.role === 'mj' ? 'mj' : 'public',
            user: authenticated && next.user && typeof next.user === 'object' ? next.user : null,
        });
        emit();
        return state;
    };
    const stop = () => { active = false; };
    return Object.freeze({
        getState: () => state,
        setState,
        reset: () => setState({ status: 'anonymous', role: 'public', user: null }),
        stop,
    });
}

export function createPublicMobileSession(options = {}) {
    const store = createPublicStore(options);
    return Object.freeze({
        store,
        start: () => store.start(),
        stop: () => store.stop(),
        restart: () => store.restart(),
        subscribe: listener => store.subscribe(listener),
        getState: () => store.getState(),
        setPreferences: value => store.setPreferences(value),
        inspect: () => store.inspect(),
    });
}

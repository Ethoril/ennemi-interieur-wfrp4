export function createMobileSession({ onChange = () => {} } = {}) {
    let state = Object.freeze({ status: 'anonymous', role: 'public', user: null });
    let active = true;
    const emit = () => { if (active) onChange(state); };
    const setState = next => {
        if (!active || !next || typeof next !== 'object') return state;
        state = Object.freeze({
            status: next.status === 'authenticated' ? 'authenticated' : 'anonymous',
            role: next.role === 'mj' ? 'mj' : 'public',
            user: next.user && typeof next.user === 'object' ? next.user : null,
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

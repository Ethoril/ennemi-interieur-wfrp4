/** Petites gardes sans framework partagées par les écrans bureau. */
export function createRenderGate() {
    let current = 0;
    return {
        next() { current += 1; return current; },
        isCurrent(token) { return token === current; },
        invalidate() { current += 1; return current; },
    };
}

export function preserveCheckedValues(values, availableValues) {
    const available = new Set(availableValues);
    return [...new Set(values)].filter(value => available.has(value));
}

export function createPendingRecovery(run) {
    let running = false;
    let pendingKey = null;
    const request = key => {
        if (running) {
            pendingKey = key;
            return Promise.resolve(false);
        }
        running = true;
        return Promise.resolve().then(() => run(key)).finally(() => {
            running = false;
            if (pendingKey !== null) {
                const nextKey = pendingKey;
                pendingKey = null;
                globalThis.queueMicrotask(() => { void request(nextKey); });
            }
        });
    };
    return Object.freeze({ request, get running() { return running; } });
}

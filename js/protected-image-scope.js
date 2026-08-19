// Gestion pure des générations d’URL objet; l’accès Storage est injecté par le client.
export function createImageUrlScope({ fetchBlob, createObjectUrl, revokeObjectUrl }) {
    const urls = new Map();
    let generation = 0;
    const revokeAll = () => {
        for (const url of urls.values()) revokeObjectUrl(url);
        urls.clear();
    };
    return {
        beginGeneration() {
            generation += 1;
            revokeAll();
            return generation;
        },
        async load(key, expectedGeneration) {
            if (!key) return { url: null, error: null, stale: false };
            if (expectedGeneration !== generation) return { url: null, error: null, stale: true };
            try {
                const url = createObjectUrl(await fetchBlob(key));
                if (expectedGeneration !== generation) {
                    revokeObjectUrl(url);
                    return { url: null, error: null, stale: true };
                }
                const previous = urls.get(key);
                if (previous && previous !== url) revokeObjectUrl(previous);
                urls.set(key, url);
                return { url, error: null, stale: false };
            } catch (error) {
                return { url: null, error, stale: expectedGeneration !== generation };
            }
        },
        invalidate() {
            generation += 1;
            revokeAll();
        },
        revokeAll,
    };
}

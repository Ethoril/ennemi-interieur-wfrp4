// Les portraits vivent aussi longtemps que leur chemin et la session restent
// les mêmes. Une émission de texte ne doit ni les recharger, ni les attendre.
export function createLiveImages(load, onReady) {
    const entries = new Map();
    const release = entry => entry.handle?.release?.();
    return {
        sync(nodes) {
            const paths = new Set(nodes.map(node => node.imagePath).filter(Boolean));
            for (const [path, entry] of entries) {
                if (!paths.has(path)) { entries.delete(path); release(entry); }
            }
            for (const path of paths) {
                if (entries.has(path)) continue;
                const entry = { state: 'loading', url: '', error: null, handle: null };
                entries.set(path, entry);
                // Normaliser aussi une erreur synchrone du chargeur.
                Promise.resolve().then(() => {
                    if (entries.get(path) !== entry) return null;
                    entry.handle = load(path);
                    return entry.handle;
                }).then(result => {
                    if (!result) return;
                    if (entries.get(path) !== entry) { result.release?.(); return; }
                    entry.state = 'ready';
                    entry.url = result.url;
                    entry.handle = result;
                    onReady(path);
                }).catch(error => {
                    if (entries.get(path) !== entry) return;
                    entry.state = ['storage/unauthorized', 'storage/unauthenticated'].includes(error?.cause?.code)
                        ? 'access-denied' : 'missing';
                    entry.error = error?.code || null;
                    onReady(path);
                });
            }
            nodes.forEach(node => this.apply(node));
        },
        apply(node) {
            node.legacyImageUrl = node.imagePath ? '' : (node.imageUrl || '');
            const entry = entries.get(node.imagePath);
            node.imageState = entry?.state ?? (node.imageUrl ? 'legacy' : 'missing');
            node.imageError = entry?.error ?? null;
            if (node.imagePath) node.imageUrl = entry?.url || '';
        },
        close() {
            entries.forEach(release);
            entries.clear();
        },
    };
}

// Le contenu du dossier et les portraits ne modifient pas la disposition.
// Les dimensions de couleur et la topologie nécessitent encore un rebuild.
export function graphStructureKey(nodes, relations) {
    return JSON.stringify([
        [...nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
            .map(node => [node.id, node.statut, node.vivant, node.lieu, node.groupe, node.groupes]),
        relations,
    ]);
}

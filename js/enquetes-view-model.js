// Ces projections ne voient que les objets déjà autorisés par le runtime.
export function buildLinksIndex(records) {
    const index = new Map();
    for (const link of records.filter(r => r.type === 'liens')) {
        for (const [a, b] of [[link.a, link.b], [link.b, link.a]]) {
            if (!index.has(a)) index.set(a, new Set());
            index.get(a).add(b);
        }
    }
    return index;
}
export function countSpaces(records) {
    return Object.fromEntries(['enquetes', 'documents', 'notes'].map(type =>
        [type, records.filter(r => r.type === type && (type !== 'enquetes' || !r.archive)).length]));
}
export function countStates(records) {
    const counts = { Ouverte: 0, 'En pause': 0, Résolue: 0, archive: 0 };
    for (const r of records.filter(r => r.type === 'enquetes')) {
        if (r.archive) counts.archive++;
        else if (Object.hasOwn(counts, r.etat)) counts[r.etat]++;
    }
    return counts;
}
export function dossierPieces(enquete, records, index = buildLinksIndex(records)) {
    const ids = index.get(enquete.id) || new Set();
    const order = enquete.ordre || [];
    const rank = id => order.includes(id) ? order.indexOf(id) : Infinity;
    const pieces = records.filter(r => r.type === 'documents' && ids.has(r.id))
        .sort((a, b) => rank(a.id) - rank(b.id));
    return pieces.map((record, i) => ({ record, numero: i + 1,
        relations: records.filter(r => r.type === 'relations' && (r.a === record.id || r.b === record.id))
            .flatMap(r => {
                const other = pieces.findIndex(p => p.id === (r.a === record.id ? r.b : r.a));
                return other < 0 ? [] : [{ nature: r.nature, autreNumero: other + 1 }];
            }) }));
}
export function dossierPnjs(enquete, records, pnjs) {
    return records.filter(l => l.type === 'liens' && (l.a === enquete.id || l.b === enquete.id))
        .flatMap(lien => {
            const pnj = pnjs.find(p => p.id === (lien.a === enquete.id ? lien.b : lien.a));
            return pnj ? [{ pnj, role: lien.role || '', lien }] : [];
        });
}
export function dossierTimeline(enquete, records) {
    return records.filter(r => r.type === 'evenements' && r.enquete === enquete.id)
        .sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
}
export function linkedNotes(target, records, index = buildLinksIndex(records)) {
    const ids = index.get(typeof target === 'string' ? target : target?.id) || new Set();
    return records.filter(r => r.type === 'notes' && ids.has(r.id));
}
export function isUnclassified(note, records) {
    return !records.some(r => r.type === 'liens' && (r.a === note.id || r.b === note.id));
}
export function dossierSummary(enquete, records, pnjs, index = buildLinksIndex(records)) {
    return { pieces: dossierPieces(enquete, records, index).length,
        pnjs: dossierPnjs(enquete, records, pnjs).length,
        notes: linkedNotes(enquete, records, index).length,
        lastSession: dossierTimeline(enquete, records).at(-1)?.dateSession || '' };
}
export function pieceContext(documentId, enquete, records, index = buildLinksIndex(records)) {
    if (!enquete) return null;
    const pieces = dossierPieces(enquete, records, index);
    const i = pieces.findIndex(p => p.record.id === documentId);
    return i < 0 ? null : { numero: i + 1, total: pieces.length,
        precedent: pieces[i - 1]?.record.id || null, suivant: pieces[i + 1]?.record.id || null };
}

function normalized(value, fallback = '') {
    return String(value ?? fallback).trim().toLocaleLowerCase('fr');
}

export function safeRelationColorValue(color, fallback) {
    return /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8})$/iu.test(color || '')
        ? color : fallback;
}

export function relationFingerprint({ source, cible, type, label, color, style, visibleJoueurs = true }) {
    return JSON.stringify([
        String(source ?? ''),
        String(cible ?? ''),
        normalized(type),
        normalized(label || type),
        normalized(color),
        normalized(style || 'solid'),
        visibleJoueurs === true,
    ]);
}

export function relationId(data) {
    const input = relationFingerprint(data);
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `rel-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

export function relationExists(relations, data, bidirectional = false) {
    return relations.some(relation => {
        const source = relation.source?.id ?? relation.source;
        const target = relation.cible?.id ?? relation.cible ?? relation.target?.id ?? relation.target;
        const exact = relationFingerprint({ ...relation, source, cible: target }) === relationFingerprint(data);
        const reverse = bidirectional
            && relationFingerprint({ ...relation, source, cible: target })
                === relationFingerprint({ ...data, source: data.cible, cible: data.source });
        return exact || reverse;
    });
}

export function splitCascadeOperations(operations, batchLimit = 500, reserved = 2) {
    const size = Math.max(1, batchLimit - reserved);
    const batches = [];
    for (let offset = 0; offset < operations.length; offset += size) {
        batches.push(operations.slice(offset, offset + size));
    }
    return batches;
}

export async function commitCascadeBatches(operations, commitBatch, batchLimit = 500, reserved = 2) {
    const committed = [];
    for (const batch of splitCascadeOperations(operations, batchLimit, reserved)) {
        await commitBatch(batch);
        committed.push(batch);
    }
    return committed;
}

export function reconcileFilterSets(active, available) {
    let count = 0;
    for (const [key, values] of Object.entries(active)) {
        const allowed = new Set(available[key] || []);
        for (const value of values) if (!allowed.has(value)) values.delete(value);
        count += values.size;
    }
    return count;
}

export function panelIsStillCurrent({ capturedGeneration, currentGeneration, capturedId, currentId }) {
    return capturedGeneration === currentGeneration && capturedId === currentId;
}

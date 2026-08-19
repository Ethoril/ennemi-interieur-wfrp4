export const LEGACY_PRIVATE_KEYS = Object.freeze(['notes', 'notesMJ', 'notesPrivees', 'privateNotes']);

export function legacyPrivateNoteInfo(data) {
    const entries = LEGACY_PRIVATE_KEYS
        .filter(key => Object.hasOwn(data ?? {}, key))
        .map(key => ({ key, value: data[key] }));
    const invalid = entries.some(entry => typeof entry.value !== 'string');
    const first = entries[0]?.value;
    const conflict = entries.some(entry => entry.value !== first);
    return {
        present: entries.length > 0,
        invalid,
        conflict,
        usable: entries.length > 0 && !invalid && !conflict,
        value: entries.length > 0 && !invalid && !conflict ? first : '',
    };
}

export function privateLoadCanApply(loadId, currentLoadId, isAdmin) {
    return isAdmin === true && loadId === currentLoadId;
}

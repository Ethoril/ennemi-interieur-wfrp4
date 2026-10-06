// Export et import JSON d'une fiche : logique pure (pas de DOM), partagée par la fiche mobile.
// Le bureau (js/fiche.js, exportToFile/importFromFile) garde sa propre copie ; tools/fiche-mobile-journal.test.mjs vérifie l'accord.
export const FICHE_EXPORT_FORMAT = 'wfrp4-fiche';

// Même liste que EXPORT_KEYS de commands.js (que le serveur applique à `import`).
export const FICHE_EXPORT_KEYS = Object.freeze([
    'nom', 'race', 'carriere', 'rang', 'blessuresAct', 'resilience', 'determination', 'chance',
    'destin', 'corruption', 'possessions', 'carac', 'skillsBasic', 'skillsAdvanced', 'careers',
    'talentsAcq', 'talentsAvail', 'sorts', 'prieres', 'xpLog', 'customSpecs', 'basicSpecs',
    'customTalents', 'chosenVariants', 'careerOverrides', 'optVisible',
]);

/** Ne garde que les clés exportables, dans l'ordre de la fiche (celui d'exportData du bureau). */
export function pickFicheKeys(source) {
    return Object.fromEntries(FICHE_EXPORT_KEYS.filter(key => Object.hasOwn(source || {}, key)).map(key => [key, source[key]]));
}

/** Charge utile du fichier d'export : { _format, _version, _app, _charId, _exportedAt, ...clés de la fiche }. */
export function buildFicheExport(data, { charId, appVersion = '', exportedAt }) {
    return {
        _format: FICHE_EXPORT_FORMAT, _version: 1, _app: appVersion, _charId: charId, _exportedAt: exportedAt,
        ...pickFicheKeys(data),
    };
}

/** Nom du fichier téléchargé : fiche-<id>-<AAAA-MM-JJ>.json (jour de `exportedAt`, ISO). */
export function ficheExportFilename(charId, exportedAt) {
    return `fiche-${charId}-${exportedAt.slice(0, 10)}.json`;
}

/** Lit un fichier d'import : { data } (clés filtrées) ou { error: 'unreadable' | 'format' }. */
export function parseFicheImport(text) {
    let payload;
    try { payload = JSON.parse(text); } catch { return { error: 'unreadable' }; }
    if (payload?._format !== FICHE_EXPORT_FORMAT) return { error: 'format' };
    return { data: pickFicheKeys(payload) };
}

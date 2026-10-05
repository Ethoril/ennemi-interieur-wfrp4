export const FICHE_SCHEMA_VERSION = 2;
export const FICHE_ARRAY_FIELDS = Object.freeze([
    'skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres', 'xpLog',
]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function timestampParts(value) {
    if (value instanceof Date) {
        const milliseconds = value.getTime();
        if (!Number.isFinite(milliseconds)) return null;
        const seconds = Math.floor(milliseconds / 1000);
        return { seconds, nanoseconds: (milliseconds - seconds * 1000) * 1_000_000 };
    }
    if (!isRecord(value)) return null;
    const isSdkTimestamp = value.constructor?.name === 'Timestamp'
        || typeof value.toDate === 'function' || typeof value.toMillis === 'function';
    if (!isSdkTimestamp) return null;
    const seconds = typeof value.seconds === 'number' ? value.seconds : value._seconds;
    const nanoseconds = typeof value.nanoseconds === 'number' ? value.nanoseconds : value._nanoseconds;
    if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds)
        || nanoseconds < 0 || nanoseconds >= 1_000_000_000) return null;
    return { seconds, nanoseconds };
}

function cloneFicheValue(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (timestampParts(value)) return value; // Les Timestamp Web/Admin sont immuables.
    if (Array.isArray(value)) return value.map(cloneFicheValue);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneFicheValue(item)]));
    return value;
}

export function stableJson(value) {
    const timestamp = timestampParts(value);
    if (timestamp) return `{"$firestoreTimestamp":[${timestamp.seconds},${timestamp.nanoseconds}]}`;
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return JSON.stringify({ __number: String(value) });
    return JSON.stringify(value);
}

export async function ficheFingerprint(value) {
    const bytes = new globalThis.TextEncoder().encode(stableJson(value));
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function xpTotals(data) {
    const log = Array.isArray(data.xpLog) ? globalThis.structuredClone(data.xpLog) : [];
    if (data.xpTotal && +data.xpTotal > 0 && !log.some(entry => entry?.kind === 'gain')) {
        log.unshift({ kind: 'gain', montant: +data.xpTotal });
    }
    const gained = log.filter(entry => entry?.kind === 'gain')
        .reduce((sum, entry) => sum + (+entry?.montant || 0), 0);
    const spent = log.filter(entry => entry?.kind !== 'gain')
        .reduce((sum, entry) => sum + (+entry?.cout || 0), 0);
    return { gained, spent, available: gained - spent };
}

function numericSummary(data) {
    const samples = [];
    const nonFinitePaths = [];
    const inspect = (value, path) => {
        if (typeof value === 'number' && !Number.isFinite(value)) nonFinitePaths.push(path);
        if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(+value))) {
            samples.push({ path, type: typeof value, negative: +value < 0 });
        }
        if (Array.isArray(value)) value.forEach((item, index) => inspect(item, `${path}[${index}]`));
        else if (isRecord(value)) {
            for (const [key, item] of Object.entries(value)) inspect(item, `${path}.${key}`);
        }
    };
    inspect(data, 'data');
    return {
        fieldCount: samples.length,
        numberCount: samples.filter(item => item.type === 'number').length,
        numericStringCount: samples.filter(item => item.type === 'string').length,
        negativeCount: samples.filter(item => item.negative).length,
        negativePaths: samples.filter(item => item.negative).map(item => item.path).slice(0, 50),
        nonFiniteCount: nonFinitePaths.length,
        nonFinitePaths: nonFinitePaths.slice(0, 50),
    };
}

function xpFieldAnomalies(data) {
    const anomalies = [];
    const inspect = (value, path) => {
        if (typeof value === 'number') {
            if (value < 0) anomalies.push({ code: 'legacy-xp-value-negative', path });
            return;
        }
        if (typeof value === 'string') {
            if (value.trim() === '' || !Number.isFinite(+value)) {
                anomalies.push({ code: 'legacy-xp-value-not-numeric', path });
            } else {
                anomalies.push({ code: 'legacy-xp-value-string', path });
                if (+value < 0) anomalies.push({ code: 'legacy-xp-value-negative', path });
            }
        } else {
            anomalies.push({ code: 'legacy-xp-value-not-number', path });
        }
    };
    if (Object.hasOwn(data, 'xpTotal')) inspect(data.xpTotal, 'data.xpTotal');
    if (Array.isArray(data.xpLog)) {
        data.xpLog.forEach((entry, index) => {
            if (!isRecord(entry)) return;
            const key = entry.kind === 'gain' ? 'montant' : 'cout';
            if (Object.hasOwn(entry, key)) inspect(entry[key], `data.xpLog[${index}].${key}`);
        });
    }
    return anomalies;
}

async function migratedEntryId(charId, sourceFingerprint, field, index) {
    const input = `${charId}\u0000${sourceFingerprint}\u0000${field}\u0000${index}`;
    const digest = await ficheFingerprint(input);
    return `mig_${digest.slice(0, 32)}`;
}

function resultWithBlock(report, code, path = '') {
    report.blocked.push(path ? `${path}:${code}` : code);
}

/**
 * Normalise une fiche locale V1 vers son enveloppe V2. Pure et idempotente.
 * Les champs de jeu ne sont jamais coercés. Le rapport ne contient aucune valeur de fiche.
 */
export async function migrateFicheDocument(source, { charId } = {}) {
    const report = {
        charId: typeof charId === 'string' ? charId : '',
        sourceFingerprint: '',
        sourceSchemaVersion: null,
        targetSchemaVersion: FICHE_SCHEMA_VERSION,
        sourceRevision: null,
        targetRevision: null,
        arrayCountsBefore: {},
        arrayCountsAfter: {},
        missingArraysBefore: [],
        numericSummaryBefore: null,
        numericSummaryAfter: null,
        numericAnomalies: [],
        xpBefore: null,
        xpAfter: null,
        assignedIds: [],
        anomalies: [],
        blocked: [],
        syntheticXpGain: false,
        status: 'blocked',
    };

    if (typeof charId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(charId)) {
        resultWithBlock(report, 'char-id-invalid');
    }
    if (!isRecord(source)) {
        resultWithBlock(report, 'document-not-object');
        return { document: null, report, canApply: false };
    }

    report.sourceFingerprint = await ficheFingerprint(source);
    report.sourceSchemaVersion = Number.isSafeInteger(source.schemaVersion) ? source.schemaVersion : null;
    report.sourceRevision = Number.isSafeInteger(source.revision) ? source.revision : null;

    const alreadyMigrated = source.schemaVersion === FICHE_SCHEMA_VERSION
        && source.migration?.ficheSchemaVersion === FICHE_SCHEMA_VERSION;
    if (source.schemaVersion !== undefined && source.schemaVersion !== 1 && source.schemaVersion !== FICHE_SCHEMA_VERSION) {
        resultWithBlock(report, 'schema-version-unsupported');
    }
    if (!Object.hasOwn(source, 'data')) resultWithBlock(report, 'data-missing');
    else if (!isRecord(source.data)) resultWithBlock(report, 'data-not-object', 'data');
    if (Object.hasOwn(source, 'tombstone') && typeof source.tombstone !== 'boolean') {
        resultWithBlock(report, 'tombstone-invalid', 'tombstone');
    }
    if (Object.hasOwn(source, 'revision') && (!Number.isSafeInteger(source.revision) || source.revision < 0)) {
        resultWithBlock(report, 'revision-invalid', 'revision');
    }
    if (source.schemaVersion === FICHE_SCHEMA_VERSION
        && (!Number.isSafeInteger(source.revision) || source.revision < 0)) {
        resultWithBlock(report, 'revision-invalid', 'revision');
    }
    if (source.tombstone === true && !Number.isSafeInteger(source.revision)) {
        resultWithBlock(report, 'tombstone-revision-missing', 'revision');
    }
    if (report.blocked.length) return { document: null, report, canApply: false };

    const data = cloneFicheValue(source.data);
    const sourceRevision = Number.isSafeInteger(source.revision) ? source.revision : 1;
    report.targetRevision = sourceRevision;
    report.numericSummaryBefore = numericSummary(data);
    if (report.numericSummaryBefore.nonFiniteCount) {
        report.anomalies.push({ code: 'non-finite-number', paths: report.numericSummaryBefore.nonFinitePaths });
        resultWithBlock(report, 'non-finite-number');
    }
    report.numericAnomalies = xpFieldAnomalies(data);
    report.anomalies.push(...report.numericAnomalies);
    report.xpBefore = xpTotals(data);

    const seenIds = new Map();
    for (const field of FICHE_ARRAY_FIELDS) {
        if (!Object.hasOwn(data, field)) {
            report.missingArraysBefore.push(field);
            continue; // Missing is distinct from an explicit empty array.
        }
        if (!Array.isArray(data[field])) {
            resultWithBlock(report, 'array-not-array', `data.${field}`);
            continue;
        }
        report[field] = { count: data[field].length, idsAssigned: 0 };
        report.arrayCountsBefore[field] = data[field].length;
        for (let index = 0; index < data[field].length; index++) {
            const row = data[field][index];
            if (!isRecord(row)) {
                resultWithBlock(report, 'row-not-object', `data.${field}[${index}]`);
                continue;
            }
            if (Object.hasOwn(row, 'id') && (typeof row.id !== 'string' || !row.id.trim())) {
                resultWithBlock(report, 'id-invalid', `data.${field}[${index}].id`);
                continue;
            }
            if (alreadyMigrated && !Object.hasOwn(row, 'id')) {
                resultWithBlock(report, 'schema2-id-missing', `data.${field}[${index}].id`);
                continue;
            }
            const id = Object.hasOwn(row, 'id')
                ? row.id
                : await migratedEntryId(charId, report.sourceFingerprint, field, index);
            const prior = seenIds.get(id);
            if (prior) {
                resultWithBlock(report, 'id-collision', `data.${field}[${index}].id`);
                report.anomalies.push({ code: 'id-collision', id, paths: [prior, `data.${field}[${index}]`] });
                continue;
            }
            seenIds.set(id, `data.${field}[${index}]`);
            if (!Object.hasOwn(row, 'id')) {
                row.id = id;
                report[field].idsAssigned += 1;
                report.assignedIds.push({ field, index, id });
            }
            if (field === 'xpLog') {
                if (Object.hasOwn(row, 'purchaseId') && (typeof row.purchaseId !== 'string' || !row.purchaseId.trim())) {
                    resultWithBlock(report, 'purchase-id-invalid', `data.${field}[${index}].purchaseId`);
                } else if (typeof row.purchaseId === 'string') {
                    const purchasePath = `purchase:${row.purchaseId}`;
                    const purchasePrior = seenIds.get(purchasePath);
                    if (purchasePrior) resultWithBlock(report, 'purchase-id-collision', `data.${field}[${index}].purchaseId`);
                    else seenIds.set(purchasePath, `data.${field}[${index}]`);
                }
                if (row.applied === true && !Object.hasOwn(row, 'purchaseId')) {
                    report.anomalies.push({ code: 'legacy-applied-purchase-unlinked', path: `data.${field}[${index}]` });
                }
                if (!alreadyMigrated && !Object.hasOwn(row, 'origin')) row.origin = 'legacy';
            }
        }
    }

    if (Object.hasOwn(data, 'xpTotal')) {
        const xpNumber = +data.xpTotal;
        if (!Number.isFinite(xpNumber)) {
            report.anomalies.push({ code: 'legacy-xp-total-not-numeric', path: 'data.xpTotal' });
        } else if (xpNumber < 0) {
            report.anomalies.push({ code: 'legacy-xp-total-negative', path: 'data.xpTotal' });
        }
        const hasGain = Array.isArray(data.xpLog) && data.xpLog.some(entry => entry?.kind === 'gain');
        if (alreadyMigrated && data.xpTotal && xpNumber > 0 && !hasGain) {
            resultWithBlock(report, 'schema2-xptotal-unmigrated', 'data.xpTotal');
        }
        if (!alreadyMigrated && data.xpTotal && xpNumber > 0 && !hasGain
            && (!Object.hasOwn(data, 'xpLog') || Array.isArray(data.xpLog))) {
            const syntheticId = await migratedEntryId(charId, report.sourceFingerprint, 'xpLog-xpTotal', 0);
            if (seenIds.has(syntheticId)) {
                resultWithBlock(report, 'synthetic-xp-id-collision', 'data.xpLog');
            } else {
                data.xpLog ??= [];
                data.xpLog.unshift({
                    id: syntheticId,
                    kind: 'gain',
                    raison: 'XP initial (migré)',
                    montant: xpNumber,
                    origin: 'legacy-xpTotal',
                });
                report.arrayCountsBefore.xpLog ??= 0;
                report.syntheticXpGain = true;
                report.assignedIds.unshift({ field: 'xpLog', index: 'xpTotal', id: syntheticId });
            }
        }
    }

    if (report.blocked.length) return { document: null, report, canApply: false };
    for (const field of FICHE_ARRAY_FIELDS) {
        if (Object.hasOwn(data, field)) report.arrayCountsAfter[field] = data[field].length;
    }
    report.numericSummaryAfter = numericSummary(data);
    report.xpAfter = xpTotals(data);
    if (stableJson(report.xpBefore) !== stableJson(report.xpAfter)) {
        report.anomalies.push({ code: 'xp-total-mismatch' });
        resultWithBlock(report, 'xp-total-mismatch');
        return { document: null, report, canApply: false };
    }
    if (alreadyMigrated) {
        report.status = 'already-migrated';
        return { document: globalThis.structuredClone(source), report, canApply: true };
    }

    const previousMigration = isRecord(source.migration) ? source.migration : {};
    const document = {
        ...source,
        schemaVersion: FICHE_SCHEMA_VERSION,
        revision: sourceRevision,
        data,
        migration: {
            ...previousMigration,
            ficheSchemaVersion: FICHE_SCHEMA_VERSION,
            sourceFingerprint: report.sourceFingerprint,
        },
    };
    report.status = 'ready';
    return { document, report, canApply: true };
}

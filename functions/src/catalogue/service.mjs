import { createHash } from 'node:crypto';
import { BASIC_SKILLS, basicSkillNom } from '../domain/fiche/basic-skills.js';
import { buildCatalogueImpactReport } from './impact-report.mjs';
import { applySkillMigrationDecisions, planSkillMigration } from './skill-migration.mjs';
import { createSkillResolver } from './skill-resolver.mjs';
import { createTalentResolver } from './talent-resolver.mjs';

export const CATALOGUE_CHARACTER_IDS = Object.freeze(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']);
const ADMIN_EMAIL = 'ethoril@gmail.com';
const OPERATION_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export class CatalogueCommandError extends Error {
    constructor(message, code = 'invalid-argument', details = undefined) {
        super(message);
        this.name = 'CatalogueCommandError';
        this.code = code;
        if (details !== undefined) this.details = details;
    }
}

function fail(message, code = 'invalid-argument', details) {
    throw new CatalogueCommandError(message, code, details);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function digest(value) {
    return `sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}

function exists(snapshot) {
    return typeof snapshot?.exists === 'function' ? snapshot.exists() : snapshot?.exists === true;
}

function dataOf(snapshot) { return exists(snapshot) ? snapshot.data() : null; }

function identity(request) {
    const auth = request?.auth;
    const email = typeof auth?.token?.email === 'string' ? auth.token.email.trim().toLowerCase() : '';
    if (!auth?.uid || !email || auth.token.email_verified !== true) fail('authentification vérifiée requise', 'unauthenticated');
    if (email !== ADMIN_EMAIL) fail('commande réservée au MJ', 'permission-denied');
    return { uid: auth.uid, email };
}

function validateEnvelope(command) {
    if (!isRecord(command) || Object.keys(command).some(key => !['operationId', 'baseRevision', 'type', 'payload'].includes(key))) {
        fail('commande de référentiel invalide');
    }
    if (typeof command.operationId !== 'string' || !OPERATION_ID.test(command.operationId)) fail('identifiant d’opération invalide');
    if (!Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) fail('révision de base invalide');
    if (!['load', 'saveDraft', 'previewMigration', 'publish'].includes(command.type) || !isRecord(command.payload)) fail('type de commande invalide');
    return command;
}

function publicCatalogue(value, { allowVersion = true } = {}) {
    if (!isRecord(value) || !isRecord(value.skills) || !isRecord(value.talents)
        || !Array.isArray(value.skills.entries) || !Array.isArray(value.skills.aliases)
        || !Array.isArray(value.talents.entries) || !Array.isArray(value.talents.aliases)
        || !Array.isArray(value.talents.templates) || !Array.isArray(value.talents.localDescriptions)) {
        fail('structure de référentiel invalide');
    }
    const strings = (values, label) => {
        if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) fail(`${label} invalides`);
        return [...values];
    };
    const text = (item, label, max) => {
        if (typeof item !== 'string' || item.length > max || item.trim() === '') fail(`${label} invalide`);
        return item;
    };
    const identifier = (item, label) => {
        if (typeof item !== 'string' || item.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(item)) fail(`${label} invalide`);
        return item;
    };
    const boundedArray = (items, label, max) => {
        if (items.length > max) fail(`${label} trop nombreux`);
    };
    const pick = (raw, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(raw, key)).map(key => [key, raw[key]]));
    const clean = {
        skills: {
            entries: value.skills.entries.map(entry => {
                if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.nom !== 'string') fail('identité de compétence invalide');
                return { ...pick(entry, ['id', 'groupId', 'group', 'specializationId', 'specialization', 'nom', 'carac', 'basic']),
                    aliases: strings(entry.aliases || [], 'alias de compétence') };
            }),
            aliases: value.skills.aliases.map(alias => {
                if (!isRecord(alias) || typeof alias.label !== 'string' || typeof alias.targetId !== 'string') fail('alias de compétence invalide');
                return pick(alias, ['label', 'targetId', 'provenance']);
            }),
        },
        talents: {
            entries: value.talents.entries.map(entry => {
                if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.nom !== 'string') fail('identité de talent invalide');
                return { ...pick(entry, ['id', 'key', 'nom']), sources: strings(entry.sources || [], 'sources de talent') };
            }),
            aliases: value.talents.aliases.map(alias => {
                if (!isRecord(alias) || typeof alias.label !== 'string' || typeof alias.targetId !== 'string') fail('alias de talent invalide');
                return pick(alias, ['label', 'targetId', 'provenance', 'origin']);
            }),
            templates: value.talents.templates.map(template => {
                if (!isRecord(template) || typeof template.id !== 'string' || typeof template.pattern !== 'string'
                    || typeof template.descriptionTalentId !== 'string') fail('modèle de talent invalide');
                return pick(template, ['id', 'pattern', 'descriptionTalentId']);
            }),
            localDescriptions: value.talents.localDescriptions.map(description => {
                if (!isRecord(description) || typeof description.talentId !== 'string' || typeof description.description !== 'string') {
                    fail('description locale de talent invalide');
                }
                return pick(description, ['talentId', 'description', 'updatedAt']);
            }),
        },
        sources: {
            ...(typeof value.sources?.skills === 'string' ? { skills: value.sources.skills } : {}),
            ...(typeof value.sources?.careers === 'string' ? { careers: value.sources.careers } : {}),
            ...(typeof value.sources?.skillAliasProvenance === 'string' ? { skillAliasProvenance: value.sources.skillAliasProvenance } : {}),
            ...(isRecord(value.sources?.talents) ? { talents: pick(value.sources.talents, ['kind', 'spreadsheetId', 'worksheet', 'gid']) } : {}),
        },
    };
    boundedArray(clean.skills.entries, 'identités de compétence', 5_000);
    boundedArray(clean.skills.aliases, 'alias de compétence', 10_000);
    boundedArray(clean.talents.entries, 'identités de talent', 5_000);
    boundedArray(clean.talents.aliases, 'alias de talent', 10_000);
    boundedArray(clean.talents.templates, 'modèles de talent', 500);
    boundedArray(clean.talents.localDescriptions, 'descriptions locales', 5_000);
    for (const entry of clean.skills.entries) {
        identifier(entry.id, 'identifiant de compétence');
        text(entry.nom, 'nom de compétence', 200);
        if (entry.group !== undefined) text(entry.group, 'groupe de compétence', 200);
        if (entry.groupId !== undefined) identifier(entry.groupId, 'identifiant de groupe');
        if (entry.specialization !== undefined && entry.specialization !== null) text(entry.specialization, 'spécialité', 200);
        if (entry.specializationId !== undefined && entry.specializationId !== null) identifier(entry.specializationId, 'identifiant de spécialité');
        if (entry.carac !== undefined && (typeof entry.carac !== 'string' || entry.carac.length > 20)) fail('caractéristique de compétence invalide');
        if (entry.basic !== undefined && typeof entry.basic !== 'boolean') fail('type de compétence invalide');
        boundedArray(entry.aliases, 'alias internes de compétence', 100);
        entry.aliases.forEach(alias => text(alias, 'alias interne', 200));
    }
    for (const alias of clean.skills.aliases) {
        text(alias.label, 'libellé alias de compétence', 200);
        identifier(alias.targetId, 'cible alias de compétence');
        if (alias.provenance !== undefined) text(alias.provenance, 'provenance alias', 120);
    }
    for (const entry of clean.talents.entries) {
        identifier(entry.id, 'identifiant de talent');
        text(entry.nom, 'nom de talent', 200);
        if (entry.key !== undefined) text(entry.key, 'clé de talent', 240);
        boundedArray(entry.sources, 'sources de talent', 10);
        entry.sources.forEach(source => text(source, 'source de talent', 40));
    }
    for (const alias of clean.talents.aliases) {
        text(alias.label, 'libellé alias de talent', 200);
        identifier(alias.targetId, 'cible alias de talent');
        for (const field of ['provenance', 'origin']) if (alias[field] !== undefined) text(alias[field], 'provenance alias', 120);
    }
    for (const template of clean.talents.templates) {
        identifier(template.id, 'identifiant de modèle');
        text(template.pattern, 'modèle de spécialisation', 400);
        identifier(template.descriptionTalentId, 'talent de référence');
    }
    for (const item of clean.talents.localDescriptions) {
        identifier(item.talentId, 'identifiant de talent');
        if (item.description.length > 12_000) fail('description locale trop longue');
    }
    for (const field of ['skills', 'careers', 'skillAliasProvenance']) {
        if (clean.sources[field] !== undefined) text(clean.sources[field], `source ${field}`, 300);
    }
    if (clean.sources.talents) {
        if (clean.sources.talents.kind !== undefined) text(clean.sources.talents.kind, 'type de source', 80);
        if (clean.sources.talents.spreadsheetId !== undefined) text(clean.sources.talents.spreadsheetId, 'identifiant de tableau', 200);
        if (clean.sources.talents.worksheet !== undefined) text(clean.sources.talents.worksheet, 'feuille source', 100);
        if (clean.sources.talents.gid !== undefined) text(clean.sources.talents.gid, 'identifiant de feuille', 40);
    }
    if (Buffer.byteLength(canonical(clean), 'utf8') > 700 * 1024) fail('référentiel trop volumineux', 'resource-exhausted');
    if (allowVersion && typeof value.catalogVersion === 'string') {
        if (value.catalogVersion.length > 128) fail('version de référentiel invalide');
        clean.catalogVersion = value.catalogVersion;
    }
    return clean;
}

function resolvers(catalogue) {
    const version = typeof catalogue.catalogVersion === 'string' ? catalogue.catalogVersion : digest(catalogue);
    let skills;
    let talents;
    try {
        skills = createSkillResolver({ version, ...catalogue.skills });
        talents = createTalentResolver({ version, ...catalogue.talents, sheetSnapshot: catalogue.sheetSnapshot });
    } catch (error) {
        fail(`référentiel invalide : ${error.message}`, 'failed-precondition', { kind: 'catalogue-invalid' });
    }
    if (skills.aliasErrors.length || talents.aliasErrors.length) {
        fail('les alias contiennent un cycle ou une cible ambiguë', 'failed-precondition', {
            kind: 'invalid-aliases', skills: skills.aliasErrors, talents: talents.aliasErrors,
        });
    }
    return { skills, talents };
}

function withSheetSnapshot(catalogue, sheetSnapshot) {
    return { ...catalogue, talents: { ...catalogue.talents }, sheetSnapshot };
}

function responseHash(command, uid) { return digest({ command, uid }); }

function recordsForCharacter(charId, data) {
    const records = [];
    const basicSpecs = isRecord(data.basicSpecs) ? data.basicSpecs : {};
    const historyFor = (collection, id) => (Array.isArray(data.xpLog) ? data.xpLog : []).filter(entry =>
        Array.isArray(entry?.effects) && entry.effects.some(effect => collection === 'skillsAdvanced'
            ? Array.isArray(effect.pathParts) && effect.pathParts[0] === collection
                && effect.pathParts[1] === id && effect.pathParts[2] === 'adv'
            : effect.path === `${collection}.${id}`));
    for (const [key, advances] of Object.entries(isRecord(data.skillsBasic) ? data.skillsBasic : {})) {
        if (!Number.isSafeInteger(advances) || advances < 0) continue;
        records.push({ scopeId: charId, scopeName: typeof data.nom === 'string' && data.nom.trim() ? data.nom : charId,
            collection: 'skillsBasic', id: key, nom: basicSkillNom(key, basicSpecs),
            advances, basicKey: key, specialization: basicSpecs[key] || null, history: historyFor('skillsBasic', key) });
    }
    for (const row of Array.isArray(data.skillsAdvanced) ? data.skillsAdvanced : []) {
        if (!row || typeof row.id !== 'string' || !row.id || typeof row.nom !== 'string'
            ) continue;
        records.push({ scopeId: charId, scopeName: typeof data.nom === 'string' && data.nom.trim() ? data.nom : charId,
            collection: 'skillsAdvanced', id: row.id, nom: row.nom,
            advances: Number.isSafeInteger(row.adv) && row.adv >= 0 ? row.adv : null, original: row,
            history: historyFor('skillsAdvanced', row.id) });
    }
    return records;
}

function applyMigrationToCharacter(data, charId, migration, resolver) {
    const collisionPrefix = `${charId}::skillsOwned::`;
    const collisionTargets = new Set(migration.decisions
        .filter(decision => decision.key.startsWith(collisionPrefix))
        .map(decision => decision.key.slice(collisionPrefix.length)));
    const changedRecords = migration.records.filter(record => record.scopeId === charId).map(record => {
        const target = resolver.entries.find(entry => entry.id === record.skillId);
        const sourceCollection = record.sourceCollection || record.collection;
        const sourceName = sourceCollection === 'skillsBasic'
            ? basicSkillNom(record.basicKey || record.id, data.basicSpecs || {}) : record.original?.nom;
        return { ...record, sourceName, sourceCollection, collection: target?.basic ? 'skillsBasic' : 'skillsAdvanced' };
    }).filter(record => record.sourceName !== record.nom || record.sourceCollection !== record.collection
        || collisionTargets.has(record.targetId));
    const dropped = migration.dropped.filter(record => record.scopeId === charId);
    if (!changedRecords.length && !dropped.length) return structuredClone(data);

    const dataNext = structuredClone(data);
    const basic = { ...(isRecord(dataNext.skillsBasic) ? dataNext.skillsBasic : {}) };
    const specs = { ...(isRecord(dataNext.basicSpecs) ? dataNext.basicSpecs : {}) };
    const advanced = Array.isArray(dataNext.skillsAdvanced) ? [...dataNext.skillsAdvanced] : [];
    const removedRecords = [...changedRecords, ...dropped];
    for (const record of removedRecords) {
        const sourceCollection = record.sourceCollection || record.collection;
        if (sourceCollection === 'skillsBasic') {
            const key = record.basicKey || record.id;
            delete basic[key];
            delete specs[key];
        } else if (sourceCollection === 'skillsAdvanced') {
            for (let index = advanced.length - 1; index >= 0; index -= 1) {
                if (advanced[index]?.id === record.id) advanced.splice(index, 1);
            }
        }
    }
    for (const record of changedRecords) {
        const target = resolver.entries.find(entry => entry.id === record.skillId);
        if (!target) fail('cible de compétence absente du référentiel', 'failed-precondition');
        if (record.collection === 'skillsBasic') {
            if (target.basic !== true) fail('changement de type de compétence à arbitrer', 'failed-precondition', { kind: 'skill-type-change' });
            const basicRow = BASIC_SKILLS.find(skill => skill.nom === target.nom)
                || BASIC_SKILLS.find(skill => skill.nom === target.group)
                || BASIC_SKILLS.find(skill => skill.nom.startsWith(`${target.group} (`));
            const key = basicRow?.nom || target.group || record.basicKey || record.id;
            if (Number.isSafeInteger(record.advances) && record.advances >= 0) basic[key] = record.advances;
            if (target.specialization) specs[key] = target.specialization;
            else if (Object.hasOwn(specs, key)) delete specs[key];
        } else if (record.collection === 'skillsAdvanced') {
            advanced.push({ ...(record.original || {}), id: record.id, nom: record.targetName, carac: target.carac,
                ...(Number.isSafeInteger(record.advances) && record.advances >= 0 ? { adv: record.advances } : {}) });
        }
    }
    dataNext.skillsBasic = basic;
    dataNext.basicSpecs = specs;
    dataNext.skillsAdvanced = advanced;
    return dataNext;
}

function skillPurchaseIds(data) {
    const skillTypes = new Set(['skill', 'skill-basic', 'skill-adv']);
    return [...new Set((Array.isArray(data.xpLog) ? data.xpLog : [])
        .filter(row => skillTypes.has(row?.targetType) && typeof row.purchaseId === 'string' && row.purchaseId)
        .map(row => row.purchaseId))];
}

function makePreview({ catalogue, published, sheetSnapshot, careers, envelopes }) {
    const version = typeof catalogue.catalogVersion === 'string' ? catalogue.catalogVersion : digest(catalogue);
    const { skills, talents } = resolvers(withSheetSnapshot(catalogue, sheetSnapshot));
    const characters = envelopes.map((envelope, index) => ({ charId: CATALOGUE_CHARACTER_IDS[index], data: envelope.data }));
    const report = buildCatalogueImpactReport({ skillResolver: skills, talentResolver: talents, careers, characters });
    const records = envelopes.flatMap((envelope, index) => recordsForCharacter(CATALOGUE_CHARACTER_IDS[index], envelope.data));
    const affectedLabels = new Set();
    const previousEntries = new Map((published?.skills.entries || []).map(entry => [entry.id, entry]));
    for (const entry of catalogue.skills.entries) {
        const previous = previousEntries.get(entry.id);
        if (!previous || canonical(previous) !== canonical(entry)) {
            affectedLabels.add(entry.nom);
            if (previous) affectedLabels.add(previous.nom);
        }
        previousEntries.delete(entry.id);
    }
    for (const entry of previousEntries.values()) affectedLabels.add(entry.nom);
    const previousAliases = new Map((published?.skills.aliases || []).map(alias => [alias.label, alias]));
    for (const alias of catalogue.skills.aliases) {
        const previous = previousAliases.get(alias.label);
        if (!previous || previous.targetId !== alias.targetId) affectedLabels.add(alias.label);
        previousAliases.delete(alias.label);
    }
    for (const alias of previousAliases.values()) affectedLabels.add(alias.label);
    const affectedTargetIds = [...new Set([...affectedLabels].flatMap(label => {
        const target = skills.resolve(label).entry;
        return target ? [target.id] : [];
    }))];
    const migration = planSkillMigration({ resolver: skills, records, toVersion: version,
        affectedLabels: [...affectedLabels], affectedTargetIds });
    return { report, migration, skills, talents };
}

function checkRevision(command, actual) {
    if (command.baseRevision !== actual) fail('le brouillon a changé depuis sa lecture', 'aborted', { kind: 'conflict', revision: actual });
}

/** Factory injectée : aucun accès réseau ou Firebase global dans le domaine. */
export function createCatalogueService({ db, timestamp, initialCatalogue, sheetSnapshot, careers = [] } = {}) {
    if (!db || typeof db.doc !== 'function' || typeof db.runTransaction !== 'function' || typeof timestamp !== 'function') {
        throw new TypeError('Dépendances Firestore du référentiel invalides.');
    }
    const publishedRef = db.doc('referentiels/public');
    const draftRef = db.doc('referentiel_drafts/mj');

    async function executeCatalogueCommand(rawCommand, request) {
        const command = validateEnvelope(rawCommand);
        const user = identity(request);
        const hash = responseHash(command, user.uid);
        const receiptRef = db.doc(`referentiel_operations/${command.operationId}`);
        const historyRef = db.doc(`referentiel_history/${command.operationId}`);
        const charRefs = CATALOGUE_CHARACTER_IDS.map(charId => db.doc(`fiches/${charId}`));

        return db.runTransaction(async transaction => {
            const readRefs = command.type === 'load'
                ? [publishedRef, draftRef, receiptRef, ...charRefs]
                : command.type === 'saveDraft' ? [publishedRef, draftRef, receiptRef]
                    : [publishedRef, draftRef, receiptRef, ...charRefs];
            const snapshots = await Promise.all(readRefs.map(reference => transaction.get(reference)));
            const [publishedSnapshot, draftSnapshot, receiptSnapshot, ...characterSnapshots] = snapshots;
            const previousReceipt = command.type === 'load' ? null : dataOf(receiptSnapshot);
            if (previousReceipt) {
                if (previousReceipt.commandHash !== hash) fail('identifiant d’opération déjà utilisé', 'already-exists');
                return previousReceipt.response;
            }
            const published = dataOf(publishedSnapshot)?.catalogue || initialCatalogue;
            const publishedRevision = dataOf(publishedSnapshot)?.revision || 0;
            const draftEnvelope = dataOf(draftSnapshot) || { revision: 0, catalogue: publicCatalogue(published) };
            if (command.type === 'load') {
                const { skills, talents } = resolvers(withSheetSnapshot(draftEnvelope.catalogue, sheetSnapshot));
                return {
                report: buildCatalogueImpactReport({
                    skillResolver: skills, talentResolver: talents,
                    careers,
                    characters: characterSnapshots.flatMap((snapshot, index) => {
                        const envelope = dataOf(snapshot);
                        return envelope?.schemaVersion === 2 && isRecord(envelope.data)
                            ? [{ charId: CATALOGUE_CHARACTER_IDS[index], data: envelope.data }] : [];
                    }),
                }),
                draftRevision: draftEnvelope.revision,
                publishedRevision,
                draft: publicCatalogue(draftEnvelope.catalogue),
                published: publicCatalogue(published),
                catalogVersion: typeof published.catalogVersion === 'string' ? published.catalogVersion : digest(published),
                };
            }
            const envelopes = characterSnapshots.map((snapshot, index) => {
                const envelope = dataOf(snapshot);
                if (!envelope || envelope.schemaVersion !== 2 || !Number.isSafeInteger(envelope.revision) || !isRecord(envelope.data)) {
                    fail(`migration de fiche requise : ${CATALOGUE_CHARACTER_IDS[index]}`, 'failed-precondition', { kind: 'migration-needed' });
                }
                return envelope;
            });
            const now = timestamp();

            if (command.type === 'saveDraft') {
                checkRevision(command, draftEnvelope.revision);
                const next = publicCatalogue(command.payload.catalogue);
                const { skills, talents } = resolvers(withSheetSnapshot(next, sheetSnapshot));
                const nextRevision = draftEnvelope.revision + 1;
                const response = { operationId: command.operationId, revision: nextRevision,
                    catalogVersion: digest(next), aliasErrors: skills.aliasErrors.length + talents.aliasErrors.length };
                transaction.set(draftRef, { revision: nextRevision, catalogue: next, updatedAt: now, updatedBy: user.uid });
                transaction.set(receiptRef, { commandHash: hash, response, createdAt: now, uid: user.uid });
                transaction.set(historyRef, { operationId: command.operationId, type: command.type, uid: user.uid,
                    createdAt: now, revision: nextRevision, catalogVersion: response.catalogVersion });
                return response;
            }

            if (command.type === 'previewMigration') {
                checkRevision(command, draftEnvelope.revision);
                const preview = makePreview({ catalogue: draftEnvelope.catalogue, published, sheetSnapshot, careers, envelopes });
                return {
                    operationId: command.operationId,
                    draftRevision: draftEnvelope.revision,
                    publishedRevision,
                    catalogVersion: digest(draftEnvelope.catalogue),
                    report: preview.report,
                    migration: {
                        recordCount: preview.migration.recordCount,
                        collisions: preview.migration.collisions,
                        unresolved: preview.migration.unresolved,
                        customSpecializations: preview.migration.customSpecializations,
                        requiresDecisions: preview.migration.requiresDecisions,
                    },
                    characters: envelopes.map((envelope, index) => ({ charId: CATALOGUE_CHARACTER_IDS[index], revision: envelope.revision })),
                };
            }

            if (command.type !== 'publish') fail('commande inconnue');
            if (typeof command.payload.reason !== 'string' || command.payload.reason.trim().length < 3 || command.payload.reason.length > 500) {
                fail('motif de publication obligatoire');
            }
            checkRevision(command, draftEnvelope.revision);
            if (command.payload.publishedRevision !== publishedRevision) {
                fail('le référentiel publié a changé', 'aborted', { kind: 'conflict', revision: publishedRevision });
            }
            const expectedRevisions = command.payload.characterRevisions;
            if (!isRecord(expectedRevisions) || CATALOGUE_CHARACTER_IDS.some((id, index) => expectedRevisions[id] !== envelopes[index].revision)) {
                fail('les fiches ont changé depuis la prévisualisation', 'aborted', { kind: 'character-conflict' });
            }
            const candidate = publicCatalogue(draftEnvelope.catalogue, { allowVersion: false });
            const nextVersion = digest(candidate);
            candidate.catalogVersion = nextVersion;
            const preview = makePreview({ catalogue: candidate, published, sheetSnapshot, careers, envelopes });
            const migration = applySkillMigrationDecisions(preview.migration, command.payload.decisions || []);
            if (migration.unresolved.some(record => record.blocks)) fail('des compétences ciblées restent sans résolution', 'failed-precondition', { kind: 'unresolved-skills' });
            const nextEnvelopes = envelopes.map((envelope, index) => {
                const charId = CATALOGUE_CHARACTER_IDS[index];
                const nextData = applyMigrationToCharacter(envelope.data, charId, migration, preview.skills);
                const changed = canonical(nextData) !== canonical(envelope.data);
                if (!changed) return envelope;
                const purchaseIds = skillPurchaseIds(envelope.data);
                if (purchaseIds.length) {
                    nextData.catalogueMigrationBarriers = [
                        ...(Array.isArray(nextData.catalogueMigrationBarriers) ? nextData.catalogueMigrationBarriers : []),
                        { operationId: command.operationId, catalogVersion: nextVersion, purchaseIds },
                    ];
                }
                return {
                    ...envelope,
                    revision: envelope.revision + 1,
                    data: nextData,
                    catalogVersion: nextVersion,
                    updatedAt: now,
                    updatedBy: user.uid,
                };
            });
            const nextPublishedRevision = publishedRevision + 1;
            const response = { operationId: command.operationId, catalogVersion: nextVersion,
                publishedRevision: nextPublishedRevision,
                characterRevisions: Object.fromEntries(nextEnvelopes.map((envelope, index) => [CATALOGUE_CHARACTER_IDS[index], envelope.revision])) };
            transaction.set(publishedRef, { revision: nextPublishedRevision, catalogue: candidate,
                publishedAt: now, operationId: command.operationId });
            transaction.set(draftRef, { ...draftEnvelope, revision: draftEnvelope.revision + 1,
                catalogue: candidate, publishedAt: now, publishedBy: user.uid, updatedAt: now, updatedBy: user.uid });
            for (let index = 0; index < charRefs.length; index += 1) {
                if (nextEnvelopes[index] === envelopes[index]) continue;
                transaction.set(charRefs[index].collection('catalogue_backups').doc(command.operationId), {
                    ...envelopes[index], backedUpAt: now, backupOperationId: command.operationId,
                });
                transaction.set(charRefs[index], nextEnvelopes[index]);
                transaction.set(charRefs[index].collection('history').doc(`catalogue-${command.operationId}`), {
                    operationId: command.operationId, type: 'catalogue-migration', uid: user.uid, role: 'mj',
                    revision: nextEnvelopes[index].revision, createdAt: now, catalogVersion: nextVersion,
                    reason: command.payload.reason.trim(), decisions: migration.decisions,
                });
            }
            transaction.set(receiptRef, { commandHash: hash, response, createdAt: now, uid: user.uid });
            transaction.set(historyRef, { operationId: command.operationId, type: command.type, uid: user.uid,
                createdAt: now, revision: nextPublishedRevision, catalogVersion: nextVersion,
                characterRevisions: response.characterRevisions, decisions: migration.decisions,
                reason: command.payload.reason.trim() });
            return response;
        });
    }

    return Object.freeze({ executeCatalogueCommand });
}

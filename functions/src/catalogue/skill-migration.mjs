const OWNED_SKILL_COLLECTIONS = new Set(['skillsBasic', 'skillsAdvanced']);
const normalizedLabel = value => String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');

export function skillMigrationRecordKey(record) {
    return `${record.scopeId}\u0000${record.collection}\u0000${record.id}`;
}

function logicalCollection(collection) {
    return OWNED_SKILL_COLLECTIONS.has(collection) ? 'skillsOwned' : collection;
}

function collisionKey(scopeId, collection, targetId) {
    return `${scopeId}::${logicalCollection(collection)}::${targetId}`;
}

function provenAdvances(record) {
    if (!Array.isArray(record.history) || !Number.isSafeInteger(record.advances) || record.advances < 0) return null;
    const relevant = record.history.flatMap(entry => entry?.origin === 'command' && entry?.kind === 'purchase'
        && typeof entry.purchaseId === 'string' && Array.isArray(entry.effects)
        ? entry.effects.filter(effect => {
            const parts = effect?.pathParts;
            if (record.collection === 'skillsAdvanced') {
                return Array.isArray(parts) && parts.length >= 3
                    && parts[0] === 'skillsAdvanced' && parts[1] === record.id && parts[2] === 'adv';
            }
            return effect?.path === `skillsBasic.${record.id}`;
        }) : []);
    if (!relevant.length) return null;
    let current = null;
    for (const effect of relevant) {
        if (!Number.isSafeInteger(effect.before) || effect.before < 0
            || !Number.isSafeInteger(effect.after) || effect.after < 0) return null;
        if (current !== null && effect.before !== current) return null;
        current = effect.after;
    }
    return current === record.advances ? current : null;
}

/** Propose une valeur uniquement si chaque ligne de la collision est traçable et concordante. */
export function proposeCollisionAdvances(records) {
    if (!Array.isArray(records) || records.length < 2) throw new TypeError('Collision invalide.');
    const evidence = records.map(record => ({
        recordKey: skillMigrationRecordKey(record),
        currentAdvances: Number.isSafeInteger(record.advances) ? record.advances : null,
        provenAdvances: provenAdvances(record),
        purchases: (record.history || []).filter(entry => entry?.purchaseId && entry.origin === 'command' && entry.kind === 'purchase')
            .map(entry => ({ purchaseId: entry.purchaseId, operationId: entry.operationId,
                kind: entry.kind, cout: entry.cout, type: entry.type })),
    }));
    if (evidence.some(item => item.provenAdvances === null)) {
        return { status: 'insufficient-history', reason: 'Au moins une ligne ne peut pas être reliée sans ambiguïté à son historique.', evidence };
    }
    const values = new Set(evidence.map(item => item.provenAdvances));
    if (values.size !== 1) {
        return { status: 'conflicting-history', reason: 'Les historiques démontrés donnent des avances différentes.', evidence };
    }
    return { status: 'demonstrated', advances: evidence[0].provenAdvances,
        reason: 'Chaque ligne a une chaîne d’achats continue qui aboutit aux mêmes avances.', evidence };
}

/** Prévisualise la résolution sans modifier les fiches ni arbitrer les collisions. */
export function planSkillMigration({ resolver, records, fromVersion, toVersion, affectedTargetIds = null, affectedLabels = [] } = {}) {
    if (!resolver || typeof resolver.resolve !== 'function' || typeof toVersion !== 'string' || !toVersion) {
        throw new TypeError('Plan de migration invalide.');
    }
    if (!Array.isArray(records)) throw new TypeError('Les entrées à prévisualiser doivent être un tableau.');
    if (affectedTargetIds !== null && (!Array.isArray(affectedTargetIds) || affectedTargetIds.some(id => typeof id !== 'string' || !id))) {
        throw new TypeError('Cibles de migration invalides.');
    }
    if (!Array.isArray(affectedLabels) || affectedLabels.some(label => typeof label !== 'string')) throw new TypeError('Libellés ciblés invalides.');
    const targetFilter = affectedTargetIds ? new Set(affectedTargetIds) : null;
    const labelFilter = new Set(affectedLabels.map(normalizedLabel));
    const seen = new Set();
    const resolved = [];
    const unresolved = [];
    const customSpecializations = [];
    const unaffected = [];
    for (const record of records) {
        if (!record || typeof record.scopeId !== 'string' || !record.scopeId
            || typeof record.collection !== 'string' || !record.collection
            || typeof record.id !== 'string' || !record.id
            || typeof record.nom !== 'string') throw new TypeError('Ligne à migrer invalide.');
        const key = skillMigrationRecordKey(record);
        if (seen.has(key)) throw new TypeError(`Ligne à migrer dupliquée : ${record.id}`);
        seen.add(key);
        const strictMatch = resolver.resolve(record.nom);
        const match = strictMatch.status === 'unknown' && typeof resolver.resolveOwnedSkill === 'function'
            ? resolver.resolveOwnedSkill(record.nom) : strictMatch;
        const planned = { ...record, ...(match.status === 'resolved' ? { targetId: match.entry.id, targetName: match.entry.nom } : {}) };
        if (match.status === 'resolved' && (!targetFilter || targetFilter.has(match.entry.id))) resolved.push(planned);
        else if (match.status === 'resolved') unaffected.push(planned);
        else if (match.status === 'custom-specialization' && !labelFilter.has(normalizedLabel(record.nom))) {
            customSpecializations.push({ ...record, groupId: match.entry.groupId,
                specializationId: match.entry.specializationId, resolutionStatus: match.status });
        }
        else unresolved.push({ ...planned, blocks: labelFilter.has(normalizedLabel(record.nom)),
            resolutionStatus: match.status, ...(match.reason ? { reason: match.reason } : {}) });
    }
    const groups = new Map();
    for (const record of resolved) {
        const key = collisionKey(record.scopeId, record.collection, record.targetId);
        groups.set(key, [...(groups.get(key) || []), record]);
    }
    const collisions = [...groups.entries()]
        .filter(([, group]) => group.length > 1)
        .map(([key, group]) => ({ key, scopeId: group[0].scopeId, scopeName: group[0].scopeName || group[0].scopeId,
            collection: logicalCollection(group[0].collection),
            targetId: group[0].targetId, targetName: group[0].targetName,
            targetBasic: resolver.entries.find(entry => entry.id === group[0].targetId)?.basic === true,
            records: group,
            proposal: proposeCollisionAdvances(group) }))
        .sort((left, right) => left.key.localeCompare(right.key));
    return Object.freeze({
        fromVersion: typeof fromVersion === 'string' ? fromVersion : null,
        toVersion,
        resolved: Object.freeze(resolved),
        unresolved: Object.freeze(unresolved),
        customSpecializations: Object.freeze(customSpecializations),
        collisions: Object.freeze(collisions),
        requiresDecisions: unresolved.some(record => record.blocks) || collisions.length > 0,
        recordCount: records.length,
        unaffected: Object.freeze(unaffected),
    });
}

/** Applique uniquement une prévisualisation arbitrée explicitement par le MJ. */
export function applySkillMigrationDecisions(plan, decisions) {
    if (!plan || typeof plan.toVersion !== 'string' || !Array.isArray(plan.resolved)
        || !Array.isArray(plan.collisions) || !Array.isArray(plan.unresolved) || !Array.isArray(decisions)) {
        throw new TypeError('Décisions de migration invalides.');
    }
    const blockingUnresolved = plan.unresolved.filter(record => record.blocks);
    if (blockingUnresolved.length) {
        const error = new Error('La migration contient des libellés sans résolution explicite.');
        error.code = 'unresolved-skills';
        error.records = blockingUnresolved;
        throw error;
    }
    const decisionsByKey = new Map();
    for (const decision of decisions) {
        if (!decision || typeof decision.key !== 'string' || decisionsByKey.has(decision.key)) {
            throw new TypeError('Une décision de collision est absente ou dupliquée.');
        }
        decisionsByKey.set(decision.key, decision);
    }
    const collisionKeys = new Set(plan.collisions.map(collision => collision.key));
    if ([...decisionsByKey.keys()].some(key => !collisionKeys.has(key))) throw new TypeError('Décision pour une collision inconnue.');

    const dropped = [];
    const migrated = [];
    const unchanged = [...(plan.unaffected || [])];
    const collisionRecords = new Set();
    for (const collision of plan.collisions) {
        for (const record of collision.records) collisionRecords.add(skillMigrationRecordKey(record));
        const decision = decisionsByKey.get(collision.key);
        if (!decision || typeof decision.keepRecordKey !== 'string'
            || !collision.records.some(record => skillMigrationRecordKey(record) === decision.keepRecordKey)) {
            const error = new Error(`La collision ${collision.key} requiert une décision du MJ.`);
            error.code = 'decision-required';
            error.collision = collision;
            throw error;
        }
        const winner = collision.records.find(record => skillMigrationRecordKey(record) === decision.keepRecordKey);
        const ownedSkills = logicalCollection(winner.collection) === 'skillsOwned';
        const allowedStorage = ownedSkills ? new Set([collision.targetBasic ? 'skillsBasic' : 'skillsAdvanced']) : new Set([winner.collection]);
        if (typeof decision.storageCollection !== 'string' || !allowedStorage.has(decision.storageCollection)) {
            throw new TypeError(`Le stockage cible de ${collision.key} doit être choisi explicitement.`);
        }
        if (!Number.isSafeInteger(decision.advances) || decision.advances < 0) {
            const error = new Error(`Le nombre d’avances choisi pour ${collision.key} doit être explicite.`);
            error.code = 'decision-required';
            error.collision = collision;
            throw error;
        }
        const value = { ...winner, sourceCollection: winner.collection,
            collection: decision.storageCollection, skillId: collision.targetId,
            sourceName: winner.nom, nom: collision.targetName, advances: decision.advances };
        migrated.push(value);
        for (const record of collision.records) if (skillMigrationRecordKey(record) !== decision.keepRecordKey) dropped.push(record);
    }
    for (const record of plan.resolved) {
        if (collisionRecords.has(skillMigrationRecordKey(record))) continue;
        migrated.push({ ...record, sourceName: record.nom, skillId: record.targetId, nom: record.targetName });
    }
    if (decisionsByKey.size !== plan.collisions.length) throw new TypeError('Chaque collision exige une seule décision.');
    return Object.freeze({
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        records: Object.freeze(migrated),
        unchanged: Object.freeze(unchanged),
        unresolved: Object.freeze(plan.unresolved),
        customSpecializations: Object.freeze(plan.customSpecializations || []),
        dropped: Object.freeze(dropped),
        decisions: Object.freeze(plan.collisions.map(collision => ({
            key: collision.key,
            keepRecordKey: decisionsByKey.get(collision.key).keepRecordKey,
            storageCollection: decisionsByKey.get(collision.key).storageCollection,
            advances: decisionsByKey.get(collision.key).advances,
        }))),
    });
}

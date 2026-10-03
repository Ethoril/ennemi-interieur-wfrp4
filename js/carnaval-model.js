const hasObject = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const minute = value => Number.isInteger(value) && value >= 0 && value <= 1800;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(value);
const boundedText = (value, maximum) => text(value) && value.length <= maximum;
const absTime = (day, value) => (day - 1) * 1440 + value;
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

function result(errors, warnings = []) { return { valid: errors.length === 0, errors, warnings }; }

export function validateSource(source) {
    const errors = [];
    const issue = (path, message) => errors.push({ path, message });
    if (!hasObject(source)) return result([{ path: '', message: 'Objet attendu.' }]);
    if (!onlyKeys(source, ['version', 'days', 'places', 'characters', 'events', 'updatedAt'])) issue('', 'Champ inattendu.');
    if (source.version !== 1) issue('version', 'Version attendue : 1.');
    for (const key of ['days', 'places', 'characters', 'events']) if (!Array.isArray(source[key])) issue(key, 'Liste attendue.');
    const limits = { days: 8, places: 50, characters: 500, events: 250 };
    for (const [key, maximum] of Object.entries(limits)) if (Array.isArray(source[key]) && source[key].length > maximum) issue(key, 'Liste trop longue.');
    if (Array.isArray(source.days) && source.days.length !== 8) issue('days', 'Le calendrier doit compter exactement huit jours.');
    for (const [key, rows] of [['days', source.days], ['places', source.places], ['characters', source.characters], ['events', source.events]]) {
        if (!Array.isArray(rows)) continue;
        const ids = new Set();
        rows.forEach((row, index) => {
            const path = `${key}[${index}]`;
            if (!hasObject(row) || !(key === 'days' ? Number.isInteger(row.id) : safeId(row.id)) || !boundedText(row.name ?? row.title, 300)) { issue(path, 'Identifiant ou nom invalide.'); return; }
            if (!onlyKeys(row, key === 'days' || key === 'places' ? ['id', 'name'] : key === 'characters' ? ['id', 'name', 'aliases'] : ['id', 'day', 'start', 'end', 'title', 'placeId', 'kind', 'source', 'presences'])) issue(path, 'Champ inattendu.');
            if (ids.has(row.id)) issue(`${path}.id`, 'Identifiant dupliqué.'); ids.add(row.id);
            if (key === 'days' && (row.id !== index + 1 || !Number.isInteger(row.id) || row.id < 1 || row.id > 8)) issue(`${path}.id`, 'Les jours doivent être numérotés de 1 à 8.');
            if (key === 'characters' && (!Array.isArray(row.aliases) || row.aliases.length > 50 || row.aliases.some(a => !boundedText(a, 200)))) issue(`${path}.aliases`, 'Liste d’alias invalide.');
            if (key === 'events') {
                if (!Number.isInteger(row.day) || row.day < 1 || row.day > 8) issue(`${path}.day`, 'Jour hors limites.');
                if (!boundedText(row.title, 500) || !safeId(row.placeId)) issue(path, 'Titre et lieu requis.');
                if (!['public', 'secret'].includes(row.kind)) issue(`${path}.kind`, 'Type public ou secret attendu.');
                if (row.start !== null && !minute(row.start)) issue(`${path}.start`, 'Minute invalide.');
                if (row.end !== null && !minute(row.end)) issue(`${path}.end`, 'Minute invalide.');
                if (row.kind === 'public' && (!minute(row.start) || !minute(row.end))) issue(path, 'Les événements publics exigent un début et une fin.');
                if (Number.isInteger(row.start) && Number.isInteger(row.end) && row.end <= row.start) issue(path, 'Créneau horaire invalide.');
                if (!hasObject(row.source) || !onlyKeys(row.source, ['bookPage', 'pdfPage']) || !Number.isInteger(row.source.bookPage) || row.source.bookPage < 1 || !Number.isInteger(row.source.pdfPage) || row.source.pdfPage < 1) issue(`${path}.source`, 'Références de pages requises.');
                if (Array.isArray(row.presences) && row.presences.length > 500) issue(`${path}.presences`, 'Liste trop longue.');
                if (!Array.isArray(row.presences)) issue(`${path}.presences`, 'Liste attendue.');
                else row.presences.forEach((p, pi) => {
                    if (!hasObject(p) || !onlyKeys(p, ['characterId', 'start', 'end', 'role']) || !safeId(p.characterId)) issue(`${path}.presences[${pi}]`, 'Personnage requis.');
                    else {
                        for (const f of ['start', 'end']) if (p[f] !== null && !minute(p[f])) issue(`${path}.presences[${pi}].${f}`, 'Minute invalide.');
                        const s = p.start ?? row.start; const e = p.end ?? row.end;
                        if (minute(s) && minute(e) && e <= s) issue(`${path}.presences[${pi}]`, 'Créneau de présence invalide.');
                        if (!['present', 'participant'].includes(p.role)) issue(`${path}.presences[${pi}].role`, 'Rôle invalide.');
                    }
                });
            }
        });
    }
    const places = new Set((Array.isArray(source.places) ? source.places : []).map(x => x?.id));
    const chars = new Set((Array.isArray(source.characters) ? source.characters : []).map(x => x?.id));
    (Array.isArray(source.events) ? source.events : []).forEach((event, i) => {
        if (event && !places.has(event.placeId)) issue(`events[${i}].placeId`, 'Lieu inconnu.');
        (Array.isArray(event?.presences) ? event.presences : []).forEach((p, j) => { if (p && !chars.has(p.characterId)) issue(`events[${i}].presences[${j}].characterId`, 'Personnage inconnu.'); });
    });
    return result(errors);
}

function validatePresenceList(presences, path, issue) {
    if (!Array.isArray(presences) || presences.length > 500) { issue(path, 'Liste de présences invalide.'); return; }
    presences.forEach((presence, index) => {
        const itemPath = `${path}[${index}]`;
        if (!hasObject(presence) || !onlyKeys(presence, ['characterId', 'start', 'end', 'role']) || !safeId(presence.characterId)
            || !['present', 'participant'].includes(presence.role)) { issue(itemPath, 'Présence invalide.'); return; }
        for (const field of ['start', 'end']) if (presence[field] !== null && !minute(presence[field])) issue(`${itemPath}.${field}`, 'Minute invalide.');
        if (Number.isInteger(presence.start) && Number.isInteger(presence.end) && presence.end <= presence.start) issue(itemPath, 'Créneau de présence invalide.');
    });
}

function validateEditableEvent(event, path, issue, { partial = false, allowNullSource = false } = {}) {
    const fields = ['id', 'day', 'start', 'end', 'title', 'placeId', 'kind', 'source', 'presences'];
    if (!hasObject(event) || !onlyKeys(event, [...fields, ...(partial ? ['cancelled'] : [])])) { issue(path, 'Événement invalide ou champ inattendu.'); return; }
    if (!partial && !safeId(event.id)) issue(`${path}.id`, 'Identifiant invalide.');
    if (event.cancelled !== undefined && typeof event.cancelled !== 'boolean') issue(`${path}.cancelled`, 'Booléen attendu.');
    for (const field of ['day', 'start', 'end', 'title', 'placeId', 'kind', 'source', 'presences']) {
        if (partial && !Object.hasOwn(event, field)) continue;
        if (field === 'day' && (!Number.isInteger(event.day) || event.day < 1 || event.day > 8)) issue(`${path}.day`, 'Jour hors limites.');
        if ((field === 'start' || field === 'end') && event[field] !== null && !minute(event[field])) issue(`${path}.${field}`, 'Minute invalide.');
        if (field === 'title' && !boundedText(event.title, 500)) issue(`${path}.title`, 'Titre invalide.');
        if (field === 'placeId' && !safeId(event.placeId)) issue(`${path}.placeId`, 'Lieu invalide.');
        if (field === 'kind' && !['public', 'secret'].includes(event.kind)) issue(`${path}.kind`, 'Type invalide.');
        if (field === 'source' && !(allowNullSource && event.source === null) && (!hasObject(event.source) || !onlyKeys(event.source, ['bookPage', 'pdfPage'])
            || !['bookPage', 'pdfPage'].every(key => event.source[key] === null || (Number.isInteger(event.source[key]) && event.source[key] > 0)))) issue(`${path}.source`, 'Référence invalide.');
        if (field === 'presences') validatePresenceList(event.presences, `${path}.presences`, issue);
    }
    if (!partial && event.kind === 'public' && (!minute(event.start) || !minute(event.end))) issue(path, 'Un événement public exige un début et une fin.');
    if (Number.isInteger(event.start) && Number.isInteger(event.end) && event.end <= event.start) issue(path, 'Créneau horaire invalide.');
}

export function validateCampaign(campaign, source = null) {
    const errors = [];
    const warnings = [];
    const issue = (path, message) => errors.push({ path, message });
    if (!hasObject(campaign)) return result([{ path: '', message: 'Objet attendu.' }]);
    if (!onlyKeys(campaign, ['version', 'revision', 'clock', 'links', 'overrides', 'customEvents', 'notes', 'updatedAt'])) issue('', 'Champ inattendu.');
    if (campaign.version !== 1) issue('version', 'Version attendue : 1.');
    if (!Number.isInteger(campaign.revision) || campaign.revision < 0) issue('revision', 'Révision entière non négative requise.');
    if (!hasObject(campaign.clock) || !onlyKeys(campaign.clock, ['day', 'minute']) || !Number.isInteger(campaign.clock.day) || campaign.clock.day < 1 || campaign.clock.day > 8 || !minute(campaign.clock.minute)) issue('clock', 'Jour ou heure invalide.');
    for (const key of ['links', 'overrides', 'notes']) if (!hasObject(campaign[key])) issue(key, 'Objet attendu.');
    if (hasObject(campaign.links)) {
        if (Object.keys(campaign.links).length > 500) issue('links', 'Trop de rapprochements.');
        for (const [id, pnjId] of Object.entries(campaign.links)) if (!safeId(id) || !safeId(pnjId)) issue(`links.${id}`, 'Identifiant de fiche invalide.');
    }
    if (hasObject(campaign.overrides) && Object.keys(campaign.overrides).length > 250) issue('overrides', 'Trop d’adaptations.');
    for (const [id, override] of Object.entries(campaign.overrides ?? {})) {
        if (!safeId(id)) issue(`overrides.${id}`, 'Identifiant d’événement invalide.');
        validateEditableEvent(override, `overrides.${id}`, issue, { partial: true });
    }
    if (!Array.isArray(campaign.customEvents) || campaign.customEvents.length > 100) issue('customEvents', 'Liste d’événements invalide.');
    else {
        const ids = new Set();
        campaign.customEvents.forEach((event, index) => {
            validateEditableEvent(event, `customEvents[${index}]`, issue, { allowNullSource: true });
            if (safeId(event?.id)) { if (ids.has(event.id)) issue(`customEvents[${index}].id`, 'Identifiant dupliqué.'); ids.add(event.id); }
        });
    }
    if (hasObject(campaign.notes) && Object.keys(campaign.notes).length > 350) issue('notes', 'Trop de notes.');
    for (const [id, note] of Object.entries(campaign.notes ?? {})) if (!safeId(id) || typeof note !== 'string' || note.length > 20000) issue(`notes.${id}`, 'Note textuelle invalide.');
    if (source && hasObject(source)) {
        const checkedSource = validateSource(source);
        if (!checkedSource.valid) errors.push(...checkedSource.errors.map(item => ({ path: `source.${item.path}`, message: item.message })));
        if (checkedSource.valid && hasObject(campaign.overrides) && Array.isArray(campaign.customEvents)) {
            const eventIds = new Set(source.events.map(event => event.id));
            const placeIds = new Set(source.places.map(place => place.id));
            const characterIds = new Set(source.characters.map(character => character.id));
            for (const id of Object.keys(campaign.overrides ?? {})) if (!eventIds.has(id)) issue(`overrides.${id}`, 'Événement source inconnu.');
            for (const id of Object.keys(campaign.links ?? {})) if (!characterIds.has(id)) issue(`links.${id}`, 'Personnage du calendrier inconnu.');
            for (const event of campaign.customEvents ?? []) if (event && (eventIds.has(event.id) || campaign.customEvents.filter(other => other?.id === event.id).length > 1)) issue(`customEvents.${event.id}`, 'Identifiant d’événement déjà utilisé.');
            const effective = effectiveEvents(source, campaign);
            const effectiveIds = new Set([...eventIds, ...(campaign.customEvents ?? []).map(event => event?.id)]);
            for (const event of effective) {
                if (!placeIds.has(event.placeId)) issue(`events.${event.id}.placeId`, 'Lieu inconnu.');
                if (event.kind === 'public' && (!minute(event.start) || !minute(event.end))) issue(`events.${event.id}`, 'Un événement public exige un début et une fin.');
                if (Number.isInteger(event.start) && Number.isInteger(event.end) && event.end <= event.start) issue(`events.${event.id}`, 'Créneau effectif invalide.');
                const presences = Array.isArray(event.presences) ? event.presences : [];
                for (const presence of presences) if (!characterIds.has(presence?.characterId)) issue(`events.${event.id}.presences`, 'Personnage inconnu.');
                const presenceIds = new Set();
                for (const presence of presences) {
                    if (!hasObject(presence)) continue;
                    if (presenceIds.has(presence.characterId)) issue(`events.${event.id}.presences`, 'Personnage présent plusieurs fois dans la même scène.');
                    presenceIds.add(presence.characterId);
                    const start = presence.start ?? event.start;
                    const end = presence.end ?? event.end;
                    if (Number.isInteger(start) && Number.isInteger(end) && end <= start) issue(`events.${event.id}.presences`, 'Créneau effectif de présence invalide.');
                    if ((Number.isInteger(event.start) && Number.isInteger(start) && start < event.start)
                        || (Number.isInteger(event.end) && Number.isInteger(end) && end > event.end)) {
                        warnings.push({ path: `events.${event.id}.presences`, message: 'Présence explicite en dehors des horaires de la scène.' });
                    }
                }
            }
            for (const id of Object.keys(campaign.notes ?? {})) if (!effectiveIds.has(id)) issue(`notes.${id}`, 'Événement inconnu.');
        }
    }
    return result(errors, warnings);
}

export function initialCampaign() {
    return { version: 1, revision: 0, clock: { day: 1, minute: 480 }, links: {}, overrides: {}, customEvents: [], notes: {} };
}

export function resetEventOverride(campaign, eventId) {
    const next = JSON.parse(JSON.stringify(campaign));
    delete next.overrides[eventId];
    return next;
}

export function effectiveEvents(source, campaign) {
    const overrides = campaign?.overrides ?? {};
    return [...(source?.events ?? []).map(event => ({ ...event, ...(overrides[event.id] ?? {}), id: event.id, sourceEventId: event.id, adapted: Object.hasOwn(overrides, event.id) })), ...(campaign?.customEvents ?? []).map(event => ({ ...event, adapted: true, custom: true }))]
        .filter(event => event.cancelled !== true)
        .sort((a, b) => a.day - b.day || (Number.isInteger(a.start) ? a.start : Infinity) - (Number.isInteger(b.start) ? b.start : Infinity) || String(a.id).localeCompare(String(b.id)));
}

export function eventPresences(event) {
    return (Array.isArray(event?.presences) ? event.presences : []).map(p => ({
        ...p, start: p.start ?? event.start ?? null, end: p.end ?? event.end ?? null,
        inferred: p.start == null && p.end == null,
        milestone: Number.isInteger(p.start ?? event.start) && (p.end ?? event.end) == null,
    }));
}

export function isAt(event, clock) {
    if (!event || !clock || !Number.isInteger(clock.day) || !Number.isInteger(clock.minute)) return false;
    if (!Number.isInteger(event.day) || !Number.isInteger(event.start)) return false;
    const now = absTime(clock.day, clock.minute); const start = absTime(event.day, event.start);
    if (Number.isInteger(event.end)) return now >= start && now < absTime(event.day, event.end);
    return event.end === null && now === start;
}

export function findNextPresence(events, characterId, clock) {
    const now = absTime(clock.day, clock.minute);
    const candidates = [];
    for (const event of events ?? []) for (const presence of eventPresences(event)) {
        if (presence.characterId !== characterId) continue;
        if (!Number.isInteger(event.day) || !Number.isInteger(presence.start)) continue;
        const start = absTime(event.day, presence.start);
        if (Number.isInteger(presence.end)) {
            const end = absTime(event.day, presence.end);
            if (end > now) candidates.push({ event, presence, start, end, active: start <= now && now < end });
        } else if (presence.end === null && start >= now) {
            candidates.push({ event, presence: { ...presence, milestone: true }, start, end: start, active: false });
        }
    }
    candidates.sort((a, b) => Number(b.active) - Number(a.active) || a.start - b.start || a.end - b.end);
    if (!candidates.length) return null;
    const match = candidates[0];
    return { event: match.event, presence: match.presence };
}

export function findOverlaps(events) {
    const occurrences = [];
    for (const event of events ?? []) for (const presence of eventPresences(event)) {
        if (!Number.isInteger(event.day) || !Number.isInteger(presence.start) || !Number.isInteger(presence.end)) continue;
        occurrences.push({ event, presence, start: absTime(event.day, presence.start), end: absTime(event.day, presence.end), placeId: event.placeId });
    }
    const output = [];
    for (let i = 0; i < occurrences.length; i++) for (let j = i + 1; j < occurrences.length; j++) {
        const a = occurrences[i]; const b = occurrences[j];
        if (a.presence.characterId !== b.presence.characterId || a.event.id === b.event.id || a.placeId === b.placeId) continue;
        const start = Math.max(a.start, b.start); const end = Math.min(a.end, b.end);
        if (start < end) output.push({ characterId: a.presence.characterId, first: { event: a.event, presence: a.presence }, second: { event: b.event, presence: b.presence }, overlapStart: start, overlapEnd: end });
    }
    return output;
}

export function suggestPnjMatches(character, pnjs) {
    const fold = value => String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const names = [character?.name, ...(character?.aliases ?? [])].map(fold).filter(Boolean);
    return (pnjs ?? []).map(pnj => {
        const candidates = [pnj?.nom, pnj?.name, ...(pnj?.aliases ?? [])].map(fold).filter(Boolean);
        let best = 0; let matchedAlias = null;
        for (const name of names) for (const candidate of candidates) {
            const score = name === candidate ? 1 : (name.includes(candidate) || candidate.includes(name)) ? 0.8 : 0;
            if (score > best) { best = score; matchedAlias = candidate; }
        }
        return { pnj, score: best, matchedAlias };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
}

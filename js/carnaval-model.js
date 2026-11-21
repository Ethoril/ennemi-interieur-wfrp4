const hasObject = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const minute = value => Number.isInteger(value) && value >= 0 && value <= 1800;
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/u.test(value);
const boundedText = (value, maximum) => text(value) && value.length <= maximum;
const absTime = (day, value) => (day - 1) * 1440 + value;
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

const HOLDER_KEYS = ['id', 'label', 'weight', 'camp', 'characterIds', 'changedAt'];
const validMoment = value => hasObject(value) && onlyKeys(value, ['day', 'minute']) && Object.hasOwn(value, 'day') && Object.hasOwn(value, 'minute')
    && Number.isInteger(value.day) && value.day >= 1 && value.day <= 8 && minute(value.minute);

export const CAMPS = Object.freeze([{ id: 'adverse', label: 'Adverse' }, { id: 'libre', label: 'Libre' }, { id: 'acquis', label: 'Acquis' }]);
export const ATTITUDES = Object.freeze([{ id: 'hostile', label: 'Hostile' }, { id: 'neutre', label: 'Neutre' }, { id: 'favorable', label: 'Favorable' }]);

function result(errors, warnings = []) { return { valid: errors.length === 0, errors, warnings }; }

export function validateDossiers(data) {
    if (!hasObject(data) || !onlyKeys(data, ['version', 'characters']) || data.version !== 1 || !hasObject(data.characters)) {
        return result([{ path: '', message: 'Format de dossiers PNJ invalide.' }]);
    }
    const entries = Object.entries(data.characters);
    if (entries.length > 500) return result([{ path: 'characters', message: 'Trop de dossiers PNJ.' }]);
    const errors = [];
    for (const [id, dossier] of entries) {
        if (!safeId(id) || !hasObject(dossier) || !onlyKeys(dossier, ['summary', 'story', 'details'])
            || !boundedText(dossier.summary, 5000) || !boundedText(dossier.story, 30000)
            || (Object.hasOwn(dossier, 'details') && !boundedText(dossier.details, 30000))) {
            errors.push({ path: `characters.${id}`, message: 'Dossier PNJ invalide.' });
        }
    }
    return result(errors);
}

export function validateLocationData(data, { hints = false } = {}) {
    const key = hints ? 'hints' : 'movements';
    const errors = [];
    const issue = (path, message) => errors.push({ path, message });
    const keys = hints ? ['version', key] : ['version', 'revision', key, 'updatedAt'];
    if (!hasObject(data) || data.version !== 1 || !onlyKeys(data, keys)
        || (!hints && (!Number.isInteger(data.revision) || data.revision < 0))
        || !Array.isArray(data[key]) || data[key].length > 300) {
        return result([{ path: key, message: 'Format de localisations invalide.' }]);
    }
    const ids = new Set();
    const schedules = new Map();
    data[key].forEach((entry, index) => {
        const path = `${key}[${index}]`;
        const fields = ['id', 'characterId', 'day', 'start', 'end', 'place', 'note', ...(hints ? ['source'] : [])];
        if (!hasObject(entry) || !onlyKeys(entry, fields) || !safeId(entry.id) || !safeId(entry.characterId)
            || !Number.isInteger(entry.day) || entry.day < 1 || entry.day > 8 || !boundedText(entry.place, 200)
            || typeof entry.note !== 'string' || entry.note.length > 500 || (hints && !boundedText(entry.source, 250))) {
            issue(path, 'Personnage, jour ou lieu invalide.');
            return;
        }
        if (ids.has(entry.id)) issue(path, 'Identifiant dupliqué.');
        ids.add(entry.id);
        if (hints && entry.start === null && entry.end === null) return;
        if (!minute(entry.start) || !minute(entry.end) || entry.end <= entry.start) {
            issue(path, 'La fin doit être après le début.');
            return;
        }
        if (hints) return;
        const spans = schedules.get(entry.characterId) ?? [];
        const start = absTime(entry.day, entry.start), end = absTime(entry.day, entry.end);
        if (spans.some(span => span.start < end && start < span.end)) issue(path, 'Deux déplacements du même PNJ se chevauchent.');
        spans.push({ start, end });
        schedules.set(entry.characterId, spans);
    });
    return result(errors);
}

export function buildLocationTimelines(events, places, hints = [], movements = []) {
    const locations = new Map(places.map(place => [place.id, place.name]));
    const timelines = new Map();
    const add = (id, item) => {
        const entries = timelines.get(id) ?? [];
        entries.push(item);
        timelines.set(id, entries);
    };
    for (const event of events) for (const presence of eventPresences(event)) {
        add(presence.characterId, {
            kind: event.kind === 'secret' ? 'forecast' : 'event', day: event.day, start: presence.start,
            end: presence.end, title: event.title, place: locations.get(event.placeId), placeId: event.placeId,
            inferred: presence.inferred, note: '',
        });
    }
    for (const entry of hints) add(entry.characterId, { ...entry, kind: 'hint' });
    for (const entry of movements) add(entry.characterId, { ...entry, kind: 'move' });
    for (const entries of timelines.values()) {
        entries.sort((a, b) => a.day - b.day || (a.start ?? Infinity) - (b.start ?? Infinity));
    }
    return timelines;
}

export function locateCharacter(timeline, clock) {
    const now = absTime(clock.day, clock.minute);
    const active = (start, end) => start <= now && now < end;
    const moves = [], events = [], hints = [], forecasts = [];
    const calendarDay = Math.floor(now / 1440) + 1;
    let last = null, next = null, lastEnd = -Infinity, nextStart = Infinity;
    for (const entry of timeline) {
        const { kind, day, start, end } = entry;
        if (kind === 'hint' && start === null) {
            if (day === calendarDay) hints.push(entry);
            continue;
        }
        if (!Number.isInteger(start)) continue;
        const from = absTime(day, start);
        const until = Number.isInteger(end) ? absTime(day, end) : null;
        if (kind === 'forecast') {
            if (until === null ? now === from : active(from, until)) forecasts.push(entry);
            continue;
        }
        if (until === null) continue;
        if (active(from, until)) {
            if (kind === 'move') moves.push(entry);
            else if (kind === 'hint') hints.push(entry);
            else events.push(entry);
        } else if (kind !== 'hint') {
            if (until <= now && (until > lastEnd || (until === lastEnd && kind === 'move'))) { last = entry; lastEnd = until; }
            if (from >= now && (from < nextStart || (from === nextStart && kind === 'move'))) { next = entry; nextStart = from; }
        }
    }
    return { current: moves.length ? moves : events, hints, forecasts, last, next };
}

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
            if (!onlyKeys(row, key === 'days' || key === 'places' ? ['id', 'name'] : key === 'characters' ? ['id', 'name', 'aliases'] : ['id', 'day', 'start', 'end', 'title', 'description', 'placeId', 'kind', 'source', 'presences'])) issue(path, 'Champ inattendu.');
            if (ids.has(row.id)) issue(`${path}.id`, 'Identifiant dupliqué.'); ids.add(row.id);
            if (key === 'days' && (row.id !== index + 1 || !Number.isInteger(row.id) || row.id < 1 || row.id > 8)) issue(`${path}.id`, 'Les jours doivent être numérotés de 1 à 8.');
            if (key === 'characters' && (!Array.isArray(row.aliases) || row.aliases.length > 50 || row.aliases.some(a => !boundedText(a, 200)))) issue(`${path}.aliases`, 'Liste d’alias invalide.');
            if (key === 'events') {
                if (!Number.isInteger(row.day) || row.day < 1 || row.day > 8) issue(`${path}.day`, 'Jour hors limites.');
                if (!boundedText(row.title, 500) || !safeId(row.placeId)) issue(path, 'Titre et lieu requis.');
                if (Object.hasOwn(row, 'description') && !boundedText(row.description, 1000)) issue(`${path}.description`, 'Description de 1 à 1000 caractères attendue.');
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

function validateEditableEvent(event, path, issue, { partial = false, allowNullSource = false, allowRendezvous = false } = {}) {
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
        if (field === 'kind' && !['public', 'secret', ...(allowRendezvous ? ['rendezvous'] : [])].includes(event.kind)) issue(`${path}.kind`, 'Type invalide.');
        if (field === 'source' && !(allowNullSource && event.source === null) && (!hasObject(event.source) || !onlyKeys(event.source, ['bookPage', 'pdfPage'])
            || !['bookPage', 'pdfPage'].every(key => event.source[key] === null || (Number.isInteger(event.source[key]) && event.source[key] > 0)))) issue(`${path}.source`, 'Référence invalide.');
        if (field === 'presences') validatePresenceList(event.presences, `${path}.presences`, issue);
    }
    if (!partial && event.kind === 'public' && (!minute(event.start) || !minute(event.end))) issue(path, 'Un événement public exige un début et une fin.');
    if (Number.isInteger(event.start) && Number.isInteger(event.end) && event.end <= event.start) issue(path, 'Créneau horaire invalide.');
    if (event.kind === 'rendezvous' && !minute(event.start)) issue(`${path}.start`, 'Un rendez-vous exige un début.');
}

export function validateCampaign(campaign, source = null) {
    const errors = [];
    const warnings = [];
    const issue = (path, message) => errors.push({ path, message });
    if (!hasObject(campaign)) return result([{ path: '', message: 'Objet attendu.' }]);
    if (!onlyKeys(campaign, ['version', 'revision', 'clock', 'links', 'overrides', 'customEvents', 'customPlaces', 'holders', 'tracking', 'introductions', 'notes', 'updatedAt'])) issue('', 'Champ inattendu.');
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
            validateEditableEvent(event, `customEvents[${index}]`, issue, { allowNullSource: true, allowRendezvous: true });
            if (safeId(event?.id)) { if (ids.has(event.id)) issue(`customEvents[${index}].id`, 'Identifiant dupliqué.'); ids.add(event.id); }
        });
    }
    if (campaign.customPlaces !== undefined) {
        if (!Array.isArray(campaign.customPlaces) || campaign.customPlaces.length > 50) issue('customPlaces', 'Liste de lieux invalide.');
        else {
            const ids = new Set();
            campaign.customPlaces.forEach((place, index) => {
                const path = `customPlaces[${index}]`;
                if (!hasObject(place) || !onlyKeys(place, ['id', 'name']) || !safeId(place.id) || !boundedText(place.name, 200)) { issue(path, 'Lieu invalide ou champ inattendu.'); return; }
                if (ids.has(place.id)) issue(`${path}.id`, 'Identifiant dupliqué.'); ids.add(place.id);
            });
        }
    }
    if (campaign.holders !== undefined) {
        if (!Array.isArray(campaign.holders) || campaign.holders.length > 50) issue('holders', 'Liste de détenteurs invalide.');
        else {
            const ids = new Set();
            campaign.holders.forEach((holder, index) => {
                const path = `holders[${index}]`;
                if (!hasObject(holder) || !onlyKeys(holder, HOLDER_KEYS) || !HOLDER_KEYS.every(key => Object.hasOwn(holder, key))) { issue(path, 'Détenteur invalide ou champ inattendu.'); return; }
                if (!safeId(holder.id)) issue(`${path}.id`, 'Identifiant invalide.');
                else { if (ids.has(holder.id)) issue(`${path}.id`, 'Identifiant dupliqué.'); ids.add(holder.id); }
                if (!boundedText(holder.label, 100)) issue(`${path}.label`, 'Libellé invalide.');
                if (!Number.isInteger(holder.weight) || holder.weight < 0 || holder.weight > 99) issue(`${path}.weight`, 'Poids hors limites.');
                if (!CAMPS.some(camp => camp.id === holder.camp)) issue(`${path}.camp`, 'Camp inconnu.');
                if (!Array.isArray(holder.characterIds) || holder.characterIds.length > 20 || holder.characterIds.some(id => !safeId(id)) || new Set(holder.characterIds).size !== holder.characterIds.length) issue(`${path}.characterIds`, 'Liste de personnages invalide.');
                if (holder.changedAt !== null && !validMoment(holder.changedAt)) issue(`${path}.changedAt`, 'Moment invalide.');
            });
        }
    }
    if (campaign.tracking !== undefined) {
        if (!hasObject(campaign.tracking) || Object.keys(campaign.tracking).length > 500) issue('tracking', 'Suivi invalide.');
        else for (const [id, entry] of Object.entries(campaign.tracking)) {
            const path = `tracking.${id}`;
            if (!safeId(id)) issue(path, 'Identifiant de personnage invalide.');
            if (!hasObject(entry) || !onlyKeys(entry, ['met', 'attitude', 'note']) || !['met', 'attitude', 'note'].every(key => Object.hasOwn(entry, key))) { issue(path, 'Suivi invalide ou champ inattendu.'); continue; }
            if (entry.met !== null && !validMoment(entry.met)) issue(`${path}.met`, 'Moment invalide.');
            if (entry.attitude !== null && !ATTITUDES.some(attitude => attitude.id === entry.attitude)) issue(`${path}.attitude`, 'Attitude inconnue.');
            if (typeof entry.note !== 'string' || entry.note.length > 500) issue(`${path}.note`, 'Note invalide.');
        }
    }
    if (campaign.introductions !== undefined) {
        if (!hasObject(campaign.introductions) || Object.keys(campaign.introductions).length > 500) issue('introductions', 'Présentations invalides.');
        else for (const [id, list] of Object.entries(campaign.introductions)) {
            const path = `introductions.${id}`;
            if (!safeId(id)) issue(path, 'Identifiant de personnage invalide.');
            if (!Array.isArray(list) || list.length > 30) { issue(path, 'Liste de présentations invalide.'); continue; }
            const targets = new Set();
            list.forEach((item, index) => {
                const itemPath = `${path}[${index}]`;
                if (!hasObject(item) || !onlyKeys(item, ['to', 'condition']) || !Object.hasOwn(item, 'to') || !Object.hasOwn(item, 'condition') || !safeId(item.to)) { issue(itemPath, 'Présentation invalide ou champ inattendu.'); return; }
                if (item.to === id) issue(`${itemPath}.to`, 'Un personnage ne se présente pas à lui-même.');
                if (targets.has(item.to)) issue(`${itemPath}.to`, 'Cible dupliquée.'); targets.add(item.to);
                if (typeof item.condition !== 'string' || item.condition.length > 200) issue(`${itemPath}.condition`, 'Condition invalide.');
            });
        }
    }
    if (hasObject(campaign.notes) && Object.keys(campaign.notes).length > 350) issue('notes', 'Trop de notes.');
    for (const [id, note] of Object.entries(campaign.notes ?? {})) if (!safeId(id) || typeof note !== 'string' || note.length > 20000) issue(`notes.${id}`, 'Note textuelle invalide.');
    if (source && hasObject(source)) {
        const checkedSource = validateSource(source);
        if (!checkedSource.valid) errors.push(...checkedSource.errors.map(item => ({ path: `source.${item.path}`, message: item.message })));
        if (checkedSource.valid) {
            const known = new Set(source.characters.map(character => character.id));
            const unknown = (id, path) => { if (typeof id === 'string' && !known.has(id)) issue(path, 'Personnage du calendrier inconnu.'); };
            const holdersList = Array.isArray(campaign.holders) ? campaign.holders : [];
            const placed = new Set();
            holdersList.forEach((holder, index) => {
                if (!hasObject(holder) || !Array.isArray(holder.characterIds)) return;
                holder.characterIds.forEach((id, i) => {
                    unknown(id, `holders[${index}].characterIds[${i}]`);
                    if (placed.has(id)) issue(`holders[${index}].characterIds[${i}]`, 'Personnage déjà attribué à un autre détenteur.');
                    placed.add(id);
                });
            });
            if (hasObject(campaign.tracking)) for (const id of Object.keys(campaign.tracking)) unknown(id, `tracking.${id}`);
            if (hasObject(campaign.introductions)) for (const [id, list] of Object.entries(campaign.introductions)) {
                unknown(id, `introductions.${id}`);
                if (Array.isArray(list)) list.forEach((item, index) => unknown(item?.to, `introductions.${id}[${index}].to`));
            }
        }
        if (checkedSource.valid && hasObject(campaign.overrides) && Array.isArray(campaign.customEvents)) {
            const eventIds = new Set(source.events.map(event => event.id));
            const placeIds = new Set(source.places.map(place => place.id));
            const characterIds = new Set(source.characters.map(character => character.id));
            const customPlaces = Array.isArray(campaign.customPlaces) ? campaign.customPlaces : [];
            customPlaces.forEach((place, index) => { if (hasObject(place) && placeIds.has(place.id)) issue(`customPlaces[${index}].id`, 'Identifiant de lieu déjà utilisé par le calendrier.'); });
            const knownPlaceIds = new Set([...placeIds, ...customPlaces.map(place => place?.id)]);
            for (const id of Object.keys(campaign.overrides ?? {})) if (!eventIds.has(id)) issue(`overrides.${id}`, 'Événement source inconnu.');
            for (const id of Object.keys(campaign.links ?? {})) if (!characterIds.has(id)) issue(`links.${id}`, 'Personnage du calendrier inconnu.');
            for (const event of campaign.customEvents ?? []) if (event && (eventIds.has(event.id) || campaign.customEvents.filter(other => other?.id === event.id).length > 1)) issue(`customEvents.${event.id}`, 'Identifiant d’événement déjà utilisé.');
            const effective = effectiveEvents(source, campaign);
            const effectiveIds = new Set([...eventIds, ...(campaign.customEvents ?? []).map(event => event?.id)]);
            for (const event of effective) {
                if (!knownPlaceIds.has(event.placeId)) issue(`events.${event.id}.placeId`, 'Lieu inconnu.');
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

export function campaignPlaces(source, campaign) {
    const rows = (list, custom) => (Array.isArray(list) ? list : []).filter(place => hasObject(place) && typeof place.id === 'string' && typeof place.name === 'string').map(place => ({ id: place.id, name: place.name, custom }));
    return [...rows(source?.places, false), ...rows(campaign?.customPlaces, true)];
}

export function holderTally(campaign) {
    const tally = { adverse: 0, libre: 0, acquis: 0, total: 0 };
    for (const holder of Array.isArray(campaign?.holders) ? campaign.holders : []) {
        if (!hasObject(holder) || !Number.isInteger(holder.weight) || !Object.hasOwn(tally, holder.camp) || holder.camp === 'total') continue;
        tally[holder.camp] += holder.weight; tally.total += holder.weight;
    }
    return tally;
}

export function holderOfCharacter(campaign, characterId) {
    return (Array.isArray(campaign?.holders) ? campaign.holders : []).find(holder => Array.isArray(holder?.characterIds) && holder.characterIds.includes(characterId)) ?? null;
}

export function introductionsFor(campaign, characterId) {
    const all = hasObject(campaign?.introductions) ? campaign.introductions : {};
    const outgoing = Array.isArray(all[characterId]) ? all[characterId].map(({ to, condition }) => ({ to, condition })) : [];
    const incoming = [];
    for (const [from, list] of Object.entries(all)) for (const item of Array.isArray(list) ? list : []) if (item?.to === characterId) incoming.push({ from, condition: item.condition });
    return { outgoing, incoming };
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

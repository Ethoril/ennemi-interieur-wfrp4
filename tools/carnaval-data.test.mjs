import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ATTITUDES, CAMPS, campaignPlaces, effectiveEvents, eventPresences, findNextPresence, findOverlaps, holderOfCharacter, holderTally,
    initialCampaign, introductionsFor, isAt, resetEventOverride, suggestPnjMatches, validateCampaign, validateSource,
} from '../js/carnaval-model.js';
import { createCarnavalRepository } from '../js/data/carnaval-repository.js';

const clone = value => JSON.parse(JSON.stringify(value));
const source = {
    version: 1,
    days: Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `Jour ${i + 1}` })),
    places: [{ id: 'place-a', name: 'Place A' }, { id: 'place-b', name: 'Place B' }],
    characters: [{ id: 'char-a', name: 'Ada', aliases: ['Dame Ada'] }],
    events: [
        { id: 'late', day: 8, start: 1380, end: 1500, title: 'Veillée', placeId: 'place-a', kind: 'public', source: { bookPage: 154, pdfPage: 157 }, presences: [{ characterId: 'char-a', start: null, end: null, role: 'participant' }] },
        { id: 'other', day: 8, start: 1410, end: 1440, title: 'Scène', placeId: 'place-b', kind: 'secret', source: { bookPage: 154, pdfPage: 157 }, presences: [{ characterId: 'char-a', start: 1410, end: 1440, role: 'present' }] },
    ],
};

test('validates source and campaign with useful paths', () => {
    assert.equal(validateSource(source).valid, true);
    assert.equal(validateCampaign(initialCampaign()).valid, true);
    const invalid = clone(source); invalid.events[0].presences[0].role = 'spectator';
    assert.equal(validateSource(invalid).errors[0].path, 'events[0].presences[0].role');
    const badCampaign = { ...initialCampaign(), clock: { day: 9, minute: 1440 } };
    assert.equal(validateCampaign(badCampaign).valid, false);
});

test('validators fail closed on malformed collections and check campaign references', () => {
    assert.equal(validateSource({ version: 1, days: [], places: 'oops', characters: [], events: [] }).valid, false);
    const campaign = initialCampaign();
    campaign.links.unknown = 'pnj-1';
    campaign.overrides.unknown = { start: 'soon' };
    campaign.customEvents.push({ id: 'custom', day: 1, start: 90, end: 60, title: 'Scene', placeId: 'missing', kind: 'public', source: null, presences: [] });
    const checked = validateCampaign(campaign, source);
    assert.equal(checked.valid, false);
    assert.ok(checked.errors.some(item => item.message.includes('Personnage du calendrier')));
    assert.ok(checked.errors.some(item => item.message.includes('Événement source inconnu')));
    const invalidInterval = initialCampaign(); invalidInterval.overrides.other = { start: 1450 };
    assert.ok(validateCampaign(invalidInterval, source).errors.some(item => item.message.includes('Créneau effectif invalide')));
    const nullCollections = initialCampaign(); nullCollections.overrides = { late: { presences: {} } };
    assert.equal(validateCampaign(nullCollections, source).valid, false);
    const custom = { version: 1, revision: 0, clock: { day: 8, minute: 1500 }, links: {}, overrides: {}, notes: {}, customEvents: [
        { id: 'new', day: 8, start: 1380, end: 1500, title: 'Veillée', placeId: 'place-a', kind: 'public', source: null, presences: [] },
    ] };
    assert.equal(validateCampaign(custom, source).valid, true);
});

test('handles inferred presence and crossing midnight as ordered time', () => {
    const campaign = initialCampaign();
    const events = effectiveEvents(source, campaign);
    assert.equal(events[0].id, 'late');
    assert.deepEqual(eventPresences(events[0])[0], { characterId: 'char-a', start: 1380, end: 1500, role: 'participant', inferred: true, milestone: false });
    assert.equal(isAt(events[0], { day: 8, minute: 1439 }), true);
    assert.equal(isAt(events[0], { day: 8, minute: 1500 }), false);
    assert.equal(isAt(events[0], { day: 9, minute: 30 }), true);
});

test('supports unknown secret times and exact-time milestones without inventing intervals', () => {
    const privateSource = clone(source);
    privateSource.events = [
        { id: 'milestone', day: 8, start: 1470, end: null, title: 'Retour nocturne', placeId: 'place-a', kind: 'secret', source: { bookPage: 101, pdfPage: 104 }, presences: [{ characterId: 'char-a', start: 1470, end: null, role: 'present' }] },
        { id: 'untimed', day: 8, start: null, end: null, title: 'Fuite', placeId: 'place-b', kind: 'secret', source: { bookPage: 103, pdfPage: 106 }, presences: [{ characterId: 'char-a', start: null, end: null, role: 'present' }] },
    ];
    assert.equal(validateSource(privateSource).valid, true);
    const events = effectiveEvents(privateSource, initialCampaign());
    assert.deepEqual(events.map(event => event.id), ['milestone', 'untimed']);
    assert.equal(isAt(events[0], { day: 8, minute: 1470 }), true);
    assert.equal(isAt(events[0], { day: 8, minute: 1471 }), false);
    assert.equal(isAt(events[1], { day: 8, minute: 1470 }), false);
    const milestone = findNextPresence(events, 'char-a', { day: 8, minute: 1460 });
    assert.equal(milestone.event.id, 'milestone');
    assert.equal(milestone.presence.milestone, true);
    assert.equal(findNextPresence(events, 'char-a', { day: 8, minute: 1471 }), null);
    assert.deepEqual(findOverlaps(events), []);
});

test('warns when an explicit presence exceeds known event bounds', () => {
    const campaign = initialCampaign();
    campaign.overrides.late = { presences: [{ characterId: 'char-a', start: 1370, end: 1510, role: 'present' }] };
    const checked = validateCampaign(campaign, source);
    assert.equal(checked.valid, true);
    assert.equal(checked.warnings.length, 1);
});

test('prioritizes an active presence and detects only conflicting places', () => {
    const next = findNextPresence(effectiveEvents(source, initialCampaign()), 'char-a', { day: 8, minute: 1420 });
    assert.equal(next.event.id, 'late');
    const overlaps = findOverlaps(effectiveEvents(source, initialCampaign()));
    assert.equal(overlaps.length, 1);
    assert.equal(overlaps[0].characterId, 'char-a');
    assert.equal(overlaps[0].first.event.id, 'late');
    assert.equal(overlaps[0].overlapStart, 8 * 1440 - 1440 + 1410);
});

test('resetting an override preserves scene notes', () => {
    const campaign = initialCampaign();
    campaign.overrides.late = { title: 'Modifié' };
    campaign.notes.late = 'À conserver';
    const reset = resetEventOverride(campaign, 'late');
    assert.equal(reset.overrides.late, undefined);
    assert.equal(reset.notes.late, 'À conserver');
    assert.notEqual(reset, campaign);
});

test('partial adaptations validate the resulting interval and reject duplicate presences', () => {
    const campaign = initialCampaign();
    campaign.overrides.late = { start: 1600 };
    assert.equal(validateCampaign(campaign, source).valid, false);
    campaign.overrides.late = { presences: [source.events[0].presences[0], source.events[0].presences[0]] };
    assert.equal(validateCampaign(campaign, source).valid, false);
    campaign.overrides.late = { cancelled: true };
    campaign.notes.late = 'Note préservée';
    assert.equal(effectiveEvents(source, campaign).some(event => event.id === 'late'), false);
    assert.equal(validateCampaign(campaign, source).valid, true);
    campaign.overrides.late.cancelled = false;
    assert.equal(effectiveEvents(source, campaign).find(event => event.id === 'late').start, 1380);
    assert.equal(campaign.notes.late, 'Note préservée');
});

test('malformed campaign values produce validation results without throwing', () => {
    for (const value of [null, [], 'string', 0, { ...initialCampaign(), overrides: [null] },
        { ...initialCampaign(), notes: 'oops' }, { ...initialCampaign(), customEvents: [null] },
        { ...initialCampaign(), clock: { day: 1, minute: 480, extra: true } }]) {
        const checked = validateCampaign(value, source);
        assert.equal(checked.valid, false);
        assert.ok(checked.errors.length > 0);
    }
});

test('suggests PNJ by normalized names and aliases', () => {
    const matches = suggestPnjMatches(source.characters[0], [{ id: 'p1', nom: 'Ada' }, { id: 'p2', nom: 'Dame Éda' }, { id: 'p3', nom: 'Karl' }]);
    assert.equal(matches[0].pnj.id, 'p1');
    assert.equal(matches[0].score, 1);
    assert.equal(matches.some(match => match.pnj.id === 'p3'), false);
});

function makeRepository(initial = {}, fromCache = false) {
    const documents = new Map(Object.entries(initial));
    const listeners = new Map();
    const db = {};
    const sdk = {
        doc: (_db, collection, id) => `${collection}/${id}`,
        serverTimestamp: () => ({ server: true }),
        onSnapshot: (ref, _options, next) => { listeners.set(ref, next); next({ exists: () => documents.has(ref), data: () => documents.get(ref), metadata: { fromCache } }); return () => listeners.delete(ref); },
        runTransaction: async (_db, callback) => callback({
            get: async ref => ({ exists: () => documents.has(ref), data: () => documents.get(ref), metadata: { fromCache: false } }),
            set: (ref, data) => { documents.set(ref, data); listeners.get(ref)?.({ exists: () => true, data: () => data, metadata: { fromCache: false } }); },
        }),
    };
    return { documents, listeners, repo: createCarnavalRepository({ sdk, client: { db, isGM: true } }), emit: (ref, metadata = {}) => listeners.get(ref)?.({ exists: () => documents.has(ref), data: () => documents.get(ref), metadata }) };
}

test('repository imports once and revision conflicts do not overwrite', async () => {
    const { documents, repo } = makeRepository();
    assert.deepEqual(await repo.importSource(source), { imported: true, version: 1 });
    await assert.rejects(repo.importSource(source), error => error.code === 'source-exists');
    const campaign = initialCampaign(); campaign.clock.minute = 600;
    const saved = await repo.saveCampaign(campaign, { expectedRevision: 0 });
    assert.equal(saved.revision, 1);
    assert.equal(documents.get('carnaval_campaigns/current').clock.minute, 600);
    await assert.rejects(repo.saveCampaign(campaign, { expectedRevision: 0 }), error => error.code === 'revision-conflict' && error.latest.revision === 1);
    repo.close();
});

test('repository refuses non-MJ construction and cache-only reads', () => {
    assert.throws(() => createCarnavalRepository({ sdk: {}, client: { db: {}, isGM: false } }), error => error.code === 'permission-denied');
    const { repo } = makeRepository({}, true);
    let observedError;
    const unsubscribe = repo.subscribeSource(() => assert.fail('cache data must not be emitted'), error => { observedError = error; });
    unsubscribe(); repo.close();
    assert.equal(observedError?.code, 'cache-only');
});

test('repository waits for a server-confirmed snapshot after cache or pending writes', () => {
    const { repo, emit } = makeRepository({ 'carnaval_sources/current': source }, true);
    let dataCalls = 0; let errors = 0;
    const unsubscribe = repo.subscribeSource(() => { dataCalls += 1; }, () => { errors += 1; });
    assert.equal(dataCalls, 0);
    assert.equal(errors, 1);
    emit('carnaval_sources/current', { fromCache: false, hasPendingWrites: true });
    assert.equal(dataCalls, 0);
    emit('carnaval_sources/current', { fromCache: false, hasPendingWrites: false });
    assert.equal(dataCalls, 1);
    unsubscribe(); repo.close();
});

const withPlaces = customPlaces => ({ ...initialCampaign(), customPlaces });
const rdv = (extra = {}) => ({ id: 'rdv', day: 8, start: 1400, end: null, title: 'Rendez-vous', placeId: 'place-a', kind: 'rendezvous', source: null, presences: [{ characterId: 'char-a', start: null, end: null, role: 'present' }], ...extra });
const withEvent = event => ({ ...initialCampaign(), customEvents: [event] });

test('customPlaces valides acceptés, absents tolérés', () => {
    assert.equal(validateCampaign(withPlaces([{ id: 'lieu-1', name: 'Ruelle' }]), source).valid, true);
    assert.equal(validateCampaign(withPlaces([])).valid, true);
});

test('customPlaces invalides refusés', () => {
    const bad = [
        ['pas un tableau', 'oops'],
        ['plus de 50', Array.from({ length: 51 }, (_, i) => ({ id: `l${i}`, name: 'L' }))],
        ['identifiant invalide', [{ id: 'a b', name: 'L' }]],
        ['identifiant en double', [{ id: 'l1', name: 'L' }, { id: 'l1', name: 'M' }]],
        ['nom vide', [{ id: 'l1', name: '  ' }]],
        ['nom trop long', [{ id: 'l1', name: 'x'.repeat(201) }]],
        ['clé supplémentaire', [{ id: 'l1', name: 'L', extra: 1 }]],
    ];
    for (const [label, value] of bad) assert.equal(validateCampaign(withPlaces(value), source).valid, false, label);
    assert.equal(validateCampaign(withPlaces(Array.from({ length: 50 }, (_, i) => ({ id: `l${i}`, name: 'L' }))), source).valid, true);
    const taken = validateCampaign(withPlaces([{ id: 'place-a', name: 'Doublon' }]), source);
    assert.equal(taken.valid, false);
    assert.ok(taken.errors.some(item => item.path.startsWith('customPlaces')));
});

test('scène ajoutée : lieu de customPlaces accepté, lieu inconnu refusé', () => {
    const scene = placeId => ({ id: 'new', day: 1, start: 60, end: 90, title: 'Scène', placeId, kind: 'secret', source: null, presences: [] });
    const campaign = { ...withEvent(scene('lieu-1')), customPlaces: [{ id: 'lieu-1', name: 'Ruelle' }] };
    assert.equal(validateCampaign(campaign, source).valid, true);
    const unknown = validateCampaign({ ...campaign, customPlaces: [] }, source);
    assert.equal(unknown.valid, false);
    assert.ok(unknown.errors.some(item => item.message === 'Lieu inconnu.'));
});

test('rendez-vous : règles de validation', () => {
    assert.equal(validateCampaign(withEvent(rdv()), source).valid, true);
    assert.equal(validateCampaign(withEvent(rdv({ end: 1450 })), source).valid, true);
    assert.equal(validateCampaign(withEvent(rdv({ start: null })), source).valid, false);
    const noStart = rdv(); delete noStart.start;
    assert.equal(validateCampaign(withEvent(noStart), source).valid, false);
    assert.equal(validateCampaign(withEvent(rdv({ end: 1400 })), source).valid, false);
    assert.equal(validateCampaign(withEvent(rdv({ end: 1300 })), source).valid, false);
    const override = initialCampaign(); override.overrides.late = { kind: 'rendezvous' };
    assert.equal(validateCampaign(override, source).valid, false);
    const badSource = clone(source); badSource.events[1].kind = 'rendezvous';
    assert.equal(validateSource(badSource).valid, false);
});

test('campaignPlaces : source puis lieux ajoutés, entrées absentes tolérées', () => {
    const campaign = withPlaces([{ id: 'lieu-1', name: 'Ruelle' }, { id: 'lieu-2', name: 'Quai' }]);
    assert.deepEqual(campaignPlaces(source, campaign), [
        { id: 'place-a', name: 'Place A', custom: false }, { id: 'place-b', name: 'Place B', custom: false },
        { id: 'lieu-1', name: 'Ruelle', custom: true }, { id: 'lieu-2', name: 'Quai', custom: true },
    ]);
    assert.deepEqual(campaignPlaces(source, initialCampaign()).map(p => p.custom), [false, false]);
    assert.deepEqual(campaignPlaces(null, withPlaces([{ id: 'l', name: 'L' }])), [{ id: 'l', name: 'L', custom: true }]);
    assert.deepEqual(campaignPlaces(null, null), []);
    assert.deepEqual(campaignPlaces(undefined, undefined), []);
    assert.deepEqual(campaignPlaces({ places: 'oops' }, { customPlaces: 3 }), []);
});

test('rendez-vous : prochaine présence et chevauchements', () => {
    const events = effectiveEvents(source, withEvent(rdv({ start: 1300 })));
    const next = findNextPresence(events, 'char-a', { day: 8, minute: 1290 });
    assert.equal(next.event.id, 'rdv');
    assert.equal(next.presence.milestone, true);
    const conflict = findOverlaps(effectiveEvents(source, withEvent(rdv({ end: 1450, placeId: 'place-b' }))));
    assert.ok(conflict.some(item => [item.first.event.id, item.second.event.id].includes('rdv')));
});

const trio = clone(source);
trio.characters = ['c1', 'c2', 'c3', 'c4'].map(id => ({ id, name: `Perso ${id}`, aliases: [] }));
trio.events = [];
const holder = (extra = {}) => ({ id: 'h1', label: 'Voix 1', weight: 2, camp: 'libre', characterIds: ['c1'], changedAt: null, ...extra });
const track = (extra = {}) => ({ met: null, attitude: null, note: '', ...extra });
const withField = (key, value) => ({ ...initialCampaign(), [key]: value });
const full = () => ({
    ...initialCampaign(),
    holders: [holder({ changedAt: { day: 2, minute: 600 } }), holder({ id: 'h2', characterIds: ['c2', 'c3'], camp: 'adverse' })],
    tracking: { c1: track({ met: { day: 1, minute: 480 }, attitude: 'hostile', note: 'Méfiant' }), c2: track() },
    introductions: { c1: [{ to: 'c2', condition: 'Au bal' }, { to: 'c3', condition: '' }] },
});

test('suivi : constantes CAMPS et ATTITUDES', () => {
    assert.deepEqual(CAMPS.map(c => c.id), ['adverse', 'libre', 'acquis']);
    assert.deepEqual(ATTITUDES.map(c => c.id), ['hostile', 'neutre', 'favorable']);
    assert.ok(Object.isFrozen(CAMPS) && Object.isFrozen(ATTITUDES));
});

test('suivi : campagne avec les trois champs valide, sans eux valide', () => {
    assert.equal(validateCampaign(full(), trio).valid, true);
    assert.equal(validateCampaign(full()).valid, true);
    assert.equal(validateCampaign(initialCampaign(), trio).valid, true);
    assert.equal(validateCampaign(withField('holders', []), trio).valid, true);
    assert.equal(validateCampaign(withField('tracking', {}), trio).valid, true);
    assert.equal(validateCampaign(withField('introductions', {}), trio).valid, true);
});

test('holders invalides refusés', () => {
    const without = key => { const x = holder(); delete x[key]; return x; };
    const bad = [
        ['pas un tableau', 'oops'], ['objet', {}],
        ['plus de 50', Array.from({ length: 51 }, (_, i) => holder({ id: `h${i}`, characterIds: [] }))],
        ['élément non objet', [null]],
        ['clé supplémentaire', [{ ...holder(), extra: 1 }]],
        ['id manquant', [without('id')]], ['changedAt manquant', [without('changedAt')]],
        ['id invalide', [holder({ id: 'a b' })]],
        ['id en double', [holder(), holder({ characterIds: [] })]],
        ['label vide', [holder({ label: ' ' })]], ['label trop long', [holder({ label: 'x'.repeat(101) })]], ['label non texte', [holder({ label: 3 })]],
        ['poids négatif', [holder({ weight: -1 })]], ['poids 100', [holder({ weight: 100 })]], ['poids décimal', [holder({ weight: 1.5 })]], ['poids texte', [holder({ weight: '2' })]],
        ['camp inconnu', [holder({ camp: 'neutre' })]],
        ['characterIds non tableau', [holder({ characterIds: 'c1' })]],
        ['plus de 20 personnages', [holder({ characterIds: Array.from({ length: 21 }, (_, i) => `p${i}`) })]],
        ['personnage invalide', [holder({ characterIds: ['a b'] })]],
        ['personnage en double', [holder({ characterIds: ['c1', 'c1'] })]],
        ['changedAt non objet', [holder({ changedAt: 5 })]],
        ['changedAt clé en plus', [holder({ changedAt: { day: 1, minute: 0, x: 1 } })]],
        ['changedAt jour 0', [holder({ changedAt: { day: 0, minute: 0 } })]],
        ['changedAt jour 9', [holder({ changedAt: { day: 9, minute: 0 } })]],
        ['changedAt minute 1801', [holder({ changedAt: { day: 1, minute: 1801 } })]],
    ];
    for (const [label, value] of bad) assert.equal(validateCampaign(withField('holders', value), trio).valid, false, label);
    assert.equal(validateCampaign(withField('holders', Array.from({ length: 50 }, (_, i) => holder({ id: `h${i}`, characterIds: [] })))).valid, true);
    assert.equal(validateCampaign(withField('holders', [holder({ weight: 0 }), holder({ id: 'h2', weight: 99, characterIds: [], changedAt: { day: 8, minute: 1800 } })])).valid, true);
    assert.equal(validateCampaign(withField('holders', [holder({ characterIds: Array.from({ length: 20 }, (_, i) => `p${i}`) })])).valid, true);
});

test('holders : références à la source', () => {
    assert.equal(validateCampaign(withField('holders', [holder({ characterIds: ['inconnu'] })]), trio).valid, false);
    assert.equal(validateCampaign(withField('holders', [holder({ characterIds: ['inconnu'] })])).valid, true);
    assert.equal(validateCampaign(withField('holders', [holder(), holder({ id: 'h2' })]), trio).valid, false);
});

test('tracking invalide refusé', () => {
    const bad = [
        ['pas un objet', []], ['texte', 'oops'],
        ['plus de 500', Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`c${i}`, track()]))],
        ['clé invalide', { 'a b': track() }],
        ['valeur non objet', { c1: null }],
        ['clé supplémentaire', { c1: { ...track(), extra: 1 } }],
        ['met manquant', { c1: { attitude: null, note: '' } }],
        ['met clé en plus', { c1: track({ met: { day: 1, minute: 0, x: 1 } }) }],
        ['met jour 9', { c1: track({ met: { day: 9, minute: 0 } }) }],
        ['met minute invalide', { c1: track({ met: { day: 1, minute: -1 } }) }],
        ['attitude inconnue', { c1: track({ attitude: 'amical' }) }],
        ['attitude chaîne vide', { c1: track({ attitude: '' }) }],
        ['note non texte', { c1: track({ note: null }) }],
        ['note trop longue', { c1: track({ note: 'x'.repeat(501) }) }],
        ['personnage inconnu de la source', { zzz: track() }],
    ];
    for (const [label, value] of bad) assert.equal(validateCampaign(withField('tracking', value), trio).valid, false, label);
    assert.equal(validateCampaign(withField('tracking', { zzz: track() })).valid, true);
    assert.equal(validateCampaign(withField('tracking', Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, track()])))).valid, true);
    assert.equal(validateCampaign(withField('tracking', { c1: track({ note: 'x'.repeat(500), attitude: 'neutre' }) }), trio).valid, true);
});

test('introductions invalides refusées', () => {
    const intro = (to = 'c2', condition = '') => ({ to, condition });
    const bad = [
        ['pas un objet', []], ['texte', 'oops'],
        ['plus de 500', Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`c${i}`, []]))],
        ['clé invalide', { 'a b': [] }],
        ['valeur non tableau', { c1: {} }],
        ['plus de 30', { c1: Array.from({ length: 31 }, (_, i) => intro(`t${i}`)) }],
        ['élément non objet', { c1: [null] }],
        ['clé supplémentaire', { c1: [{ ...intro(), extra: 1 }] }],
        ['condition manquante', { c1: [{ to: 'c2' }] }],
        ['to invalide', { c1: [intro('a b')] }],
        ['présentation à soi-même', { c1: [intro('c1')] }],
        ['cible en double', { c1: [intro('c2'), intro('c2', 'autre')] }],
        ['condition non texte', { c1: [intro('c2', 3)] }],
        ['condition trop longue', { c1: [intro('c2', 'x'.repeat(201))] }],
        ['clé inconnue de la source', { zzz: [intro()] }],
        ['cible inconnue de la source', { c1: [intro('zzz')] }],
    ];
    for (const [label, value] of bad) assert.equal(validateCampaign(withField('introductions', value), trio).valid, false, label);
    assert.equal(validateCampaign(withField('introductions', { zzz: [intro('yyy')] })).valid, true);
    assert.equal(validateCampaign(withField('introductions', { c1: Array.from({ length: 30 }, (_, i) => intro(`t${i}`)) })).valid, true);
    assert.equal(validateCampaign(withField('introductions', { c1: [intro('c2', 'x'.repeat(200))] }), trio).valid, true);
});

test('holderTally : somme par camp, sans détenteur', () => {
    const campaign = withField('holders', [
        holder({ id: 'a', weight: 3, camp: 'adverse' }), holder({ id: 'b', weight: 2, camp: 'adverse', characterIds: ['c2'] }),
        holder({ id: 'c', weight: 4, camp: 'libre', characterIds: ['c3', 'c4'] }), holder({ id: 'd', weight: 5, camp: 'acquis', characterIds: [] }),
    ]);
    assert.deepEqual(holderTally(campaign), { adverse: 5, libre: 4, acquis: 5, total: 14 });
    const zero = { adverse: 0, libre: 0, acquis: 0, total: 0 };
    assert.deepEqual(holderTally(initialCampaign()), zero);
    assert.deepEqual(holderTally(withField('holders', [])), zero);
    assert.deepEqual(holderTally(null), zero);
    assert.deepEqual(holderTally(undefined), zero);
});

test('holderOfCharacter : trouvé et non trouvé', () => {
    const campaign = withField('holders', [holder({ id: 'a', characterIds: ['c1'] }), holder({ id: 'b', characterIds: ['c2', 'c3'] })]);
    assert.equal(holderOfCharacter(campaign, 'c3').id, 'b');
    assert.equal(holderOfCharacter(campaign, 'c1').id, 'a');
    assert.equal(holderOfCharacter(campaign, 'c4'), null);
    assert.equal(holderOfCharacter(initialCampaign(), 'c1'), null);
    assert.equal(holderOfCharacter(null, 'c1'), null);
});

test('introductionsFor : sortantes et entrantes', () => {
    const campaign = withField('introductions', {
        c1: [{ to: 'c2', condition: 'Au bal' }, { to: 'c3', condition: '' }],
        c3: [{ to: 'c2', condition: 'Sur le quai' }],
    });
    assert.deepEqual(introductionsFor(campaign, 'c1'), { outgoing: [{ to: 'c2', condition: 'Au bal' }, { to: 'c3', condition: '' }], incoming: [] });
    assert.deepEqual(introductionsFor(campaign, 'c2'), { outgoing: [], incoming: [{ from: 'c1', condition: 'Au bal' }, { from: 'c3', condition: 'Sur le quai' }] });
    assert.deepEqual(introductionsFor(campaign, 'c3'), { outgoing: [{ to: 'c2', condition: 'Sur le quai' }], incoming: [{ from: 'c1', condition: '' }] });
    assert.deepEqual(introductionsFor(campaign, 'c4'), { outgoing: [], incoming: [] });
    assert.deepEqual(introductionsFor(initialCampaign(), 'c1'), { outgoing: [], incoming: [] });
    assert.deepEqual(introductionsFor(null, 'c1'), { outgoing: [], incoming: [] });
});

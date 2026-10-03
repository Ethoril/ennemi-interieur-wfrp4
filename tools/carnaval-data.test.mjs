import test from 'node:test';
import assert from 'node:assert/strict';
import {
    effectiveEvents, eventPresences, findNextPresence, findOverlaps, initialCampaign,
    isAt, resetEventOverride, suggestPnjMatches, validateCampaign, validateSource,
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

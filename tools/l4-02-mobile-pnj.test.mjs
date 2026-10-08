import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPnjListModel, groupPnjsByLieu, matchesQuickFilter, normalizeQuickFilter, vivantKey } from '../js/mobile/pnj-list-model.js';
import { selectPnjDetailModel } from '../js/mobile/pnj-detail-model.js';
import { sanitizePreferences } from '../js/mobile/store.js';
import { mountPnjPortrait } from '../js/mobile/components/portrait.js';
import { createRouter, ROUTE_NAMES } from '../js/mobile/router.js';
import { createPnjsListView, forgetOpenedPnjCard } from '../js/mobile/views/pnjs-list.js';
import { createPnjDetailView } from '../js/mobile/views/pnj-detail.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(resolve(ROOT, path), 'utf8');

const pnj = (id, overrides = {}) => ({ id, nom: `PNJ ${id}`, visibleJoueurs: true, ...overrides });

class FakeElement {
    constructor(documentRef, tagName, { fragment = false, namespace = null } = {}) {
        this.ownerDocument = documentRef;
        this.tagName = tagName.toUpperCase();
        this.namespace = namespace;
        this.fragment = fragment;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.value = '';
        this.hidden = false;
        this.scrollTop = 0;
    }

    get childNodes() { return this.children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { this.ownerDocument.activeElement = this; }
    append(...nodes) {
        for (const node of nodes) {
            if (node?.fragment) { this.append(...node.children.splice(0)); continue; }
            node.parentNode?.removeChild(node);
            node.parentNode = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        this.append(...nodes);
    }
    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) this.children.splice(index, 1);
        node.parentNode = null;
    }
    remove() { this.parentNode?.removeChild(this); }
    contains(node) {
        for (let current = node; current; current = current.parentNode) if (current === this) return true;
        return false;
    }
    closest(selector) {
        const [, tag, key] = /^(\w+)\[data-([\w-]+)\]$/u.exec(selector) || [];
        const property = key?.replace(/-(\w)/gu, (_, letter) => letter.toUpperCase());
        for (let current = this; current; current = current.parentNode) {
            if (current.tagName === tag?.toUpperCase() && current.dataset?.[property] !== undefined) return current;
        }
        return null;
    }
    addEventListener(type, listener) {
        const list = this.listeners.get(type) || [];
        list.push(listener);
        this.listeners.set(type, list);
    }
    removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
    }
    // Propagation simplifiée : l'événement remonte aux ancêtres, comme la délégation l'attend.
    dispatch(type) {
        for (let current = this; current; current = current.parentNode) {
            for (const listener of [...(current.listeners?.get(type) || [])]) listener({ type, target: this });
        }
    }
    querySelectorAll(selector) {
        const output = [];
        const visit = node => {
            for (const child of node.children) {
                if (selector.startsWith('.') && child.className.split(/\s+/u).includes(selector.slice(1))) output.push(child);
                else if (!selector.startsWith('.') && child.tagName === selector.toUpperCase()) output.push(child);
                visit(child);
            }
        };
        visit(this);
        return output;
    }
    get text() { return this.textContent + this.children.map(child => child.text).join(''); }
}

function makeDocument({ svg = false } = {}) {
    const documentRef = {
        activeElement: null,
        createElement: tag => new FakeElement(documentRef, tag),
        createDocumentFragment: () => new FakeElement(documentRef, '#fragment', { fragment: true }),
        addEventListener() {},
        removeEventListener() {},
        defaultView: { setTimeout: () => 1, clearTimeout() {} },
    };
    if (svg) documentRef.createElementNS = (namespace, tag) => new FakeElement(documentRef, tag, { namespace });
    documentRef.body = new FakeElement(documentRef, 'body');
    documentRef.body.classList = { add() {}, remove() {} };
    return documentRef;
}

function makeStore(initial) {
    let state = initial;
    const listeners = new Set();
    return {
        getState: () => state,
        subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
        setPreferences(value) {
            state = { ...state, preferences: { ...state.preferences, ...value } };
            [...listeners].forEach(listener => listener(state));
        },
        emit(next) { state = next; [...listeners].forEach(listener => listener(state)); },
        restart() {},
    };
}

function listState(items, filters = {}) {
    return {
        resources: { pnjs: { status: 'ready', items, error: null } },
        connection: { phase: 'ready', sync: 'server', lastServerAt: 1 },
        preferences: { filters: { search: '', statut: [], groupe: [], lieu: [], ...filters } },
        error: null,
    };
}

function detailState(pnjs, relations = []) {
    return {
        generation: 1,
        resources: {
            pnjs: { status: 'ready', items: pnjs },
            relations: { status: 'ready', items: relations },
            indices: { status: 'ready', items: [] },
        },
        connection: { phase: 'ready', sync: 'server', lastServerAt: 1 },
    };
}

test('les lieux sont triés par nom plié, « Lieu inconnu » en dernier, et gardent l ordre des PNJs', () => {
    const groups = groupPnjsByLieu([
        pnj('a', { lieu: 'Übersreik' }),
        pnj('b', { lieu: '' }),
        pnj('c', { lieu: 'altdorf' }),
        pnj('d', { lieu: 'Übersreik' }),
        pnj('e'),
        pnj('f', { lieu: 'Bögenhafen' }),
    ]);
    assert.deepEqual(groups.map(group => group.label), ['altdorf', 'Bögenhafen', 'Übersreik', 'Lieu inconnu']);
    assert.deepEqual(groups.map(group => group.count), [1, 1, 2, 2]);
    assert.deepEqual(groups[2].items.map(item => item.id), ['a', 'd']);
    assert.deepEqual(groups[3].items.map(item => item.id), ['b', 'e']);
    assert.equal(groups[3].key, '');
    assert.ok(Object.isFrozen(groups[0].items));
    assert.deepEqual(groupPnjsByLieu([]), []);
});

test('la puce rapide se combine en ET avec la recherche et la feuille, et ses effectifs suivent ces critères', () => {
    const items = [
        pnj('a', { statut: 'Allié', vivant: 'oui', groupe: 'Garde', nom: 'Ada' }),
        pnj('b', { statut: 'allié', vivant: 'non', groupe: 'Garde', nom: 'Bert' }),
        pnj('c', { statut: 'Ennemi', vivant: 'non', groupe: 'Culte', nom: 'Cora' }),
        pnj('d', { statut: 'Neutre', vivant: 'inconnu', groupe: 'Garde', nom: 'Dirk' }),
        pnj('e', { statut: 'autre', groupe: 'Garde', nom: 'Emil' }),
    ];
    const model = createPnjListModel({ items });
    assert.equal(model.getState().quick, 'tous');
    assert.deepEqual(model.getState().quickCounts, { tous: 5, allie: 2, neutre: 1, ennemi: 1, decede: 2 });
    assert.equal(model.getState().criteriaActive, false);

    const allies = model.setQuick('allie');
    assert.deepEqual(allies.results.map(item => item.id), ['a', 'b']);
    assert.equal(allies.criteriaActive, true);
    assert.equal(allies.activeFilterCount, 0, 'la puce ne compte pas parmi les filtres de la feuille');

    const garde = model.setFilters({ groupe: ['Garde'] });
    assert.deepEqual(garde.results.map(item => item.id), ['a', 'b']);
    assert.deepEqual(garde.quickCounts, { tous: 4, allie: 2, neutre: 1, ennemi: 0, decede: 1 });

    const searched = model.setSearch('bert');
    assert.deepEqual(searched.results.map(item => item.id), ['b']);
    assert.equal(searched.quickCounts.allie, 1);
    assert.equal(searched.quickCounts.decede, 1);

    assert.deepEqual(model.setQuick('decede').results.map(item => item.id), ['b']);
    assert.equal(model.setQuick('inexistant').quick, 'tous');
    assert.equal(normalizeQuickFilter({ toString: () => 'allie' }), 'tous');
    assert.equal(matchesQuickFilter(null, 'ennemi'), false);
    assert.deepEqual(createPnjListModel({ items, quick: 'ennemi' }).getState().results.map(item => item.id), ['c']);
});

test('l état vital est lu sans tenir compte de la casse et ignore les valeurs hors vocabulaire', () => {
    assert.equal(vivantKey(' OUI '), 'vivant');
    assert.equal(vivantKey('non'), 'decede');
    assert.equal(vivantKey('Inconnu'), 'inconnu');
    assert.equal(vivantKey('peut-être'), '');
    assert.equal(vivantKey(null), '');
});

test('les préférences valident la puce rapide sans changer la forme historique', () => {
    const base = { version: 1, filters: { search: 'x', statut: ['Allié'] } };
    assert.equal(Object.hasOwn(sanitizePreferences(base).filters, 'quick'), false);
    assert.equal(sanitizePreferences({ ...base, filters: { ...base.filters, quick: 'decede' } }).filters.quick, 'decede');
    assert.equal(sanitizePreferences({ ...base, filters: { ...base.filters, quick: '<script>' } }).filters.quick, 'tous');
    assert.equal(sanitizePreferences({ ...base, filters: { ...base.filters, quick: ['allie'] } }).filters.quick, 'tous');
});

test('la fiche expose statut, état vital lisible, contexte, surnom et rôle', () => {
    const model = selectPnjDetailModel(detailState([pnj('a', {
        nom: 'Ada', statut: 'Allié', vivant: 'non', lieu: 'Altdorf', groupe: 'Garde', surnom: 'La Pie', role: 'Espionne',
    })]), 'a');
    assert.equal(model.statut, 'allie');
    assert.equal(model.statutLabel, 'Allié');
    assert.equal(model.vivant, 'decede');
    assert.equal(model.vivantLabel, 'Décédé');
    assert.equal(model.context, 'Garde · Altdorf');
    assert.equal(model.surnom, 'La Pie');
    assert.equal(model.role, 'Espionne');
    assert.equal(model.identity, undefined);
    const bare = selectPnjDetailModel(detailState([pnj('b', { vivant: 'oui' })]), 'b');
    assert.equal(bare.vivantLabel, 'Vivant');
    assert.equal(bare.statut, 'inconnu');
    assert.equal(bare.context, '');
});

test('les relations exposent leur sens, une phrase qui le garde et une couleur validée', () => {
    const pnjs = [pnj('g', { nom: 'Gottfried Brauer' }), pnj('c', { nom: 'Cassandre d’Azincourt' }), pnj('h', { nom: 'Hugo' })];
    const relations = [
        { id: 'gc', source: 'g', cible: 'c', label: 'doit de l’argent à', color: '#aa3300', visibleJoueurs: true },
        { id: 'hg', source: 'h', cible: 'g', label: 'protège', color: 'red;background:url(x)', visibleJoueurs: true },
        { id: 'p1', reciprocalId: 'p2', source: 'g', cible: 'h', type: 'allié', label: 'allié de', color: null, style: 'solid', visibleJoueurs: true },
        { id: 'p2', reciprocalId: 'p1', source: 'h', cible: 'g', type: 'allié', label: 'allié de', color: null, style: 'solid', visibleJoueurs: true },
    ];
    const fromG = selectPnjDetailModel(detailState(pnjs, relations), 'g').relations;
    const byId = Object.fromEntries(fromG.map(relation => [relation.id, relation]));
    assert.equal(fromG.length, 3);
    assert.equal(byId.gc.direction, 'sortante');
    assert.equal(byId.gc.sentence, 'Gottfried Brauer doit de l’argent à Cassandre d’Azincourt');
    assert.equal(byId.gc.color, '#aa3300');
    assert.equal(byId.hg.direction, 'entrante');
    assert.equal(byId.hg.sentence, 'Hugo protège Gottfried Brauer');
    assert.equal(byId.hg.color, 'var(--gold)', 'une couleur non hexadécimale retombe sur un jeton');
    const pair = fromG.find(relation => relation.direction === 'paire');
    assert.ok(pair);
    assert.equal(pair.sentence, 'Gottfried Brauer et Hugo : allié de, réciproquement');

    const fromC = selectPnjDetailModel(detailState(pnjs, relations), 'c').relations;
    assert.equal(fromC[0].direction, 'entrante');
    assert.equal(fromC[0].sentence, 'Gottfried Brauer doit de l’argent à Cassandre d’Azincourt');
});

test('la vue de fiche rend flèche muette, nom accessible orienté et couleur par propriété --rc', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(detailState([pnj('g', { nom: 'Gottfried' }), pnj('c', { nom: 'Cassandre' })], [
        { id: 'gc', source: 'g', cible: 'c', label: 'doit de l’argent à', color: '#abc', visibleJoueurs: true },
    ]));
    const view = createPnjDetailView({ container, id: 'g', store });
    const styles = [];
    const originalCreate = documentRef.createElement;
    documentRef.createElement = tag => {
        const element = originalCreate(tag);
        element.style = { setProperty: (name, value) => styles.push([name, value]) };
        return element;
    };
    view.mount();
    const link = container.querySelectorAll('.m-detail-relation')[0];
    assert.equal(link.getAttribute('aria-label'), 'Gottfried doit de l’argent à Cassandre. Ouvrir la fiche de Cassandre');
    const arrow = container.querySelectorAll('.m-detail-relation-arrow')[0];
    assert.equal(arrow.textContent, '→');
    assert.equal(arrow.getAttribute('aria-hidden'), 'true');
    assert.deepEqual(styles, [['--rc', '#abc']]);
    view.unmount();
});

test('le bandeau de fiche affiche le badge vital des seuls défunts et sorts inconnus', () => {
    for (const [vivant, expected] of [['oui', null], ['non', 'Décédé'], ['inconnu', 'Inconnu']]) {
        const documentRef = makeDocument();
        const container = new FakeElement(documentRef, 'main');
        const store = makeStore(detailState([pnj('a', { nom: 'Ada', vivant, surnom: 'Pie', groupe: 'Garde' })]));
        const view = createPnjDetailView({ container, id: 'a', store });
        view.mount();
        const badge = container.querySelectorAll('.m-detail-vital')[0];
        assert.equal(badge?.text ?? null, expected && `État vital : ${expected}`, vivant);
        if (badge) assert.equal(badge.children[0].className, 'visually-hidden', 'le préfixe n’est dit qu’au lecteur d’écran');
        assert.equal(container.querySelectorAll('.m-detail-extra')[0].textContent, '« Pie »');
        assert.equal(container.querySelectorAll('.m-detail-context')[0].textContent, 'Garde');
        assert.equal(container.querySelectorAll('.m-detail-name')[0].getAttribute('tabindex'), '-1');
        view.unmount();
    }
});

test('la fiche prête au montage confie focus et annonce au routeur, prête plus tard elle les gère', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const ready = detailState([pnj('a', { nom: 'Ada' })]);
    const announced = [];
    const view = createPnjDetailView({ container, id: 'a', store: makeStore(ready), announce: message => announced.push(message) });
    view.mount();
    assert.equal(view.focusTarget(), container.querySelectorAll('.m-detail-name')[0]);
    assert.equal(view.routeAnnouncement(), 'Fiche de Ada');
    assert.deepEqual(announced, []);
    view.unmount();
    assert.equal(view.focusTarget(), null);

    const loading = { ...ready, resources: { ...ready.resources, pnjs: { status: 'loading', items: [] } } };
    const store = makeStore(loading);
    const late = createPnjDetailView({ container, id: 'a', store, announce: message => announced.push(message) });
    late.mount();
    assert.equal(late.focusTarget(), null);
    assert.equal(late.routeAnnouncement(), null);
    store.emit(ready);
    assert.deepEqual(announced, ['Fiche de Ada']);
    assert.equal(documentRef.activeElement, container.querySelectorAll('.m-detail-name')[0]);
    store.emit(ready);
    assert.deepEqual(announced, ['Fiche de Ada'], 'une mise à jour ne réannonce pas la fiche');
    late.unmount();
});

test('le routeur transmet la vue et préfère son annonce au message générique', () => {
    const windowRef = {
        location: { hash: '#/pnjs/a' },
        history: { pushState: (_s, _t, hash) => { windowRef.location.hash = hash; }, replaceState: (_s, _t, hash) => { windowRef.location.hash = hash; } },
        addEventListener() {}, removeEventListener() {},
    };
    const announced = [];
    const seen = [];
    const router = createRouter({
        windowRef,
        announce: message => announced.push(message),
        onRoute: (route, view) => seen.push([route.name, typeof view?.mount]),
        mountRoute: route => route.name === ROUTE_NAMES.PNJ
            ? { mount() {}, unmount() {}, routeAnnouncement: () => 'Fiche de Ada' }
            : { mount() {}, unmount() {} },
    });
    router.start();
    router.navigate({ name: ROUTE_NAMES.PNJS });
    assert.deepEqual(announced, ['Fiche de Ada', 'Écran chargé.']);
    assert.deepEqual(seen, [[ROUTE_NAMES.PNJ, 'function'], [ROUTE_NAMES.PNJS, 'function']]);
    router.stop();
});

test('le portrait pose sceau et porte de Morr hors du cadre, et rien sans createElementNS', () => {
    const svgDocument = makeDocument({ svg: true });
    const container = new FakeElement(svgDocument, 'span');
    const mounted = mountPnjPortrait({ container, item: pnj('a', { nom: 'Ada' }), marks: { statut: 'Ennemi', vivant: 'non' } });
    assert.deepEqual(container.children.map(child => child.className),
        ['m-portrait-frame m-portrait-frame--decede', 'm-portrait-seal', 'm-portrait-morr']);
    // Le <title> seul nomme sceau et porte : un aria-label identique serait lu deux fois.
    const [seal, morr] = [container.children[1].children[0], container.children[2].children[0]];
    assert.equal(seal.getAttribute('aria-label'), null);
    assert.equal(seal.getAttribute('role'), 'img');
    assert.equal(seal.children[0].textContent, 'Statut : Ennemi');
    assert.equal(morr.getAttribute('aria-label'), null);
    assert.equal(morr.children[0].textContent, 'Décédé');
    mounted.dispose();
    assert.equal(container.children.length, 0);

    const unknown = new FakeElement(svgDocument, 'span');
    mountPnjPortrait({ container: unknown, item: pnj('b'), marks: { statut: 'Allié', vivant: 'inconnu' } });
    assert.deepEqual(unknown.children.map(child => child.className), ['m-portrait-frame m-portrait-frame--inconnu', 'm-portrait-seal']);

    const plain = new FakeElement(makeDocument(), 'span');
    const plainMount = mountPnjPortrait({ container: plain, item: pnj('c'), marks: { statut: 'Allié', vivant: 'non' } });
    assert.deepEqual(plain.children.map(child => child.className), ['m-portrait-frame m-portrait-frame--decede']);
    plainMount.dispose();
    assert.equal(plain.children.length, 0);
});

test('la liste groupe par lieu, garde le groupe seul en contexte et ne remplace plus le nom des cartes', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(listState([
        pnj('a', { nom: 'Ada', lieu: 'Middenheim', groupe: 'Garde', statut: 'Allié', vivant: 'oui' }),
        pnj('b', { nom: 'Bert', lieu: 'Altdorf', statut: 'Ennemi', vivant: 'non' }),
        pnj('c', { nom: 'Cora', statut: 'Neutre', vivant: 'inconnu' }),
    ]));
    const view = createPnjsListView({ container, store });
    view.mount({ signal: { aborted: false } });
    assert.deepEqual(container.querySelectorAll('.m-lieu-heading').map(heading => heading.children[0].textContent),
        ['Altdorf', 'Middenheim', 'Lieu inconnu']);
    assert.equal(container.querySelectorAll('.m-lieu-count')[0].text, '1 personnage');
    const cards = container.querySelectorAll('.m-pnj-card');
    assert.deepEqual(cards.map(card => card.dataset.pnjId), ['b', 'a', 'c']);
    assert.ok(cards.every(card => card.getAttribute('aria-label') === null));
    assert.deepEqual(container.querySelectorAll('.m-pnj-context').map(context => context.textContent), ['Groupe inconnu', 'Garde', 'Groupe inconnu']);
    assert.deepEqual(container.querySelectorAll('.m-pnj-badge').map(badge => badge.text), ['État vital : Décédé', 'État vital : Inconnu']);
    assert.match(cards[2].text, /Statut : Neutre.*État vital : Inconnu/u, 'le badge vital dit de quoi il parle');
    assert.ok(cards[0].text.includes('Statut : Ennemi'), 'le statut reste dit aux lecteurs d’écran');
    assert.equal(container.querySelectorAll('h2').filter(heading => heading.textContent === 'PNJs').length, 0);
    assert.equal(container.querySelectorAll('output')[0].textContent, '3 personnages');
    view.unmount();
});

test('les puces rapides marquent la puce active, filtrent et persistent leur choix', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(listState([
        pnj('a', { statut: 'Allié' }), pnj('b', { statut: 'Ennemi', vivant: 'non' }), pnj('c', { statut: 'Allié' }),
    ]));
    const view = createPnjsListView({ container, store });
    view.mount({ signal: { aborted: false } });
    const chips = container.querySelectorAll('.m-chip');
    assert.deepEqual(chips.map(chip => chip.dataset.quick), ['tous', 'allie', 'neutre', 'ennemi', 'decede']);
    assert.deepEqual(chips.map(chip => chip.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false', 'false']);
    assert.deepEqual(chips.map(chip => chip.children[1].textContent), ['3', '2', '0', '1', '1']);
    chips[1].children[0].dispatch('click');
    assert.equal(store.getState().preferences.filters.quick, 'allie');
    assert.equal(chips[1].getAttribute('aria-pressed'), 'true');
    assert.equal(container.querySelectorAll('.m-pnj-card').length, 2);
    assert.equal(container.querySelectorAll('output')[0].textContent, '2 sur 3 personnages');
    view.unmount();
});

test('le bouton Filtres est une icône nommée avec pastille et Nouveau PNJ reste masqué hors MJ', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(listState([pnj('a', { groupe: 'Garde' })], { groupe: ['Garde'] }));
    let session = { status: 'visitor', role: 'public' };
    const view = createPnjsListView({ container, store, onCreate: () => {}, getSession: () => session });
    view.mount({ signal: { aborted: false } });
    const button = container.querySelectorAll('.m-filter-button')[0];
    assert.equal(button.getAttribute('aria-label'), 'Filtres, 1 actifs');
    assert.equal(container.querySelectorAll('.m-filter-count')[0].textContent, '1');
    assert.equal(container.querySelectorAll('.m-create-button')[0].hidden, true);
    button.dispatch('click');
    const closeButton = documentRef.body.querySelectorAll('.m-icon-button')[0];
    closeButton.dispatch('click');
    assert.equal(documentRef.activeElement, button, 'la feuille rend le focus au bouton qui l’a ouverte');
    view.unmount();
    session = { status: 'gm', role: 'mj', user: { uid: 'gm' } };
    const gmView = createPnjsListView({ container, store, onCreate: () => {}, getSession: () => session });
    gmView.mount({ signal: { aborted: false } });
    assert.equal(container.querySelectorAll('.m-create-button')[0].hidden, false);
    gmView.unmount();
});

test('au retour à la liste, la carte ouverte reprend le focus', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(listState([pnj('a'), pnj('b')]));
    const first = createPnjsListView({ container, store });
    first.mount({ signal: { aborted: false } });
    assert.equal(first.focusTarget(), null, 'sans carte ouverte, le h1 garde le focus');
    const card = container.querySelectorAll('.m-pnj-card')[1];
    card.children[1].dispatch('click');
    first.unmount();
    const back = createPnjsListView({ container, store });
    back.mount({ signal: { aborted: false } });
    const target = back.focusTarget();
    assert.equal(target?.dataset.pnjId, 'b');
    assert.equal(back.focusTarget(), null, 'le retour de focus ne sert qu’une fois');
    back.unmount();
});

test('la carte ouverte attend les données si la liste n est pas prête, puis reprend le focus', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const ready = listState([pnj('a'), pnj('b')]);
    const store = makeStore(ready);
    const first = createPnjsListView({ container, store });
    first.mount({ signal: { aborted: false } });
    container.querySelectorAll('.m-pnj-card')[1].children[1].dispatch('click');
    first.unmount();

    const loading = { ...ready, resources: { pnjs: { status: 'loading', items: [], error: null } } };
    store.emit(loading);
    const back = createPnjsListView({ container, store });
    back.mount({ signal: { aborted: false } });
    assert.equal(back.focusTarget(), null, 'en chargement, le h1 prend le focus');
    const title = new FakeElement(documentRef, 'h1');
    title.id = 'm-title';
    title.focus();
    store.emit(ready);
    assert.equal(documentRef.activeElement?.dataset.pnjId, 'b', 'la carte reprend le focus à l’arrivée des données');
    store.emit({ ...ready, resources: { pnjs: { status: 'ready', items: [pnj('a'), pnj('b'), pnj('c')], error: null } } });
    assert.equal(documentRef.activeElement?.dataset.pnjId, 'b');
    back.unmount();

    // Hors ligne puis données, alors que l'utilisateur a déjà porté le focus ailleurs : on ne le vole pas.
    const offline = { ...loading, connection: { phase: 'offline-empty' } };
    store.emit(offline);
    const again = createPnjsListView({ container, store });
    again.mount({ signal: { aborted: false } });
    again.focusTarget();
    store.emit(ready);
    container.querySelectorAll('.m-pnj-card')[0].children[1].dispatch('click');
    again.unmount();
    store.emit(offline);
    const late = createPnjsListView({ container, store });
    late.mount({ signal: { aborted: false } });
    assert.equal(late.focusTarget(), null);
    const elsewhere = new FakeElement(documentRef, 'a');
    elsewhere.focus();
    store.emit(ready);
    assert.equal(documentRef.activeElement, elsewhere);
    late.unmount();
});

test('changer de section oublie la carte ouverte : le retour aux PNJs rend le focus au h1', () => {
    const documentRef = makeDocument();
    const container = new FakeElement(documentRef, 'main');
    const store = makeStore(listState([pnj('a'), pnj('b')]));
    const first = createPnjsListView({ container, store });
    first.mount({ signal: { aborted: false } });
    container.querySelectorAll('.m-pnj-card')[1].children[1].dispatch('click');
    first.unmount();
    forgetOpenedPnjCard();
    const back = createPnjsListView({ container, store });
    back.mount({ signal: { aborted: false } });
    assert.equal(back.focusTarget(), null);
    back.unmount();
    assert.match(read('js/mobile/app.js'), /if \(section !== 'pnjs'\) forgetOpenedPnjCard\(\);/u);
});

test('une fiche s ouvre en haut de page, la liste retrouve sa position au retour', () => {
    const windowRef = {
        location: { hash: '#/pnjs' },
        history: { pushState: (_s, _t, hash) => { windowRef.location.hash = hash; }, replaceState: (_s, _t, hash) => { windowRef.location.hash = hash; } },
        addEventListener() {}, removeEventListener() {},
    };
    let mainScroll = 0;
    const seenAtRoute = [];
    const router = createRouter({
        windowRef,
        getScrollY: () => mainScroll,
        setScrollY: value => { mainScroll = value; },
        onRoute: route => seenAtRoute.push([route.name, mainScroll]),
        mountRoute: () => ({ mount() {}, unmount() {} }),
    });
    router.start();
    mainScroll = 640;
    router.navigate({ name: ROUTE_NAMES.PNJ, id: 'a' });
    mainScroll = 90;
    router.navigate({ name: ROUTE_NAMES.PNJS });
    assert.deepEqual(seenAtRoute, [[ROUTE_NAMES.PNJS, 0], [ROUTE_NAMES.PNJ, 0], [ROUTE_NAMES.PNJS, 640]]);
    router.stop();
});

test('le CSS mobile dégage les en-têtes collants, voile le nom en plein et garde le focus du site', () => {
    const css = read('css/mobile-app.css');
    const main = /\n\.m-main\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    assert.match(main, /scroll-padding-top:\s*calc\(var\(--space-md\) \+ 2 \* var\(--space-xs\) \+ 0\.78rem \* 1\.4 \+ var\(--space-sm\)\)/u);
    const heading = /\.m-screen \.m-lieu-heading\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    assert.match(heading, /padding:\s*var\(--space-xs\) 0;/u, 'scroll-padding-top suit le padding des en-têtes');
    assert.match(css, /\.m-main::before\s*\{\s*height:\s*var\(--space-md\);/u, 'l’espace haut défile sans imposer de hauteur minimale au contenu');
    assert.match(heading, /font-size:\s*0\.78rem;[\s\S]*line-height:\s*1\.4;/u);
    // Le voile doit être plein avant la ligne du nom, c'est-à-dire au plus tard à la fin du padding haut.
    const overlay = /\.m-detail-overlay\s*\{([^}]*)\}/u.exec(css)?.[1] ?? '';
    const paddingTop = Number(/padding:\s*([\d.]+)rem/u.exec(overlay)?.[1]);
    const opaqueAt = Number(/var\(--bg-darkest\)\s*([\d.]+)rem\)/u.exec(overlay)?.[1]);
    assert.ok(opaqueAt <= paddingTop, `voile plein à ${opaqueAt}rem pour un nom qui commence à ${paddingTop}rem`);
    assert.doesNotMatch(css, /\.m-form-field [^{]*:focus-visible\s*\{[^}]*outline/u, 'le formulaire garde l’indicateur de focus du site');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { FICHE_SCHEMA_VERSION } from '../js/fiche-schema.js';
import { createFicheDetailView } from '../js/mobile/views/fiche-detail.js';
import { parseRoute, ROUTE_NAMES } from '../js/mobile/router.js';

const careers = JSON.parse(readFileSync(fileURLToPath(new URL('../js/data/careers.json', import.meta.url)), 'utf8'));

class FakeElement {
    constructor(documentRef, tagName) {
        this.ownerDocument = documentRef;
        this.tagName = tagName;
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.dataset = {};
        this.className = '';
        this.textContent = '';
        this.href = '';
        this.hidden = false;
        this.disabled = false;
        this.scrollTop = 0;
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    append(...nodes) { for (const node of nodes) { node.parentNode?.removeChild(node); node.parentNode = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...nodes); }
    removeChild(node) { const index = this.children.indexOf(node); if (index >= 0) this.children.splice(index, 1); node.parentNode = null; }
    addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
    removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)); }
    dispatch(type, extra = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener({ type, target: this, preventDefault() {}, ...extra }); }
    querySelectorAll(selector) {
        const output = [];
        const visit = node => {
            for (const child of node.children) {
                if (selector.startsWith('.') && child.className.split(/\s+/u).includes(selector.slice(1))) output.push(child);
                else if (!selector.includes(':') && !selector.includes('[') && child.tagName === selector.toLowerCase()) output.push(child);
                visit(child);
            }
        };
        visit(this);
        return output;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function fakeDocument() {
    const documentRef = { createElement: tag => new FakeElement(documentRef, tag), activeElement: null };
    return documentRef;
}

function fakeWindow(hash) {
    const listeners = new Map();
    return {
        navigator: { onLine: true },
        location: { hash },
        addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) || []), listener]),
        removeEventListener: (type, listener) => listeners.set(type, (listeners.get(type) || []).filter(item => item !== listener)),
        dispatch: type => (listeners.get(type) || []).forEach(listener => listener({ type })),
        listenerCount: type => (listeners.get(type) || []).length,
    };
}

const data = () => ({
    nom: 'Ilsa Brandt', race: 'humain', carriere: 'Agitateur', rang: '1',
    carac: {}, skillsBasic: {}, skillsAdvanced: [], careers: [], talentsAcq: [], talentsAvail: [], sorts: [], prieres: [],
    xpLog: [{ id: 'g', kind: 'gain', raison: 'Test', montant: 250 }, { id: 'p', kind: 'purchase', cout: 130 }],
    customSpecs: {}, basicSpecs: {}, customTalents: {}, chosenVariants: {}, careerOverrides: {},
});

function setup({ hash = '#/fiches/test', capabilities = { role: 'joueur', characterIds: ['test'] }, user = { uid: 'u1' }, exists = true, manual = false, models = null, separateNavigation = false } = {}) {
    let emit = () => {};
    let fail = () => {};
    let release = () => {};
    const gate = manual ? new Promise(resolve => { release = resolve; }) : null;
    const documentRef = fakeDocument();
    const container = documentRef.createElement('main');
    const navigationContainer = separateNavigation ? documentRef.createElement('footer') : container;
    const windowRef = fakeWindow(hash);
    const subscriptions = new Set();
    const repository = {
        subscribe(_charId, next) {
            subscriptions.add(next);
            next(exists ? { exists: true, envelope: { schemaVersion: FICHE_SCHEMA_VERSION, revision: 1, data: data() } } : { exists: false, envelope: null });
            return () => subscriptions.delete(next);
        },
        subscribePublicCatalogue: () => () => {},
        execute: async () => { throw new Error('inattendu'); },
        ...(models ? { subscribeEquipmentModels: models.subscribe, saveEquipmentModel: models.save } : {}),
    };
    const log = { titles: [], announces: [], navigations: [], signIns: 0 };
    const view = createFicheDetailView({
        container, navigationContainer, documentRef, windowRef, route: parseRoute(hash),
        getClient: async () => ({
            watch(listener, onError) {
                emit = listener;
                fail = onError;
                if (!manual) listener({ user, capabilities });
                return () => {};
            },
        }),
        signIn: async () => { log.signIns += 1; },
        loadRuntime: async () => { await gate; return { repository }; },
        loadCatalogue: async () => ({ careers, getEngine: () => null, subscribe: () => () => {}, watch: () => () => {} }),
        setTitle: text => log.titles.push(text),
        announce: message => log.announces.push(message),
        navigate: target => log.navigations.push(target),
    });
    return { view, container, navigationContainer, windowRef, subscriptions, log, emit: value => emit(value), fail: error => fail(error), release: () => release(), capabilities, user };
}

const settle = async () => { for (let index = 0; index < 5; index += 1) await sleep(0); };
const texts = root => [root.textContent, ...root.children.flatMap(texts)].filter(Boolean);
const tabs = container => container.querySelectorAll('.m-fiche-tab');
const current = container => tabs(container).filter(link => link.getAttribute('aria-current') === 'page').map(link => link.href);

test('squelette pendant le chargement puis identité, XP libres, titre et cinq onglets', async () => {
    const { view, container, log } = setup();
    view.mount({});
    assert.ok(texts(container).includes('Chargement de la fiche'));
    await settle();
    assert.equal(container.querySelector('.m-fiche-identity-line').textContent, 'Agitateur · Pamphlétaire · Rang 1');
    assert.equal(container.querySelector('.m-fiche-xp').children[0].textContent, '120');
    assert.equal(container.querySelector('.m-fiche-xp').href, '#/fiches/test/journal');
    assert.equal(container.querySelector('nav').getAttribute('aria-label'), 'Sections de la fiche');
    assert.deepEqual(tabs(container).map(link => link.href),
        ['#/fiches/test', '#/fiches/test/aptitudes', '#/fiches/test/equipement', '#/fiches/test/carriere', '#/fiches/test/journal']);
    assert.deepEqual(current(container), ['#/fiches/test']);
    assert.equal(log.titles.at(-1), 'Ilsa Brandt');
    assert.equal(view.routeAnnouncement(), 'Fiche de Ilsa Brandt');
    view.unmount();
});

test('un lien profond ouvre l\'onglet demandé et hashchange change d\'onglet sans remonter la vue', async () => {
    const { view, container, windowRef, log } = setup({ hash: '#/fiches/test/carriere' });
    view.mount({});
    await settle();
    assert.deepEqual(current(container), ['#/fiches/test/carriere']);
    assert.equal(container.querySelector('.m-fiche-panel').children[0].textContent, 'Carrière');
    const shell = container.querySelector('.m-fiche');
    windowRef.location.hash = '#/fiches/test/journal';
    windowRef.dispatch('hashchange');
    assert.deepEqual(current(container), ['#/fiches/test/journal']);
    assert.equal(container.querySelector('.m-fiche-panel').children[0].textContent, 'Journal');
    assert.equal(container.querySelector('.m-fiche'), shell, 'le panneau est mis à jour sur place');
    assert.equal(log.announces.at(-1), 'Onglet Journal');
    windowRef.location.hash = '#/fiches/test';
    windowRef.dispatch('hashchange');
    assert.deepEqual(current(container), ['#/fiches/test']);
    windowRef.location.hash = '#/fiches/autre/aptitudes';
    windowRef.dispatch('hashchange');
    assert.deepEqual(current(container), ['#/fiches/test'], 'une autre fiche n\'est pas l\'affaire de cette vue');
    view.unmount();
});

test('fiche absente de la liste autorisée : écran « Fiche indisponible » avec retour à Mes fiches', async () => {
    const { view, container, log, subscriptions } = setup({ capabilities: { role: 'joueur', characterIds: ['wren'] } });
    view.mount({});
    await settle();
    assert.ok(texts(container).includes('Fiche indisponible'));
    assert.equal(container.querySelector('.m-fiche-tabs'), null);
    assert.equal(subscriptions.size, 0, 'aucune lecture Firestore pour une fiche interdite');
    container.querySelector('button').dispatch('click');
    assert.deepEqual(log.navigations, [{ name: ROUTE_NAMES.FICHES }]);
    view.unmount();
});

test('non connecté : invitation à se connecter', async () => {
    const { view, container, log } = setup({ user: null, capabilities: { role: 'public', characterIds: [] } });
    view.mount({});
    await settle();
    assert.ok(texts(container).includes('Connexion requise'));
    container.querySelector('button').dispatch('click');
    await settle();
    assert.equal(log.signIns, 1);
    view.unmount();
});

test('fiche non initialisée : carte d\'état sans onglets', async () => {
    const { view, container } = setup({ exists: false });
    view.mount({});
    await settle();
    assert.ok(texts(container).includes('Fiche non initialisée'));
    assert.equal(container.querySelector('.m-fiche-tabs'), null);
    view.unmount();
});

test('menu ⋯ : import caché pour un joueur, visible pour le MJ, lien vers l\'ancienne fiche', async () => {
    const player = setup();
    player.view.mount({});
    await settle();
    const dialog = player.container.querySelector('dialog');
    const buttons = dialog.querySelectorAll('button');
    const labels = buttons.map(button => button.textContent);
    assert.ok(labels.includes('Exporter la fiche'));
    assert.equal(buttons.find(button => button.textContent === 'Importer une fiche').hidden, true);
    assert.equal(dialog.querySelectorAll('a')[0].href, '../fiche.html?char=test&return=mobile');
    assert.equal(dialog.attributes.has('open'), false);
    player.view.openMenu(null);
    assert.equal(dialog.attributes.has('open'), true);
    player.view.unmount();

    const gm = setup({ capabilities: { role: 'mj', characterIds: ['test'] } });
    gm.view.mount({});
    await settle();
    assert.equal(gm.container.querySelector('dialog').querySelectorAll('button')
        .find(button => button.textContent === 'Importer une fiche').hidden, false);
    gm.view.unmount();
});

test('le démontage libère les écouteurs, l\'abonnement à la fiche et vide le conteneur', async () => {
    const { view, container, windowRef, subscriptions } = setup();
    view.mount({});
    await settle();
    assert.equal(subscriptions.size, 1);
    assert.equal(windowRef.listenerCount('hashchange'), 1);
    view.unmount();
    assert.equal(subscriptions.size, 0);
    assert.equal(windowRef.listenerCount('hashchange'), 0);
    assert.equal(windowRef.listenerCount('online'), 0);
    assert.equal(container.children.length, 0);
});

test('hors connexion : message dans la bande d\'état, retiré au retour du réseau', async () => {
    const { view, container, windowRef } = setup();
    view.mount({});
    await settle();
    const notice = container.querySelector('.m-fiche-notice');
    assert.equal(notice.hidden, true);
    windowRef.dispatch('offline');
    assert.equal(notice.textContent, 'Hors connexion.');
    assert.equal(notice.hidden, false);
    windowRef.dispatch('online');
    assert.equal(notice.hidden, true);
    view.unmount();
});

test("une erreur de vérification d'accès ne remplace pas la fiche déjà affichée", async () => {
    const { view, container, fail, emit, capabilities, user } = setup();
    view.mount({});
    await settle();
    const shell = container.querySelector('.m-fiche');
    fail({ code: 'unavailable' });
    assert.equal(container.querySelector('.m-fiche'), shell);
    emit({ user, capabilities });
    await settle();
    assert.equal(container.querySelector('.m-fiche'), shell, 'même compte : rien à recharger');
    view.unmount();
});

test("une déconnexion arrivée pendant le chargement n'ouvre pas la session de l'ancien compte", async () => {
    const { view, container, subscriptions, emit, release, capabilities, user } = setup({ manual: true });
    view.mount({});
    await settle();
    emit({ user, capabilities });
    await settle();
    emit({ user: null, capabilities: { role: 'public', characterIds: [] } });
    release();
    await settle();
    assert.equal(subscriptions.size, 0, 'aucune lecture de fiche pour un compte déconnecté');
    assert.ok(texts(container).includes('Connexion requise'));
    view.unmount();
});

test('équipement MJ : le dépôt chargé est transmis à la vue, abonnement aux modèles ouvert puis fermé', async () => {
    const calls = { subscribed: 0, stopped: 0 };
    const models = { subscribe: next => { calls.subscribed += 1; next([]); return () => { calls.stopped += 1; }; }, save: async () => {} };
    const { view, container } = setup({ hash: '#/fiches/test/equipement', capabilities: { role: 'mj', characterIds: ['test'] }, models });
    view.mount({});
    await settle();
    assert.deepEqual(current(container), ['#/fiches/test/equipement']);
    assert.equal(calls.subscribed, 1, 'les modèles MJ sont lus avec le dépôt résolu');
    view.unmount();
    assert.equal(calls.stopped, 1);
});


test('les onglets vivent hors du défilement et sont retirés à la déconnexion et au démontage', async () => {
    const f = setup({ separateNavigation: true });
    const globalNav = f.container.ownerDocument.createElement('nav');
    f.navigationContainer.append(globalNav);
    f.view.mount({});
    await settle();
    assert.equal(f.container.querySelector('.m-fiche-tabs'), null);
    assert.equal(tabs(f.navigationContainer).length, 5);
    f.windowRef.location.hash = '#/fiches/test/aptitudes';
    f.windowRef.dispatch('hashchange');
    assert.deepEqual(current(f.navigationContainer), ['#/fiches/test/aptitudes']);
    f.emit({ user: null, capabilities: { role: 'public', characterIds: [] } });
    await settle();
    assert.equal(tabs(f.navigationContainer).length, 0);
    assert.deepEqual(f.navigationContainer.children, [globalNav]);
    f.emit({ user: f.user, capabilities: f.capabilities });
    await settle();
    assert.equal(tabs(f.navigationContainer).length, 5, 'une seule barre après reconnexion');
    f.view.unmount();
    assert.deepEqual(f.navigationContainer.children, [globalNav]);
});

import { setImmediate } from 'node:timers';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { URLSearchParams } from 'node:url';
import { createLiveImages, graphStructureKey } from '../js/pnj-live-images.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function loader() {
    const requests = [];
    return { requests, load(path) {
        let resolve, reject, releases = 0;
        const release = () => { releases = 1; };
        const handle = new Promise((yes, no) => { resolve = yes; reject = no; });
        handle.release = release;
        requests.push({ path, resolve: () => resolve({ url: `blob:${path}`, release }), reject, get releases() { return releases; } });
        return handle;
    } };
}

test('le texte est disponible avec un portrait lent ; les émissions réutilisent le chargement et son URL', async () => {
    const source = loader();
    const ready = [];
    const images = createLiveImages(source.load, path => ready.push(path));
    const nodes = [{ id: 'a', nom: 'Avant', imagePath: 'portraits/a/1.jpg' }];
    images.sync(nodes);
    nodes[0].nom = 'Après';
    images.sync(nodes);
    assert.equal(nodes[0].nom, 'Après');
    assert.equal(nodes[0].imageState, 'loading');
    await flush();
    assert.equal(source.requests.length, 1);
    source.requests[0].resolve();
    await flush();
    images.sync(nodes);
    assert.equal(nodes[0].imageUrl, 'blob:portraits/a/1.jpg');
    assert.equal(source.requests.length, 1);
    assert.deepEqual(ready, ['portraits/a/1.jpg']);
    images.close();
    assert.equal(source.requests[0].releases, 1);
});

test('un portrait retiré ou remplacé en cours de chargement ne peut plus apparaître', async () => {
    const source = loader();
    const ready = [];
    const images = createLiveImages(source.load, path => ready.push(path));
    images.sync([{ imagePath: 'old' }]);
    await flush();
    const nodes = [{ imagePath: 'new' }];
    images.sync(nodes);
    await flush();
    source.requests[0].resolve();
    source.requests[1].resolve();
    await flush();
    images.sync(nodes);
    assert.deepEqual(ready, ['new']);
    assert.equal(nodes[0].imageUrl, 'blob:new');
    assert.equal(source.requests[0].releases, 1);
    images.sync([]);
    assert.equal(source.requests[1].releases, 1);
});

test('la fermeture ignore les chargements tardifs et annule ceux qui ne sont pas encore commencés', async () => {
    const source = loader();
    const ready = [];
    const images = createLiveImages(source.load, path => ready.push(path));
    images.sync([{ imagePath: 'a' }]);
    await flush();
    images.sync([{ imagePath: 'a' }, { imagePath: 'b' }]);
    images.close();
    source.requests[0].resolve();
    await flush();
    assert.equal(source.requests.length, 1);
    assert.equal(source.requests[0].releases, 1);
    assert.deepEqual(ready, []);
});

test('une erreur Storage ne bloque pas le texte ni les autres portraits', async () => {
    const source = loader();
    const images = createLiveImages(source.load, () => {});
    const nodes = [{ nom: 'Accessible', imagePath: 'denied' }, { imagePath: 'ok' }];
    images.sync(nodes);
    await flush();
    source.requests[0].reject({ cause: { code: 'storage/unauthorized' } });
    source.requests[1].resolve();
    await flush();
    images.sync(nodes);
    assert.equal(nodes[0].nom, 'Accessible');
    assert.equal(nodes[0].imageState, 'access-denied');
    assert.equal(nodes[1].imageState, 'ready');
    images.close();
});

test('la structure reste stable pour le nom, la description et les images, mais change pour les retraits et les relations', () => {
    const node = { id: 'a', nom: 'Avant', description: 'Avant', imagePath: 'old', statut: 'allié' };
    const before = graphStructureKey([node], []);
    assert.equal(graphStructureKey([{ ...node, nom: 'Après', description: 'Après', imagePath: 'new', updatedAt: 123 }], []), before);
    assert.notEqual(graphStructureKey([], []), before);
    assert.notEqual(graphStructureKey([{ ...node, statut: 'ennemi' }], []), before);
    assert.notEqual(graphStructureKey([node], [{ source: 'a', cible: 'b' }]), before);
    assert.equal(graphStructureKey([node, { id: 'b' }], []), graphStructureKey([{ id: 'b' }, node], []));
});

async function pageHarness() {
    const source = await readFile('js/pnjs.js', 'utf8');
    const loadData = source.slice(source.indexOf('async function loadData('), source.indexOf('function refreshGraphContent('));
    const images = loader();
    const callbacks = {};
    const calls = { builds: 0, refreshes: 0, panels: [] };
    const element = { style: {}, classList: { contains: () => false }, querySelector: () => element };
    const context = {
        console, URLSearchParams, globalThis: { queueMicrotask: globalThis.queueMicrotask },
        state: { isAdmin: false, nodes: [], links: [], panelId: null, view: 'graph' },
        currentLoadId: 0, bureauGeneration: 0, liveImages: null,
        unsubscribePnjs: null, unsubscribeRelations: null, remoteCurvatures: new Map(), curvePreviews: new Map(),
        graphNodeMemory: new Map(), sharedGraphPositions: new Map(), _deepLinkHonored: false,
        bureauData: { pnjs: { subscribeVisible: next => { callbacks.pnjs = next; return () => {}; } },
            relations: { subscribeVisible: next => { callbacks.relations = next; return () => {}; }, setVisiblePnjIds: () => {} },
            images: { loadObjectUrl: images.load } },
        document: { getElementById: () => element, activeElement: { closest: () => null } },
        window: { location: { search: '' } },
        d3: { select: () => ({ remove() {} }) },
        createLiveImages, graphStructureKey,
        isCurrentLoad: (a, b) => a === b,
        repositoryPnjToPage: node => ({ ...node, imageUrl: '' }), visiblePourJoueurs: node => node.visibleJoueurs === true,
        buildGraph: () => {
            calls.builds++;
            context.state.nodeSel = {};
            // Comme forceLink, remplacer les endpoints par les objets nœuds.
            context.state.links.forEach(link => {
                link.source = context.state.nodes.find(node => node.id === link.source);
                link.target = context.state.nodes.find(node => node.id === link.target);
            });
        },
        refreshGraphContent: () => { calls.refreshes++; },
        openPanel: node => calls.panels.push(node.nom),
    };
    for (const name of ['rememberGraphNodes', 'restoreGraphNodes', 'subscribeGraphPositions', 'buildFilters',
        'updateVisibility', 'updateCurveControls', 'showPnjReadStatus', 'closePnjModal', 'closePanel', 'showPnjDeletionStatus']) context[name] = () => {};
    vm.createContext(context);
    vm.runInContext(loadData, context);
    await context.loadData({ init: true });
    return { context, callbacks, calls, images };
}

test('la page affiche les snapshots avant les images, garde les objets D3 et révoque un PNJ masqué', async () => {
    const { context, callbacks, calls, images } = await pageHarness();
    const a = { id: 'a', nom: 'Avant', visibleJoueurs: true, imagePath: 'portrait' };
    const b = { id: 'b', nom: 'Autre', visibleJoueurs: true };
    callbacks.pnjs([a, b]);
    callbacks.relations([{ id: 'ab', source: 'a', cible: 'b' }]);
    await flush();
    assert.equal(calls.builds, 1);
    assert.equal(context.state.nodes[0].nom, 'Avant');
    assert.equal(context.state.nodes[0].imageState, 'loading');
    context.state.panelId = 'a';
    const node = context.state.nodes[0];
    callbacks.pnjs([b, { ...a, nom: 'Après', description: 'Nouveau texte' }]);
    await flush();
    assert.equal(calls.builds, 1);
    assert.equal(context.state.nodes.find(item => item.id === 'a'), node);
    assert.equal(context.state.links[0].source, node);
    assert.equal(node.nom, 'Après');
    assert.equal(calls.panels.at(-1), 'Après');
    assert.equal(images.requests.length, 1);
    images.requests[0].resolve();
    await flush();
    assert.equal(node.imageState, 'ready');
    assert.equal(calls.builds, 1);
    callbacks.pnjs([b, { ...a, visibleJoueurs: false }]);
    await flush();
    assert.equal(context.state.nodes.length, 1);
    assert.equal(context.state.links.length, 0);
    assert.equal(images.requests[0].releases, 1);
    context.liveImages.close();
});

test('un snapshot ou portrait de la session précédente ne repeint pas la page', async () => {
    const { context, callbacks, calls, images } = await pageHarness();
    callbacks.pnjs([{ id: 'a', nom: 'Avant', visibleJoueurs: true, imagePath: 'portrait' }]);
    await flush();
    const refreshes = calls.refreshes;
    context.bureauGeneration++;
    context.liveImages.close();
    images.requests[0].resolve();
    callbacks.pnjs([{ id: 'a', nom: 'Obsolète', visibleJoueurs: true }]);
    await flush();
    assert.equal(context.state.nodes[0].nom, 'Avant');
    assert.equal(calls.refreshes, refreshes);
    assert.equal(calls.builds, 1);
});

test('la page conserve les abonnements après sauvegarde et précache le nouveau module', async () => {
    const page = await readFile('js/pnjs.js', 'utf8');
    const save = page.slice(page.indexOf('async function savePnj('), page.indexOf('async function deletePnj('));
    assert.doesNotMatch(save, /await loadData\(/u);
    assert.doesNotMatch(page, /await Promise\.all\(state\.nodes/u);
    assert.match(await readFile('sw.js', 'utf8'), /\.\/js\/pnj-live-images\.js/u);
});

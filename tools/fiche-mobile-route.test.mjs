import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter, documentTitleForRoute, parseRoute, routeKey, routeToHash, ROUTE_NAMES } from '../js/mobile/router.js';

test('#/fiches/<id> ouvre l\'onglet Principal, #/fiches reste la liste', () => {
    assert.deepEqual({ ...parseRoute('#/fiches') }, { name: ROUTE_NAMES.FICHES });
    assert.deepEqual({ ...parseRoute('#/fiches/test') }, { name: ROUTE_NAMES.FICHE, id: 'test', tab: 'principal' });
});

test('les cinq onglets sont reconnus, tout autre est inconnu', () => {
    for (const tab of ['principal', 'aptitudes', 'equipement', 'carriere', 'journal']) {
        assert.deepEqual({ ...parseRoute(`#/fiches/caelel/${tab}`) }, { name: ROUTE_NAMES.FICHE, id: 'caelel', tab });
    }
    for (const hash of ['#/fiches/caelel/inconnu', '#/fiches/caelel/journal/x', '#/fiches/%2e%2e/journal', '#/fiches//journal']) {
        assert.equal(parseRoute(hash).name, ROUTE_NAMES.UNKNOWN, hash);
    }
});

test('routeToHash omet l\'onglet Principal et fait l\'aller-retour', () => {
    assert.equal(routeToHash({ name: ROUTE_NAMES.FICHE, id: 'test' }), '#/fiches/test');
    assert.equal(routeToHash({ name: ROUTE_NAMES.FICHE, id: 'test', tab: 'principal' }), '#/fiches/test');
    assert.equal(routeToHash({ name: ROUTE_NAMES.FICHE, id: 'test', tab: 'carriere' }), '#/fiches/test/carriere');
    assert.equal(routeToHash({ name: ROUTE_NAMES.FICHE, id: '../x' }), '#/fiches');
    for (const tab of ['principal', 'aptitudes', 'equipement', 'carriere', 'journal']) {
        const route = parseRoute(`#/fiches/test/${tab}`);
        assert.deepEqual({ ...parseRoute(routeToHash(route)) }, { ...route });
    }
});

test('le titre du document ne contient pas l\'identifiant et l\'onglet reste hors de la clé de route', () => {
    assert.equal(documentTitleForRoute(parseRoute('#/fiches/caelel/journal')), 'Fiche — L\'Ennemi Intérieur');
    assert.equal(routeKey(parseRoute('#/fiches/caelel')), routeKey(parseRoute('#/fiches/caelel/journal')));
    assert.notEqual(routeKey(parseRoute('#/fiches/caelel')), routeKey(parseRoute('#/fiches/wren')));
});

test('back() depuis une fiche revient à la liste et changer d\'onglet ne remonte pas la vue', () => {
    const listeners = new Map();
    const windowRef = {
        location: { hash: '#/fiches/test' },
        history: {
            pushState: (_state, _title, hash) => { windowRef.location.hash = hash; },
            replaceState: (_state, _title, hash) => { windowRef.location.hash = hash; },
        },
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: type => listeners.delete(type),
    };
    const mounted = [];
    const router = createRouter({
        windowRef,
        mountRoute: route => { mounted.push(route); return { mount() {}, unmount() {} }; },
        getScrollY: () => 0,
        setScrollY: () => {},
    });
    router.start();
    windowRef.location.hash = '#/fiches/test/carriere';
    listeners.get('hashchange')();
    assert.equal(mounted.length, 1, 'même fiche, autre onglet : pas de remontage');
    router.back();
    assert.equal(windowRef.location.hash, '#/fiches');
    assert.equal(router.getRoute().name, ROUTE_NAMES.FICHES);
});

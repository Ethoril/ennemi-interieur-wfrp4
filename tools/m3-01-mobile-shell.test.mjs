import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter, parseRoute, routeKey, routeToHash, ROUTE_NAMES } from '../js/mobile/router.js';
import { createMobileSession } from '../js/mobile/session.js';
import { createDialogController, focusableElements } from '../js/mobile/ui.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('le routeur accepte uniquement les routes hash attendues', () => {
    assert.deepEqual(parseRoute('#/pnjs'), { name: ROUTE_NAMES.PNJS });
    assert.deepEqual(parseRoute('#/pnjs/gertrud_7'), { name: ROUTE_NAMES.PNJ, id: 'gertrud_7' });
    assert.deepEqual(parseRoute('#/enquetes/dossier-1'), { name: ROUTE_NAMES.ENQUETE, id: 'dossier-1' });
    assert.deepEqual(parseRoute('#/reglages'), { name: ROUTE_NAMES.REGLAGES });
    for (const hostile of [
        '#/pnjs/%E0%A4%A', '#/pnjs/a%2Fb', '#/pnjs/..', '#/pnjs/%2E%2E',
        '#/pnjs/%3Cscript%3E', '#/pnjs/id?x=1', '#/pnjs/é', '#/pnjs/a/b', '#/inconnu',
    ]) assert.equal(parseRoute(hostile).name, ROUTE_NAMES.UNKNOWN, hostile);
    assert.equal(routeToHash({ name: ROUTE_NAMES.PNJ, id: 'a-1' }), '#/pnjs/a-1');
    assert.equal(routeKey({ name: ROUTE_NAMES.PNJ, id: 'a-1' }), 'pnj-detail:a-1');
    assert.equal(routeToHash({ name: 'unknown' }), '#/pnjs');
});

test('les vues sont démontées et les positions de liste restaurées lors des transitions', () => {
    const listeners = new Map();
    const events = [];
    const windowRef = {
        location: { hash: '#/pnjs' },
        history: { pushState: (_state, _title, hash) => { windowRef.location.hash = hash; }, replaceState: (_state, _title, hash) => { windowRef.location.hash = hash; } },
        scrollY: 17,
        scrollTo: (_x, y) => { windowRef.scrollY = y; },
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
    };
    let mainScroll = 17;
    const router = createRouter({
        windowRef,
        getScrollY: () => mainScroll,
        setScrollY: value => { mainScroll = value; },
        mountRoute: route => ({
            mount: () => events.push(`mount:${routeKey(route)}`),
            unmount: () => events.push(`unmount:${routeKey(route)}`),
        }),
    });
    router.start();
    router.navigate({ name: ROUTE_NAMES.PNJ, id: 'a' });
    mainScroll = 42;
    router.navigate({ name: ROUTE_NAMES.PNJS });
    assert.deepEqual(events, ['mount:pnjs-list', 'unmount:pnjs-list', 'mount:pnj-detail:a', 'unmount:pnj-detail:a', 'mount:pnjs-list']);
    assert.equal(mainScroll, 17);
    router.back();
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJS);
    router.stop();
    assert.equal(listeners.size, 0);
});

test('un montage asynchrone obsolète ne démonte la vue qu’une seule fois', async () => {
    let resolveMount;
    let signalA;
    const events = [];
    const windowRef = {
        location: { hash: '#/pnjs' },
        history: { pushState: (_state, _title, hash) => { windowRef.location.hash = hash; } },
        addEventListener: () => {}, removeEventListener: () => {},
    };
    const router = createRouter({
        windowRef,
        mountRoute: route => {
            if (route.name !== ROUTE_NAMES.PNJ) return { mount: () => {}, unmount: () => {} };
            return {
                mount: ({ signal }) => {
                    signalA = signal;
                    return new Promise(resolve => {
                        resolveMount = () => { if (!signal.aborted) events.push('stale-side-effect'); resolve(); };
                    });
                },
                unmount: () => events.push('unmount-a'),
            };
        },
    });
    router.start();
    router.navigate({ name: ROUTE_NAMES.PNJ, id: 'a' });
    router.render('#/pnjs/a');
    assert.equal(signalA.aborted, false, 'une émission identique ne doit pas annuler la vue');
    router.navigate({ name: ROUTE_NAMES.PNJS });
    assert.equal(signalA.aborted, true);
    resolveMount();
    await Promise.resolve();
    assert.deepEqual(events, ['unmount-a']);
});

test('le retour contextuel remplace le détail et ne le rouvre pas avec Précédent', () => {
    const listeners = new Map();
    const entries = ['#/pnjs'];
    let entryIndex = 0;
    const calls = { push: 0, replace: 0 };
    const windowRef = {
        location: { hash: entries[0] },
        history: {
            pushState: (_state, _title, hash) => { calls.push += 1; entries.splice(++entryIndex); entries.push(hash); windowRef.location.hash = hash; },
            replaceState: (_state, _title, hash) => { calls.replace += 1; entries[entryIndex] = hash; windowRef.location.hash = hash; },
            back: () => { if (entryIndex > 0) { entryIndex -= 1; windowRef.location.hash = entries[entryIndex]; listeners.get('hashchange')?.(); } },
        },
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
    };
    const router = createRouter({ windowRef, mountRoute: () => ({ mount() {}, unmount() {} }) });
    router.start();
    router.navigate({ name: ROUTE_NAMES.PNJ, id: 'a' });
    assert.equal(calls.push, 1);
    router.back();
    assert.equal(calls.replace, 1);
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJS);
    windowRef.history.back();
    assert.equal(router.getRoute().name, ROUTE_NAMES.PNJS);
});

test('la session de coque est neutre et se ferme sans Firebase', () => {
    const states = [];
    const session = createMobileSession({ onChange: state => states.push(state) });
    session.setState({ status: 'authenticated', role: 'mj', user: { id: 'test' } });
    assert.equal(session.getState().role, 'mj');
    session.stop();
    session.setState({ status: 'anonymous', role: 'public' });
    assert.equal(states.length, 1);
});

test('la coque mobile reste autonome, accessible et sans accès Firebase direct', () => {
    const html = read('app/index.html');
    const css = read('css/mobile-app.css');
    assert.ok(fs.existsSync(path.join(root, 'js/mobile/app.js')));
    assert.ok(fs.existsSync(path.join(root, 'js/mobile/router.js')));
    assert.ok(fs.existsSync(path.join(root, 'js/mobile/session.js')));
    assert.ok(fs.existsSync(path.join(root, 'js/mobile/ui.js')));
    assert.match(html, /viewport-fit=cover/u);
    assert.match(html, /script-src 'self'/u);
    assert.match(html, /style-src 'self'/u);
    assert.match(html, /aria-live="polite"/u);
    assert.match(html, /m-bottom-nav/u);
    assert.match(html, /rel="manifest" href="\.\.\/manifest\.json"/u);
    assert.doesNotMatch(html, /cdn/iu);
    assert.match(css, /--m-touch-target:\s*2\.75rem/u);
    assert.match(css, /safe-area-inset-(?:top|bottom)/u);
    assert.match(css, /prefers-reduced-motion/u);
    assert.match(css, /\.m-scroll-locked \.m-main\s*\{[^}]*overflow:\s*hidden/isu);
    assert.match(read('js/mobile/app.js'), /container\.scrollTop/u);
    assert.doesNotMatch(read('js/mobile/app.js'), /windowRef\.(?:scrollY|scrollTo)/u);
    assert.match(read('js/mobile/app.js'), /Thème parchemin activé/u);
    assert.doesNotMatch(`${read('js/mobile/app.js')}\n${read('js/mobile/router.js')}`, /firebase|https?:\/\//iu);
    assert.doesNotMatch(read('js/mobile/views/pnj-detail.js'), /innerHTML/u);
    assert.match(read('js/mobile/app.js'), /Écran introuvable/u);
    assert.match(read('js/mobile/app.js'), /actionLabel: 'Retour'/u);
});

test('le dialogue verrouille le fond, piège le focus et restaure le déclencheur', () => {
    const trigger = { focusCalled: 0, focus() { this.focusCalled += 1; } };
    const first = { focusCalled: 0, focus() { this.focusCalled += 1; documentRef.activeElement = this; } };
    const last = { focusCalled: 0, focus() { this.focusCalled += 1; documentRef.activeElement = this; } };
    const listeners = new Map();
    const dialog = {
        open: false,
        showModal() { this.open = true; },
        close() { this.open = false; },
        querySelectorAll: () => [first, last],
    };
    const documentRef = {
        activeElement: trigger,
        body: { classList: { add() {}, remove() {} } },
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
    };
    const controller = createDialogController({ dialog, documentRef });
    assert.equal(focusableElements(dialog).length, 2);
    controller.show(trigger);
    assert.equal(first.focusCalled, 1);
    listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {}, });
    assert.equal(last.focusCalled, 1);
    controller.close();
    assert.equal(trigger.focusCalled, 1);
});

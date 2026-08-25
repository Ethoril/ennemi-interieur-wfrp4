import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPnjPortrait, ownedPortraitPath, initials } from '../js/mobile/components/portrait.js';
import { createPublicSessionComposition } from '../js/mobile/public-composition.js';

class FakeElement {
    constructor(documentRef, tagName) {
        this.ownerDocument = documentRef;
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.attributes = new Map();
        this.listeners = new Map();
        this.className = '';
        this.textContent = '';
        this.width = 0;
        this.height = 0;
        this.loading = '';
        this.decoding = '';
        this.src = '';
        this.alt = '';
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }

    append(...nodes) {
        for (const node of nodes) {
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

    addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(listener);
    }

    dispatch(type) {
        for (const listener of this.listeners.get(type) ?? []) listener({ type, target: this });
    }
}

function makeDocument() {
    const documentRef = {};
    documentRef.createElement = tagName => new FakeElement(documentRef, tagName);
    return documentRef;
}

function makeContainer() {
    const documentRef = makeDocument();
    return { container: new FakeElement(documentRef, 'div'), documentRef };
}

function deferredLoading(url = 'blob:portrait') {
    let resolve;
    let reject;
    let releases = 0;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    promise.release = () => { releases += 1; };
    return { promise, resolve, reject, get releases() { return releases; } };
}

function publicItem(id, name = 'Agnès du Lac', image = { path: `portraits/${id}/portrait.webp` }) {
    return { id, nom: name, image };
}

test('le portrait accepte uniquement le chemin protégé du propriétaire', () => {
    const valid = publicItem('agnes_1');
    assert.equal(ownedPortraitPath(valid), 'portraits/agnes_1/portrait.webp');
    for (const item of [
        { ...valid, image: { path: 'https://example.test/portrait.webp' } },
        { ...valid, image: { path: 'gs://bucket/portrait.webp' } },
        { ...valid, image: { path: 'portraits/autre/portrait.webp' } },
        { ...valid, image: { path: 'portraits/agnes_1/../portrait.webp' } },
        { ...valid, image: { path: 'portraits/agnes_1/portrait.webp', legacy: true } },
        { ...valid, image: { path: 'portraits/agnes_1/portrait.webp', invalid: true } },
    ]) assert.equal(ownedPortraitPath(item), null);

    const { container } = makeContainer();
    let calls = 0;
    mountPnjPortrait({
        container,
        item: { ...valid, image: { path: 'portraits/autre/portrait.webp' } },
        imageService: { loadObjectUrl: () => { calls += 1; } },
    });
    assert.equal(calls, 0);
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].className, 'm-portrait-frame');
    assert.equal(container.children[0].children[0].className, 'm-portrait-placeholder');
});

test('les initiales sont stables et le succès blob configure une image paresseuse', async () => {
    assert.equal(initials('Élodie von Carstein'), 'ÉV');
    assert.equal(initials(''), 'PNJ');
    const { container } = makeContainer();
    const loading = deferredLoading();
    const handle = mountPnjPortrait({
        container,
        item: publicItem('agnes_1'),
        size: 72,
        imageService: { loadObjectUrl: () => loading.promise },
    });
    loading.resolve({ url: 'blob:portrait-a', release: loading.promise.release });
    await Promise.resolve();
    const frame = container.children[0];
    assert.equal(frame.className, 'm-portrait-frame');
    assert.equal(frame.children[0].className, 'm-portrait-placeholder');
    assert.equal(frame.children[1].className, 'm-portrait-image');
    const image = frame.children[1];
    assert.equal(image.src, 'blob:portrait-a');
    assert.equal(image.loading, 'lazy');
    assert.equal(image.decoding, 'async');
    assert.equal(image.width, 72);
    assert.equal(image.height, 72);
    assert.equal(image.alt, '');
    assert.equal(typeof handle.dispose, 'function');
    handle.dispose();
    assert.equal(container.children.length, 0);
});

test('erreur du service, rejet image ou réponse non blob conserve le placeholder', async () => {
    for (const loadObjectUrl of [
        () => { throw new Error('storage'); },
        () => Promise.reject(new Error('image')), 
        () => Object.assign(Promise.resolve({ url: 'https://example.test/image' }), { release() {} }),
    ]) {
        const { container } = makeContainer();
        mountPnjPortrait({ container, item: publicItem('a'), imageService: { loadObjectUrl } });
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(container.children.length, 1);
        assert.equal(container.children[0].className, 'm-portrait-frame');
        assert.equal(container.children[0].children[0].className, 'm-portrait-placeholder');
    }
});

test('une erreur de chargement du blob retire l’image et conserve le placeholder', async () => {
    const { container } = makeContainer();
    const loading = deferredLoading();
    mountPnjPortrait({ container, item: publicItem('a'), imageService: { loadObjectUrl: () => loading.promise } });
    loading.resolve({ url: 'blob:broken', release: loading.promise.release });
    await Promise.resolve();
    const frame = container.children[0];
    const image = frame.children[1];
    image.dispatch('error');
    image.dispatch('error');
    assert.equal(frame.children.length, 1);
    assert.equal(frame.children[0].className, 'm-portrait-placeholder');
    assert.equal(loading.releases, 1);
});

test('dispose avant résolution empêche le src et libère exactement une fois', async () => {
    const { container } = makeContainer();
    const loading = deferredLoading();
    const mounted = mountPnjPortrait({ container, item: publicItem('a'), imageService: { loadObjectUrl: () => loading.promise } });
    mounted.dispose();
    loading.resolve({ url: 'blob:late', release: loading.promise.release });
    await Promise.resolve();
    assert.equal(loading.releases, 1);
    assert.equal(container.children.length, 0);
});

test('un ancien portrait ne peut ni effacer ni révoquer le nouveau dans le même conteneur', async () => {
    const { container } = makeContainer();
    const first = deferredLoading();
    const second = deferredLoading();
    const firstMount = mountPnjPortrait({ container, item: publicItem('a', 'Ancien'), imageService: { loadObjectUrl: () => first.promise } });
    const secondMount = mountPnjPortrait({ container, item: publicItem('b', 'Nouveau'), imageService: { loadObjectUrl: () => second.promise } });

    firstMount.dispose();
    assert.equal(container.children.length, 1, 'dispose A ne doit pas vider le placeholder de B');
    assert.equal(container.children[0].children[0].textContent, 'N');
    first.resolve({ url: 'blob:first', release: first.promise.release });
    await Promise.resolve();
    assert.equal(first.releases, 1);
    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].children[0].textContent, 'N');

    second.resolve({ url: 'blob:second', release: second.promise.release });
    await Promise.resolve();
    assert.equal(container.children[0].children[1].src, 'blob:second');
    assert.equal(second.releases, 0);
    secondMount.dispose();
    assert.equal(second.releases, 1);
});

test('la composition expose le service image public et le ferme avant le client', async () => {
    const events = [];
    const client = { storage: { id: 'public-storage' }, cache: {}, close: async () => { events.push('client-close'); } };
    const storageSdk = { ref() {}, getBlob() {} };
    const emptySubscription = () => () => {};
    const builders = {
        client: async () => client,
        pnjs: () => ({ subscribeVisible: emptySubscription }),
        relations: () => ({ subscribeVisible: emptySubscription, setVisiblePnjIds() {} }),
        indices: () => ({ subscribeDiscovered: emptySubscription }),
        images: options => {
            assert.equal(options.storage, client.storage);
            assert.equal(options.storageSdk, storageSdk);
            return { loadObjectUrl() {}, close: () => { events.push('images-close'); } };
        },
    };
    const session = createPublicSessionComposition({
        sdk: {},
        storageSdk,
        config: { projectId: 'demo' },
        builders,
        options: { navigatorRef: { onLine: true } },
    });
    await session.start();
    assert.equal(typeof session.getImages().loadObjectUrl, 'function');
    await session.stop();
    assert.deepEqual(events, ['images-close', 'client-close']);
    assert.equal(session.getImages(), null);
});

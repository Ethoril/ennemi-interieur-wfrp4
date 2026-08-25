import { mountIndiceImage } from '../components/indice-image.js';
import { selectEnqueteDetailModel } from '../enquete-detail-model.js';
import { publicStatusMessage, renderState } from '../ui.js';

function appendText(documentRef, parent, tag, className, value) {
    const element = documentRef.createElement(tag);
    element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
}

function makeRefs(documentRef, content) {
    const hero = documentRef.createElement('section');
    hero.className = 'm-detail-hero m-enquete-hero';
    const imageTarget = documentRef.createElement('span');
    imageTarget.className = 'm-enquete-illustration';
    const title = documentRef.createElement('h2');
    title.className = 'm-detail-name';
    hero.append(imageTarget, title);

    const description = documentRef.createElement('section');
    description.className = 'm-detail-section';
    const descriptionHeading = documentRef.createElement('h3');
    descriptionHeading.textContent = 'Description';
    const descriptionBody = documentRef.createElement('div');
    descriptionBody.className = 'm-detail-section-body';
    description.append(descriptionHeading, descriptionBody);

    const pnjs = documentRef.createElement('section');
    pnjs.className = 'm-detail-section';
    const pnjsHeading = documentRef.createElement('h3');
    pnjsHeading.textContent = 'Personnages liés';
    const pnjsBody = documentRef.createElement('div');
    pnjsBody.className = 'm-detail-section-body';
    pnjs.append(pnjsHeading, pnjsBody);

    const metadata = documentRef.createElement('div');
    metadata.className = 'm-detail-metadata';
    content.append(hero, description, pnjs, metadata);
    return { hero, imageTarget, title, descriptionBody, pnjsBody, metadata, signatures: {} };
}

function renderDescription(documentRef, body, description) {
    body.replaceChildren();
    appendText(documentRef, body, 'p', 'm-detail-description', description || 'Aucune description publique connue.');
}

function renderPnjs(documentRef, body, pnjs, onOpenPnj) {
    body.replaceChildren();
    if (!pnjs.length) {
        appendText(documentRef, body, 'p', 'm-detail-empty', 'Aucun personnage public lié.');
        return;
    }
    const list = documentRef.createElement('ul');
    list.className = 'm-detail-links';
    pnjs.forEach(pnj => {
        const item = documentRef.createElement('li');
        const link = documentRef.createElement('a');
        link.href = `#/pnjs/${encodeURIComponent(pnj.id)}`;
        link.textContent = pnj.nom;
        link.setAttribute('aria-label', `Ouvrir la fiche publique de ${pnj.nom}`);
        link.addEventListener('click', event => {
            event.preventDefault();
            onOpenPnj(pnj.id);
        });
        item.append(link);
        list.append(item);
    });
    body.append(list);
}

function renderMetadata(documentRef, metadata, state, warning) {
    metadata.replaceChildren();
    const status = publicStatusMessage(state);
    if (status) appendText(documentRef, metadata, 'p', 'm-sync-badge', status);
    if (warning) {
        const element = appendText(documentRef, metadata, 'p', 'm-inline-warning', warning);
        element.setAttribute('role', 'alert');
    }
}

function imageSignature(item) {
    const image = item.image || {};
    return `${item.id}\u001f${image.path ?? ''}\u001f${image.legacy === true}\u001f${image.invalid === true}`;
}

export function createEnqueteDetailView({
    container,
    id,
    store,
    getImageService = () => null,
    onBack = () => {},
    onRetry = () => store?.restart?.(),
    onOpenPnj = () => {},
} = {}) {
    let mounted = false;
    let content = null;
    let backButton = null;
    let unsubscribe = () => {};
    let image = null;
    let activeGeneration = null;
    let signalRef = null;
    let abortHandler = null;

    const render = state => {
        if (!mounted || signalRef?.aborted) return;
        if (typeof state?.generation === 'number') {
            if (activeGeneration !== null && state.generation < activeGeneration) return;
            activeGeneration = state.generation;
        }
        const model = selectEnqueteDetailModel(state, id);
        if (model.kind !== 'ready') {
            image?.dispose?.();
            image = null;
            content._refs = null;
            renderState(content, {
                state: model.kind === 'offline-empty' ? 'offline' : model.kind,
                title: model.kind === 'empty' ? 'Indice indisponible' : 'Enquête indisponible',
                message: model.message,
                actionLabel: model.retry ? 'Réessayer' : '',
                onAction: model.retry ? onRetry : null,
            });
            return;
        }
        const documentRef = container.ownerDocument;
        const refs = content._refs ?? makeRefs(documentRef, content);
        content._refs = refs;
        const item = model.item;
        if (refs.signatures.identity !== item.titre) {
            refs.title.textContent = item.titre;
            refs.signatures.identity = item.titre;
        }
        if (refs.signatures.description !== item.description) {
            renderDescription(documentRef, refs.descriptionBody, item.description);
            refs.signatures.description = item.description;
        }
        const pnjsSignature = JSON.stringify(item.pnjs);
        if (refs.signatures.pnjs !== pnjsSignature) {
            renderPnjs(documentRef, refs.pnjsBody, item.pnjs, onOpenPnj);
            refs.signatures.pnjs = pnjsSignature;
        }
        const metadataSignature = JSON.stringify([publicStatusMessage(state), model.warning]);
        if (refs.signatures.metadata !== metadataSignature) {
            renderMetadata(documentRef, refs.metadata, state, model.warning);
            refs.signatures.metadata = metadataSignature;
        }
        const nextImageSignature = imageSignature(item);
        if (refs.signatures.image !== nextImageSignature) {
            image?.dispose?.();
            image = mountIndiceImage({ container: refs.imageTarget, item, imageService: getImageService(), size: 240 });
            refs.signatures.image = nextImageSignature;
        }
    };

    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        signalRef = signal ?? null;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'enquete-detail';
        content = documentRef.createElement('article');
        content.className = 'm-detail-content';
        backButton = documentRef.createElement('button');
        backButton.type = 'button';
        backButton.className = 'm-button';
        backButton.textContent = 'Retour aux enquêtes';
        backButton.addEventListener('click', onBack);
        screen.append(content, backButton);
        container.append(screen);
        abortHandler = () => unmount();
        signal?.addEventListener?.('abort', abortHandler, { once: true });
        unsubscribe = store.subscribe(state => render(state));
    };

    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        unsubscribe();
        unsubscribe = () => {};
        image?.dispose?.();
        image = null;
        backButton?.removeEventListener('click', onBack);
        signalRef?.removeEventListener?.('abort', abortHandler);
        container.replaceChildren();
        content = null;
        backButton = null;
        signalRef = null;
        abortHandler = null;
        activeGeneration = null;
    };

    return Object.freeze({ mount, unmount });
}

export { selectEnqueteDetailModel };

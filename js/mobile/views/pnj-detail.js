import { mountPnjPortrait } from '../components/portrait.js';
import { selectPnjDetailModel } from '../pnj-detail-model.js';
import { renderState } from '../ui.js';

function appendText(documentRef, parent, tagName, className, value) {
    const element = documentRef.createElement(tagName);
    if (className) element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
}

function makeSection(documentRef, title, key) {
    const section = documentRef.createElement('section');
    section.className = 'm-detail-section';
    section.dataset.section = key;
    const heading = documentRef.createElement('h3');
    heading.textContent = title;
    section.append(heading);
    const body = documentRef.createElement('div');
    body.className = 'm-detail-section-body';
    section.append(body);
    return { section, body };
}

function renderIdentity(documentRef, body, model) {
    body.replaceChildren();
    if (!model.identity.length) {
        appendText(documentRef, body, 'p', 'm-detail-empty', 'Aucune information d’identification connue.');
        return;
    }
    const list = documentRef.createElement('dl');
    list.className = 'm-detail-fields';
    for (const field of model.identity) {
        const term = documentRef.createElement('dt');
        term.textContent = field.label;
        const value = documentRef.createElement('dd');
        value.textContent = field.value;
        list.append(term, value);
    }
    body.append(list);
}

function renderDescription(documentRef, body, model) {
    body.replaceChildren();
    if (!model.description) {
        appendText(documentRef, body, 'p', 'm-detail-empty', 'Aucune description publique connue.');
        return;
    }
    appendText(documentRef, body, 'p', 'm-detail-description', model.description);
}

function renderRelations(documentRef, body, model) {
    body.replaceChildren();
    if (!model.relations.length) {
        const message = model.relationsStatus === 'loading'
            ? 'Chargement des relations visibles…'
            : model.relationsStatus === 'error'
                ? 'Les relations publiques sont momentanément indisponibles.'
                : 'Aucune relation publique connue.';
        appendText(documentRef, body, 'p', 'm-detail-empty', message);
        return;
    }
    const list = documentRef.createElement('ul');
    list.className = 'm-detail-links';
    for (const relation of model.relations) {
        const item = documentRef.createElement('li');
        const link = documentRef.createElement('a');
        link.href = `#/pnjs/${encodeURIComponent(relation.otherId)}`;
        link.setAttribute('aria-label', `${relation.label} : ouvrir la fiche de ${relation.otherName}`);
        const name = documentRef.createElement('strong');
        name.textContent = relation.otherName;
        const label = documentRef.createElement('span');
        label.textContent = relation.label;
        link.append(name, label);
        item.append(link);
        list.append(item);
    }
    body.append(list);
}

function renderIndices(documentRef, body, model) {
    body.replaceChildren();
    if (!model.indices.length) {
        const message = model.indicesStatus === 'loading'
            ? 'Chargement des indices découverts…'
            : model.indicesStatus === 'error'
                ? 'Les indices découverts sont momentanément indisponibles.'
                : 'Aucun indice découvert lié à ce PNJ.';
        appendText(documentRef, body, 'p', 'm-detail-empty', message);
        return;
    }
    const list = documentRef.createElement('ul');
    list.className = 'm-detail-links';
    for (const indice of model.indices) {
        const item = documentRef.createElement('li');
        const link = documentRef.createElement('a');
        link.href = `#/enquetes/${encodeURIComponent(indice.id)}`;
        link.setAttribute('aria-label', `Ouvrir l’enquête liée « ${indice.title} »`);
        const title = documentRef.createElement('strong');
        title.textContent = indice.title;
        link.append(title);
        if (indice.description) appendText(documentRef, link, 'span', '', indice.description);
        item.append(link);
        list.append(item);
    }
    body.append(list);
}

function renderMetadata(documentRef, metadata, model) {
    metadata.replaceChildren();
    if (model.warning) {
        const warning = appendText(documentRef, metadata, 'p', 'm-inline-warning', model.warning);
        warning.setAttribute('role', 'alert');
    }
}

function renderReady({ documentRef, target, model, portrait, portraitSignature, imageService, getSession, onEdit }) {
    let refs = target._detail;
    if (!refs) {
        target.replaceChildren();
        const hero = documentRef.createElement('section');
        hero.className = 'm-detail-hero';
        const portraitTarget = documentRef.createElement('span');
        portraitTarget.className = 'm-detail-portrait';
        portraitTarget.setAttribute('role', 'img');
        const title = documentRef.createElement('h2');
        title.className = 'm-detail-name';
        hero.append(portraitTarget, title);
        target.append(hero);
        const identity = makeSection(documentRef, 'Identification', 'identity');
        const description = makeSection(documentRef, 'Description publique', 'description');
        const relations = makeSection(documentRef, 'Relations visibles', 'relations');
        const indices = makeSection(documentRef, 'Indices découverts', 'indices');
        const metadata = documentRef.createElement('div');
        metadata.className = 'm-detail-metadata';
        metadata.dataset.detailMetadata = 'true';
        target.append(identity.section, description.section, relations.section, indices.section, metadata);
        refs = { hero, portraitTarget, title, edit: null, identity: identity.body, description: description.body,
            relations: relations.body, indices: indices.body, metadata, signatures: {} };
        target._detail = refs;
    }
    const sessionState = typeof getSession === 'function' ? getSession() : getSession;
    const canEdit = typeof onEdit === 'function' && sessionState?.status === 'gm' && sessionState?.role === 'mj'
        && typeof sessionState.user?.uid === 'string' && sessionState.user.uid.length > 0;
    if (canEdit && !refs.edit) {
        refs.edit = documentRef.createElement('button');
        refs.edit.type = 'button'; refs.edit.className = 'm-button'; refs.edit.textContent = 'Modifier';
        refs.edit.addEventListener('click', onEdit);
        refs.hero.append(refs.edit);
    } else if (!canEdit && refs.edit) {
        refs.hero.removeChild(refs.edit);
        refs.edit = null;
    }
    refs.title.textContent = model.name;
    refs.portraitTarget.setAttribute('aria-label', `Portrait de ${model.name}`);
    const identitySignature = JSON.stringify(model.identity);
    if (refs.signatures.identity !== identitySignature) {
        renderIdentity(documentRef, refs.identity, model);
        refs.signatures.identity = identitySignature;
    }
    if (refs.signatures.description !== model.description) {
        renderDescription(documentRef, refs.description, model);
        refs.signatures.description = model.description;
    }
    const relationsSignature = JSON.stringify([model.relations, model.relationsStatus]);
    if (refs.signatures.relations !== relationsSignature) {
        renderRelations(documentRef, refs.relations, model);
        refs.signatures.relations = relationsSignature;
    }
    const indicesSignature = JSON.stringify([model.indices, model.indicesStatus]);
    if (refs.signatures.indices !== indicesSignature) {
        renderIndices(documentRef, refs.indices, model);
        refs.signatures.indices = indicesSignature;
    }
    const metadataSignature = JSON.stringify([model.warning]);
    if (refs.signatures.metadata !== metadataSignature) {
        renderMetadata(documentRef, refs.metadata, model);
        refs.signatures.metadata = metadataSignature;
    }
    const nextSignature = `${model.item.id}\u001f${model.name}\u001f${model.item.image?.path ?? ''}\u001f${model.item.image?.legacy ?? ''}\u001f${model.item.image?.invalid ?? ''}`;
    if (nextSignature !== portraitSignature) {
        portrait?.dispose?.();
        portrait = mountPnjPortrait({ container: refs.portraitTarget, item: model.item,
            imageService, size: 144 });
        portraitSignature = nextSignature;
    }
    return { portrait, portraitSignature };
}

export { selectPnjDetailModel };

export function createPnjDetailView({ container, id, store, onBack = () => {},
    onRetry = () => store?.restart?.(), getImageService = () => null, getSession = () => null, onEdit = null } = {}) {
    let mounted = false;
    let content = null;
    let backButton = null;
    let unsubscribe = () => {};
    let portrait = null;
    let portraitSignature = null;
    let activeGeneration = null;
    let signalRef = null;
    let abortHandler = null;

    const render = state => {
        if (!mounted || signalRef?.aborted) return;
        if (typeof state?.generation === 'number') {
            if (activeGeneration !== null && state.generation < activeGeneration) return;
            activeGeneration = state.generation;
        }
        const model = selectPnjDetailModel(state, id);
        if (model.kind !== 'ready') {
            portrait?.dispose?.();
            portrait = null;
            portraitSignature = null;
            content._detail = null;
            renderState(content, {
                state: model.kind === 'offline-empty' ? 'offline' : model.kind,
                title: model.kind === 'empty' ? 'PNJ indisponible' : 'Fiche indisponible',
                message: model.message,
                actionLabel: model.retry ? 'Réessayer' : '',
                onAction: model.retry ? onRetry : null,
            });
            return;
        }
        const next = renderReady({ documentRef: container.ownerDocument, target: content,
            model, portrait, portraitSignature, imageService: getImageService(), getSession, onEdit });
        portrait = next.portrait;
        portraitSignature = next.portraitSignature;
    };

    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        signalRef = signal ?? null;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        const screen = documentRef.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnj-detail';
        content = documentRef.createElement('article');
        content.className = 'm-detail-content';
        backButton = documentRef.createElement('button');
        backButton.type = 'button';
        backButton.className = 'm-button';
        backButton.textContent = 'Retour à la liste';
        backButton.addEventListener('click', onBack);
        screen.append(content, backButton);
        container.append(screen);
        abortHandler = () => unmount();
        signal?.addEventListener?.('abort', abortHandler, { once: true });
        unsubscribe = store.subscribe(render);
        if (signal?.aborted) unmount();
    };

    const unmount = () => {
        if (!mounted) return;
        mounted = false;
        unsubscribe();
        unsubscribe = () => {};
        portrait?.dispose?.();
        portrait = null;
        portraitSignature = null;
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

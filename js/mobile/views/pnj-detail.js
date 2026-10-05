import { createSeal } from '../../seal.js';
import { mountPnjPortrait } from '../components/portrait.js';
import { selectPnjDetailModel } from '../pnj-detail-model.js';
import { renderState } from '../ui.js';
import { mountContentTrashPanel, mountContributionButton } from '../../contributions/editor.js';

const RELATION_ARROWS = Object.freeze({ sortante: '→', entrante: '←', paire: '↔' });

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

// Le bandeau remplace l'ancienne section Identification : surnom et rôle, que
// seule cette section montrait, y tiennent sur une petite ligne.
function renderHeroInfo(documentRef, refs, model) {
    const extra = [model.surnom ? `« ${model.surnom} »` : '', model.role].filter(Boolean).join(' · ');
    refs.extra.textContent = extra;
    refs.extra.hidden = !extra;
    refs.marks.replaceChildren();
    const seal = createSeal(documentRef, model.statut, { size: 32 });
    if (seal) refs.marks.append(seal);
    // Seuls un défunt ou un sort inconnu portent un badge : « Vivant » est l'état attendu.
    const vital = model.vivant === 'decede' || model.vivant === 'inconnu';
    if (vital) {
        // Préfixe masqué, comme sur les cartes : le lecteur d'écran dit « État vital : Inconnu ».
        const badge = appendText(documentRef, refs.marks, 'span', 'm-detail-vital', '');
        appendText(documentRef, badge, 'span', 'visually-hidden', 'État vital : ');
        appendText(documentRef, badge, 'span', '', model.vivantLabel);
    }
    refs.marks.hidden = !seal && !vital;
    refs.context.textContent = model.context;
    refs.context.hidden = !model.context;
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
        link.className = 'm-detail-relation';
        link.href = `#/pnjs/${encodeURIComponent(relation.otherId)}`;
        // La flèche est muette : le nom accessible dit le sens en toutes lettres.
        link.setAttribute('aria-label', `${relation.sentence}. Ouvrir la fiche de ${relation.otherName}`);
        // Couleur déjà validée par le modèle, posée par le CSSOM (admis par la CSP style-src 'self').
        link.style?.setProperty?.('--rc', relation.color);
        const name = documentRef.createElement('strong');
        name.textContent = relation.otherName;
        const label = documentRef.createElement('span');
        label.className = 'm-detail-relation-label';
        const arrow = appendText(documentRef, label, 'span', 'm-detail-relation-arrow',
            RELATION_ARROWS[relation.direction] || RELATION_ARROWS.sortante);
        arrow.setAttribute('aria-hidden', 'true');
        appendText(documentRef, label, 'span', '', relation.label);
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

function renderReady({ documentRef, target, model, portrait, portraitSignature, imageService, getSession, onEdit, contributionClient, getContributionClient, signInContribution, announce, onContributionSaved }) {
    let refs = target._detail;
    if (!refs) {
        target.replaceChildren();
        const hero = documentRef.createElement('section');
        hero.className = 'm-detail-hero m-pnj-banner';
        const portraitTarget = documentRef.createElement('span');
        portraitTarget.className = 'm-detail-portrait';
        portraitTarget.setAttribute('role', 'img');
        const overlay = documentRef.createElement('div');
        overlay.className = 'm-detail-overlay';
        const title = documentRef.createElement('h2');
        title.className = 'm-detail-name';
        // Cible du focus à l'ouverture de la fiche, hors de l'ordre de tabulation.
        title.setAttribute('tabindex', '-1');
        const extra = documentRef.createElement('p');
        extra.className = 'm-detail-extra';
        const marks = documentRef.createElement('div');
        marks.className = 'm-detail-marks';
        const context = documentRef.createElement('p');
        context.className = 'm-detail-context';
        overlay.append(title, extra, marks, context);
        hero.append(portraitTarget, overlay);
        target.append(hero);
        const description = makeSection(documentRef, 'Description publique', 'description');
        const relations = makeSection(documentRef, 'Relations visibles', 'relations');
        const indices = makeSection(documentRef, 'Indices découverts', 'indices');
        const metadata = documentRef.createElement('div');
        metadata.className = 'm-detail-metadata';
        metadata.dataset.detailMetadata = 'true';
        target.append(description.section, relations.section, indices.section, metadata);
        refs = { hero, portraitTarget, title, extra, marks, context, edit: null, contribution: null, trash: null, description: description.body,
            relations: relations.body, indices: indices.body, metadata, signatures: {} };
        target._detail = refs;
    }
    const sessionState = typeof getSession === 'function' ? getSession() : getSession;
    const canEdit = typeof onEdit === 'function' && sessionState?.status === 'gm' && sessionState?.role === 'mj'
        && typeof sessionState.user?.uid === 'string' && sessionState.user.uid.length > 0;
    if (canEdit && !refs.edit) {
        refs.edit = documentRef.createElement('button');
        refs.edit.type = 'button'; refs.edit.className = 'm-button m-detail-edit'; refs.edit.textContent = 'Modifier';
        refs.edit.addEventListener('click', onEdit);
        refs.hero.append(refs.edit);
    } else if (!canEdit && refs.edit) {
        refs.hero.removeChild(refs.edit);
        refs.edit = null;
    }
    if ((contributionClient || getContributionClient) && !refs.contribution) {
        refs.contribution = mountContributionButton({ container: refs.hero, client: contributionClient,
            getClient: getContributionClient, signIn: signInContribution, kind: 'pnj', id: model.item.id,
            documentRef, announce, onSaved: onContributionSaved });
    }
    if ((contributionClient || getContributionClient) && !refs.trash) {
        refs.trash = mountContentTrashPanel({ container: refs.hero, client: contributionClient,
            getClient: getContributionClient, signIn: signInContribution, documentRef, announce });
    }
    refs.title.textContent = model.name;
    refs.portraitTarget.setAttribute('aria-label', `Portrait de ${model.name}`);
    const heroSignature = JSON.stringify([model.statut, model.vivant, model.vivantLabel, model.surnom, model.role, model.context]);
    if (refs.signatures.hero !== heroSignature) {
        renderHeroInfo(documentRef, refs, model);
        refs.signatures.hero = heroSignature;
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
    const nextSignature = `${model.item.id}\u001f${model.name}\u001f${model.item.vivant}\u001f${model.item.image?.path ?? ''}\u001f${model.item.image?.legacy ?? ''}\u001f${model.item.image?.invalid ?? ''}`;
    if (nextSignature !== portraitSignature) {
        portrait?.dispose?.();
        // Le sceau vit sous le nom, dans le bandeau : sur le portrait, seule la porte de Morr.
        portrait = mountPnjPortrait({ container: refs.portraitTarget, item: model.item,
            imageService, size: 480, marks: { vivant: model.item.vivant, morrSize: 30 } });
        portraitSignature = nextSignature;
    }
    return { portrait, portraitSignature };
}

export { selectPnjDetailModel };

export function createPnjDetailView({ container, id, store, onBack = () => {},
    onRetry = () => store?.restart?.(), getImageService = () => null, getSession = () => null, onEdit = null,
    contributionClient = null, getContributionClient = null, signInContribution = null, announce = () => {} } = {}) {
    let mounted = false;
    let screen = null;
    let content = null;
    let backButton = null;
    let unsubscribe = () => {};
    let portrait = null;
    let portraitSignature = null;
    let activeGeneration = null;
    let signalRef = null;
    let abortHandler = null;
    // Entrée dans la fiche : focus sur le nom et annonce « Fiche de … », une seule fois.
    // Fiche prête dès le montage : le routeur s'en charge (focusTarget, routeAnnouncement),
    // sinon il écraserait l'annonce. Prête plus tard : la vue le fait elle-même.
    let mounting = false;
    let entryPending = true;
    let entryName = '';

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
            content?._detail?.contribution?.dispose?.();
            content?._detail?.trash?.dispose?.();
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
            model, portrait, portraitSignature, imageService: getImageService(), getSession, onEdit, contributionClient, getContributionClient, signInContribution, announce,
            onContributionSaved: () => store?.restart?.() });
        portrait = next.portrait;
        portraitSignature = next.portraitSignature;
        if (entryPending) {
            entryPending = false;
            entryName = model.name;
            if (!mounting) {
                // Pas de vol de focus si l'utilisateur a déjà atteint un contrôle de l'écran.
                const active = container.ownerDocument.activeElement;
                if (!active || !screen?.contains?.(active)) content._detail.title.focus?.({ preventScroll: true });
                announce(`Fiche de ${model.name}`);
            }
        }
    };

    const mount = ({ signal } = {}) => {
        if (mounted || !container || !store || signal?.aborted) return;
        mounted = true;
        signalRef = signal ?? null;
        const documentRef = container.ownerDocument;
        container.replaceChildren();
        screen = documentRef.createElement('section');
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
        mounting = true;
        unsubscribe = store.subscribe(render);
        mounting = false;
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
        content?._detail?.contribution?.dispose?.();
        content?._detail?.trash?.dispose?.();
        backButton?.removeEventListener('click', onBack);
        signalRef?.removeEventListener?.('abort', abortHandler);
        container.replaceChildren();
        screen = null;
        content = null;
        backButton = null;
        signalRef = null;
        abortHandler = null;
        activeGeneration = null;
    };
    const enteredAtMount = () => mounted && !entryPending && Boolean(content?._detail);
    return Object.freeze({
        mount,
        unmount,
        focusTarget: () => (enteredAtMount() ? content._detail.title : null),
        routeAnnouncement: () => (enteredAtMount() ? `Fiche de ${entryName}` : null),
    });
}

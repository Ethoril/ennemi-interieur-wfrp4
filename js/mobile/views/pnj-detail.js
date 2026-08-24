import { renderState } from '../ui.js';

export function createPnjDetailView({ container, id, onBack } = {}) {
    let mounted = false;
    let backButton = null;
    const mount = ({ signal } = {}) => {
        if (mounted || !container || signal?.aborted) return;
        mounted = true;
        container.replaceChildren();
        const screen = container.ownerDocument.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnj-detail';
        const heading = container.ownerDocument.createElement('h2');
        heading.textContent = 'PNJ';
        const card = container.ownerDocument.createElement('article');
        card.className = 'm-hero-card';
        const title = container.ownerDocument.createElement('h3');
        title.textContent = id;
        const state = container.ownerDocument.createElement('div');
        renderState(state, { state: 'loading', message: 'La fiche sera connectée au prochain lot.' });
        card.append(title, state);
        backButton = container.ownerDocument.createElement('button');
        backButton.type = 'button';
        backButton.className = 'm-button';
        backButton.textContent = 'Retour à la liste';
        backButton.addEventListener('click', onBack);
        if (signal?.aborted) return;
        screen.append(heading, card, backButton);
        container.append(screen);
    };
    const unmount = () => {
        if (!mounted) return;
        container.replaceChildren();
        backButton = null;
        mounted = false;
    };
    return Object.freeze({ mount, unmount });
}

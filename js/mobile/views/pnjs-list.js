import { renderState } from '../ui.js';

export function createPnjsListView({ container } = {}) {
    let mounted = false;
    let search = null;
    const mount = ({ signal } = {}) => {
        if (mounted || !container || signal?.aborted) return;
        mounted = true;
        container.replaceChildren();
        const screen = container.ownerDocument.createElement('section');
        screen.className = 'm-screen';
        screen.dataset.view = 'pnjs-list';
        const heading = container.ownerDocument.createElement('h2');
        heading.textContent = 'PNJs';
        const label = container.ownerDocument.createElement('label');
        label.className = 'm-search';
        label.textContent = 'Rechercher un PNJ';
        search = container.ownerDocument.createElement('input');
        search.type = 'search';
        search.placeholder = 'Nom ou lieu';
        search.autocomplete = 'off';
        label.append(search);
        if (signal?.aborted) return;
        screen.append(heading, label);
        const state = container.ownerDocument.createElement('div');
        state.className = 'm-list-state';
        renderState(state, { state: 'loading', title: 'PNJs', message: 'Les données seront connectées au prochain lot.' });
        screen.append(state);
        if (!signal?.aborted) container.append(screen);
    };
    const unmount = () => {
        if (!mounted) return;
        container.replaceChildren();
        search = null;
        mounted = false;
    };
    return Object.freeze({ mount, unmount });
}

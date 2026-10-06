import { createBottomSheet } from '../components/bottom-sheet.js';
import { learnRows, spellTypes } from '../fiche-aptitudes-model.js';

// ponytail: ~290 sorts au catalogue ; au-delà de cette limite, la recherche et les puces servent à préciser (pas de défilement virtuel).
const MAX_ROWS = 40;

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Volet « Apprendre un sort / un miracle » : recherche (sans accents ni casse, chaque mot) et, pour les sorts, puces de type
 * (Petite magie, arcanes, domaines). Les sorts déjà connus ne sont pas listés. Choisir une ligne ferme le volet et appelle
 * onChoose({ kind: 'sort' | 'miracle', nom }, trigger) : l'achat se confirme dans le volet d'achat.
 * `getContext()` → { state, engine }.
 */
export function createSpellLearnSheet({ documentRef, getContext, onChoose }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-learn-title' });
    let kind = 'sort';
    let query = '';
    let type = '';
    let trigger = null;
    let nodes = null;
    let chipsBuilt = false;

    const build = body => {
        const prayer = kind === 'miracle';
        const title = make(documentRef, 'h2', prayer ? 'Apprendre un miracle' : 'Apprendre un sort', 'm-purchase-title');
        title.id = 'm-learn-title';
        title.tabIndex = -1;
        title.setAttribute('data-sheet-drag', '');
        const chips = make(documentRef, 'div', '', 'm-quick-filters');
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', 'Type de sort');
        chips.hidden = prayer;
        const label = make(documentRef, 'label', '', 'm-search');
        const search = make(documentRef, 'input');
        search.type = 'search';
        search.placeholder = prayer ? 'Rechercher un miracle' : 'Rechercher un sort';
        search.autocomplete = 'off';
        search.enterKeyHint = 'search';
        search.addEventListener('input', () => { query = search.value; renderList(); });
        label.append(make(documentRef, 'span', search.placeholder, 'visually-hidden'), search);
        const count = make(documentRef, 'output', '', 'm-result-count');
        count.setAttribute('aria-live', 'polite');
        const list = make(documentRef, 'ul', '', 'm-career-list');
        body.replaceChildren(title, label, chips, count, list);
        nodes = { chips, count, list };
        chipsBuilt = false;
        renderList();
    };

    // Choix unique : toucher la puce active la désélectionne. Les puces sont créées une fois (le focus reste sur la puce touchée).
    function renderChips(engine) {
        if (kind === 'miracle') return;
        if (!chipsBuilt) {
            chipsBuilt = true;
            nodes.chips.replaceChildren(...spellTypes(engine).map(name => {
                const chip = make(documentRef, 'button', name, 'm-chip');
                chip.type = 'button';
                chip.addEventListener('click', () => { type = type === name ? '' : name; renderList(); });
                return chip;
            }));
        }
        for (const chip of nodes.chips.children) chip.setAttribute('aria-pressed', String(chip.textContent === type));
    }

    function renderList() {
        const { state, engine } = getContext();
        renderChips(engine);
        const rows = learnRows(engine, state?.data, kind, { query, type });
        const noun = kind === 'miracle' ? 'miracle' : 'sort';
        nodes.count.textContent = rows.length > MAX_ROWS
            ? `${rows.length} ${noun}s : précisez la recherche` : `${rows.length} ${noun}${rows.length > 1 ? 's' : ''}`;
        nodes.list.replaceChildren(...rows.slice(0, MAX_ROWS).map(row => {
            const li = make(documentRef, 'li');
            const button = make(documentRef, 'button', '', 'm-apt-row');
            button.type = 'button';
            const main = make(documentRef, 'span', '', 'm-apt-main');
            main.append(make(documentRef, 'span', row.nom, 'm-apt-name'),
                make(documentRef, 'span', kind === 'miracle' ? '' : row.type, 'm-apt-detail'));
            const side = make(documentRef, 'span', '', 'm-apt-side');
            const shown = make(documentRef, 'span', Number.isNaN(row.ni) || kind === 'miracle' ? `${row.cost} XP` : `NI ${row.ni} · ${row.cost} XP`);
            shown.setAttribute('aria-hidden', 'true');
            side.append(shown, make(documentRef, 'span', `, ${row.cost} XP`, 'visually-hidden'));
            button.append(main, side);
            button.addEventListener('click', () => {
                sheet.close();
                onChoose({ kind, nom: row.nom }, trigger);
            });
            li.append(button);
            return li;
        }));
    }

    return Object.freeze({
        element: sheet.element,
        open(next, opener) {
            kind = next;
            trigger = opener;
            query = '';
            type = '';
            sheet.open({ trigger, render: build });
        },
        update() { if (sheet.isOpen()) renderList(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

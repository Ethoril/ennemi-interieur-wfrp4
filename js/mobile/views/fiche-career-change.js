import { createBottomSheet } from '../components/bottom-sheet.js';
import { careerChangeOptions, careerProgress } from '../fiche-career-model.js';

const RANKS = [1, 2, 3, 4, 5];
// ponytail: 132 carrières au catalogue ; au-delà de cette limite, la recherche sert à préciser (pas de défilement virtuel).
const MAX_ROWS = 40;

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Volet « Changer de carrière » : rang d'entrée, recherche, liste des carrières (une carrière dont le prérequis n'est pas atteint
 * reste listée, désactivée, avec sa raison). Choisir une carrière ferme le volet et appelle
 * onChoose({ kind: 'rank', rankMode: 'changeCareer', careerId, targetRank }, trigger) : l'achat se confirme dans le volet d'achat.
 * `getContext()` → { state, careers, engine }.
 */
export function createCareerChangeSheet({ documentRef, getContext, onChoose }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-career-change-title' });
    let query = '';
    let targetRank = 1;
    let trigger = null;
    let nodes = null;

    const build = body => {
        const title = make(documentRef, 'h2', 'Changer de carrière', 'm-purchase-title');
        title.id = 'm-career-change-title';
        title.tabIndex = -1;
        title.setAttribute('data-sheet-drag', '');
        const cost = make(documentRef, 'p', '', 'm-purchase-note');
        const ranks = make(documentRef, 'div', '', 'm-quick-filters');
        ranks.setAttribute('role', 'group');
        ranks.setAttribute('aria-label', 'Rang d’entrée');
        const chips = RANKS.map(rank => {
            const chip = make(documentRef, 'button', `Rang ${rank}`, 'm-chip');
            chip.type = 'button';
            chip.addEventListener('click', () => { targetRank = rank; renderList(); });
            ranks.append(chip);
            return chip;
        });
        const label = make(documentRef, 'label', '', 'm-search');
        const search = make(documentRef, 'input');
        search.type = 'search';
        search.placeholder = 'Rechercher une carrière';
        search.autocomplete = 'off';
        search.enterKeyHint = 'search';
        search.addEventListener('input', () => { query = search.value; renderList(); });
        label.append(make(documentRef, 'span', 'Rechercher une carrière', 'visually-hidden'), search);
        const count = make(documentRef, 'output', '', 'm-result-count');
        count.setAttribute('aria-live', 'polite');
        const list = make(documentRef, 'ul', '', 'm-career-list');
        body.replaceChildren(title, cost, ranks, label, count, list);
        nodes = { title, cost, chips, search, count, list };
        renderCost();
        renderList();
    };

    function renderCost() {
        const { state, careers, engine } = getContext();
        const progress = careerProgress(state?.data, engine, careers);
        nodes.cost.textContent = progress
            ? `Coût : ${progress.nextCost} XP (rang actuel ${progress.complete ? 'achevé' : 'non achevé'}).` : '';
    }

    function renderList() {
        const { state, careers } = getContext();
        const options = careerChangeOptions(state?.data, careers, { query, targetRank });
        nodes.chips.forEach((chip, index) => chip.setAttribute('aria-pressed', String(RANKS[index] === targetRank)));
        nodes.count.textContent = options.length > MAX_ROWS
            ? `${options.length} carrières : précisez la recherche` : `${options.length} carrière${options.length > 1 ? 's' : ''}`;
        nodes.list.replaceChildren(...options.slice(0, MAX_ROWS).map(option => {
            const li = make(documentRef, 'li');
            const row = make(documentRef, 'button', '', 'm-apt-row m-career-row');
            row.type = 'button';
            row.disabled = !option.ok;
            const main = make(documentRef, 'span', '', 'm-apt-main');
            main.append(make(documentRef, 'span', option.nom, 'm-apt-name'),
                make(documentRef, 'span', option.reason || option.source, 'm-apt-detail'));
            row.append(main);
            row.addEventListener('click', () => {
                sheet.close();
                onChoose({ kind: 'rank', rankMode: 'changeCareer', careerId: option.id, targetRank }, trigger);
            });
            li.append(row);
            return li;
        }));
    }

    return Object.freeze({
        element: sheet.element,
        open(next) {
            trigger = next;
            targetRank = 1;
            query = '';
            sheet.open({ trigger, render: build });
        },
        update() { if (sheet.isOpen()) { renderCost(); renderList(); } },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

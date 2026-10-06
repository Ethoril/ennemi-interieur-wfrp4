import { createBottomSheet } from '../components/bottom-sheet.js';
import { learnSkillRows } from '../fiche-skill-learn-model.js';
import { purchaseTarget } from '../fiche-purchase.js';
import { createSpecialtySection } from './fiche-specialty.js';

// ponytail: ~150 compétences et groupes publiés ; au-delà de cette limite, la recherche sert à préciser (pas de défilement virtuel).
const MAX_ROWS = 40;

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Volet « Apprendre une compétence » : recherche (sans accents ni casse, chaque mot) sur les compétences avancées publiées pas
 * encore possédées. Une compétence unique ferme le volet et appelle onChoose({ kind: 'skill', newName }, trigger) ; un groupe
 * (« Langue (au choix) ») ouvre le choix de spécialité existant (puces publiées + saisie libre) avant le même appel.
 * `getContext()` → { state, engine, careers, controller }.
 */
export function createSkillLearnSheet({ documentRef, getContext, onChoose }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-skill-learn-title' });
    let query = '';
    let trigger = null;
    let nodes = null;

    const pick = nom => {
        sheet.close();
        onChoose({ kind: 'skill', newName: nom }, trigger);
    };

    const build = body => {
        const title = make(documentRef, 'h2', 'Apprendre une compétence', 'm-purchase-title');
        title.id = 'm-skill-learn-title';
        title.tabIndex = -1;
        title.setAttribute('data-sheet-drag', '');
        const label = make(documentRef, 'label', '', 'm-search');
        const search = make(documentRef, 'input');
        search.type = 'search';
        search.placeholder = 'Rechercher une compétence';
        search.autocomplete = 'off';
        search.enterKeyHint = 'search';
        search.addEventListener('input', () => { query = search.value; renderList(); });
        label.append(make(documentRef, 'span', search.placeholder, 'visually-hidden'), search);
        const count = make(documentRef, 'output', '', 'm-result-count');
        count.setAttribute('aria-live', 'polite');
        const list = make(documentRef, 'ul', '', 'm-career-list');
        const legend = make(documentRef, 'p', 'Point doré : compétence de la carrière actuelle.', 'm-principal-note');
        const home = make(documentRef, 'div', '', 'm-apt-pane');
        home.append(label, count, list, legend);
        const choice = make(documentRef, 'div', '', 'm-apt-pane');
        choice.hidden = true;
        body.replaceChildren(title, home, choice);
        nodes = { title, home, choice, count, list };
        renderList();
    };

    function chooseSpecialty(row) {
        const section = createSpecialtySection({
            documentRef, getContext, idPrefix: 'm-skill-learn-spec', expanded: true,
            onChoose: nom => {
                const { state, engine, careers } = getContext();
                if (!purchaseTarget(state?.data, engine, careers, { kind: 'skill', newName: nom })) return false;
                pick(nom);
                return true;
            },
        });
        section.update({ specialty: row.specialty });
        const back = make(documentRef, 'button', 'Retour à la liste', 'm-button');
        back.type = 'button';
        back.addEventListener('click', () => {
            nodes.choice.hidden = true;
            nodes.home.hidden = false;
            nodes.title.textContent = 'Apprendre une compétence';
            nodes.title.focus();
        });
        nodes.choice.replaceChildren(back, section.element);
        nodes.title.textContent = row.group;
        nodes.home.hidden = true;
        nodes.choice.hidden = false;
        nodes.title.focus();
    }

    function renderList() {
        const { state, engine, careers } = getContext();
        const rows = learnSkillRows(state?.data, engine, careers, query);
        nodes.count.textContent = rows.length > MAX_ROWS
            ? `${rows.length} compétences : précisez la recherche` : `${rows.length} compétence${rows.length > 1 ? 's' : ''}`;
        nodes.list.replaceChildren(...rows.slice(0, MAX_ROWS).map(row => {
            const li = make(documentRef, 'li');
            const button = make(documentRef, 'button', '', 'm-apt-row');
            button.type = 'button';
            const dot = make(documentRef, 'span', '', row.inCareer ? 'm-apt-dot is-career' : 'm-apt-dot');
            dot.setAttribute('aria-hidden', 'true');
            const name = make(documentRef, 'span', row.nom, 'm-apt-name');
            if (row.inCareer) name.append(make(documentRef, 'span', ', de carrière', 'visually-hidden'));
            const main = make(documentRef, 'span', '', 'm-apt-main');
            main.append(name);
            button.append(dot, main);
            if (row.cost !== undefined) {
                const side = make(documentRef, 'span', '', 'm-apt-side');
                const shown = make(documentRef, 'span', `${row.cost} XP`);
                shown.setAttribute('aria-hidden', 'true');
                side.append(shown, make(documentRef, 'span', `, ${row.cost} XP`, 'visually-hidden'));
                button.append(side);
            }
            button.addEventListener('click', () => (row.specialty ? chooseSpecialty(row) : pick(row.nom)));
            li.append(button);
            return li;
        }));
    }

    return Object.freeze({
        element: sheet.element,
        open(opener) {
            trigger = opener;
            query = '';
            sheet.open({ trigger, render: build });
        },
        update() { if (sheet.isOpen() && !nodes.home.hidden) renderList(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

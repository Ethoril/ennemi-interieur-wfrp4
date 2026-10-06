import { createBottomSheet } from '../components/bottom-sheet.js';
import { submitDraft } from '../fiche-autosave.js';
import { filterSkills, sortSkills } from '../fiche-aptitudes-model.js';
import { favoriteSlots, skillPinId, skillRows } from '../fiche-model.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

const isConflict = error => String(error?.code || '').split('/').at(-1) === 'aborted';

/**
 * Volet des compétences épinglées sur Principal. open(emplacement 1-5, bouton) : un emplacement vide ouvre la liste, un emplacement
 * rempli propose « Changer » (liste) ou « Retirer ». La liste est celle des compétences du personnage (recherche sans accents ni
 * casse), sans celles déjà épinglées ailleurs. Le choix est écrit dans la fiche (`favoriteSkills.<n>`) : brouillon protégé même
 * hors ligne (stagePatch), puis envoi sérialisé (submitDraft). onDone(emplacement) rend le focus dès la fermeture.
 * `getContext()` → { state, engine, careers, online, controller }.
 */
export function createPinSkillSheet({ documentRef, getContext, announce = () => {}, onDone = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-pin-title' });
    let slot = 0;
    let query = '';
    let nodes = null;

    const slotRow = () => favoriteSlots(getContext().state?.data, getContext().engine, getContext().careers)[slot - 1].row;

    async function save(id, text) {
        const { controller, online } = getContext();
        const current = slot;
        const staged = controller?.stagePatch({ [`favoriteSkills.${current}`]: id });
        sheet.close();
        onDone(current);
        if (!staged?.ok) { announce('Modification impossible sur cette fiche.'); return; }
        let message = text;
        if (!online) message += ', en attente de connexion';
        else {
            try {
                const result = await submitDraft(controller);
                if (result?.reason === 'conflict') message = `Conflit sur la compétence affichée ${current} : la valeur a aussi changé sur le serveur`;
                else if (result?.status === 'blocked' || result?.status === 'retry-required') message += ', enregistrement en attente';
            } catch (error) {
                message = isConflict(error) ? 'Conflit : la valeur a changé ailleurs' : `${message}, enregistrement en attente`;
            }
        }
        announce(message);
    }

    function showList() {
        nodes.title.textContent = `Compétence affichée ${slot}`;
        nodes.menu.hidden = true;
        nodes.list.hidden = false;
        renderList();
        nodes.title.focus();
    }

    function renderList() {
        const { state, engine, careers } = getContext();
        const data = state?.data;
        const taken = new Set(favoriteSlots(data, engine, careers).filter(item => item.slot !== slot && item.row).map(item => skillPinId(item.row)));
        const rows = sortSkills(filterSkills(skillRows(data, engine, careers), { query }))
            .filter(row => skillPinId(row) && !taken.has(skillPinId(row)));
        nodes.count.textContent = `${rows.length} compétence${rows.length > 1 ? 's' : ''}`;
        nodes.items.replaceChildren(...rows.map(row => {
            const li = make(documentRef, 'li');
            const button = make(documentRef, 'button', '', 'm-apt-row');
            button.type = 'button';
            const main = make(documentRef, 'span', '', 'm-apt-main');
            main.append(make(documentRef, 'span', row.nom, 'm-apt-name'),
                make(documentRef, 'span', `${row.caracAbbr} ${row.caracTotal}${row.adv ? ` · +${row.adv}` : ''}`, 'm-apt-detail'));
            button.append(main, make(documentRef, 'span', String(row.total), row.adv ? 'm-apt-total is-trained' : 'm-apt-total'));
            button.addEventListener('click', () => { void save(skillPinId(row), `${row.nom} affichée`); });
            li.append(button);
            return li;
        }));
    }

    const build = body => {
        const title = make(documentRef, 'h2', '', 'm-purchase-title');
        title.id = 'm-pin-title';
        title.tabIndex = -1;
        title.setAttribute('data-sheet-drag', '');
        const menu = make(documentRef, 'div', '', 'm-apt-pane');
        const change = make(documentRef, 'button', 'Changer', 'm-button');
        const remove = make(documentRef, 'button', 'Retirer', 'm-button m-button-danger');
        const cancel = make(documentRef, 'button', 'Annuler', 'm-button');
        for (const button of [change, remove, cancel]) button.type = 'button';
        change.addEventListener('click', showList);
        remove.addEventListener('click', () => { void save('', 'Compétence retirée'); });
        cancel.addEventListener('click', () => sheet.close());
        menu.append(change, remove, cancel);
        const list = make(documentRef, 'div', '', 'm-apt-pane');
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
        const items = make(documentRef, 'ul', '', 'm-career-list');
        list.append(label, count, items);
        body.replaceChildren(title, menu, list);
        nodes = { title, menu, list, count, items };
    };

    return Object.freeze({
        element: sheet.element,
        open(next, trigger) {
            slot = next;
            query = '';
            const current = slotRow();
            sheet.open({ trigger, render: build });
            if (current) {
                nodes.title.textContent = current.nom;
                nodes.list.hidden = true;
                nodes.menu.hidden = false;
                nodes.title.focus();
            } else showList();
        },
        update() { if (sheet.isOpen() && !nodes.list.hidden) renderList(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

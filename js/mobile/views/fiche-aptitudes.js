import { createBottomSheet } from '../components/bottom-sheet.js';
import { filterSkills, hasSpells, sortSkills, spellRows, spellSections, talentRows } from '../fiche-aptitudes-model.js';
import { CARACS, skillRows } from '../fiche-model.js';

const MODES = Object.freeze([['competences', 'Compétences'], ['talents', 'Talents'], ['sorts', 'Sorts']]);

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

// Un groupe titré (h3 + liste) dont les lignes sont fournies par l'appelant.
function makeGroup(documentRef) {
    const root = make(documentRef, 'section', '', 'm-apt-group');
    const title = make(documentRef, 'h3', '', 'm-apt-title');
    const list = make(documentRef, 'ul', '', 'm-apt-list');
    root.append(title, list);
    return { root, title, list };
}

/**
 * Onglet Aptitudes : bascule Compétences · Talents · Sorts. Toucher une compétence ou un talent appelle
 * onOpenSkill(ligne, bouton) / onOpenTalent(nom, bouton) (volet d'achat) ; un sort ou une prière possédé s'ouvre en consultation,
 * « Apprendre un sort / un miracle » appelle onLearn('sort' | 'miracle', bouton), « Apprendre une compétence » onLearnSkill(bouton).
 * La requête, les filtres et la bascule vivent dans la fermeture : ils survivent aux mises à jour et aux changements d'onglet.
 * Les lignes sont mises à jour sur place (même bouton) : le focus de la recherche et le bouton déclencheur du volet restent valides.
 */
export function createAptitudesPanel({ documentRef, onOpenSkill = () => {}, onOpenTalent = () => {}, onLearn = () => {}, onLearnSkill = () => {} }) {
    const root = make(documentRef, 'div', '', 'm-aptitudes');
    let mode = 'competences';
    const filters = { query: '', career: false, trained: false, carac: '' };
    let context = null;

    const switcher = make(documentRef, 'div', '', 'm-apt-switch');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Type d’aptitude');
    const switchButtons = new Map(MODES.map(([key, label]) => {
        const button = make(documentRef, 'button', label, 'm-apt-switch-button');
        button.type = 'button';
        button.addEventListener('click', () => { mode = key; render(); });
        switcher.append(button);
        return [key, button];
    }));

    // Compétences : recherche, puces de filtre, deux groupes.
    const skillsPane = make(documentRef, 'div', '', 'm-apt-pane');
    const tools = make(documentRef, 'div', '', 'm-apt-tools');
    const searchLabel = make(documentRef, 'label', '', 'm-search');
    const search = make(documentRef, 'input');
    search.type = 'search';
    search.placeholder = 'Rechercher une compétence';
    search.autocomplete = 'off';
    search.enterKeyHint = 'search';
    searchLabel.append(make(documentRef, 'span', 'Rechercher une compétence', 'visually-hidden'), search);
    const chips = make(documentRef, 'div', '', 'm-quick-filters');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Filtrer les compétences');
    const chip = (label, ariaLabel, toggle) => {
        const button = make(documentRef, 'button', label, 'm-chip');
        button.type = 'button';
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        button.addEventListener('click', () => { toggle(); renderSkills(); });
        chips.append(button);
        return button;
    };
    const careerChip = chip('Carrière', '', () => { filters.career = !filters.career; });
    const trainedChip = chip('Entraînées', '', () => { filters.trained = !filters.trained; });
    // Choix unique : toucher la puce active la désélectionne.
    const caracChips = CARACS.map(({ key, abbr, nom }) => [key, chip(abbr, `Caractéristique ${nom}`, () => {
        filters.carac = filters.carac === key ? '' : key;
    })]);
    const count = make(documentRef, 'output', '', 'm-result-count');
    count.setAttribute('aria-live', 'polite');
    tools.append(searchLabel, chips, count);
    const trainedGroup = makeGroup(documentRef);
    const untrainedGroup = makeGroup(documentRef);
    const empty = make(documentRef, 'div', '', 'm-apt-empty');
    const clear = make(documentRef, 'button', 'Effacer les filtres', 'm-button');
    clear.type = 'button';
    empty.append(make(documentRef, 'p', 'Aucune compétence ne correspond.'), clear);
    const legend = make(documentRef, 'p', 'Point doré : compétence de la carrière actuelle.', 'm-principal-note');
    const learnSkill = make(documentRef, 'button', 'Apprendre une compétence', 'm-button');
    learnSkill.type = 'button';
    learnSkill.addEventListener('click', () => onLearnSkill(learnSkill));
    skillsPane.append(tools, learnSkill, trainedGroup.root, untrainedGroup.root, empty, legend);

    search.addEventListener('input', () => { filters.query = search.value; renderSkills(); });
    clear.addEventListener('click', () => {
        Object.assign(filters, { query: '', career: false, trained: false, carac: '' });
        search.value = '';
        renderSkills();
        search.focus();
    });

    // Talents.
    const talentsPane = make(documentRef, 'div', '', 'm-apt-pane');
    const acquiredGroup = makeGroup(documentRef);
    const availableGroup = makeGroup(documentRef);
    const noTalent = make(documentRef, 'p', 'Aucun talent acquis ni disponible dans la carrière.', 'm-principal-note');
    talentsPane.append(acquiredGroup.root, availableGroup.root, noTalent);

    // Sorts et miracles : consultation des possédés, apprentissage par le volet de choix.
    const spellsPane = make(documentRef, 'div', '', 'm-apt-pane');
    const learnSection = (kind, noneText, learnText) => {
        const group = makeGroup(documentRef);
        const none = make(documentRef, 'p', noneText, 'm-principal-note');
        const learn = make(documentRef, 'button', learnText, 'm-button');
        learn.type = 'button';
        learn.addEventListener('click', () => onLearn(kind, learn));
        group.root.append(none, learn);
        return { ...group, none };
    };
    const spellGroup = learnSection('sort', 'Aucun sort appris.', 'Apprendre un sort');
    const prayerGroup = learnSection('miracle', 'Aucun miracle appris.', 'Apprendre un miracle');
    spellsPane.append(spellGroup.root, prayerGroup.root);
    const detail = createBottomSheet({ documentRef, labelledBy: 'm-apt-detail-title' });

    root.append(switcher, skillsPane, talentsPane, spellsPane);

    // Lignes gardées par clé et par volet : le bouton reste le même d'un rendu à l'autre.
    const caches = { skills: new Map(), talents: new Map(), spells: new Map() };
    const rowsFor = (cache, rows, build) => {
        for (const key of [...cache.keys()]) if (!rows.some(row => row.key === key)) cache.delete(key);
        return rows.map(row => {
            if (!cache.has(row.key)) cache.set(row.key, build());
            const node = cache.get(row.key);
            node.row = row;
            return node;
        });
    };
    const fill = (group, title, nodes) => {
        group.root.hidden = !nodes.length;
        group.title.textContent = title;
        group.list.replaceChildren(...nodes.map(node => node.li));
    };
    const buildRow = (...parts) => {
        const li = make(documentRef, 'li');
        const button = make(documentRef, 'button', '', 'm-apt-row');
        button.type = 'button';
        button.append(...parts);
        li.append(button);
        return { li, button };
    };
    const twoLines = () => {
        const name = make(documentRef, 'span', '', 'm-apt-name');
        const sub = make(documentRef, 'span', '', 'm-apt-detail');
        const main = make(documentRef, 'span', '', 'm-apt-main');
        main.append(name, sub);
        return { main, name, sub };
    };

    const buildSkill = () => {
        const dot = make(documentRef, 'span', '', 'm-apt-dot');
        dot.setAttribute('aria-hidden', 'true');
        const lines = twoLines();
        const career = make(documentRef, 'span', ', de carrière', 'visually-hidden');
        const total = make(documentRef, 'span', '', 'm-apt-total');
        const node = { ...buildRow(dot, lines.main, total), ...lines, dot, career, total };
        node.button.addEventListener('click', () => onOpenSkill(node.row, node.button));
        return node;
    };

    function renderSkills() {
        const all = skillRows(context.data, context.engine, context.careers);
        const rows = sortSkills(filterSkills(all, filters));
        // Le cache ne garde que les lignes affichées : une ligne qui ressort d'un filtre repart d'un bouton neuf.
        const nodes = rowsFor(caches.skills, rows, buildSkill);
        for (const node of nodes) {
            const { row } = node;
            node.name.textContent = row.nom;
            node.name.append(node.career);
            node.career.hidden = !row.inCareer;
            node.dot.className = row.inCareer ? 'm-apt-dot is-career' : 'm-apt-dot';
            node.sub.textContent = `${row.caracAbbr} ${row.caracTotal}${row.adv ? ` · +${row.adv}` : ''}`;
            node.total.textContent = String(row.total);
            node.total.className = row.adv ? 'm-apt-total is-trained' : 'm-apt-total';
        }
        const trained = nodes.filter(node => node.row.adv > 0);
        const rest = nodes.filter(node => !node.row.adv);
        fill(trainedGroup, `Entraînées · ${trained.length}`, trained);
        fill(untrainedGroup, `Non entraînées · ${rest.length}`, rest);
        const active = filters.career || filters.trained || filters.carac || filters.query.trim();
        empty.hidden = rows.length > 0;
        clear.hidden = !active;
        legend.hidden = !rows.length;
        count.textContent = `${rows.length} compétence${rows.length > 1 ? 's' : ''}`;
        for (const [button, on] of [[careerChip, filters.career], [trainedChip, filters.trained],
            ...caracChips.map(([key, button]) => [button, filters.carac === key])]) {
            button.setAttribute('aria-pressed', String(on));
        }
    }

    // Ligne « nom (+ sous-titre) à gauche, mention à droite » des talents, sorts et prières.
    const buildSide = onClick => () => {
        const lines = twoLines();
        const side = make(documentRef, 'span', '', 'm-apt-side');
        const spoken = make(documentRef, 'span', '', 'visually-hidden');
        const shown = make(documentRef, 'span');
        shown.setAttribute('aria-hidden', 'true');
        side.append(shown, spoken);
        const node = { ...buildRow(lines.main, side), ...lines, shown, spoken };
        node.button.addEventListener('click', () => onClick(node.row, node.button));
        return node;
    };
    const fillSide = (node, { name, sub = '', side = '', spoken = '' }) => {
        node.name.textContent = name;
        node.sub.textContent = sub;
        node.sub.hidden = !sub;
        node.shown.textContent = side;
        node.spoken.textContent = spoken;
    };

    const buildTalent = buildSide((row, trigger) => onOpenTalent(row.nom, trigger));
    function renderTalents() {
        const rows = talentRows(context.data, context.engine, context.careers).map(row => ({ ...row, key: `${row.acquired}:${row.nom}` }));
        const nodes = rowsFor(caches.talents, rows, buildTalent);
        for (const node of nodes) {
            const { row } = node;
            const plural = row.count > 1 ? 's' : '';
            fillSide(node, {
                name: row.label,
                side: row.acquired ? `×${row.count}` : row.open ? 'Spécialité à choisir' : `${row.cost} XP`,
                spoken: row.acquired ? `, ${row.count} prise${plural}` : row.open ? ', spécialité à choisir' : `, ${row.cost} XP`,
            });
        }
        fill(acquiredGroup, 'Acquis', nodes.filter(node => node.row.acquired));
        fill(availableGroup, 'Disponibles dans la carrière', nodes.filter(node => !node.row.acquired));
        noTalent.hidden = rows.length > 0;
    }

    const openSpell = (row, trigger) => detail.open({
        trigger,
        render: body => {
            const title = make(documentRef, 'h2', row.nom, 'm-purchase-title');
            title.id = 'm-apt-detail-title';
            const facts = make(documentRef, 'dl', '', 'm-apt-facts');
            for (const [label, value] of row.details) {
                const cell = make(documentRef, 'div');
                cell.append(make(documentRef, 'dt', label), make(documentRef, 'dd', value));
                facts.append(cell);
            }
            const close = make(documentRef, 'button', 'Fermer', 'm-button');
            close.type = 'button';
            close.addEventListener('click', () => detail.close());
            body.replaceChildren(title, make(documentRef, 'p', row.type, 'm-purchase-nature'), facts,
                make(documentRef, 'p', row.resume || 'Aucun résumé publié.'), close);
        },
    });

    const buildSpell = buildSide(openSpell);
    function renderSpells() {
        const { spells, prayers } = spellRows(context.data);
        const nodes = rowsFor(caches.spells, [...spells, ...prayers], buildSpell);
        for (const node of nodes) {
            const { row } = node;
            fillSide(node, {
                name: row.nom, sub: row.type, side: row.ni ? `NI ${row.ni}` : '', spoken: row.ni ? `, niveau d’incantation ${row.ni}` : '',
            });
        }
        const shown = spellSections(context.data);
        for (const [group, title, on, own] of [[spellGroup, 'Sorts', shown.spells, nodes.filter(node => !node.row.prayer)],
            [prayerGroup, 'Prières et miracles', shown.prayers, nodes.filter(node => node.row.prayer)]]) {
            fill(group, title, own);
            group.root.hidden = !on;
            group.none.hidden = own.length > 0;
        }
    }

    function render() {
        if (!context) return;
        const spells = hasSpells(context.data);
        if (!spells && mode === 'sorts') mode = 'competences';
        switchButtons.get('sorts').hidden = !spells;
        for (const [key, button] of switchButtons) button.setAttribute('aria-pressed', String(key === mode));
        skillsPane.hidden = mode !== 'competences';
        talentsPane.hidden = mode !== 'talents';
        spellsPane.hidden = mode !== 'sorts';
        if (mode === 'competences') renderSkills();
        else if (mode === 'talents') renderTalents();
        else renderSpells();
    }

    return Object.freeze({
        element: root,
        detailElement: detail.element,
        update({ data, careers, engine }) { context = { data, careers, engine }; render(); },
        closeDetail: detail.close,
    });
}

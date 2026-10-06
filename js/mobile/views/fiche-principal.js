import { blessuresMax, mouvement } from '../../fiche/derived.js';
import { CARACS, dotTarget, FAVORITE_SLOTS, favoriteSlots, ficheCaracs, resourceTokens } from '../fiche-model.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Onglet Principal ; toucher une caractéristique appelle onOpenCarac(clé, bouton). Toucher un point de Destin ou de Résilience
 * appelle onChangeResource({ maxKey, currentKey, maxLabel, label, value }, bouton) avec la valeur proposée. Les cinq emplacements de
 * compétences épinglées appellent onOpenSlot(numéro 1-5, bouton), qu'ils soient vides ou remplis. La structure est construite
 * une fois ; update() ne réécrit que les textes et les points (réutilisés par rang), donc le bouton focalisé garde le focus.
 */
export function createPrincipalPanel({ documentRef, aptitudesHref, onOpenCarac = () => {}, onChangeResource = () => {}, onOpenSlot = () => {}, onShowAllSkills = () => {} }) {
    const root = make(documentRef, 'div', '', 'm-principal');

    const resources = make(documentRef, 'div', '', 'm-principal-resources');
    const cards = [['Destin', 'Chance', 'destin', 'chance'], ['Résilience', 'Détermination', 'resilience', 'determination']]
        .map(([maxLabel, label, maxKey, currentKey]) => {
            const card = make(documentRef, 'div', '', 'm-principal-card');
            const max = make(documentRef, 'p', maxLabel, 'm-principal-max');
            const current = make(documentRef, 'p', '', 'm-principal-label');
            const tokens = make(documentRef, 'div', '', 'm-principal-tokens');
            tokens.setAttribute('role', 'group');
            card.append(max, tokens, current);
            resources.append(card);
            return { maxLabel, label, maxKey, currentKey, current, tokens, dots: [], value: 0 };
        });

    const caracsSection = make(documentRef, 'section', '', 'm-principal-section');
    caracsSection.setAttribute('aria-labelledby', 'm-principal-caracs');
    const caracsTitle = make(documentRef, 'h3', 'Caractéristiques', 'm-principal-title');
    caracsTitle.id = 'm-principal-caracs';
    const grid = make(documentRef, 'div', '', 'm-principal-caracs');
    const cells = CARACS.map(({ key }) => {
        const button = make(documentRef, 'button', '', 'm-principal-carac');
        button.type = 'button';
        const abbr = make(documentRef, 'span', '', 'm-principal-carac-abbr');
        const total = make(documentRef, 'span', '', 'm-principal-carac-total');
        // Les dizaines (le bonus) en or, l'unité en couleur normale ; le nom accessible du bouton porte le bonus en toutes lettres.
        const tens = make(documentRef, 'span', '', 'm-principal-carac-tens');
        const units = make(documentRef, 'span');
        total.append(tens, units);
        button.append(abbr, total);
        button.addEventListener('click', () => onOpenCarac(key, button));
        grid.append(button);
        return { button, abbr, tens, units };
    });
    const legend = make(documentRef, 'p', 'Cadre doré : caractéristique de la carrière.', 'm-principal-note');
    const derived = make(documentRef, 'p', '', 'm-principal-note');
    caracsSection.append(caracsTitle, grid, legend, derived);

    const skillsSection = make(documentRef, 'section', '', 'm-principal-section');
    skillsSection.setAttribute('aria-labelledby', 'm-principal-skills');
    const skillsHead = make(documentRef, 'div', '', 'm-principal-head');
    const skillsTitle = make(documentRef, 'h3', 'Compétences', 'm-principal-title');
    skillsTitle.id = 'm-principal-skills';
    const all = make(documentRef, 'a', 'Toutes', 'm-principal-all');
    all.href = aptitudesHref;
    all.setAttribute('aria-label', 'Toutes les compétences');
    // Pas de preventDefault : le lien navigue ; l'appelant remet la liste à zéro avant.
    all.addEventListener('click', () => onShowAllSkills());
    skillsHead.append(skillsTitle, all);
    const skillList = make(documentRef, 'ul', '', 'm-principal-skill-list');
    const slots = FAVORITE_SLOTS.map(slot => {
        const li = make(documentRef, 'li', '', 'm-principal-skill');
        const button = make(documentRef, 'button', '', 'm-principal-skill-button');
        button.type = 'button';
        button.addEventListener('click', () => onOpenSlot(slot, button));
        li.append(button);
        skillList.append(li);
        return { button };
    });
    skillsSection.append(skillsHead, skillList);

    root.append(resources, caracsSection, skillsSection);

    function update({ data, careers, engine, readonly = false }) {
        for (const card of cards) {
            const { max, current } = resourceTokens(data, card.maxKey, card.currentKey);
            card.current.textContent = `${card.label} ${current}`;
            card.tokens.setAttribute('aria-label', card.maxLabel);
            // `max` points pleins et un point vide final (+1) ; les boutons existants sont réutilisés pour garder le focus.
            while (card.dots.length < max + 1) {
                const dot = make(documentRef, 'button', '', 'm-principal-dot');
                dot.type = 'button';
                const index = card.dots.length;
                dot.addEventListener('click', () => onChangeResource({ maxKey: card.maxKey, currentKey: card.currentKey, maxLabel: card.maxLabel, label: card.label, value: dotTarget(card.value, index) }, dot));
                card.dots.push(dot);
            }
            card.dots.length = max + 1;
            card.value = max;
            card.dots.forEach((dot, index) => {
                dot.className = index < max ? 'm-principal-dot is-full' : 'm-principal-dot';
                dot.disabled = readonly;
                dot.setAttribute('aria-label', index < max
                    ? `${card.maxLabel} : ${max}. Brûler jusqu'à ${index}`
                    : `Ajouter un point de ${card.maxLabel}`);
            });
            card.tokens.replaceChildren(...card.dots);
        }
        ficheCaracs(data, careers).forEach((carac, index) => {
            const cell = cells[index];
            cell.abbr.textContent = carac.abbr;
            const digits = String(carac.total);
            cell.tens.textContent = digits.slice(0, -1);
            cell.units.textContent = digits.slice(-1);
            cell.button.className = carac.career ? 'm-principal-carac is-career' : 'm-principal-carac';
            cell.button.setAttribute('aria-label',
                `${carac.nom} ${carac.total}, bonus ${carac.bonus}${carac.career ? ', de carrière' : ''}`);
        });
        derived.textContent = `Mouvement ${mouvement(data)} · Blessures max ${blessuresMax(data)} · Corruption ${Math.max(0, Math.floor(+data?.corruption) || 0)}`;
        favoriteSlots(data, engine, careers).forEach(({ slot, row }, index) => {
            const { button } = slots[index];
            button.disabled = readonly;
            if (!row) {
                button.replaceChildren(make(documentRef, 'span', 'Choisir une compétence', 'm-principal-skill-empty'));
                button.setAttribute('aria-label', `Compétence affichée ${slot} : choisir une compétence`);
                return;
            }
            button.replaceChildren(make(documentRef, 'span', row.nom, 'm-principal-skill-name'),
                make(documentRef, 'span', row.caracAbbr, 'm-principal-skill-carac'),
                make(documentRef, 'span', String(row.total), 'm-principal-skill-total'));
            button.setAttribute('aria-label', `${row.nom}, ${row.caracAbbr}, total ${row.total}. Changer ou retirer`);
        });
    }

    // Le point touché peut avoir disparu (brûlé) : le focus revient au dernier point de la ressource.
    const focusResource = maxKey => cards.find(card => card.maxKey === maxKey)?.dots.at(-1)?.focus?.();

    const focusSlot = slot => slots[slot - 1]?.button.focus?.();

    return Object.freeze({ element: root, update, focusResource, focusSlot });
}

import { blessuresMax, mouvement } from '../../fiche/derived.js';
import { CARACS, ficheCaracs, resourceTokens, topSkills } from '../fiche-model.js';

const TOP_SKILLS = 5;

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Onglet Principal ; toucher une caractéristique appelle onOpenCarac(clé, bouton). La structure est construite une fois ; update() ne réécrit
 * que les textes et les jetons, donc le bouton de caractéristique focalisé garde le focus.
 */
export function createPrincipalPanel({ documentRef, aptitudesHref, onOpenCarac = () => {} }) {
    const root = make(documentRef, 'div', '', 'm-principal');

    const resources = make(documentRef, 'div', '', 'm-principal-resources');
    const cards = [['Destin', 'Chance', 'destin', 'chance'], ['Résilience', 'Détermination', 'resilience', 'determination']]
        .map(([maxLabel, label, maxKey, currentKey]) => {
            const card = make(documentRef, 'div', '', 'm-principal-card');
            const max = make(documentRef, 'p', '', 'm-principal-max');
            const name = make(documentRef, 'p', label, 'm-principal-label');
            const tokens = make(documentRef, 'div', '', 'm-principal-tokens');
            tokens.setAttribute('role', 'group');
            card.append(max, name, tokens);
            resources.append(card);
            return { maxLabel, label, maxKey, currentKey, max, tokens };
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
        const bonus = make(documentRef, 'span', '', 'm-principal-carac-bonus');
        button.append(abbr, total, bonus);
        button.addEventListener('click', () => onOpenCarac(key, button));
        grid.append(button);
        return { button, abbr, total, bonus };
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
    skillsHead.append(skillsTitle, all);
    const skillList = make(documentRef, 'ul', '', 'm-principal-skill-list');
    skillsSection.append(skillsHead, skillList);

    root.append(resources, caracsSection, skillsSection);

    function update({ data, careers, engine }) {
        for (const card of cards) {
            const { max, current } = resourceTokens(data, card.maxKey, card.currentKey);
            card.max.textContent = `${card.maxLabel} ${max}`;
            card.tokens.setAttribute('aria-label', `${card.label} : ${current} sur ${max}`);
            card.tokens.replaceChildren(...Array.from({ length: max }, (_, index) => {
                const token = make(documentRef, 'span', '', index < current ? 'm-principal-token is-full' : 'm-principal-token');
                return token;
            }));
        }
        ficheCaracs(data, careers).forEach((carac, index) => {
            const cell = cells[index];
            cell.abbr.textContent = carac.abbr;
            cell.total.textContent = String(carac.total);
            cell.bonus.textContent = `B${carac.bonus}`;
            cell.button.className = carac.career ? 'm-principal-carac is-career' : 'm-principal-carac';
            cell.button.setAttribute('aria-label',
                `${carac.nom} ${carac.total}, bonus ${carac.bonus}${carac.career ? ', de carrière' : ''}`);
        });
        derived.textContent = `Mouvement ${mouvement(data)} · Blessures max ${blessuresMax(data)} · Corruption ${Math.max(0, Math.floor(+data?.corruption) || 0)}`;
        skillList.replaceChildren(...topSkills(data, engine, TOP_SKILLS).map(skill => {
            const row = make(documentRef, 'li', '', 'm-principal-skill');
            row.append(make(documentRef, 'span', skill.nom, 'm-principal-skill-name'),
                make(documentRef, 'span', skill.carac, 'm-principal-skill-carac'),
                make(documentRef, 'span', String(skill.total), 'm-principal-skill-total'));
            return row;
        }));
    }

    return Object.freeze({ element: root, update });
}

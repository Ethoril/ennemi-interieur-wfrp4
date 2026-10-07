import { primarySkillLabel } from '../catalogue/skill-forms.js';
import {
    getEffectiveCaracs,
    getEffectiveSkills,
    getEffectiveTalents,
    getRangVariants,
    findCareerByName,
} from './career-model.js';

const CARAC_LABELS = { cc: 'CC', ct: 'CT', f: 'F', e: 'E', i: 'I', ag: 'Ag', dex: 'Dex', int: 'Int', fm: 'FM', soc: 'Soc' };
const testId = value => value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
}

function unique(values) {
    return [...new Set(values || [])];
}

function ranksOf(career) {
    return unique((career?.rangs || []).map(item => Number(item.rang)).filter(Number.isInteger)).sort((a, b) => a - b);
}

function defaultRank(career, characterRank) {
    const ranks = ranksOf(career);
    if (!ranks.length) return 1;
    const next = ranks.find(rank => rank > (Number(characterRank) || 0));
    if (next !== undefined) return next;
    return ranks.find(rank => rank >= (Number(characterRank) || 1)) ?? ranks.at(-1);
}

function appendList(parent, label, values, format = value => value, onSelect = null) {
    const section = element('section', 'career-viewer-section');
    const heading = element('h4', '', label);
    const list = element('ul');
    const items = unique(unique(values).map(format));
    if (!items.length) list.append(element('li', 'is-empty', 'Aucun'));
    else for (const item of items) {
        const row = element('li');
        if (onSelect) {
            const button = element('button', 'career-viewer-talent', item);
            button.type = 'button';
            button.addEventListener('click', () => onSelect(item));
            row.append(button);
        } else row.textContent = item;
        list.append(row);
    }
    section.append(heading, list);
    parent.append(section);
}

function variantsAt(career, rank) {
    return getRangVariants(career, rank);
}

function selectedVariant(career, rank, variantTitle) {
    const variants = variantsAt(career, rank);
    if (variants.length <= 1) return variants[0] || null;
    return variants.find(variant => variant.titre === variantTitle) || null;
}

function catalogLabel(value, resolver) {
    if (typeof resolver !== 'function') return value;
    try {
        const resolution = resolver(value);
        if (['resolved', 'custom-specialization'].includes(resolution?.status)
            && typeof resolution.entry?.nom === 'string' && resolution.entry.nom.trim()) {
            return resolution.displayedName || resolution.entry.nom;
        }
    } catch { /* Keep the career's original label if a local resolver cannot resolve it. */ }
    return value;
}

function renderRank(parent, career, rank, variant, overrides, onTalent, context = {}) {
    const panel = element('div', 'career-viewer-rank');
    const variants = variantsAt(career, rank);
    const title = variant?.titre || variants[0]?.titre || `Rang ${rank}`;
    panel.append(element('h3', '', `Rang ${rank} · ${title}`));
    if (variant?.statut) panel.append(element('p', 'career-viewer-status', `Statut : ${variant.statut}`));
    const caracs = getEffectiveCaracs(career, rank, variant, overrides).map(code => CARAC_LABELS[code] || code);
    const skills = getEffectiveSkills(career, rank, variant, overrides);
    const talents = getEffectiveTalents(career, rank, variant, overrides, context.resolveTalent ? { resolve: context.resolveTalent } : undefined);
    appendList(panel, 'Caractéristiques', caracs);
    appendList(panel, 'Compétences', skills, value => context.skillResolver ? primarySkillLabel(context.skillResolver, value, true) : catalogLabel(value, context.resolveSkill));
    appendList(panel, 'Talents', talents, value => catalogLabel(value, context.resolveTalent), onTalent
        ? value => onTalent(catalogLabel(value, context.resolveTalent))
        : null);
    parent.append(panel);
}

function selectControl(labelText, options, selected) {
    const label = element('label', 'career-viewer-control');
    label.append(element('span', '', labelText));
    const select = element('select');
    select.dataset.testid = testId(labelText);
    for (const option of options) {
        const node = element('option', '', option.label);
        node.value = String(option.value);
        node.selected = String(option.value) === String(selected);
        select.append(node);
    }
    select.value = selected == null ? '' : String(selected);
    label.append(select);
    return { label, select };
}

function checkboxControl(labelText, checked) {
    const label = element('label', 'career-viewer-check');
    const input = element('input');
    input.dataset.testid = testId(labelText);
    input.type = 'checkbox';
    input.checked = checked;
    label.append(input, element('span', '', labelText));
    return { label, input };
}

function careerOptionLabel(career) {
    return career.source ? `${career.nom} · ${career.source}` : career.nom;
}

// modalOnly : le conteneur ne reçoit que la modale (ouverte par openModal()), sans la section d'aperçu ;
// onModalClose est appelé à sa fermeture pour rendre le focus à l'appelant. Sans ces options, rien ne change.
export function createCareerViewer({ container, getContext, onTalent = null, modalOnly = false, onModalClose = null }) {
    if (!container || typeof getContext !== 'function') throw new TypeError('container et getContext sont requis');
    let state = { rank: null, careerId: null, modalCareerId: null, showCumulative: false, adapted: true, modalOpen: false, variantTitles: {} };
    let previousContextKey = null;
    let currentModal = null;
    let destroyed = false;

    const update = () => {
        if (destroyed) return;
        let modalScrollTop = 0;
        let modalFocusId = null;
        if (state.modalOpen && currentModal) {
            modalScrollTop = currentModal.scrollTop || 0;
            const active = document.activeElement;
            if (active?.dataset?.testid) modalFocusId = active.dataset.testid;
        }
        const context = getContext() || {};
        const careers = Array.isArray(context.careers) ? context.careers : [];
        const currentCareer = findCareerByName(careers, context.careerName);
        const contextKey = `${context.uid || context.user?.uid || ''}|${context.careerName || ''}|${context.rank || ''}`;
        if (previousContextKey !== null && contextKey !== previousContextKey) {
            state.rank = null;
            state.careerId = null;
            state.modalCareerId = null;
            state.variantTitles = {};
        }
        previousContextKey = contextKey;
        const career = careers.find(item => item.id === state.careerId) || currentCareer || careers[0] || null;
        if (!career) {
            container.replaceChildren(element('p', 'career-viewer-empty', 'Aucune carrière de référence disponible.'));
            return;
        }
        state.careerId = career.id;
        const ranks = ranksOf(career);
        const rank = ranks.includes(Number(state.rank)) ? Number(state.rank) : defaultRank(career, context.rank);
        state.rank = rank;
        const overrides = state.adapted ? context.careerOverrides || {} : {};
        const variants = variantsAt(career, rank);
        const rankVariants = context.chosenVariants?.[career.id]?.[rank];
        const defaultVariant = variants.find(item => item.titre === rankVariants)?.titre ?? variants[0]?.titre ?? '';
        const chosenTitle = state.variantTitles?.[career.id]?.[rank] ?? defaultVariant;

        const root = element('section', 'career-viewer');
        root.setAttribute('aria-label', 'Visionneuse de carrière');
        const header = element('header', 'career-viewer-header');
        const heading = element('h2', '', career.nom);
        const openModal = element('button', 'career-viewer-open', 'Voir la carrière complète');
        openModal.dataset.testid = 'open-modal';
        openModal.type = 'button';
        openModal.addEventListener('click', () => { state.modalOpen = true; update(); });
        header.append(heading, openModal);
        root.append(header);

        const controls = element('div', 'career-viewer-controls');
        const rankControl = selectControl('Rang aperçu', ranks.map(value => ({ value, label: `Rang ${value}` })), rank);
        rankControl.select.addEventListener('change', () => { state.rank = Number(rankControl.select.value); update(); });
        controls.append(rankControl.label);
        const cumulative = checkboxControl('Afficher les rangs précédents', state.showCumulative);
        cumulative.input.addEventListener('change', () => { state.showCumulative = cumulative.input.checked; update(); });
        controls.append(cumulative.label);
        const adapted = checkboxControl('Version adaptée', state.adapted);
        adapted.input.dataset.testid = 'mode-adapte';
        adapted.input.addEventListener('change', () => { state.adapted = adapted.input.checked; update(); });
        controls.append(adapted.label);
        root.append(controls);
        root.append(element('p', 'career-viewer-mode', state.adapted ? 'Version adaptée à la fiche' : 'Référence du catalogue'));

        if (variants.length > 1) {
            const variantControl = selectControl('Variante du rang', variants.map(item => ({ value: item.titre, label: item.titre })), chosenTitle);
            variantControl.select.addEventListener('change', () => {
                state.variantTitles ||= {};
                state.variantTitles[career.id] ||= {};
                state.variantTitles[career.id][rank] = variantControl.select.value;
                update();
            });
            root.append(variantControl.label);
        }

        const rankDisplay = element('div', 'career-viewer-ranks');
        const visibleRanks = (state.showCumulative ? ranks.filter(value => value <= rank) : [rank]);
        for (const visibleRank of visibleRanks) {
            const storedTitle = context.chosenVariants?.[career.id]?.[visibleRank];
            const previewTitle = state.variantTitles?.[career.id]?.[visibleRank] ?? storedTitle;
            const previewVariants = variantsAt(career, visibleRank);
            const preview = selectedVariant(career, visibleRank, previewTitle) || previewVariants[0] || null;
            renderRank(rankDisplay, career, visibleRank, preview, overrides, onTalent, context);
        }
        root.append(rankDisplay);
        let modal = null;
        if (state.modalOpen) {
            const modalCareer = careers.find(item => item.id === state.modalCareerId) || career;
            modal = renderCareerModal(careers, modalCareer, context, state, update, onTalent);
            root.append(modal);
        }
        container.replaceChildren(...(modalOnly ? (modal ? [modal] : []) : [root]));
        currentModal = modal;
        if (state.modalOpen && modal) {
            modal.scrollTop = modalScrollTop;
            if (!modal.open) modal.showModal();
            if (modalFocusId) findByTestId(modal, modalFocusId)?.focus?.();
        }
        if (state.restoreFocus) {
            state.restoreFocus = false;
            if (modalOnly) onModalClose?.();
            else openModal.focus?.();
        }
    };

    const destroy = () => {
        destroyed = true;
        currentModal = null;
        container.replaceChildren();
    };

    update();
    const open = () => { state.modalOpen = true; update(); };

    return { update, destroy, openModal: open };
}

function findByTestId(root, id) {
    if (!root) return null;
    if (root.dataset?.testid === id) return root;
    for (const child of root.children || []) {
        const match = findByTestId(child, id);
        if (match) return match;
    }
    return null;
}

function renderCareerModal(careers, selectedCareer, context, state, update, onTalent) {
    const dialog = element('dialog', 'career-viewer-modal');
    dialog.setAttribute('aria-label', 'Détail complet des carrières');
    const header = element('header', 'career-viewer-modal-header');
    header.append(element('h2', '', 'Carrières · référence et adaptation'));
    const close = element('button', '', 'Fermer');
    close.dataset.testid = 'close-modal';
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    header.append(close);
    dialog.append(header);

    const adapted = checkboxControl('Version adaptée à cette fiche', state.adapted);
    adapted.input.dataset.testid = 'mode-adapte-modal';
    adapted.input.addEventListener('change', () => { state.adapted = adapted.input.checked; update(); });
    dialog.append(adapted.label);
    const careerControl = selectControl('Carrière', careers.map(career => ({ value: career.id, label: careerOptionLabel(career) })), selectedCareer.id);
    careerControl.select.dataset.testid = 'carriere-modal';
    careerControl.select.addEventListener('change', () => {
        state.modalCareerId = careerControl.select.value;
        update();
    });
    dialog.append(careerControl.label);
    if (selectedCareer.prereq?.career) {
        const prereqRank = selectedCareer.prereq.minRang;
        dialog.append(element('p', 'career-viewer-prereq', `Prérequis : ${selectedCareer.prereq.career}${prereqRank ? `, rang ${prereqRank} minimum` : ''}`));
    }
    const overview = element('div', 'career-viewer-overview');
    overview.append(element('h3', '', selectedCareer.nom));
    if (selectedCareer.source) overview.append(element('p', '', `Source : ${selectedCareer.source}`));
    dialog.append(overview);
    const ranks = ranksOf(selectedCareer);
    const overrides = state.adapted ? context.careerOverrides || {} : {};
    for (const rank of ranks) {
        const variants = variantsAt(selectedCareer, rank);
        const savedTitle = context.chosenVariants?.[selectedCareer.id]?.[rank];
        const previewTitle = state.variantTitles?.[selectedCareer.id]?.[rank] ?? savedTitle;
        if (variants.length > 1) {
            const control = selectControl(`Variante du rang ${rank}`, variants.map(item => ({ value: item.titre, label: item.titre })), previewTitle || variants[0].titre);
            control.select.addEventListener('change', () => {
                state.variantTitles ||= {};
                state.variantTitles[selectedCareer.id] ||= {};
                state.variantTitles[selectedCareer.id][rank] = control.select.value;
                update();
            });
            dialog.append(control.label);
        }
        renderRank(dialog, selectedCareer, rank, selectedVariant(selectedCareer, rank, previewTitle) || variants[0] || null, overrides, onTalent, context);
    }
    dialog.addEventListener('close', () => {
        if (state.modalOpen) {
            state.modalOpen = false;
            state.modalCareerId = null;
            state.restoreFocus = true;
            update();
        }
    });
    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        dialog.close();
    });
    return dialog;
}

import { careerProgress } from '../fiche-career-model.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

function button(documentRef, text, className, onClick) {
    const node = make(documentRef, 'button', text, className);
    node.type = 'button';
    node.addEventListener('click', () => onClick(node));
    return node;
}

/**
 * Onglet Carrière : rang courant, trois jauges d'achèvement, achat du rang suivant, aperçu, changement de carrière,
 * visionneuse complète et historique. Les actions passent leur bouton à onBuyRank / onChangeCareer / onOpenAll(bouton) :
 * l'achat lui-même vit dans le volet d'achat. Construit une fois ; update() ne réécrit que les textes et les listes.
 */
export function createCareerPanel({ documentRef, onBuyRank = () => {}, onChangeCareer = () => {}, onOpenAll = () => {} }) {
    const root = make(documentRef, 'div', '', 'm-career');
    const missing = make(documentRef, 'p', 'Carrière non reconnue : consultez la liste des carrières.', 'm-principal-note');

    const card = make(documentRef, 'section', '', 'm-career-card');
    const line = make(documentRef, 'p', '', 'm-career-line');
    const head = make(documentRef, 'div', '', 'm-career-head');
    const title = make(documentRef, 'h3', '', 'm-career-title');
    const rankLabel = make(documentRef, 'span', '', 'm-career-rank');
    head.append(title, rankLabel);
    const gaugesTitle = make(documentRef, 'h4', 'Pour achever le rang', 'm-principal-title');
    const gauges = make(documentRef, 'ul', '', 'm-career-gauges');
    const gaugeNodes = [0, 1, 2].map(() => {
        const li = make(documentRef, 'li');
        const top = make(documentRef, 'div', '', 'm-career-gauge-head');
        const label = make(documentRef, 'span');
        const value = make(documentRef, 'strong');
        const bar = make(documentRef, 'div', '', 'm-career-bar');
        bar.setAttribute('aria-hidden', 'true');
        const fill = make(documentRef, 'div', '', 'm-career-fill');
        bar.append(fill);
        const detail = make(documentRef, 'p', '', 'm-career-detail');
        top.append(label, value);
        li.append(top, bar, detail);
        gauges.append(li);
        return { label, value, fill, detail };
    });
    const buy = button(documentRef, '', 'm-button m-button-primary', onBuyRank);
    const buyNote = make(documentRef, 'p', '100 XP une fois le rang achevé, 200 XP sinon.', 'm-principal-note');
    const maxRank = make(documentRef, 'p', 'Rang maximal', 'm-career-max');
    card.append(line, head, gaugesTitle, gauges, buy, buyNote, maxRank);

    const preview = make(documentRef, 'details', '', 'm-career-preview');
    const summary = make(documentRef, 'summary', '', 'm-career-summary');
    const previewBody = make(documentRef, 'div', '', 'm-career-preview-body');
    preview.append(summary, previewBody);

    const actions = make(documentRef, 'div', '', 'm-career-actions');
    const change = button(documentRef, 'Changer de carrière', 'm-button', onChangeCareer);
    const all = button(documentRef, 'Toutes les carrières', 'm-button', onOpenAll);
    actions.append(change, all);

    const history = make(documentRef, 'section', '', 'm-career-history');
    const historyList = make(documentRef, 'ul', '', 'm-career-history-list');
    history.append(make(documentRef, 'h4', 'Historique', 'm-principal-title'), historyList);
    root.append(missing, card, preview, actions, history);

    const variantBlock = variant => {
        const block = make(documentRef, 'div', '', 'm-career-variant');
        block.append(make(documentRef, 'h5', variant.statut ? `${variant.title} — ${variant.statut}` : variant.title));
        const facts = make(documentRef, 'dl', '', 'm-apt-facts');
        for (const [label, values] of [['Caractéristiques', variant.caracs], ['Compétences', variant.skills], ['Talents', variant.talents]]) {
            const cell = make(documentRef, 'div');
            cell.append(make(documentRef, 'dt', label), make(documentRef, 'dd', values.join(' · ') || 'Aucun'));
            facts.append(cell);
        }
        block.append(facts);
        return block;
    };

    return Object.freeze({
        element: root,
        update({ data, careers, engine }) {
            const progress = careerProgress(data, engine, careers);
            for (const node of [card, preview, history, change]) node.hidden = !progress;
            missing.hidden = !!progress;
            if (!progress) return;
            line.textContent = [progress.career, progress.statut].filter(Boolean).join(' · ');
            title.textContent = progress.title || progress.career;
            rankLabel.textContent = `Rang ${progress.rank}`;
            progress.gauges.forEach((gauge, index) => {
                const node = gaugeNodes[index];
                node.label.textContent = gauge.label;
                node.value.textContent = `${gauge.done} / ${gauge.total}`;
                node.fill.style.setProperty('--gauge', String(gauge.total ? Math.round(100 * gauge.done / gauge.total) : 100));
                node.detail.textContent = gauge.detail;
            });
            buy.hidden = !progress.hasNext;
            buyNote.hidden = !progress.hasNext;
            maxRank.hidden = progress.hasNext;
            buy.textContent = `Passer au rang ${progress.nextRank} — ${progress.nextCost} XP`;
            preview.hidden = !progress.hasNext;
            summary.textContent = progress.hasNext
                ? `Rang ${progress.nextRank} · ${progress.next.map(variant => variant.title).join(' / ')}` : '';
            previewBody.replaceChildren(...progress.next.map(variantBlock));
            historyList.replaceChildren(...progress.history.map(entry => {
                const li = make(documentRef, 'li');
                li.append(make(documentRef, 'span', entry.nom),
                    make(documentRef, 'span', entry.current ? `Rang ${entry.rang} · en cours` : `Rang ${entry.rang}`, 'm-career-history-rank'));
                return li;
            }));
        },
    });
}

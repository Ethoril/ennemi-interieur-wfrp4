import { xpBalance } from '../../fiche/derived.js';
import { createBottomSheet } from '../components/bottom-sheet.js';
import { purchaseErrorMessage, purchasePayload, purchasePreview, purchaseTarget } from '../fiche-purchase.js';
import { createSpecialtySection } from './fiche-specialty.js';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Volet d'achat d'avances (caractéristique, compétence) ou de talent.
 * `getContext()` → { state (contrôleur), careers, engine, online, controller }.
 * open(spec, trigger) : spec = { kind: 'carac', key } | { kind: 'skill', ...ligne de skillRows } | { kind: 'talent', nom } | { kind: 'sort' | 'miracle', nom }
 * | { kind: 'rank', rankMode, careerId?, targetRank? } (rang suivant ou changement de carrière : une seule avance, sans stepper).
 * Une compétence à spécialités ajoute son bloc (champ de base, ou « Ajouter une spécialité » qui re-cible le volet) ;
 * un talent ajoute sa description publiée et son nombre de prises ; un sort ou un miracle sa description publiée et son palier de coût.
 * Le contenu est construit une fois par ouverture puis mis à jour sur place (le focus reste sur +/−).
 */
export function createPurchaseSheet({ documentRef, getContext, announce = () => {} }) {
    const sheet = createBottomSheet({ documentRef, labelledBy: 'm-purchase-title' });
    let spec = null;
    let count = 1;
    let busy = false;
    let error = '';
    let info = '';
    let nodes = null;
    let shownDescription = '';
    let customPick = false;
    let chipsFor = '';

    const build = body => {
        const head = make(documentRef, 'div', '', 'm-purchase-head');
        head.setAttribute('data-sheet-drag', '');
        const titles = make(documentRef, 'div');
        const title = make(documentRef, 'h2', '', 'm-purchase-title');
        title.id = 'm-purchase-title';
        title.tabIndex = -1;
        const nature = make(documentRef, 'p', '', 'm-purchase-nature');
        titles.append(title, nature);
        const total = make(documentRef, 'p', '', 'm-purchase-total');
        head.append(titles, total);
        const formula = make(documentRef, 'p', '', 'm-purchase-formula');
        const specialty = createSpecialtySection({ documentRef, getContext, announce, onChoose: choose });
        // Spécialité d'un talent « au choix » ou « A ou B » : puces des choix, plus « Autre… » (saisie libre) pour les emplacements ouverts.
        const picker = make(documentRef, 'div', '', 'm-spec-block');
        const pickLabel = make(documentRef, 'p', 'Spécialité', 'm-spec-label');
        const pickChoices = make(documentRef, 'div', '', 'm-spec-choices');
        pickChoices.setAttribute('role', 'group');
        pickChoices.setAttribute('aria-label', 'Spécialité du talent');
        const pickFree = make(documentRef, 'input', '', 'm-search-input');
        pickFree.type = 'text';
        pickFree.autocomplete = 'off';
        pickFree.setAttribute('maxlength', '200');
        pickFree.setAttribute('aria-label', 'Autre spécialité');
        picker.append(pickLabel, pickChoices, pickFree);
        pickFree.addEventListener('input', () => pickSpecialty(pickFree.value, true));
        const talent = make(documentRef, 'div', '', 'm-purchase-talent');
        const taken = make(documentRef, 'p', '', 'm-purchase-taken');
        const description = make(documentRef, 'div', '', 'm-purchase-description');
        talent.append(taken, description);

        const stepper = make(documentRef, 'div', '', 'm-purchase-stepper');
        const stepLabel = make(documentRef, 'span', 'Avances à acheter', 'm-purchase-step-label');
        const less = make(documentRef, 'button', '−', 'm-purchase-step');
        less.type = 'button';
        less.setAttribute('aria-label', 'Une avance de moins');
        const value = make(documentRef, 'span', '', 'm-purchase-count');
        value.setAttribute('role', 'status');
        const more = make(documentRef, 'button', '+', 'm-purchase-step');
        more.type = 'button';
        more.setAttribute('aria-label', 'Une avance de plus');
        stepper.append(stepLabel, less, value, more);

        const figures = make(documentRef, 'dl', '', 'm-purchase-figures');
        const figure = (label, className = '') => {
            const cell = make(documentRef, 'div');
            const dd = make(documentRef, 'dd', '', className);
            cell.append(make(documentRef, 'dt', label), dd);
            figures.append(cell);
            return dd;
        };
        const newTotal = figure('Nouveau total');
        const cost = figure('Coût', 'm-purchase-cost');
        const after = figure('Restera');

        const tariff = make(documentRef, 'p', '', 'm-purchase-note');
        const reason = make(documentRef, 'p', '', 'm-purchase-reason');
        const failure = make(documentRef, 'p', '', 'm-purchase-error');
        failure.setAttribute('role', 'alert');
        const buy = make(documentRef, 'button', '', 'm-button m-button-primary');
        buy.type = 'button';
        const retry = make(documentRef, 'button', 'Réessayer', 'm-button m-button-primary');
        retry.type = 'button';

        less.addEventListener('click', () => step(-1));
        more.addEventListener('click', () => step(1));
        buy.addEventListener('click', () => run(context => context.controller.executeOnlineCommand(
            'purchase', purchasePayload(target(context), count, context.engine)), true));
        retry.addEventListener('click', () => run(context => context.controller.retryPendingCommand(), false));

        body.replaceChildren(head, formula, specialty.element, picker, talent, stepper, figures, tariff, reason, failure, buy, retry);
        shownDescription = '';
        nodes = { title, nature, total, formula, specialty, picker, pickChoices, pickFree, talent, taken, description, stepper, less, value, more, newTotal, cost, after, tariff, reason, failure, buy, retry };
    };

    // Re-cible le volet sur une nouvelle ligne avancée du groupe ; faux si le nom ne peut pas être acheté ainsi.
    function choose(name) {
        const next = { kind: 'skill', newName: name };
        const context = getContext();
        if (!purchaseTarget(context.state?.data, context.engine, context.careers, next)) return false;
        spec = next;
        count = 1;
        error = '';
        refresh();
        nodes.title.focus();
        return true;
    }

    function pickSpecialty(pick, custom) {
        spec = { ...spec, pick };
        customPick = custom;
        error = '';
        refresh();
    }

    // Les puces sont créées une fois par emplacement, puis seulement mises à jour (le focus reste sur la puce touchée).
    function updateChoices(choice) {
        nodes.picker.hidden = !choice;
        if (!choice) return;
        const chip = (label, onClick) => {
            const button = make(documentRef, 'button', label, 'm-chip');
            button.type = 'button';
            button.addEventListener('click', onClick);
            return button;
        };
        if (chipsFor !== choice.base) {
            chipsFor = choice.base;
            nodes.pickChoices.replaceChildren(...choice.options.map(({ spec: name }) => chip(name, () => {
                nodes.pickFree.value = '';
                pickSpecialty(name, false);
            })), ...(choice.free ? [chip('Autre…', () => {
                pickSpecialty(nodes.pickFree.value, true);
                nodes.pickFree.focus();
            })] : []));
        }
        choice.options.forEach(({ spec: name, taken }, index) => {
            const button = nodes.pickChoices.children[index];
            button.textContent = taken ? `${name} · déjà acquis` : name;
            button.setAttribute('aria-pressed', String(!customPick && choice.pick === name));
        });
        if (choice.free) nodes.pickChoices.children[choice.options.length].setAttribute('aria-pressed', String(customPick));
        nodes.pickFree.hidden = !(choice.free && customPick);
    }

    const target = context => purchaseTarget(context.state?.data, context.engine, context.careers, spec);

    const refresh = () => {
        const context = getContext();
        const current = target(context);
        const pending = !!context.state.pendingOperationId && !busy;
        if (info && !context.state.pendingOperationId && !busy) {
            // Le snapshot attendu est arrivé : l'achat est confirmé (un rang acheté invalide déjà sa cible).
            info = '';
            sheet.close();
            announce('Achat confirmé');
            return;
        }
        // Pendant l'envoi, un snapshot déjà arrivé peut périmer la cible : run() ferme et annonce au retour.
        if (!current) {
            if (busy) return;
            const confirmed = info;
            info = '';
            sheet.close();
            if (confirmed) announce('Achat confirmé');
            return;
        }
        const talent = current.kind === 'talent';
        const rank = current.kind === 'rank';
        // Sort ou miracle : une seule prise, décrite comme un talent (paragraphes publiés), sans stepper.
        const magic = current.kind === 'sort' || current.kind === 'miracle';
        const counted = !talent && !rank && !magic;
        count = Math.min(count, current.maxCount);
        const balance = xpBalance(context.state.data).libre;
        const preview = purchasePreview(current, count, balance);

        nodes.title.textContent = current.title;
        nodes.nature.textContent = `${current.nature}${current.inCareer ? ' · de carrière' : ''}`;
        nodes.total.textContent = counted ? String(current.total) : '';
        nodes.total.hidden = !counted;
        nodes.formula.textContent = rank ? current.summary
            : talent ? '' : `${current.baseLabel} ${current.baseValue} + ${current.adv} avances = ${current.total}`;
        nodes.formula.hidden = talent || magic;
        nodes.stepper.hidden = !counted;
        nodes.specialty.update(current);
        nodes.talent.hidden = !talent && !magic;
        updateChoices(current.choice);
        if (talent || magic) {
            nodes.taken.textContent = magic || current.needsChoice ? '' : current.taken ? `Prises : ${current.taken}` : 'Pas encore acquis';
            const key = JSON.stringify(current.description);
            if (shownDescription !== key) {
                shownDescription = key;
                nodes.description.replaceChildren(...(current.description.length ? current.description : ['Aucune description publiée'])
                    .map(line => make(documentRef, 'p', line)));
            }
        }
        nodes.value.textContent = String(count);
        nodes.less.disabled = busy || count <= 1;
        nodes.more.disabled = busy || count >= current.maxCount;
        nodes.newTotal.textContent = rank ? `Rang ${current.targetRank}` : talent || magic ? 'Acquis' : String(preview.newTotal);
        nodes.cost.textContent = `${preview.cost} XP`;
        nodes.after.textContent = `${preview.after} XP`;
        nodes.after.className = preview.affordable ? '' : 'm-purchase-short';
        nodes.tariff.textContent = magic ? current.tariff : rank ? (current.complete ? 'Rang achevé : 100 XP' : 'Rang non achevé : 200 XP')
            : current.inCareer ? 'Tarif carrière' : 'Hors carrière : coût doublé';

        const phase = context.state.phase;
        const reason = !context.online ? 'Achat possible une fois en ligne'
            : phase === 'legacy-readonly' ? 'Fiche en lecture seule : achat impossible'
            : !pending && !busy && phase !== 'ready' ? 'Fiche en cours de mise à jour…'
            : current.needsChoice ? 'Choisissez une spécialité'
            : !pending && !preview.affordable ? `XP insuffisants : il manque ${-preview.after} XP` : info;
        nodes.reason.textContent = reason;
        nodes.reason.hidden = !reason;
        nodes.failure.textContent = error;
        nodes.failure.hidden = !error;
        nodes.buy.textContent = busy ? 'Achat en cours…' : `Acheter pour ${preview.cost} XP`;
        nodes.buy.disabled = busy || !!reason;
        nodes.buy.hidden = pending;
        nodes.retry.hidden = !pending;
        nodes.retry.disabled = !context.online;
    };

    function step(delta) {
        const current = target(getContext());
        if (!current) return;
        count = Math.max(1, Math.min(current.maxCount, count + delta));
        error = '';
        refresh();
    }

    // Un achat n'est jamais renvoyé : « Réessayer » rejoue la commande en attente (même identifiant, pas de double débit).
    async function run(execute, fresh) {
        const context = getContext();
        const current = target(context);
        if (busy || !current) return;
        const message = current.kind === 'talent' ? `${current.title} : talent acheté`
            : current.kind === 'rank' ? `${current.summary} : achat enregistré`
            : current.kind === 'sort' ? `${current.title} : sort appris`
            : current.kind === 'miracle' ? `${current.title} : miracle appris`
            : `${current.title} : +${count} avance${count > 1 ? 's' : ''} achetée${count > 1 ? 's' : ''}`;
        busy = true;
        error = '';
        info = '';
        refresh();
        try {
            const result = await execute(context);
            if (result?.status === 'retry-required') error = 'Un achat précédent est en attente. Utilisez Réessayer.';
            else if (result?.status === 'awaiting-snapshot') info = 'Achat en cours de confirmation…';
            else if (result?.status === 'confirmed') {
                sheet.close();
                announce(fresh ? message : 'Achat confirmé');
            }
        } catch (failure) {
            error = purchaseErrorMessage(failure);
        } finally {
            busy = false;
            if (sheet.isOpen()) {
                refresh();
                // Le bouton était désactivé pendant l'envoi : le focus a été perdu.
                const next = !nodes.retry.hidden ? nodes.retry : nodes.buy.disabled ? null : nodes.buy;
                next?.focus();
            }
        }
    }

    return Object.freeze({
        element: sheet.element,
        open(next, trigger) {
            spec = next;
            if (!target(getContext())) return;
            count = 1;
            customPick = false;
            chipsFor = '';
            busy = false;
            error = '';
            sheet.open({ trigger, render: body => { build(body); refresh(); } });
            // Le premier champ serait la spécialité : ne pas ouvrir le clavier à l'ouverture du volet.
            if (!nodes.specialty.element.hidden) nodes.title.focus();
        },
        update() { if (sheet.isOpen()) refresh(); },
        close: sheet.close,
        destroy: sheet.destroy,
    });
}

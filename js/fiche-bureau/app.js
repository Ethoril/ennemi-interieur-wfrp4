import { esc, stripAccents } from '../utils.js';
import { CARACS, ficheIdentity, ficheCaracs, resourceTokens, dotTarget, resourceChange, xpLogRows } from '../mobile/fiche-model.js';
import { talentRows, talentTaken, spellRows, learnRows } from '../mobile/fiche-aptitudes-model.js';
import { careerProgress, careerChangeOptions } from '../mobile/fiche-career-model.js';
import { purchasePayload, purchaseErrorMessage, cancelErrorMessage } from '../mobile/fiche-purchase.js';
import { blessuresMax, mouvement, xpBalance } from '../fiche/derived.js';
import { publishedSkillRows } from '../catalogue/skill-forms.js';
import { isTalentInCareer, findCareerByName } from '../fiche/career-model.js';
import { createCareerViewer } from '../fiche/career-viewer.js';
import { bureauSkills, roleControls, inspectorModel, missingChips, correctionChanges, correctionOverlay, correctionMatches } from './model.js';
import { connectBureau, loadBureauCatalogues } from './session.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const charId = params.get('char');
const validIds = ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren', 'test'];
const races = { humain: 'Humain', nain: 'Nain', halfelin: 'Halfelin', 'haut-elfe': 'Haut Elfe', 'elfe-sylvain': 'Elfe Sylvain', ogre: 'Ogre', elfe: 'Elfe', halfling: 'Halfelin' };
const portraits = { bhelgi: 'Bhelgi', caelel: 'Caelel', elysia: 'Elysia', hellaya: 'Hellaya', wren: 'Wren' };
let state = { phase: 'loading', data: null };
let controller;
let catalogues;
let selection = null;
let selectionOrigin = null;
let advances = 1;
let mode = 'buy';

let correctionItems = [];
let correctionReason = '';
let correctionFeedback = '';
let message = '';
let lastFailure = null;
let searchQuery = '';
let viewer;
let patchTimer;
let sessionKey = '';
const fold = value => stripAccents(String(value)).toLowerCase();
const specButton = (label, spec, className = '', attrs = '') => {
    return `<button type="button" class="${esc(className)}" data-action="select" data-origin="${esc(JSON.stringify(spec))}" ${attrs}>${label}</button>`;
};
const action = (name, label, disabled = false) => `<button type="button" data-action="${esc(name)}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`;
const card = (title, content) => `<section class="bureau-card"><h2>${esc(title)}</h2>${content}</section>`;
const readPath = (data, parts) => {
    let value = data;
    for (const part of parts) value = Array.isArray(value) ? value.find(row => row.id === part) : value?.[part];
    return value ?? null;
};
const correctionConflicts = () => correctionItems.filter(item => !item.pathParts.includes('@new')
    && JSON.stringify(readPath(state.envelope?.data || state.data, item.pathParts)) !== JSON.stringify(item.baseValue));

function renderSkills() {
    const filter = $('skill-filter').value;
    const rows = bureauSkills(state.data, catalogues.engine, catalogues.careers, { query: $('skill-query').value, career: filter === 'career', trained: filter === 'trained' });
    $('bureau-skills').innerHTML = [true, false].map(trained => {
        const group = rows.filter(row => (row.adv > 0) === trained);
        return `<h3>${trained ? 'Entraînées' : 'Non entraînées'} · ${group.length}</h3><div class="bureau-skill-columns">${group.map(row => specButton(
            `<span class="bureau-career-dot" aria-hidden="true">${row.inCareer ? '●' : ''}</span><span class="bureau-skill-name">${esc(row.nom)}</span><small>${esc(row.caracAbbr)}</small><small>${row.adv ? `+${esc(row.adv)}` : '—'}</small><strong>${esc(row.total)}</strong><span class="bureau-plus" aria-hidden="true">+</span>`,
            { ...row, kind: 'skill' }, `bureau-skill ${trained ? 'is-trained' : ''}`,
            `aria-label="${esc(`${row.nom}, ${row.caracAbbr}, ${row.adv} avances, total ${row.total}${row.inCareer ? ', de carrière' : ''}. Détail`)}"`)).join('')}</div>`;
    }).join('');
}

function renderHeader() {
    const data = state.data;
    const identity = ficheIdentity(data, catalogues.careers);
    const xp = xpBalance(data);
    const controls = roleControls(state);
    const resources = [['destin', 'chance', 'Destin', 'Chance'], ['resilience', 'determination', 'Résilience', 'Détermination']].map(([maxKey, currentKey, title, label]) => {
        const tokens = resourceTokens(data, maxKey, currentKey);
        return `<div><button class="bureau-resource-title" data-action="resource-max" data-max="${maxKey}" data-current="${currentKey}" ${controls.editable ? '' : 'disabled'}>${title} ${esc(tokens.max)}</button><div>${label} ${Array.from({ length: Math.min(100, tokens.max) }, (_, i) => `<button type="button" class="bureau-pip" data-action="pip" data-key="${currentKey}" data-value="${dotTarget(tokens.current, i)}" aria-label="${esc(`${label} : ${i < tokens.current ? 'dépenser' : 'récupérer'}, passer à ${dotTarget(tokens.current, i)} sur ${tokens.max}`)}" aria-pressed="${i < tokens.current}" ${controls.editable ? '' : 'disabled'}></button>`).join('')}</div></div>`;
    }).join('');
    $('bureau-header').innerHTML = `${portraits[charId] ? `<img class="bureau-portrait" src="img/${portraits[charId]}.webp" alt="Portrait de ${esc(identity.nom)}">` : `<div class="bureau-portrait" aria-hidden="true">${esc(identity.nom.slice(0, 2).toUpperCase() || '⚜')}</div>`}<div class="bureau-identity"><h1>${esc(identity.nom || 'Personnage')}</h1><p>${esc(`${races[data.race] || data.race || ''} · ${identity.carriere} — ${identity.titreRang} · Rang ${identity.rang} · ${identity.statut}`)}</p>${controls.mj ? action('identity', 'Corriger l’identité', !controls.actions) : ''}</div><div class="bureau-resources">${resources}</div><div class="bureau-xp"><a href="#journal"><strong>${esc(xp.libre)}</strong>XP libres</a><small>Gagnés ${esc(xp.gagne)}<br>Dépensés ${esc(xp.depense)}</small></div><details class="bureau-menu"><summary aria-label="Plus d’actions">⋯</summary><div class="bureau-menu-panel">${action('export', 'Exporter en JSON')}${controls.mj ? action('import', 'Importer un JSON', !navigator.onLine || !['ready', 'missing', 'tombstone'].includes(state.phase)) : ''}<a href="fiche-ancienne.html?${esc(params.toString())}">Ancienne fiche</a></div></details>`;
    document.title = `${identity.nom || 'Personnage'} — Fiche de personnage`;
}

function renderLeft() {
    const data = state.data;
    const editable = roleControls(state).editable;
    const maximum = blessuresMax(data);
    $('bureau-left').innerHTML = card('Caractéristiques', `<div class="bureau-caracs">${ficheCaracs(data, catalogues.careers).map(c => specButton(`<span>${esc(c.abbr)}</span><strong><em>${esc(Math.floor(c.total / 10))}</em>${esc(c.total % 10)}</strong>`, { kind: 'carac', key: c.key }, `bureau-carac ${c.career ? 'is-career' : ''}`, `aria-label="${esc(`${c.nom} ${c.total}, bonus ${c.bonus}${c.career ? ', de carrière' : ''}. Détail`)}"`)).join('')}</div><p class="bureau-muted">Cadre doré : caractéristique de carrière. Un clic ouvre le détail.</p>`)
        + card('État', `<div class="bureau-state-row"><label for="blessures-act">Blessures actuelles</label><div class="bureau-stepper"><button data-action="wounds" data-delta="-1" aria-label="Diminuer les blessures actuelles" ${editable ? '' : 'disabled'}>−</button><input id="blessures-act" data-patch="blessuresAct" aria-label="Blessures actuelles" type="number" min="0" value="${esc(data.blessuresAct || 0)}" ${editable ? '' : 'disabled'}><button data-action="wounds" data-delta="1" aria-label="Augmenter les blessures actuelles" ${editable ? '' : 'disabled'}>+</button></div></div><progress max="${Math.max(1, maximum)}" value="${Math.max(0, +data.blessuresAct || 0)}" aria-label="Blessures disponibles"></progress><div class="bureau-state-row"><span>Mouvement</span><strong>${mouvement(data)}</strong></div><div class="bureau-state-row"><span>Blessures max</span><strong>${maximum}</strong></div><div class="bureau-state-row"><label for="corruption">Corruption</label><input id="corruption" data-patch="corruption" type="number" min="0" value="${esc(data.corruption || 0)}" ${editable ? '' : 'disabled'}></div>`)
        + card('Possessions et notes', `<label class="bureau-sr" for="possessions">Possessions et notes</label><textarea id="possessions" data-patch="possessions" ${editable ? '' : 'disabled'}>${esc(data.possessions || '')}</textarea><small class="bureau-muted">Enregistrement automatique</small>`);
}

function renderAptitudes() {
    const data = state.data;
    const engine = catalogues.engine;
    const career = findCareerByName(catalogues.careers, data.carriere || '');
    const talents = talentRows(data, engine, catalogues.careers);
    $('bureau-talents').innerHTML = [true, false].map(acquired => `<h3>${acquired ? 'Acquis' : 'À prendre dans la carrière'}</h3><div class="bureau-talents">${talents.filter(t => t.acquired === acquired).map(t => {
        const inCareer = career && isTalentInCareer(career, +data.rang || 1, t.nom, data.chosenVariants, data.careerOverrides, engine.talentResolver);
        return specButton(`${esc(t.label)}<small>${acquired ? `${inCareer ? 'De carrière' : 'Hors carrière'} · ×${t.count}${t.issue ? ' · À revoir avec le MJ' : ''}` : t.cost === undefined ? 'Spécialité à choisir' : `${t.cost} XP`}</small>`, { kind: 'talent', nom: t.nom }, `bureau-talent ${acquired ? '' : 'is-available'}`);
    }).join('') || '<p class="bureau-muted">Aucun pour l’instant</p>'}</div>`).join('');
    const spells = spellRows(data, engine);
    $('bureau-spells').innerHTML = [...spells.spells, ...spells.prayers].map(row => specButton(`${esc(row.nom)} <small>${esc(row.type)}</small>`, { kind: 'consult', row }, 'bureau-talent')).join('') || '<p class="bureau-muted">Aucun pour l’instant</p>';
}

function renderCareer() {
    const progress = careerProgress(state.data, catalogues.engine, catalogues.careers);
    if (!progress) return '<h2>Carrière en cours</h2><p>Aucune carrière sélectionnée.</p>';
    const chips = missingChips(state.data, catalogues.engine, catalogues.careers);
    return `<h2>Carrière en cours</h2><h3>${esc(progress.career)}</h3><p>${esc(`${progress.title} · Rang ${progress.rank} · ${progress.statut}`)}</p>${progress.gauges.map((g, i) => `<div><strong>${esc(g.label)}</strong> <span>${g.done}/${g.total}</span><progress max="${Math.max(1, g.total)}" value="${g.done}" aria-label="${esc(`${g.label} : ${g.done} sur ${g.total}`)}"></progress><div class="bureau-chips">${chips[i].map(chip => specButton(esc(chip.label), chip.spec, 'bureau-chip')).join('')}</div><p class="bureau-muted">${esc(g.detail)}</p></div>`).join('')}${progress.hasNext ? specButton(esc(`Rang ${progress.nextRank} · ${progress.next[0]?.title || ''} — ${progress.nextCost} XP`), { kind: 'rank', rankMode: 'advanceRank' }, 'bureau-purchase') : '<p>Dernier rang atteint</p>'}<details><summary>Historique des carrières</summary>${progress.history.map(row => `<p>${esc(row.nom)} · Rang ${row.rang}${row.current ? ' · En cours' : ''}</p>`).join('')}${roleControls(state).mj ? action('archive', '+ Ancienne carrière', !roleControls(state).actions) : ''}</details><div class="bureau-actions">${action('viewer', 'Toutes les carrières')}${action('change-career', 'Changer de carrière')}</div>`;
}

function renderCorrection() {
    const data = correctionOverlay(state.data, correctionItems);
    let fields = '';
    if (selection.kind === 'identity') fields = `<label>Nom<input name="nom" value="${esc(data.nom || '')}" required maxlength="200"></label><label>Race<select name="race">${Object.entries(races).map(([key, label]) => `<option value="${key}" ${data.race === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>`;
    if (selection.kind === 'carac') fields = ['base', 'adv'].map(key => `<label>${key === 'base' ? 'Base' : 'Avances'}<input name="${key}" type="number" min="0" max="10000" value="${esc(data.carac[selection.key][key])}" required></label>`).join('');
    if (selection.kind === 'skill') fields = `<label>Avances<input name="adv" type="number" min="0" max="10000" value="${esc(selection.row ? data.skillsBasic?.[selection.row] || 0 : data.skillsAdvanced.find(row => row.id === selection.targetId)?.adv || 0)}" required></label>`;
    if (selection.kind === 'talent') fields = `<label>Nombre de prises (0 pour retirer)<input name="taken" type="number" min="0" max="50" value="${talentTaken(data, catalogues.engine, selection.nom)}" required></label>`;
    return `<form id="bureau-correction-form" class="bureau-correction-form">${fields}<p>Aucune XP débitée. La correction sera ajoutée au lot MJ du journal.</p><button ${roleControls(state).actions ? '' : 'disabled'}>Ajouter aux corrections MJ</button><p id="bureau-correction-feedback" role="status" aria-live="polite">${esc(correctionFeedback)}</p><a href="#journal">Consulter les corrections MJ dans le journal</a></form>`;
}

function renderSearch() {
    const kind = selection.searchKind;
    const words = fold(searchQuery).split(/\s+/u).filter(Boolean);
    let choices = [];
    if (kind === 'skill') choices = publishedSkillRows(catalogues.engine.skillResolver).filter(row => !row.basic).map(row => ({ label: row.nom, spec: { kind: 'skill', newName: row.nom } }));
    if (kind === 'talent') choices = (catalogues.engine.talentResolver.entries || []).filter(row => {
        const status = catalogues.engine.talentResolver.purchaseStatus?.(state.data, row.nom);
        return row.published !== false && (!status || (status.known && !status.reached));
    }).map(row => ({ label: catalogues.engine.resolveTalent(row.nom).displayedName || row.nom, spec: { kind: 'talent', nom: row.nom } }));
    if (kind === 'sort' || kind === 'miracle') choices = learnRows(catalogues.engine, state.data, kind).map(row => ({ label: `${row.nom} · ${row.cost} XP`, spec: { kind, nom: row.nom } }));
    if (kind === 'career') choices = careerChangeOptions(state.data, catalogues.careers, { query: searchQuery, targetRank: selection.targetRank || 1 }).map(row => ({ label: `${row.nom}${row.reason ? ` — ${row.reason}` : ''}`, disabled: !row.ok, spec: { kind: 'rank', rankMode: 'changeCareer', careerId: row.id, targetRank: selection.targetRank || 1 } }));
    const filtered = choices.filter(row => words.every(word => fold(row.label).includes(word)));
    return `<h2>${esc({ skill: 'Apprendre une compétence', talent: 'Talent hors carrière', sort: 'Apprendre un sort', miracle: 'Apprendre un miracle', career: 'Changer de carrière' }[kind])}</h2><label>Rechercher<input id="bureau-search" type="search" value="${esc(searchQuery)}" autocomplete="off"></label>${kind === 'career' ? `<label>Rang cible<select id="bureau-target-rank">${[1, 2, 3, 4, 5].map(rank => `<option ${rank === (selection.targetRank || 1) ? 'selected' : ''}>${rank}</option>`).join('')}</select></label>` : ''}<div id="bureau-results" class="bureau-results">${filtered.map(row => specButton(esc(row.label), row.spec, '', row.disabled ? 'disabled' : '')).join('') || '<p>Aucun résultat.</p>'}</div>`;
}

function renderInspector() {
    const active = document.activeElement;
    const focusedAction = active?.dataset?.action;
    const focusedValue = active?.dataset?.value;
    if (!selection) { $('bureau-inspector').innerHTML = renderCareer(); return; }
    let content;
    const controls = roleControls(state);
    if (selection.kind === 'search') content = renderSearch();
    else if (selection.kind === 'consult') content = `<h2>${esc(selection.row.nom)}</h2><p>${esc(selection.row.type)}</p>${selection.row.details.map(([label, value]) => `<p>${esc(label)} : ${esc(value)}</p>`).join('')}<p>${esc((catalogues.engine.ruleCatalog[selection.row.prayer ? 'miracles' : 'spells'].find(rule => fold(rule.nom) === fold(selection.row.nom))?.[selection.row.prayer ? 'effet' : 'desc']) || selection.row.resume)}</p>`;
    else if (selection.kind === 'identity') content = '<h2>Corriger l’identité</h2>' + (controls.mj ? renderCorrection() : '<p>Réservé au MJ.</p>');
    else {
        const model = inspectorModel(state.data, catalogues.engine, catalogues.careers, selection, state, navigator.onLine, advances);
        if (!model) content = '<h2>Détail</h2><p>Cette cible n’est plus disponible.</p>';
        else {
            const { target, preview, reason } = model;
            const canCorrect = controls.mj && ['carac', 'talent', 'skill'].includes(selection.kind) && (selection.kind !== 'skill' || selection.row || selection.targetId);
            content = `<p class="bureau-muted">${esc(target.nature)}${target.inCareer === undefined ? '' : target.inCareer ? ' · De carrière' : ' · Hors carrière'}</p><h2 id="bureau-detail-title" tabindex="-1">${esc(target.title)}</h2>${canCorrect ? `<div class="bureau-actions"><button data-action="buy-mode" aria-pressed="${mode === 'buy'}">Acheter</button><button data-action="correct-mode" aria-pressed="${mode === 'correct'}">Corriger</button></div>` : ''}`;
            if (mode === 'correct' && canCorrect) content += renderCorrection();
            else {
                if (target.choice) content += `<p>Choisir la spécialité</p><div class="bureau-chips">${target.choice.specs.map(pick => `<button class="bureau-chip" data-action="talent-pick" data-value="${esc(pick)}" aria-pressed="${pick === selection.pick}">${esc(pick)}</button>`).join('')}</div>${target.choice.free ? `<label>Autre spécialité<input id="bureau-talent-pick" value="${esc(selection.pick || '')}" maxlength="150"></label>` : ''}`;
                if (target.specialty?.kind === 'group') content += `<label>Spécialité<select id="bureau-skill-pick"><option value="">Choisir une spécialité…</option>${target.specialty.options.map(row => `<option value="${esc(row.nom)}" ${row.nom === target.name ? 'selected' : ''}>${esc(row.spec)}</option>`).join('')}</select></label>`;
                if (target.specialty?.kind === 'basic') content += `<label>Spécialité<select id="bureau-basic-pick" ${target.specialty.locked || !controls.editable ? 'disabled' : ''}><option value="">Sans spécialité</option>${target.specialty.options.map(value => `<option value="${esc(value)}" ${value === target.specialty.value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>`;
                if (selection.careerSpecialty) content += `<p class="bureau-muted">La carrière demande ${esc(selection.careerSpecialty)}. Choisissez cette spécialité avant l’achat.</p>`;
                if (target.total !== undefined) content += `<p>${esc(`${target.baseLabel} ${target.baseValue} + ${target.adv} avances = ${target.total}`)}</p>`;
                content += (target.description || []).map(line => `<p>${esc(line)}</p>`).join('');
                if (target.limitStatus) content += `<p>Limite d’achat : ${esc(target.limitStatus.limitText || 'inconnue')}</p>`
                    + (target.limitStatus.overLimit ? '<p>Acquisitions historiques au-delà de la limite : à revoir avec le MJ.</p>' : '')
                    + (target.limitStatus.warning ? `<p>${esc(target.limitStatus.warning)}</p>` : '');
                if (target.maxCount > 1) content += `<div class="bureau-stepper"><button data-action="advance-minus" aria-label="Réduire le nombre d’avances" ${advances <= 1 ? 'disabled' : ''}>−</button><output aria-label="Nombre d’avances">${advances}</output><button data-action="advance-plus" aria-label="Augmenter le nombre d’avances" ${advances >= 10 ? 'disabled' : ''}>+</button><span>avances</span></div>`;
                if (target.summary) content += `<p>${esc(target.summary)}</p><p>${target.complete ? 'Les trois objectifs sont atteints.' : `${careerProgress(state.data, catalogues.engine, catalogues.careers)?.gauges.reduce((sum, gauge) => sum + Math.max(0, gauge.total - gauge.done), 0) || 0} éléments manquants pour compléter la carrière.`}</p>`;
                content += `${preview.newTotal === null ? '' : `<p>Nouveau total : <strong>${esc(preview.newTotal)}</strong>${target.kind === 'carac' ? ` · Bonus ${Math.floor(preview.newTotal / 10)}` : ''}</p>`}<p>${esc(target.tariff || (target.inCareer === false ? 'Tarif hors carrière doublé' : 'Tarif de carrière'))}</p><p>Coût : <strong>${preview.cost} XP</strong></p><p class="${preview.after < 0 ? 'bureau-negative' : ''}">XP restantes : ${preview.after}</p><p id="bureau-purchase-reason">${esc(reason)}</p><button class="bureau-purchase" data-action="purchase" aria-describedby="bureau-purchase-reason" ${target.limitStatus?.reached || target.limitStatus?.known === false ? 'hidden' : ''} ${model.enabled ? '' : 'disabled'}>${target.taken ? 'Reprendre' : 'Acheter'} pour ${preview.cost} XP</button>`;
            }
        }
    }
    $('bureau-inspector').innerHTML = `<div class="bureau-inspector-title"><span class="bureau-muted">Inspecteur</span><button class="bureau-close" data-action="close" aria-label="Fermer le détail">×</button></div>${content}${lastFailure ? action('retry', 'Réessayer', !navigator.onLine) : ''}`;
    const replacement = focusedAction && [...$('bureau-inspector').querySelectorAll('[data-action]')].find(node => node.dataset.action === focusedAction && node.dataset.value === focusedValue);
    replacement?.focus({ preventScroll: true });
}

function renderJournal() {
    const rows = xpLogRows(state.data, catalogues.engine, state.uid);
    const controls = roleControls(state);
    const balance = xpBalance(state.data);
    const log = state.data.xpLog || [];
    $('bureau-journal').innerHTML = `<p>Gagnés ${balance.gagne} · Dépensés ${balance.depense} · Libres ${balance.libre}</p><table><thead><tr><th>Libellé</th><th>Nature</th><th>XP</th></tr></thead><tbody>${rows.map(row => {
        const original = log.find(item => item.id === row.key);
        const cancellable = controls.mj && original?.kind === 'purchase' && original.origin === 'command' && !original.cancelledByOperationId && original.purchaseId && Array.isArray(original.effects);
        return `<tr><td>${esc(row.label)}${row.cancelled ? ' · Annulé' : ''}</td><td>${esc(row.nature)}</td><td>${row.amount > 0 ? '+' : ''}${row.amount}${cancellable ? `<br><button data-action="cancel" data-id="${esc(original.purchaseId)}" ${controls.actions && navigator.onLine ? '' : 'disabled'}>Annuler</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="3">Aucun mouvement pour l’instant</td></tr>'}</tbody></table>${controls.mj ? `<div class="bureau-actions">${action('gain', '+ Gain d’XP', !controls.actions || !navigator.onLine)}${action('free-xp', 'Dépense libre', !controls.actions || !navigator.onLine)}</div>` : ''}`;
    $('bureau-recent').innerHTML = '<h2>Derniers mouvements</h2>' + rows.slice(0, 3).map(row => `<p>${esc(row.label)} <strong>${row.amount > 0 ? '+' : ''}${row.amount} XP</strong></p>`).join('') + '<a href="#journal">Journal complet</a>';
    if (!controls.mj) { $('bureau-corrections').replaceChildren(); return; }
    const conflicts = correctionConflicts();
    const recoverable = controller?.listOtherCorrectionDraftSessions() || [];
    $('bureau-corrections').innerHTML = `<details ${correctionItems.length ? 'open' : ''}><summary>Corrections MJ groupées · ${correctionItems.length}</summary><p>Aucune XP débitée.</p><label>Motif<input id="bureau-correction-reason" value="${esc(correctionReason)}" maxlength="1000"></label><ul>${correctionItems.map((item, index) => `<li>${esc(item.pathParts.join(' · '))} → ${esc(JSON.stringify(item.value))}<button data-action="remove-correction" data-index="${index}" aria-label="Retirer cette correction">×</button></li>`).join('')}</ul>${conflicts.length ? '<p class="bureau-error">La fiche a changé depuis la préparation de ces corrections. Retirez les corrections concernées puis préparez-les à nouveau.</p>' : ''}${action('submit-corrections', 'Enregistrer les corrections', !controls.actions || !navigator.onLine || !correctionItems.length || correctionItems.length > 50 || conflicts.length > 0 || !correctionReason.trim())}${recoverable.map(item => `<button data-action="restore-corrections" data-id="${esc(item.sessionId)}">Restaurer ${esc(item.changeCount)} correction(s)</button>`).join('')}</details>`;
}

function render() {
    if (!catalogues || !state.data) return;
    const active = document.activeElement;
    const focusId = active?.id;
    const focusAction = active?.dataset?.action;
    const origin = active?.dataset?.origin;
    const inputValue = active?.value;
    const cursor = active?.selectionStart;
    const scroll = $('bureau-inspector').parentElement.scrollTop;

    renderHeader(); renderLeft(); renderSkills(); renderAptitudes(); renderInspector(); renderJournal();
    $('bureau-status').textContent = message;
    $('bureau-inspector').parentElement.scrollTop = scroll;
    const restored = focusId && $(focusId) || (origin && [...document.querySelectorAll('[data-origin]')].find(node => node.dataset.origin === origin)) || (focusAction && $('bureau-inspector').querySelector(`[data-action="${focusAction}"]`));
    if (restored && active !== restored) {
        if (typeof inputValue === 'string' && restored.matches('input,textarea') && active?.dataset?.patch) restored.value = inputValue;
        restored.focus({ preventScroll: true });
        if (cursor !== null && cursor !== undefined && restored.type !== 'number') restored.setSelectionRange?.(cursor, cursor);
    }
}

function select(spec, origin) {
    selection = spec; selectionOrigin = origin?.dataset?.origin || null;
    advances = 1; mode = 'buy'; lastFailure = null; searchQuery = ''; correctionFeedback = ''; renderInspector();
    $('bureau-detail-title')?.focus({ preventScroll: true });
    $('bureau-search')?.focus({ preventScroll: true });
}

function closeInspector() {
    const origin = selectionOrigin;
    selection = null; lastFailure = null; renderInspector();
    const button = [...document.querySelectorAll('[data-origin]')].find(node => node.dataset.origin === origin);
    if (button) button.focus({ preventScroll: true });
    else $('skill-query').focus({ preventScroll: true });
}

async function command(type, payload, retry = false) {
    const attemptedSelection = selection && globalThis.structuredClone(selection);
    const attemptedCount = advances;
    message = 'Enregistrement…'; lastFailure = null; $('bureau-status').textContent = message;
    try {
        const result = retry ? await controller.retryPendingCommand() : await controller.executeOnlineCommand(type, payload);
        message = result.status === 'confirmed' ? 'Modification enregistrée.' : 'Confirmation serveur en attente. Utilisez Réessayer si nécessaire.';
        if (result.status !== 'confirmed' && result.status !== 'stale') lastFailure = { type, payload, selection: attemptedSelection, count: attemptedCount };
        if (result.status === 'confirmed' && type === 'correct' && payload.kind === 'batch') { correctionItems = []; correctionReason = ''; correctionFeedback = ''; controller.removeCorrectionDraft(); }
    } catch (error) {
        message = type === 'cancel' ? cancelErrorMessage(error) : purchaseErrorMessage(error);
        lastFailure = { type, payload, selection: attemptedSelection, count: attemptedCount };
    }
    render();
}

function persistCorrections() {
    if (!controller.saveCorrectionDraft({ reason: correctionReason, items: correctionItems }).ok) message = 'Corrections gardées en mémoire seulement — sauvegarde locale indisponible.';
}

function stageCorrections(changes) {
    for (const change of changes) {
        const baseline = state.envelope?.data || state.data;
        const existing = correctionItems.find(item => !change.pathParts.includes('@new') && JSON.stringify(item.pathParts) === JSON.stringify(change.pathParts));
        if (existing) existing.value = change.value;
        else correctionItems.push({ ...change, baseValue: readPath(baseline, change.pathParts) });
    }
    persistCorrections(); message = correctionItems.length ? `${correctionItems.length} correction(s) en attente dans le journal.` : 'Aucune correction en attente dans le journal.'; render();
}

// Le contrôleur persiste immédiatement le brouillon ; seul l’envoi cloud est temporisé.
function patch(changes) {
    if (!roleControls(state).editable) return;
    const staged = controller.stagePatch(changes);
    if (!staged.ok) { message = 'Modification non autorisée.'; render(); return; }
    clearTimeout(patchTimer);
    patchTimer = setTimeout(() => { void controller.submitPatch().catch(error => { message = purchaseErrorMessage(error); render(); }); }, 2000);
}

$('bureau-content').addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled || !controller) return;
    const name = button.dataset.action;
    if (name === 'select') { select(JSON.parse(button.dataset.origin), button); return; }
    if (name === 'close') { closeInspector(); return; }
    if (name === 'search' || name === 'change-career') { select({ kind: 'search', searchKind: button.dataset.kind || 'career' }, button); return; }
    if (name === 'identity') { select({ kind: 'identity' }, button); return; }
    if (name === 'buy-mode' || name === 'correct-mode') { mode = name === 'buy-mode' ? 'buy' : 'correct'; correctionFeedback = ''; renderInspector(); return; }
    if (name === 'advance-minus' || name === 'advance-plus') { advances = Math.max(1, Math.min(10, advances + (name === 'advance-plus' ? 1 : -1))); renderInspector(); return; }
    if (name === 'talent-pick') { selection.pick = button.dataset.value; renderInspector(); return; }
    if (name === 'purchase') {
        const model = inspectorModel(state.data, catalogues.engine, catalogues.careers, selection, state, navigator.onLine, advances);
        if (model?.enabled) await command('purchase', purchasePayload(model.target, advances, catalogues.engine));
        return;
    }
    if (name === 'retry' && lastFailure) {
        const failed = lastFailure;
        // Une réponse incertaine reprend la même opération. Un refus certain recrée l’aperçu à jour.
        if (state.pendingOperationId) await command(failed.type, failed.payload, true);
        else if (failed.type === 'purchase') {
            const current = inspectorModel(state.data, catalogues.engine, catalogues.careers, failed.selection, state, navigator.onLine, failed.count);
            if (current?.enabled) await command('purchase', purchasePayload(current.target, failed.count, catalogues.engine));
        } else await command(failed.type, failed.payload);
        return;
    }
    if (name === 'pip') { patch({ [button.dataset.key]: button.dataset.value }); return; }
    if (name === 'wounds') { patch({ blessuresAct: String(Math.max(0, (+state.data.blessuresAct || 0) + +button.dataset.delta)) }); return; }
    if (name === 'resource-max') {
        const key = button.dataset.max;
        const value = window.prompt(`Nouvelle valeur de ${key === 'destin' ? 'Destin' : 'Résilience'} :`, state.data[key] || '0');
        if (value === null || !/^\d+$/u.test(value) || +value > 100) return;
        const proposed = resourceChange(state.data, key, button.dataset.current, +value);
        if (window.confirm(`Passer à ${value}${proposed.lowered === null ? '' : ' et plafonner les points disponibles'} ?`)) patch(proposed.changes);
        return;
    }
    if (name === 'export') {
        const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = `fiche-${charId}.json`; link.click(); URL.revokeObjectURL(url); return;
    }
    if (name === 'import') { $('bureau-import').click(); return; }
    if (name === 'cancel' && roleControls(state).actions) { await command('cancel', { purchaseId: button.dataset.id }); return; }
    if ((name === 'gain' || name === 'free-xp') && roleControls(state).actions) {
        const reason = window.prompt(name === 'gain' ? 'Motif du gain d’XP :' : 'Libellé de la dépense libre :')?.trim();
        if (!reason) return;
        const amount = Number(window.prompt('Nombre d’XP (entier positif) :'));
        if (!Number.isSafeInteger(amount) || amount <= 0) return;
        await command(name === 'gain' ? 'gain' : 'correct', name === 'gain' ? { reason, amount } : { kind: 'xp', reason, amount: -amount }); return;
    }
    if (name === 'archive' && roleControls(state).actions) {
        const nom = window.prompt('Nom de l’ancienne carrière :')?.trim();
        if (!nom) return;
        const rang = Number(window.prompt('Rang atteint (1 à 5) :', '1'));
        if (Number.isSafeInteger(rang) && rang >= 1 && rang <= 5) stageCorrections([{ pathParts: ['careers', '@new'], value: { nom, rang, note: '' } }]);
        return;
    }
    if (name === 'remove-correction') { correctionItems.splice(+button.dataset.index, 1); persistCorrections(); renderJournal(); return; }
    if (name === 'restore-corrections') {
        const recovered = controller.loadCorrectionDraftSession(button.dataset.id);
        if (recovered) { correctionItems = recovered.items; correctionReason = recovered.reason; persistCorrections(); renderJournal(); }
        return;
    }
    if (name === 'submit-corrections' && roleControls(state).actions && !correctionConflicts().length && correctionItems.length && correctionItems.length <= 50 && correctionReason.trim()) {
        await command('correct', { kind: 'batch', reason: correctionReason.trim(), changes: correctionItems.map(({ pathParts, value }) => ({ pathParts, value })) }); return;
    }
    if (name === 'viewer') {
        viewer ||= createCareerViewer({ container: $('career-viewer-host'), modalOnly: true,
            getContext: () => ({ careers: catalogues.careers, careerName: state.data.carriere, rank: +state.data.rang || 1, chosenVariants: state.data.chosenVariants, careerOverrides: state.data.careerOverrides, skillResolver: catalogues.engine.skillResolver, uid: state.uid }),
            onTalent: nom => select({ kind: 'talent', nom }, button) });
        viewer.openModal();
    }
});

$('bureau-content').addEventListener('input', event => {
    const input = event.target;
    if (input.dataset.patch) patch({ [input.dataset.patch]: input.value });
    if (input.id === 'skill-query') renderSkills();
    if (input.id === 'bureau-search') { searchQuery = input.value; const cursor = input.selectionStart; renderInspector(); $('bureau-search').focus(); $('bureau-search').setSelectionRange(cursor, cursor); }
    if (input.id === 'bureau-correction-reason') { correctionReason = input.value; persistCorrections(); $('bureau-corrections').querySelector('[data-action="submit-corrections"]').disabled = !roleControls(state).actions || !navigator.onLine || !correctionItems.length || correctionItems.length > 50 || !!correctionConflicts().length || !correctionReason.trim(); }
});
$('bureau-content').addEventListener('change', event => {
    const input = event.target;
    if (input.id === 'skill-filter') renderSkills();
    if (input.id === 'bureau-target-rank') { selection.targetRank = +input.value; renderInspector(); }
    if (input.id === 'bureau-talent-pick') { selection.pick = input.value.trim(); renderInspector(); }
    if (input.id === 'bureau-skill-pick' && input.value) { selection = { kind: 'skill', newName: input.value }; renderInspector(); }
    if (input.id === 'bureau-basic-pick') patch({ [`basicSpecs.${encodeURIComponent(selection.row)}`]: input.value });
});
$('bureau-content').addEventListener('submit', event => {
    if (event.target.id !== 'bureau-correction-form') return;
    event.preventDefault();
    if (!roleControls(state).actions) return;
    const values = Object.fromEntries([...event.target.querySelectorAll('[name]')].map(input => [input.name, input.value]));
    const changes = correctionChanges(state.data, selection, values, catalogues.engine);
    correctionItems = correctionItems.filter(item => !correctionMatches(item, state.data, selection, catalogues.engine));
    correctionFeedback = changes.length ? 'Correction ajoutée au lot MJ. Saisissez un motif dans le journal puis enregistrez les corrections.'
        : 'Aucun changement à ajouter : ces valeurs correspondent déjà à la fiche enregistrée.';
    stageCorrections(changes);
});
$('btn-import-fiche').addEventListener('click', () => { if (state.role === 'mj') $('bureau-import').click(); });
$('bureau-import').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file || state.role !== 'mj') return;
    try {
        const data = JSON.parse(await file.text());
        const reason = window.prompt('Motif de l’import :')?.trim();
        if (reason && window.confirm('Remplacer la fiche par ce fichier JSON ?')) await command('import', { reason, data });
    } catch { message = 'Fichier JSON invalide.'; render(); }
    event.target.value = '';
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && selection) { event.preventDefault(); closeInspector(); } });
for (const name of ['online', 'offline']) globalThis.addEventListener(name, render);

async function start() {
    if (!validIds.includes(charId)) { location.href = 'groupe.html'; return; }
    $('fiche-mobile-return').hidden = params.get('return') !== 'mobile';
    try {
        catalogues = await loadBureauCatalogues();
        controller = connectBureau({ charId, onCatalogue: published => {
            try { catalogues.engine = catalogues.makeEngine(published); render(); }
            catch { message = 'Référentiel publié indisponible. Rechargez la fiche.'; render(); }
        }, onState: next => {
            const nextKey = `${next.uid || ''}:${next.charId || ''}:${next.role || ''}`;
            if (nextKey !== sessionKey) { sessionKey = nextKey; selection = null; correctionItems = []; correctionReason = ''; correctionFeedback = ''; lastFailure = null; message = ''; viewer?.destroy(); viewer = null; }
            state = next;
            const visible = !!state.data && !['signed-out', 'loading', 'error'].includes(state.phase);
            $('bureau-content').hidden = !visible;
            $('bureau-wall').hidden = visible;
            $('bureau-wall-message').textContent = state.phase === 'signed-out' ? 'Connexion requise pour accéder à la fiche.' : state.phase === 'loading' ? 'Vérification des accès…' : state.error === 'permission-denied' ? 'Vous n’avez pas accès à cette fiche.' : state.error || 'Fiche absente : initialisation par le MJ nécessaire.';
            if (!visible) for (const id of ['bureau-header', 'bureau-left', 'bureau-skills', 'bureau-talents', 'bureau-spells', 'bureau-inspector', 'bureau-journal', 'bureau-recent', 'bureau-corrections']) $(id).replaceChildren();
            if (state.phase === 'missing' && state.role === 'mj') { state = { ...state, data: { xpLog: [], carac: Object.fromEntries(CARACS.map(c => [c.key, { base: 0, adv: 0 }])) } }; $('bureau-content').hidden = false; $('bureau-wall').hidden = true; }
            render();
        } });
    } catch (error) { $('bureau-wall-message').textContent = error.message; }
}
void start();

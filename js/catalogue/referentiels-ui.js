import { buildSkillForms, linkSkillForms, skillFormsResolver } from './skill-forms.js';
import { canonicalSkillNom } from '../fiche/skill-names.js';

export function createReferentielsUi({ callable, auth, documentRef = document }) {
const el = id => documentRef.getElementById(id);
const authMessage = el('auth-message');
const entryList = el('entry-list');
const entryForm = el('entry-form');
let user = null;
let catalogue = null;
let publishedCatalogue = null;
let draftRevision = 0;
let publishedRevision = 0;
let preview = null;
let selected = null;
let mode = 'skill';
let usageReport = null;
let dirty = false;
let editRevision = 0;
let busy = false;
let undoCatalogue = null;
const checkedForms = new Set();

function operationId() { return 'catalogue-' + globalThis.crypto.randomUUID(); }
function normalize(value) { return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr'); }
function searchable(value) { return normalize(value).normalize('NFD').replace(/[\u0300-\u036f]/gu, '').replace(/[’']/gu, "'"); }
function collection(type) { return type === 'skill' ? catalogue.skills : catalogue.talents; }
function selectedValue() { return selected ? collection(selected.type)?.entries.find(entry => entry.id === selected.id) : null; }
function setStatus(message, state = '') {
    for (const id of ['catalogue-status', 'entry-status']) { el(id).textContent = message; el(id).dataset.state = state; }
}
async function send(type, payload = {}, baseRevision = draftRevision) {
    const result = await callable({ operationId: operationId(), baseRevision, type, payload });
    return result.data;
}
function skillRows() { return buildSkillForms(catalogue.skills, usageReport); }
function setBusy(value) {
    busy = value;
    for (const id of ['apply-group', 'preview-migration', 'save-draft', 'undo-change', 'publish-catalogue', 'save-description', 'remove-description']) el(id).disabled = value;
    if (!value) { el('undo-change').disabled = !undoCatalogue; updatePublishState(); renderGroupPreview(); }
}
function renderDraftState() {
    el('draft-state').textContent = checkedForms.size ? 'Sélection à enregistrer' : dirty ? 'Enregistrement à terminer' : 'Brouillon enregistré';
    el('save-draft').hidden = !dirty;
    el('undo-change').disabled = busy || !undoCatalogue;
    const before = JSON.stringify(publishedCatalogue?.skills);
    const changed = before !== JSON.stringify(catalogue.skills) || JSON.stringify(publishedCatalogue?.talents) !== JSON.stringify(catalogue.talents);
    el('preview-migration').disabled = busy || checkedForms.size > 0;
    el('changes-summary').textContent = checkedForms.size ? 'Enregistrez votre sélection, ou retirez-la, avant de vérifier les impacts.' : changed ? 'Le brouillon contient des changements qui ne sont pas encore publiés.' : 'Le brouillon correspond au référentiel publié.';
}
function clearSelection() {
    checkedForms.clear();
    el('primary-name').value = '';
    el('new-skill-carac').value = '';
    renderEntries();
}
function toggleForm(label, checked = !checkedForms.has(label)) {
    if (checked) checkedForms.add(label); else checkedForms.delete(label);
    if (checkedForms.size === 1 && checked) {
        el('primary-name').value = skillFormsResolver(catalogue.skills).resolve(label).entry?.nom || label;
    }
    if (!checkedForms.size) el('primary-name').value = '';
    el('entry-status').textContent = '';
    renderEntries();
}
function renderEntries() {
    if (!catalogue) return;
    const query = searchable(el('catalogue-search').value);
    const allRows = mode === 'skill' ? skillRows() : catalogue.talents.entries.map(entry => ({ label: entry.nom, targetId: entry.id, sources: ['Talent'], isPrimary: true, searchExtras: catalogue.talents.aliases.filter(alias => alias.targetId === entry.id).map(alias => alias.label) }));
    const filter = el('form-filter').value;
    const rows = allRows.filter(row => (!query || searchable([row.label, row.primary, ...row.sources, ...(row.searchExtras || [])].join(' ')).includes(query))
        && (mode !== 'skill' || filter === 'all' || (filter === 'primary' && row.isPrimary)
            || (filter === 'variant' && row.targetId && !row.isPrimary) || (filter === 'unknown' && !row.targetId)));
    el('show-skills').setAttribute('aria-pressed', String(mode === 'skill'));
    el('show-talents').setAttribute('aria-pressed', String(mode === 'talent'));
    el('link-forms-panel').hidden = mode !== 'skill';
    el('form-filter').hidden = mode !== 'skill';
    el('inventory-help').hidden = mode !== 'skill';
    el('entries-title').textContent = mode === 'skill' ? '1. Choisir les formes équivalentes' : 'Choisir un talent';
    el('edit-title').textContent = mode === 'skill' ? '2. Définir la compétence' : 'Modifier le talent';
    el('result-count').textContent = rows.length + ' / ' + allRows.length;
    el('inventory-counts').textContent = mode === 'skill'
        ? allRows.filter(row => row.isPrimary).length + ' noms principaux · ' + allRows.filter(row => row.targetId && !row.isPrimary).length + ' variantes · ' + allRows.filter(row => !row.targetId).length + ' à organiser' : '';
    el('inventory-empty').hidden = rows.length > 0;
    el('selection-jump').hidden = mode !== 'skill' || !checkedForms.size;
    el('selection-jump').textContent = 'Voir ma sélection (' + checkedForms.size + ')';
    const scrollTop = entryList.scrollTop;
    entryList.replaceChildren();
    for (const row of rows) {
        const item = documentRef.createElement('li'); item.className = 'form-row';
        if (mode === 'skill') {
            const checkbox = documentRef.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = checkedForms.has(row.label);
            checkbox.setAttribute('aria-label', 'Sélectionner ' + row.label);
            checkbox.addEventListener('change', () => toggleForm(row.label, checkbox.checked)); item.append(checkbox);
        }
        const button = documentRef.createElement('button'); button.type = 'button'; button.className = 'entry-choice';
        button.setAttribute('aria-pressed', String(mode === 'skill' ? checkedForms.has(row.label) : selected?.id === row.targetId));
        const name = documentRef.createElement('strong'); name.textContent = row.label;
        const detail = documentRef.createElement('small');
        detail.textContent = [mode === 'talent' ? 'Talent' : row.isPrimary ? 'Nom principal' : row.primary ? 'Variante de ' + row.primary : 'À organiser', ...row.sources].join(' · ');
        button.append(name, detail);
        button.addEventListener('click', () => mode === 'skill' ? toggleForm(row.label) : selectEntry('talent', row.targetId));
        item.append(button); entryList.append(item);
    }
    entryList.scrollTop = scrollTop;
    if (mode === 'skill') renderSelection();
    renderDraftState();
    updatePublishState();
}
function renderSelection() {
    entryForm.hidden = true;
    el('group-empty').hidden = checkedForms.size > 0;
    el('skill-group-form').hidden = checkedForms.size === 0;
    el('checked-summary').textContent = checkedForms.size + (checkedForms.size === 1 ? ' forme sélectionnée' : ' formes sélectionnées');
    const list = el('selected-forms'); list.replaceChildren();
    for (const label of checkedForms) {
        const item = documentRef.createElement('li');
        const choose = documentRef.createElement('button'); choose.type = 'button'; choose.className = 'choose-primary'; choose.textContent = label;
        choose.setAttribute('aria-label', 'Choisir ' + label + ' comme nom principal');
        choose.setAttribute('aria-pressed', String(normalize(el('primary-name').value) === normalize(label)));
        choose.addEventListener('click', () => { el('primary-name').value = label; renderSelection(); });
        const remove = documentRef.createElement('button'); remove.type = 'button'; remove.className = 'remove-form'; remove.textContent = '×';
        remove.setAttribute('aria-label', 'Retirer ' + label + ' de la sélection'); remove.addEventListener('click', () => toggleForm(label, false));
        item.append(choose, remove); list.append(item);
    }
    const names = el('catalogue-names'); names.replaceChildren();
    for (const label of new Set([...checkedForms, ...skillFormsResolver(catalogue.skills).primaryEntries.map(entry => entry.nom)])) {
        const option = documentRef.createElement('option'); option.value = label; names.append(option);
    }
    const suggestions = el('name-suggestions'); suggestions.replaceChildren();
    const resolver = skillFormsResolver(catalogue.skills);
    const suggested = new Set();
    for (const label of checkedForms) {
        const canonical = canonicalSkillNom(label);
        const match = resolver.resolve(canonical);
        if (match.entry && !checkedForms.has(match.entry.nom)) suggested.add(match.entry.nom);
    }
    for (const label of suggested) {
        const button = documentRef.createElement('button'); button.type = 'button'; button.className = 'button-secondary'; button.textContent = 'Ajouter au groupe : ' + label;
        button.addEventListener('click', () => toggleForm(label, true)); suggestions.append(button);
    }
    renderGroupPreview();
    const usageRows = skillRows().filter(row => checkedForms.has(row.label));
    renderUsages(usageRows);
}
function renderGroupPreview() {
    if (!catalogue || mode !== 'skill') return;
    const name = el('primary-name').value.trim().replace(/\s+/gu, ' ');
    const labels = [...checkedForms, name].filter(Boolean);
    const resolver = skillFormsResolver(catalogue.skills);
    const resolved = labels.map(label => resolver.resolve(label)).filter(match => match.entry);
    const isNew = checkedForms.size > 0 && !resolved.length;
    el('new-skill-fields').hidden = !isNew;
    el('new-skill-carac').required = isNew;
    if (!isNew) el('new-skill-carac').value = '';
    const resultForms = el('result-forms'); resultForms.replaceChildren(); el('result-details').hidden = true;
    for (const item of el('selected-forms').children) item.children[0].setAttribute('aria-pressed', String(normalize(item.children[0].textContent) === normalize(name)));
    let message = 'Choisissez un nom principal.';
    let valid = checkedForms.size > 0 && Boolean(name);
    if (valid) {
        try {
            const result = linkSkillForms(catalogue.skills, labels, name, { newSkill: { carac: el('new-skill-carac').value } });
            const target = result.skills.entries.find(entry => entry.id === result.targetId);
            for (const label of result.labels.filter(label => normalize(label) !== normalize(name))) {
                const item = documentRef.createElement('li'); item.textContent = label; resultForms.append(item);
            }
            el('result-details').hidden = resultForms.children.length === 0;
            message = '« ' + name + ' » sera le seul nom proposé. ' + (result.labels.length - 1) + ' autre(s) forme(s) resteront reconnues. ' + (target.basic ? 'Compétence de base.' : 'Compétence avancée.');
        } catch (error) { message = error.message; valid = false; }
    }
    el('group-result').textContent = message;
    el('apply-group').disabled = busy || !valid;
    el('apply-group').textContent = isNew ? 'Créer et enregistrer cette compétence' : 'Enregistrer cette compétence';
}
function renderUsages(rows) {
    const list = el('form-usages'); list.replaceChildren();
    const descriptions = [...new Set(rows.flatMap(row => (row.occurrences || []).map(occurrence => occurrence.kind === 'career'
        ? 'Carrière : ' + occurrence.careerName + ' · rang ' + occurrence.rank : (occurrence.historical ? 'Historique XP' : 'Fiche') + ' : ' + occurrence.scopeId)))];
    for (const description of descriptions) { const item = documentRef.createElement('li'); item.textContent = description; list.append(item); }
    el('usages-details').hidden = !descriptions.length;
}
async function applyGroup() {
    if (busy || !checkedForms.size) return;
    setBusy(true);
    try {
        const primary = el('primary-name').value.trim().replace(/\s+/gu, ' ');
        const result = linkSkillForms(catalogue.skills, [...checkedForms, primary], primary, { newSkill: { carac: el('new-skill-carac').value } });
        undoCatalogue = globalThis.structuredClone(catalogue);
        catalogue.skills = result.skills;
        invalidatePreview();
        clearSelection();
        await saveDraft();
        setStatus('« ' + result.primary + ' » enregistré dans le brouillon, avec ' + (result.labels.length - 1) + ' variante(s). Vous pouvez organiser une autre compétence ou vérifier les impacts.', 'ready');
    } catch (error) { setStatus(error.message + (dirty ? ' Vos changements sont conservés ici : réessayez l’enregistrement.' : ''), 'error'); }
    finally { setBusy(false); renderDraftState(); }
}
function renderAliases() {
    const aliasList = el('alias-list'); aliasList.replaceChildren();
    const entry = selectedValue(); if (!entry) return;
    for (const alias of catalogue.talents.aliases.filter(item => item.targetId === entry.id)) {
        const item = documentRef.createElement('li'); item.className = 'alias-row';
        const label = documentRef.createElement('span'); label.textContent = alias.label;
        const remove = documentRef.createElement('button'); remove.type = 'button'; remove.textContent = 'Retirer';
        remove.addEventListener('click', async () => {
            if (busy) return;
            undoCatalogue = globalThis.structuredClone(catalogue);
            catalogue.talents.aliases = catalogue.talents.aliases.filter(candidate => candidate !== alias);
            invalidatePreview(); renderAliases(); renderEntries();
            await runSave();
        });
        item.append(label, remove); aliasList.append(item);
    }
}
function selectEntry(type, id) {
    selected = { type, id }; const entry = selectedValue(); if (!entry) return;
    renderEntries(); entryForm.hidden = false;
    el('display-name').value = entry.nom; el('alias-label').value = '';
    el('selection-summary').hidden = false; el('selection-summary').textContent = entry.nom;
    el('local-description').value = catalogue.talents.localDescriptions.find(item => item.talentId === id)?.description || '';
    renderAliases(); renderUsages([]);
}
function invalidatePreview(markDirty = true) {
    if (markDirty) { dirty = true; editRevision += 1; }
    preview = null; el('preview-results').hidden = true; el('publication-fields').hidden = true; el('publish-catalogue').disabled = true;
    renderDraftState();
}
async function runSave() {
    if (busy) return;
    setBusy(true);
    try { await saveDraft(); } catch (error) { setStatus(error.message + ' Vos changements restent dans ce brouillon. Réessayez l’enregistrement.', 'error'); }
    finally { setBusy(false); renderDraftState(); }
}

function renderCollision(collision, index) {
    const card = documentRef.createElement('div');
    card.className = 'collision-card';
    const title = documentRef.createElement('h3');
    title.textContent = `${collision.targetName} · ${collision.scopeName}`;
    card.append(title);
    const keepLabel = documentRef.createElement('label');
    keepLabel.textContent = 'Ligne conservée';
    const keep = documentRef.createElement('select');
    keep.dataset.collision = String(index);
    keep.id = 'collision-keep-' + index; keepLabel.htmlFor = keep.id;
    keep.required = true;
    keep.add(new globalThis.Option('Choisir explicitement…', ''));
    collision.records.forEach((record, recordIndex) => {
        const option = documentRef.createElement('option');
        option.value = String(recordIndex);
        const collectionName = record.collection === 'skillsBasic' ? 'Compétence de base' : 'Compétence avancée';
        option.textContent = `${collectionName} · ${record.nom} · ${record.advances ?? 'inconnues'} avances`;
        keep.append(option);
    });
    const storageLabel = documentRef.createElement('label');
    storageLabel.textContent = 'Type de compétence après fusion';
    const storage = documentRef.createElement('select');
    storage.dataset.collision = String(index);
    storage.required = true;
    const targetCollection = collision.targetBasic ? 'skillsBasic' : 'skillsAdvanced';
    const targetLabel = collision.targetBasic ? 'Compétence de base' : 'Compétence avancée';
    storage.add(new globalThis.Option(targetLabel, targetCollection));
    const advancesLabel = documentRef.createElement('label');
    advancesLabel.textContent = 'Avances décidées par le MJ';
    const advances = documentRef.createElement('input');
    advances.type = 'number';
    advances.min = '0';
    advances.step = '1';
    advances.required = true;
    advances.dataset.collision = String(index);
    advances.id = 'collision-advances-' + index; advancesLabel.htmlFor = advances.id;
    advances.addEventListener('input', updatePublishState);
    const proposal = documentRef.createElement('p');
    proposal.className = 'collision-proposal';
    const recommendation = collision.proposal;
    proposal.textContent = recommendation?.status === 'demonstrated'
        ? `Proposition issue des historiques (à confirmer) : ${recommendation.advances} avances. ${recommendation.reason}`
        : `${recommendation?.status === 'conflicting-history' ? 'Historiques divergents' : 'Historique insuffisant'} : ${recommendation?.reason || 'Aucune proposition automatique.'}`;
    storageLabel.hidden = true; storage.hidden = true;
    keep.addEventListener('change', () => {
        const record = keep.value === '' ? null : collision.records[Number(keep.value)];
        advances.value = Number.isSafeInteger(record?.advances) ? String(record.advances) : '';
        updatePublishState();
    });
    card.append(keepLabel, keep, storageLabel, storage, advancesLabel, advances, proposal);
    const recordSummary = documentRef.createElement('ul');
    recordSummary.className = 'collision-records';
    collision.records.forEach(record => {
        const item = documentRef.createElement('li');
        const source = record.collection === 'skillsBasic' ? 'Compétence de base' : 'Compétence avancée';
        const purchases = (record.history || []).filter(entry => entry.kind === 'purchase' && entry.origin === 'command');
        item.textContent = `${source} « ${record.nom} » · ${record.advances ?? 'avances inconnues'} avances · ${purchases.length} achat(s) retraçable(s)`;
        if (purchases.length) {
            const history = documentRef.createElement('small');
            history.textContent = purchases.flatMap(entry => (entry.effects || []).map(effect =>
                `${entry.type || 'Achat'} · ${entry.cout ?? '?'} XP · ${effect.before ?? '?'} → ${effect.after ?? '?'}`)).join(' ; ');
            item.append(history);
        }
        recordSummary.append(item);
    });
    card.append(recordSummary);
    const technical = documentRef.createElement('details');
    const technicalSummary = documentRef.createElement('summary');
    technicalSummary.textContent = 'Identifiants techniques';
    const technicalList = documentRef.createElement('ul');
    collision.records.forEach(record => {
        const item = documentRef.createElement('li');
        item.textContent = `${record.collection} · ${record.id} · ${record.scopeId}`;
        technicalList.append(item);
    });
    technical.append(technicalSummary, technicalList);
    card.append(technical);
    return card;
}

function renderPreview(result) {
    preview = result;
    const container = el('preview-results');
    container.replaceChildren();
    container.hidden = false;
    el('publication-fields').hidden = false;
    const totals = documentRef.createElement('p');
    totals.className = 'preview-stat';
    const counts = result.report.counts;
    totals.textContent = `${counts.skillLabels} libellés de compétences et ${counts.talentLabels} talents vérifiés dans les fiches et carrières.`;
    container.append(totals);
    const talentRows = result.report.talents.map(item => {
        const statuses = [...new Set(item.occurrences.map(occurrence => occurrence.resolved?.descriptionStatus
            || (occurrence.resolved?.status === 'unknown' ? 'unknown' : 'unresolved')))];
        return { name: item.name, status: statuses.join(', '), reason: statuses.includes('source-unavailable')
            ? 'Source Sheets indisponible; les absences ne sont pas évaluées.'
            : statuses.map(status => ({ 'missing-reference': 'référence absente de la source',
                'empty-reference': 'description source vide', unknown: 'talent non référencé',
                'empty-local': 'correction locale vide' })[status]).filter(Boolean).join(' ; ') || 'Description disponible' };
    });
    const talentSection = documentRef.createElement('details');
    const talentSummary = documentRef.createElement('summary');
    talentSummary.textContent = 'État des descriptions de talents';
    const talentFilter = documentRef.createElement('select');
    talentFilter.setAttribute('aria-label', 'Filtrer les descriptions de talents');
    for (const [value, label] of [['all', 'Tous'], ['missing-reference', 'Référence absente'],
        ['empty-reference', 'Description source vide'], ['source-unavailable', 'Source indisponible'], ['unknown', 'Non référencé']]) {
        talentFilter.add(new globalThis.Option(label, value));
    }
    const talentCount = documentRef.createElement('p');
    const talentList = documentRef.createElement('ul');
    const renderTalentRows = () => {
        const status = talentFilter.value;
        const filtered = talentRows.filter(row => status === 'all' || row.status.split(', ').includes(status));
        talentList.replaceChildren();
        talentCount.textContent = `${filtered.length} talent(s) dans ce filtre`;
        for (const row of filtered) {
            const item = documentRef.createElement('li');
            item.textContent = `${row.name} · ${row.status} · ${row.reason}`;
            talentList.append(item);
        }
    };
    talentFilter.addEventListener('change', renderTalentRows);
    renderTalentRows();
    const exportButton = documentRef.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'button-secondary';
    exportButton.textContent = 'Exporter les libellés et raisons';
    exportButton.addEventListener('click', () => {
        const file = new Blob([JSON.stringify(talentRows, null, 2)], { type: 'application/json' });
        const link = documentRef.createElement('a');
        link.href = globalThis.URL.createObjectURL(file);
        link.download = 'audit-descriptions-talents.json';
        link.click();
        globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(link.href), 1_000);
    });
    talentSection.append(talentSummary, talentFilter, talentCount, talentList, exportButton);
    container.append(talentSection);
    const collisions = result.migration.collisions || [];
    const collisionTitle = documentRef.createElement('h3');
    collisionTitle.textContent = collisions.length ? `Doublons dans les fiches : ${collisions.length} décision(s)` : 'Aucun doublon à arbitrer dans les fiches.';
    container.append(collisionTitle);
    if (collisions.length) {
        const help = documentRef.createElement('p');
        help.textContent = 'Pour chaque doublon, choisissez la ligne à conserver. Ses avances sont proposées ci-dessous : vérifiez-les ou corrigez-les avant de publier.';
        container.append(help);
    }
    const cards = documentRef.createElement('div');
    cards.className = 'collision-list';
    collisions.forEach((collision, index) => cards.append(renderCollision(collision, index)));
    container.append(cards);
    const unresolved = result.migration.unresolved || [];
    const blocked = unresolved.filter(item => item.blocks);
    if (blocked.length) {
        const warning = documentRef.createElement('p');
        warning.setAttribute('role', 'alert');
        warning.textContent = `${blocked.length} ligne(s) ciblée(s) ne sont pas résolues. Ajoutez des alias ou corrigez les cibles avant la publication.`;
        container.append(warning);
        const blockedList = documentRef.createElement('ul');
        for (const record of blocked) {
            const item = documentRef.createElement('li');
            item.textContent = `${record.nom} · ${record.reason || record.resolutionStatus || 'résolution requise'}`;
            blockedList.append(item);
        }
        container.append(blockedList);
    }
    updatePublishState();
    setStatus(`Impacts vérifiés · ${collisions.length} doublon(s) à vérifier dans les fiches.`, 'ready');
}

async function loadCatalogue() {
    const result = await send('load', {}, 0);
    catalogue = globalThis.structuredClone(result.draft);
    publishedCatalogue = globalThis.structuredClone(result.published || result.draft);
    undoCatalogue = null;
    usageReport = result.report || null;
    dirty = false;
    checkedForms.clear();
    el('primary-name').value = '';
    selected = null;
    entryForm.hidden = true;
    draftRevision = result.draftRevision;
    publishedRevision = result.publishedRevision;
    el('version-status').textContent = `Référentiel publié · révision ${publishedRevision} · brouillon ${draftRevision}`;
    renderEntries();
    invalidatePreview(false);
}

async function saveDraft() {
    if (!catalogue) return;
    setStatus('Enregistrement du brouillon…');
    const savingRevision = editRevision;
    const result = await send('saveDraft', { catalogue: globalThis.structuredClone(catalogue) });
    draftRevision = result.revision;
    el('version-status').textContent = `Brouillon ${draftRevision} enregistré`;
    dirty = savingRevision !== editRevision;
    if (dirty) throw new Error('Le brouillon a changé pendant son enregistrement. Relancez la prévisualisation pour enregistrer la dernière version.');
    setStatus('Brouillon enregistré. Il reste privé jusqu’à sa publication.', 'ready');
    invalidatePreview(false);
}

async function editTalent(action) {
    if (busy) return;
    const entry = selectedValue(); if (!entry) return;
    const field = action === 'alias' ? 'alias-label' : 'display-name';
    const clean = el(field).value.trim().replace(/\s+/gu, ' ');
    if (!clean || clean === entry.nom) { setStatus('Indiquez un nouveau nom.', 'error'); return; }
    undoCatalogue = globalThis.structuredClone(catalogue);
    const label = action === 'alias' ? clean : entry.nom;
    if (action !== 'alias') entry.nom = clean;
    catalogue.talents.aliases = catalogue.talents.aliases.filter(alias => normalize(alias.label) !== normalize(label));
    catalogue.talents.aliases.push({ label, targetId: entry.id, provenance: 'mj' });
    invalidatePreview(); selectEntry('talent', entry.id); await runSave();
}

async function saveTalentDescription(remove = false) {
    const entry = selectedValue();
    if (!entry || selected.type !== 'talent') return;
    if (busy) return;
    undoCatalogue = globalThis.structuredClone(catalogue);
    const items = catalogue.talents.localDescriptions;
    const index = items.findIndex(item => item.talentId === entry.id);
    if (remove) {
        if (index >= 0) items.splice(index, 1);
    } else {
        const description = el('local-description').value;
        const item = { talentId: entry.id, description };
        if (index >= 0) items[index] = item;
        else items.push(item);
    }
    invalidatePreview();
    await runSave();
}

function updatePublishState() {
    let ready = Boolean(preview) && !busy && !checkedForms.size && !(preview?.migration.unresolved || []).some(item => item.blocks);
    if (ready) { try { readDecisions(); } catch { ready = false; } }
    el('publish-catalogue').disabled = !ready;
    el('publication-ready').textContent = ready ? 'Tout est prêt. La publication appliquera le brouillon aux fiches concernées.' : preview ? 'Vérifiez et complétez les décisions ci-dessus avant de publier.' : '';
}

function readDecisions() {
    return (preview?.migration.collisions || []).map((collision, index) => {
        const selects = documentRef.querySelectorAll(`select[data-collision="${index}"]`);
        const selectedRaw = selects[0]?.value;
        const storageCollection = selects[1]?.value;
        const advancesRaw = documentRef.querySelector(`input[data-collision="${index}"]`)?.value;
        if (selectedRaw === undefined || selectedRaw === '' || storageCollection === undefined || storageCollection === ''
            || advancesRaw === undefined || advancesRaw.trim() === '') {
            throw new Error(`Arbitrez explicitement toutes les décisions pour ${collision.targetName}.`);
        }
        const selectedIndex = Number(selectedRaw);
        if (!Number.isSafeInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= collision.records.length) {
            throw new Error('Ligne conservée invalide.');
        }
        const winner = collision.records[selectedIndex];
        const advances = Number(advancesRaw);
        if (!Number.isSafeInteger(advances) || advances < 0) throw new Error('Les avances doivent être un entier positif ou nul.');
        return { key: collision.key, keepRecordKey: `${winner.scopeId}\u0000${winner.collection}\u0000${winner.id}`,
            storageCollection, advances };
    });
}

for (const [id, type] of [['show-skills', 'skill'], ['show-talents', 'talent']]) el(id).addEventListener('click', () => {
    mode = type; selected = null; el('catalogue-search').value = ''; el('form-filter').value = 'all'; entryForm.hidden = true; el('selection-summary').hidden = true; renderUsages([]); renderEntries();
});
el('form-filter').addEventListener('change', renderEntries);
el('clear-forms').addEventListener('click', clearSelection);
el('selection-jump').addEventListener('click', () => { el('edit-title').scrollIntoView?.({ behavior: 'smooth', block: 'start' }); el('edit-title').focus?.(); });
el('catalogue-search').addEventListener('input', renderEntries);
el('primary-name').addEventListener('input', renderGroupPreview);
el('new-skill-carac').addEventListener('change', renderGroupPreview);
el('skill-group-form').addEventListener('submit', event => { event.preventDefault(); return applyGroup(); });
el('entry-form').addEventListener('submit', event => { event.preventDefault(); void editTalent(event.submitter?.value).catch(error => setStatus(error.message, 'error')); });
el('undo-change').addEventListener('click', async () => {
    if (busy || !undoCatalogue) return;
    catalogue = undoCatalogue; undoCatalogue = null;
    invalidatePreview(); clearSelection(); entryForm.hidden = true;
    await runSave();
    if (!dirty) setStatus('Dernière modification annulée. Le brouillon est enregistré.', 'ready');
});
el('save-description').addEventListener('click', () => saveTalentDescription(false).catch(error => setStatus(error.message, 'error')));
el('remove-description').addEventListener('click', () => saveTalentDescription(true).catch(error => setStatus(error.message, 'error')));
el('save-draft').addEventListener('click', runSave);
el('preview-migration').addEventListener('click', async () => {
    if (busy || checkedForms.size) return;
    setBusy(true);
    try {
        if (dirty) await saveDraft();
        setStatus('Calcul du rapport d’impact…');
        const previewRevision = editRevision;
        const result = await send('previewMigration', {});
        if (previewRevision !== editRevision) throw new Error('Le brouillon a changé pendant le calcul. Relancez la prévisualisation.');
        usageReport = result.report;
        renderEntries();
        renderPreview(result);
    } catch (error) { setStatus(error.message || 'Prévisualisation impossible.', 'error'); }
    finally { setBusy(false); renderDraftState(); }
});
el('publish-catalogue').addEventListener('click', async () => {
    if (busy || !preview) return;
    setBusy(true);
    try {
        const reason = el('publication-reason').value.trim();
        if (reason && reason.length < 3) { setStatus('La note de publication doit contenir au moins 3 caractères.', 'error'); return; }
        const revisions = Object.fromEntries((preview?.characters || []).map(item => [item.charId, item.revision]));
        await send('publish', { publishedRevision, characterRevisions: revisions,
            decisions: readDecisions(), reason: reason || 'Organisation du référentiel' });
        setStatus('Référentiel publié. Les fiches concernées sont à jour.', 'ready');
        await loadCatalogue();
    } catch (error) { setStatus(error.message || 'Publication refusée.', 'error'); }
    finally { setBusy(false); }
});
el('login-button').addEventListener('click', () => auth.loginWithGoogle().catch(error => { authMessage.textContent = error.message; }));
el('logout-button').addEventListener('click', () => auth.logout());

auth.watchAuth(async (currentUser, isAdmin) => {
    user = currentUser;
    el('login-button').hidden = Boolean(user);
    el('logout-button').hidden = !user;
    if (!user) {
        authMessage.textContent = 'Connectez-vous avec le compte MJ pour gérer les référentiels.';
        el('editor').hidden = true;
        return;
    }
    if (!isAdmin) {
        authMessage.textContent = 'Cette page est réservée au compte MJ.';
        el('editor').hidden = true;
        return;
    }
    authMessage.textContent = `Session MJ vérifiée : ${user.email}`;
    el('editor').hidden = false;
    try { await loadCatalogue(); }
    catch (error) { setStatus(error.message || 'Le référentiel n’a pas pu être chargé.', 'error'); }
});

}

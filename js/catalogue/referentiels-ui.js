import { buildSkillForms, linkSkillForms, skillFormsResolver } from './skill-forms.js';

export function createReferentielsUi({ callable, auth, documentRef = document }) {
const el = id => documentRef.getElementById(id);
const authMessage = el('auth-message');
const entryList = el('entry-list');
const entryForm = el('entry-form');
let user = null;
let catalogue = null;
let draftRevision = 0;
let publishedRevision = 0;
let preview = null;
let selected = null;
let entryLimit = 250;
let mode = 'skill';
let usageReport = null;
let dirty = false;
let editRevision = 0;
let selectedLabel = null;
const checkedForms = new Set();

function operationId() {
    return `catalogue-${globalThis.crypto.randomUUID()}`;
}

function normalize(value) {
    return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('fr');
}

function entries() {
    if (!catalogue) return [];
    return [
        ...(catalogue.skills?.entries || []).map(entry => ({ type: 'skill', entry })),
        ...(catalogue.talents?.entries || []).map(entry => ({ type: 'talent', entry })),
    ].sort((left, right) => left.entry.nom.localeCompare(right.entry.nom, 'fr'));
}

function collection(type) { return type === 'skill' ? catalogue.skills : catalogue.talents; }

function selectedValue() {
    if (!selected) return null;
    return collection(selected.type)?.entries.find(entry => entry.id === selected.id) || null;
}

function setStatus(message, state = '') {
    const status = el('catalogue-status');
    status.textContent = message;
    status.dataset.state = state;
    const feedback = el('entry-status');
    if (feedback) { feedback.textContent = message; feedback.dataset.state = state; }
}

async function send(type, payload = {}, baseRevision = draftRevision) {
    const result = await callable({ operationId: operationId(), baseRevision, type, payload });
    return result.data;
}

function skillRows() { return buildSkillForms(catalogue.skills, usageReport); }

function renderChecked() {
    const selector = el('primary-form');
    const previous = selector.value;
    selector.replaceChildren();
    for (const label of checkedForms) selector.add(new globalThis.Option(label, label));
    if (checkedForms.has(previous)) selector.value = previous;
    selector.disabled = checkedForms.size === 0;
    el('link-forms').disabled = checkedForms.size === 0;
    el('checked-summary').textContent = checkedForms.size ? [...checkedForms].join(' · ') : 'Aucune forme cochée.';
}

function renderEntries() {
    if (!catalogue) return;
    const query = normalize(el('catalogue-search').value);
    el('show-skills').setAttribute('aria-pressed', String(mode === 'skill'));
    el('show-talents').setAttribute('aria-pressed', String(mode === 'talent'));
    el('link-forms-panel').hidden = mode !== 'skill';
    el('form-filter').hidden = mode !== 'skill';
    el('inventory-help').hidden = mode !== 'skill';
    el('entries-title').textContent = mode === 'skill' ? 'Toutes les formes de compétences' : 'Talents';
    const filter = el('form-filter').value;
    const rows = mode === 'skill' ? skillRows().filter(row => (!query || normalize([row.label, row.primary, ...row.sources].join(' ')).includes(query))
        && (filter === 'all' || (filter === 'primary' && row.isPrimary) || (filter === 'variant' && row.targetId && !row.isPrimary)
            || (filter === 'unknown' && !row.targetId)))
        : entries().filter(({ type, entry }) => type === 'talent' && (!query || normalize([entry.nom,
            ...catalogue.talents.aliases.filter(alias => alias.targetId === entry.id).map(alias => alias.label)].join(' ')).includes(query)))
            .map(({ entry }) => ({ label: entry.nom, targetId: entry.id, isPrimary: true, sources: ['Talent'] }));
    const scrollTop = entryList.scrollTop;
    entryList.replaceChildren();
    el('result-count').textContent = `${Math.min(entryLimit, rows.length)} sur ${rows.length} forme(s)`;
    el('load-more-entries').hidden = entryLimit >= rows.length;
    for (const row of rows.slice(0, entryLimit)) {
        const item = documentRef.createElement('li');
        item.className = 'form-row';
        if (mode === 'skill') {
            const checkbox = documentRef.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = checkedForms.has(row.label);
            checkbox.setAttribute('aria-label', `Sélectionner ${row.label} pour le regroupement`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) checkedForms.add(row.label); else checkedForms.delete(row.label);
                if (checkbox.checked) selectRow(row); else renderChecked();
            });
            item.append(checkbox);
        }
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'entry-choice';
        button.setAttribute('aria-pressed', String(selectedLabel === row.label));
        const name = documentRef.createElement('strong');
        name.textContent = row.label;
        const detail = documentRef.createElement('small');
        detail.textContent = [mode === 'talent' ? 'Talent' : row.isPrimary ? 'Principale' : row.primary ? `Variante → ${row.primary}` : 'À relier', ...row.sources].join(' · ');
        button.append(name, detail);
        button.addEventListener('click', () => selectRow(row));
        item.append(button);
        entryList.append(item);
    }
    entryList.scrollTop = scrollTop;
    renderChecked();
}

function selectRow(row) {
    selectedLabel = row.label;
    const feedback = el('entry-status');
    if (feedback) feedback.textContent = '';
    if (row.targetId) selectEntry(mode, row.targetId);
    else {
        selected = null;
        entryForm.hidden = true;
        el('selection-summary').textContent = `${row.label} : choisissez une compétence existante à laquelle relier cette forme.`;
        renderEntries();
    }
    if (selected?.type === 'skill' && checkedForms.has(el('display-name').value)) el('primary-form').value = el('display-name').value;
    renderUsages(row);
}

function renderUsages(row) {
    const list = el('form-usages');
    list.replaceChildren();
    const descriptions = [...new Set((row.occurrences || []).map(occurrence => occurrence.kind === 'career'
        ? `Carrière : ${occurrence.careerName} · rang ${occurrence.rank}`
        : `${occurrence.historical ? 'Historique XP' : 'Fiche'} : ${occurrence.scopeId}`))];
    for (const description of descriptions) {
        const item = documentRef.createElement('li'); item.textContent = description; list.append(item);
    }
}

function applyLinks(labels, primary) {
    const result = linkSkillForms(catalogue.skills, labels, primary);
    catalogue.skills = result.skills;
    checkedForms.clear();
    selectedLabel = result.primary;
    selectEntry('skill', result.targetId);
    invalidatePreview();
    setStatus(`${result.labels.length} forme(s) reliée(s) à « ${result.primary} ». Brouillon à publier.`, 'ready');
}

function renderAliases() {
    const aliasList = el('alias-list');
    aliasList.replaceChildren();
    const entry = selectedValue();
    if (!entry) return;
    const aliases = collection(selected.type).aliases.filter(alias => alias.targetId === entry.id);
    if (!aliases.length) {
        const empty = documentRef.createElement('li');
        empty.className = 'muted';
        empty.textContent = 'Aucun alias explicite.';
        aliasList.append(empty);
        return;
    }
    for (const alias of aliases) {
        const item = documentRef.createElement('li');
        item.className = 'alias-row';
        const label = documentRef.createElement('span');
        label.textContent = alias.label;
        const remove = documentRef.createElement('button');
        remove.type = 'button';
        remove.className = 'remove-alias';
        remove.textContent = 'Retirer';
        remove.setAttribute('aria-label', `Retirer l’alias ${alias.label}`);
        remove.addEventListener('click', () => {
            collection(selected.type).aliases = collection(selected.type).aliases.filter(candidate => candidate !== alias);
            renderAliases();
            renderEntries();
            invalidatePreview();
        });
        item.append(label);
        if (selected.type === 'skill') {
            const promote = documentRef.createElement('button');
            promote.type = 'button'; promote.textContent = 'Définir comme principale';
            promote.addEventListener('click', () => { try { applyLinks([entry.nom, alias.label], alias.label); } catch (error) { setStatus(error.message, 'error'); } });
            item.append(promote);
        }
        item.append(remove);
        aliasList.append(item);
    }
}

function selectEntry(type, id) {
    selected = { type, id };
    selectedLabel ||= collection(type).entries.find(entry => entry.id === id)?.nom;
    const entry = selectedValue();
    renderEntries();
    if (!entry) return;
    entryForm.hidden = false;
    el('display-name').value = entry.nom;
    el('alias-label').value = '';
    el('edit-title').textContent = type === 'skill' ? 'Compétence sélectionnée' : 'Talent sélectionné';
    el('selection-summary').textContent = [entry.nom, entry.carac, entry.basic === true ? 'compétence de base' : type === 'skill' ? 'compétence avancée' : '', ...(entry.sources || [])].filter(Boolean).join(' · ');
    el('talent-description-field').hidden = type !== 'talent';
    el('local-description').value = catalogue.talents.localDescriptions.find(item => item.talentId === entry.id)?.description || '';
    renderAliases();
}

function invalidatePreview(markDirty = true) {
    if (markDirty) { dirty = true; editRevision += 1; }
    preview = null;
    el('preview-results').hidden = true;
    el('publish-catalogue').disabled = true;
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
    storage.add(new globalThis.Option('Choisir explicitement…', ''));
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
    const proposal = documentRef.createElement('p');
    proposal.className = 'collision-proposal';
    const recommendation = collision.proposal;
    proposal.textContent = recommendation?.status === 'demonstrated'
        ? `Proposition issue des historiques (à confirmer) : ${recommendation.advances} avances. ${recommendation.reason}`
        : `${recommendation?.status === 'conflicting-history' ? 'Historiques divergents' : 'Historique insuffisant'} : ${recommendation?.reason || 'Aucune proposition automatique.'}`;
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
    const totals = documentRef.createElement('p');
    totals.className = 'preview-stat';
    const counts = result.report.counts;
    totals.textContent = `Compétences ${counts.skillLabels} · labels non résolus ${counts.unresolvedSkills} · talents ${counts.talentLabels} · références de description absentes ${counts.talentMissingDescriptions} · source talent ${counts.talentSourceUnavailable ? 'indisponible' : 'disponible'}`;
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
    collisionTitle.textContent = `Collisions à arbitrer : ${collisions.length}`;
    container.append(collisionTitle);
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
    el('publish-catalogue').disabled = blocked.length > 0;
    setStatus(`Prévisualisation prête · ${collisions.length} collision(s) · version ${result.catalogVersion}`, 'ready');
}

async function loadCatalogue() {
    const result = await send('load', {}, 0);
    catalogue = globalThis.structuredClone(result.draft);
    usageReport = result.report || null;
    dirty = false;
    checkedForms.clear();
    selected = null;
    selectedLabel = null;
    entryForm.hidden = true;
    draftRevision = result.draftRevision;
    publishedRevision = result.publishedRevision;
    el('version-status').textContent = `Publiée ${result.catalogVersion} · révision ${publishedRevision} · brouillon ${draftRevision}`;
    renderEntries();
    invalidatePreview(false);
}

async function saveDraft() {
    if (!catalogue) return;
    setStatus('Enregistrement du brouillon…');
    const savingRevision = editRevision;
    const result = await send('saveDraft', { catalogue: globalThis.structuredClone(catalogue) });
    draftRevision = result.revision;
    el('version-status').textContent = `Brouillon ${draftRevision} · version calculée ${result.catalogVersion}`;
    dirty = savingRevision !== editRevision;
    if (dirty) throw new Error('Le brouillon a changé pendant son enregistrement. Relancez la prévisualisation pour enregistrer la dernière version.');
    setStatus('Brouillon enregistré. Il reste privé jusqu’à sa publication.', 'ready');
    invalidatePreview(false);
}

function addAlias(label) {
    const entry = selectedValue();
    const clean = label.trim().replace(/\s+/gu, ' ');
    if (!entry || !clean) return;
    if (selected.type === 'skill') { applyLinks([entry.nom, clean], entry.nom); return; }
    const target = collection(selected.type);
    const key = normalize(clean);
    if (target.aliases.some(alias => normalize(alias.label) === key && alias.targetId === entry.id)) return;
    target.aliases = target.aliases.filter(alias => normalize(alias.label) !== key);
    target.aliases.push({ label: clean, targetId: entry.id, provenance: 'mj' });
    renderAliases();
    renderEntries();
    invalidatePreview();
}

function renameEntry(value) {
    const entry = selectedValue();
    const clean = value.trim().replace(/\s+/gu, ' ');
    if (!entry) throw new Error('Sélectionnez une compétence ou un talent.');
    if (!clean) throw new Error('Indiquez le nom principal.');
    if (selected.type === 'skill' && checkedForms.size) {
        applyLinks([...checkedForms, entry.nom, clean], clean);
        return;
    }
    if (clean === entry.nom) {
        setStatus(`« ${clean} » est déjà le nom principal.${dirty ? ' Le brouillon reste à enregistrer et à publier.' : ' Aucun changement à appliquer.'}`, 'ready');
        return;
    }
    if (selected.type === 'skill') {
        const existing = skillFormsResolver(catalogue.skills).resolve(clean);
        if (existing.entry && existing.entry.id !== entry.id) throw new Error('Ce nom existe déjà : cochez les deux formes pour les regrouper explicitement.');
        applyLinks([entry.nom, clean], clean); return;
    }
    const target = collection(selected.type);
    const oldName = entry.nom;
    entry.nom = clean;
    target.aliases = target.aliases.filter(alias => normalize(alias.label) !== normalize(oldName));
    target.aliases.push({ label: oldName, targetId: entry.id, provenance: 'renommage-mj' });
    selectedLabel = clean;
    selectEntry(selected.type, entry.id);
    invalidatePreview();
    setStatus(`Nom principal « ${clean} » appliqué au brouillon. Enregistrez puis publiez pour l’utiliser dans les fiches.`, 'ready');
}

async function saveTalentDescription(remove = false) {
    const entry = selectedValue();
    if (!entry || selected.type !== 'talent') return;
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
    await saveDraft();
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
    mode = type; selected = null; selectedLabel = null; entryForm.hidden = true; el('form-usages').replaceChildren(); renderEntries();
});
el('form-filter').addEventListener('change', () => { entryLimit = 250; renderEntries(); });
el('clear-forms').addEventListener('click', () => { checkedForms.clear(); renderEntries(); });
el('primary-form').addEventListener('change', () => {
    if (selected?.type === 'skill') el('display-name').value = el('primary-form').value;
});
el('link-forms').addEventListener('click', () => { try { applyLinks([...checkedForms], el('primary-form').value); } catch (error) { setStatus(error.message, 'error'); } });
el('catalogue-search').addEventListener('input', () => { entryLimit = 250; renderEntries(); });
el('load-more-entries').addEventListener('click', () => { entryLimit += 250; renderEntries(); });
el('entry-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
        if (event.submitter?.value === 'alias') addAlias(el('alias-label').value);
        else renameEntry(el('display-name').value);
    } catch (error) { setStatus(error.message, 'error'); }
});
el('save-description').addEventListener('click', () => saveTalentDescription(false).catch(error => setStatus(error.message, 'error')));
el('remove-description').addEventListener('click', () => saveTalentDescription(true).catch(error => setStatus(error.message, 'error')));
el('save-draft').addEventListener('click', () => saveDraft().catch(error => setStatus(error.message, 'error')));
el('preview-migration').addEventListener('click', async () => {
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
});
el('publish-catalogue').addEventListener('click', async () => {
    try {
        const reason = el('publication-reason').value.trim();
        if (reason.length < 3) { setStatus('Indiquez le motif de publication.', 'error'); return; }
        const revisions = Object.fromEntries((preview?.characters || []).map(item => [item.charId, item.revision]));
        const result = await send('publish', { publishedRevision, characterRevisions: revisions,
            decisions: readDecisions(), reason });
        setStatus(`Référentiel publié · ${result.catalogVersion}`, 'ready');
        await loadCatalogue();
    } catch (error) { setStatus(error.message || 'Publication refusée.', 'error'); }
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

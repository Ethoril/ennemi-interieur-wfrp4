import { armourProtection, equipmentFormula, HIT_LOCATIONS, validateEquipmentItem } from '../fiche/equipment.js';
import { ARMOUR_MEMO, ARMOUR_MEMO_SOURCE } from './memo.js';

const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLowerCase();
const copy = value => globalThis.structuredClone(value);
const pdfUrl = new URL('../../docs/memo-armures.pdf', import.meta.url).href;
/** Silhouettes des PJ (Magnific, détourées) ; les autres fiches gardent le tracé générique. */
const SILHOUETTES = new Set(['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren']);
const silhouetteUrl = id => new URL(`../../img/silhouettes/${id}.webp`, import.meta.url).href;

/** Deux cartouches au bureau, un panneau sur mobile ; les calculs restent partagés. */
export function createEquipmentView({ documentRef = globalThis.document, getContext } = {}) {
    const make = (tag, text = '', className = '') => {
        const node = documentRef.createElement(tag);
        node.textContent = text; node.className = className;
        return node;
    };
    const element = make('div', '', 'eq-panel');
    const weapons = make('section', '', 'eq-section');
    const armours = make('section', '', 'eq-section');
    element.append(weapons, armours);
    const dialog = make('dialog', '', 'eq-dialog');
    const detailDialog = make('dialog', '', 'eq-dialog');
    documentRef.body?.append(dialog, detailDialog);
    let modelSession = '';
    let stopModels = null;
    let models = [];
    let busy = false;
    let editorItem = null;
    let editorBefore = null;
    let pendingEquipmentId = null;
    let destroyed = false;
    const triggers = new WeakMap();
    const context = () => getContext?.() || {};
    const catalogue = () => context().catalogue || { items: [], keywords: [] };
    const editable = () => context().state?.role === 'mj' && context().state?.phase === 'ready' && !context().state?.pendingOperationId && context().online !== false && !busy;
    const retryable = () => context().state?.role === 'mj' && !!pendingEquipmentId && context().state?.pendingOperationId === pendingEquipmentId && context().online !== false && !busy;
    const items = () => context().state?.data?.equipment || [];
    const button = (text, handler, parent, disabled = false) => {
        const node = make('button', text, 'eq-button'); node.type = 'button'; node.disabled = disabled;
        node.addEventListener('click', handler); parent?.append(node); return node;
    };
    const restoreFocus = target => {
        const origin = triggers.get(target);
        const nodes = [...weapons.querySelectorAll('[data-eq-focus]'), ...armours.querySelectorAll('[data-eq-focus]')];
        const node = origin?.node?.isConnected ? origin.node : nodes.find(entry => entry.dataset.eqFocus === origin?.key)
            || nodes.find(entry => entry.dataset.eqFocus === origin?.fallback) || nodes.find(entry => entry.dataset.eqFocus === 'memo');
        node?.focus?.();
    };
    const finishDialog = target => target.close?.();
    const openDialog = (target, title, origin) => {
        const trigger = origin || documentRef.activeElement;
        if (!target.contains?.(trigger)) triggers.set(target, { node: trigger, key: trigger?.dataset?.eqFocus,
            fallback: trigger?.closest?.('.eq-section') === armours ? 'add:armour' : 'add:weapon' });
        target.replaceChildren();
        const header = make('div', '', 'eq-heading');
        const heading = make('h2', title); heading.id = target === dialog ? 'eq-editor-title' : 'eq-detail-title';
        target.setAttribute('aria-labelledby', heading.id);
        header.append(heading); button('Fermer', () => finishDialog(target), header);
        target.append(header);
        if (!target.open) target.showModal();
    };
    for (const target of [dialog, detailDialog]) target.addEventListener('close', () => restoreFocus(target));
    function keywordButtons(parent, words = []) {
        const group = make('div', '', 'eq-keywords');
        for (const word of words) {
            const entry = catalogue().keywords.find(row => row.id === word.id);
            if (!entry) { group.append(make('span', `${word.id}${word.parameter ? ` ${word.parameter}` : ''} · hors référentiel`, 'eq-keyword-unknown')); continue; }
            const name = entry.name.replace(/\s+X$/u, '') + (word.parameter ? ` ${word.parameter}` : '');
            const node = button(name, () => {
                openDialog(detailDialog, name, node);
                const effect = word.parameter ? entry.effect.replace(/\bX\b/gu, word.parameter) : entry.effect;
                detailDialog.append(make('p', effect), make('p', [entry.type, entry.source, entry.edition].filter(Boolean).join(' · '), 'eq-note'));
                if (entry.note) detailDialog.append(make('p', entry.note, 'eq-note'));
            }, group);
            node.className = 'eq-keyword';
            node.dataset.eqFocus = `keyword:${parent.dataset.itemId || ''}:${word.id}`;
        }
        parent.append(group);
    }
    function showMemo(origin) {
        openDialog(detailDialog, 'Mémo : armes et armures', origin);
        for (const [title, text] of ARMOUR_MEMO) detailDialog.append(make('h3', title), make('p', text));
        detailDialog.append(make('p', ARMOUR_MEMO_SOURCE, 'eq-note'));
        const link = make('a', 'Télécharger le mémo PDF', 'eq-button'); link.href = pdfUrl; link.download = 'memo-armures.pdf';
        detailDialog.append(link);
    }
    function locationDetail(location, origin) {
        openDialog(detailDialog, `${location.label} : ${location.ap} PA`, origin);
        detailDialog.append(make('p', 'Cumul de référence ; les circonstances peuvent ignorer les PA de certaines pièces.', 'eq-note'));
        for (const item of location.counted) {
            const row = make('div', '', 'eq-detail-row');
            row.append(make('h3', `${item.name} · ${item.ap} PA`), make('p', item.category));
            keywordButtons(row, item.keywords); detailDialog.append(row);
        }
        if (!location.counted.length) detailDialog.append(make('p', 'Aucune protection chiffrée sur cette zone.'));
        for (const { item, reason } of location.ignored) detailDialog.append(make('p', `${item.name} : ${reason}.`, 'eq-note'));
    }
    function field(form, key, label, value, type = 'text') {
        const wrapper = make('label', label, 'eq-field');
        const input = make(type === 'textarea' ? 'textarea' : 'input');
        input.name = key; input.value = value ?? ''; input.maxLength = type === 'textarea' ? 5000 : 300;
        if (type !== 'textarea') input.type = type;
        if (type === 'number') { input.min = '0'; input.max = '100'; }
        if (key === 'name') input.required = true;
        wrapper.append(input); form.append(wrapper); return input;
    }
    function errorMessage(error) {
        if (String(error?.code).includes('aborted')) return 'La fiche ou cet objet a changé. Fermez puis rouvrez son détail avant de modifier.';
        return error?.message || 'Enregistrement impossible. Réessayez.';
    }
    function offerRetry(payload, feedback) {
        pendingEquipmentId = context().state?.pendingOperationId || null;
        if (!pendingEquipmentId) return;
        dialog.querySelector('.eq-retry')?.remove();
        const retry = button('Réessayer', async () => { const done = await send(payload, feedback, true); if (done) finishDialog(dialog); }, dialog);
        retry.classList.add('eq-retry'); retry.dataset.eqRetry = 'true';
    }
    async function send(payload, feedback, retry = false) {
        if (!(retry ? retryable() : editable())) return false;
        busy = true; update(); feedback.textContent = 'Enregistrement…';
        try {
            const controller = context().controller;
            const result = retry ? await controller.retryPendingCommand() : await controller.executeOnlineCommand('equipment', payload);
            if (result.status !== 'confirmed') {
                feedback.textContent = 'Confirmation en attente. Utilisez Réessayer pour reprendre la même opération.';
                offerRetry(payload, feedback);
                return false;
            }
            pendingEquipmentId = null;
            return true;
        } catch (error) { feedback.textContent = errorMessage(error); offerRetry(payload, feedback); return false; }
        finally { busy = false; update(); }
    }
    function editItem(item, origin, before = null) {
        if (!editable()) return;
        editorItem = copy(item); editorBefore = before && copy(before);
        openDialog(dialog, before ? `Modifier : ${item.name}` : 'Ajouter un objet', origin);
        const form = make('form', '', 'eq-form');
        field(form, 'name', 'Nom', item.name);
        field(form, 'category', 'Catégorie', item.category);
        let apInput;
        if (item.kind !== 'armour') {
            // Le type reste modifiable : une munition peut partir de n'importe quelle base.
            const wrapper = make('label', 'Type', 'eq-field'); const select = make('select'); select.name = 'kind';
            for (const [value, text] of [['weapon', 'Arme'], ['shield', 'Bouclier'], ['ammunition', 'Munition']]) {
                const option = make('option', text); option.value = value; option.selected = value === item.kind; select.append(option);
            }
            wrapper.append(select); form.append(wrapper);
            const damage = field(form, 'damage', 'Dégâts de base (ex. BF + 4)', item.damage);
            field(form, 'reach', 'Allonge', item.reach); field(form, 'range', 'Portée (ex. BF × 2)', item.range);
            apInput = field(form, 'ap', 'PA du bouclier (vide si indéterminés)', item.ap, 'number');
            const showKind = () => {
                damage.parentNode.firstChild.nodeValue = select.value === 'ammunition' ? 'Modificateur de dégâts (ex. +1)' : 'Dégâts de base (ex. BF + 4)';
                apInput.parentNode.hidden = select.value !== 'shield';
            };
            select.addEventListener('change', showKind); showKind();
        } else apInput = field(form, 'ap', 'PA (vide si indéterminés)', item.ap, 'number');
        if (item.kind === 'armour') {
            const wrapper = make('label', 'Cumul', 'eq-field'); const select = make('select'); select.name = 'layer';
            for (const [value, text] of [['leather', 'Cuir souple (sous-couche)'], ['rigid', 'Armure (Flexible si le mot clé est présent)'], ['bonus', 'Bonus explicitement additionnel'],
                ['none', 'Sans couche indiquée (comptée comme armure, Flexible si le mot clé est présent)']]) {
                const option = make('option', text); option.value = value; option.selected = value === (item.layer === 'flexible' ? 'rigid' : item.layer); select.append(option);
            }
            wrapper.append(select); form.append(wrapper);
            const zones = make('fieldset'); zones.append(make('legend', 'Zones protégées'));
            for (const zone of HIT_LOCATIONS) {
                const label = make('label', zone.label, 'eq-check'); const input = make('input'); input.type = 'checkbox'; input.name = 'location'; input.value = zone.id; input.checked = item.locations.includes(zone.id);
                label.prepend(input); zones.append(label);
            }
            form.append(zones);
        }
        const words = make('fieldset'); words.append(make('legend', 'Mots clés du référentiel'));
        const keywordRows = make('div', '', 'eq-keyword-editor');
        for (const word of item.keywords) addKeywordRow(word);
        function addKeywordRow(word) {
            const definition = catalogue().keywords.find(entry => entry.id === word.id);
            const row = make('div', '', 'eq-keyword-edit-row'); row.dataset.keyword = word.id;
            if (!definition) {
                // Conservé tel quel tant que le MJ ne le retire pas explicitement.
                row.dataset.parameter = word.parameter; row.classList?.add('eq-keyword-unknown');
                row.append(make('span', `${word.id}${word.parameter ? ` ${word.parameter}` : ''} · hors référentiel`));
            } else row.append(make('span', definition.name));
            if (definition?.parameter) {
                const input = make('input'); input.value = word.parameter; input.maxLength = 100; input.setAttribute('aria-label', `Paramètre de ${definition.name}`);
                if (item.kind === 'shield' && word.id === 'protectrice') {
                    input.type = 'number'; input.min = '0'; input.max = '100'; input.value = word.parameter || apInput.value;
                    input.addEventListener('input', () => { apInput.value = input.value; });
                    apInput.addEventListener('input', () => { input.value = apInput.value; });
                }
                row.append(input);
            }
            button('Retirer', () => row.remove(), row); keywordRows.append(row);
        }
        const select = make('select'); select.setAttribute('aria-label', 'Ajouter un mot clé');
        for (const entry of catalogue().keywords) { const option = make('option', entry.name); option.value = entry.id; select.append(option); }
        words.append(keywordRows, select);
        button('Ajouter le mot clé', () => {
            if (![...keywordRows.children].some(row => row.dataset.keyword === select.value)) addKeywordRow({ id: select.value, parameter: '' });
        }, words); form.append(words);
        field(form, 'notes', 'Effets, pénalités et particularités (rappel)', item.notes, 'textarea');
        const feedback = make('p', '', 'eq-feedback'); feedback.setAttribute('role', 'status');
        const save = make('button', 'Enregistrer sur la fiche', 'eq-button eq-primary'); save.type = 'submit'; save.dataset.eqEdit = 'true';
        form.append(make('p', 'Les autres objets et les XP restent inchangés.', 'eq-note'), save, feedback);
        const value = () => {
            const read = key => form.elements.namedItem(key)?.value || '';
            const kind = item.kind === 'armour' ? 'armour' : read('kind');
            const next = { ...copy(editorItem), kind, name: read('name').trim(), category: read('category'), notes: read('notes'), custom: true };
            if (kind !== 'armour') for (const key of ['damage', 'reach', 'range']) next[key] = read(key);
            if (['armour', 'shield'].includes(kind)) next.ap = read('ap') === '' ? null : Number(read('ap'));
            else if (kind !== editorItem.kind) next.ap = null;
            // L'option « Armure » couvre flexible et rigide : une pièce flexible le reste.
            if (kind === 'armour') { next.layer = read('layer') === 'rigid' && item.layer === 'flexible' ? 'flexible' : read('layer'); next.locations = [...form.querySelectorAll('[name="location"]:checked')].map(input => input.value); }
            next.keywords = [...keywordRows.children].map(row => ({ id: row.dataset.keyword, parameter: row.querySelector('input')?.value ?? row.dataset.parameter ?? '' }));
            // Type passé à Bouclier après ouverture : PA et Protectrice restent alignés.
            const guard = next.keywords.find(word => word.id === 'protectrice');
            if (kind === 'shield' && guard && /^d+$/u.test(guard.parameter) && next.ap === null) next.ap = Number(guard.parameter);
            if (kind === 'shield' && guard && !guard.parameter && next.ap !== null) guard.parameter = String(next.ap);
            return validateEquipmentItem(next, catalogue());
        };
        form.addEventListener('submit', async event => {
            event.preventDefault(); if (!editable()) return;
            try {
                const next = value();
                const unchanged = JSON.stringify({ ...next, custom: false }) === JSON.stringify({ ...editorItem, custom: false });
                if (unchanged) next.custom = editorItem.custom;
                const done = await send({ action: before ? 'update' : 'add', ...(before ? { id: before.id, before: editorBefore } : {}), item: next, reason: `${before ? 'Modification' : 'Ajout'} : ${next.name}` }, feedback);
                if (done) finishDialog(dialog);
            } catch (error) { feedback.textContent = errorMessage(error); }
        });
        const templateButton = button('Enregistrer comme modèle MJ', async () => {
            if (!editable()) return;
            const repository = context().repository;
            if (!repository?.saveEquipmentModel) { feedback.textContent = 'Enregistrement des modèles indisponible pour le moment. Rechargez la fiche puis réessayez.'; return; }
            try {
                const next = value(); busy = true; update();
                await repository.saveEquipmentModel(`model_${globalThis.crypto.randomUUID()}`, next);
                feedback.textContent = 'Modèle enregistré. Il sera proposé lors d’un ajout sur les autres fiches.';
            } catch (error) { feedback.textContent = errorMessage(error); }
            finally { busy = false; update(); }
        }, form);
        templateButton.dataset.eqEdit = 'true';
        dialog.append(form, make('p', item.source, 'eq-note'));
    }
    function chooseItem(kind, origin) {
        if (!editable()) return;
        openDialog(dialog, kind === 'armour' ? 'Ajouter une armure' : 'Ajouter une arme ou un bouclier', origin);
        const query = make('input'); query.type = 'search'; query.placeholder = 'Rechercher un nom ou une catégorie…'; query.setAttribute('aria-label', 'Rechercher un équipement');
        const results = make('div', '', 'eq-choices'); dialog.append(query, results);
        const renderResults = () => {
            const words = fold(query.value).split(/\s+/u).filter(Boolean);
            const entries = [...catalogue().items.map(item => ({ item, model: false })), ...models.map(model => ({ item: { ...model.item, baseId: `model_${model.id}` }, model: true }))];
            results.replaceChildren();
            for (const { item, model } of entries.filter(({ item }) => (kind === 'armour' ? item.kind === 'armour' : item.kind !== 'armour') && words.every(word => fold(`${item.name} ${item.category}`).includes(word)))) {
                const node = button(`${item.name} · ${item.category}${model ? ' · Modèle MJ' : ''}`, () => editItem(item, origin), results, !editable());
                node.dataset.eqEdit = 'true';
            }
            if (!results.children.length) results.append(make('p', 'Aucun objet ne correspond à cette recherche.'));
        };
        query.addEventListener('input', renderResults); renderResults(); query.focus();
    }
    function removeItem(item, origin) {
        if (!editable()) return;
        openDialog(dialog, `Retirer : ${item.name}`, origin);
        dialog.append(make('p', 'Retirer cet objet de la fiche ?'));
        const feedback = make('p', '', 'eq-feedback'); feedback.setAttribute('role', 'status');
        const node = button('Retirer de la fiche', async () => {
            const done = await send({ action: 'remove', id: item.id, before: copy(item), reason: `Retrait : ${item.name}` }, feedback);
            if (done) finishDialog(dialog);
        }, dialog); node.dataset.eqEdit = 'true'; dialog.append(feedback);
    }
    function resetItem(item, origin) {
        const latest = catalogue().items.find(entry => entry.id === item.baseId)
            || models.find(model => `model_${model.id}` === item.baseId)?.item;
        if (!latest) return;
        openDialog(dialog, 'Actualiser depuis la base', origin);
        dialog.append(make('p', `Remplacer les valeurs et le nom de « ${item.name} » par le profil « ${latest.name} » ? Les modifications personnalisées seront remplacées.`));
        const feedback = make('p', '', 'eq-feedback'); feedback.setAttribute('role', 'status');
        const node = button('Appliquer le profil de base', async () => {
            const done = await send({ action: 'update', id: item.id, before: copy(item), item: { ...copy(latest), id: item.id, baseId: item.baseId }, reason: `Actualisation : ${item.name}` }, feedback);
            if (done) finishDialog(dialog);
        }, dialog); node.dataset.eqEdit = 'true'; dialog.append(feedback);
    }
    function itemRow(item, parent) {
        const row = make('article', '', 'eq-item');
        row.dataset.itemId = item.id;
        row.append(make('h3', item.name), make('p', `${item.category}${item.custom ? ' · Personnalisé par le MJ' : ''}`, 'eq-note'));
        const facts = make('dl', '', 'eq-facts');
        const fact = (label, text) => facts.append(make('dt', label), make('dd', text));
        if (item.kind === 'armour') {
            fact('Protection', item.ap === null ? 'PA à confirmer' : `${item.ap} PA`);
            fact('Zones', HIT_LOCATIONS.filter(zone => item.locations.includes(zone.id)).map(zone => zone.label).join(', ') || 'Selon l’effet particulier');
        } else {
            if (item.kind === 'shield' && !item.damage.trim()) fact('Usage offensif', 'Aucun profil offensif');
            else fact(item.kind === 'ammunition' ? 'Modificateur' : 'Dégâts de base', equipmentFormula(item.damage, context().state?.data).label);
            if (item.reach) fact('Allonge', item.reach);
            if (item.range || item.source.includes('Armes à Distance')) fact('Portée', item.range ? `${equipmentFormula(item.range, context().state?.data).label}${/^(?:BF|[0-9])/iu.test(item.range) ? ' m' : ''}` : 'À confirmer par le MJ');
            if (item.kind === 'shield') fact('Protection conditionnelle', item.ap === null ? 'PA à confirmer' : `+ ${item.ap} PA si applicable`);
        }
        row.append(facts); keywordButtons(row, item.keywords);
        const details = make('details'); details.append(make('summary', 'Effets et source'), make('p', item.notes || 'Aucun effet particulier.'), make('p', item.source, 'eq-note')); row.append(details);
        if (context().state?.role === 'mj') {
            const actions = make('div', '', 'eq-actions');
            const edit = button('Modifier', () => editItem(item, edit, item), actions, !editable()); edit.dataset.eqEdit = 'true';
            edit.dataset.eqFocus = `edit:${item.id}`;
            const remove = button('Retirer', () => removeItem(item, remove), actions, !editable()); remove.dataset.eqEdit = 'true';
            remove.dataset.eqFocus = `remove:${item.id}`;
            if (catalogue().items.some(base => base.id === item.baseId) || models.some(model => `model_${model.id}` === item.baseId)) {
                const reset = button('Actualiser la base', () => resetItem(item, reset), actions, !editable()); reset.dataset.eqEdit = 'true';
                reset.dataset.eqFocus = `reset:${item.id}`;
            }
            row.append(actions);
        }
        parent.append(row);
    }
    function update() {
        if (destroyed) return;
        const current = context();
        if (documentRef.body && !dialog.isConnected) documentRef.body.append(dialog, detailDialog);
        const session = `${current.state?.uid || ''}:${current.state?.role || ''}:${current.state?.charId || ''}`;
        if (session !== modelSession) {
            stopModels?.(); stopModels = null; models = []; modelSession = session; pendingEquipmentId = null;
            dialog.close?.(); detailDialog.close?.();
            if (current.state?.role === 'mj' && current.repository?.subscribeEquipmentModels) stopModels = current.repository.subscribeEquipmentModels(rows => {
                models = rows.filter(row => { try { validateEquipmentItem(row.item, catalogue()); return true; } catch { return false; } }); update();
            }, () => {});
        }
        for (const node of dialog.querySelectorAll('[data-eq-edit]')) node.disabled = !editable();
        for (const node of dialog.querySelectorAll('[data-eq-retry]')) node.disabled = !retryable();
        weapons.replaceChildren(); armours.replaceChildren();
        if (!current.state?.data) { dialog.close?.(); detailDialog.close?.(); return; }
        const heading = (parent, title, kind) => {
            const header = make('div', '', 'eq-heading'); header.append(make('h2', title));
            if (current.state.role === 'mj') { const node = button('+ Ajouter', () => chooseItem(kind, node), header, !editable()); node.dataset.eqEdit = 'true'; node.dataset.eqFocus = `add:${kind}`; }
            parent.append(header);
        };
        heading(weapons, 'Armes et boucliers', 'weapon'); heading(armours, 'Armures', 'armour');
        if (current.state.role === 'mj' && !editable()) weapons.append(make('p', current.online === false ? 'Consultation hors connexion. La modification nécessite une connexion.' : 'Modification momentanément indisponible.', 'eq-note'));
        const weaponItems = items().filter(item => item.kind !== 'armour');
        for (const item of weaponItems) itemRow(item, weapons);
        if (!weaponItems.length) weapons.append(make('p', 'Aucune arme indiquée.'));
        const armour = armourProtection(items());
        const figure = make('div', '', 'eq-silhouette'); figure.setAttribute('aria-label', 'Points d’armure par localisation');
        if (SILHOUETTES.has(current.state.charId)) {
            const portrait = make('img', '', 'eq-figure'); portrait.src = silhouetteUrl(current.state.charId); portrait.alt = '';
            portrait.decoding = 'async'; portrait.setAttribute('aria-hidden', 'true'); figure.classList?.add('eq-silhouette-pj'); figure.append(portrait);
        } else {
            const nsNode = tag => documentRef.createElementNS ? documentRef.createElementNS('http://www.w3.org/2000/svg', tag) : make(tag);
            const svg = nsNode('svg');
            svg.setAttribute('viewBox', '0 0 240 280'); svg.setAttribute('aria-hidden', 'true');
            const head = nsNode('circle'); head.setAttribute('cx', '120'); head.setAttribute('cy', '35'); head.setAttribute('r', '20');
            const body = nsNode('path'); body.setAttribute('d', 'M92 65 Q120 52 148 65 L170 138 L150 145 L137 103 L140 170 L151 248 L130 254 L120 188 L110 254 L89 248 L100 170 L103 103 L90 145 L70 138 Z');
            svg.append(head, body); figure.append(svg);
        }
        for (const zone of armour.locations) {
            const node = button(`${zone.label} · ${zone.ap} PA${zone.conditional.length ? ' *' : ''}`, () => locationDetail(zone, node), figure);
            node.className = `eq-zone eq-zone-${zone.id}`;
            node.dataset.eqFocus = `zone:${zone.id}`;
            node.setAttribute('aria-label', `${zone.label}, ${zone.ap} points d’armure${zone.conditional.length ? ', protection conditionnelle' : ''}, détail du cumul`);
        }
        armours.append(figure);
        if (armour.locations.some(zone => zone.conditional.length)) armours.append(make('p', '* Certains PA dépendent des mots clés Partielle ou Points faibles. Touchez la zone pour le détail.', 'eq-note'));
        if (armour.shield) armours.append(make('p', `Bouclier : + ${armour.shield.ap} PA si applicable (${armour.shield.name}). Un seul bouclier compte.`, 'eq-shield-note'));
        const memo = button('Comprendre le cumul des armures', () => showMemo(memo), armours);
        memo.dataset.eqFocus = 'memo';
        const armourItems = items().filter(item => item.kind === 'armour');
        for (const item of armourItems) itemRow(item, armours);
        if (!armourItems.length) armours.append(make('p', 'Aucune armure indiquée.'));
        const talents = new Map();
        for (const row of current.state.data.talentsAcq || []) {
            const match = current.engine?.resolveTalent?.(row.nom);
            const description = match?.description || match?.entry?.description || '';
            // La fiche n'ajuste aucune caractéristique par talent : Très fort reste un rappel, hors du BF calculé.
            if (/dégât|armure|portée|bouclier|\bforce\b(?!\s+mentale)/iu.test(description) || /^tr[eè]s fort/iu.test(row.nom)) talents.set(row.nom, description);
        }
        if (talents.size) {
            const reminders = make('details', '', 'eq-reminders'); reminders.append(make('summary', 'Talents à appliquer séparément'));
            for (const [name, text] of talents) reminders.append(make('h3', name), make('p', text));
            weapons.append(reminders);
        }
    }
    return Object.freeze({ element, weapons, armours, update,
        close() { dialog.close?.(); detailDialog.close?.(); },
        destroy() { destroyed = true; stopModels?.(); stopModels = null; modelSession = ''; dialog.close?.(); detailDialog.close?.(); dialog.remove?.(); detailDialog.remove?.(); },
    });
}

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

const UNCERTAIN = ['unavailable', 'deadline-exceeded', 'internal', 'unknown'];
const SPEC_ERRORS = {
    'basic-specialization-invalid': 'Spécialité absente du référentiel publié.',
    'specialization-has-advances': 'La spécialité ne peut plus changer après des avances.',
};

/**
 * Spécialités dans le volet d'une compétence (cible `target.specialty` de purchaseTarget) :
 * - { kind: 'basic' } : champ « Spécialité » d'une compétence de base, enregistré par un patch `basicSpecs.<ligne>` ;
 * - { kind: 'group' } : « Ajouter une spécialité » du groupe, qui appelle onChoose(nom) pour ouvrir l'achat de la nouvelle ligne
 *   (onChoose renvoie false si le nom n'est pas une compétence avancée valable).
 * `idPrefix` : préfixe des identifiants (deux sections peuvent coexister) ; `expanded` : sélecteur de groupe toujours ouvert (sans bouton d'ouverture).
 * `getContext()` → { state, engine, controller }. Construit une fois ; update(target) ne réécrit que les textes.
 */
export function createSpecialtySection({ documentRef, getContext, onChoose, announce = () => {}, idPrefix = 'm-spec', expanded = false }) {
    const root = make(documentRef, 'div', '', 'm-spec');

    const basic = make(documentRef, 'div', '', 'm-spec-block');
    const label = make(documentRef, 'label', 'Spécialité', 'm-spec-label');
    label.setAttribute('for', `${idPrefix}-input`);
    const field = make(documentRef, 'div', '', 'm-spec-field');
    const input = make(documentRef, 'input', '', 'm-search-input');
    input.id = `${idPrefix}-input`;
    input.type = 'text';
    input.autocomplete = 'off';
    input.setAttribute('list', `${idPrefix}-options`);
    input.setAttribute('maxlength', '200');
    const datalist = make(documentRef, 'datalist');
    datalist.id = `${idPrefix}-options`;
    const save = make(documentRef, 'button', 'Enregistrer', 'm-button');
    save.type = 'button';
    field.append(input, save);
    const basicNote = make(documentRef, 'p', '', 'm-spec-note');
    basicNote.setAttribute('role', 'status');
    basic.append(label, field, datalist, basicNote);

    const group = make(documentRef, 'div', '', 'm-spec-block');
    const toggle = make(documentRef, 'button', 'Ajouter une spécialité', 'm-button');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.hidden = expanded;
    const picker = make(documentRef, 'div', '', 'm-spec-picker');
    picker.hidden = !expanded;
    const choices = make(documentRef, 'div', '', 'm-spec-choices');
    const freeLabel = make(documentRef, 'label', 'Autre spécialité', 'm-spec-label');
    freeLabel.setAttribute('for', `${idPrefix}-free`);
    const freeField = make(documentRef, 'div', '', 'm-spec-field');
    const free = make(documentRef, 'input', '', 'm-search-input');
    free.id = `${idPrefix}-free`;
    free.type = 'text';
    free.autocomplete = 'off';
    free.setAttribute('maxlength', '200');
    const freeGo = make(documentRef, 'button', 'Choisir', 'm-button');
    freeGo.type = 'button';
    freeField.append(free, freeGo);
    const groupNote = make(documentRef, 'p', '', 'm-spec-note');
    groupNote.setAttribute('role', 'status');
    picker.append(choices, freeLabel, freeField, groupNote);
    group.append(toggle, picker);


    let specialty = null;
    let shown = '';
    let builtFor = '';
    let listedFor = '';
    let shownKind = '';
    let busy = false;
    let message = '';

    const choose = name => {
        if (!name || !onChoose(name)) { groupNote.textContent = 'Cette spécialité n’est pas disponible comme compétence avancée.'; return; }
        groupNote.textContent = '';
        free.value = '';
        picker.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    };
    toggle.addEventListener('click', () => {
        picker.hidden = !picker.hidden;
        toggle.setAttribute('aria-expanded', String(!picker.hidden));
        groupNote.textContent = '';
    });
    freeGo.addEventListener('click', () => {
        const typed = free.value.trim();
        choose(typed && `${specialty.group} (${typed})`);
    });
    free.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); freeGo.click?.(); } });

    async function saveBasic() {
        const context = getContext();
        const { row, value: previous } = specialty;
        const value = input.value.trim();
        if (value === previous) return;
        // Chemin encodé comme le pont du bureau (js/fiche-client-bridge.js) ; le moteur valide la valeur avant la mise en brouillon.
        const path = `basicSpecs.${encodeURIComponent(row).replaceAll('.', '%2E')}`;
        busy = true;
        message = '';
        update({ specialty });
        try {
            context.engine.validatePatch(context.state.data, { changes: { [path]: value } });
            if (!context.controller.stagePatch({ [path]: value }).ok) throw new Error('not-editable');
            try {
                const result = await context.controller.submitPatch();
                if (['saved', 'awaiting-snapshot'].includes(result?.status)) announce('Spécialité enregistrée');
                else if (result?.status === 'blocked' && result.reason === 'offline') {
                    message = 'Enregistrée sur cet appareil, envoi dès le retour en ligne.';
                } else message = 'Enregistrement en attente : la fiche est occupée ou a changé. Réessayez dans un instant.';
            } catch (failure) {
                // Un patch refusé ne doit pas rester en brouillon : on revient à la valeur du serveur (même quand
                // aucune spécialité n'existait). Une réponse incertaine garde son opération en attente.
                if (!UNCERTAIN.includes(String(failure?.code || '').split('/').at(-1))) context.controller.resolveConflict(path, 'server');
                throw failure;
            }
        } catch (failure) {
            message = SPEC_ERRORS[failure?.details?.kind] || 'Enregistrement impossible. Réessayez.';
        } finally {
            busy = false;
            update({ specialty });
        }
    }
    save.addEventListener('click', () => { void saveBasic(); });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void saveBasic(); } });

    function update(target, locked = false) {
        specialty = target?.specialty || null;
        root.hidden = !specialty;
        // Le bloc inactif quitte le DOM : un bouton caché ne doit pas compter dans le piège de focus du volet.
        if (shownKind !== (specialty?.kind ?? '')) {
            shownKind = specialty?.kind ?? '';
            root.replaceChildren(...(shownKind === 'basic' ? [basic] : shownKind === 'group' ? [group] : []));
        }
        if (!specialty) return;
        if (specialty.kind === 'basic') {
            // Un snapshot qui arrive pendant la saisie ne doit pas effacer ce que l'on tape.
            const stamp = `${specialty.row}\n${specialty.value}`;
            if (stamp !== shown) { shown = stamp; input.value = specialty.value; message = ''; }
            if (listedFor !== specialty.row) {
                listedFor = specialty.row;
                datalist.replaceChildren(...specialty.options.map(value => {
                    const option = make(documentRef, 'option');
                    option.value = value;
                    return option;
                }));
            }
            input.disabled = specialty.locked || busy;
            save.disabled = specialty.locked || busy;
            basicNote.textContent = specialty.locked ? 'Modifiable seulement tant que la compétence n’a aucune avance.' : message;
        } else if (builtFor !== specialty.group) {
            builtFor = specialty.group;
            groupNote.textContent = '';
            free.setAttribute('maxlength', String(Math.max(0, 200 - specialty.group.length - 3)));
            choices.replaceChildren(...specialty.options.map(({ nom, spec }) => {
                const button = make(documentRef, 'button', spec, 'm-chip');
                button.type = 'button';
                button.setAttribute('aria-label', `Ajouter ${nom}`);
                button.addEventListener('click', () => choose(nom));
                return button;
            }));
        }
        if (specialty.kind === 'group') {
            // Achat en attente de reprise : la commande est rejouée telle quelle, le choix ne peut plus changer.
            for (const control of [toggle, free, freeGo, ...choices.children]) control.disabled = locked;
        }
    }

    return Object.freeze({ element: root, update });
}

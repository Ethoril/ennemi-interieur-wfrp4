import { groupKey, normalizeGroups, MAX_GROUPS, MAX_GROUP_LENGTH } from './pnj-groups.js';

/** Build an accessible, dependency-free group chip editor around an existing text input. */
export function createGroupPicker({ documentRef = document, input, initialGroups = [], catalog = [], onChange = () => {} }) {
    if (!input) throw new TypeError('createGroupPicker requires an input');
    const host = input.parentNode;
    const chips = documentRef.createElement('div');
    chips.className = 'pnj-group-chips';
    chips.setAttribute('aria-label', 'Groupes associés');
    chips.setAttribute('role', 'list');
    const feedback = documentRef.createElement('span');
    feedback.id = `pnj-group-feedback-${input.id || 'input'}`;
    feedback.className = 'pnj-group-feedback visually-hidden';
    feedback.setAttribute('aria-live', 'polite');
    const addButton = documentRef.createElement('button');
    addButton.type = 'button';
    addButton.className = 'btn-ghost-sm pnj-group-add';
    addButton.textContent = 'Ajouter';
    addButton.setAttribute('aria-label', 'Ajouter le groupe saisi');
    const oldList = input.getAttribute('list');
    const oldDescription = input.getAttribute('aria-describedby');
    const listId = oldList || `${input.id || 'pnj-group'}-suggestions`;
    const datalist = documentRef.createElement('datalist');
    datalist.id = listId;
    input.setAttribute('list', listId);
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), feedback.id].filter(Boolean).join(' '));
    // Preserve a previously assigned description id for the live status too.
    host?.appendChild(addButton);
    host?.appendChild(feedback);
    host?.appendChild(datalist);
    host?.appendChild(chips);

    let groups = normalizeGroups(initialGroups, catalog);
    let suggestions = [...catalog];
    let destroyed = false;
    let disabled = false;

    function announce(message) { feedback.textContent = message; }
    function render() {
        while (chips.firstChild) chips.removeChild(chips.firstChild);
        groups.forEach((label, index) => {
            const chip = documentRef.createElement('span');
            chip.className = 'pnj-group-chip';
            chip.setAttribute('role', 'listitem');
            const text = documentRef.createElement('span');
            text.textContent = label;
            const remove = documentRef.createElement('button');
            remove.type = 'button';
            remove.className = 'pnj-group-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Retirer le groupe ${label}`);
            remove.disabled = disabled;
            remove.addEventListener('click', () => {
                groups = groups.filter((_, i) => i !== index);
                render();
                onInput();
                input.focus?.();
                onChange([...groups]);
                announce(`Groupe ${label} retiré.`);
            });
            chip.appendChild(text);
            chip.appendChild(remove);
            chips.appendChild(chip);
        });
    }
    function setError(message) {
        input.setCustomValidity(message);
        announce(message);
        return false;
    }
    function addPending() {
        const raw = input.value.trim().replace(/\s+/gu, ' ');
        if (!raw) { input.setCustomValidity(''); return true; }
        if (raw.length > MAX_GROUP_LENGTH) return setError(`Un groupe ne peut pas dépasser ${MAX_GROUP_LENGTH} caractères.`);
        input.setCustomValidity('');
        const normalized = normalizeGroups([...groups, raw], suggestions);
        const key = groupKey(raw);
        if (groups.some(group => groupKey(group) === key)) {
            input.value = '';
            announce('Ce groupe est déjà ajouté.');
            return true;
        }
        if (normalized.length > MAX_GROUPS) return setError(`Un personnage peut avoir au maximum ${MAX_GROUPS} groupes.`);
        groups = normalized;
        input.value = '';
        onInput();
        render();
        api.setCatalog(suggestions);
        onChange([...groups]);
        announce(`Groupe ${groups.at(-1)} ajouté.`);
        return true;
    }
    const onAddClick = () => addPending();
    const onKeydown = event => {
        if (event.key === 'Enter') { event.preventDefault(); addPending(); }
    };
    const onInput = () => {
        const raw = input.value.trim();
        if (!raw) input.setCustomValidity('');
        else if (raw.length > MAX_GROUP_LENGTH) input.setCustomValidity(`Un groupe ne peut pas dépasser ${MAX_GROUP_LENGTH} caractères.`);
        else if (!groups.some(group => groupKey(group) === groupKey(raw)) && groups.length >= MAX_GROUPS) input.setCustomValidity(`Un personnage peut avoir au maximum ${MAX_GROUPS} groupes.`);
        else input.setCustomValidity('');
        onChange(normalizeGroups([...groups, raw], suggestions));
    };
    addButton.addEventListener('click', onAddClick);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('input', onInput);
    render();

    const api = {
        getGroups() { return normalizeGroups([...groups, input.value], suggestions); },
        setGroups(array) { groups = normalizeGroups(array, suggestions); input.value = ''; input.setCustomValidity(''); feedback.textContent = ''; render(); },
        setCatalog(array) {
            suggestions = normalizeGroups(array);
            while (datalist.firstChild) datalist.removeChild(datalist.firstChild);
            suggestions.forEach(label => { const option = documentRef.createElement('option'); option.value = label; datalist.appendChild(option); });
        },
        setDisabled(value) {
            disabled = Boolean(value);
            input.disabled = disabled;
            addButton.disabled = disabled;
            chips.querySelectorAll('button').forEach(button => { button.disabled = disabled; });
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            addButton.removeEventListener('click', onAddClick);
            input.removeEventListener('keydown', onKeydown);
            input.removeEventListener('input', onInput);
            chips.remove(); addButton.remove(); feedback.remove();
            datalist.remove();
            if (oldList == null) input.removeAttribute('list'); else input.setAttribute('list', oldList);
            if (oldDescription == null) input.removeAttribute('aria-describedby'); else input.setAttribute('aria-describedby', oldDescription);
        },
    };
    api.setCatalog(suggestions);
    return api;
}

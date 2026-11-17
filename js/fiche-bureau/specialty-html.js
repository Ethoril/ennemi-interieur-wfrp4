import { esc } from '../utils.js';

const LOCK_NOTE = 'Modifiable seulement tant que la compétence n’a aucune avance.';

/** Nom d'une compétence avancée libre `Groupe (Texte)` ; null si le texte est vide, trop long, entre parenthèses ou « au choix ». */
export function freeSpecialtyName(group, typed) {
    const text = String(typed ?? '').replace(/\s+/gu, ' ').trim();
    const folded = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    if (!text || /[()]/u.test(text) || /\bau choix\b/u.test(folded) || `${group} (${text})`.length > 200) return null;
    return `${group} (${text})`;
}

function chips(action, rows, current, disabled) {
    return `<div class="bureau-chips">${rows.map(({ value, label }) => `<button type="button" class="bureau-chip" data-action="${action}" data-value="${esc(value)}" aria-pressed="${value === current}" ${disabled ? 'disabled' : ''}>${esc(label)}</button>`).join('')}</div>`;
}

/**
 * Spécialités d'une compétence dans l'inspecteur du bureau : connues en boutons (jamais de liste déroulante ni de datalist)
 * et champ « Nouvelle spécialité ». `target.specialty` vient de purchaseTarget ; `name` est le nom de la ligne ciblée (groupe).
 */
export function specialtyControlsHtml(specialty, { name = '', editable = true } = {}) {
    if (specialty?.kind === 'group') {
        const disabled = !editable;
        return `<div class="bureau-specialty"><p>Spécialité</p>${chips('skill-spec-pick', specialty.options.map(row => ({ value: row.nom, label: row.spec })), name, disabled)}`
            + `<label>Nouvelle spécialité<input id="bureau-skill-free" data-group="${esc(specialty.group)}" maxlength="${Math.max(0, 200 - specialty.group.length - 3)}" autocomplete="off" ${disabled ? 'disabled' : ''}></label>`
            + `<button type="button" data-action="skill-spec-free" ${disabled ? 'disabled' : ''}>Choisir</button></div>`;
    }
    if (specialty?.kind === 'basic') {
        const disabled = specialty.locked || !editable;
        return `<div class="bureau-specialty"><p>Spécialité</p>${chips('basic-spec-pick', specialty.options.map(value => ({ value, label: value })), specialty.value, disabled)}`
            + `<label>Nouvelle spécialité<input id="bureau-basic-free" maxlength="150" autocomplete="off" ${disabled ? 'disabled' : ''}></label>`
            + `<button type="button" data-action="basic-spec-free" ${disabled ? 'disabled' : ''}>Enregistrer</button>`
            + `${specialty.locked ? `<p class="bureau-muted">${LOCK_NOTE}</p>` : ''}</div>`;
    }
    return '';
}

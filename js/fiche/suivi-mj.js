// Section « Suivi du MJ » : champ `suiviMj`, écrit par la seule commande `outil-mj` (outil MJ, chantier H).
// Lecture seule pour tous sur le site : ni le joueur ni une modification simple ne peuvent l'écrire.
// Logique pure (aucun DOM) : regroupement et rendu HTML de la fiche bureau ; la fiche mobile construit
// ses nœuds à partir de suiviMjGroups (js/mobile/views/fiche-principal.js).

export const SUIVI_MJ_TITLE = 'Suivi du MJ';
export const SUIVI_MJ_NOTE = 'Tenu par le MJ depuis son outil ; non modifiable ici.';
const SECTIONS = Object.freeze([
    ['penitence', 'Pénitences'],
    ['sequelle', 'Séquelles'],
    ['cicatrice', 'Cicatrices'],
    ['maladie', 'Maladies'],
    ['mutation', 'Mutations'],
]);

const text = value => (typeof value === 'string' ? value : '');

/** Groupes non vides, dans l'ordre fixe des catégories : [{ categorie, titre, entries: [{ id, libelle, detail, depuis }] }]. */
export function suiviMjGroups(data) {
    const rows = Array.isArray(data?.suiviMj) ? data.suiviMj : [];
    return SECTIONS.map(([categorie, titre]) => ({
        categorie,
        titre,
        entries: rows.filter(row => row && typeof row === 'object' && row.categorie === categorie && text(row.libelle))
            .map(row => ({ id: text(row.id), libelle: text(row.libelle), detail: text(row.detail), depuis: text(row.depuis) })),
    })).filter(group => group.entries.length);
}

/** Mention de date d'une entrée (« depuis 06/11 »), ou chaîne vide. */
export function suiviMjSince(entry) {
    return entry.depuis ? `depuis ${entry.depuis}` : '';
}

const escapeHtml = value => String(value).replace(/[&<>"']/gu, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Carte de la fiche bureau ; chaîne vide quand il n'y a rien à suivre (la section n'apparaît pas). */
export function renderSuiviMjHtml(data) {
    const groups = suiviMjGroups(data);
    if (!groups.length) return '';
    const entry = row => `<li><strong>${escapeHtml(row.libelle)}</strong>${row.depuis ? ` <small>${escapeHtml(suiviMjSince(row))}</small>` : ''}`
        + `${row.detail ? `<p>${escapeHtml(row.detail)}</p>` : ''}</li>`;
    return `<section class="bureau-card bureau-suivi-mj" aria-labelledby="suivi-mj-title"><h2 id="suivi-mj-title">${SUIVI_MJ_TITLE}</h2>`
        + `<p class="bureau-muted">${escapeHtml(SUIVI_MJ_NOTE)}</p>`
        + groups.map(group => `<h3>${escapeHtml(group.titre)}</h3><ul class="bureau-suivi-mj-list">${group.entries.map(entry).join('')}</ul>`).join('')
        + '</section>';
}

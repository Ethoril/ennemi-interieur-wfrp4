import { xpBalance } from '../../fiche/derived.js';
import { xpLogRows } from '../fiche-model.js';

const SAVE_DELAY_MS = 800;
const PATH = 'possessions';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

const signed = amount => (amount > 0 ? `+${amount}` : amount < 0 ? `−${-amount}` : '0');

/**
 * Onglet Journal : bascule Expérience / Possessions et notes.
 * `getContext()` → { state (contrôleur), engine, online, controller } ; onCancel(purchaseId, bouton) ouvre la confirmation.
 * Les possessions sont mises en brouillon à chaque frappe (stagePatch : protégé hors ligne), envoyées après une pause ou à la perte du focus.
 * La zone de texte n'est jamais réécrite pendant la saisie.
 */
export function createJournalPanel({ documentRef, getContext, onCancel = () => {}, saveDelay = SAVE_DELAY_MS }) {
    const root = make(documentRef, 'div', '', 'm-journal');
    let part = 'xp';
    let timer = null;
    let saving = false;
    let again = false;
    let failure = '';
    let shownRows = '';

    const switcher = make(documentRef, 'div', '', 'm-apt-switch');
    switcher.setAttribute('role', 'group');
    switcher.setAttribute('aria-label', 'Partie du journal');
    const switchButtons = [['xp', 'Expérience'], ['notes', 'Possessions et notes']].map(([key, label]) => {
        const button = make(documentRef, 'button', label, 'm-apt-switch-button');
        button.type = 'button';
        button.addEventListener('click', () => { part = key; render(); });
        switcher.append(button);
        return [key, button];
    });

    const xpPane = make(documentRef, 'div', '', 'm-journal-pane');
    const figures = make(documentRef, 'dl', '', 'm-purchase-figures');
    const figure = (label, className = '') => {
        const cell = make(documentRef, 'div');
        const dd = make(documentRef, 'dd', '', className);
        cell.append(make(documentRef, 'dt', label), dd);
        figures.append(cell);
        return dd;
    };
    const gained = figure('Gagnée');
    const spent = figure('Dépensée');
    const free = figure('Libre', 'm-purchase-cost');
    const heading = make(documentRef, 'h3', 'Historique', 'm-apt-title');
    const list = make(documentRef, 'ol', '', 'm-apt-list m-journal-list');
    const empty = make(documentRef, 'p', 'Aucune entrée enregistrée.', 'm-fiche-soon');
    xpPane.append(figures, heading, list, empty);

    const notesPane = make(documentRef, 'div', '', 'm-journal-pane m-form-field');
    const label = make(documentRef, 'label', 'Possessions et notes');
    label.htmlFor = 'm-journal-notes';
    const area = make(documentRef, 'textarea');
    area.id = 'm-journal-notes';
    area.rows = 10;
    area.maxLength = 20000;
    area.setAttribute('placeholder', 'Équipement, argent, objets notables…');
    const status = make(documentRef, 'p', '', 'm-form-status');
    status.setAttribute('role', 'status');
    const conflict = make(documentRef, 'div', '', 'm-journal-conflict');
    const keepMine = make(documentRef, 'button', 'Garder ma version', 'm-button');
    const takeServer = make(documentRef, 'button', 'Prendre celle du serveur', 'm-button');
    for (const button of [keepMine, takeServer]) button.type = 'button';
    conflict.append(keepMine, takeServer);
    notesPane.append(label, area, status, conflict);
    root.append(switcher, xpPane, notesPane);

    const render = () => {
        for (const [key, button] of switchButtons) button.setAttribute('aria-pressed', String(key === part));
        xpPane.hidden = part !== 'xp';
        notesPane.hidden = part !== 'notes';
    };

    const staged = () => !!getContext().controller?.getDraftPaths().includes(PATH);

    function refreshNotes() {
        const { state, online } = getContext();
        const data = state?.data;
        if (!data) return;
        // Ne jamais écraser ce que la personne est en train de taper.
        const value = String(data[PATH] ?? '');
        if (documentRef.activeElement !== area && area.value !== value) area.value = value;
        area.readOnly = state.phase === 'legacy-readonly';
        const inConflict = (state.conflicts || []).some(item => item.path === PATH);
        conflict.hidden = !inConflict;
        status.textContent = inConflict ? 'Conflit : cette note a aussi changé sur le serveur.'
            : failure || (staged() ? (online ? 'Enregistrement…' : 'Modification en attente de connexion') : 'Enregistré');
    }

    async function save() {
        clearTimeout(timer);
        timer = null;
        if (saving) { again = true; return; }
        saving = true;
        try {
            do {
                again = false;
                const { controller, online } = getContext();
                if (!controller?.getState().hasDraft || !online) break;
                // Un envoi déjà parti (réponse incertaine) est rejoué à l'identique, pas recréé.
                let result = await controller.submitPatch();
                if (result?.status === 'retry-required') result = await controller.retryPendingPatch();
                failure = result?.status === 'blocked' && result.reason !== 'offline' && result.reason !== 'conflict'
                    ? 'Enregistrement en attente.' : '';
            } while (again);
        } catch {
            failure = 'Enregistrement impossible pour le moment. Nouvel essai à la prochaine modification.';
        } finally {
            saving = false;
            refreshNotes();
        }
    }

    area.addEventListener('input', () => {
        const { controller } = getContext();
        if (!controller) return;
        failure = '';
        if (controller.stagePatch({ [PATH]: area.value }).ok) {
            clearTimeout(timer);
            timer = setTimeout(() => { void save(); }, saveDelay);
        } else failure = 'Modification impossible sur cette fiche.';
        refreshNotes();
    });
    area.addEventListener('blur', () => { void save(); });
    keepMine.addEventListener('click', () => {
        if (getContext().controller?.resolveConflict(PATH, 'local')) void save();
        refreshNotes();
    });
    takeServer.addEventListener('click', () => {
        getContext().controller?.resolveConflict(PATH, 'server');
        refreshNotes();
    });

    function refreshXp() {
        const { state, engine } = getContext();
        const balance = xpBalance(state.data);
        gained.textContent = String(balance.gagne);
        spent.textContent = String(balance.depense);
        free.textContent = String(balance.libre);
        const rows = xpLogRows(state.data, engine, state.uid);
        empty.hidden = rows.length > 0;
        list.hidden = !rows.length;
        // L'historique n'est reconstruit que s'il change : le bouton focalisé garde son focus.
        const key = JSON.stringify(rows);
        if (key === shownRows) return;
        shownRows = key;
        list.replaceChildren(...rows.map(row => {
            const item = make(documentRef, 'li', '', `m-journal-row${row.cancelled ? ' m-journal-cancelled' : ''}`);
            const text = make(documentRef, 'span', '', 'm-journal-text');
            const name = make(documentRef, 'span', row.cancelled ? `${row.label} (annulé)` : row.label, 'm-journal-label');
            text.append(name, make(documentRef, 'span', row.nature, 'm-journal-nature'));
            const amount = make(documentRef, 'span', signed(row.amount), `m-journal-amount${row.amount > 0 ? ' m-journal-gain' : ''}`);
            item.append(text, amount);
            if (row.purchaseId) {
                const cancel = make(documentRef, 'button', 'Annuler cet achat', 'm-journal-cancel');
                cancel.type = 'button';
                cancel.setAttribute('aria-label', `Annuler l’achat ${row.label}`);
                cancel.addEventListener('click', () => onCancel(row.purchaseId, cancel));
                item.append(cancel);
            }
            return item;
        }));
    }

    render();
    return Object.freeze({
        element: root,
        update() {
            if (!getContext().state?.data) return;
            refreshXp();
            refreshNotes();
        },
        // Envoie tout de suite ce qui est en brouillon (retour du réseau, démontage).
        save,
        destroy() { clearTimeout(timer); timer = null; },
    });
}

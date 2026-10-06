import { submitDraft } from '../fiche-autosave.js';

const LABELS = {
    destin: 'Destin', resilience: 'Résilience', chance: 'Chance', determination: 'Détermination',
    nom: 'Nom', race: 'Race', blessuresAct: 'Blessures actuelles', corruption: 'Corruption',
};
// Les possessions ont leur propre résolution dans l'onglet Journal.
const OWN_UI = 'possessions';

function make(documentRef, tag, text = '', className = '') {
    const node = documentRef.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
}

/**
 * Conflits de modification (valeur changée sur le serveur pendant qu'un brouillon local attendait), tous champs simples sauf
 * les possessions. Un conflit bloque tout envoi : chaque ligne propose « Garder la mienne » (renvoyée) ou « Prendre celle du serveur ».
 * `getContext()` → { state, controller } ; `announce(message)`. update() ne reconstruit que si les conflits changent (focus conservé).
 */
export function createConflictNotice({ documentRef, getContext, announce = () => {} }) {
    const root = make(documentRef, 'div', '', 'm-fiche-conflicts');
    root.hidden = true;
    let shown = '';

    const resolve = async (path, choice) => {
        const { controller } = getContext();
        if (!controller?.resolveConflict(path, choice)) return;
        announce(choice === 'local' ? 'Votre valeur est conservée' : 'Valeur du serveur reprise');
        if (choice === 'local') {
            try { await submitDraft(controller); } catch { announce('Enregistrement en attente'); }
        }
    };

    return Object.freeze({
        element: root,
        update() {
            const conflicts = (getContext().state?.conflicts || []).filter(item => item.path !== OWN_UI);
            const key = JSON.stringify(conflicts);
            if (key === shown) return;
            shown = key;
            root.hidden = !conflicts.length;
            root.replaceChildren(...conflicts.map(({ path, server, local }) => {
                const label = LABELS[path] || path;
                const item = make(documentRef, 'div', '', 'm-fiche-conflict');
                item.setAttribute('role', 'group');
                item.setAttribute('aria-label', `Conflit : ${label}`);
                const text = make(documentRef, 'p', `Conflit sur ${label} : le serveur a ${String(server ?? '')}, vous avez ${String(local ?? '')}.`);
                const mine = make(documentRef, 'button', 'Garder la mienne', 'm-button');
                const theirs = make(documentRef, 'button', 'Prendre celle du serveur', 'm-button');
                mine.type = 'button';
                theirs.type = 'button';
                mine.addEventListener('click', () => { void resolve(path, 'local'); });
                theirs.addEventListener('click', () => { void resolve(path, 'server'); });
                item.append(text, mine, theirs);
                return item;
            }));
        },
    });
}

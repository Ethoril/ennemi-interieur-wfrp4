import { submitDraft } from '../fiche-autosave.js';
import { skillPinId, skillRows } from '../fiche-model.js';

const LABELS = {
    destin: 'Destin', resilience: 'Résilience', chance: 'Chance', determination: 'Détermination',
    nom: 'Nom', race: 'Race', blessuresAct: 'Blessures actuelles', corruption: 'Corruption',
};
const FAVORITE_PATH = /^favoriteSkills\.([1-5])$/u;
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
 * `getContext()` → { state, controller, engine } ; `announce(message)`. update() ne reconstruit que si les conflits changent (focus conservé).
 */
export function createConflictNotice({ documentRef, getContext, announce = () => {} }) {
    const root = make(documentRef, 'div', '', 'm-fiche-conflicts');
    root.hidden = true;
    let shown = '';

    // Une compétence épinglée est stockée sous forme d'identifiant : on montre son nom.
    const valueLabel = (path, value) => {
        if (!FAVORITE_PATH.test(path)) return String(value ?? '');
        const { state, engine } = getContext();
        return skillRows(state?.data, engine).find(row => value && skillPinId(row) === value)?.nom || (value ? 'une compétence inconnue' : 'aucune');
    };

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
                const favorite = path.match(FAVORITE_PATH);
                const label = favorite ? `Compétence affichée ${favorite[1]}` : LABELS[path] || path;
                const item = make(documentRef, 'div', '', 'm-fiche-conflict');
                item.setAttribute('role', 'group');
                item.setAttribute('aria-label', `Conflit : ${label}`);
                const text = make(documentRef, 'p', `Conflit sur ${label} : le serveur a ${valueLabel(path, server)}, vous avez ${valueLabel(path, local)}.`);
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

import { activeCareerRank, findCareerByName, getEffectiveTalents, getVariantsToConsider } from '../fiche/career-model.js';
import { isOpenCareerSlot } from '../fiche/skill-names.js';
import { talentXpCost } from '../fiche/xp.js';
import { stripAccents } from '../utils.js';

const fold = text => stripAccents(String(text ?? '')).toLowerCase();

/** Recherche (chaque mot, sans accents ni casse) et filtres combinables sur les lignes de skillRows. */
export function filterSkills(rows, { query = '', career = false, trained = false, carac = '' } = {}) {
    const words = fold(query).split(/\s+/u).filter(Boolean);
    return rows.filter(row => (!career || row.inCareer) && (!trained || row.adv > 0) && (!carac || row.caracKey === carac)
        && words.every(word => fold(row.nom).includes(word)));
}

/** Entraînées d'abord, puis les autres ; alphabétique dans chaque groupe. */
export function sortSkills(rows) {
    const byName = (a, b) => a.nom.localeCompare(b.nom, 'fr');
    return [...rows.filter(row => row.adv > 0).sort(byName), ...rows.filter(row => row.adv === 0).sort(byName)];
}

// Emplacement ouvert (« (au choix) », « (Goût ou Toucher) ») : le serveur stockerait le libellé tel quel, l'achat reste au bureau.
const isOpenTalentSlot = nom => isOpenCareerSlot(nom) || /\([^)]*\sou\s[^)]*\)/iu.test(nom);
const talentGroup = nom => fold(nom.split('(')[0]).trim();

// Un modèle de spécialisation (« Maîtrise (Épées) ») partage l'entrée publiée de son talent : on le distingue par son libellé.
function talentKey(engine, nom) {
    const match = engine?.resolveTalent?.(nom);
    return match?.status === 'resolved' && !match.template ? match.entry.id : `n:${fold(nom).trim()}`;
}

/** Nombre de prises d'un talent déjà acquis. */
export function talentTaken(data, engine, nom) {
    const key = talentKey(engine, nom);
    return (data?.talentsAcq || []).filter(row => talentKey(engine, row?.nom ?? '') === key).length;
}

/**
 * Talents acquis (nom affiché, nombre de prises) puis ceux de la carrière courante pas encore acquis (coût de carrière).
 * Ligne : { nom (nom à envoyer au serveur), label, count, acquired, cost?, open }. Un emplacement ouvert (`open`) reste
 * listé mais n'est pas achetable ; il disparaît quand son groupe a déjà un talent acquis (Savoir-vivre (Guilde) → Savoir-vivre (au choix)).
 */
export function talentRows(data, engine, careers = []) {
    const acquired = new Map();
    for (const row of data?.talentsAcq || []) {
        const nom = row?.nom ?? '';
        const key = talentKey(engine, nom);
        const known = acquired.get(key);
        if (known) known.count += 1;
        else acquired.set(key, { nom, label: engine?.resolveTalent?.(nom)?.displayedName || nom, count: 1, acquired: true, open: false });
    }
    const acquiredGroups = new Set([...acquired.values()].map(row => talentGroup(row.nom)));
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    const available = new Map();
    if (career) {
        const rank = activeCareerRank(career, data?.rang);
        for (let current = 1; current <= rank; current += 1) {
            for (const variant of getVariantsToConsider(career, current, data?.chosenVariants || {})) {
                for (const nom of getEffectiveTalents(career, current, variant, data?.careerOverrides || {})) {
                    const key = talentKey(engine, nom);
                    const open = isOpenTalentSlot(nom);
                    if (!acquired.has(key) && !available.has(key) && !(open && acquiredGroups.has(talentGroup(nom)))) {
                        available.set(key, { nom, label: engine?.resolveTalent?.(nom)?.displayedName || nom, count: 0, acquired: false, cost: talentXpCost(true), open });
                    }
                }
            }
        }
    }
    return [...acquired.values(), ...available.values()];
}

/** Sorts puis miracles et prières possédés ; la ligne porte de quoi les consulter (aucun achat sur mobile). */
export function spellRows(data) {
    const text = value => (value === undefined || value === null ? '' : String(value));
    const spells = (data?.sorts || []).map(row => ({
        key: `s:${row?.id ?? row?.nom}`, nom: text(row?.nom), prayer: false, type: text(row?.vent), ni: text(row?.cn),
        details: [['NI', row?.cn], ['Portée', row?.portee], ['Durée', row?.duree]]
            .filter(([, value]) => text(value)).map(([label, value]) => [label, text(value)]),
        resume: text(row?.resume),
    }));
    const prayers = (data?.prieres || []).map(row => ({
        key: `p:${row?.id ?? row?.nom}`, nom: text(row?.nom), prayer: true, type: text(row?.type) || 'Prière', ni: '',
        details: [], resume: text(row?.resume),
    }));
    return { spells, prayers };
}

export const hasSpells = data => (data?.sorts?.length || 0) + (data?.prieres?.length || 0) > 0;

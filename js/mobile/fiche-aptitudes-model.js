import { activeCareerRank, findCareerByName, getEffectiveTalents, getVariantsToConsider } from '../fiche/career-model.js';
import { expandChoiceSkill, isOpenCareerSlot } from '../fiche/skill-names.js';
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

// Emplacement à spécialité (« (au choix) », « (Goût ou Toucher) ») : le serveur stockerait le libellé tel quel, il faut composer `Base (Choix)`.
const isOpenTalentSlot = nom => isOpenCareerSlot(nom) || /\([^)]*\sou\s[^)]*\)/iu.test(nom);
const specOf = nom => nom.match(/\(([^)]+)\)$/u)?.[1].trim();

/**
 * Choix d'un emplacement à spécialité, ou null si `nom` n'en est pas un. { base, free, specs } :
 * - « au choix » (`free`) : spécialités fermées connues de toutes les carrières (comme le bureau) + data.customTalents[base], saisie libre permise ;
 * - « A ou B » : exactement les alternatives listées.
 */
export function talentChoices(careers, data, nom) {
    if (!isOpenTalentSlot(nom)) return null;
    const base = nom.split('(')[0].trim();
    if (!isOpenCareerSlot(nom)) return { base, free: false, specs: expandChoiceSkill(nom, name => name).map(specOf) };
    // Une graphie par spécialité (sans casse ni accents) : la plus fréquente, à égalité celle qui commence par une majuscule.
    const spellings = new Map();
    for (const career of careers || []) {
        for (const rank of career.rangs || []) {
            for (const talent of rank.talents || []) {
                if (isOpenTalentSlot(talent) || fold(talent.split('(')[0]).trim() !== fold(base) || !specOf(talent)) continue;
                const counts = spellings.get(fold(specOf(talent))) || new Map();
                counts.set(specOf(talent), (counts.get(specOf(talent)) || 0) + 1);
                spellings.set(fold(specOf(talent)), counts);
            }
        }
    }
    const capital = spec => spec !== spec.toLowerCase() && spec[0] === spec[0].toUpperCase();
    const known = [...spellings.values()].map(counts => [...counts].sort(([a, x], [b, y]) => y - x || capital(b) - capital(a))[0][0])
        .sort((a, b) => a.localeCompare(b, 'fr'));
    const extra = (data?.customTalents?.[base] || []).filter(spec => !spellings.has(fold(spec)));
    return { base, free: true, specs: [...new Set([...known, ...extra])] };
}

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
 * Ligne : { nom (talent ou emplacement), label, count, acquired, cost?, open }. Un emplacement à spécialité (`open`) reste
 * listé même quand son groupe a déjà une prise : le serveur accepte plusieurs prises, le volet fait choisir la spécialité.
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
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    const available = new Map();
    if (career) {
        const rank = activeCareerRank(career, data?.rang);
        for (let current = 1; current <= rank; current += 1) {
            for (const variant of getVariantsToConsider(career, current, data?.chosenVariants || {})) {
                for (const nom of getEffectiveTalents(career, current, variant, data?.careerOverrides || {})) {
                    const key = talentKey(engine, nom);
                    if (!acquired.has(key) && !available.has(key)) {
                        available.set(key, {
                            nom, label: engine?.resolveTalent?.(nom)?.displayedName || nom, count: 0, acquired: false, cost: talentXpCost(true),
                            open: isOpenTalentSlot(nom),
                        });
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

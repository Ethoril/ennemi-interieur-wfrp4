import { primarySkillLabel } from '../catalogue/skill-forms.js';
import { basicSkillNom, BASIC_SKILLS } from '../fiche/basic-skills.js';
import { activeCareerRank, findCareerByName, getActiveVariantForRang, getCareerCaracs, getRangVariants } from '../fiche/career-model.js';
import { caracBonus, caracTotal } from '../fiche/derived.js';

/** Bandeau d'identité : nom, carrière, titre et statut du rang courant (variante choisie, sinon la première). */
export function ficheIdentity(data, careers = []) {
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    const rang = career ? activeCareerRank(career, data?.rang) : Math.max(1, +data?.rang || 1);
    const variant = career
        ? getActiveVariantForRang(career, rang, data?.chosenVariants) || getRangVariants(career, rang)[0] || null
        : null;
    return {
        nom: String(data?.nom ?? '').trim(),
        carriere: career?.nom || String(data?.carriere ?? '').trim(),
        titreRang: variant?.titre || '',
        rang,
        statut: variant?.statut || '',
    };
}

export const CARACS = Object.freeze([
    { key: 'cc', abbr: 'CC', nom: 'Capacité de Combat' }, { key: 'ct', abbr: 'CT', nom: 'Capacité de Tir' },
    { key: 'f', abbr: 'F', nom: 'Force' }, { key: 'e', abbr: 'E', nom: 'Endurance' },
    { key: 'i', abbr: 'I', nom: 'Initiative' }, { key: 'ag', abbr: 'Ag', nom: 'Agilité' },
    { key: 'dex', abbr: 'Dex', nom: 'Dextérité' }, { key: 'int', abbr: 'Int', nom: 'Intelligence' },
    { key: 'fm', abbr: 'FM', nom: 'Force Mentale' }, { key: 'soc', abbr: 'Soc', nom: 'Sociabilité' },
]);

// Les ressources sont des chaînes numériques : absent ou non numérique vaut 0.
const count = value => Math.max(0, Math.floor(+value) || 0);

/** Jetons d'une ressource : `max` emplacements dont `current` (borné à `max`) sont pleins. */
export function resourceTokens(data, maxKey, currentKey) {
    const max = count(data?.[maxKey]);
    return { max, current: Math.min(max, count(data?.[currentKey])) };
}

/** Les dix caractéristiques dans l'ordre de la fiche, avec le marqueur « de carrière ». */
export function ficheCaracs(data, careers = []) {
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    const inCareer = career
        ? getCareerCaracs(career, activeCareerRank(career, data?.rang), data?.chosenVariants, data?.careerOverrides)
        : new Set();
    return CARACS.map(carac => ({
        ...carac, total: caracTotal(data, carac.key), bonus: caracBonus(data, carac.key), career: inCareer.has(carac.key),
    }));
}

/**
 * Les n compétences les plus hautes (de base puis avancées), total = caractéristique + avances.
 * Chaque ligne porte aussi son adressage pour l'achat : `row` (clé BASIC_SKILLS) pour une compétence de base,
 * `targetId` pour une avancée, et `serverName` (nom stocké côté serveur).
 * Tri par total décroissant puis nom ; les compétences sans avance ne comblent que les places libres.
 */
export function topSkills(data, engine, n) {
    const resolver = engine?.skillResolver;
    const caracAbbr = Object.fromEntries(CARACS.map(({ key, abbr }) => [key, abbr]));
    const rows = [];
    const shown = new Set();
    for (const { nom, carac } of BASIC_SKILLS) {
        const entry = resolver?.resolve(nom)?.entry;
        // Même filtre que le bureau : une seule ligne par entrée, et seulement les compétences de base.
        if (entry && (!entry.basic || shown.has(entry.id))) continue;
        if (entry) shown.add(entry.id);
        const spec = data?.basicSpecs?.[nom];
        const stored = spec ? `${nom.replace(/ \(Base\)$/u, '')} (${spec})` : nom;
        rows.push({
            nom: primarySkillLabel(resolver, stored), carac, adv: count(data?.skillsBasic?.[nom]),
            row: nom, serverName: basicSkillNom(nom, data?.basicSpecs),
        });
    }
    for (const skill of data?.skillsAdvanced || []) {
        rows.push({
            nom: primarySkillLabel(resolver, skill?.nom ?? ''), carac: skill?.carac, adv: count(skill?.adv),
            serverName: skill?.nom ?? '', targetId: skill?.id,
        });
    }
    const byTotal = (a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr');
    const scored = rows.map(row => ({
        ...row, carac: caracAbbr[row.carac] || '', total: caracTotal(data, row.carac) + row.adv,
    }));
    const trained = scored.filter(row => row.adv > 0).sort(byTotal);
    const untrained = scored.filter(row => row.adv === 0).sort(byTotal);
    return [...trained, ...untrained].slice(0, n).map(({ adv, ...row }) => row);
}

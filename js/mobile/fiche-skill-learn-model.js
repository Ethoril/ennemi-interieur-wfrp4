import { publishedSkillRows } from '../catalogue/skill-forms.js';
import { stripAccents } from '../utils.js';
import { groupSpecialty, purchasePreview, purchaseTarget } from './fiche-purchase.js';

const fold = text => stripAccents(String(text ?? '')).toLowerCase();

/**
 * Compétences avancées publiées qu'un personnage peut apprendre, triées par nom ; recherche (chaque mot, sans accents ni casse).
 * Entrées principales seulement (les formes reliées sont masquées), sans les compétences de base ni celles déjà possédées
 * (même entrée publiée). Un groupe à spécialités (Langue, Savoir…) donne une ligne « Groupe (au choix) » qui retrouve aussi ses
 * spécialités à la recherche. Ligne : { key, nom, group, specialty?, cost?, inCareer }. `cost` (première avance, comme l'achat)
 * n'existe que pour une compétence unique ; l'achat d'une spécialité se tarife après son choix.
 */
export function learnSkillRows(data, engine, careers, query = '') {
    const resolver = engine?.skillResolver;
    const words = fold(query).split(/\s+/u).filter(Boolean);
    const owned = new Set((data?.skillsAdvanced || []).map(skill => resolver?.resolve(skill.nom).entry?.id));
    const entries = publishedSkillRows(resolver).filter(entry => !entry.basic);
    const target = nom => purchaseTarget(data, engine, careers, { kind: 'skill', newName: nom });
    const rows = [];
    for (const entry of entries.filter(item => !item.spec && !owned.has(item.id))) {
        if (!words.every(word => fold(entry.nom).includes(word))) continue;
        const found = target(entry.nom);
        if (found) rows.push({ key: entry.id, nom: entry.nom, group: entry.group, cost: purchasePreview(found, 1, 0).cost, inCareer: found.inCareer });
    }
    for (const group of new Set(entries.filter(item => item.spec).map(item => item.group))) {
        const specs = entries.filter(item => item.spec && item.group === group);
        if (!words.every(word => fold(`${group} (au choix) ${specs.map(item => item.spec).join(' ')}`).includes(word))) continue;
        rows.push({
            key: `g:${group}`, nom: `${group} (au choix)`, group, specialty: groupSpecialty(resolver, group),
            inCareer: specs.some(item => target(item.nom)?.inCareer),
        });
    }
    return rows.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

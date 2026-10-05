import { activeCareerRank, findCareerByName, getActiveVariantForRang, getRangVariants } from '../fiche/career-model.js';

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

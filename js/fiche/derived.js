import { stripAccents } from '../utils.js';
import { especeDe } from '../data/donnees-communes.js';

// Valeurs dérivées de la fiche (bureau et mobile). Mouvement et Blessures par espèce : js/data/donnees-communes.js,
// copie générée depuis l'outil MJ (source unique, ne pas modifier ici). Client seulement : volontairement absent de tools/sync-fiche-domain.mjs.

/** Espèce absente ou présente dans le registre commun ; une autre valeur doit être signalée (Mouvement et Blessures inconnus). */
export function especeConnue(data) {
    return !data?.race || especeDe(data.race) !== null;
}

export function caracTotal(data, key) {
    return (data?.carac?.[key]?.base ?? 0) + (data?.carac?.[key]?.adv ?? 0);
}

export function caracBonus(data, key) {
    return Math.floor(caracTotal(data, key) / 10);
}

// Chaque acquisition de « Dur à cuire » ajoute le Bonus d'Endurance.
function countTalent(data, nom) {
    const cible = stripAccents(nom).toLowerCase();
    return (data?.talentsAcq || []).filter(t => stripAccents(t.nom || '').trim().toLowerCase() === cible).length;
}

// Espèces de taille Petite (Gnome, Skink) : pas de Bonus de Force. Ogre (Grande) : total doublé.
// Halfelin (L06 p. 341) : inclut BF en V4/V5. Espèce inconnue : null, à signaler. Valeurs : registre commun.
export function blessuresMax(data) {
    if (!especeConnue(data)) return null;
    const espece = especeDe(data?.race || 'humain');
    const bf = espece.sansBonusForce ? 0 : caracBonus(data, 'f');
    const be = caracBonus(data, 'e');
    const base = bf + 2 * be + caracBonus(data, 'fm') + countTalent(data, 'Dur à cuire') * be;
    return base * espece.multiplicateurBlessures;
}

export function mouvement(data) {
    if (!data?.race) return especeDe('humain').mouvement;
    return especeDe(data.race)?.mouvement ?? null;
}

// Gagné = somme des gains, dépensé = somme des autres lignes (même règle que recalc()).
export function xpBalance(data) {
    const log = data?.xpLog || [];
    const gagne = log.filter(e => e.kind === 'gain').reduce((s, e) => s + (+e.montant || 0), 0);
    const depense = log.filter(e => e.kind !== 'gain').reduce((s, e) => s + (+e.cout || 0), 0);
    return { gagne, depense, libre: gagne - depense };
}

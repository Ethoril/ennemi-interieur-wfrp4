import { stripAccents } from '../utils.js';

// Valeurs dérivées de la fiche, extraites de js/fiche.js (couplé au DOM) pour le mobile.
// Client seulement : volontairement absent de tools/sync-fiche-domain.mjs.
// Toute évolution de ces règles dans fiche.js doit être reportée ici (le test les compare).

export const MOUVEMENT = Object.freeze({
    humain: 4, 'elfe-sylvain': 5, 'haut-elfe': 5, halfelin: 4, ogre: 6,
    elfe: 5, halfling: 4, nain: 3, // rétrocompat anciennes sauvegardes
});

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

// Les Halfelins n'ajoutent pas leur Bonus de Force.
export function blessuresMax(data) {
    const race = data?.race || 'humain';
    const bf = ['halfelin', 'halfling'].includes(race) ? 0 : caracBonus(data, 'f');
    const be = caracBonus(data, 'e');
    return bf + 2 * be + caracBonus(data, 'fm') + countTalent(data, 'Dur à cuire') * be;
}

export function mouvement(data) {
    return MOUVEMENT[data?.race || 'humain'] ?? 4;
}

// Gagné = somme des gains, dépensé = somme des autres lignes (même règle que recalc()).
export function xpBalance(data) {
    const log = data?.xpLog || [];
    const gagne = log.filter(e => e.kind === 'gain').reduce((s, e) => s + (+e.montant || 0), 0);
    const depense = log.filter(e => e.kind !== 'gain').reduce((s, e) => s + (+e.cout || 0), 0);
    return { gagne, depense, libre: gagne - depense };
}

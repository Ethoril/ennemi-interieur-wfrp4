// Barèmes d'avances de la fiche (tranches de cinq avances).
export const CARAC_XP_BANDS = [25, 30, 40, 50, 70, 90, 120, 150, 190, 230, 280, 330, 390, 450];
export const SKILL_XP_BANDS = [10, 15, 20, 30, 40, 60, 80, 110, 140, 180, 220, 270, 320, 380];

export function xpBandCost(bands, currentAdv, count, inCareer) {
    let total = 0;
    for (let i = 0; i < count; i++) {
        const band = Math.min(Math.floor((currentAdv + i) / 5), bands.length - 1);
        total += inCareer ? bands[band] : bands[band] * 2;
    }
    return total;
}

export function tieredXpCost(step, known) {
    return step * Math.min(5, Math.max(1, Math.ceil(known / 5)));
}

export function talentXpCost(inCareer) {
    return inCareer ? 100 : 200;
}

export function careerRankXpCost(currentRankDone) {
    return currentRankDone ? 100 : 200;
}

// Les variantes mineures partagent un palier; les autres suivent leur domaine.
export function isPettySpell(spell) {
    return /mineur|petite magie/i.test(spell.type);
}

export function spellCategory(spell) {
    return isPettySpell(spell) ? 'mineur' : spell.type;
}

export function spellXpCost(spell, knownSpells) {
    const category = spellCategory(spell);
    const known = knownSpells.filter(knownSpell => spellCategory(knownSpell) === category).length;
    return tieredXpCost(isPettySpell(spell) ? 50 : 100, known);
}

// Les bénédictions n'augmentent pas le nombre de miracles déjà connus.
export function miracleXpCost(knownPrayers) {
    const known = knownPrayers.filter(prayer => prayer.type === 'Miracle' && prayer.nom?.trim()).length;
    return tieredXpCost(100, known);
}

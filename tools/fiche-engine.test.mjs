import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const careers = JSON.parse(readFileSync(fileURLToPath(new URL('../js/data/careers.json', import.meta.url)), 'utf8'));

import {
    activeCareerRank,
    findCareerByName,
    getActiveVariantForRang,
    getEffectiveCaracs,
    getEffectiveSkills,
    getEffectiveTalents,
    getCareerCaracs,
    getCareerSkillSets,
    getCareerTalentSets,
    isCaracInCareer,
    isSkillInCareer,
    isTalentInCareer,
    getRangVariants,
    getVariantsToConsider,
    maxCareerRank,
} from '../js/fiche/career-model.js';
import {
    canonicalSkillNom,
    expandChoiceSkill,
    isOpenCareerSlot,
    sameSkill,
    skillBaseNom,
} from '../js/fiche/skill-names.js';
import {
    CARAC_XP_BANDS,
    SKILL_XP_BANDS,
    careerRankXpCost,
    miracleXpCost,
    spellCategory,
    spellXpCost,
    talentXpCost,
    tieredXpCost,
    xpBandCost,
} from '../js/fiche/xp.js';

test('les coûts d’avances respectent les tranches, le hors-carrière et le plafond', () => {
    assert.equal(xpBandCost(CARAC_XP_BANDS, 4, 3, true), 25 + 30 + 30);
    assert.equal(xpBandCost(SKILL_XP_BANDS, 5, 2, false), 30 + 30);
    assert.equal(xpBandCost(SKILL_XP_BANDS, 70, 2, true), 380 * 2);
    assert.equal(tieredXpCost(100, 0), 100);
    assert.equal(tieredXpCost(100, 6), 200);
    assert.equal(tieredXpCost(100, 50), 500);
    assert.equal(talentXpCost(true), 100);
    assert.equal(talentXpCost(false), 200);
    assert.equal(careerRankXpCost(true), 100);
    assert.equal(careerRankXpCost(false), 200);
});

test('les coûts de sorts regroupent les sorts mineurs et comptent les domaines séparément', () => {
    const known = [
        { nom: 'Flamme', type: 'Aqshy' },
        { nom: 'Étincelle', type: 'Mineur' },
        { nom: 'Lueur', type: 'Petite magie elfique' },
        { nom: 'Vent', type: 'Azyr' },
    ];
    assert.equal(spellCategory(known[1]), 'mineur');
    assert.equal(spellCategory(known[2]), 'mineur');
    assert.equal(spellXpCost({ type: 'Mineur' }, known), 50);
    assert.equal(spellXpCost({ type: 'Aqshy' }, known), 100);
    assert.equal(spellXpCost({ type: 'Ghur' }, known), 100);
    assert.equal(miracleXpCost([
        { type: 'Miracle', nom: 'Soin' },
        { type: 'Bénédiction', nom: 'Protection' },
        { type: 'Miracle', nom: '  ' },
    ]), 100);
    assert.equal(miracleXpCost(Array.from({ length: 6 }, (_, i) => ({ type: 'Miracle', nom: `Miracle ${i}` }))), 200);
});

test('les noms de compétence gardent les alias validés et les slots ouverts', () => {
    assert.equal(canonicalSkillNom(' Conn. théologie '), 'Savoir (Théologie)');
    assert.equal(canonicalSkillNom("Corps à corps (Arme d'hast)"), "Corps à corps (Armes d'hast)");
    assert.equal(canonicalSkillNom('Langage de bataille'), 'Langue (Bataille)');
    assert.equal(sameSkill('Dressage (Chevaux)', 'Dressage (Cheval)'), true);
    assert.deepEqual(expandChoiceSkill('Dressage (Cheval ou Pigeon)'), [
        'Dressage (Cheval)', 'Dressage (Pigeon)',
    ]);
    assert.deepEqual(expandChoiceSkill('Langue (au choix)'), ['Langue (au choix)']);
    assert.equal(isOpenCareerSlot('Savoir (Région)'), true);
    assert.equal(isOpenCareerSlot('Langue (Bataille)'), false);
    assert.equal(skillBaseNom('Savoir (Empire)'), 'savoir');
});

test('les correspondances de compétence conservent chaque alias validé du moteur historique', () => {
    const aliases = [
        ['Chevaucher (Cheval)', 'Chevaucher'],
        ['Langage de bataille', 'Langue (Bataille)'],
        ['Lecture sur les lèvres', 'Lire sur les lèvres'],
        ['Signe secrets Ranger', 'Signes secrets (Ranger)'],
        ['Représentation (Acteur)', 'Divertissement (Acteur)'],
        ['Métier (Calligraphe)', 'Art (Calligraphie)'],
        ['Métier (Cartographe)', 'Art (Cartographie)'],
        ['Métier (Graveur)', 'Art (Gravure)'],
        ['Savoir (Art de la guerre)', 'Savoir (Guerre)'],
        ['Savoir (Prophéties)', 'Savoir (Prophétie)'],
        ['Savoir (Locale)', 'Savoir (Local)'],
        ["Savoir (L'Empire)", 'Savoir (Empire)'],
        ['Savoir (Droit)', 'Savoir (Loi)'],
        ['Savoir (Démons)', 'Savoir (Démonologie)'],
        ['Savoir (Plantes)', 'Savoir (Herbes)'],
        ['Savoir (Généalogie)', 'Savoir (Noble)'],
        ["Corps à corps (Arme d'hast)", "Corps à corps (Armes d'hast)"],
        ['Corps à corps (Fléaux)', 'Corps à corps (Fléau)'],
        ['Corps à corps (Lourde)', 'Corps à corps (Deux mains)'],
        ['Projectiles (Lancer)', 'Projectiles (Jet)'],
        ['Projectiles (Armes de jet)', 'Projectiles (Jet)'],
        ['Projectiles (Armes à poudre)', 'Projectiles (Poudre noire)'],
        ['Projectiles (Arbalète de poing)', 'Projectiles (Arbalète)'],
        ['Discrétion (Souterraine)', 'Discrétion (Souterrains)'],
        ['Dressage (Chiens)', 'Dressage (Chien)'],
        ['Dressage (Chevaux)', 'Dressage (Cheval)'],
        ['Dressage (Pigeons)', 'Dressage (Pigeon)'],
        ['Dressage (Blaireaux)', 'Dressage (Blaireau)'],
        ['Signes secrets (Chasseurs)', 'Signes secrets (Chasseur)'],
        ['Signes secrets (Capes grises)', 'Signes secrets (Ordre Gris)'],
        ['Langue (Elthàrin)', 'Langue (Eltharin)'],
        ['Focalisation (Qhaysh / haute magie)', 'Focalisation (Qhaysh)'],
        ['Divertissement (Narration)', 'Divertissement (Contes)'],
        ['Divertissement (Humour)', 'Divertissement (Comédie)'],
        ['Divertissement (Clownerie)', 'Divertissement (Comédie)'],
        ['Divertissement (Rhétorique)', 'Divertissement (Discours)'],
        ['Divertissement (Conférence)', 'Divertissement (Discours)'],
        ['Divertissement (Provocation)', 'Divertissement (Raillerie)'],
        ['Métier (Imprimeur)', 'Métier (Imprimerie)'],
        ['Métier (Joaillier)', 'Métier (Orfèvre)'],
        ['Métier (Poisons)', 'Métier (Empoisonneur)'],
        ['Métier (Matériel artistique)', 'Métier (Artiste)'],
    ];
    for (const [raw, expected] of aliases) assert.equal(canonicalSkillNom(raw), expected, raw);
});

test('les 132 carrières du catalogue gardent la reconnaissance et l’appartenance cumulée', () => {
    assert.equal(careers.length, 132);
    for (const career of careers) {
        const careerNameMatch = careers.find(entry => entry.nom.toLowerCase() === career.nom.toLowerCase()
            || entry.rangs.some(rank => rank.titre.toLowerCase() === career.nom.toLowerCase()));
        assert.equal(findCareerByName(careers, career.nom), careerNameMatch, career.nom);
        for (const rankData of career.rangs) {
            const firstMatch = careers.find(entry => entry.nom.toLowerCase() === rankData.titre.toLowerCase()
                || entry.rangs.some(rank => rank.titre.toLowerCase() === rankData.titre.toLowerCase()));
            assert.equal(findCareerByName(careers, rankData.titre), firstMatch, `${career.nom}: ${rankData.titre}`);
        }
        const ranks = [...new Set(career.rangs.map(rank => rank.rang))].sort((a, b) => a - b);
        for (const rank of ranks) {
            const variants = career.rangs.filter(entry => entry.rang <= rank);
            const skillSets = getCareerSkillSets(career, rank);
            const talentSets = getCareerTalentSets(career, rank);
            const caracSet = getCareerCaracs(career, rank);
            for (const variant of variants) {
                for (const skill of variant.skills || []) {
                    for (const option of expandChoiceSkill(skill)) {
                        assert.equal(isSkillInCareer(career, rank, option), true, `${career.nom} R${rank}: ${skill} → ${option}`);
                    }
                }
                for (const talent of variant.talents || []) {
                    assert.equal(isTalentInCareer(career, rank, talent), true, `${career.nom} R${rank}: ${talent}`);
                }
                for (const carac of variant.caracs || []) {
                    assert.equal(isCaracInCareer(career, rank, carac), true, `${career.nom} R${rank}: ${carac}`);
                }
            }
            assert.ok(skillSets.exact instanceof Set);
            assert.ok(talentSets.exact instanceof Set);
            assert.ok(caracSet instanceof Set);
        }
    }
});

test('la reconnaissance et les variantes carrière conservent les choix et les rangs cinq', () => {
    const career = {
        id: 'mage-haut-elfe',
        nom: 'Mage haut-elfe',
        rangs: [
            { rang: 1, titre: 'Apprenti', skills: ['Langue (Elthàrin)'] },
            { rang: 2, titre: 'Adepte' },
            { rang: 3, titre: 'Mage', caracs: ['int'] },
            { rang: 4, titre: 'Archimage', caracs: ['fm'] },
            { rang: 5, titre: 'Maître mage', skills: ['Savoir (Magie)'] },
            { rang: 5, titre: 'Maître mage (autre voie)', skills: ['Focalisation (Qhaysh)'], talents: ['Magie mineure'] },
        ],
    };
    const careers = [career];
    assert.equal(findCareerByName(careers, '  MAGE HAUT-ELFE '), career);
    assert.equal(findCareerByName(careers, 'Adepte'), career);
    assert.equal(findCareerByName(careers, 'Inconnu'), null);
    assert.equal(maxCareerRank(career), 5);
    assert.equal(activeCareerRank(career, 99), 5);
    assert.equal(activeCareerRank(career, 0), 1);
    assert.equal(getRangVariants(career, 5).length, 2);
    assert.equal(getActiveVariantForRang(career, 5), null);
    assert.deepEqual(getVariantsToConsider(career, 5).map(variant => variant.titre), [
        'Maître mage', 'Maître mage (autre voie)',
    ]);
    const selected = { [career.id]: { 5: 'Maître mage (autre voie)' } };
    assert.equal(getActiveVariantForRang(career, 5, selected).titre, 'Maître mage (autre voie)');
    assert.deepEqual(getVariantsToConsider(career, 5, selected).map(variant => variant.titre), [
        'Maître mage (autre voie)',
    ]);
    const overrides = {
        [career.id]: {
            5: {
                caracs: ['int'],
                skillsRemoved: ['Langue (Elthàrin)', 'Focalisation (Qhaysh)'],
                skillsAdded: ['Projectiles (Poudre noire)'],
                talentsRemoved: ['Magie mineure'],
                talentsAdded: ['Vision nocturne'],
            },
        },
    };
    const variant = {
        caracs: ['fm'],
        skills: ['Langue (Elthàrin)', 'Savoir (Magie)'],
        talents: ['Magie mineure', 'Résistance à la magie'],
    };
    assert.deepEqual(getEffectiveCaracs(career, 5, variant, overrides), ['int']);
    assert.deepEqual(getEffectiveSkills(career, 5, variant, overrides), [
        'Savoir (Magie)', 'Projectiles (Poudre noire)',
    ]);
    assert.deepEqual(getEffectiveTalents(career, 5, variant, overrides), [
        'Résistance à la magie', 'Vision nocturne',
    ]);
    assert.deepEqual(getEffectiveSkills(career, 5, variant), variant.skills);
    assert.equal(isSkillInCareer(career, 5, 'Projectiles (Poudre noire)', selected, overrides), true);
    assert.equal(isSkillInCareer(career, 5, 'Focalisation (Qhaysh)', selected, overrides), false);
    assert.equal(isTalentInCareer(career, 5, 'Vision nocturne', selected, overrides), true);
    assert.equal(isTalentInCareer(career, 5, 'Magie mineure', selected, overrides), false);
    assert.equal(isCaracInCareer(career, 5, 'int', selected, overrides), true);
    assert.equal(isCaracInCareer(career, 5, 'cc', selected, overrides), false);
});

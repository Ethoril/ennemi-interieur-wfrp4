import { basicSkillNom, BASIC_SKILLS } from '../fiche/basic-skills.js';
import {
    activeCareerRank, findCareerByName, isCaracInCareer, isSkillInCareer, isTalentInCareer,
} from '../fiche/career-model.js';
import { caracTotal } from '../fiche/derived.js';
import { canonicalSkillNom } from '../fiche/skill-names.js';
import { CARAC_XP_BANDS, SKILL_XP_BANDS, talentXpCost, xpBandCost } from '../fiche/xp.js';
import { CARACS } from './fiche-model.js';

export const MAX_ADVANCES = 10;

/**
 * Description affichable d'une cible d'achat, ou null si la ligne n'existe plus.
 * `careers` : js/data/careers.json ; `spec` : { kind: 'carac', key } | { kind: 'skill', ...ligne de topSkills }
 * | { kind: 'talent', nom }. Le nom et `targetId` suivent ce que le serveur adresse (jamais le libellé affiché).
 * ponytail: le « de carrière » rejoue les règles de commands.js ; le test d'accord avec le moteur
 * (tools/fiche-mobile-purchase.test.mjs) échoue si elles divergent.
 */
export function purchaseTarget(data, engine, careers, spec) {
    const career = findCareerByName(careers || [], typeof data?.carriere === 'string' ? data.carriere : '');
    const rank = career ? activeCareerRank(career, data.rang) : 1;
    const chosen = data?.chosenVariants || {};
    const overrides = data?.careerOverrides || {};
    const resolver = engine?.skillResolver;
    const advances = (kind, fields) => ({ kind, maxCount: MAX_ADVANCES, ...fields, total: fields.baseValue + fields.adv });

    if (spec.kind === 'carac') {
        const carac = CARACS.find(({ key }) => key === spec.key);
        if (!carac || !data?.carac?.[carac.key]) return null;
        const inCareer = career ? isCaracInCareer(career, rank, carac.key, chosen, overrides) : false;
        return advances('carac', {
            title: carac.nom, nature: 'Caractéristique', name: carac.key, bands: CARAC_XP_BANDS, inCareer,
            baseLabel: carac.nom, baseValue: data.carac[carac.key].base ?? 0, adv: data.carac[carac.key].adv ?? 0,
        });
    }

    if (spec.kind === 'skill') {
        let row;
        if (spec.row) {
            const basic = BASIC_SKILLS.find(({ nom }) => nom === spec.row);
            if (!basic) return null;
            const name = basicSkillNom(spec.row, data?.basicSpecs || {});
            row = {
                nature: 'Compétence de base', name, carac: basic.carac, adv: data?.skillsBasic?.[spec.row] ?? 0,
                // Une clé absente de skillsBasic fait chercher une ligne avancée côté serveur : on l'omet alors.
                targetId: Object.hasOwn(data?.skillsBasic || {}, spec.row) ? spec.row : undefined,
                canonical: name,
            };
        } else {
            const skill = (data?.skillsAdvanced || []).find(({ id }) => id === spec.targetId);
            if (!skill) return null;
            const resolved = resolver?.resolve(skill.nom);
            row = {
                nature: 'Compétence avancée', name: skill.nom, carac: skill.carac, adv: skill.adv ?? 0, targetId: skill.id,
                canonical: resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(skill.nom),
            };
        }
        const carac = CARACS.find(({ key }) => key === row.carac);
        if (!carac) return null;
        const inCareer = career ? isSkillInCareer(career, rank, row.canonical, chosen, overrides, resolver) : false;
        return advances('skill', {
            title: spec.nom || row.name, nature: row.nature, name: row.name, targetId: row.targetId, bands: SKILL_XP_BANDS,
            inCareer, baseLabel: carac.nom, baseValue: caracTotal(data, carac.key), adv: row.adv,
        });
    }

    if (spec.kind === 'talent') {
        const inCareer = career ? isTalentInCareer(career, rank, spec.nom, chosen, overrides, engine?.talentResolver) : false;
        return { kind: 'talent', title: spec.nom, nature: 'Talent', name: spec.nom, inCareer, maxCount: 1 };
    }
    return null;
}

function costOf(target, count) {
    return target.kind === 'talent'
        ? talentXpCost(target.inCareer)
        : xpBandCost(target.bands, target.adv, count, target.inCareer);
}

/** Coût, nouveau total et XP restante pour `count` avances (un talent n'a pas de nombre). */
export function purchasePreview(target, count, balance) {
    const cost = costOf(target, count);
    return {
        cost, newTotal: target.kind === 'talent' ? null : target.total + count,
        after: balance - cost, affordable: balance >= cost,
    };
}

/** Payload `purchase` exact, à passer à controller.executeOnlineCommand('purchase', …). */
export function purchasePayload(target, count, engine) {
    const talent = target.kind === 'talent';
    return {
        kind: target.kind, name: target.name,
        ...(target.targetId === undefined ? {} : { targetId: target.targetId }),
        count: talent ? 1 : count, expectedCost: costOf(target, count), catalogVersion: engine.catalogVersion,
    };
}

/** Message français pour une erreur du contrôleur (`error.code`, `error.details.kind`). */
export function purchaseErrorMessage(error) {
    const kind = error?.details?.kind || error?.code;
    switch (kind) {
    case 'insufficient-xp':
        return `XP insuffisants : ${error.details.cost} requis, ${error.details.balance} disponibles.`;
    case 'price-changed':
        return `Le coût a changé : ${error.details.currentCost} XP. Vérifiez et réessayez.`;
    case 'catalog-version-unsupported':
        return 'Les règles ont été mises à jour. Rechargez la fiche puis réessayez.';
    case 'conflict': case 'aborted':
        return 'La fiche a changé entre-temps. Vérifiez-la et réessayez.';
    case 'permission-denied':
        return 'Vous n’avez pas le droit d’effectuer cet achat.';
    case 'unavailable': case 'deadline-exceeded': case 'internal': case 'unknown':
        return 'Réponse du serveur incertaine : l’achat n’est peut-être pas enregistré. Utilisez Réessayer.';
    default:
        return 'Achat impossible pour le moment. Réessayez.';
    }
}

import { primarySkillLabel, publishedSkillRows } from '../catalogue/skill-forms.js';
import { basicSkillNom, BASIC_SKILLS } from '../fiche/basic-skills.js';
import {
    activeCareerRank, findCareerByName, getActiveVariantForRang, getRangVariants, isCaracInCareer, isSkillInCareer, isTalentInCareer,
} from '../fiche/career-model.js';
import { caracTotal } from '../fiche/derived.js';
import { canonicalSkillNom, sameSkill } from '../fiche/skill-names.js';
import { CARAC_XP_BANDS, careerRankXpCost, SKILL_XP_BANDS, talentXpCost, xpBandCost } from '../fiche/xp.js';
import { learnable, talentChoices, talentTaken } from './fiche-aptitudes-model.js';
import { careerChangeBlock } from './fiche-career-model.js';
import { basicLabel, basicSpecOptions, CARACS } from './fiche-model.js';

export const MAX_ADVANCES = 10;

/**
 * Description affichable d'une cible d'achat, ou null si la ligne n'existe plus.
 * `careers` : js/data/careers.json ; `spec` : { kind: 'carac', key } | { kind: 'skill', ...ligne de skillRows }
 * | { kind: 'skill', newName } (compétence avancée choisie par son nom) | { kind: 'talent', nom, pick? } (`pick` : spécialité choisie d'un emplacement « au choix » ou « A ou B ») | { kind: 'rank', rankMode: 'advanceRank' }
 * | { kind: 'rank', rankMode: 'changeCareer', careerId, targetRank } | { kind: 'sort' | 'miracle', nom } (du catalogue, pas encore connu). Le nom et `targetId` suivent ce que le serveur adresse (jamais le libellé affiché).
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
        let title;
        let specialty = null;
        if (spec.newName) {
            const resolved = resolver?.resolve(spec.newName);
            const entry = resolved?.status === 'resolved' ? resolved.entry : null;
            // Une spécialité de base se règle sur sa compétence de base, pas par un achat de ligne avancée.
            if (entry?.basic || (!entry && !spec.newName.trim())) return null;
            const name = entry?.nom || canonicalSkillNom(spec.newName.trim());
            // Le serveur reprend la ligne déjà possédée sur la même entrée : on la cible pour afficher ses avances.
            const owned = (data?.skillsAdvanced || []).find(skill => (entry
                ? resolver.resolve(skill.nom).entry?.id === entry.id : sameSkill(skill.nom, name)));
            const group = entry?.group || groupOf(name);
            row = {
                nature: 'Compétence avancée', name, adv: owned?.adv ?? 0, targetId: owned?.id, canonical: name,
                carac: owned?.carac || entry?.carac || publishedSkillRows(resolver).find(item => item.group === group)?.carac || 'int',
            };
            title = name;
            specialty = groupSpecialty(resolver, group);
        } else if (spec.row) {
            const basic = BASIC_SKILLS.find(({ nom }) => nom === spec.row);
            if (!basic) return null;
            const name = basicSkillNom(spec.row, data?.basicSpecs || {});
            row = {
                nature: 'Compétence de base', name, carac: basic.carac, adv: data?.skillsBasic?.[spec.row] ?? 0,
                // Une clé absente de skillsBasic fait chercher une ligne avancée côté serveur : on l'omet alors.
                targetId: Object.hasOwn(data?.skillsBasic || {}, spec.row) ? spec.row : undefined,
                canonical: name,
            };
            title = basicLabel(resolver, spec.row, data?.basicSpecs?.[spec.row]);
            const options = basicSpecOptions(resolver, spec.row);
            if (options.length) {
                specialty = { kind: 'basic', row: spec.row, value: data?.basicSpecs?.[spec.row] || '', options, locked: row.adv > 0 };
            }
        } else {
            const skill = (data?.skillsAdvanced || []).find(({ id }) => id === spec.targetId);
            if (!skill) return null;
            const resolved = resolver?.resolve(skill.nom);
            row = {
                nature: 'Compétence avancée', name: skill.nom, carac: skill.carac, adv: skill.adv ?? 0, targetId: skill.id,
                canonical: resolved?.status === 'resolved' ? resolved.entry.nom : canonicalSkillNom(skill.nom),
            };
            title = primarySkillLabel(resolver, skill.nom);
            specialty = groupSpecialty(resolver, resolved?.entry?.group || groupOf(skill.nom));
        }
        const carac = CARACS.find(({ key }) => key === row.carac);
        if (!carac) return null;
        const inCareer = career ? isSkillInCareer(career, rank, row.canonical, chosen, overrides, resolver) : false;
        return advances('skill', {
            title, nature: row.nature, name: row.name, targetId: row.targetId, bands: SKILL_XP_BANDS, specialty,
            inCareer, baseLabel: carac.nom, baseValue: caracTotal(data, carac.key), adv: row.adv,
        });
    }

    if (spec.kind === 'talent') {
        // Emplacement à spécialité : le nom acheté est `Base (Choix)`, tarifé comme le serveur sur ce nom composé.
        const slot = talentChoices(careers, data, spec.nom);
        const pick = String(spec.pick ?? '').replace(/[()]/gu, '').trim();
        const choice = slot && {
            ...slot, pick, options: slot.specs.map(name => ({ spec: name, taken: talentTaken(data, engine, `${slot.base} (${name})`) })),
        };
        const needsChoice = !!slot && !(slot.free ? pick : slot.specs.includes(pick));
        const name = slot && !needsChoice ? `${slot.base} (${pick})` : spec.nom;
        const inCareer = career ? isTalentInCareer(career, rank, name, chosen, overrides, engine?.talentResolver) : false;
        const described = engine?.resolveTalent?.(name);
        return {
            kind: 'talent', title: slot ? described?.displayedName || name : spec.nom, nature: 'Talent', name, inCareer, maxCount: 1,
            choice, needsChoice, taken: talentTaken(data, engine, name),
            // Texte publié localement (aucun réseau) ; une ligne vide n'est pas un paragraphe.
            description: String(described?.description ?? '').split('\n').map(line => line.trim()).filter(Boolean),
        };
    }

    if (spec.kind === 'sort' || spec.kind === 'miracle') {
        // `cost` fixe (palier calculé comme le serveur) : pas de stepper, une seule prise.
        const found = learnable(engine, data, spec.kind, spec.nom);
        if (!found) return null;
        const { rule } = found;
        const prayer = spec.kind === 'miracle';
        const facts = [prayer ? '' : `NI ${rule.cn ?? rule.ni}`, ...[['Portée', rule.portee], ['Cible', rule.cible], ['Durée', rule.duree]]
            .filter(([, value]) => value).map(([label, value]) => `${label} : ${value}`)].filter(Boolean).join(' · ');
        return {
            kind: spec.kind, title: rule.nom, nature: prayer ? 'Miracle' : `Sort · ${rule.type}`, name: rule.nom, maxCount: 1, cost: found.cost,
            tariff: prayer ? `Miracles déjà connus : ${found.known}` : `Sorts déjà connus de ce palier : ${found.known}`,
            description: [facts, ...String((prayer ? rule.effet : rule.desc) ?? '').split('\n')].map(line => line.trim()).filter(Boolean),
        };
    }

    if (spec.kind === 'rank') {
        const change = spec.rankMode === 'changeCareer';
        const target = change ? (careers || []).find(({ id }) => id === spec.careerId) : career;
        const targetRank = change ? spec.targetRank : rank + 1;
        // Le coût dépend de l'achèvement de la carrière actuelle ; sans carrière, le serveur refuse aussi.
        if (!career || !target || !engine?.evaluateCareerCompletion || !['advanceRank', 'changeCareer'].includes(spec.rankMode)
            || (change ? careerChangeBlock(data, career, rank, target, targetRank) : !getRangVariants(career, targetRank).length)) return null;
        const variant = getActiveVariantForRang(target, targetRank, change ? {} : chosen);
        const complete = engine.evaluateCareerCompletion(data, career, rank).complete;
        return {
            kind: 'rank', rankMode: spec.rankMode, careerId: change ? target.id : undefined, targetRank, complete, maxCount: 1,
            title: change ? 'Changer de carrière' : `Passer au rang ${targetRank}`,
            nature: change ? `${target.nom} · rang ${targetRank}` : career.nom,
            summary: `${career.nom} (rang ${rank}) → ${target.nom} (rang ${targetRank}${variant?.titre ? ` · ${variant.titre}` : ''})`,
        };
    }
    return null;
}

const groupOf = nom => nom.match(/^(.+?)\s+\(/u)?.[1] || nom;

// Les spécialités (non de base) publiées d'un groupe : de quoi ajouter une ligne avancée au même groupe.
function groupSpecialty(resolver, group) {
    const options = publishedSkillRows(resolver).filter(item => item.group === group && item.spec && !item.basic)
        .map(({ nom, spec }) => ({ nom, spec }));
    return options.length ? { kind: 'group', group, options } : null;
}

function costOf(target, count) {
    if (target.kind === 'rank') return careerRankXpCost(target.complete);
    if (target.cost !== undefined) return target.cost;
    return target.kind === 'talent'
        ? talentXpCost(target.inCareer)
        : xpBandCost(target.bands, target.adv, count, target.inCareer);
}

/** Coût, nouveau total et XP restante pour `count` avances (un talent n'a pas de nombre). */
export function purchasePreview(target, count, balance) {
    const cost = costOf(target, count);
    return {
        cost, newTotal: target.total === undefined ? null : target.total + count,
        after: balance - cost, affordable: balance >= cost,
    };
}

/** Payload `purchase` exact, à passer à controller.executeOnlineCommand('purchase', …). */
export function purchasePayload(target, count, engine) {
    if (target.kind === 'rank') {
        return {
            kind: 'rank', rankMode: target.rankMode, ...(target.careerId === undefined ? {} : { careerId: target.careerId }),
            targetRank: target.targetRank, count: 1, expectedCost: costOf(target, 1), catalogVersion: engine.catalogVersion,
        };
    }
    if (target.needsChoice) throw new Error('Spécialité du talent à choisir avant l’achat');
    const single = target.kind === 'talent' || target.cost !== undefined;
    return {
        kind: target.kind, name: target.name,
        ...(target.targetId === undefined ? {} : { targetId: target.targetId }),
        count: single ? 1 : count, expectedCost: costOf(target, count), catalogVersion: engine.catalogVersion,
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
    case 'career-prerequisite':
        return 'Prérequis de la carrière non atteint.';
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

/** Message français pour une erreur d'annulation (mêmes codes que purchaseErrorMessage, plus la règle du dernier achat). */
export function cancelErrorMessage(error) {
    switch (error?.details?.kind || error?.code) {
    case 'purchase-not-reversible':
        return 'Cet achat ne peut plus être annulé.';
    case 'permission-denied':
        return 'Vous ne pouvez annuler que votre dernier achat.';
    case 'unavailable': case 'deadline-exceeded': case 'internal': case 'unknown':
        return 'Réponse du serveur incertaine : l’annulation n’est peut-être pas enregistrée. Utilisez Réessayer.';
    case 'conflict': case 'aborted':
        return purchaseErrorMessage(error);
    default:
        return 'Annulation impossible pour le moment. Réessayez.';
    }
}

import { primarySkillLabel } from '../catalogue/skill-forms.js';
import { basicSkillNom, BASIC_SKILLS } from '../fiche/basic-skills.js';
import {
    activeCareerRank, findCareerByName, getActiveVariantForRang, getCareerCaracs, getRangVariants, isSkillInCareer,
} from '../fiche/career-model.js';
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

/** Nom affiché d'une compétence de base, spécialité comprise (« Art » + « Écriture » → « Art (Écriture) »). */
export function basicLabel(resolver, nom, spec) {
    return primarySkillLabel(resolver, spec ? `${nom.replace(/ \(Base\)$/u, '')} (${spec})` : nom);
}

/** Spécialités publiées d'une compétence de base (vide si elle n'en a pas : « Corps à corps (Base) » n'en propose pas, comme le bureau). */
export function basicSpecOptions(resolver, nom) {
    if (nom.includes('(')) return [];
    return [...new Set((resolver?.primaryEntries || []).filter(entry => entry.basic && entry.group === nom && entry.specialization)
        .map(entry => entry.nom.match(/\(([^()]+)\)$/u)?.[1] || entry.specialization))];
}

/**
 * Toutes les compétences du personnage : une ligne par compétence de base (filtrée comme buildBasicSkills du bureau),
 * puis une par compétence avancée (deux lignes sur la même entrée principale restent séparées, chacune son `targetId`).
 * Ligne : { key, nom (affiché), caracKey, caracAbbr, caracTotal, adv, total, inCareer, basic, group, spec,
 * serverName (nom stocké côté serveur), row (clé BASIC_SKILLS) | targetId }.
 * `careers` n'est lu que pour « de carrière » : sans lui, inCareer vaut false.
 */
export function skillRows(data, engine, careers = []) {
    const resolver = engine?.skillResolver;
    const career = findCareerByName(careers, String(data?.carriere ?? ''));
    const rank = career ? activeCareerRank(career, data?.rang) : 1;
    const inCareer = name => !!career
        && isSkillInCareer(career, rank, name, data?.chosenVariants || {}, data?.careerOverrides || {}, resolver);
    const caracAbbr = Object.fromEntries(CARACS.map(({ key, abbr }) => [key, abbr]));
    const build = (fields, adv, careerName) => ({
        ...fields, caracAbbr: caracAbbr[fields.caracKey] || '', caracTotal: caracTotal(data, fields.caracKey), adv,
        total: caracTotal(data, fields.caracKey) + adv, inCareer: inCareer(careerName),
    });
    const rows = [];
    const shown = new Set();
    for (const { nom, carac } of BASIC_SKILLS) {
        const entry = resolver?.resolve(nom)?.entry;
        if (entry) {
            // Même filtre que le bureau : seulement les compétences de base, et une seule ligne (la canonique) par entrée.
            const canonical = BASIC_SKILLS.find(item => item.nom === entry.group || item.nom === entry.nom
                || item.nom === `${entry.group} (Base)`);
            if (!entry.basic || shown.has(entry.id) || (canonical && canonical.nom !== nom)) continue;
            shown.add(entry.id);
        }
        const spec = data?.basicSpecs?.[nom] || '';
        rows.push(build({
            key: `b:${nom}`, nom: basicLabel(resolver, nom, spec), caracKey: carac, basic: true,
            group: nom.replace(/ \(Base\)$/u, ''), spec, row: nom, serverName: basicSkillNom(nom, data?.basicSpecs),
        }, count(data?.skillsBasic?.[nom]), basicSkillNom(nom, data?.basicSpecs)));
    }
    (data?.skillsAdvanced || []).forEach((skill, index) => {
        const stored = skill?.nom ?? '';
        const parts = stored.match(/^(.+?)\s+\(([^()]+)\)$/u);
        const entry = resolver?.resolve(stored)?.entry;
        rows.push(build({
            key: `a:${skill?.id ?? index}`, nom: primarySkillLabel(resolver, stored), caracKey: skill?.carac, basic: false,
            group: entry?.group || (parts ? parts[1] : stored), spec: parts ? parts[2] : '',
            serverName: stored, targetId: skill?.id,
        }, count(skill?.adv), stored));
    });
    return rows;
}

/**
 * Les n compétences les plus hautes (de base puis avancées), total = caractéristique + avances ; `carac` est l'abréviation.
 * Les lignes gardent l'adressage d'achat de skillRows (`row` ou `targetId`, `serverName`).
 * Tri par total décroissant puis nom ; les compétences sans avance ne comblent que les places libres.
 */
export function topSkills(data, engine, n) {
    const byTotal = (a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr');
    const rows = skillRows(data, engine).map(row => ({ ...row, carac: row.caracAbbr }));
    const trained = rows.filter(row => row.adv > 0).sort(byTotal);
    const untrained = rows.filter(row => row.adv === 0).sort(byTotal);
    return [...trained, ...untrained].slice(0, n);
}

// Libellé lisible d'un achat récent (nom principal de la compétence, nom complet de la caractéristique) ; sinon celui du serveur.
function purchaseLabel(entry, engine) {
    const advances = Math.floor(+entry.avances);
    if (entry.kind === 'purchase' && entry.targetNom && advances > 0) {
        if (entry.type === 'Compétence') return `${primarySkillLabel(engine?.skillResolver, entry.targetNom)} +${advances}`;
        const carac = entry.type === 'Caractéristique' && CARACS.find(({ key }) => key === entry.targetNom);
        if (carac) return `${carac.nom} +${advances}`;
    }
    return String(entry.achat || entry.targetNom || '');
}

/**
 * Lignes du journal d'XP, la plus récente d'abord : { key, label, nature, amount (signé : gain +, dépense −), cancelled, purchaseId }.
 * `purchaseId` n'est renseigné que sur le dernier achat annulable de `uid` (même règle que le serveur : son dernier achat
 * non annulé). L'entrée technique `cancel` n'a pas de ligne : le remboursement (nature « Annulation ») porte l'information.
 * Les entrées historiques sans `kind` sont des achats.
 */
export function xpLogRows(data, engine, uid) {
    // ponytail: le MJ n'annule ici que son propre dernier achat ; les plus anciens s'annulent depuis le bureau.
    const log = Array.isArray(data?.xpLog) ? data.xpLog : [];
    const latest = log.findLast(entry => entry?.kind === 'purchase' && entry.origin === 'command'
        && entry.actorUid === uid && !entry.cancelledByOperationId);
    const rows = [];
    log.forEach((entry, index) => {
        if (!entry || entry.kind === 'cancel') return;
        const key = String(entry.id ?? `log-${index}`);
        if (entry.kind === 'gain') {
            rows.push({
                key, label: String(entry.raison ?? ''), amount: +entry.montant || 0, cancelled: false, purchaseId: '',
                nature: entry.cancelledPurchaseId ? 'Annulation' : entry.correction ? 'Correction MJ' : 'Gain',
            });
            return;
        }
        const correction = entry.kind === 'correction';
        rows.push({
            key, label: purchaseLabel(entry, engine),
            nature: correction ? 'Correction MJ' : `Achat · ${entry.type || 'Autre'}`,
            amount: -(+entry.cout || 0) || 0, cancelled: !!entry.cancelledByOperationId,
            purchaseId: entry === latest && typeof entry.purchaseId === 'string' && Array.isArray(entry.effects) ? entry.purchaseId : '',
        });
    });
    return rows.reverse();
}

// Repère, en LECTURE SEULE sur la production, les compétences dont le nom contient « au choix »
// (reliquat du défaut corrigé en v2.42.1). Aucune écriture, aucune suppression : seul `get()` est appelé.
// Sortie limitée à : identifiant de fiche, nom du personnage, nom de la compétence, avances.
//
// Usage : node tools/reperer-competences-au-choix.mjs --project=campagne-wrpg
// Identifiants : session Firebase CLI du compte MJ, comme les autres outils (tools/fiche-prod-backup.mjs).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCliAuthenticatedClient, PROJECT } from './fiche-prod-backup.mjs';

const PATTERN = /au\s+choix/iu;
// Champs de la fiche où une compétence peut être stockée (cf. js/fiche-schema.js, EXPORT_KEYS des commandes).
const SKILL_FIELDS = ['skillsBasic', 'skillsAdvanced', 'customSpecs', 'basicSpecs', 'careerOverrides', 'chosenVariants', 'careers'];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const advancesOf = value => {
    if (typeof value === 'number') return value;
    if (isRecord(value)) for (const key of ['adv', 'avances']) if (typeof value[key] === 'number') return value[key];
    return null;
};

// Parcourt récursivement une valeur ; `adv` est l'avance connue de l'entrée parente (clé de table ou ligne).
export function findAuChoix(value, field, adv = null, out = []) {
    if (typeof value === 'string') {
        if (PATTERN.test(value)) out.push({ competence: value, avances: adv });
    } else if (Array.isArray(value)) {
        for (const item of value) findAuChoix(item, field, isRecord(item) ? advancesOf(item) : adv, out);
    } else if (isRecord(value)) {
        const own = advancesOf(value) ?? adv;
        for (const [key, child] of Object.entries(value)) {
            if (PATTERN.test(key)) out.push({ competence: key, avances: advancesOf(child) ?? own });
            else findAuChoix(child, field, own, out);
        }
    }
    return out;
}

export function reperer(data) {
    const found = [];
    for (const field of SKILL_FIELDS) {
        const hits = findAuChoix(data?.[field], field);
        // Une ligne { nom, adv } est reconnue deux fois (clé puis valeur) : on dédoublonne.
        for (const hit of hits) if (!found.some(f => f.competence === hit.competence && f.avances === hit.avances)) found.push(hit);
    }
    return found;
}

async function main() {
    const project = process.argv.slice(2).find(a => a.startsWith('--project='))?.slice(10);
    if (project !== PROJECT) throw new Error(`--project=${PROJECT} obligatoire`);
    if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Production refusée avec un émulateur');
    const client = await createCliAuthenticatedClient();
    try {
        const snapshot = await client.db.collection('fiches').get();
        const rows = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            for (const hit of reperer(data)) {
                rows.push({ fiche: doc.id, personnage: typeof data.nom === 'string' ? data.nom : null, competence: hit.competence, avances: hit.avances });
            }
        }
        console.log(rows.length ? JSON.stringify(rows, null, 2) : 'aucune');
    } finally {
        await client.app.delete();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();

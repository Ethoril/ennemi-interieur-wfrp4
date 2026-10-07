import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillEntries, collectLegacySkillAliases } from '../js/catalogue/skill-resolver.js';
import { buildTalentEntries } from '../js/catalogue/talent-resolver.js';

// --seed doit désigner une capture du référentiel publié, jamais une sortie de ce générateur.
// Exemple : node tools/catalogue-build-snapshot.mjs --seed=../outputs/audit-fiches-drive-2026-10-07/published-catalogue.json

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const canonicalJson = value => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
};
const versionOf = value => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

const [skillRows, careers, sheetSnapshot] = await Promise.all([
    readJson('js/data/skills.json'),
    readJson('js/data/careers.json'),
    readJson('js/catalogue/talents-sheet-snapshot.json'),
]);
const seedPath = process.argv.find(arg => arg.startsWith('--seed='))?.slice(7);
const seedKey = path => process.platform === 'win32' ? resolve(root, path).toLowerCase() : resolve(root, path);
if (!seedPath || ['js/catalogue/referentiel-public.json', 'functions/src/catalogue/referentiel-public.json'].map(seedKey).includes(seedKey(seedPath))) {
    throw new Error('Fournir --seed=<published-catalogue.json> : le référentiel généré ne peut pas servir de graine.');
}
const prior = await readJson(seedPath);
const careerSkillLabels = careers.flatMap(career => career.rangs.flatMap(rank => rank.skills || []));
const generatedSkills = buildSkillEntries(skillRows);
const knownSkills = new Set(prior.skills.entries.map(row => row.nom));
const skillEntries = [...prior.skills.entries, ...generatedSkills.filter(row => !knownSkills.has(row.nom)
    && skillRows.some(source => source.nom === row.nom && source.source === 'Drive Carrières — Lustria'))];
const skillAliases = prior.skills.aliases || collectLegacySkillAliases([...skillRows.map(row => row.nom), ...careerSkillLabels], skillEntries);
const talentEntries = [...new Map([...prior.talents.entries, ...buildTalentEntries({ sheetSnapshot, careers })]
    .map(row => [row.id, row])).values()];
const talentAliases = prior.talents.aliases || [];
const talentTemplates = prior.talents.templates || [];
const localTalentDescriptions = prior.talents.localDescriptions || [];
const skills = { version: versionOf({ entries: skillEntries, aliases: skillAliases }), entries: skillEntries, aliases: skillAliases };
const talents = {
    version: versionOf({ entries: talentEntries, aliases: talentAliases, templates: talentTemplates,
        localDescriptions: localTalentDescriptions, descriptionSnapshotVersion: sheetSnapshot.catalogVersion }),
    entries: talentEntries,
    aliases: talentAliases,
    templates: talentTemplates,
    localDescriptions: localTalentDescriptions,
    descriptionSnapshotVersion: sheetSnapshot.catalogVersion,
};
const snapshot = {
    catalogVersion: versionOf({ skills, talents }),
    publishedAt: new Date().toISOString().slice(0, 10),
    sources: {
        skills: 'js/data/skills.json',
        careers: 'js/data/careers.json',
        talents: sheetSnapshot.source,
        skillAliasProvenance: 'alias-historique-du-site',
    },
    skills,
    talents,
};
const publicContent = `${JSON.stringify(snapshot, null, 2)}\n`;
const sheetContent = `${JSON.stringify(sheetSnapshot, null, 2)}\n`;
await Promise.all([
    writeFile(resolve(root, 'js/catalogue/referentiel-public.json'), publicContent, 'utf8'),
    writeFile(resolve(root, 'functions/src/catalogue/referentiel-public.json'), publicContent, 'utf8'),
    writeFile(resolve(root, 'functions/src/catalogue/talents-sheet-snapshot.json'), sheetContent, 'utf8'),
]);
process.stdout.write(`${skillEntries.length} identités de compétences, ${skillAliases.length} alias, ${talentEntries.length} talents, ${snapshot.catalogVersion}\n`);

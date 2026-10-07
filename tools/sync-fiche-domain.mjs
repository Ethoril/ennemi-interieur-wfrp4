import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.slice(2).includes('--check');
const generated = [
    ['js/fiche/commands.js', 'functions/src/domain/fiche/commands.js'],
    ['js/fiche/career-model.js', 'functions/src/domain/fiche/career-model.js'],
    ['js/fiche/basic-skills.js', 'functions/src/domain/fiche/basic-skills.js'],
    ['js/fiche/skill-names.js', 'functions/src/domain/fiche/skill-names.js'],
    ['js/fiche/xp.js', 'functions/src/domain/fiche/xp.js'],
    ['js/fiche/published-catalogue-engine.js', 'functions/src/domain/fiche/published-catalogue-engine.mjs', source => source
        .replaceAll("'../catalogue/talent-resolver.js'", "'../../catalogue/talent-resolver.mjs'")
        .replaceAll("'../catalogue/skill-resolver.js'", "'../../catalogue/skill-resolver.mjs'")],
    ['js/fiche-schema.js', 'functions/src/domain/fiche-schema.js'],
    ['js/catalogue/skill-resolver.js', 'functions/src/catalogue/skill-resolver.mjs', source => source
        .replaceAll("'../fiche/skill-names.js'", "'../domain/fiche/skill-names.js'")
        .replaceAll("'../fiche/basic-skills.js'", "'../domain/fiche/basic-skills.js'")],
    ['js/catalogue/talent-resolver.js', 'functions/src/catalogue/talent-resolver.mjs', source => source
        .replaceAll("'./talent-source.js'", "'./talent-source.mjs'")],
    ['js/catalogue/talent-source.js', 'functions/src/catalogue/talent-source.mjs'],
    ['js/catalogue/referentiel-public.json', 'functions/src/catalogue/referentiel-public.json'],
    ['js/catalogue/talents-sheet-snapshot.json', 'functions/src/catalogue/talents-sheet-snapshot.json'],
    ['js/data/careers.json', 'functions/src/data/careers.json'],
    ['js/data/skills.json', 'functions/src/data/skills.json'],
    ['js/data/fiche-catalog.json', 'functions/src/data/fiche-catalog.json'],
];

const canonicalJson = value => Array.isArray(value)
    ? `[${value.map(canonicalJson).join(',')}]`
    : value && typeof value === 'object'
        ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
        : JSON.stringify(value);
const careers = JSON.parse(await readFile(resolve(repoRoot, 'js/data/careers.json'), 'utf8'));
const skills = JSON.parse(await readFile(resolve(repoRoot, 'js/data/skills.json'), 'utf8'));
const catalog = JSON.parse(await readFile(resolve(repoRoot, 'js/data/fiche-catalog.json'), 'utf8'));
const expectedCatalogVersion = `sha256:${createHash('sha256').update(canonicalJson({
    careers, skills, spells: catalog.spells, miracles: catalog.miracles,
})).digest('hex')}`;
if (catalog.catalogVersion !== expectedCatalogVersion) {
    throw new Error('fiche-catalog.json: catalogVersion ne correspond pas aux carrières, compétences, sorts et miracles');
}

let divergent = false;
for (const [sourceName, targetName, transform] of generated) {
    const original = await readFile(resolve(repoRoot, sourceName));
    const source = transform ? globalThis.Buffer.from(transform(original.toString('utf8'))) : original;
    const targetPath = resolve(repoRoot, targetName);
    let target;
    try {
        target = await readFile(targetPath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (target?.equals(source)) continue;
    divergent = true;
    if (checkOnly) {
        process.stderr.write(`Fiche domain divergence: ${targetName} <- ${sourceName}\n`);
        continue;
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, source);
}

if (checkOnly && divergent) process.exitCode = 1;
else if (!checkOnly) process.stdout.write(`Synchronized ${generated.length} fiche domain files.\n`);

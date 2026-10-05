// Migration F1.2 hors ligne uniquement : dry-run par défaut, aucune connexion Firebase.
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrateFicheDocument } from '../js/fiche-schema.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function optionValue(args, name) {
    const prefix = `--${name}=`;
    const value = args.find(argument => argument.startsWith(prefix));
    return value ? value.slice(prefix.length) : null;
}

export function parseArgs(argv = process.argv.slice(2)) {
    return {
        input: optionValue(argv, 'input'),
        out: optionValue(argv, 'out'),
        manifest: optionValue(argv, 'manifest'),
        charId: optionValue(argv, 'char-id'),
        apply: argv.includes('--apply'),
        help: argv.includes('--help') || argv.includes('-h'),
    };
}

export function isOutsideRepository(path, repoRoot = REPO_ROOT) {
    const pathFromRepo = relative(resolve(repoRoot), resolve(path));
    return pathFromRepo === '..' || pathFromRepo.startsWith(`..${sep}`) || isAbsolute(pathFromRepo);
}

export function validateOptions(options, repoRoot = REPO_ROOT) {
    const errors = [];
    for (const key of ['input', 'out']) {
        const path = options[key];
        if (!path) errors.push(`--${key} obligatoire`);
        else if (!isAbsolute(path)) errors.push(`--${key} doit être un chemin absolu`);
        else if (!isOutsideRepository(path, repoRoot)) errors.push(`--${key} doit être hors du dépôt`);
    }
    if (options.apply && !options.manifest) errors.push('--manifest obligatoire avec --apply');
    if (options.manifest && (!isAbsolute(options.manifest)
        || !isOutsideRepository(options.manifest, repoRoot))) {
        errors.push('--manifest doit être un chemin absolu hors du dépôt');
    }
    if (options.input && options.out && resolve(options.input) === resolve(options.out)) {
        errors.push('le fichier de sortie doit être distinct de la source');
    }
    if (options.manifest && [options.input, options.out].some(path => path && resolve(path) === resolve(options.manifest))) {
        errors.push('le manifeste doit être distinct des fichiers source et sortie');
    }
    if (typeof options.charId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(options.charId)) {
        errors.push('--char-id invalide');
    }
    return errors;
}

function publicSummary(report) {
    return {
        status: report.status,
        charId: report.charId,
        sourceFingerprint: report.sourceFingerprint,
        sourceSchemaVersion: report.sourceSchemaVersion,
        targetSchemaVersion: report.targetSchemaVersion,
        sourceRevision: report.sourceRevision,
        targetRevision: report.targetRevision,
        arrays: Object.fromEntries(Object.entries(report).filter(([key]) => [
            'skillsAdvanced', 'careers', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres', 'xpLog',
        ].includes(key))),
        arrayCountsBefore: report.arrayCountsBefore,
        arrayCountsAfter: report.arrayCountsAfter,
        missingArraysBefore: report.missingArraysBefore,
        numericSummaryBefore: report.numericSummaryBefore,
        numericSummaryAfter: report.numericSummaryAfter,
        numericAnomalies: report.numericAnomalies,
        xpBefore: report.xpBefore,
        xpAfter: report.xpAfter,
        idsAssigned: report.assignedIds.length,
        syntheticXpGain: report.syntheticXpGain,
        anomalies: report.anomalies,
        blocked: report.blocked,
    };
}

async function resolveOutputOutside(path, repoRoot) {
    const requestedPath = resolve(path);
    const requestedParent = dirname(requestedPath);
    let existingParent = requestedParent;
    while (true) {
        try {
            await stat(existingParent);
            break;
        } catch (error) {
            if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
            const nextParent = dirname(existingParent);
            if (nextParent === existingParent) throw error;
            existingParent = nextParent;
        }
    }
    const realExistingParent = await realpath(existingParent);
    const missingParentSuffix = relative(existingParent, requestedParent);
    const realParent = resolve(realExistingParent, missingParentSuffix);
    const realPath = resolve(realParent, basename(requestedPath));
    if (!isOutsideRepository(realPath, repoRoot)) throw new Error('chemin réel dans le dépôt refusé');
    return realPath;
}

async function writeNewFile(path, content) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
}

export async function runMigration(options, { repoRoot = REPO_ROOT } = {}) {
    const errors = validateOptions(options, repoRoot);
    if (errors.length) throw new Error(errors.join('\n'));

    const inputPath = await realpath(options.input);
    if (!isOutsideRepository(inputPath, repoRoot)) throw new Error('--input pointe dans le dépôt');
    const outPath = await resolveOutputOutside(options.out, repoRoot);
    if (inputPath === outPath) throw new Error('le fichier de sortie doit être distinct de la source');
    await mkdir(dirname(outPath), { recursive: true });
    let manifestPath = null;
    if (options.manifest) {
        manifestPath = await resolveOutputOutside(options.manifest, repoRoot);
        if (manifestPath === inputPath || manifestPath === outPath) {
            throw new Error('le manifeste doit être distinct des fichiers source et sortie');
        }
        await mkdir(dirname(manifestPath), { recursive: true });
    }

    const source = JSON.parse(await readFile(inputPath, 'utf8'));
    const { document, report, canApply } = await migrateFicheDocument(source, { charId: options.charId });
    if (options.apply && canApply) {
        await writeNewFile(outPath, document);
        await writeNewFile(manifestPath, { mode: 'applied-to-new-file', ...publicSummary(report), assignedIds: report.assignedIds });
    }
    else await writeNewFile(outPath, options.apply ? publicSummary(report) : {
        mode: 'dry-run',
        ...publicSummary(report),
        assignedIds: report.assignedIds,
    });
    return { canApply, appliedToNewFile: options.apply && canApply, report: publicSummary(report), outPath };
}

function usage() {
    return [
        'Usage : node tools/fiche-migrate.mjs --input=<json-absolu-hors-depot> --out=<nouveau-json-absolu-hors-depot> --char-id=<id> [--apply --manifest=<json-absolu-hors-depot>]',
        'Sans --apply, --out reçoit uniquement le rapport de simulation. Avec --apply, --out reçoit la fiche normalisée et --manifest son rapport.',
        'Le script ne modifie jamais la source, ne se connecte pas à Firebase et refuse tout chemin dans le dépôt.',
    ].join('\n');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
    const options = parseArgs();
    if (options.help) {
        process.stdout.write(`${usage()}\n`);
    } else {
        try {
            const result = await runMigration(options);
        process.stdout.write(`${JSON.stringify({
                status: result.report.status,
                charId: result.report.charId,
                sourceFingerprint: result.report.sourceFingerprint,
                targetRevision: result.report.targetRevision,
                idsAssigned: result.report.idsAssigned,
                anomalyCount: result.report.anomalies.length,
                blocked: result.report.blocked,
            })}\n`);
            if (!result.canApply) process.exitCode = 2;
        } catch (error) {
            process.stderr.write(`Migration fiche refusée : ${error.message}\n${usage()}\n`);
            process.exitCode = 1;
        }
    }
}

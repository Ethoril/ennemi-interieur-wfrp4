import { createTalentResolver } from '../../catalogue/talent-resolver.mjs';
import { buildSkillEntries, createSkillResolver } from '../../catalogue/skill-resolver.mjs';
import { FicheCommandError, createFicheCommandEngine } from './commands.js';

function fail(message, code = 'failed-precondition', details = undefined) {
    throw new FicheCommandError(message, code, details);
}

/** Compose le moteur XP avec une version publiée injectée du référentiel. */
export function createPublishedCatalogueEngine({ catalogue, careers, skills, spells, talentSheetSnapshot, rankCompletionPolicy = 'automatic' } = {}) {
    if (!catalogue || typeof catalogue.catalogVersion !== 'string' || !catalogue.catalogVersion
        || !catalogue.skills || !catalogue.talents || typeof spells?.catalogVersion !== 'string'
        || !Array.isArray(spells.spells) || !Array.isArray(spells.miracles)) {
        fail('référentiel publié ou catalogue magique indisponible', 'failed-precondition', { kind: 'catalog-version-unsupported' });
    }
    let skillResolver;
    let talentResolver;
    try {
        const additional = talentSheetSnapshot?.schemaVersion === 2 ? buildSkillEntries((skills || [])
            .filter(row => row.source === 'Drive Carrières — Lustria')) : [];
        const known = new Set(catalogue.skills.entries.map(row => row.nom));
        skillResolver = createSkillResolver({ version: catalogue.catalogVersion, ...catalogue.skills,
            entries: [...catalogue.skills.entries, ...additional.filter(row => !known.has(row.nom))] });
        talentResolver = createTalentResolver({ version: catalogue.catalogVersion, ...catalogue.talents, sheetSnapshot: talentSheetSnapshot });
    } catch (error) {
        fail(`référentiel invalide : ${error.message}`, 'failed-precondition', { kind: 'catalog-version-unsupported' });
    }
    if (skillResolver.aliasErrors.length || talentResolver.aliasErrors.length) {
        fail('référentiel publié invalide', 'failed-precondition', { kind: 'catalog-version-unsupported' });
    }
    const catalogVersion = `skills:${catalogue.catalogVersion}|rules:${spells.catalogVersion}`
        + (talentSheetSnapshot?.schemaVersion === 2 ? `|talents:${talentSheetSnapshot.catalogVersion}` : '');
    const publishedSkills = (skillResolver.primaryEntries || skills).map(entry => ({ ...entry, group: entry.nom.split('(')[0].trim(), spec: entry.specialization || '' }));
    const engine = createFicheCommandEngine({ careers, skills: publishedSkills, spells, catalogVersion,
        rankCompletionPolicy, skillResolver, talentResolver });
    function applyCommand(data, command, context) {
        if (command?.type !== 'purchase' || !command.payload || typeof command.payload.name !== 'string') {
            return engine.applyCommand(data, command, context);
        }
        const payload = { ...command.payload };
        const resolver = payload.kind === 'skill' ? skillResolver : payload.kind === 'talent' ? talentResolver : null;
        const match = resolver?.resolve(payload.name);
        if (match?.status === 'ambiguous') fail('libellé de compétence ou talent ambigu', 'failed-precondition', { kind: 'target-ambiguous' });
        if (match?.status === 'resolved') payload.name = match.purchaseName || match.entry.nom;
        return engine.applyCommand(data, { ...command, payload }, context);
    }
    function validatePatch(data, payload) {
        if (!data || typeof data !== 'object' || !payload?.changes || typeof payload.changes !== 'object'
            || Array.isArray(payload.changes)) fail('modification publiée invalide', 'invalid-argument', { kind: 'invalid-patch' });
        for (const [encodedPath, value] of Object.entries(payload.changes)) {
            let parts;
            try { parts = encodedPath.split('.').map(decodeURIComponent); }
            catch { fail('chemin de modification invalide', 'invalid-argument', { kind: 'invalid-patch' }); }
            if (parts.some(part => !part)) fail('chemin de modification invalide', 'invalid-argument', { kind: 'invalid-patch' });
            if (parts[0] === 'basicSpecs' && parts.length === 2) {
                const physicalKey = parts[1];
                const group = physicalKey.endsWith(' (Base)') ? physicalKey.slice(0, -7) : physicalKey;
                const knownGroup = skillResolver.entries.some(entry => entry.basic === true
                    && (entry.group === group || entry.nom === physicalKey || entry.group === physicalKey));
                if (!knownGroup || typeof value !== 'string' || value.length > 200
                    || (value !== '' && ![group, physicalKey].some(label => {
                        const entry = skillResolver.resolve(`${label} (${value})`).entry;
                        return entry?.basic === true && (entry.group === group || entry.group === physicalKey);
                    }))) {
                    fail('spécialité de base absente du référentiel publié', 'invalid-argument', { kind: 'basic-specialization-invalid' });
                }
                const advances = data.skillsBasic?.[physicalKey] ?? 0;
                if (!Number.isSafeInteger(advances) || advances !== 0) {
                    fail('la spécialisation ne peut pas changer après des avances', 'failed-precondition', { kind: 'specialization-has-advances' });
                }
            } else if (parts[0] === 'chosenVariants' && parts.length === 3) {
                const career = careers.find(item => item.id === parts[1]);
                const rank = Number(parts[2]);
                const variants = career && Number.isSafeInteger(rank) ? career.rangs.filter(item => item.rang === rank) : [];
                if (!variants.length || typeof value !== 'string' || value.length > 200
                    || (value !== '' && !variants.some(variant => variant.titre === value))) {
                    fail('variante absente de la carrière publiée', 'invalid-argument', { kind: 'career-variant-invalid' });
                }
            }
        }
        return true;
    }
    return Object.freeze({
        applyCommand,
        validatePatch,
        catalogVersion,
        skillResolver,
        talentResolver,
        resolveSkill: value => skillResolver.resolve(value),
        resolveTalent: value => talentResolver.resolve(value),
        evaluateCareerCompletion: (data, career, rank) => engine.evaluateCareerCompletion(data, career, rank),
    });
}

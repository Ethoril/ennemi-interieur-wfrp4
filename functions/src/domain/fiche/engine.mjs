import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createFicheCommandEngine } from './commands.js';
import { getRangVariants } from './career-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../../data');
const readJson = name => JSON.parse(readFileSync(resolve(dataDir, name), 'utf8'));
const catalog = readJson('fiche-catalog.json');
const careers = readJson('careers.json');
const skills = readJson('skills.json');

export const ficheCommandEngine = createFicheCommandEngine({
    careers,
    skills,
    spells: { spells: catalog.spells, miracles: catalog.miracles },
    catalogVersion: catalog.catalogVersion,
});

export const applyFicheDomainCommand = ficheCommandEngine.applyCommand;

export function validateFichePatch(data, payload) {
    for (const [encodedPath, value] of Object.entries(payload.changes || {})) {
        let parts;
        try { parts = encodedPath.split('.').map(decodeURIComponent); } catch { throw new TypeError('Chemin de patch invalide'); }
        const [root, key, field] = parts;
        if (root === 'basicSpecs') {
            const currentAdvances = data.skillsBasic?.[key] ?? 0;
            if (!Number.isSafeInteger(currentAdvances) || currentAdvances !== 0) {
                throw Object.assign(new Error('La spécialité ne peut être changée après des avances'), { code: 'failed-precondition' });
            }
            if (value !== '' && !skills.some(skill => skill.basic === true && skill.group === key && skill.spec === value)) {
                throw Object.assign(new Error('Spécialité absente du catalogue'), { code: 'invalid-argument' });
            }
        } else if (root === 'chosenVariants') {
            const career = careers.find(item => item.id === key);
            const rank = Number(field);
            const variants = career && Number.isSafeInteger(rank) ? getRangVariants(career, rank) : [];
            if (value !== '' && !variants.some(variant => variant.titre === value)) {
                throw Object.assign(new Error('Variante absente de la carrière'), { code: 'invalid-argument' });
            }
        } else if (parts.length === 3 && ['careers', 'skillsAdvanced', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres'].includes(root)) {
            const matches = Array.isArray(data[root]) ? data[root].filter(row => row?.id === key) : [];
            if (field !== 'note' || matches.length !== 1) {
                throw Object.assign(new Error('Ligne de fiche introuvable ou champ non modifiable'), { code: 'failed-precondition' });
            }
        }
    }
}

import { primarySkillLabel, publishedSkillRows } from '../catalogue/skill-forms.js';
import { activeCareerRank, findCareerByName, getEffectiveSkills, getVariantsToConsider } from '../fiche/career-model.js';
import { caracTotal, xpBalance } from '../fiche/derived.js';
import { expandChoiceSkill } from '../fiche/skill-names.js';
import { skillRows, CARACS } from '../mobile/fiche-model.js';
import { filterSkills, sortSkills } from '../mobile/fiche-aptitudes-model.js';
import { careerProgress } from '../mobile/fiche-career-model.js';
import { purchaseTarget, purchasePreview } from '../mobile/fiche-purchase.js';

export function bureauSkills(data, engine, careers, filters = {}) {
    const rows = skillRows(data, engine, careers);
    const career = findCareerByName(careers, data?.carriere || '');
    if (career) {
        const completion = engine.evaluateCareerCompletion(data, career, activeCareerRank(career, data.rang));
        const chosen = { ...data.chosenVariants, [career.id]: completion.selections };
        for (let rank = 1; rank <= activeCareerRank(career, data.rang); rank += 1) {
            for (const variant of getVariantsToConsider(career, rank, chosen)) {
                for (const slot of getEffectiveSkills(career, rank, variant, data.careerOverrides)) {
                    for (const name of expandChoiceSkill(slot, value => primarySkillLabel(engine.skillResolver, value, true))) {
                        const entry = engine.skillResolver.resolve(name)?.entry;
                        const label = primarySkillLabel(engine.skillResolver, name, true);
                        if (entry?.basic) {
                            const basic = rows.find(row => row.basic && engine.skillResolver.resolve(row.serverName)?.entry?.group === entry.group);
                            if (basic && !basic.inCareer) basic.careerSpecialty = name;
                            continue;
                        }
                        if (rows.some(row => row.nom === label || row.serverName === name)) continue;
                        const group = name.split('(')[0].trim();
                        const key = entry?.carac || publishedSkillRows(engine.skillResolver).find(row => row.group === group)?.carac || 'int';
                        rows.push({ key: `new:${name}`, nom: label, newName: name, caracKey: key,
                            caracAbbr: CARACS.find(c => c.key === key)?.abbr || '', adv: 0,
                            total: caracTotal(data, key), inCareer: true, basic: false });
                    }
                }
            }
        }
    }
    return sortSkills(filterSkills(rows, filters));
}

export function roleControls(state) {
    const editable = ['ready', 'saving', 'awaiting-snapshot'].includes(state.phase) && ['mj', 'joueur'].includes(state.role);
    return { editable, mj: state.role === 'mj', actions: state.role === 'mj' && state.phase === 'ready' && !state.hasDraft && !state.pendingOperationId };
}

export function inspectorModel(data, engine, careers, selection, state, online, count = 1) {
    const target = selection && purchaseTarget(data, engine, careers, selection);
    if (!target) return null;
    const preview = purchasePreview(target, count, xpBalance(data).libre);
    const reason = !online ? 'Achat possible une fois en ligne.'
        : !['mj', 'joueur'].includes(state.role) || ['legacy-readonly', 'tombstone', 'missing'].includes(state.phase) ? 'Fiche en lecture seule.'
            : state.phase !== 'ready' || state.pendingOperationId || state.hasDraft || state.conflicts?.length ? 'Attendez la synchronisation de la fiche.'
                : target.needsChoice || (target.specialty?.kind === 'group' && engine.skillResolver.resolve(target.name)?.status !== 'resolved') ? 'Choisissez une spécialité.'
                    : !preview.affordable ? `Il manque ${-preview.after} XP.` : '';
    return { target, preview, reason, enabled: !reason };
}

export function missingChips(data, engine, careers) {
    const progress = careerProgress(data, engine, careers);
    const career = findCareerByName(careers, data?.carriere || '');
    if (!progress || !career) return [[], [], []];
    const completion = engine.evaluateCareerCompletion(data, career, progress.rank);
    const caracs = completion.missingCaracs.map(item => ({ label: `${CARACS.find(c => c.key === item.name)?.abbr || item.name} ${item.advances}/${completion.threshold} +`, spec: { kind: 'carac', key: item.name } }));
    const skills = progress.gauges[1].done >= progress.gauges[1].total ? [] : bureauSkills(data, engine, careers)
        .filter(row => (row.inCareer || row.careerSpecialty) && row.adv < completion.threshold)
        .map(row => ({ label: `${row.nom} ${row.adv}/${completion.threshold} +`, spec: { kind: 'skill', ...row } }));
    const talents = completion.hasTalent ? [] : completion.currentRankTalents.map(nom => ({ label: `${nom} +`, spec: { kind: 'talent', nom } }));
    return [caracs, skills, talents];
}

export function correctionChanges(data, selection, values) {
    if (selection.kind === 'identity') return ['nom', 'race'].filter(key => values[key] !== data[key]).map(key => ({ pathParts: [key], value: values[key] }));
    if (selection.kind === 'carac') return ['base', 'adv'].filter(key => Number(values[key]) !== data.carac[selection.key][key])
        .map(key => ({ pathParts: ['carac', selection.key, key], value: Number(values[key]) }));
    if (selection.kind === 'skill') {
        const pathParts = selection.row ? ['skillsBasic', selection.row] : ['skillsAdvanced', selection.targetId, 'adv'];
        const old = selection.row ? data.skillsBasic?.[selection.row] || 0 : data.skillsAdvanced.find(row => row.id === selection.targetId)?.adv;
        return Number(values.adv) === old ? [] : [{ pathParts, value: Number(values.adv) }];
    }
    if (selection.kind === 'talent') {
        const rows = (data.talentsAcq || []).filter(row => row.nom === selection.nom);
        const desired = Math.max(0, Math.floor(Number(values.taken)) || 0);
        return desired < rows.length ? rows.slice(desired).map(row => ({ pathParts: ['talentsAcq', row.id], value: null }))
            : Array.from({ length: desired - rows.length }, () => ({ pathParts: ['talentsAcq', '@new'], value: { nom: selection.nom, note: '' } }));
    }
    return [];
}

// Prévisualisation du lot MJ sans modifier la fiche synchronisée ni ses XP.
export function correctionOverlay(data, items) {
    const next = globalThis.structuredClone(data);
    items.forEach(({ pathParts: parts, value }, index) => {
        if (parts.length === 1) { next[parts[0]] = value; return; }
        const [root, key, field] = parts;
        if (Array.isArray(next[root])) {
            if (key === '@new') next[root].push({ ...value, id: `draft:${index}` });
            else if (value === null) next[root] = next[root].filter(row => row.id !== key);
            else if (field) {
                const row = next[root].find(item => item.id === key);
                if (row) row[field] = value;
            }
        } else {
            next[root] ||= {};
            if (field) { next[root][key] ||= {}; next[root][key][field] = value; }
            else next[root][key] = value;
        }
    });
    return next;
}

export function correctionMatches(item, data, selection) {
    const [root, key] = item.pathParts;
    if (selection.kind === 'identity') return ['nom', 'race'].includes(root);
    if (selection.kind === 'carac') return root === 'carac' && key === selection.key;
    if (selection.kind === 'skill') return selection.row ? root === 'skillsBasic' && key === selection.row : root === 'skillsAdvanced' && key === selection.targetId;
    if (selection.kind === 'talent' && root === 'talentsAcq') return item.value?.nom === selection.nom || data.talentsAcq?.find(row => row.id === key)?.nom === selection.nom;
    return false;
}

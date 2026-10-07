// Équipement partagé : les objets de la fiche sont des copies, jamais des liens vivants.
export const HIT_LOCATIONS = Object.freeze([
    { id: 'head', label: 'Tête' }, { id: 'body', label: 'Corps' },
    { id: 'rightArm', label: 'Bras droit' }, { id: 'leftArm', label: 'Bras gauche' },
    { id: 'rightLeg', label: 'Jambe droite' }, { id: 'leftLeg', label: 'Jambe gauche' },
]);

export function strengthBonus(data) {
    return Math.floor(((Number(data?.carac?.f?.base) || 0) + (Number(data?.carac?.f?.adv) || 0)) / 10);
}

export function equipmentFormula(formula, data) {
    const text = String(formula || '').replace(/^=\s*/u, '').replace(/^\+\s*(?=BF)/iu, '').trim();
    const compact = text.replace(/\*+$/u, '').toUpperCase().replace(/\s/gu, '').replace(/[×X]/gu, '*');
    let value = null;
    if (/^[+-]?[0-9]+$/u.test(compact)) value = Number(compact);
    else {
        const match = compact.match(/^BF(?:([+*-])([0-9]+))?$/u);
        if (match) {
            const bf = strengthBonus(data);
            const n = Number(match[2] || 0);
            value = match[1] === '+' ? bf + n : match[1] === '-' ? bf - n : match[1] === '*' ? bf * n : bf;
        }
    }
    const signed = /^[+-]/u.test(compact) && value >= 0 ? `+${value}` : String(value);
    return { text, value, label: value === null ? text || 'À confirmer' : /BF/iu.test(text) ? `${text} = ${value}` : signed };
}

export function armourLayer(item) {
    if (item.layer === 'leather' || item.layer === 'bonus') return item.layer;
    return (item.keywords || []).some(word => word.id === 'flexible') ? 'flexible' : 'rigid';
}

export function armourProtection(items = []) {
    const armours = items.filter(item => item.kind === 'armour');
    const shields = items.filter(item => item.kind === 'shield');
    const shield = shields.filter(item => Number.isInteger(item.ap)).sort((a, b) => b.ap - a.ap)[0] || null;
    const locations = HIT_LOCATIONS.map(location => {
        const covered = armours.filter(item => item.locations?.includes(location.id));
        const counted = [];
        const ignored = [];
        const layers = new Map();
        for (const item of covered) {
            if (!Number.isInteger(item.ap)) { ignored.push({ item, reason: 'PA à préciser par le MJ' }); continue; }
            const layer = armourLayer(item);
            // Les copies d'un même bonus magique ne le multiplient pas.
            const key = layer === 'bonus' ? `bonus:${item.baseId}` : layer;
            const existing = layers.get(key);
            if (!existing || item.ap > existing.ap) {
                if (existing) ignored.push({ item: existing, reason: 'Une autre pièce de cette couche protège davantage' });
                layers.set(key, item);
            } else ignored.push({ item, reason: 'Cette couche est déjà comptée' });
        }
        counted.push(...layers.values());
        const ap = counted.reduce((sum, item) => sum + item.ap, 0);
        const conditional = counted.filter(item => item.keywords?.some(word => ['partielle', 'points-faibles'].includes(word.id)));
        return { ...location, ap, counted, ignored, conditional };
    });
    return { locations, shield, shields };
}

/** `keptKeywords` : identifiants hors référentiel tolérés (ceux déjà portés par l'objet modifié) ; absent, tout mot clé bien formé est conservé (import). */
export function validateEquipmentItem(item, catalogue, { keptKeywords = null } = {}) {
    const invalid = message => { throw Object.assign(new Error(message), { code: 'invalid-argument' }); };
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid('Objet d’équipement invalide');
    const keys = ['id', 'baseId', 'catalogVersion', 'kind', 'name', 'category', 'damage', 'reach', 'range', 'ap', 'locations', 'layer', 'keywords', 'notes', 'source', 'custom'];
    if (Object.keys(item).some(key => !keys.includes(key))) invalid('Champ d’équipement non pris en charge');
    for (const key of ['id', 'baseId', 'catalogVersion', 'name', 'category', 'damage', 'reach', 'range', 'notes', 'source']) {
        if (typeof item[key] !== 'string' || item[key].length > (['notes', 'source'].includes(key) ? 5000 : 300)) invalid(`Champ ${key} invalide`);
    }
    if (!item.id || !item.baseId || !item.name.trim() || !/^[A-Za-z0-9_:-]+$/u.test(item.id)) invalid('Identité de l’objet invalide');
    if (!['weapon', 'armour', 'shield', 'ammunition'].includes(item.kind) || typeof item.custom !== 'boolean') invalid('Type d’équipement invalide');
    if (item.ap !== null && (!Number.isSafeInteger(item.ap) || item.ap < 0 || item.ap > 100)) invalid('PA invalides');
    if (!['leather', 'flexible', 'rigid', 'bonus', 'none'].includes(item.layer)) invalid('Couche d’armure invalide');
    if (!Array.isArray(item.locations) || item.locations.length > 6 || new Set(item.locations).size !== item.locations.length
        || item.locations.some(id => !HIT_LOCATIONS.some(location => location.id === id))) invalid('Localisations invalides');
    if (!Array.isArray(item.keywords) || item.keywords.length > 60 || item.keywords.some(word => !word || typeof word !== 'object' || Array.isArray(word))
        || new Set(item.keywords.map(word => word.id)).size !== item.keywords.length) invalid('Mots clés invalides');
    // Un mot clé retiré du référentiel reste porté par l'objet ; seul un mot clé connu impose son paramètre.
    for (const word of item.keywords) {
        const definition = catalogue?.keywords?.find(entry => entry.id === word.id);
        if (typeof word.id !== 'string' || !/^[a-z0-9-]{1,100}$/u.test(word.id) || Object.keys(word).some(key => !['id', 'parameter'].includes(key))
            || typeof word.parameter !== 'string' || word.parameter.length > 100 || (definition && !definition.parameter && word.parameter)) invalid('Mot clé ou paramètre invalide');
        if (!definition && keptKeywords && !keptKeywords.has(word.id)) invalid(`Mot clé hors référentiel : ${word.id}`);
    }
    return item;
}

export function applyEquipmentCommand(data, command, context, catalogue) {
    if (context.role !== 'mj') throw Object.assign(new Error('Équipement réservé au MJ'), { code: 'permission-denied' });
    const payload = command.payload;
    if (Object.keys(payload).some(key => !['action', 'id', 'item', 'reason', 'before'].includes(key)) || !['add', 'update', 'remove'].includes(payload.action)) {
        throw Object.assign(new Error('Commande d’équipement invalide'), { code: 'invalid-argument' });
    }
    const rows = Array.isArray(data.equipment) ? data.equipment : [];
    const id = payload.action === 'add' ? `${command.operationId}:equipment` : payload.id;
    const existing = rows.find(row => row.id === id);
    if (payload.action !== 'add' && !existing) throw Object.assign(new Error('Objet introuvable'), { code: 'not-found' });
    const canonical = value => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row)
        ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row);
    if (payload.action !== 'add' && canonical(payload.before) !== canonical(existing)) {
        throw Object.assign(new Error('Cet objet a changé depuis son ouverture. Fermez puis rouvrez son détail.'), { code: 'aborted' });
    }
    let item;
    if (payload.action !== 'remove') {
        item = globalThis.structuredClone(validateEquipmentItem({ ...payload.item, id }, catalogue,
            { keptKeywords: new Set((existing?.keywords || []).map(word => word.id)) }));
        if (rows.length >= 500 && payload.action === 'add') throw Object.assign(new Error('La fiche contient déjà 500 objets'), { code: 'resource-exhausted' });
    }
    const next = payload.action === 'add' ? [...rows, item] : payload.action === 'remove' ? rows.filter(row => row.id !== id) : rows.map(row => row.id === id ? item : row);
    return { data: { ...data, equipment: next }, result: { kind: 'equipment', id },
        summary: { kind: 'equipment', label: `${{ add: 'Ajout', update: 'Modification', remove: 'Retrait' }[payload.action]} : ${item?.name || existing.name}`.slice(0, 200), target: (item?.name || existing.name).slice(0, 200) } };
}

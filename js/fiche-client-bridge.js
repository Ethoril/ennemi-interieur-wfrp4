let adapter = Object.freeze({ localDataChanged: () => {} });
const PATCH_SIMPLE = [
    'nom', 'race', 'blessuresAct', 'resilience', 'determination', 'chance', 'destin', 'corruption', 'possessions',
];
const pathSegment = value => encodeURIComponent(value).replaceAll('.', '%2E');

function diffAllowedPaths(base, next, existingDraftPaths = []) {
    const changes = {};
    const forced = new Set(existingDraftPaths);
    for (const path of PATCH_SIMPLE) {
        if ((forced.has(path) || JSON.stringify(base?.[path] ?? null) !== JSON.stringify(next?.[path] ?? null))
            && next?.[path] != null) changes[path] = next[path];
    }
    for (const path of ['section-sorts', 'section-prieres']) {
        const oldValue = base?.optVisible?.[path] ?? false;
        const newValue = next?.optVisible?.[path] ?? false;
        if (oldValue !== newValue || forced.has(`optVisible.${path}`)) changes[`optVisible.${path}`] = newValue;
    }
    const basicSpecKeys = new Set([...Object.keys(base?.basicSpecs || {}), ...Object.keys(next?.basicSpecs || {})]);
    for (const key of basicSpecKeys) {
        const path = `basicSpecs.${pathSegment(key)}`;
        const value = next?.basicSpecs?.[key];
        if (value != null && ((base?.basicSpecs?.[key] ?? null) !== value || forced.has(path))) changes[path] = value;
    }
    const careerIds = new Set([...Object.keys(base?.chosenVariants || {}), ...Object.keys(next?.chosenVariants || {})]);
    for (const careerId of careerIds) {
        const ranks = new Set([...Object.keys(base?.chosenVariants?.[careerId] || {}), ...Object.keys(next?.chosenVariants?.[careerId] || {})]);
        for (const rank of ranks) {
            const path = `chosenVariants.${pathSegment(careerId)}.${pathSegment(rank)}`;
            const title = next?.chosenVariants?.[careerId]?.[rank];
            if (title != null && ((base?.chosenVariants?.[careerId]?.[rank] ?? null) !== title || forced.has(path))) {
                changes[path] = title;
            }
        }
    }
    for (const root of ['careers', 'skillsAdvanced', 'talentsAcq', 'talentsAvail', 'sorts', 'prieres']) {
        const oldRows = new Map((Array.isArray(base?.[root]) ? base[root] : []).filter(row => row?.id).map(row => [row.id, row]));
        for (const row of Array.isArray(next?.[root]) ? next[root] : []) {
            if (!row?.id || !Object.hasOwn(row, 'note')) continue;
            const path = `${root}.${pathSegment(row.id)}.note`;
            if ((oldRows.get(row.id)?.note ?? null) !== row.note || forced.has(path)) changes[path] = row.note;
        }
    }
    return changes;
}

export function createFichePatchAdapter(controller, { onStatus = () => {} } = {}) {
    function stageData(data) {
        const current = controller.getState();
        if (!current || !['ready', 'saving', 'awaiting-snapshot', 'command-pending'].includes(current.phase)) return { status: 'ignored' };
        const changes = diffAllowedPaths(current.envelope?.data || {}, data, controller.getDraftPaths?.() || []);
        if (!Object.keys(changes).length) return { status: 'empty' };
        const staged = controller.stagePatch(changes);
        if (!staged.ok) {
            onStatus('Modification non autorisée', 'error');
            return { status: 'rejected' };
        }
        return { status: 'staged' };
    }
    return Object.freeze({
        stageData,
        async localDataChanged(data) {
            const staged = stageData(data);
            if (staged.status === 'ignored' || staged.status === 'rejected') return staged;
            if (staged.status === 'empty' && !controller.getState().hasDraft) return staged;
            try {
                const result = await controller.submitPatch();
                if (result.status === 'blocked' && result.reason === 'command-pending') return result;
                if (result.status === 'retry-required') onStatus('Enregistrement incertain — utiliser « Réessayer »', 'error');
                return result;
            } catch (error) {
                const code = String(error?.code || '').split('/').at(-1);
                if (['unavailable', 'deadline-exceeded', 'internal', 'unknown'].includes(code)) {
                    onStatus('Enregistrement incertain — utiliser « Réessayer »', 'error');
                }
                throw error;
            }
        },
    });
}

export function configureFicheClientBridge(nextAdapter) {
    if (!nextAdapter || typeof nextAdapter.localDataChanged !== 'function') throw new TypeError('Adaptateur client fiche invalide');
    adapter = nextAdapter;
}

export function stageFicheDraft(data) { return adapter.stageData?.(data) || { status: 'ignored' }; }
export function cloudSave(data) { return adapter.localDataChanged(data); }

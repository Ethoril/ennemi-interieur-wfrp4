const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(location.hostname)) {
    document.querySelector('.page-container').replaceChildren(Object.assign(document.createElement('p'), {
        textContent: 'La recette à dépôt fictif est disponible uniquement en local.'
    }));
    throw new Error('Faux dépôt QA interdit hors localhost');
}

const [{ ficheLoadCloud, setFicheRole, setPublishedFicheCatalogue }, { createFicheController }, { createFicheDraftStore }, bridge, sessionModule] = await Promise.all([
    import('../../js/fiche.js'),
    import('../../js/fiche-controller.js'),
    import('../../js/fiche-draft-store.js'),
    import('../../js/fiche-client-bridge.js'),
    import('../../js/fiche-session-view.js'),
]);
const { configureFicheClientBridge, createFichePatchAdapter } = bridge;
const [commandModule, careers, skills, ruleCatalog] = await Promise.all([
    import('../../js/fiche/commands.js'),
    fetch('../../js/data/careers.json').then(response => response.json()),
    fetch('../../js/data/skills.json').then(response => response.json()),
    fetch('../../js/data/fiche-catalog.json').then(response => response.json()),
]);
const commandEngine = commandModule.createFicheCommandEngine({
    careers, skills, spells: { spells: ruleCatalog.spells, miracles: ruleCatalog.miracles },
    catalogVersion: ruleCatalog.catalogVersion,
});

const testData = () => ({
    nom: 'Personnage témoin QA', race: 'humain', carriere: 'Agitateur', rang: '1',
    blessuresAct: '0', resilience: '0', determination: '0', chance: '0', destin: '0', corruption: '0',
    possessions: 'Équipement fictif uniquement',
    carac: Object.fromEntries(['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'].map(key => [key, { base: 30, adv: 0 }])),
    skillsBasic: { 'Calme': 0, 'Corps à corps (Base)': 0 },
    skillsAdvanced: [{ id: 'qa:skill.row', nom: 'Savoir (QA)', carac: 'int', adv: 0, note: 'Ligne fictive' }],
    careers: [{ id: 'qa:career.row', nom: 'Carrière historique QA', rang: 1, note: 'Note fictive' }],
    talentsAcq: [], talentsAvail: [], sorts: [], prieres: [],
    xpLog: [{ id: 'qa:gain.row', kind: 'gain', raison: 'Session QA fictive', montant: 120 }],
    customSpecs: {}, basicSpecs: {}, customTalents: {}, chosenVariants: {}, careerOverrides: {},
    optVisible: { 'section-sorts': false, 'section-prieres': false },
});

let current = { schemaVersion: 2, revision: 1, tombstone: false, data: testData() };
const activeFixture = globalThis.structuredClone(current);
const listeners = new Set();
const operations = new Map();
let online = true;
let delayNextResponse = false;
let releaseResponse = null;
const repository = {
    subscribe(_charId, next) {
        listeners.add(next);
        next(current
            ? { exists: true, envelope: globalThis.structuredClone(current) }
            : { exists: false, envelope: null });
        return () => listeners.delete(next);
    },
    async execute(command) {
        if (delayNextResponse) {
            delayNextResponse = false;
            await new Promise(resolve => { releaseResponse = resolve; });
            releaseResponse = null;
        }
        if (operations.has(command.operationId)) return operations.get(command.operationId);
        const data = globalThis.structuredClone(current?.data || {});
        if (command.type === 'patch') {
            for (const [path, value] of Object.entries(command.payload.changes)) {
                const [root, child, field] = path.split('.').map(part => decodeURIComponent(part));
                if (field === 'note') {
                    data[root] = data[root].map(row => row.id === child ? { ...row, note: value } : row);
                } else if (field) {
                    data[root] = { ...(data[root] || {}), [child]: { ...(data[root]?.[child] || {}), [field]: value } };
                } else if (child) {
                    data[root] = { ...(data[root] || {}), [child]: value };
                } else data[root] = value;
            }
        } else if (command.type === 'reset') {
            current = { schemaVersion: 2, revision: current.revision + 1, tombstone: true, data: {} };
        } else if (command.type === 'import') {
            current = {
                schemaVersion: 2,
                revision: (current?.revision || 0) + 1,
                tombstone: false,
                data: globalThis.structuredClone(command.payload.data),
            };
        } else {
            const applied = commandEngine.applyCommand(data, command, {
                uid: 'fixture-user', role: controller.getState()?.role,
            });
            current = { schemaVersion: 2, revision: current.revision + 1, tombstone: false, data: applied.data };
        }
        if (command.type === 'patch') current = { schemaVersion: 2, revision: current.revision + 1, tombstone: false, data };
        const receipt = { operationId: command.operationId, revision: current.revision };
        operations.set(command.operationId, receipt);
        for (const next of listeners) next({ exists: true, envelope: globalThis.structuredClone(current) });
        return receipt;
    },
};

const stateEl = document.getElementById('fiche-qa-state');
let renderSequence = 0;
const controller = createFicheController({
    repository,
    draftStore: createFicheDraftStore({ storage: globalThis.localStorage }),
    isOnline: () => online,
    makeOperationId: () => `qa-${globalThis.crypto.randomUUID()}`,
    onChange: state => {
        const sequence = ++renderSequence;
        stateEl.textContent = `${state.phase} · révision ${state.revision ?? '—'} · ${state.role || '—'}`;
        sessionView.render(state);
        const allowImport = state.role === 'mj' && ['missing', 'tombstone'].includes(state.phase);
        if (state.phase === 'missing' && state.role === 'mj') {
            void ficheLoadCloud({}, () => sequence === renderSequence && controller.getState() === state)
                .then(rendered => {
                    if (rendered && sequence === renderSequence) setFicheRole('readonly', { allowImport: true });
                });
        } else if (state.data && ['ready', 'saving', 'awaiting-snapshot', 'command-pending', 'tombstone'].includes(state.phase)) {
            void ficheLoadCloud(state.data, () => sequence === renderSequence && controller.getState() === state)
                .then(rendered => {
                    if (rendered && sequence === renderSequence) {
                        setFicheRole(allowImport ? 'readonly' : state.role, { allowImport });
                    }
                });
        }
    },
});
const sessionView = sessionModule.createFicheSessionView({
    getContainer: () => document.getElementById('fiche-session-view'),
    controller,
});
configureFicheClientBridge(createFichePatchAdapter(controller, {
    onStatus: message => { stateEl.textContent = message; },
}));

function enterRole(role) {
    controller.setSession({ uid: 'fixture-user', charId: 'test', role });
    document.getElementById('fiche-login-wall').style.display = 'none';
    document.getElementById('fiche-content-section').style.display = '';
}

document.getElementById('qa-player')?.addEventListener('click', () => enterRole('joueur'));
document.getElementById('qa-mj')?.addEventListener('click', () => enterRole('mj'));
document.getElementById('qa-signout')?.addEventListener('click', () => {
    controller.setSession(null);
    document.getElementById('fiche-content-section').style.display = 'none';
    document.getElementById('fiche-login-wall').style.display = '';
});
document.getElementById('qa-offline')?.addEventListener('click', event => {
    online = !online;
    event.currentTarget.textContent = online ? 'Réseau indisponible' : 'Rétablir le réseau';
    stateEl.textContent = online ? 'Réseau fictif rétabli' : 'Réseau fictif indisponible';
    globalThis.dispatchEvent(new Event(online ? 'online' : 'offline'));
});
document.getElementById('qa-remote')?.addEventListener('click', () => {
    current = { ...current, revision: current.revision + 1, data: { ...current.data, race: current.data.race === 'humain' ? 'nain' : 'humain' } };
    for (const next of listeners) next({ exists: true, envelope: globalThis.structuredClone(current) });
});
document.getElementById('qa-remote-cc')?.addEventListener('click', () => {
    const nextData = globalThis.structuredClone(current.data);
    nextData.carac.cc.base = Number(nextData.carac.cc.base || 0) + 1;
    current = { ...current, revision: current.revision + 1, data: nextData };
    for (const next of listeners) next({ exists: true, envelope: globalThis.structuredClone(current) });
});
document.getElementById('qa-delay')?.addEventListener('click', () => {
    delayNextResponse = true;
    stateEl.textContent = 'La prochaine réponse du faux dépôt est suspendue.';
});
document.getElementById('qa-release')?.addEventListener('click', () => {
    releaseResponse?.();
    if (!releaseResponse) stateEl.textContent = 'Aucune réponse retardée à libérer.';
});
document.getElementById('qa-conflict')?.addEventListener('click', () => {
    controller.stagePatch({ nom: 'Nom local QA' });
    current = { ...current, revision: current.revision + 1, data: { ...current.data, nom: 'Nom distant QA' } };
    for (const next of listeners) next({ exists: true, envelope: globalThis.structuredClone(current) });
});
document.getElementById('qa-missing')?.addEventListener('click', () => {
    if (controller.getState()?.role !== 'mj') {
        stateEl.textContent = 'Passez en mode MJ pour tester une fiche absente.';
        return;
    }
    current = null;
    for (const next of listeners) next({ exists: false, envelope: null });
});
document.getElementById('qa-reset')?.addEventListener('click', async () => {
    if (controller.getState()?.role !== 'mj') {
        stateEl.textContent = 'Passez en mode MJ pour tester la réinitialisation.';
        return;
    }
    if (!current) {
        stateEl.textContent = 'La fiche est absente. Réactivez-la ou importez un JSON fictif.';
        return;
    }
    try { await controller.executeOnlineCommand('reset', { reason: 'Recette fictive : test du flux reset/import' }); }
    catch { /* statut du contrôleur */ }
});
document.getElementById('qa-active')?.addEventListener('click', () => {
    if (controller.getState()?.role !== 'mj') {
        stateEl.textContent = 'Passez en mode MJ pour réactiver la fiche fictive.';
        return;
    }
    current = { ...globalThis.structuredClone(activeFixture), revision: (current?.revision || 0) + 1 };
    for (const next of listeners) next({ exists: true, envelope: globalThis.structuredClone(current) });
});

globalThis.ficheQa = Object.freeze({ controller, getEnvelope: () => globalThis.structuredClone(current) });
globalThis.ficheController = controller;
enterRole('joueur');

// Fake published catalogue only: verify labels refresh without changing stored keys or player rights.
document.getElementById('qa-catalogue')?.addEventListener('click', async () => {
    const catalogue = await fetch('../../js/catalogue/referentiel-public.json').then(response => response.json());
    const calm = catalogue.skills.entries.find(entry => entry.nom === 'Calme');
    const lore = catalogue.skills.entries.find(entry => entry.nom === 'Savoir (Guerre)');
    calm.nom = 'Sang-froid';
    catalogue.skills.aliases.push({ label: 'Calme', targetId: calm.id });
    catalogue.skills.aliases.push({ label: 'Savoir (QA)', targetId: lore.id });
    catalogue.catalogVersion = 'fixture-main-forms';
    const before = JSON.stringify(current);
    setPublishedFicheCatalogue(catalogue);
    stateEl.textContent = JSON.stringify(current) === before
        ? 'Noms principaux affichés : Sang-froid et Savoir (Guerre). Données fictives inchangées.'
        : 'Échec : les données fictives ont changé.';
});

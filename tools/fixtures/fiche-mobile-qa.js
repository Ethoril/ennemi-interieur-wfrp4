import { observeMobileNavigation } from '../../js/mobile/navigation-layout.js';
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(location.hostname)) {
    document.body.replaceChildren(Object.assign(document.createElement('p'), {
        textContent: 'La recette à dépôt fictif est disponible uniquement en local.',
    }));
    throw new Error('Faux dépôt QA interdit hors localhost');
}

const [{ createFicheDetailView }, { createRouter, parseRoute, ROUTE_NAMES }, { loadFicheCatalogue }, { FICHE_SCHEMA_VERSION }] = await Promise.all([
    import('../../js/mobile/views/fiche-detail.js'),
    import('../../js/mobile/router.js'),
    import('../../js/mobile/fiche-catalogue.js'),
    import('../../js/fiche-schema.js'),
]);
const catalogue = await loadFicheCatalogue();
observeMobileNavigation({ app: document.getElementById('m-app'), navigation: document.getElementById('m-navigation') });

const CARACS = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const BASES = [28, 30, 25, 30, 28, 32, 27, 33, 29, 35];
const ADVANCES = [3, 4, 3, 3, 2, 4, 2, 5, 3, 6];
const previewEquipment = new URLSearchParams(location.search).has('qa-equipment')
    ? ['Hallebarde Haut Elfe', 'Bouclier', 'Veste de cuir', 'Cotte de mailles', 'Plastron']
        .map(name => catalogue.equipmentCatalogue.items.find(item => item.name === name)).filter(Boolean)
        .map((item, index) => ({ ...globalThis.structuredClone(item), id: `qa_equipment_${index}` })) : null;
const testData = () => ({
    nom: 'Ilsa Brandt', race: 'humain', carriere: 'Agitateur', rang: '1',
    blessuresAct: '9', resilience: '1', determination: '1', chance: '1', destin: '2', corruption: '0',
    possessions: 'Pamphlets, une plume, un manteau usé.',
    carac: Object.fromEntries(CARACS.map((key, index) => [key, { base: BASES[index], adv: ADVANCES[index] }])),
    skillsBasic: { Charme: 5, Ragot: 5, Marchandage: 3, Esquive: 2, Calme: 0, 'Corps à corps (Base)': 1 },
    skillsAdvanced: [
        { id: 'qa-skill-politique', nom: 'Savoir (Politique)', carac: 'int', adv: 5, note: '' },
        { id: 'qa-skill-imprimerie', nom: 'Métier (Imprimerie)', carac: 'dex', adv: 2, note: '' },
        { id: 'qa-skill-langue', nom: 'Langue (Reikspiel)', carac: 'int', adv: 3, note: '' },
    ],
    careers: [{ id: 'qa-career-1', nom: 'Agitateur', rang: 1, note: '' }],
    talentsAcq: [{ id: 'qa-talent-sociable', nom: 'Sociable', note: '' }],
    talentsAvail: [], sorts: [], prieres: [],
    xpLog: [
        { id: 'qa-xp-1', kind: 'gain', raison: 'Création du personnage', montant: 250 },
        { id: 'qa-xp-2', kind: 'gain', raison: 'Séance 1', montant: 150 },
        { id: 'qa-xp-3', kind: 'gain', raison: 'Séance 2', montant: 150 },
        { id: 'qa-xp-4', kind: 'gain', raison: 'Séance 3', montant: 100 },
        { id: 'qa-xp-5', kind: 'purchase', type: 'Caractéristique', achat: 'Sociabilité +6', cout: 155 },
        { id: 'qa-xp-6', kind: 'purchase', type: 'Caractéristique', achat: 'Intelligence +5', cout: 125 },
        { id: 'qa-xp-7', kind: 'purchase', type: 'Caractéristique', achat: 'Capacité de Tir +4', cout: 100 },
        { id: 'qa-xp-8', kind: 'purchase', type: 'Compétence', achat: 'Charme +5', cout: 50 },
        { id: 'qa-xp-9', kind: 'purchase', type: 'Talent', achat: 'Sociable', cout: 100 },
    ],
    customSpecs: {}, basicSpecs: { 'Corps à corps (Base)': 'Escrime' }, customTalents: {}, chosenVariants: {}, careerOverrides: {},
    optVisible: { 'section-sorts': false, 'section-prieres': false },
    ...(previewEquipment ? { equipment: previewEquipment } : {}),
});

let current = { schemaVersion: FICHE_SCHEMA_VERSION, revision: 1, tombstone: false, data: testData() };
const snapshots = new Set();
const operations = new Map();
const equipmentModels = new Map();
const modelListeners = new Set();
// Sorts et prières fictifs pour l'onglet Sorts (bouton « Sorts »), absents de la fiche par défaut.
const SPELLS = {
    sorts: [{ id: 'qa-spell-1', nom: 'Couronne de Flammes', vent: 'Aqshy - Rouge - Domaine du Feu', cn: 8, portee: 'Vous', duree: '(Bonus de Force Mentale) Rounds', resume: 'Vous focalisez Aqshy en une couronne de feu.' }],
    prieres: [{ id: 'qa-prayer-1', nom: 'Appel à la Fureur', type: 'Miracle', resume: 'Portée : (Sociabilité) mètres — Vos alliés reçoivent la Haine.' }],
};
// Comme le serveur : le moteur valide le patch, puis les chemins sont appliqués (basicSpecs.<clé> ou champ simple).
const applyPatch = (data, changes) => {
    const next = { ...data };
    for (const [path, value] of Object.entries(changes)) {
        const [root, key] = path.split('.').map(decodeURIComponent);
        if (root === 'favoriteSkills') { next.favoriteSkills = { ...next.favoriteSkills, [key]: value }; continue; }
        if (root !== 'basicSpecs' || !key) { next[path] = value; continue; }
        const specs = { ...next.basicSpecs, [key]: value };
        if (value === '') delete specs[key];
        next.basicSpecs = specs;
    }
    return next;
};
let role = 'joueur';
let refuseNext = false;
const stateEl = document.getElementById('qa-state');
const publishSnapshot = () => {
    for (const listener of snapshots) listener({ exists: true, envelope: globalThis.structuredClone(current) });
};

// Faux dépôt : applique les commandes avec le même moteur que le serveur (catalogue chargé comme l'application).
const repository = {
    subscribeEquipmentModels(next) { modelListeners.add(next); next([...equipmentModels.values()]); return () => modelListeners.delete(next); },
    async saveEquipmentModel(id, item) { equipmentModels.set(id, { id, item: structuredClone(item) }); for (const next of modelListeners) next([...equipmentModels.values()]); },
    subscribe(_charId, next) {
        snapshots.add(next);
        next({ exists: true, envelope: globalThis.structuredClone(current) });
        return () => snapshots.delete(next);
    },
    subscribePublicCatalogue(next) { next(null); return () => {}; },
    async execute(command) {
        if (refuseNext) {
            refuseNext = false;
            throw Object.assign(new Error('Prix modifié'), {
                code: 'failed-precondition', details: { kind: 'price-changed', expectedCost: 0, currentCost: 0 },
            });
        }
        if (operations.has(command.operationId)) return operations.get(command.operationId);
        const data = globalThis.structuredClone(current.data);
        if (command.type === 'patch') catalogue.getEngine().validatePatch(data, command.payload);
        const applied = command.type === 'patch'
            ? { data: applyPatch(data, command.payload.changes) }
            : catalogue.getEngine().applyCommand(data, command, { uid: 'qa-user', role });
        current = { ...current, revision: current.revision + 1, data: applied.data };
        const receipt = { operationId: command.operationId, revision: current.revision };
        operations.set(command.operationId, receipt);
        publishSnapshot();
        return receipt;
    },
};

const accessWatchers = new Set();
const accessValue = () => ({
    user: { uid: 'qa-user' },
    // ?qa-char=wren ouvre la même fiche fictive sous l'identifiant d'un PJ (silhouette d'armure).
    capabilities: { role, contribution: true, characterIds: ['test', new URLSearchParams(location.search).get('qa-char')].filter(Boolean) },
});
const client = {
    watch(listener) {
        accessWatchers.add(listener);
        listener(accessValue());
        return () => accessWatchers.delete(listener);
    },
};
const setRole = next => {
    role = next;
    for (const listener of accessWatchers) listener(accessValue());
    stateEl.textContent = `Rôle simulé : ${next}`;
};

// Coque minimale : mêmes éléments que app/index.html, décor de route réduit à la fiche.
const container = document.getElementById('m-main');
const title = document.getElementById('m-title');
const back = document.getElementById('m-back');
const headerAction = document.getElementById('m-header-action');
const routeStatus = document.getElementById('m-route-status');
const announce = message => { routeStatus.textContent = message; };
let currentView = null;
let router;
router = createRouter({
    windowRef: window,
    mountRoute: route => {
        if (route.name !== ROUTE_NAMES.FICHE) {
            container.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Écran hors recette.' }));
            return null;
        }
        return createFicheDetailView({
            container, documentRef: document, windowRef: window, route,
            navigationContainer: document.getElementById('m-navigation'),
            getClient: async () => client,
            signIn: async () => setRole('joueur'),
            loadRuntime: async () => ({ repository }),
            loadCatalogue: async () => catalogue,
            setTitle: text => { title.textContent = text; },
            navigate: target => router.navigate(target, { replace: true }),
            announce,
        });
    },
    announce,
    setScrollY: value => { container.scrollTop = value; },
    getScrollY: () => container.scrollTop,
    onRoute: (route, view) => {
        currentView = view;
        const bottomNav = document.querySelector('.m-bottom-nav');
        if (bottomNav) bottomNav.hidden = Boolean(document.querySelector('#m-navigation .m-fiche-tabs'));
        title.textContent = 'Fiche';
        back.hidden = route.name !== ROUTE_NAMES.FICHE;
        headerAction.hidden = route.name !== ROUTE_NAMES.FICHE;
    },
});
back.addEventListener('click', () => { stateEl.textContent = 'Retour vers « Mes fiches » (hors recette).'; });
headerAction.addEventListener('click', event => currentView?.openMenu?.(event.currentTarget));
if (parseRoute(location.hash).name !== ROUTE_NAMES.FICHE) history.replaceState({}, '', '#/fiches/test');
router.start();

document.getElementById('qa-player').addEventListener('click', () => setRole('joueur'));
document.getElementById('qa-mj').addEventListener('click', () => setRole('mj'));
document.getElementById('qa-offline').addEventListener('click', event => {
    // Le navigateur ne laisse pas forcer navigator.onLine : la vue suit les événements, pas la propriété.
    const offline = event.currentTarget.dataset.offline !== 'true';
    event.currentTarget.dataset.offline = String(offline);
    event.currentTarget.textContent = offline ? 'Rétablir le réseau' : 'Hors ligne';
    window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
    stateEl.textContent = offline ? 'Réseau fictif indisponible.' : 'Réseau fictif rétabli.';
});
document.getElementById('qa-refuse').addEventListener('click', () => {
    refuseNext = true;
    stateEl.textContent = 'La prochaine commande sera refusée par le faux serveur.';
});
document.getElementById('qa-theme').addEventListener('click', event => {
    const parchment = document.documentElement.dataset.theme !== 'parchment';
    document.documentElement.dataset.theme = parchment ? 'parchment' : 'dark';
    event.currentTarget.textContent = parchment ? 'Thème sombre' : 'Thème parchemin';
});
// Un gain du MJ, pour pouvoir tester les achats chers (rang, changement de carrière).
document.getElementById('qa-xp').addEventListener('click', () => {
    const data = { ...current.data, xpLog: [...current.data.xpLog, { id: `qa-gain-${current.revision}`, kind: 'gain', raison: 'Recette', montant: 500 }] };
    current = { ...current, revision: current.revision + 1, data };
    publishSnapshot();
});
document.getElementById('qa-spells').addEventListener('click', event => {
    const on = event.currentTarget.dataset.on !== 'true';
    event.currentTarget.dataset.on = String(on);
    event.currentTarget.textContent = on ? 'Retirer les sorts' : 'Ajouter des sorts';
    current = { ...current, revision: current.revision + 1, data: { ...current.data, ...(on ? SPELLS : { sorts: [], prieres: [] }) } };
    publishSnapshot();
});
// Sections facultatives du bureau (optVisible) : sorts et prières affichés sans en posséder, pour apprendre depuis la fiche.
document.getElementById('qa-sections').addEventListener('click', event => {
    const on = event.currentTarget.dataset.on !== 'true';
    event.currentTarget.dataset.on = String(on);
    event.currentTarget.textContent = on ? 'Désactiver sorts et miracles' : 'Activer sorts et miracles';
    const optVisible = { 'section-sorts': on, 'section-prieres': on };
    current = { ...current, revision: current.revision + 1, data: { ...current.data, optVisible } };
    publishSnapshot();
});
// Rang 4 d'Agitateur : liste « Savoir-vivre (au choix) » parmi les talents disponibles.
document.getElementById('qa-rank4').addEventListener('click', () => {
    current = { ...current, revision: current.revision + 1, data: { ...current.data, rang: '4' } };
    publishSnapshot();
});
document.getElementById('qa-reset').addEventListener('click', () => {
    current = { ...current, revision: current.revision + 1, data: testData() };
    operations.clear();
    publishSnapshot();
    document.getElementById('qa-spells').dataset.on = 'false';
    document.getElementById('qa-spells').textContent = 'Ajouter des sorts';
    document.getElementById('qa-sections').dataset.on = 'false';
    document.getElementById('qa-sections').textContent = 'Activer sorts et miracles';
    stateEl.textContent = 'Fiche fictive réinitialisée.';
});

globalThis.ficheMobileQa = Object.freeze({
    getEnvelope: () => globalThis.structuredClone(current),
    setEquipment: equipment => { current = { ...current, revision: current.revision + 1, data: { ...current.data, equipment } }; publishSnapshot(); },
    failUncertain: () => { const original = repository.execute; repository.execute = async cmd => { repository.execute = original; await original(cmd); throw Object.assign(new Error('Réponse réseau perdue'), { code: 'unavailable' }); }; },
});

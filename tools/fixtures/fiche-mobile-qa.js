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

const CARACS = ['cc', 'ct', 'f', 'e', 'i', 'ag', 'dex', 'int', 'fm', 'soc'];
const BASES = [28, 30, 25, 30, 28, 32, 27, 33, 29, 35];
const ADVANCES = [3, 4, 3, 3, 2, 4, 2, 5, 3, 6];
const testData = () => ({
    nom: 'Ilsa Brandt', race: 'humain', carriere: 'Agitateur', rang: '1',
    blessuresAct: '9', resilience: '1', determination: '1', chance: '1', destin: '2', corruption: '0',
    possessions: 'Pamphlets, une plume, un manteau usé.',
    carac: Object.fromEntries(CARACS.map((key, index) => [key, { base: BASES[index], adv: ADVANCES[index] }])),
    skillsBasic: { Charme: 5, Ragot: 5, Marchandage: 3, Esquive: 2, Calme: 0, 'Corps à corps (Base)': 1 },
    skillsAdvanced: [
        { id: 'qa-skill-politique', nom: 'Savoir (Politique)', carac: 'int', adv: 5, note: '' },
        { id: 'qa-skill-imprimerie', nom: 'Métier (Imprimerie)', carac: 'dex', adv: 2, note: '' },
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
});

let current = { schemaVersion: FICHE_SCHEMA_VERSION, revision: 1, tombstone: false, data: testData() };
const snapshots = new Set();
const operations = new Map();
let role = 'joueur';
let refuseNext = false;
const stateEl = document.getElementById('qa-state');
const publishSnapshot = () => {
    for (const listener of snapshots) listener({ exists: true, envelope: globalThis.structuredClone(current) });
};

// Faux dépôt : applique les commandes avec le même moteur que le serveur (catalogue chargé comme l'application).
const repository = {
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
        const applied = command.type === 'patch'
            ? { data: { ...data, ...command.payload.changes } } // champs simples seulement : suffisant pour la recette
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
    capabilities: { role, contribution: true, characterIds: ['test'] },
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
document.getElementById('qa-reset').addEventListener('click', () => {
    current = { ...current, revision: current.revision + 1, data: testData() };
    operations.clear();
    publishSnapshot();
    stateEl.textContent = 'Fiche fictive réinitialisée.';
});

globalThis.ficheMobileQa = Object.freeze({ getEnvelope: () => globalThis.structuredClone(current) });

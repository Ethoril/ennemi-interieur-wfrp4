import { db, functions } from '../firebase-init.js';
import { watchAuth, loginWithGoogle, logout } from '../auth.js';
import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { createFicheController } from '../fiche-controller.js';
import { createFicheDraftStore } from '../fiche-draft-store.js';
import { createFicheRepository } from '../fiche-repository.js';
import { createFicheSessionView } from '../fiche-session-view.js';
import { createPublishedCatalogueEngine } from '../fiche/published-catalogue-engine.js';

export async function loadBureauCatalogues() {
    const paths = ['data/careers.json', 'data/skills.json', 'data/fiche-catalog.json', 'catalogue/referentiel-public.json', 'catalogue/talents-sheet-snapshot.json'];
    const [careers, skills, spells, catalogue, talentSheetSnapshot] = await Promise.all(paths.map(async path => {
        const response = await fetch(new URL(`../${path}`, import.meta.url));
        if (!response.ok) throw new Error('Chargement du référentiel impossible.');
        return response.json();
    }));
    const makeEngine = published => ({ ...createPublishedCatalogueEngine({ catalogue: published, careers, skills, spells, talentSheetSnapshot }), ruleCatalog: spells });
    return { careers, engine: makeEngine(catalogue), makeEngine };
}

export function connectBureau({ charId, onState, onCatalogue }) {
    const repository = createFicheRepository({ db, doc, onSnapshot, collection, query, orderBy, limit, setDoc, deleteDoc, serverTimestamp,
        callCommand: httpsCallable(functions, 'executeFicheCommand'), callMigration: httpsCallable(functions, 'migrateFiche') });
    let sessionView;
    let uid = null;
    let stopCatalogue = () => {};
    let stopHistory = () => {};
    const controller = createFicheController({ repository, draftStore: createFicheDraftStore(), onChange: state => {
        onState(state);
        sessionView?.render(state);
    } });
    sessionView = createFicheSessionView({ getContainer: () => document.getElementById('fiche-session'), controller });
    document.getElementById('bureau-login').addEventListener('click', () => { void loginWithGoogle().catch(() => onState({ phase: 'error', error: 'Connexion impossible.' })); });
    document.getElementById('bureau-logout').addEventListener('click', () => { void logout(); });
    watchAuth((user, admin) => {
        stopCatalogue(); stopHistory();
        uid = user?.uid || null;
        document.getElementById('bureau-logout').hidden = !user;
        controller.setSession(user ? { uid, charId, role: admin ? 'mj' : 'joueur' } : null);
        if (user) {
            const expectedUid = uid;
            stopCatalogue = repository.subscribePublicCatalogue(catalogue => { if (uid === expectedUid && catalogue) onCatalogue(catalogue); }, () => {});
            stopHistory = repository.subscribeHistory(charId, entries => { if (uid === expectedUid) sessionView.setHistory(entries); }, () => {});
        }
    });
    const flush = () => { if (controller.getState().hasDraft && !controller.getState().pendingPatchOperationId) void controller.submitPatch().catch(() => {}); };
    globalThis.addEventListener('online', flush);
    globalThis.addEventListener('pagehide', () => { flush(); stopCatalogue(); stopHistory(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    return controller;
}

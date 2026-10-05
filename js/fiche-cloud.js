import { db, functions } from './firebase-init.js';
import { watchAuth, loginWithGoogle, logout } from './auth.js';
import {
    collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { createFicheController } from './fiche-controller.js';
import { createFicheDraftStore } from './fiche-draft-store.js';
import { createFicheRepository } from './fiche-repository.js';
import { configureFicheClientBridge, createFichePatchAdapter } from './fiche-client-bridge.js';
import { createFicheSessionView } from './fiche-session-view.js';
import { ficheLoadCloud, clearFicheView, setFicheRole, setPublishedFicheCatalogue } from './fiche.js';
import { esc } from './utils.js';

const CHAR_IDS = ['bhelgi', 'caelel', 'elysia', 'hellaya', 'wren', 'test'];
const charId = new URLSearchParams(window.location.search).get('char');
const mobileReturn = document.getElementById('fiche-mobile-return');
if (mobileReturn && new URLSearchParams(window.location.search).get('return') === 'mobile') mobileReturn.hidden = false;
if (!charId || !CHAR_IDS.includes(charId)) {
    alert('Aucun personnage valide spécifié. Redirection vers le groupe…');
    window.location.href = 'groupe.html';
    throw new Error('charId invalide');
}

const repository = createFicheRepository({
    db,
    doc,
    onSnapshot,
    collection,
    query,
    orderBy,
    limit,
    setDoc,
    deleteDoc,
    serverTimestamp,
    callCommand: httpsCallable(functions, 'executeFicheCommand'),
    callMigration: httpsCallable(functions, 'migrateFiche'),
});
const draftStore = createFicheDraftStore();
let renderFingerprint = '';
let authGeneration = 0;
let renderSequence = 0;
let unsubscribeAuxiliary = [];
let presenceTimer = null;
let presenceSessionId = null;

function setStatus(message, state = '') {
    const element = document.getElementById('fiche-cloud-status');
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state;
}

function showFiche() {
    const wall = document.getElementById('fiche-login-wall');
    const content = document.getElementById('fiche-content-section');
    if (wall) wall.style.display = 'none';
    if (content) content.style.display = '';
}

function showLoginWall(message = '') {
    const content = document.getElementById('fiche-content-section');
    const wall = document.getElementById('fiche-login-wall');
    if (content) content.style.display = 'none';
    if (wall) wall.style.display = '';
    const text = document.querySelector('.fiche-login-msg');
    if (text && message) text.textContent = message;
}

async function showControllerState(state) {
    const sequence = ++renderSequence;
    const expectedAuthGeneration = authGeneration;
    const bar = document.getElementById('fiche-auth-bar');
    const label = state.role === 'mj' ? 'Maître du Jeu' : 'Joueur';
    if (bar) bar.dataset.role = label;
    if (state.role) setFicheRole(['legacy-readonly', 'tombstone', 'missing'].includes(state.phase) ? 'readonly' : state.role, {
        allowImport: state.role === 'mj' && ['tombstone', 'missing'].includes(state.phase),
    });

    if (state.data && ['ready', 'saving', 'awaiting-snapshot', 'command-pending', 'legacy-readonly', 'tombstone'].includes(state.phase)) {
        const fingerprint = JSON.stringify([state.role, state.phase, state.revision, state.data]);
        if (fingerprint !== renderFingerprint) {
            let rendered;
            rendered = await ficheLoadCloud(state.data, () => sequence === renderSequence
                && expectedAuthGeneration === authGeneration && controller.getState() === state);
            if (!rendered || sequence !== renderSequence || expectedAuthGeneration !== authGeneration
                || controller.getState() !== state) return;
            renderFingerprint = fingerprint;
            if (state.role) setFicheRole(['legacy-readonly', 'tombstone', 'missing'].includes(state.phase) ? 'readonly' : state.role, {
                allowImport: state.role === 'mj' && ['tombstone', 'missing'].includes(state.phase),
            });
        }
        showFiche();
    }

    if (state.phase === 'signed-out') {
        clearFicheView();
        renderFingerprint = '';
        showLoginWall('Connexion requise pour accéder à la fiche.');
        return;
    }
    if (state.phase === 'loading') { showLoginWall('Vérification des accès…'); return; }
    if (state.phase === 'error') {
        if (state.error === 'permission-denied') showLoginWall('Vous n’avez pas l’autorisation d’accéder à cette fiche.');
        else showLoginWall('Chargement impossible. Réessayez plus tard.');
        return;
    }
    if (state.phase === 'missing') {
        if (state.role === 'mj') {
            const fingerprint = `missing:${state.role}`;
            if (renderFingerprint !== fingerprint) {
                const rendered = await ficheLoadCloud({}, () => sequence === renderSequence
                    && expectedAuthGeneration === authGeneration && controller.getState() === state);
                if (!rendered || sequence !== renderSequence || expectedAuthGeneration !== authGeneration) return;
                renderFingerprint = fingerprint;
            }
            setFicheRole('readonly', { allowImport: true });
            showFiche();
            setStatus('Fiche absente — import MJ requis pour l’initialiser', 'error');
            sessionView.render(state);
        } else showLoginWall('Cette fiche attend une initialisation par le Maître du Jeu.');
        return;
    }
    if (state.phase === 'legacy-readonly') {
        setStatus(state.role === 'mj' ? 'Fiche historique — migration requise' : 'Fiche historique — lecture seule', 'error');
        sessionView.render(state);
        return;
    }
    if (state.phase === 'tombstone') {
        setFicheRole('readonly', { allowImport: state.role === 'mj' });
        setStatus('Fiche réinitialisée — import MJ requis', 'error');
        sessionView.render(state);
        return;
    }
    if (state.draftPersistenceUnavailable && state.hasDraft) setStatus('Modification gardée en mémoire seulement — sauvegarde locale indisponible', 'error');
    else if (state.conflicts?.length) setStatus(`${state.conflicts.length} conflit(s) à résoudre`, 'error');
    else if (state.phase === 'saving') setStatus('Enregistrement…', 'saving');
    else if (state.phase === 'awaiting-snapshot') setStatus('Confirmation serveur en attente', 'saving');
    else if (state.phase === 'command-pending') setStatus('Commande en attente de confirmation', 'saving');
    else if (state.error) setStatus('Modification refusée : ' + String(state.error), 'error');
    else setStatus(state.hasDraft ? 'Brouillon local — enregistrer' : '☁ Synchronisé', state.hasDraft ? 'saving' : 'saved');
    sessionView.render(state);
    if (state.phase === 'ready' && state.hasDraft && !state.pendingPatchOperationId && !state.conflicts?.length) {
        globalThis.queueMicrotask(async () => {
            if (controller.getState() !== state) return;
            try {
                const result = await controller.submitPatch();
                if (result.status === 'retry-required') return;
            } catch { /* statut du contrôleur */ }
        });
    }
}

const controller = createFicheController({
    repository,
    draftStore,
    onChange: state => { void showControllerState(state); },
});
globalThis.ficheController = controller;
const sessionView = createFicheSessionView({ getContainer: () => document.getElementById('fiche-auth-bar'), controller });

function stopAuxiliary() {
    for (const unsubscribe of unsubscribeAuxiliary) unsubscribe();
    unsubscribeAuxiliary = [];
    clearInterval(presenceTimer);
    presenceTimer = null;
    const oldSessionId = presenceSessionId;
    presenceSessionId = null;
    if (oldSessionId) void repository.removePresence(charId, oldSessionId).catch(() => {});
    sessionView.setPresence([], null);
    sessionView.setHistory([]);
}

function startAuxiliary(user, role, generation) {
    stopAuxiliary();
    const sessionId = globalThis.crypto.randomUUID();
    presenceSessionId = sessionId;
    const rawName = typeof user.displayName === 'string' ? user.displayName.trim() : '';
    const displayName = rawName && !rawName.includes('@') ? rawName.slice(0, 80) : 'Compte connecté';
    const isCurrent = () => generation === authGeneration && presenceSessionId === sessionId;
    try {
        unsubscribeAuxiliary.push(repository.subscribePublicCatalogue(catalogue => {
            if (isCurrent() && catalogue) setPublishedFicheCatalogue(catalogue);
        }, () => {}));
        unsubscribeAuxiliary.push(repository.subscribePresence(charId, entries => {
            if (isCurrent()) sessionView.setPresence(entries, sessionId);
        }, () => {}));
        unsubscribeAuxiliary.push(repository.subscribeHistory(charId, entries => {
            if (isCurrent()) sessionView.setHistory(entries);
        }, () => {}));
    } catch { /* vues annexes facultatives si le client Firestore ne les expose pas */ }
    const heartbeat = async () => {
        if (!isCurrent()) return;
        try { await repository.heartbeatPresence(charId, sessionId, { uid: user.uid, displayName, role }); }
        catch { /* les règles Firestore restent l’autorité d’accès */ }
    };
    void heartbeat();
    presenceTimer = setInterval(() => { void heartbeat(); }, 20_000);
}

configureFicheClientBridge(createFichePatchAdapter(controller, { onStatus: (message, state) => {
    setStatus(message, state);
} }));


function bindReset(buttonId) {
    document.getElementById(buttonId)?.addEventListener('click', async () => {
        const reason = window.prompt('Motif de la réinitialisation de cette fiche :')?.trim();
        if (!reason) return;
        if (!window.confirm('La fiche deviendra une fiche réinitialisée récupérable par import MJ. Continuer ?')) return;
        try { await controller.executeOnlineCommand('reset', { reason }); }
        catch { /* statut du contrôleur */ }
    });
}


function bindSignIn(buttonId) {
    document.getElementById(buttonId)?.addEventListener('click', () => {
        loginWithGoogle().catch(error => {
            if (error.code !== 'auth/popup-closed-by-user') alert('Connexion impossible. Réessayez.');
        });
    });
}

watchAuth((user, isAdmin) => {
    const generation = ++authGeneration;
    const bar = document.getElementById('fiche-auth-bar');
    if (!bar) return;
    if (!user) {
        stopAuxiliary();
        controller.setSession(null);
        bar.innerHTML = '<button class="fiche-auth-btn" id="btn-cloud-signin">☁ Connexion Google</button>';
        bindSignIn('btn-cloud-signin');
        bindSignIn('btn-login-wall');
        showLoginWall('Connexion requise pour accéder à la fiche.');
        return;
    }
    bar.innerHTML = `<span class="fiche-auth-user">☁ ${esc(user.displayName || 'Compte connecté')}</span><span class="fiche-role-label">${isAdmin ? 'Maître du Jeu' : 'Joueur'}</span><span id="fiche-cloud-status" class="fiche-cloud-status" role="status" aria-live="polite"></span>${isAdmin ? '<a class="fiche-auth-btn" href="referentiels.html">Référentiels</a><button class="fiche-auth-btn" id="btn-reset-fiche">Réinitialiser</button>' : ''}<button class="fiche-auth-btn" id="btn-cloud-signout">Déconnexion</button>`;
    document.getElementById('btn-cloud-signout')?.addEventListener('click', () => { void logout(); });
    if (isAdmin) bindReset('btn-reset-fiche');
    showLoginWall('Vérification des accès…');
    startAuxiliary(user, isAdmin ? 'mj' : 'joueur', generation);
    controller.setSession({ uid: user.uid, charId, role: isAdmin ? 'mj' : 'joueur' });
    if (generation !== authGeneration) return;
});

globalThis.addEventListener('pagehide', stopAuxiliary);

globalThis.addEventListener('online', () => {
    const state = controller.getState();
    if (state.hasDraft && !state.conflicts?.length && !state.pendingPatchOperationId) {
        void controller.submitPatch().catch(() => {});
    }
});

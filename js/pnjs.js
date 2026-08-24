import { db, storage } from './firebase-init.js';
import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { collection, getDocs, updateDoc, getDoc, serverTimestamp, deleteDoc, doc, writeBatch, deleteField, query, where, arrayRemove, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import Cropper from 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.esm.js';
import { esc, cap, stripAccents } from './utils.js';
import { confirmAction } from './ui-confirm.js';
import { visiblePourJoueurs } from './visibility.js';
import { legacyPrivateNoteInfo, privateLoadCanApply } from './private-notes.js';
import { isCurrentLoad, isCurrentPanel, isCurrentGeneration } from './load-generation.js';
import { FIRESTORE_BATCH_LIMIT, cascadeWriteCount, publicRelationsForPnj } from './visibility-cascade.js';
import { uploadProtectedImage } from './protected-upload.js';
import { forgetProtectedUpload, rememberProtectedUpload } from './protected-upload-journal.js';
import { recoverPendingProtectedUploads } from './protected-upload-recovery.js';
import { createProtectedImageScope } from './protected-images.js';
import { cleanupUnreferencedImage } from './image-lifecycle.js';
import { safeStorageReference } from './storage-reference.js';
import { relationExists, relationId, reconcileFilterSets, panelIsStillCurrent, commitCascadeBatches, safeRelationColorValue } from './pnj-integrity.js';

// ── Constants ──────────────────────────────────────────────────
const STATUT_COLOR   = { 'allié': 'var(--statut-allie, #4caf7d)', 'ennemi': 'var(--statut-ennemi, #c94c4c)', 'neutre': 'var(--statut-neutre, #8a8a9a)' };
const VIVANT_OPACITY = { 'oui': 1, 'non': 0.35, 'inconnu': 0.65 };
const LINK_COLORS    = { 'allié': 'var(--link-allie, #4caf7d)', 'ennemi': 'var(--link-ennemi, #c94c4c)', 'famille': 'var(--link-famille, #c9a84c)', 'mentor': 'var(--link-mentor, #7a9ac9)', 'rival': 'var(--link-rival, #c97a4c)' };
const DIM_PALETTE    = [
    'var(--dim-0, #c9a84c)',
    'var(--dim-1, #4c8fc9)',
    'var(--dim-2, #c94c8e)',
    'var(--dim-3, #5bc994)',
    'var(--dim-4, #8e4cc9)',
    'var(--dim-5, #c97a4c)',
    'var(--dim-6, #4cc9c9)',
    'var(--dim-7, #9ac94c)',
    'var(--dim-8, #c9a87a)',
    'var(--dim-9, #7a9ac9)'
];
const CARD_W = 200, CARD_H = 72, PORT_R = 23, CARD_RX = 8;
const REL_PALETTE = [
    '#c9a84c','#e8a87c','#d4756b','#c4726e',
    '#c94c8e','#8e4cc9','#5a7ac9','#4c9ac9',
    '#4cc9c9','#4caf7d','#7ac94c','#a8965a',
    '#8a7a6a','#9a9aaa','#7a7a8a','#c9b89a',
];
const TABLE_COLS     = [
    { key: 'nom',         label: 'Nom' },
    { key: 'statut',      label: 'Statut' },
    { key: 'vivant',      label: 'Vivant' },
    { key: 'lieu',        label: 'Lieu' },
    { key: 'groupe',      label: 'Groupe' },
    { key: 'description', label: 'Description' },
];

// ── State ──────────────────────────────────────────────────────
const state = {
    isAdmin: false,
    nodes: [], links: [],
    active: { statut: new Set(), vivant: new Set(), lieu: new Set(), groupe: new Set() },
    searchQ: '',
    nodeSel: null, linkSel: null, linkLabelSel: null, simulation: null,
    colorBy: 'statut', dimColorMap: null,
    graphW: 800, graphH: 550,
    view: 'graph',
    sortCol: 'nom', sortDir: 1,
    editingId: null, panelId: null,
    croppedBlob: null,
    privateLoadId: 0,
    privateDocExists: false,
    privateLoadError: false,
};

let currentLoadId = 0;
let editorSession = 0;
let authSessionKey = '';
let currentPanelGeneration = 0;
let cropperInstance = null;
let cropGeneration = 0;
let cropSourceUrl = null;
let localPreviewUrl = null;
const PNJ_DELETION_KEY = 'wfrp:pnj-deletion:v1';
let pendingPnjCleanupRunning = false;
let globalPnjLockRecoveryRunning = false;
const imageScope = createProtectedImageScope(storage);
window.addEventListener('pagehide', () => imageScope.invalidate());

// ── Utils ──────────────────────────────────────────────────────
const getStatutColor = s => STATUT_COLOR[(s || '').toLowerCase()] || '#7a7a8a';
const getLinkColor   = s => LINK_COLORS[(s || '').toLowerCase()]  || stringToColor(s || '');
const safeRelationColor = (color, type) => safeRelationColorValue(color, getLinkColor(type));
const getNodeOpacity = d => VIVANT_OPACITY[(d.vivant || '').toLowerCase()] ?? 1;

function protectedImagePlaceholder(item, label) {
    if (!item.imagePath) return '';
    const text = item.imageState === 'access-denied' ? 'Image protégée inaccessible' : 'Image indisponible';
    return `<div class="protected-image-placeholder" role="status" aria-label="${esc(label)}">${text}</div>`;
}

function stringToColor(str) {
    let h = 0;
    for (const c of str) h = ((h << 5) - h) + c.charCodeAt(0);
    const isParchment = document.documentElement.getAttribute('data-theme') === 'parchment';
    const saturation = isParchment ? '65%' : '45%';
    const lightness = isParchment ? '30%' : '55%';
    return `hsl(${Math.abs(h) % 360}, ${saturation}, ${lightness})`;
}

function renderPalette(selectedColor, inputId) {
    return `<div class="rel-color-palette" data-input="${esc(inputId)}">${
        REL_PALETTE.map(c => `<button type="button" class="color-swatch${c === selectedColor ? ' active' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')
    }</div><input type="hidden" id="${esc(inputId)}" value="${esc(selectedColor)}">`;
}

function bezierPath(x1, y1, x2, y2, curveScale = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const curve = Math.min(len * 0.3, 80) * curveScale;
    // Point de contrôle basé sur les centres (pour une courbure cohérente)
    const mx = (x1 + x2) / 2 - dy / len * curve;
    const my = (y1 + y2) / 2 + dx / len * curve;

    const halfW = CARD_W / 2, halfH = CARD_H / 2;
    const edgeDist = (ux, uy) =>
        (Math.abs(ux) < 1e-6 ? halfH : Math.abs(uy) < 1e-6 ? halfW
            : Math.min(halfW / Math.abs(ux), halfH / Math.abs(uy))) + 3;

    // Recule le point source jusqu'à la bordure de sa carte (tangente en t=0)
    const sdx = mx - x1, sdy = my - y1, sl = Math.sqrt(sdx*sdx + sdy*sdy) || 1;
    const sux = sdx/sl, suy = sdy/sl;
    const sx = x1 + sux * edgeDist(sux, suy), sy = y1 + suy * edgeDist(sux, suy);

    // Recule le point cible jusqu'à la bordure de sa carte (tangente en t=1)
    const tdx = x2 - mx, tdy = y2 - my, tl = Math.sqrt(tdx*tdx + tdy*tdy) || 1;
    const tux = tdx/tl, tuy = tdy/tl;
    const ex = x2 - tux * edgeDist(tux, tuy), ey = y2 - tuy * edgeDist(tux, tuy);

    return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
}

async function uploadImage(blob, pnjId) {
    const result = await uploadProtectedImage(blob, { kind: 'portrait', ownerId: pnjId, contentType: 'image/webp' });
    const fileRef = ref(storage, result.imagePath);
    return { path: result.imagePath, ref: fileRef };
}

function portraitPathsForDeletionLock(pnjId, data) {
    return [...new Set([data?.imagePath, data?.imageUrl].map(reference => safeStorageReference(storage, reference))
        .filter(imageRef => imageRef?.fullPath.startsWith(`portraits/${pnjId}/`))
        .map(imageRef => imageRef.fullPath))].slice(0, 2);
}

function readPendingPnjDeletion() {
    try {
        const value = JSON.parse(localStorage.getItem(PNJ_DELETION_KEY) || 'null');
        return value && typeof value.id === 'string' && Array.isArray(value.images) ? value : null;
    } catch { return null; }
}

function writePendingPnjDeletion(value) {
    try {
        localStorage.setItem(PNJ_DELETION_KEY, JSON.stringify(value));
        return true;
    } catch { return false; }
}

function clearPendingPnjDeletion() {
    try { localStorage.removeItem(PNJ_DELETION_KEY); } catch { /* stockage local indisponible */ }
}

async function retryPendingPnjImageCleanup(pending) {
    if (!pending?.firestoreDone) return false;
    if (pendingPnjCleanupRunning) return false;
    const recoveryAuthKey = authSessionKey;
    pendingPnjCleanupRunning = true;
    try {
        for (const reference of pending.images) {
            await cleanupUnreferencedImage({
                db, storage, reference, ownerCollection: 'pnjs', ownerId: pending.id,
            });
        }
        clearPendingPnjDeletion();
        document.getElementById('pnj-cleanup-status')?.remove();
        return true;
    } catch (error) {
        if (!state.isAdmin || authSessionKey !== recoveryAuthKey) return false;
        const status = document.getElementById('pnj-cleanup-status') || document.createElement('p');
        status.id = 'pnj-cleanup-status';
        status.className = 'pnj-cleanup-status';
        status.textContent = 'Nettoyage du portrait à reprendre : vérifiez la connexion et réessayez.';
        document.getElementById('pnj-loading')?.after(status);
        console.warn('Nettoyage du portrait PNJ à reprendre.', { id: pending.id, error: error?.message });
        return false;
    } finally { pendingPnjCleanupRunning = false; }
}

function clearPnjAdminStatuses() {
    const deletionStatus = document.getElementById('pnj-deletion-status');
    if (deletionStatus) {
        deletionStatus.replaceChildren();
        deletionStatus.hidden = true;
    }
    document.getElementById('pnj-cleanup-status')?.remove();
}

function retryPendingPnjCleanupIfNeeded() {
    const pending = readPendingPnjDeletion();
    if (pending?.firestoreDone) void retryPendingPnjImageCleanup(pending);
}

function showPnjDeletionStatus(message, action) {
    const loading = document.getElementById('pnj-loading');
    const status = document.getElementById('pnj-deletion-status') || document.createElement('p');
    status.id = 'pnj-deletion-status';
    status.className = 'pnj-cleanup-status';
    status.hidden = false;
    status.textContent = message;
    status.querySelector('button')?.remove();
    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-ghost-sm';
        button.textContent = action.label;
        button.addEventListener('click', action.run, { once: true });
        status.append(' ', button);
    }
    loading?.after(status);
}

async function recoverGlobalPnjDeletionLock() {
    if (!state.isAdmin || globalPnjLockRecoveryRunning) return;
    const recoveryAuthKey = authSessionKey;
    const recoveryStillCurrent = () => state.isAdmin && authSessionKey === recoveryAuthKey;
    globalPnjLockRecoveryRunning = true;
    const lockRef = doc(db, 'integrity_locks', 'pnj-deletion');
    try {
        const lockSnapshot = await getDoc(lockRef);
        if (!recoveryStillCurrent()) return;
        if (!lockSnapshot.exists()) {
            document.getElementById('pnj-deletion-status')?.remove();
            return;
        }
        const lock = lockSnapshot.data() || {};
        const pnjId = typeof lock.pnjId === 'string' ? lock.pnjId : '';
        const pnjSnapshot = pnjId ? await getDoc(doc(db, 'pnjs', pnjId)) : null;
        if (!recoveryStillCurrent()) return;
        if (pnjSnapshot?.exists()) {
            const marked = pnjSnapshot.data()?.suppressionEnCours === true;
            showPnjDeletionStatus(
                marked ? `Suppression PNJ ${pnjId} verrouillée : reprenez la cascade.`
                    : `Verrou PNJ ${pnjId} incohérent : vérification administrateur requise.`,
                marked ? {
                    label: 'Reprendre',
                    run: async () => {
                        const node = state.nodes.find(item => item.id === pnjId);
                        if (node) openPnjModal(node.id);
                        else {
                            await loadData();
                            if (state.nodes.some(item => item.id === pnjId)) openPnjModal(pnjId);
                        }
                    },
                } : null,
            );
            return;
        }
        if (!pnjId || !Array.isArray(lock.imagePaths)) {
            throw new Error('Verrou PNJ incomplet : imagePaths manquant.');
        }
        for (const reference of Array.isArray(lock.imagePaths) ? lock.imagePaths : []) {
            await cleanupUnreferencedImage({
                db, storage, reference, ownerCollection: 'pnjs', ownerId: pnjId, skipJournal: true,
            });
            if (!recoveryStillCurrent()) return;
        }
        await deleteDoc(lockRef);
        if (!recoveryStillCurrent()) return;
        document.getElementById('pnj-deletion-status')?.remove();
    } catch (error) {
        if (!recoveryStillCurrent()) return;
        showPnjDeletionStatus('Reprise du verrou PNJ impossible : vérifiez la connexion.', {
            label: 'Réessayer', run: () => void recoverGlobalPnjDeletionLock(),
        });
        console.warn('Reprise du verrou global PNJ différée.', { error: error?.message });
    } finally { globalPnjLockRecoveryRunning = false; }
}

// ── Auth ───────────────────────────────────────────────────────
watchAuth((user, isAdmin) => {
    const roleChanged = state.isAdmin !== isAdmin;
    const nextAuthSessionKey = user?.uid || '';
    const identityChanged = authSessionKey !== nextAuthSessionKey;
    authSessionKey = nextAuthSessionKey;
    state.isAdmin = isAdmin;
    if (isAdmin) {
        void recoverPendingProtectedUploads(db, storage);
        retryPendingPnjCleanupIfNeeded();
        void recoverGlobalPnjDeletionLock();
    }
    document.getElementById('auth-btn').textContent = state.isAdmin ? '🔓 Déconnexion' : '🔑 Admin';
    document.getElementById('add-pnj-btn').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('pnj-private-fields').style.display = state.isAdmin ? '' : 'none';
    if (roleChanged || identityChanged) {
        editorSession += 1;
        currentLoadId += 1;
        currentPanelGeneration += 1;
    }
    if (!state.isAdmin) {
        clearPnjAdminStatuses();
        state.privateLoadId += 1;
        document.getElementById('f-notes-privees').value = '';
        state.privateDocExists = false;
        state.privateLoadError = false;
        document.getElementById('pnj-private-status').textContent = '';
        if (roleChanged || identityChanged) {
            // Déconnexion : retirer immédiatement l'état MJ avant le nouveau chargement public.
            closePnjModal();
            closeCropModal();
            state.nodes = [];
            state.links = [];
            state.searchQ = '';
            Object.values(state.active).forEach(values => values.clear());
            resetPnjView();
        }
    }
    if (roleChanged || identityChanged) { void loadData({ init: true }); return; }
    if (state.panelId) {
        const node = state.nodes.find(n => n.id === state.panelId);
        if (node) openPanel(node);
    }
    if (state.view === 'table') renderTable();
});

document.getElementById('auth-btn').addEventListener('click', async () => {
    if (state.isAdmin) {
        await logout();
    } else {
        try { await loginWithGoogle(); }
        catch (e) { if (e.code !== 'auth/popup-closed-by-user') alert('Connexion impossible : ' + e.message); }
    }
});

// ── Data ───────────────────────────────────────────────────────
function applySnapshots(pnjSnap, relSnap) {
    const rawNodes = pnjSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    // La règle filtre déjà côté serveur ; cette garde protège aussi un cache ou une réponse
    // transitoire si un ancien client conserve encore des documents.
    state.nodes = state.isAdmin ? rawNodes : rawNodes
        .filter(visiblePourJoueurs)
        .map(toPublicPnj);
    const nodeIds  = new Set(state.nodes.map(n => n.id));
    state.links = relSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(l => nodeIds.has(l.source) && nodeIds.has(l.cible)
            && (state.isAdmin || visiblePourJoueurs(l)))
        .map(l => ({ ...l, source: l.source, target: l.cible }));
    // La palette des couleurs "par lieu/groupe" dépend de la liste actuelle :
    // sans reset, une valeur disparue garderait sa case dans la légende et un
    // nouveau lieu/groupe n'aurait pas de couleur jusqu'au prochain switch.
    state.dimColorMap = null;
}

function toPublicPnj(node) {
    return Object.fromEntries(['id', 'nom', 'statut', 'vivant', 'lieu', 'groupe', 'description',
        'imagePath', 'imageUrl', 'visibleJoueurs', 'createdAt', 'updatedAt', 'ordre']
        .filter(key => Object.hasOwn(node, key)).map(key => [key, node[key]]));
}

async function loadData({ init = false } = {}) {
    const loadId = ++currentLoadId;
    try {
        if (state.isAdmin) {
            void recoverPendingProtectedUploads(db, storage);
            retryPendingPnjCleanupIfNeeded();
            void recoverGlobalPnjDeletionLock();
        }
        const imageGeneration = imageScope.beginGeneration();
        const pnjQuery = state.isAdmin
            ? collection(db, 'pnjs')
            : query(collection(db, 'pnjs'), where('visibleJoueurs', '==', true));
        const relationQuery = state.isAdmin
            ? collection(db, 'relations')
            : query(collection(db, 'relations'), where('visibleJoueurs', '==', true));
        const [ps, rs] = await Promise.all([
            getDocs(pnjQuery),
            getDocs(relationQuery),
        ]);
        if (!isCurrentLoad(loadId, currentLoadId)) return;
        applySnapshots(ps, rs);
        await Promise.all(state.nodes.map(async node => {
            node.legacyImageUrl = node.imageUrl || '';
            if (!node.imagePath) {
                node.imageState = node.imageUrl ? 'legacy' : 'missing';
                node.imageError = null;
                return;
            }
            const result = await imageScope.load(node.imagePath, imageGeneration);
            node.imageState = result.url ? 'ready' : (['storage/unauthorized', 'storage/unauthenticated'].includes(result.error?.code) ? 'access-denied' : 'missing');
            node.imageError = result.error?.code || null;
            if (result.url) node.imageUrl = result.url;
            else node.imageUrl = '';
        }));
        if (!isCurrentLoad(loadId, currentLoadId)) return;

        d3.select('#pnj-graph svg').remove();
        state.nodeSel = null;
        state.linkSel = null;
        state.linkLabelSel = null;
        if (state.simulation) { state.simulation.stop(); state.simulation = null; }

        clearFilters();
        buildFilters();
        if (state.nodes.length) buildGraph();

        if (init) document.getElementById('pnj-loading').style.display = 'none';
        document.getElementById('pnj-empty').style.display    = state.nodes.length ? 'none' : 'flex';
        document.getElementById('graph-legend').style.display = state.nodes.length ? 'flex' : 'none';
        if (state.view === 'table') renderTable();

        const urlParams = new URLSearchParams(window.location.search);
        const pnjId = urlParams.get('id') || urlParams.get('pnj');
        if (pnjId) {
            const node = state.nodes.find(n => n.id === pnjId);
            if (node) openPanel(node);
        }

    } catch (e) {
        if (!isCurrentLoad(loadId, currentLoadId)) return;
        console.error("Erreur lors du chargement des données :", e);
        if (init) {
            const el = document.getElementById('pnj-loading');
            el.querySelector('.pnj-spinner').style.display = 'none';
            const txt = el.querySelector('.loading-text');
            if (txt) txt.textContent = e?.code === 'permission-denied'
                ? 'Accès refusé : les données publiques doivent être marquées visibles par le MJ.'
                : 'Impossible de charger les données. Réessayez dans un instant.';
        }
    }
}


// ── CRUD ───────────────────────────────────────────────────────
async function savePnj(data, imageFile) {
    const btn = document.getElementById('pnj-save-btn');
    const capturedEditingId = state.editingId;
    const capturedPanelId = state.panelId;
    const capturedPanelGeneration = currentPanelGeneration;
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const editorStillCurrent = () => capturedSession === editorSession
        && capturedEditingId === state.editingId && capturedRole === state.isAdmin
        && document.getElementById('pnj-modal')?.style.display !== 'none';
    const requireCurrentEditor = () => { if (!editorStillCurrent()) throw new Error('Édition annulée : la session ou le rôle a changé.'); };
    btn.disabled = true;
    btn.textContent = imageFile ? 'Upload…' : 'Enregistrement…';
    try {
        if (capturedEditingId && state.privateLoadError) {
            throw new Error('Notes privées indisponibles : enregistrement annulé. Vérifiez les règles M1-02.');
        }
        const pnjRef = capturedEditingId ? doc(db, 'pnjs', capturedEditingId) : doc(collection(db, 'pnjs'));
        const previousImagePath = data.imagePath || '';
        const previousLegacyUrl = data.imageUrl || '';
        const publicData = {
            nom: data.nom || '', statut: data.statut || '', vivant: data.vivant || 'oui',
            lieu: data.lieu || '', groupe: data.groupe || '', description: data.description || '',
            visibleJoueurs: data.visibleJoueurs !== false,
            updatedAt: serverTimestamp(),
        };
        if (data.imagePath) publicData.imagePath = data.imagePath;
        if (!capturedEditingId) publicData.createdAt = serverTimestamp();
        const privateWrite = Boolean(data.notesPrivees) || state.privateDocExists;
        let relationsToHide = [];
        if (capturedEditingId && publicData.visibleJoueurs === false) {
            // Le masquage et la révocation des liens publics doivent rester dans le même batch.
            const relationSnap = await getDocs(collection(db, 'relations'));
            relationsToHide = publicRelationsForPnj(
                relationSnap.docs.map(relation => ({ id: relation.id, ...relation.data() })),
                pnjRef.id,
            );
        }
        if (cascadeWriteCount({ relationCount: relationsToHide.length, privateWrite }) > FIRESTORE_BATCH_LIMIT) {
            throw new Error('Masquage annulé : trop de relations à révoquer en une seule opération (limite Firestore de 500 écritures).');
        }
        // L'upload vient après le garde de taille : une opération refusée ne laisse pas d'image orpheline.
        let uploadedImage = null;
        if (imageFile) {
            requireCurrentEditor();
            uploadedImage = await uploadImage(imageFile, pnjRef.id);
            if (!rememberProtectedUpload({ collection: 'pnjs', ownerId: pnjRef.id, path: uploadedImage.path })) {
                try { await deleteObject(uploadedImage.ref); }
                catch { throw new Error(`Upload annulé. Nettoyage manuel requis pour ${uploadedImage.path}.`); }
                throw new Error('Upload annulé : impossible de journaliser sa reprise locale.');
            }
            if (!editorStillCurrent()) {
                try { await deleteObject(uploadedImage.ref); forgetProtectedUpload(uploadedImage.path); }
                catch { throw new Error(`Édition annulée. Nettoyage manuel requis pour ${uploadedImage.path}.`); }
                throw new Error('Édition annulée : la session ou le rôle a changé.');
            }
            publicData.imagePath = uploadedImage.path;
            // Une nouvelle écriture ne crée ni ne conserve une URL durable legacy.
            if (capturedEditingId) publicData.imageUrl = deleteField();
        }
        const batch = writeBatch(db);
        requireCurrentEditor();
        if (capturedEditingId) batch.update(pnjRef, publicData);
        else                 batch.set(pnjRef, publicData);
        // Les deux documents sont engagés ensemble : un refus de pnjs_prives ne peut donc
        // laisser qu'une moitié de modification publique.
        if (privateWrite) {
            batch.set(doc(db, 'pnjs_prives', pnjRef.id), {
                notes: data.notesPrivees || '', updatedAt: serverTimestamp(),
            }, { merge: true });
        }
        relationsToHide.forEach(relation => {
            batch.update(doc(db, 'relations', relation.id), {
                visibleJoueurs: false, updatedAt: serverTimestamp(),
            });
        });
        try {
            await batch.commit();
        } catch (error) {
            if (uploadedImage) {
                try { await deleteObject(uploadedImage.ref); forgetProtectedUpload(uploadedImage.path); }
                catch { throw new Error(`${error.message}. Nettoyage manuel requis pour ${uploadedImage.path}.`); }
            }
            throw error;
        }
        if (uploadedImage) forgetProtectedUpload(uploadedImage.path);
        if (uploadedImage) {
            const oldReferences = [previousImagePath, previousLegacyUrl].filter(Boolean);
            const removed = new Set();
            for (const oldReference of oldReferences) {
                if (oldReference === uploadedImage.path || removed.has(oldReference)) continue;
                removed.add(oldReference);
                try {
                    await cleanupUnreferencedImage({
                        db, storage, reference: oldReference, ownerCollection: 'pnjs', ownerId: pnjRef.id,
                    });
                } catch (error) {
                    alert(`Enregistrement réussi, mais ancienne image à nettoyer : ${error.message}`);
                }
            }
        }
        const prevEditingId = capturedEditingId;
        closePnjModal();
        await loadData();
        if (prevEditingId && panelIsStillCurrent({
            capturedGeneration: capturedPanelGeneration, currentGeneration: currentPanelGeneration,
            capturedId: capturedPanelId, currentId: state.panelId,
        })) {
            const node = state.nodes.find(n => n.id === prevEditingId);
            if (node) openPanel(node);
        }
    } catch (e) {
        alert('Erreur : ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
    }
}

async function deletePnj(id) {
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const deletionStillCurrent = () => id === state.editingId
        && capturedSession === editorSession && capturedRole === state.isAdmin;
    const pending = readPendingPnjDeletion();
    if (pending?.firestoreDone) await retryPendingPnjImageCleanup(pending);
    const refreshedPending = readPendingPnjDeletion();
    const pnj = state.nodes.find(n => n.id === id);
    if (refreshedPending?.id === id) {
        alert('Une suppression précédente est à reprendre. Le contrôle va vérifier les références restantes.');
    }
    let impactRelations;
    let impactIndices;
    let impactPrivate;
    try {
        [impactRelations, impactIndices, impactPrivate] = await Promise.all([
            getDocs(collection(db, 'relations')),
            getDocs(collection(db, 'indices')),
            getDoc(doc(db, 'pnjs_prives', id)),
        ]);
    } catch (error) {
        alert(`Suppression annulée : impossible de calculer son impact (${error.message}).`);
        return;
    }
    if (!deletionStillCurrent()) return;
    const relationCount = impactRelations.docs.filter(item => {
        const relation = item.data() || {};
        return relation.source === id || relation.cible === id;
    }).length;
    const indiceCount = impactIndices.docs.filter(item => (item.data()?.pnjsLies || []).includes(id)).length;
    const portraitReference = pnj?.imagePath || pnj?.imageUrl || '';
    const portraitIsProtected = safeStorageReference(storage, portraitReference)?.fullPath.split('/').length === 3;
    const ok = await confirmAction({
        titre: 'Supprimer le personnage',
        message: `${pnj?.nom || 'Ce personnage'} sera supprimé : ${relationCount} relation${relationCount > 1 ? 's' : ''}, ${indiceCount} indice${indiceCount > 1 ? 's' : ''} lié${indiceCount > 1 ? 's' : ''}, ${impactPrivate.exists() ? '1 note privée' : 'aucune note privée'}${portraitIsProtected ? ' et 1 portrait protégé' : portraitReference ? ' ; le portrait legacy sera signalé pour nettoyage' : ', aucun portrait'}.`,
        libelleAction: 'Supprimer',
        danger: true,
    });
    if (!ok || !deletionStillCurrent()) return;
    const pnjRef = doc(db, 'pnjs', id);
    const deletionLockRef = doc(db, 'integrity_locks', 'pnj-deletion');
    let deletionImagePaths = [];
    try {
        const lockResult = await runTransaction(db, async transaction => {
            const lockSnapshot = await transaction.get(deletionLockRef);
            const snapshot = await transaction.get(pnjRef);
            if (!snapshot.exists()) throw new Error('PNJ introuvable.');
            const lockPnjId = lockSnapshot.exists() ? lockSnapshot.data()?.pnjId : null;
            if (lockPnjId && lockPnjId !== id) {
                throw new Error(`Une autre suppression est déjà en cours (${lockPnjId}).`);
            }
            const imagePaths = lockSnapshot.exists() && Array.isArray(lockSnapshot.data()?.imagePaths)
                ? lockSnapshot.data().imagePaths
                : portraitPathsForDeletionLock(id, snapshot.data());
            if (snapshot.data()?.suppressionEnCours !== true) {
                transaction.update(pnjRef, { suppressionEnCours: true, updatedAt: serverTimestamp() });
            }
            if (!lockSnapshot.exists()) {
                transaction.set(deletionLockRef, {
                    pnjId: id, imagePaths, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
                });
            }
            return { imagePaths };
        });
        deletionImagePaths = lockResult?.imagePaths || [];
    } catch (error) {
        alert(`Suppression annulée : impossible de poser le verrou de suppression (${error.message}).`);
        return;
    }
    let relSnap, clueSnap, pnjSnap, imageReferences, protectedImageReferences, legacyImageCount, pendingDeletion;
    try {
        [relSnap, clueSnap, pnjSnap] = await Promise.all([
            getDocs(collection(db, 'relations')),
            getDocs(collection(db, 'indices')),
            getDoc(doc(db, 'pnjs', id)),
        ]);
        if (!deletionStillCurrent()) throw new Error('La session ou le rôle a changé après le verrouillage.');
        const currentPnj = pnjSnap.exists() ? { id, ...pnjSnap.data() } : pnj;
        imageReferences = [currentPnj?.imagePath, currentPnj?.imageUrl].filter(Boolean);
        protectedImageReferences = deletionImagePaths;
        const protectedPaths = new Set(protectedImageReferences);
        legacyImageCount = imageReferences.filter(reference => {
            const imageRef = safeStorageReference(storage, reference);
            return !imageRef || !protectedPaths.has(imageRef.fullPath);
        }).length;
        pendingDeletion = {
            id,
            images: protectedImageReferences,
            firestoreDone: false,
            startedAt: Date.now(),
        };
        if (!writePendingPnjDeletion(pendingDeletion)) {
            console.warn('Journal local PNJ indisponible ; le verrou Firestore reste la source de reprise.', { id });
        }
        for (const path of protectedImageReferences) {
            if (!rememberProtectedUpload({ collection: 'pnjs', ownerId: id, path })) {
                console.warn('Journal local Storage indisponible ; le verrou image/PNJ reste la source de reprise.', { path });
            }
        }
    } catch (error) {
        alert(`Suppression verrouillée mais non poursuivie : ${error.message}. Reprenez-la dès que la connexion revient.`);
        void recoverGlobalPnjDeletionLock();
        return;
    }
    const cascadeOperations = (relations, clues) => [
        ...clues.filter(d => (d.data().pnjsLies || []).includes(id))
            .map(d => ({ type: 'update', ref: d.ref })),
        ...relations.filter(d => d.data().source === id || d.data().cible === id)
            .map(d => ({ type: 'delete', ref: d.ref })),
    ];
    const commitCascadeOperations = async operations => {
        await commitCascadeBatches(operations, async operationSet => {
            const batch = writeBatch(db);
            operationSet.forEach(operation => {
                if (operation.type === 'update') batch.update(operation.ref, {
                    pnjsLies: arrayRemove(id), updatedAt: serverTimestamp(),
                });
                else batch.delete(operation.ref);
            });
            await batch.commit();
            if (!deletionStillCurrent()) throw new Error('Suppression annulée : la session ou le rôle a changé.');
        }, FIRESTORE_BATCH_LIMIT, 2);
    };
    // Les étapes de nettoyage restent sous 500 opérations ; le document PNJ et sa note
    // privée ne sont supprimés qu’après la réussite de toutes les étapes précédentes.
    try {
        await commitCascadeOperations(cascadeOperations(relSnap.docs, clueSnap.docs));
        // Une relation ou une référence peut être créée pendant les premiers lots. Trois
        // relectures stabilisent la cascade ; sinon on laisse l’état de reprise, sans supprimer
        // le PNJ ni annoncer une réussite partielle.
        let stable = false;
        for (let pass = 0; pass < 3; pass += 1) {
            const [freshRelations, freshClues] = await Promise.all([
                getDocs(collection(db, 'relations')),
                getDocs(collection(db, 'indices')),
            ]);
            if (!deletionStillCurrent()) throw new Error('Suppression annulée : la session ou le rôle a changé.');
            const newOperations = cascadeOperations(freshRelations.docs, freshClues.docs);
            if (!newOperations.length) { stable = true; break; }
            await commitCascadeOperations(newOperations);
        }
        if (!stable) throw new Error('La cascade change encore ; reprise requise avant suppression finale.');
        const finalBatch = writeBatch(db);
        finalBatch.delete(doc(db, 'pnjs_prives', id));
        finalBatch.delete(doc(db, 'pnjs', id));
        await finalBatch.commit();
        pendingDeletion.firestoreDone = true;
        if (!writePendingPnjDeletion(pendingDeletion)) {
            console.warn('État PNJ local non actualisé après suppression Firestore.', { id });
        }
    } catch (error) {
        alert(`Suppression incomplète : ${error.message}. Les éléments restants sont journalisés pour reprise.`);
        void recoverGlobalPnjDeletionLock();
        return;
    }
    closePnjModal();
    closePanel();
    let storageError = null;
    for (const reference of protectedImageReferences) {
        try {
            await cleanupUnreferencedImage({
                db, storage, reference, ownerCollection: 'pnjs', ownerId: id, skipJournal: true,
            });
        } catch (error) { storageError = error; }
    }
    if (storageError) {
        alert(`PNJ supprimé dans Firestore, mais le verrou reste actif pendant la reprise Storage : ${storageError.message}`);
    } else {
        try {
            await deleteDoc(deletionLockRef);
            clearPendingPnjDeletion();
        } catch (error) {
            alert(`PNJ supprimé et images nettoyées, mais le verrou reste actif : ${error.message}`);
        }
    }
    if (legacyImageCount) alert('PNJ supprimé. Le portrait legacy ou externe reste signalé pour nettoyage contrôlé.');
    await loadData();
}

async function saveRelation(sourceId, cibleId, type, label, color, style, bidir) {
    if (!sourceId || !cibleId || !type) { alert('Choisissez un PNJ et entrez un type de relation.'); return; }
    if (sourceId === cibleId) { alert('Un PNJ ne peut pas être relié à lui-même.'); return; }
    if (!state.nodes.some(node => node.id === sourceId) || !state.nodes.some(node => node.id === cibleId)) {
        alert('La relation fait référence à un PNJ introuvable.');
        return;
    }
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const panelId = state.panelId;
    const panelGeneration = currentPanelGeneration;
    const mutationStillCurrent = () => capturedRole === true && state.isAdmin === true
        && capturedSession === editorSession
        && panelIsStillCurrent({
            capturedGeneration: panelGeneration, currentGeneration: currentPanelGeneration,
            capturedId: panelId, currentId: state.panelId,
        });
    if (!mutationStillCurrent()) return;
    const relData = { source: sourceId, cible: cibleId, type, label: label || type,
        color: safeRelationColor(color, type), style: style === 'dashed' ? 'dashed' : 'solid', visibleJoueurs: true };
    if (relationExists(state.links, relData, bidir)) {
        alert('Cette relation existe déjà dans ce sens.');
        return;
    }
    const firstRef = doc(db, 'relations', relationId(relData));
    const secondData = { ...relData, source: cibleId, cible: sourceId };
    const secondRef = bidir ? doc(db, 'relations', relationId(secondData)) : null;
    await runTransaction(db, async transaction => {
        const sourceRef = doc(db, 'pnjs', sourceId);
        const cibleRef = doc(db, 'pnjs', cibleId);
        const sourceSnapshot = await transaction.get(sourceRef);
        const cibleSnapshot = await transaction.get(cibleRef);
        const firstSnapshot = await transaction.get(firstRef);
        const secondSnapshot = secondRef ? await transaction.get(secondRef) : null;
        if (!sourceSnapshot.exists() || !cibleSnapshot.exists()
            || sourceSnapshot.data()?.suppressionEnCours === true
            || cibleSnapshot.data()?.suppressionEnCours === true) {
            throw new Error('Relation refusée : un PNJ est absent ou en cours de suppression.');
        }
        if (firstSnapshot.exists() || secondSnapshot?.exists()) {
            throw new Error('Cette relation existe déjà dans ce sens.');
        }
        if (!mutationStillCurrent()) throw new Error('Création annulée : la session ou le panneau a changé.');
        const timestamps = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
        transaction.set(firstRef, { ...relData, ...timestamps });
        if (secondRef) transaction.set(secondRef, { ...secondData, ...timestamps });
    });
    if (!mutationStillCurrent()) return;
    await loadData();
    if (panelIsStillCurrent({ capturedGeneration: panelGeneration, currentGeneration: currentPanelGeneration,
        capturedId: panelId, currentId: state.panelId })) {
        const node = state.nodes.find(n => n.id === sourceId);
        if (node) openPanel(node);
    }
}

async function updateRelation(relId, type, label, color, style) {
    if (!type) { alert('Le type de relation est requis.'); return; }
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const panelId = state.panelId;
    const panelGeneration = currentPanelGeneration;
    const relationRef = doc(db, 'relations', relId);
    const mutationStillCurrent = () => capturedRole === true && state.isAdmin === true
        && capturedSession === editorSession
        && panelIsStillCurrent({
            capturedGeneration: panelGeneration, currentGeneration: currentPanelGeneration,
            capturedId: panelId, currentId: state.panelId,
        });
    const data = { type, label: label || type, updatedAt: serverTimestamp() };
    data.color = color ? safeRelationColor(color, type) : deleteField();
    data.style = style === 'dashed' ? 'dashed' : deleteField();
    const confirmation = await getDoc(relationRef);
    if (!confirmation.exists()) { alert('Cette relation n’existe plus.'); return; }
    if (!mutationStillCurrent()) return;
    await updateDoc(relationRef, data);
    if (!mutationStillCurrent()) return;
    await loadData();
    if (panelIsStillCurrent({ capturedGeneration: panelGeneration, currentGeneration: currentPanelGeneration,
        capturedId: panelId, currentId: state.panelId })) {
        const node = state.nodes.find(n => n.id === panelId);
        if (node) openPanel(node);
    }
}

async function deleteRelation(relId) {
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const panelId = state.panelId;
    const panelGeneration = currentPanelGeneration;
    const relationRef = doc(db, 'relations', relId);
    const mutationStillCurrent = () => capturedRole === true && state.isAdmin === true
        && capturedSession === editorSession
        && panelIsStillCurrent({
            capturedGeneration: panelGeneration, currentGeneration: currentPanelGeneration,
            capturedId: panelId, currentId: state.panelId,
        });
    const ok = await confirmAction({
        titre: 'Supprimer la relation',
        message: 'Cette relation sera définitivement supprimée.',
        libelleAction: 'Supprimer',
        danger: true,
    });
    if (!ok || !mutationStillCurrent()) return;
    const relationSnapshot = await getDoc(relationRef);
    if (!relationSnapshot.exists()) { alert('Cette relation n’existe plus.'); return; }
    if (!mutationStillCurrent()) return;
    await deleteDoc(relationRef);
    if (!mutationStillCurrent()) return;
    await loadData();
    if (panelIsStillCurrent({ capturedGeneration: panelGeneration, currentGeneration: currentPanelGeneration,
        capturedId: panelId, currentId: state.panelId })) {
        const node = state.nodes.find(n => n.id === panelId);
        if (node) openPanel(node);
    }
}

// ── PNJ Modal ──────────────────────────────────────────────────
function openPnjModal(pnjId = null) {
    editorSession += 1;
    // Invalide toute lecture privée encore en vol avant de réinitialiser le formulaire.
    state.privateLoadId += 1;
    closeCropModal();
    state.editingId  = pnjId;
    state.croppedBlob = null;
    const preview = document.getElementById('f-image-preview');
    document.getElementById('pnj-form').reset();
    clearPnjPreview();
    document.getElementById('pnj-modal-title').textContent = pnjId ? 'Modifier le personnage' : 'Nouveau personnage';
    document.getElementById('pnj-delete-btn').style.display = pnjId ? '' : 'none';
    document.getElementById('pnj-private-fields').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('f-visible-joueurs').value = 'true';
    document.getElementById('f-notes-privees').value = '';
    state.privateDocExists = false;
    state.privateLoadError = false;
    document.getElementById('pnj-private-status').textContent = '';

    if (pnjId) {
        const p = state.nodes.find(n => n.id === pnjId);
        if (p) {
            document.getElementById('f-nom').value         = p.nom         || '';
            document.getElementById('f-statut').value      = p.statut      || '';
            document.getElementById('f-vivant').value      = p.vivant      || 'oui';
            document.getElementById('f-lieu').value        = p.lieu        || '';
            document.getElementById('f-groupe').value      = p.groupe      || '';
            document.getElementById('f-description').value = p.description || '';
            document.getElementById('f-visible-joueurs').value = String(p.visibleJoueurs !== false);
            void loadPrivateNotes(pnjId, p);
            if (p.imageUrl) {
                preview.innerHTML = `<img src="${esc(p.imageUrl)}" alt="Portrait actuel">`;
                preview.dataset.existingUrl = p.imageUrl;
            }
            preview.dataset.existingPath = p.imagePath || '';
            preview.dataset.existingLegacyUrl = p.legacyImageUrl || (!p.imagePath ? (p.imageUrl || '') : '');
        }
    }
    document.getElementById('pnj-modal').style.display = 'flex';
}

function legacyNote(pnj) {
    return legacyPrivateNoteInfo(pnj).value;
}

function legacyNoteError(pnj) {
    const info = legacyPrivateNoteInfo(pnj);
    if (info.invalid) return 'Note legacy invalide : correction manuelle requise.';
    if (info.conflict) return 'Notes legacy contradictoires : correction manuelle requise.';
    return '';
}

async function loadPrivateNotes(pnjId, pnj) {
    const loadId = ++state.privateLoadId;
    try {
        const snap = await getDoc(doc(db, 'pnjs_prives', pnjId));
        if (!privateLoadCanApply(loadId, state.privateLoadId, state.isAdmin)) return;
        state.privateDocExists = snap.exists();
        if (snap.exists()) {
            const notes = snap.data().notes;
            if (typeof notes !== 'string') {
                state.privateLoadError = true;
                document.getElementById('pnj-private-status').textContent = 'Notes privées invalides : correction manuelle requise.';
                return;
            }
            document.getElementById('f-notes-privees').value = notes;
            return;
        }
        document.getElementById('f-notes-privees').value = legacyNote(pnj);
        const legacyError = legacyNoteError(pnj);
        if (legacyError) {
            state.privateLoadError = true;
            document.getElementById('pnj-private-status').textContent = legacyError;
        }
    } catch {
        if (privateLoadCanApply(loadId, state.privateLoadId, state.isAdmin)) {
            state.privateLoadError = true;
            // Compatibilité M1-01 : le fallback est explicite, jamais silencieux.
            document.getElementById('f-notes-privees').value = legacyNote(pnj);
            document.getElementById('pnj-private-status').textContent = `Lecture des notes privées impossible : sauvegarde désactivée.${legacyNoteError(pnj) ? ` ${legacyNoteError(pnj)}` : ''}`;
        }
    }
}

function closePnjModal() {
    editorSession += 1;
    // Une réponse Firestore tardive ne doit jamais remplir le PNJ ouvert ensuite.
    state.privateLoadId += 1;
    closeCropModal();
    clearPnjPreview();
    document.getElementById('f-image').value = '';
    document.getElementById('pnj-modal').style.display = 'none';
    state.editingId   = null;
    state.croppedBlob = null;
    state.privateDocExists = false;
    state.privateLoadError = false;
}

document.getElementById('pnj-form').addEventListener('submit', async e => {
    e.preventDefault();
    const preview = document.getElementById('f-image-preview');
    await savePnj({
        nom:         document.getElementById('f-nom').value.trim(),
        statut:      document.getElementById('f-statut').value,
        vivant:      document.getElementById('f-vivant').value,
        lieu:        document.getElementById('f-lieu').value.trim(),
        groupe:      document.getElementById('f-groupe').value.trim(),
        description: document.getElementById('f-description').value.trim(),
        imagePath:   preview.dataset.existingPath || '',
        imageUrl:    preview.dataset.existingLegacyUrl || '',
        visibleJoueurs: document.getElementById('f-visible-joueurs').value === 'true',
        notesPrivees: document.getElementById('f-notes-privees').value,
    }, state.croppedBlob);
});

document.getElementById('f-image').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    openCropModal(file);
});

// ── Crop Modal ─────────────────────────────────────────────────

function clearLocalPreview() {
    if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
        localPreviewUrl = null;
    }
}

function clearPnjPreview() {
    clearLocalPreview();
    const preview = document.getElementById('f-image-preview');
    preview.innerHTML = '';
    preview.dataset.existingUrl = '';
    preview.dataset.existingPath = '';
    preview.dataset.existingLegacyUrl = '';
}

function openCropModal(file) {
    const generation = ++cropGeneration;
    const img = document.getElementById('crop-img');
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    cropSourceUrl = URL.createObjectURL(file);
    img.onload = () => {
        if (!isCurrentGeneration(generation, cropGeneration)) return;
        cropperInstance = new Cropper(img, {
            aspectRatio: 1,
            viewMode: 1,
            autoCropArea: 0.85,
            movable: true,
            zoomable: true,
            scalable: false,
            guides: true,
        });
    };
    img.src = cropSourceUrl;
    document.getElementById('crop-modal').style.display = 'flex';
}

function closeCropModal() {
    cropGeneration += 1;
    document.getElementById('crop-modal').style.display = 'none';
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    const img = document.getElementById('crop-img');
    img.onload = null;
    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    cropSourceUrl = null;
    img.src = '';
}

document.getElementById('crop-confirm-btn').addEventListener('click', () => {
    if (!cropperInstance) return;
    const generation = cropGeneration;
    cropperInstance.getCroppedCanvas({ width: 500, height: 500 }).toBlob(blob => {
        if (!isCurrentGeneration(generation, cropGeneration) || !blob) return;
        state.croppedBlob = blob;
        const preview = document.getElementById('f-image-preview');
        clearLocalPreview();
        localPreviewUrl = URL.createObjectURL(blob);
        preview.innerHTML = `<img src="${localPreviewUrl}" alt="Aperçu">`;
        preview.dataset.existingUrl = '';
        closeCropModal();
    }, 'image/webp', 0.85);
});

document.getElementById('crop-cancel-btn').addEventListener('click', () => {
    document.getElementById('f-image').value = '';
    closeCropModal();
});

document.getElementById('pnj-modal-close').addEventListener('click', closePnjModal);
document.getElementById('pnj-modal').addEventListener('click', e => { if (e.target === document.getElementById('pnj-modal')) closePnjModal(); });
document.getElementById('pnj-delete-btn').addEventListener('click', () => { if (state.editingId) deletePnj(state.editingId); });
document.getElementById('add-pnj-btn').addEventListener('click', () => openPnjModal());

// ── Colors ─────────────────────────────────────────────────────
function buildDimColorMap() {
    if (state.colorBy === 'statut') { state.dimColorMap = null; return; }
    const vals = [...new Set(state.nodes.map(d => d[state.colorBy]).filter(Boolean))].sort();
    state.dimColorMap = new Map(vals.map((v, i) => [v, DIM_PALETTE[i % DIM_PALETTE.length]]));
}

const getDimColor = d => state.dimColorMap ? (state.dimColorMap.get(d[state.colorBy]) || '#7a7a8a') : getStatutColor(d.statut);

function updateLegend() {
    const legend = document.getElementById('graph-legend');
    if (state.colorBy === 'statut') {
        legend.innerHTML = `
            <div class="legend-item"><span class="legend-dot" style="background:#4caf7d"></span>Allié</div>
            <div class="legend-item"><span class="legend-dot" style="background:#c94c4c"></span>Ennemi</div>
            <div class="legend-item"><span class="legend-dot" style="background:#8a8a9a"></span>Neutre</div>
            <div class="legend-item"><span class="legend-ring"></span>Décédé</div>`;
    } else {
        const items = state.dimColorMap ? [...state.dimColorMap.entries()].map(([v, c]) =>
            `<div class="legend-item"><span class="legend-dot" style="background:${c}"></span>${esc(v)}</div>`).join('') : '';
        legend.innerHTML = items + `<div class="legend-item"><span class="legend-ring"></span>Décédé</div>`;
    }
}

// ── Filters ────────────────────────────────────────────────────
function clearFilters() {
    ['filter-statut', 'filter-vivant', 'filter-lieu', 'filter-groupe'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
    const badge = document.getElementById('pnj-filter-count');
    if (badge) badge.textContent = 'Aucun filtre';
}

function buildFilters() {
    const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
    const definitions = [
        ['filter-statut', 'Statut', 'statut', uniq(state.nodes.map(d => d.statut))],
        ['filter-vivant', 'Vivant', 'vivant', uniq(state.nodes.map(d => d.vivant))],
        ['filter-lieu',   'Lieu',   'lieu',   uniq(state.nodes.map(d => d.lieu))],
        ['filter-groupe', 'Groupe', 'groupe', uniq(state.nodes.map(d => d.groupe))],
    ];
    const available = Object.fromEntries(definitions.map(([, , key, vals]) => [key, vals]));
    // Les ensembles de filtres survivent à un rechargement ; une valeur disparue
    // doit être retirée avant de rendre les boutons, sinon le graphe reste masqué.
    reconcileFilterSets(state.active, available);
    definitions.forEach(([id, label, key, vals]) => {
        if (!vals.length) return;
        const el  = document.getElementById(id);
        const lbl = document.createElement('span');
        lbl.className = 'filter-group-label';
        lbl.textContent = label;
        el.appendChild(lbl);
        vals.forEach(v => {
            const btn = document.createElement('button');
            btn.className = 'filter-pill' + (state.active[key].has(v) ? ' active' : '');
            btn.textContent = v;
            btn.addEventListener('click', () => {
                state.active[key].has(v) ? state.active[key].delete(v) : state.active[key].add(v);
                btn.classList.toggle('active', state.active[key].has(v));
                updateFilterBadge();
                updateVisibility();
                if (state.view === 'table') renderTable();
            });
            el.appendChild(btn);
        });
    });
    updateFilterBadge();
}

function updateFilterBadge() {
    const activeCount = Object.values(state.active).reduce((count, values) => count + values.size, 0);
    const badge = document.getElementById('pnj-filter-count');
    if (badge) badge.textContent = activeCount ? `${activeCount} filtre${activeCount > 1 ? 's' : ''}` : 'Aucun filtre';
}

// ── Graph ──────────────────────────────────────────────────────
function buildGraph() {
    const container = document.getElementById('pnj-graph');
    state.graphW = container.clientWidth  || window.innerWidth * 0.85;
    state.graphH = container.clientHeight || 550;

    buildDimColorMap();

    const svg = d3.select('#pnj-graph').append('svg').attr('width', '100%').attr('height', '100%');
    const g   = svg.append('g');

    const initialScale = 0.8;
    const zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoom);
    svg.call(zoom.transform, d3.zoomIdentity
        .translate(state.graphW / 2 * (1 - initialScale), state.graphH / 2 * (1 - initialScale))
        .scale(initialScale));
    svg.on('click', () => closePanel());

    // Offsets pour liens parallèles entre les mêmes nœuds
    const pairCount = new Map(), pairIdx = new Map();
    state.links.forEach(l => {
        const key = [l.source, l.target].sort().join('|');
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
    });
    state.links.forEach(l => {
        const key = [l.source, l.target].sort().join('|');
        const idx = pairIdx.get(key) || 0;
        l._curveScale = Math.ceil((idx + 1) / 2) * (idx % 2 === 0 ? 1 : -1);
        l._showLabel = idx % 2 === 0;
        pairIdx.set(key, idx + 1);
    });

    // Marqueurs de flèches (un par couleur unique)
    const defs = svg.append('defs');
    [...new Set(state.links.map(l => safeRelationColor(l.color, l.type)))].forEach(color => {
        defs.append('marker')
            .attr('id', `arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`)
            .attr('viewBox', '0 -4 10 8').attr('refX', 10).attr('refY', 0)
            .attr('markerWidth', 10).attr('markerHeight', 8)
            .attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
            .append('path').attr('d', 'M0,-4 L10,0 L0,4 Z').attr('fill', color);
    });

    // Liens : paths courbés + labels
    const linkG = g.append('g');
    state.linkSel = linkG.selectAll('path').data(state.links).join('path')
        .attr('id', (d, i) => `pnj-lp-${i}`)
        .attr('class', 'pnj-link')
        .attr('stroke', d => safeRelationColor(d.color, d.type))
        .attr('stroke-width', 3.5)
        .attr('stroke-dasharray', d => d.style === 'dashed' ? '8 5' : null)
        .attr('marker-end', d => `url(#arrow-${safeRelationColor(d.color, d.type).replace(/[^a-zA-Z0-9]/g, '')})`)
        .attr('opacity', 0.8).attr('fill', 'none');

    const linkTextSel = linkG.selectAll('text.pnj-link-label').data(state.links).join('text')
        .attr('class', 'pnj-link-label');
    linkTextSel.append('textPath')
        .attr('href', (d, i) => `#pnj-lp-${i}`)
        .attr('startOffset', '50%')
        .text(d => d._showLabel !== false ? (d.label || d.type || '') : '');
    state.linkLabelSel = linkTextSel;

    // Nœuds : cartouches SVG déplaçables
    // Géométrie : accent(5) + padding(10) + portrait(PORT_R*2) + gap(8) + texte
    // Centre portrait cx = -CARD_W/2 + 5 + 10 + PORT_R = -100 + 38 = -62
    // Texte x = -CARD_W/2 + 5 + 10 + PORT_R*2 + 8 = -100 + 69 = -31
    const portCx = -CARD_W / 2 + 5 + 10 + PORT_R;
    const textX  = -CARD_W / 2 + 5 + 10 + PORT_R * 2 + 8;

    const nodeG = g.append('g').selectAll('g').data(state.nodes).join('g')
        .attr('class', 'pnj-node')
        .call(d3.drag()
            .on('start', (e, d) => { if (!e.active) state.simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
            .on('end',   (e, d) => { if (!e.active) state.simulation.alphaTarget(0); d.fx = d.x; d.fy = d.y; }))
        .on('click', (e, d) => { e.stopPropagation(); openPanel(d); });

    // Fond de la carte
    nodeG.append('rect')
        .attr('class', 'node-card')
        .attr('x', -CARD_W / 2).attr('y', -CARD_H / 2)
        .attr('width', CARD_W).attr('height', CARD_H)
        .attr('rx', CARD_RX)
        .attr('fill', 'var(--bg-card)')
        .attr('stroke', getDimColor)
        .attr('stroke-width', 2.5);

    // Barre accent gauche
    nodeG.append('rect')
        .attr('class', 'node-accent')
        .attr('x', -CARD_W / 2).attr('y', -CARD_H / 2)
        .attr('width', 5).attr('height', CARD_H)
        .attr('rx', CARD_RX)
        .attr('fill', getDimColor);

    // Clip path circulaire pour le portrait
    nodeG.append('clipPath')
        .attr('id', d => `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`)
        .append('circle')
        .attr('cx', portCx).attr('cy', 0).attr('r', PORT_R);

    // Fond du portrait (placeholder)
    nodeG.append('circle')
        .attr('class', 'node-portrait-bg')
        .attr('cx', portCx).attr('cy', 0).attr('r', PORT_R)
        .attr('fill', 'var(--bg-surface)')
        .style('display', d => d.imageUrl ? 'none' : '');

    // Initiale (si pas de portrait)
    nodeG.append('text')
        .attr('class', 'node-initial')
        .attr('x', portCx).attr('y', 0).attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('display', d => d.imageUrl ? 'none' : '')
        .text(d => (d.nom || '?')[0].toUpperCase());

    // Portrait
    nodeG.append('image')
        .attr('href', d => d.imageUrl || null)
        .attr('x', -CARD_W / 2 + 5 + 10).attr('y', -PORT_R)
        .attr('width', PORT_R * 2).attr('height', PORT_R * 2)
        .attr('clip-path', d => `url(#clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')})`)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .style('display', d => d.imageUrl ? '' : 'none')
        .on('error', function() { d3.select(this).style('display', 'none'); });

    // Nom
    nodeG.append('text')
        .attr('class', 'node-name')
        .attr('x', textX).attr('y', -8)
        .text(d => d.nom || '');

    // Sous-ligne : statut · lieu
    nodeG.append('text')
        .attr('class', 'node-sub')
        .attr('x', textX).attr('y', 10)
        .text(d => [cap(d.statut), d.lieu].filter(Boolean).join(' · ') || '');

    state.nodeSel = nodeG;

    state.simulation = d3.forceSimulation(state.nodes)
        .force('link',    d3.forceLink(state.links).id(d => d.id).distance(240))
        .force('charge',  d3.forceManyBody().strength(-700))
        .force('center',  d3.forceCenter(state.graphW / 2, state.graphH / 2))
        .force('collide', d3.forceCollide(Math.sqrt(CARD_W * CARD_W + CARD_H * CARD_H) / 2 + 20))
        .on('tick', () => {
            state.linkSel.attr('d', d => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y, d._curveScale ?? 1));
            state.nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
        })
        .on('end', () => {
            state.nodes.forEach(d => { if (d.fx == null) { d.fx = d.x; d.fy = d.y; } });
        });

    updateVisibility();
    updateLegend();
}

function applyColorBy(dim) {
    state.colorBy = dim;
    buildDimColorMap();
    state.nodeSel?.select('.node-card').attr('stroke', getDimColor);
    state.nodeSel?.select('.node-accent').attr('fill', getDimColor);
    if (dim === 'statut') {
        state.simulation?.force('cluster-x', null).force('cluster-y', null);
    } else {
        state.nodes.forEach(d => { d.fx = null; d.fy = null; });
        const vals = state.dimColorMap ? [...state.dimColorMap.keys()] : [];
        const n = vals.length || 1, r = Math.min(state.graphW, state.graphH) * 0.28;
        const centers = Object.fromEntries(vals.map((v, i) => [v, {
            x: state.graphW / 2 + r * Math.cos((2 * Math.PI * i / n) - Math.PI / 2),
            y: state.graphH / 2 + r * Math.sin((2 * Math.PI * i / n) - Math.PI / 2),
        }]));
        state.simulation
            ?.force('cluster-x', d3.forceX(d => centers[d[dim]]?.x ?? state.graphW / 2).strength(0.07))
            .force('cluster-y', d3.forceY(d => centers[d[dim]]?.y ?? state.graphH / 2).strength(0.07))
            .alpha(0.4).restart();
    }
    updateLegend();
    document.querySelectorAll('.colorby-btn').forEach(b => b.classList.toggle('active', b.dataset.dim === dim));
}

// ── Visibility ─────────────────────────────────────────────────
function isVisible(d) {
    const q = stripAccents(state.searchQ.toLowerCase());
    if (q && !stripAccents((d.nom || '').toLowerCase()).includes(q) &&
             !stripAccents((d.description || '').toLowerCase()).includes(q)) return false;
    if (state.active.statut.size && !state.active.statut.has(d.statut)) return false;
    if (state.active.vivant.size && !state.active.vivant.has(d.vivant)) return false;
    if (state.active.lieu.size   && !state.active.lieu.has(d.lieu))     return false;
    if (state.active.groupe.size && !state.active.groupe.has(d.groupe)) return false;
    return true;
}

function updateVisibility() {
    if (!state.nodeSel) return;
    const visIds = new Set(state.nodes.filter(isVisible).map(d => d.id));
    state.nodeSel
        .style('opacity', d => isVisible(d) ? getNodeOpacity(d) : 0.06)
        .style('pointer-events', d => isVisible(d) ? 'all' : 'none');
    state.nodeSel.select('.node-card').attr('stroke-dasharray', d => (d.vivant || '').toLowerCase() === 'non' ? '5 3' : null);
    state.linkSel?.style('opacity', d => {
        // d.source/.target peuvent être soit un id (string) soit l'objet node après simulation
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return visIds.has(s) && visIds.has(t) ? 0.6 : 0.04;
    });
    state.linkLabelSel?.style('opacity', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return visIds.has(s) && visIds.has(t) ? 0.7 : 0;
    });
}

// ── Detail panel ───────────────────────────────────────────────
async function openPanel(d) {
    const panelGeneration = ++currentPanelGeneration;
    const panelRole = state.isAdmin;
    state.panelId = d.id;
    const panelIsCurrent = () => {
        const currentNode = state.nodes.find(node => node.id === d.id);
        return isCurrentPanel(
            panelGeneration,
            currentPanelGeneration,
            d.id,
            state.panelId,
            panelRole,
            state.isAdmin,
            Boolean(currentNode) && (panelRole || visiblePourJoueurs(currentNode)),
        );
    };
    const nodeById = new Map(state.nodes.map(n => [n.id, n]));

    const related = state.links.filter(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        return s === d.id || t === d.id;
    }).map(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        const isSource = s === d.id;
        return { relId: l.id, node: nodeById.get(isSource ? t : s), type: l.type, label: l.label || l.type || 'Lié', dir: isSource ? '→' : '←', color: safeRelationColor(l.color, l.type), style: l.style };
    }).filter(r => r.node);

    const vKey   = (d.vivant || '').toLowerCase();
    const vLabel = { oui: 'Vivant', non: 'Décédé', inconnu: 'Inconnu' }[vKey] || cap(d.vivant);

    const portraitHtml = d.imageUrl
        ? `<img src="${esc(d.imageUrl)}" class="pnj-detail-portrait" alt="${esc(d.nom)}">`
        : (protectedImagePlaceholder(d, d.nom) || `<div class="pnj-portrait-placeholder">${esc((d.nom || '?').charAt(0).toUpperCase())}</div>`);

    const metaHtml = (d.lieu || d.groupe) ? `
        <div class="pnj-detail-meta">
            ${d.lieu   ? `<span>📍 ${esc(d.lieu)}</span>`   : ''}
            ${d.groupe ? `<span>⚔ ${esc(d.groupe)}</span>` : ''}
        </div>` : '';

    const descHtml = d.description ? `
        <div class="pnj-detail-section">
            <p class="pnj-desc">${esc(d.description).replace(/\n/g, '<br>')}</p>
        </div>` : '';

    const editActions = panelRole ? `
        <div class="pnj-edit-actions">
            <button class="btn-edit" id="panel-edit-btn">✏ Modifier</button>
        </div>` : '';

    const relDeleteBtn = relId => panelRole
        ? `<button class="rel-delete-btn" data-rel="${esc(relId)}" title="Supprimer">×</button>` : '';
    const relEditBtn = relId => panelRole
        ? `<button class="rel-edit-btn" data-rel="${esc(relId)}" title="Modifier">✏</button>` : '';

    const relHtml = `
        <div class="pnj-detail-section">
            <h4>Relations${related.length ? ` (${related.length})` : ''}</h4>
            <div class="pnj-relation-list">
                ${related.map(r => `
                    <div class="rel-chip-row" id="rel-row-${esc(r.relId)}">
                        <button class="pnj-relation-chip" data-id="${esc(r.node.id)}" style="--chip-color:${r.color || getLinkColor(r.type)}">
                            <span class="chip-name">${esc(r.node.nom)}</span>
                            <span class="chip-type"><span class="chip-dir">${r.dir}</span> ${esc(r.label)}</span>
                        </button>
                        ${relEditBtn(r.relId)}${relDeleteBtn(r.relId)}
                    </div>`).join('')}
            </div>
            ${panelRole ? `
                <button class="btn-add-rel" id="add-rel-btn">＋ Relation</button>
                <div class="rel-add-form" id="rel-add-form" style="display:none;">
                    <select id="rel-target">
                        <option value="">— Choisir un PNJ —</option>
                        ${state.nodes.filter(n => n.id !== d.id).map(n => `<option value="${esc(n.id)}">${esc(n.nom)}</option>`).join('')}
                    </select>
                    <input type="text" id="rel-type" placeholder="Type (Patronage, Rival…)">
                    <input type="text" id="rel-label" placeholder="Label (optionnel)">
                    ${renderPalette('#c9a84c', 'rel-color')}
                    <div class="rel-style-row">
                        <div class="rel-style-toggle">
                            <button type="button" class="style-btn active" data-style="solid" title="Continu">━━</button>
                            <button type="button" class="style-btn" data-style="dashed" title="Pointillé">╌╌</button>
                        </div>
                    </div>
                    <label class="rel-bidir-label">
                        <input type="checkbox" id="rel-bidir"> Bidirectionnel
                    </label>
                    <div class="rel-form-btns">
                        <button id="rel-save-btn" class="btn-primary-sm">Ajouter</button>
                        <button id="rel-cancel-btn" class="btn-ghost-sm">Annuler</button>
                    </div>
                </div>` : ''}
        </div>`;

    // Interroge Firestore pour les indices liés à ce PNJ.
    // Note : la contrainte decouvert == true est requise par la règle Firestore
    // pour les non-MJ ; ne pas la retirer sous peine de refus d'autorisation.
    let linkedClues = [];
    try {
        const indicesRef = collection(db, 'indices');
        let q;
        if (panelRole) {
            q = query(indicesRef, where('pnjsLies', 'array-contains', d.id));
        } else {
            q = query(indicesRef, where('pnjsLies', 'array-contains', d.id), where('decouvert', '==', true));
        }
        const querySnapshot = await getDocs(q);
        linkedClues = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
        if (!panelIsCurrent()) return;
        console.error("Erreur lors de la récupération des indices liés :", e);
    }

    if (!panelIsCurrent()) return;

    const cluesHtml = linkedClues.length ? `
        <div class="pnj-detail-section">
            <h4>Indices liés</h4>
            <div class="pnj-clues-list">
                ${linkedClues.map(c => `
                    <a href="enquetes.html?id=${esc(c.id)}" class="pnj-clue-badge${!c.decouvert ? ' clue-hidden' : ''}">
                        🔎 ${esc(c.titre)}${!c.decouvert ? ' 👁️ (Non découvert)' : ''}
                    </a>
                `).join('')}
            </div>
        </div>` : '';

    document.getElementById('pnj-detail-content').innerHTML = `
        ${portraitHtml}
        <div class="pnj-detail-header">
            <h2>${esc(d.nom || '?')}</h2>
            <div class="pnj-badges">
                <span class="pnj-badge statut-${esc((d.statut || '').toLowerCase())}">${esc(cap(d.statut) || '?')}</span>
                <span class="pnj-badge vivant-${esc(vKey)}">${esc(vLabel)}</span>
            </div>
        </div>
        ${editActions}${metaHtml}${descHtml}${relHtml}${cluesHtml}`;

    document.getElementById('pnj-detail').classList.add('open');
    highlightConnected(d.id);
}

function closePanel() {
    currentPanelGeneration += 1;
    document.getElementById('pnj-detail').classList.remove('open');
    state.panelId = null;
    updateVisibility();
}

function resetPnjView() {
    currentPanelGeneration += 1;
    clearPnjAdminStatuses();
    if (state.simulation) { state.simulation.stop(); state.simulation = null; }
    d3.select('#pnj-graph svg').remove();
    state.nodeSel = null;
    state.linkSel = null;
    state.linkLabelSel = null;
    state.dimColorMap = null;
    state.panelId = null;
    state.searchQ = '';
    clearFilters();
    document.getElementById('pnj-search').value = '';
    document.getElementById('pnj-table-container').innerHTML = '';
    document.getElementById('pnj-detail-content').innerHTML = '';
    document.getElementById('pnj-detail').classList.remove('open');
    document.getElementById('pnj-empty').style.display = 'flex';
    document.getElementById('graph-legend').style.display = 'none';
    document.getElementById('pnj-loading').style.display = 'flex';
    document.getElementById('pnj-loading').querySelector('.pnj-spinner').style.display = '';
    document.getElementById('pnj-loading').querySelector('.loading-text').textContent = 'Chargement des personnages...';
}

function highlightConnected(id) {
    const connected = new Set([id]);
    state.links.forEach(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        if (s === id) connected.add(t);
        if (t === id) connected.add(s);
    });
    state.nodeSel?.style('opacity', d => isVisible(d) ? (connected.has(d.id) ? getNodeOpacity(d) : 0.05) : 0.02);
    state.linkSel?.style('opacity', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return (s === id || t === id) ? 0.9 : 0.04;
    });
    state.linkLabelSel?.style('opacity', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return (s === id || t === id) ? 0.8 : 0;
    });
}

// ── Detail panel events (délégation — bindé une seule fois) ────
document.getElementById('pnj-detail-content').addEventListener('click', e => {
    const chip = e.target.closest('.pnj-relation-chip');
    if (chip) {
        const n = state.nodes.find(n => n.id === chip.dataset.id);
        if (n) openPanel(n);
        return;
    }

    const delBtn = e.target.closest('.rel-delete-btn');
    if (delBtn) {
        void deleteRelation(delBtn.dataset.rel).catch(error => alert(`Suppression de la relation impossible : ${error.message}`));
        return;
    }

    if (e.target.closest('#panel-edit-btn')) { openPnjModal(state.panelId); return; }

    const styleBtn = e.target.closest('.style-btn');
    if (styleBtn) {
        styleBtn.closest('.rel-style-toggle').querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        styleBtn.classList.add('active');
        return;
    }

    const swatch = e.target.closest('.color-swatch');
    if (swatch) {
        const palette = swatch.closest('.rel-color-palette');
        palette.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        const inp = document.getElementById(palette.dataset.input);
        if (inp) inp.value = swatch.dataset.color;
        return;
    }

    const relEditBtn = e.target.closest('.rel-edit-btn');
    if (relEditBtn) {
        // Fermer toute édition ouverte
        document.querySelectorAll('.rel-edit-form-inline').forEach(f => {
            document.getElementById(f.dataset.chipRowId)?.style.removeProperty('display');
            f.remove();
        });
        const relId = relEditBtn.dataset.rel;
        const link = state.links.find(l => l.id === relId);
        if (!link) return;
        const currentColor = safeRelationColor(link.color, link.type);
        const currentStyle = link.style || 'solid';
        const formHtml = `
            <div class="rel-edit-form-inline" data-rel="${esc(relId)}" data-chip-row-id="rel-row-${esc(relId)}">
                <input type="text" class="rel-edit-type" value="${esc(link.type || '')}" placeholder="Type">
                <input type="text" class="rel-edit-label" value="${esc(link.label || '')}" placeholder="Label">
                ${renderPalette(currentColor, 'rel-edit-color')}
                <div class="rel-style-row">
                    <div class="rel-style-toggle">
                        <button type="button" class="style-btn${currentStyle === 'solid' ? ' active' : ''}" data-style="solid" title="Continu">━━</button>
                        <button type="button" class="style-btn${currentStyle === 'dashed' ? ' active' : ''}" data-style="dashed" title="Pointillé">╌╌</button>
                    </div>
                </div>
                <div class="rel-form-btns">
                    <button class="btn-primary-sm rel-edit-save-btn" data-rel="${esc(relId)}">Enregistrer</button>
                    <button class="btn-ghost-sm rel-edit-cancel-btn">Annuler</button>
                </div>
            </div>`;
        const chipRow = document.getElementById(`rel-row-${relId}`);
        if (chipRow) { chipRow.style.display = 'none'; chipRow.insertAdjacentHTML('afterend', formHtml); }
        return;
    }

    if (e.target.closest('.rel-edit-save-btn')) {
        const btn = e.target.closest('.rel-edit-save-btn');
        const form = btn.closest('.rel-edit-form-inline');
        void updateRelation(
            form.dataset.rel,
            form.querySelector('.rel-edit-type').value.trim(),
            form.querySelector('.rel-edit-label').value.trim(),
            document.getElementById('rel-edit-color')?.value || REL_PALETTE[0],
            form.querySelector('.style-btn.active')?.dataset.style || 'solid',
        ).catch(error => alert(`Modification de la relation impossible : ${error.message}`));
        return;
    }

    if (e.target.closest('.rel-edit-cancel-btn')) {
        const form = e.target.closest('.rel-edit-form-inline');
        document.getElementById(form.dataset.chipRowId)?.style.removeProperty('display');
        form.remove();
        return;
    }

    if (e.target.closest('#add-rel-btn')) {
        document.getElementById('rel-add-form').style.display = 'block';
        document.getElementById('add-rel-btn').style.display  = 'none';
        return;
    }

    if (e.target.closest('#rel-cancel-btn')) {
        document.getElementById('rel-add-form').style.display = 'none';
        document.getElementById('add-rel-btn').style.display  = '';
        return;
    }

    if (e.target.closest('#rel-save-btn')) {
        void saveRelation(
            state.panelId,
            document.getElementById('rel-target').value,
            document.getElementById('rel-type').value.trim(),
            document.getElementById('rel-label').value.trim(),
            document.getElementById('rel-color').value,
            document.querySelector('#rel-add-form .style-btn.active')?.dataset.style || 'solid',
            document.getElementById('rel-bidir')?.checked || false,
        ).catch(error => alert(`Création de la relation impossible : ${error.message}`));
        return;
    }
});

// ── Table ──────────────────────────────────────────────────────
function renderTable() {
    const container = document.getElementById('pnj-table-container');
    const sorted = [...state.nodes.filter(isVisible)].sort((a, b) =>
        state.sortDir * (a[state.sortCol] || '').localeCompare(b[state.sortCol] || '', 'fr', { sensitivity: 'base' }));

    const thead = '<th class="col-portrait"></th>' + TABLE_COLS.map(c => {
        const arrow = c.key === state.sortCol ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '';
        return `<th data-col="${esc(c.key)}" class="sortable">${esc(c.label)}${arrow}</th>`;
    }).join('') + (state.isAdmin ? '<th></th>' : '');

    const tbody = sorted.map(d => {
        const portraitCell = d.imageUrl
            ? `<td class="col-portrait"><img src="${esc(d.imageUrl)}" class="table-portrait" alt="${esc(d.nom)}"></td>`
            : `<td class="col-portrait">${protectedImagePlaceholder(d, d.nom) || `<div class="table-portrait-placeholder">${esc((d.nom || '?').charAt(0).toUpperCase())}</div>`}</td>`;

        const cells = TABLE_COLS.map(c => {
            if (c.key === 'statut') return `<td><span class="pnj-badge statut-${esc((d.statut || '').toLowerCase())}">${esc(cap(d.statut) || '—')}</span></td>`;
            if (c.key === 'vivant') {
                const vk = (d.vivant || '').toLowerCase();
                return `<td><span class="pnj-badge vivant-${esc(vk)}">${esc({ oui: 'Vivant', non: 'Décédé', inconnu: 'Inconnu' }[vk] || d.vivant || '—')}</span></td>`;
            }
            if (c.key === 'description') {
                const full = d.description || '', short = full.length > 90 ? full.slice(0, 90) + '…' : full;
                return `<td class="pnj-td-desc" title="${esc(full)}">${esc(short || '—')}</td>`;
            }
            return `<td>${esc(d[c.key] || '—')}</td>`;
        }).join('');
        const editCell = state.isAdmin ? `<td><button class="btn-edit-sm" data-id="${esc(d.id)}">✏</button></td>` : '';
        return `<tr>${portraitCell}${cells}${editCell}</tr>`;
    }).join('');

    container.innerHTML = `
        <p class="pnj-table-count">${sorted.length} personnage${sorted.length !== 1 ? 's' : ''}</p>
        <div class="pnj-table-scroll">
            <table class="rules-table pnj-table-el">
                <thead><tr>${thead}</tr></thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>`;

    container.querySelectorAll('th.sortable').forEach(th =>
        th.addEventListener('click', () => {
            state.sortDir = state.sortCol === th.dataset.col ? state.sortDir * -1 : 1;
            state.sortCol = th.dataset.col;
            renderTable();
        }));
    container.querySelectorAll('.btn-edit-sm').forEach(btn =>
        btn.addEventListener('click', () => openPnjModal(btn.dataset.id)));
}

// ── View toggle ────────────────────────────────────────────────
function setView(view) {
    state.view = view;
    document.getElementById('pnj-graph').style.display           = view === 'graph' ? '' : 'none';
    document.getElementById('pnj-table-container').style.display = view === 'table' ? '' : 'none';
    document.getElementById('colorby-group').style.display       = view === 'graph' ? '' : 'none';
    document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'table') renderTable();
}

// ── Events ─────────────────────────────────────────────────────
document.getElementById('pnj-search').addEventListener('input', e => {
    state.searchQ = e.target.value.trim();
    updateVisibility();
    if (state.view === 'table') renderTable();
});
document.getElementById('pnj-detail-close').addEventListener('click', closePanel);
document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
document.querySelectorAll('.colorby-btn').forEach(btn => btn.addEventListener('click', () => applyColorBy(btn.dataset.dim)));

loadData({ init: true });

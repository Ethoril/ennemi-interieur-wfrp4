import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { createBureauData } from './bureau-data.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import Cropper from 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.esm.js';
import { esc, cap, stripAccents } from './utils.js';
import { confirmAction } from './ui-confirm.js';
import { visiblePourJoueurs } from './visibility.js';
import { createRenderGate, createPendingRecovery } from './bureau-view-lifecycle.js';
import { legacyPrivateNoteInfo, privateLoadCanApply } from './private-notes.js';
import { isCurrentLoad, isCurrentPanel, isCurrentGeneration } from './load-generation.js';
import { reconcileFilterSets, panelIsStillCurrent, safeRelationColorValue } from './pnj-integrity.js';

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
    zoomTransform: null,
    sortCol: 'nom', sortDir: 1,
    editingId: null, panelId: null,
    croppedBlob: null,
    privateLoadId: 0,
    privateDocExists: false,
    privateLoadError: false,
    editingUpdatedAt: null,
};

let currentLoadId = 0;
let editorSession = 0;
let authSessionKey = '';
let currentPanelGeneration = 0;
let cropperInstance = null;
let cropGeneration = 0;
let cropSourceUrl = null;
let localPreviewUrl = null;
window.addEventListener('pagehide', () => {
    bureauGeneration += 1;
    currentLoadId += 1;
    editorSession += 1;
    closePnjModal();
    closePanel();
    cancelLinkedIndices();
    document.getElementById('pnj-form')?.reset();
    if (document.getElementById('f-notes-privees')) document.getElementById('f-notes-privees').value = '';
    if (document.getElementById('pnj-private-status')) document.getElementById('pnj-private-status').textContent = '';
    state.nodes = [];
    state.links = [];
    d3.select('#pnj-graph svg').remove();
    renderTable();
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    unsubscribePnjs?.();
    unsubscribeRelations?.();
    unsubscribePrivateNotes?.();
    renderedImageHandles.forEach(release => release());
    renderedImageHandles.clear();
    void bureauData?.close();
    bureauData = null;
});
window.addEventListener('pageshow', () => {
    if (!unsubscribeAuth) unsubscribeAuth = watchAuth(handleAuth);
});
let bureauData = null;
let unsubscribePnjs = null;
let unsubscribeRelations = null;
let unsubscribePrivateNotes = null;
let unsubscribeLinkedIndices = null;
let linkedIndicesGeneration = 0;
let bureauGeneration = 0;
const renderedImageHandles = new Map();

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

function showPnjReadStatus(metadata, error = null) {
    const target = document.getElementById('pnj-read-status') || document.createElement('p');
    target.id = 'pnj-read-status';
    target.className = 'pnj-cleanup-status';
    target.textContent = error ? 'Lecture PNJs/relations indisponible ; les dernières données restent affichées.'
        : metadata?.fromCache ? (metadata.hasPendingWrites ? 'Données locales, écritures en attente.' : 'Données locales en cours de synchronisation.')
            : metadata?.hasPendingWrites ? 'Écriture en attente de confirmation serveur.' : '';
    if (target.textContent) document.getElementById('pnj-loading')?.after(target);
    else target.remove();
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

function repositoryPnjToPage(node) {
    return {
        ...node,
        imagePath: node?.imagePath || '',
        imageUrl: node?.imagePath ? '' : (node?.imageUrl || ''),
        legacyImageUrl: node?.imagePath ? '' : (node?.imageUrl || ''),
    };
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

function clearPnjAdminStatuses() {
    document.getElementById('pnj-deletion-status')?.remove();
    document.getElementById('pnj-read-status')?.remove();
    document.getElementById('pnj-image-recovery-status')?.remove();
}

function showPnjImageRecoveryStatus(message, recover) {
    const status = document.getElementById('pnj-image-recovery-status') || document.createElement('p');
    status.id = 'pnj-image-recovery-status';
    status.className = 'pnj-cleanup-status';
    status.textContent = message;
    status.querySelector('button')?.remove();
    if (recover) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-ghost-sm';
        button.textContent = 'Reprendre le nettoyage';
        button.addEventListener('click', recover, { once: true });
        status.append(' ', button);
    }
    document.getElementById('pnj-loading')?.after(status);
}

function retryPendingPnjCleanupIfNeeded() {
    void bureauData?.images?.recover?.().catch(error => console.warn('Reprise image PNJ différée.', error));
}

const globalPnjRecovery = createPendingRecovery(generation => performGlobalPnjDeletionLockRecovery(generation));

function recoverGlobalPnjDeletionLock() {
    return globalPnjRecovery.request(bureauGeneration);
}

async function performGlobalPnjDeletionLockRecovery(expectedGeneration) {
    if (!state.isAdmin || expectedGeneration !== bureauGeneration || !bureauData?.pnjs?.inspectRemovalLock) return;
    const recoveryAuthKey = authSessionKey;
    const capturedData = bureauData;
    const capturedRepository = capturedData.pnjs;
    const capturedGeneration = bureauGeneration;
    const stillCurrent = () => recoveryAuthKey === authSessionKey && capturedGeneration === bureauGeneration
        && capturedData === bureauData && capturedRepository === bureauData?.pnjs && state.isAdmin;
    try {
        const lock = await capturedRepository.inspectRemovalLock();
        if (!stillCurrent()) return;
        if (!lock?.pnjId) {
            document.getElementById('pnj-deletion-status')?.remove();
            return;
        }
        const node = state.nodes.find(item => item.id === lock.pnjId);
        if (node) {
            showPnjDeletionStatus('Suppression PNJ ' + lock.pnjId + ' verrouillée : reprenez la cascade.', {
                label: 'Reprendre',
                run: () => {
                    if (!stillCurrent()) return;
                    void capturedRepository.resumeRemoval(lock.pnjId).then(() => {
                        if (stillCurrent()) document.getElementById('pnj-deletion-status')?.remove();
                    }).catch(error => {
                        if (!stillCurrent()) return;
                    showPnjDeletionStatus('Reprise du verrou PNJ impossible : vérifiez la connexion.', {
                        label: 'Réessayer', run: () => void recoverGlobalPnjDeletionLock(),
                    });
                    console.warn('Reprise du verrou PNJ différée.', { error: error?.message });
                    });
                },
            });
            return;
        }
        await capturedRepository.resumeRemoval(lock.pnjId);
        if (stillCurrent()) document.getElementById('pnj-deletion-status')?.remove();
    } catch (error) {
        if (!stillCurrent()) return;
        showPnjDeletionStatus('Reprise du verrou PNJ impossible : vérifiez la connexion.', {
            label: 'Réessayer', run: () => void recoverGlobalPnjDeletionLock(),
        });
        console.warn('Reprise du verrou global PNJ différée.', { error: error?.message });
    }
}
// ── Auth ───────────────────────────────────────────────────────
function handleAuth(user, isAdmin) {
    const nextBureauGeneration = ++bureauGeneration;
    const roleChanged = state.isAdmin !== isAdmin;
    const nextAuthSessionKey = user?.uid || '';
    const identityChanged = authSessionKey !== nextAuthSessionKey;
    authSessionKey = nextAuthSessionKey;
    state.isAdmin = isAdmin;
    if (isAdmin) {
        retryPendingPnjCleanupIfNeeded();
        void recoverGlobalPnjDeletionLock();
    }
    document.getElementById('auth-btn').textContent = state.isAdmin ? '🔓 Déconnexion' : '🔑 Admin';
    document.getElementById('add-pnj-btn').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('pnj-private-fields').style.display = state.isAdmin ? '' : 'none';
    if (roleChanged || identityChanged) {
        cancelLinkedIndices();
        unsubscribePnjs?.();
        unsubscribeRelations?.();
        unsubscribePnjs = null;
        unsubscribeRelations = null;
        unsubscribePrivateNotes?.();
        unsubscribePrivateNotes = null;
        const previousData = bureauData;
        bureauData = null;
        void previousData?.close().catch(error => console.warn('Fermeture du client bureau différée.', error));
        try { bureauData = createBureauData({ isAdmin }); }
        catch (error) {
            console.error('Initialisation des dépôts bureau impossible.', error);
            bureauData = null;
        }
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
    if (roleChanged || identityChanged || !bureauData) {
        if (!bureauData) {
            try { bureauData = createBureauData({ isAdmin }); }
            catch (error) { console.error('Initialisation des dépôts bureau impossible.', error); }
        }
        void loadData({ init: true, generation: nextBureauGeneration });
        return;
    }
    if (state.panelId) {
        const node = state.nodes.find(n => n.id === state.panelId);
        if (node) openPanel(node);
    }
    if (state.view === 'table') renderTable();
}
let unsubscribeAuth = watchAuth(handleAuth);


document.getElementById('auth-btn').addEventListener('click', async () => {
    if (state.isAdmin) {
        await logout();
    } else {
        try { await loginWithGoogle(); }
        catch (e) { if (e.code !== 'auth/popup-closed-by-user') alert('Connexion impossible : ' + e.message); }
    }
});

// ── Data ───────────────────────────────────────────────────────
async function loadData({ init = false, generation = bureauGeneration } = {}) {
    const loadId = ++currentLoadId;
    try {
        if (generation !== bureauGeneration || !bureauData) return;
        if (state.isAdmin) {
            retryPendingPnjCleanupIfNeeded();
            void recoverGlobalPnjDeletionLock();
        }
        const onError = error => {
            if (generation !== bureauGeneration || !isCurrentLoad(loadId, currentLoadId)) return;
            console.error('Erreur de lecture temps réel PNJs/relations.', error);
            showPnjReadStatus(null, error);
            const target = document.getElementById('pnj-loading');
            if (target && init) target.querySelector('.loading-text')?.replaceChildren(
                document.createTextNode('Impossible de charger les données. Réessayez dans un instant.'),
            );
        };
        const render = async (nodes, relations, token) => {
            if (generation !== bureauGeneration || !isCurrentLoad(loadId, currentLoadId) || !renderGate.isCurrent(token)) return;
            const previousPanelId = state.panelId;
            renderedImageHandles.forEach(release => release());
            renderedImageHandles.clear();
            state.nodes = nodes.map(repositoryPnjToPage).filter(node => state.isAdmin || visiblePourJoueurs(node));
            const nodeIds = new Set(state.nodes.map(node => node.id));
            if (state.editingId && !nodeIds.has(state.editingId)) {
                closePnjModal();
                showPnjDeletionStatus('Ce PNJ n’est plus visible ou a été supprimé.', null);
            }
            if (state.panelId && !nodeIds.has(state.panelId)) {
                closePnjModal();
                closePanel();
                showPnjDeletionStatus('Ce PNJ n’est plus visible ou a été supprimé.', null);
            }
            state.links = relations.filter(link => nodeIds.has(link.source) && nodeIds.has(link.cible))
                .map(link => ({ ...link, target: link.cible }));
            bureauData.relations.setVisiblePnjIds?.([...nodeIds]);
            await Promise.all(state.nodes.map(async node => {
            node.legacyImageUrl = node.imageUrl || '';
            if (!node.imagePath) {
                node.imageState = node.imageUrl ? 'legacy' : 'missing';
                node.imageError = null;
                return;
            }
            try {
                const handle = bureauData.images.loadObjectUrl(node.imagePath);
                const result = await handle;
                if (generation !== bureauGeneration || !renderGate.isCurrent(token)) { result.release?.(); return; }
                renderedImageHandles.set(node.id, result.release);
                node.imageState = 'ready';
                node.imageError = null;
                node.imageUrl = result.url;
            } catch (error) {
                node.imageState = ['storage/unauthorized', 'storage/unauthenticated'].includes(error?.cause?.code)
                    ? 'access-denied' : 'missing';
                node.imageError = error?.code || null;
                node.imageUrl = '';
            }
            }));
            if (generation !== bureauGeneration || !isCurrentLoad(loadId, currentLoadId) || !renderGate.isCurrent(token)) return;

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
            else if (previousPanelId) {
                const node = state.nodes.find(item => item.id === previousPanelId);
                if (node) openPanel(node);
            }
        };
        unsubscribePnjs?.();
        unsubscribeRelations?.();
        const pnjSubscribe = state.isAdmin ? bureauData.pnjs.subscribeAll : bureauData.pnjs.subscribeVisible;
        const relationSubscribe = state.isAdmin ? bureauData.relations.subscribeAll : bureauData.relations.subscribeVisible;
        let latestNodes = [];
        let latestRelations = [];
        const renderGate = createRenderGate();
        const update = () => {
            const token = renderGate.next();
            void render(latestNodes, latestRelations, token);
        };
        unsubscribePnjs = pnjSubscribe.call(bureauData.pnjs, (nodes, metadata) => {
            latestNodes = nodes;
            showPnjReadStatus(metadata);
            update();
        }, onError);
        unsubscribeRelations = relationSubscribe.call(bureauData.relations, (relations, metadata) => {
            latestRelations = relations;
            showPnjReadStatus(metadata);
            update();
        }, onError, { visiblePnjIds: state.nodes.map(node => node.id) });

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
    const capturedData = bureauData;
    const pnjRepository = capturedData?.pnjs;
    const editorStillCurrent = () => capturedSession === editorSession
        && capturedEditingId === state.editingId && capturedRole === state.isAdmin
        && document.getElementById('pnj-modal')?.style.display !== 'none'
        && capturedData === bureauData;
    const requireCurrentEditor = () => { if (!editorStillCurrent()) throw new Error('Édition annulée : la session ou le rôle a changé.'); };
    btn.disabled = true;
    btn.textContent = imageFile ? 'Upload…' : 'Enregistrement…';
    try {
        if (!pnjRepository || !capturedData?.images || !state.isAdmin) throw new Error('Session MJ indisponible.');
        if (capturedEditingId && state.privateLoadError) {
            throw new Error('Notes privées indisponibles : enregistrement annulé. Vérifiez les règles M1-02.');
        }
        requireCurrentEditor();
        const id = capturedEditingId || `pnj-${Date.now().toString(36)}`;
        const previousImagePath = data.imagePath || '';
        const publicData = {
            nom: data.nom || '', statut: data.statut || '', vivant: data.vivant || 'oui',
            lieu: data.lieu || '', groupe: data.groupe || '', description: data.description || '',
            visibleJoueurs: data.visibleJoueurs !== false,
        };
        if (data.imagePath) publicData.imagePath = data.imagePath;
        const privateData = { notes: data.notesPrivees || '' };
        let result;
        const expectedUpdatedAt = state.editingUpdatedAt;
        const commitPnj = async imagePath => {
            requireCurrentEditor();
            const nextPublicData = imagePath ? { ...publicData, imagePath } : publicData;
            return capturedEditingId
                ? pnjRepository.update(capturedEditingId, nextPublicData, privateData, expectedUpdatedAt)
                : pnjRepository.create(nextPublicData, privateData, { id });
        };
        if (imageFile) {
            btn.textContent = 'Upload…';
            result = await capturedData.images.replace(previousImagePath || null,
                { kind: 'portrait', ownerId: id }, imageFile, { commit: commitPnj });
        } else {
            result = capturedEditingId
                ? await pnjRepository.update(capturedEditingId, publicData, privateData, expectedUpdatedAt)
                : await pnjRepository.create(publicData, privateData, { id });
        }
        requireCurrentEditor();
        void result;
        const prevEditingId = capturedEditingId;
        closePnjModal();
        await loadData();
        if (capturedSession !== editorSession || capturedData !== bureauData) return;
        if (prevEditingId && panelIsStillCurrent({
            capturedGeneration: capturedPanelGeneration, currentGeneration: currentPanelGeneration,
            capturedId: capturedPanelId, currentId: state.panelId,
        })) {
            const node = state.nodes.find(n => n.id === prevEditingId);
            if (node) openPanel(node);
        }
    } catch (e) {
        const imageState = e?.state;
        if (imageState?.commitDone || imageState?.commitUnknown) {
            const message = imageState.commitDone
                ? 'PNJ enregistré ; le nettoyage de l’ancien portrait reste à reprendre.'
                : 'État du portrait incertain ; la sauvegarde doit être réconciliée avant une nouvelle tentative.';
            const recoveryGeneration = bureauGeneration;
            const recover = () => {
                if (capturedData !== bureauData || recoveryGeneration !== bureauGeneration) return;
                void capturedData.images.recover().then(() => {
                    if (capturedData !== bureauData || recoveryGeneration !== bureauGeneration) return;
                    showPnjImageRecoveryStatus('Nettoyage du portrait repris.', null);
                }).catch(() => {
                    if (capturedData !== bureauData || recoveryGeneration !== bureauGeneration) return;
                    showPnjImageRecoveryStatus('Reprise impossible pour le moment. Réessayez.', recover);
                });
            };
            const wasCurrent = editorStillCurrent();
            if (wasCurrent && imageState.commitDone) {
                closePnjModal();
                await loadData();
            }
            showPnjImageRecoveryStatus(message, recover);
            if (imageState.commitUnknown) alert(message);
        } else {
            alert('Erreur : ' + e.message);
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
    }
}

async function deletePnj(id) {
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const repository = bureauData?.pnjs;
    const capturedPanelGeneration = currentPanelGeneration;
    const capturedPanelId = state.panelId;
    const stillCurrent = () => capturedSession === editorSession && capturedRole === state.isAdmin
        && capturedRole && capturedPanelGeneration === currentPanelGeneration
        && capturedPanelId === state.panelId && repository === bureauData?.pnjs;
    const pnj = state.nodes.find(node => node.id === id);
    const ok = await confirmAction({
        titre: 'Supprimer le personnage',
        message: (pnj?.nom || 'Ce personnage') + ' sera définitivement supprimé avec ses relations et indices liés.',
        libelleAction: 'Supprimer', danger: true,
    });
    if (!ok || !stillCurrent()) return;
    if (!repository?.remove) { alert('Dépôt PNJ indisponible.'); return; }
    try {
        if (!stillCurrent()) return;
        await repository.remove(id);
        if (!stillCurrent()) return;
        closePnjModal();
        closePanel();
    } catch (error) {
        if (!stillCurrent()) return;
        const message = error?.state?.imageCleanupPending
            ? 'PNJ supprimé dans Firestore ; le nettoyage du portrait sera repris automatiquement.'
            : 'Suppression impossible : ' + (error?.message || 'réessayez plus tard.');
        alert(message);
    }
}

async function saveRelation(sourceId, cibleId, type, label, color, style, bidir) {
    if (!sourceId || !cibleId || !type) { alert('Choisissez un PNJ et entrez un type de relation.'); return; }
    if (sourceId === cibleId) { alert('Un PNJ ne peut pas être relié à lui-même.'); return; }
    const repository = bureauData?.relations;
    if (!repository?.create) { alert('Dépôt relations indisponible.'); return; }
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const capturedGeneration = currentPanelGeneration;
    const panelId = state.panelId;
    const stillCurrent = () => capturedRole && state.isAdmin && capturedSession === editorSession
        && capturedGeneration === currentPanelGeneration && panelId === state.panelId
        && repository === bureauData?.relations;
    try {
        const result = await repository.create({ source: sourceId, cible: cibleId, type,
            label: label || type, color: safeRelationColor(color, type),
            style: style === 'dashed' ? 'dashed' : 'solid', visibleJoueurs: true }, bidir);
        if (!stillCurrent()) return;
        void result;
        const node = state.nodes.find(item => item.id === sourceId);
        if (node) openPanel(node);
    } catch (error) { if (stillCurrent()) alert('Création de la relation impossible : ' + (error?.message || 'réessayez.')); }
}

async function updateRelation(relId, type, label, color, style) {
    if (!type) { alert('Le type de relation est requis.'); return; }
    const repository = bureauData?.relations;
    if (!repository?.update) { alert('Dépôt relations indisponible.'); return; }
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const capturedGeneration = currentPanelGeneration;
    const panelId = state.panelId;
    const capturedRepository = repository;
    const current = state.links.find(relation => relation.id === relId);
    const reciprocal = current?.reciprocalId ? state.links.find(relation => relation.id === current.reciprocalId) : null;
    const pair = Boolean(reciprocal && reciprocal.source === current?.cible && reciprocal.cible === current?.source);
    const stillCurrent = () => capturedRole && state.isAdmin && capturedSession === editorSession
        && capturedGeneration === currentPanelGeneration && panelId === state.panelId
        && capturedRepository === bureauData?.relations;
    try {
        if (!stillCurrent()) return;
        await repository.update(relId, {
            type, label: label || type, color: color ? safeRelationColor(color, type) : undefined,
            style: style === 'dashed' ? 'dashed' : 'solid',
        }, current?.updatedAt, pair ? { pair: true, reciprocalId: reciprocal.id } : {});
        if (!stillCurrent()) return;
        const node = state.nodes.find(item => item.id === panelId);
        if (node) openPanel(node);
    } catch (error) { if (stillCurrent()) alert('Modification de la relation impossible : ' + (error?.message || 'réessayez.')); }
}

async function deleteRelation(relId) {
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const capturedGeneration = currentPanelGeneration;
    const capturedPanelId = state.panelId;
    const repository = bureauData?.relations;
    if (!repository?.remove) { alert('Dépôt relations indisponible.'); return; }
    const current = state.links.find(relation => relation.id === relId);
    const reciprocal = current?.reciprocalId ? state.links.find(relation => relation.id === current.reciprocalId) : null;
    const pair = Boolean(reciprocal && reciprocal.source === current?.cible && reciprocal.cible === current?.source);
    const stillCurrent = () => capturedRole && state.isAdmin && capturedSession === editorSession
        && capturedGeneration === currentPanelGeneration && capturedPanelId === state.panelId
        && repository === bureauData?.relations;
    const ok = await confirmAction({ titre: 'Supprimer la relation',
        message: 'Cette relation sera définitivement supprimée.', libelleAction: 'Supprimer', danger: true });
    if (!ok || !stillCurrent()) return;
    try {
        if (!stillCurrent()) return;
        await repository.remove(relId, pair ? { pair: true, reciprocalId: reciprocal.id } : false);
        if (!stillCurrent()) return;
    } catch (error) { if (stillCurrent()) alert('Suppression de la relation impossible : ' + (error?.message || 'réessayez.')); }
}

// ── PNJ Modal ──────────────────────────────────────────────────
function openPnjModal(pnjId = null) {
    editorSession += 1;
    // Invalide toute lecture privée encore en vol avant de réinitialiser le formulaire.
    state.privateLoadId += 1;
    closeCropModal();
    state.editingId  = pnjId;
    state.editingUpdatedAt = null;
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
            state.editingUpdatedAt = p.updatedAt ?? null;
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
    const capturedGeneration = bureauGeneration;
    const capturedAuth = authSessionKey;
    const canApply = () => privateLoadCanApply(loadId, state.privateLoadId, state.isAdmin)
        && capturedGeneration === bureauGeneration && capturedAuth === authSessionKey;
    unsubscribePrivateNotes?.();
    unsubscribePrivateNotes = null;
    try {
        if (!bureauData?.pnjs?.subscribePrivate) throw new Error('Dépôt privé indisponible.');
        unsubscribePrivateNotes = bureauData.pnjs.subscribePrivate(pnjId, snap => {
            if (!canApply()) return;
            state.privateDocExists = Boolean(snap);
            if (snap) {
            if (snap.issues?.some(issue => issue.field === 'notes')) {
                state.privateLoadError = true;
                document.getElementById('pnj-private-status').textContent = 'Notes privées invalides : correction manuelle requise.';
                return;
            }
                const notes = snap.notes;
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
        }, () => {
            if (canApply()) {
                state.privateLoadError = true;
                document.getElementById('f-notes-privees').value = legacyNote(pnj);
                document.getElementById('pnj-private-status').textContent = `Lecture des notes privées impossible : sauvegarde désactivée.${legacyNoteError(pnj) ? ` ${legacyNoteError(pnj)}` : ''}`;
            }
        });
    } catch {
        if (canApply()) {
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
    state.editingUpdatedAt = null;
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
    const zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => {
        state.zoomTransform = e.transform;
        g.attr('transform', e.transform);
    });
    svg.call(zoom);
    svg.call(zoom.transform, state.zoomTransform || d3.zoomIdentity
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
function readLinkedIndices(pnjId) {
    if (!bureauData?.indices?.subscribeLinked) return Promise.resolve([]);
    const capturedData = bureauData;
    const capturedAuth = authSessionKey;
    const capturedGeneration = currentPanelGeneration;
    const token = ++linkedIndicesGeneration;
    return new Promise((resolve, reject) => {
        let sourceUnsubscribe = null;
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            sourceUnsubscribe?.();
            if (unsubscribeLinkedIndices === sourceUnsubscribe) unsubscribeLinkedIndices = null;
            const current = token === linkedIndicesGeneration && capturedData === bureauData
                && capturedAuth === authSessionKey && capturedGeneration === currentPanelGeneration;
            callback(current ? value : (callback === resolve ? [] : new Error('Lecture obsolète')));
        };
        try {
            sourceUnsubscribe = capturedData.indices.subscribeLinked(pnjId,
                items => finish(resolve, items),
                error => finish(reject, error));
            if (!settled) unsubscribeLinkedIndices = sourceUnsubscribe;
            else sourceUnsubscribe?.();
        } catch (error) { finish(reject, error); }
    });
}

function cancelLinkedIndices() {
    linkedIndicesGeneration += 1;
    const unsubscribe = unsubscribeLinkedIndices;
    unsubscribeLinkedIndices = null;
    unsubscribe?.();
}

async function openPanel(d) {
    const panelGeneration = ++currentPanelGeneration;
    cancelLinkedIndices();
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

    let linkedClues = [];
    try {
        linkedClues = await readLinkedIndices(d.id);
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
    cancelLinkedIndices();
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

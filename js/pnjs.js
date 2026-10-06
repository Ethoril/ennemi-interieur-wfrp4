import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { createBureauData } from './bureau-data.js';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
import Cropper from 'https://cdn.jsdelivr.net/npm/cropperjs@1.6.2/dist/cropper.esm.js';
import { esc, cap, stripAccents } from './utils.js';
import { confirmAction } from './ui-confirm.js';
import { visiblePourJoueurs } from './visibility.js';
import { createPendingRecovery } from './bureau-view-lifecycle.js';
import { legacyPrivateNoteInfo, privateLoadCanApply } from './private-notes.js';
import { isCurrentLoad, isCurrentPanel, isCurrentGeneration } from './load-generation.js';
import { reconcileFilterSets, panelIsStillCurrent, safeRelationColorValue } from './pnj-integrity.js';
import { statutLabel, vivantLabel, sealMarkup, morrMarkup } from './seal.js';
import { pnjGroups, groupCatalog, groupLabel, groupKey, matchesGroupFilter } from './pnj-groups.js';
import { createGroupPicker } from './pnj-group-picker.js';
import { mountContentTrashPanel, mountContributionButton } from './contributions/editor.js';
import { newContributionOperationId, loadContentEditContext, mutateContentThroughGateway, trashManagedContent, uploadManagedImage } from './contributions/managed-commands.js';
import { assignCurveLanes, graphRelations, bezierPath, curveHandlePoint, curveFromPoint } from './pnj-link-curves.js';
import { createGraphDisplay } from './pnj-graph-display.js';
import { rememberGraphNodes, restoreGraphNodes, applySharedGraphPositions } from './pnj-graph-layout.js';

import { createLiveImages, graphStructureKey } from './pnj-live-images.js';

// ── Constants ──────────────────────────────────────────────────
const STATUT_COLOR   = { 'allié': 'var(--statut-allie, #4caf7d)', 'ennemi': 'var(--statut-ennemi, #c94c4c)', 'neutre': 'var(--statut-neutre, #8a8a9a)' };
const LINK_COLORS    = { 'allié': 'var(--link-allie, #4caf7d)', 'ennemi': 'var(--link-ennemi, #c94c4c)', 'famille': 'var(--link-famille, #c9a84c)', 'mentor': 'var(--link-mentor, #7a9ac9)', 'rival': 'var(--link-rival, #c97a4c)' };
// Jetons déclarés dans les deux thèmes : la légende les pose en style=, où
// aucune couleur littérale n'est admise.
const DIM_PALETTE    = Array.from({ length: 10 }, (_, i) => `var(--dim-${i})`);
// Médaillon : portrait rond dans un anneau à la couleur de la dimension, nom
// et lieu dessous. Sceau et porte de Morr se posent sur le bord du portrait,
// à 45° (en bas à droite, en haut à droite).
const PORTRAIT_R = 27.5, RING_W = 2.5, NODE_R = PORTRAIT_R + RING_W;
const MARK_OFFSET = PORTRAIT_R * Math.SQRT1_2;
// Échelle d'ouverture du graphe : un recadrage ne zoome jamais au-delà, ni sous
// GRAPH_MIN_FIT_SCALE où les noms deviennent illisibles.
const GRAPH_INITIAL_SCALE = 0.8, GRAPH_MIN_FIT_SCALE = 0.3;
const GRAPH_FIT_DELAY = 120;
const REL_PALETTE = [
    '#c9a84c','#e8a87c','#d4756b','#c4726e',
    '#c94c8e','#8e4cc9','#5a7ac9','#4c9ac9',
    '#4cc9c9','#4caf7d','#7ac94c','#a8965a',
    '#8a7a6a','#9a9aaa','#7a7a8a','#c9b89a',
];
// Le sens d'une relation est une flèche : on le dit aussi en toutes lettres.
const REL_DIR_LABELS = { '→': 'relation sortante', '←': 'relation entrante', '↔': 'relation réciproque' };
const TABLE_COLS     = [
    { key: 'nom',         label: 'Nom' },
    { key: 'statut',      label: 'Statut' },
    { key: 'vivant',      label: 'Vivant' },
    { key: 'lieu',        label: 'Lieu' },
    { key: 'groupes',     label: 'Groupes' },
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
    // Taille du cadre au moment du build : forceCenter et les centres de
    // « Couleur : Lieu/Groupe » s'y rapportent, un redimensionnement ne la change pas.
    layoutW: 800, layoutH: 550,
    // Recadrage demandé pendant que la simulation tournait : refait à sa fin.
    pendingFit: false, graphTicked: false,
    view: 'graph',
    zoomTransform: null, zoom: null, svgSel: null,
    sortCol: 'nom', sortDir: 1,
    editingId: null, panelId: null,
    croppedBlob: null,
    privateLoadId: 0,
    privateDocExists: false,
    privateLoadError: false,
    editingPrivateUpdatedAt: null,
    editingPrivateNotes: '',
    editingUpdatedAt: null,
    editingContributionContextPromise: null,
};

let currentLoadId = 0;
let editorSession = 0;
let authSessionKey = '';
let currentPanelGeneration = 0;
let cropperInstance = null;
let cropGeneration = 0;
let cropSourceUrl = null;
let localPreviewUrl = null;
let groupPicker = null;
const relationEditContexts = new WeakMap();
let graphDisplay = null;
const sharedGraphPositions = new Map();
const graphNodeMemory = new Map();
const draggingNodes = new Set();
let unsubscribePositions = null;
let positionsSubscriptionKey = null;
let positionsGeneration = 0;
let positionReadErrorTimer = null;
let positionSaveSequence = 0;
let selectedCurveId = null;
let curveGeneration = 0;
let curveSequence = 0;
const curvePreviews = new Map();
const remoteCurvatures = new Map();
// Déclencheur de la modale d'édition (« ＋ PNJ », « Modifier », « ✏ ») et sa
// clé focusKey : la fiche ou le tableau peuvent l'avoir réécrit entre-temps.
let _pnjModalReturn = null;
// Signature des pastilles de filtre rendues : une émission qui ne change ni
// les valeurs ni les libellés ne doit pas les recréer (focus, région live).
let _filterSignature = null;
// Fiche affichée : le rendu temps réel rappelle openPanel() à chaque émission,
// on ne réécrit le panneau que si son HTML a changé.
let _panelHtml = '';
let _panelShownId = null;
let panelLinkedClues = { id: null, role: null, items: [] };
let panelContributionAction = null;
let relationContributionActions = [];
// PNJ dont le nœud ou la ligne a ouvert la fiche : le focus y revient à la fermeture.
let _panelReturnId = null;
// Réécriture forcée du dossier après un enregistrement de relation : le HTML
// comparé ne porte ni le style ni toujours le type, et le formulaire ouvert doit
// se refermer. `focus` : sélecteur qui reçoit le focus après la réécriture.
let _panelRewrite = null;
// Le lien ?id= n'ouvre la fiche qu'une fois : les émissions suivantes ne
// doivent pas ramener le joueur sur ce PNJ s'il est passé à un autre.
let _deepLinkHonored = false;
window.addEventListener('pagehide', () => {
    resetPositionSubscriptions();
    void graphDisplay?.exit();
    bureauGeneration += 1;
    currentLoadId += 1;
    editorSession += 1;
    closePnjModal();
    closePanel();
    panelContributionAction?.dispose?.();
    panelContributionAction = null;
    relationContributionActions.forEach(action => action.dispose());
    relationContributionActions = [];
    cancelLinkedIndices();
    document.getElementById('pnj-form')?.reset();
    if (document.getElementById('f-notes-privees')) document.getElementById('f-notes-privees').value = '';
    if (document.getElementById('pnj-private-status')) document.getElementById('pnj-private-status').textContent = '';
    panelLinkedClues = { id: null, role: null, items: [] };
    state.nodes = [];
    state.links = [];
    d3.select('#pnj-graph > svg').remove();
    renderTable();
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    unsubscribePnjs?.();
    unsubscribeRelations?.();
    unsubscribePrivateNotes?.();
    liveImages?.close();
    liveImages = null;
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
let liveImages = null;
let createContributionAction = null;
const contributionToolbar = document.querySelector('.pnj-admin-actions');
if (contributionToolbar) createContributionAction = mountContributionButton({
    container: contributionToolbar,
    getClient: () => import('./contributions/firebase-client.js').then(module => module.contributionClient),
    signIn: loginWithGoogle,
    kind: 'pnj', action: 'create', documentRef: document,
    announce: message => showPnjDeletionStatus(message),
});
let createRelationContributionAction = null;
if (contributionToolbar) createRelationContributionAction = mountContributionButton({ container: contributionToolbar,
    getClient: () => import('./contributions/firebase-client.js').then(module => module.contributionClient),
    signIn: loginWithGoogle, kind: 'relation', action: 'create', documentRef: document,
    announce: message => showPnjDeletionStatus(message) });
let contentTrashPanel = null;
if (contributionToolbar) contentTrashPanel = mountContentTrashPanel({ container: contributionToolbar,
    getClient: () => import('./contributions/firebase-client.js').then(module => module.contributionClient),
    signIn: loginWithGoogle, documentRef: document });

// ── Utils ──────────────────────────────────────────────────────
// Object.hasOwn : une valeur « constructor » remonterait sinon au prototype
// et renverrait une fonction en guise de couleur.
const ownValue = (table, key) => Object.hasOwn(table, key) ? table[key] : undefined;
const getStatutColor = s => ownValue(STATUT_COLOR, String(s || '').toLowerCase()) || '#7a7a8a';
const getLinkColor   = s => ownValue(LINK_COLORS, String(s || '').toLowerCase())  || stringToColor(String(s || ''));
const safeRelationColor = (color, type) => safeRelationColorValue(color, getLinkColor(type));
// Un état vital vide vaut « oui » : c'est la valeur par défaut du formulaire.
const vivantKey = d => String(d.vivant || 'oui').trim().toLowerCase();
const initials = nom => String(nom || '').trim().split(/\s+/u).filter(Boolean).slice(0, 2)
    .map(word => word.charAt(0)).join('').toUpperCase() || '?';
// Illustration d'un PNJ sans portrait. Un portrait protégé illisible garde son
// message d'indisponibilité : l'illustration ne doit pas le masquer.
const DEFAULT_PORTRAIT = 'img/pnj-default.webp';
const DEFAULT_MEDALLION = 'img/pnj-default-medaillon.webp';
const withoutPortrait = d => !d.imageUrl && !d.imagePath;
const medallionHref = d => d.imageUrl || (withoutPortrait(d) ? DEFAULT_MEDALLION : null);
// Valeurs qualifiées (« statut inconnu », « sort inconnu ») : seules, « Inconnu,
// Inconnu » ne disaient pas de quoi il s'agissait.
const vitalPhrase = d => vivantKey(d) === 'inconnu' ? 'sort inconnu' : vivantLabel(d.vivant || 'oui').toLowerCase();
const nodeAriaLabel = d => `${d.nom || '?'}, statut ${statutLabel(d.statut).toLowerCase()}, ${vitalPhrase(d)}, ${d.lieu || 'lieu inconnu'}`;
// d3.forceLink remplace source/target par les nœuds eux-mêmes : on compare
// toujours des identifiants.
const linkEnds = l => [l.source?.id ?? l.source, l.target?.id ?? l.target];

// Miroir exact d'une relation (même paire inversée), tel que le dépôt l'a prouvé.
function exactReciprocal(link) {
    const reciprocal = link?.reciprocalId ? state.links.find(relation => relation.id === link.reciprocalId) : null;
    if (!reciprocal) return null;
    const [source, target] = linkEnds(link);
    const [reverseSource, reverseTarget] = linkEnds(reciprocal);
    return reverseSource === target && reverseTarget === source ? reciprocal : null;
}

// Clé d'un élément focalisé qui survit à une réécriture d'innerHTML : son id,
// sinon sa première classe et l'attribut data-* qui le distingue.
function focusKey(root) {
    const el = document.activeElement;
    if (!el || el === root || !root.contains(el)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    const cls = el.classList[0];
    if (!cls) return null;
    const attr = ['rel', 'id', 'col'].find(name => el.dataset[name] !== undefined);
    return attr ? `.${CSS.escape(cls)}[data-${attr}="${CSS.escape(el.dataset[attr])}"]` : `.${CSS.escape(cls)}`;
}

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

function repositoryPnjToPage(node) {
    return {
        ...node,
        imagePath: node?.imagePath || '',
        imageUrl: node?.imagePath ? '' : (node?.imageUrl || ''),
        legacyImageUrl: node?.imagePath ? '' : (node?.imageUrl || ''),
    };
}

const primaryGroup = node => pnjGroups(node)[0] || '';

function showPnjDeletionStatus(message, action) {
    const loading = document.getElementById('pnj-loading');
    const status = document.getElementById('pnj-deletion-status') || document.createElement('p');
    status.id = 'pnj-deletion-status';
    status.className = 'pnj-cleanup-status';
    // Annoncé : le PNJ ouvert peut disparaître sans action de l'utilisateur.
    status.setAttribute('role', 'status');
    status.hidden = false;
    // Inséré avant d'être rempli : une région live n'annonce que ce qui y change après son insertion.
    loading?.after(status);
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
    const roleChanged = state.isAdmin !== isAdmin;
    const nextAuthSessionKey = user?.uid || '';
    const identityChanged = authSessionKey !== nextAuthSessionKey;
    const nextBureauGeneration = roleChanged || identityChanged || !bureauData
        ? ++bureauGeneration : bureauGeneration;
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
        resetPositionSubscriptions();
        cancelLinkedIndices();
        unsubscribePnjs?.();
        unsubscribeRelations?.();
        unsubscribePnjs = null;
        unsubscribeRelations = null;
        unsubscribePrivateNotes?.();
        unsubscribePrivateNotes = null;
        liveImages?.close();
        liveImages = null;
        panelLinkedClues = { id: null, role: null, items: [] };
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
    createContributionAction?.dispose?.();
    createContributionAction = null;
    createRelationContributionAction?.dispose?.();
    createRelationContributionAction = null;
    contentTrashPanel?.dispose?.();
    contentTrashPanel = null;
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
        const capturedData = bureauData;
        const stillCurrent = () => generation === bureauGeneration
            && isCurrentLoad(loadId, currentLoadId) && capturedData === bureauData;
        let structureKey = null;
        liveImages?.close();
        liveImages = createLiveImages(path => capturedData.images.loadObjectUrl(path), path => {
            if (!stillCurrent()) return;
            state.nodes.filter(node => node.imagePath === path).forEach(node => liveImages.apply(node));
            refreshGraphContent();
            if (state.view === 'table') renderTable();
            const node = state.nodes.find(item => item.id === state.panelId);
            if (node) openPanel(node);
        });
        const render = (nodes, relations) => {
            if (!stillCurrent()) return;
            const previousPanelId = state.panelId;
            rememberGraphNodes(state.nodes, graphNodeMemory);
            const nextNodes = nodes.map(repositoryPnjToPage).filter(node => state.isAdmin || visiblePourJoueurs(node));
            const nextStructureKey = graphStructureKey(nextNodes, relations);
            const rebuild = structureKey !== nextStructureKey || (!state.nodeSel && nextNodes.length > 0);
            structureKey = nextStructureKey;
            const previousNodes = new Map(state.nodes.map(node => [node.id, node]));
            // D3 et la simulation gardent ces objets : préserver leurs références.
            state.nodes = nextNodes.map(node => {
                const previous = previousNodes.get(node.id);
                return previous ? Object.assign(previous, node) : node;
            });
            if (rebuild) restoreGraphNodes(state.nodes, sharedGraphPositions, graphNodeMemory);
            subscribeGraphPositions();
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
            if (rebuild) state.links = relations.filter(link => nodeIds.has(link.source) && nodeIds.has(link.cible))
                .map(link => ({ ...link, target: link.cible }));
            remoteCurvatures.clear();
            state.links.forEach(link => {
                remoteCurvatures.set(link.id, link.curvature ?? null);
                const preview = curvePreviews.get(link.id);
                if (preview) link.curvature = preview.value;
            });
            for (const id of curvePreviews.keys()) {
                if (!remoteCurvatures.has(id)) curvePreviews.delete(id);
            }
            bureauData.relations.setVisiblePnjIds?.([...nodeIds]);
            liveImages.sync(state.nodes);
            buildFilters();
            if (rebuild) {
                // Une modification de structure reconstruit le graphe en gardant le focus.
                const focusedCurve = document.activeElement?.closest?.('.pnj-link-hit, .pnj-curve-handle');
                const focusedCurveId = focusedCurve ? d3.select(focusedCurve).datum()?.id : null;
                const focusedWasHandle = focusedCurve?.classList.contains('pnj-curve-handle');
                const focusedNodeId = document.activeElement?.closest?.('.pnj-node')
                    ? d3.select(document.activeElement.closest('.pnj-node')).datum()?.id : null;
                // Enfant direct : la légende, dans #pnj-graph, contient aussi des SVG (sceaux).
                d3.select('#pnj-graph > svg').remove();
                state.nodeSel = null;
                state.linkSel = null;
                state.linkLabelSel = null;
                if (state.simulation) { state.simulation.stop(); state.simulation = null; }

                // Pas de clearFilters() ici : buildFilters() ne recrée les pastilles que
                // si les facettes ont changé, pour ne pas voler le focus d'un joueur.
                if (state.nodes.length) buildGraph();
                else updateCurveControls();
                if (focusedCurveId) {
                    const selector = focusedWasHandle ? state.curveHandleSel : state.linkHitSel;
                    const restored = selector?.filter(link => link.id === focusedCurveId).node();
                    if (restored && restored.getAttribute('tabindex') !== '-1') restored.focus();
                    else document.getElementById('pnj-graph')?.focus();
                }
                // Nœud retiré ou filtré : le focus se replie sur le graphe plutôt que sur body.
                if (focusedNodeId && !focusGraphNode(focusedNodeId)) document.getElementById('pnj-graph')?.focus();

            } else refreshGraphContent();
            updateVisibility();
            if (init) document.getElementById('pnj-loading').style.display = 'none';
        document.getElementById('pnj-empty').style.display    = state.nodes.length ? 'none' : 'flex';
        document.getElementById('graph-legend').style.display = state.nodes.length ? 'flex' : 'none';
        if (state.view === 'table') renderTable();

            const urlParams = new URLSearchParams(window.location.search);
        // Consommé à la première émission qui porte des PNJ : une émission vide
        // (relations arrivées d'abord) ne doit pas l'épuiser.
        const pnjId = _deepLinkHonored ? null : (urlParams.get('id') || urlParams.get('pnj'));
        if (state.nodes.length) _deepLinkHonored = true;
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
        let renderQueued = false;
        const update = () => {
            if (renderQueued) return;
            renderQueued = true;
            globalThis.queueMicrotask(() => {
                renderQueued = false;
                if (!stillCurrent()) return;
                try { render(latestNodes, latestRelations); }
                catch (error) { onError(error); }
            });
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


function refreshGraphContent() {
    const nodes = state.nodeSel;
    if (!nodes) return;
    nodes.attr('aria-label', nodeAriaLabel);
    state.linkHitSel?.attr('aria-label', d => `Régler la courbure : ${curveRelationName(d)}`);
    state.curveHandleSel?.attr('aria-label', d => `Déplacer la courbure : ${curveRelationName(d)}. Utilisez les flèches pour ajuster.`);
    nodes.select('.node-name').text(d => d.nom || '');
    nodes.select('.node-sub').text(d => d.lieu || '');
    nodes.select('.node-initial').text(d => initials(d.nom))
        .style('display', d => medallionHref(d) ? 'none' : '');
    nodes.select('.node-portrait-bg').style('display', d => medallionHref(d) ? 'none' : '');
    nodes.select('.node-portrait').attr('href', medallionHref)
        .style('display', d => medallionHref(d) ? '' : 'none');
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
        && document.getElementById('pnj-modal')?.open
        && capturedData === bureauData;
    const requireCurrentEditor = () => { if (!editorStillCurrent()) throw new Error('Édition annulée : la session ou le rôle a changé.'); };
    btn.disabled = true;
    groupPicker?.setDisabled(true);
    btn.textContent = imageFile ? 'Upload…' : 'Enregistrement…';
    try {
        if (!pnjRepository || !capturedData?.images || !state.isAdmin) throw new Error('Session MJ indisponible.');
        if (capturedEditingId && state.privateLoadError) {
            throw new Error('Notes privées indisponibles : enregistrement annulé. Vérifiez les règles M1-02.');
        }
        requireCurrentEditor();
        const id = capturedEditingId || `pnj-${Date.now().toString(36)}`;
        const publicData = {
            nom: data.nom || '', statut: data.statut || '', vivant: data.vivant || 'oui',
            lieu: data.lieu || '', groupes: pnjGroups({ groupes: data.groupes }), groupe: pnjGroups({ groupes: data.groupes })[0] || '', description: data.description || '',
            visibleJoueurs: data.visibleJoueurs !== false,
        };
        if (data.imagePath) publicData.imagePath = data.imagePath;
        const privateData = { notes: data.notesPrivees || '' };
        if (capturedEditingId) {
            const client = (await import('./contributions/firebase-client.js')).contributionClient;
            const context = await state.editingContributionContextPromise;
            if (!context) throw new Error('Le contexte versionné du PNJ est indisponible. Réouvrez la fiche avant de réessayer.');
            {
                const changes = {};
                const baseValues = {};
                const candidates = {
                    nom: publicData.nom, statut: publicData.statut, vivant: publicData.vivant, lieu: publicData.lieu,
                    groupes: publicData.groupes, description: publicData.description, visibleJoueurs: publicData.visibleJoueurs,
                };
                for (const [field, value] of Object.entries(candidates)) {
                    const before = context.data[field] ?? (field === 'groupes' ? [] : field === 'visibleJoueurs' ? false : '');
                    if (JSON.stringify(value) !== JSON.stringify(before)) { changes[field] = value; baseValues[field] = before; }
                }
                if (imageFile) {
                    const imageOperationId = globalThis.crypto?.randomUUID?.() || `portrait_${Date.now().toString(36)}`;
                    const bytes = new Uint8Array(await imageFile.arrayBuffer());
                    let binary = '';
                    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
                    const upload = await client.uploadContributionImage({ kind: 'portrait', ownerId: capturedEditingId,
                        operationId: imageOperationId, contentType: imageFile.type, base64: globalThis.btoa(binary) });
                    changes.imagePath = upload.imagePath;
                    baseValues.imagePath = context.data.imagePath ?? null;
                }
                if (Object.keys(changes).length) {
                    await mutateContentThroughGateway(client, context, { kind: 'pnj', id: capturedEditingId,
                        operationId: newContributionOperationId(), baseValues, changes });
                }
                requireCurrentEditor();
                if (privateData.notes !== state.editingPrivateNotes) {
                    await pnjRepository.updatePrivateOnly(capturedEditingId, privateData, state.editingPrivateUpdatedAt);
                }
                requireCurrentEditor();
                const prevEditingId = capturedEditingId;
                closePnjModal();
                if (panelIsStillCurrent({ capturedGeneration: capturedPanelGeneration, currentGeneration: currentPanelGeneration,
                    capturedId: capturedPanelId, currentId: state.panelId })) {
                    const node = state.nodes.find(item => item.id === prevEditingId);
                    if (node) openPanel(node);
                }
                return;
            }
        }
        if (capturedEditingId) throw new Error('Modification legacy refusée : le contexte versionné est requis.');
        const client = (await import('./contributions/firebase-client.js')).contributionClient;
        const createOperationId = newContributionOperationId();
        const createChanges = { nom: publicData.nom, statut: publicData.statut, vivant: publicData.vivant,
            lieu: publicData.lieu, groupes: publicData.groupes, description: publicData.description,
            visibleJoueurs: publicData.visibleJoueurs };
        if (imageFile) createChanges.imagePath = await uploadManagedImage(client, { kind: 'portrait', ownerId: id, file: imageFile, operationId: createOperationId });
        await client.mutatePublicContent({ kind: 'pnj', action: 'create', id, operationId: createOperationId, baseRevision: 0, changes: createChanges });
        if (privateData.notes) {
            try { await pnjRepository.updatePrivateOnly(id, privateData); }
            catch { showPnjImageRecoveryStatus('PNJ public créé ; les notes privées n’ont pas pu être enregistrées.', null); }
        }
        requireCurrentEditor();
        closePnjModal();
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
            }
            showPnjImageRecoveryStatus(message, recover);
            if (imageState.commitUnknown) alert(message);
        } else {
            alert('Erreur : ' + e.message);
        }
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
        groupPicker?.setDisabled(false);
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
    const client = (await import('./contributions/firebase-client.js')).contributionClient;
    const editContext = await loadContentEditContext(client, 'pnj', id);
    if (!editContext) { alert('Le contexte versionné du PNJ est indisponible. Aucune suppression directe n’est autorisée.'); return; }
    const ok = await confirmAction({
        titre: 'Mettre le personnage en corbeille',
        message: `${pnj?.nom || 'Ce personnage'} et ses relations/indices dépendants seront placés en corbeille, avec possibilité de restauration.`,
        libelleAction: 'Mettre en corbeille', danger: true,
    });
    if (!ok || !stillCurrent()) return;
    try {
        if (!stillCurrent()) return;
        await trashManagedContent(client, editContext, { kind: 'pnj', id });
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
    // La visibilité joueurs est dérivée des deux PNJ par le dépôt.
    try {
        const client = (await import('./contributions/firebase-client.js')).contributionClient;
        const result = await client.mutatePublicContent({ kind: 'relation', action: 'create', operationId: newContributionOperationId(),
            baseRevision: 0, pair: bidir === true, changes: { source: sourceId, cible: cibleId, type,
                label: label || type, color: safeRelationColor(color, type), style: style === 'dashed' ? 'dashed' : 'solid' } });
        if (!stillCurrent()) return;
        void result;
        const node = state.nodes.find(item => item.id === sourceId);
        _panelRewrite = { id: sourceId, focus: '#add-rel-btn' };
        if (node) openPanel(node);
    } catch (error) { if (stillCurrent()) alert('Création de la relation impossible : ' + (error?.message || 'réessayez.')); }
}

async function updateRelation(relId, type, label, color, style, context) {
    if (!type) { alert('Le type de relation est requis.'); return; }
    const repository = bureauData?.relations;
    if (!repository?.update) { alert('Dépôt relations indisponible.'); return; }
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const capturedGeneration = currentPanelGeneration;
    const panelId = state.panelId;
    const capturedRepository = repository;
    const current = state.links.find(relation => relation.id === relId);
    // La fiche fusionne une paire réciproque en une ligne : la comparaison se
    // fait sur les identifiants, la simulation ayant remplacé source par le nœud.
    const reciprocal = exactReciprocal(current);
    const pair = Boolean(reciprocal);
    const stillCurrent = () => capturedRole && state.isAdmin && capturedSession === editorSession
        && capturedGeneration === currentPanelGeneration && panelId === state.panelId
        && capturedRepository === bureauData?.relations;
    try {
        if (!stillCurrent()) return;
        if (!context) throw new Error('Le contexte versionné de la relation est indisponible. Réouvrez le formulaire.');
        const client = (await import('./contributions/firebase-client.js')).contributionClient;
        const changes = { type, label: label || type, style: style === 'dashed' ? 'dashed' : 'solid' };
        if (color) changes.color = safeRelationColor(color, type);
        const reciprocalId = pair ? reciprocal.id : undefined;
        await mutateContentThroughGateway(client, context, { kind: 'relation', id: relId, changes,
            pair, reciprocalId, reciprocalBaseRevision: pair ? context.data.reciprocalRevision : undefined });
        if (!stillCurrent()) return;
        const node = state.nodes.find(item => item.id === panelId);
        _panelRewrite = { id: panelId, focus: `.rel-edit-btn[data-rel="${CSS.escape(relId)}"]` };
        if (node) openPanel(node);
    } catch (error) { if (stillCurrent()) alert('Modification de la relation impossible : ' + (error?.message || 'réessayez.')); }
}

async function deleteRelation(relId) {
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const capturedGeneration = currentPanelGeneration;
    const capturedPanelId = state.panelId;
    const repository = bureauData?.relations;
    if (!repository) { alert('Dépôt relations indisponible.'); return; }
    const stillCurrent = () => capturedRole && state.isAdmin && capturedSession === editorSession
        && capturedGeneration === currentPanelGeneration && capturedPanelId === state.panelId
        && repository === bureauData?.relations;
    const client = (await import('./contributions/firebase-client.js')).contributionClient;
    const context = await loadContentEditContext(client, 'relation', relId);
    if (!context) throw new Error('Le contexte versionné de la relation est indisponible.');
    const ok = await confirmAction({ titre: 'Mettre en corbeille',
        message: 'La relation sera placée en corbeille et pourra être restaurée.',
        libelleAction: 'Mettre en corbeille', danger: true });
    if (!ok || !stillCurrent()) return;
    try {
        if (!stillCurrent()) return;
        await trashManagedContent(client, context, { kind: 'relation', id: relId });
        if (!stillCurrent()) return;
    } catch (error) { if (stillCurrent()) alert('Suppression de la relation impossible : ' + (error?.message || 'réessayez.')); }
}

// ── PNJ Modal ──────────────────────────────────────────────────
function openPnjModal(pnjId = null) {
    const dialog = document.getElementById('pnj-modal');
    if (!dialog.open) {
        const opener = document.activeElement;
        _pnjModalReturn = opener && opener !== document.body
            ? { el: opener, key: focusKey(document.body) } : null;
    }
    editorSession += 1;
    // Invalide toute lecture privée encore en vol avant de réinitialiser le formulaire.
    state.privateLoadId += 1;
    closeCropModal();
    state.editingId  = pnjId;
    state.editingContributionContextPromise = null;
    state.editingUpdatedAt = null;
    state.croppedBlob = null;
    const preview = document.getElementById('f-image-preview');
    document.getElementById('pnj-form').reset();
    groupPicker?.setGroups([]);
    groupPicker?.setDisabled(false);
    clearPnjPreview();
    document.getElementById('pnj-modal-title').textContent = pnjId ? 'Modifier le personnage' : 'Nouveau personnage';
    document.getElementById('pnj-delete-btn').style.display = pnjId ? '' : 'none';
    document.getElementById('pnj-private-fields').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('f-visible-joueurs').value = 'true';
    document.getElementById('f-notes-privees').value = '';
    state.privateDocExists = false;
    state.privateLoadError = false;
    state.editingPrivateUpdatedAt = null;
    state.editingPrivateNotes = '';
    document.getElementById('pnj-private-status').textContent = '';

    if (pnjId) {
        const form = document.getElementById('pnj-form');
        const openSession = editorSession;
        form.inert = true;
        const contextPromise = import('./contributions/firebase-client.js')
            .then(module => loadContentEditContext(module.contributionClient, 'pnj', pnjId))
            .then(context => {
                if (!context) throw new Error('Le contexte versionné du PNJ est indisponible.');
                if (openSession !== editorSession || state.editingId !== pnjId || !dialog.open) return null;
                const p = context.data;
                document.getElementById('f-nom').value = p.nom || '';
                document.getElementById('f-statut').value = p.statut || '';
                document.getElementById('f-vivant').value = p.vivant || 'oui';
                document.getElementById('f-lieu').value = p.lieu || '';
                groupPicker?.setGroups(pnjGroups(p));
                document.getElementById('f-description').value = p.description || '';
                document.getElementById('f-visible-joueurs').value = String(p.visibleJoueurs === true);
                const imagePreview = document.getElementById('f-image-preview');
                imagePreview.dataset.existingPath = p.imagePath || '';
                return context;
            })
            .catch(error => { if (openSession === editorSession) document.getElementById('pnj-private-status').textContent = error.message; return null; })
            .finally(() => { if (openSession === editorSession) form.inert = false; });
        state.editingContributionContextPromise = contextPromise;
        const p = state.nodes.find(n => n.id === pnjId);
        if (p) {
            state.editingUpdatedAt = p.updatedAt ?? null;
            document.getElementById('f-nom').value         = p.nom         || '';
            document.getElementById('f-statut').value      = p.statut      || '';
            document.getElementById('f-vivant').value      = p.vivant      || 'oui';
            document.getElementById('f-lieu').value        = p.lieu        || '';
            groupPicker?.setGroups(pnjGroups(p));
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
    if (!dialog.open) dialog.showModal();
}

// Rend le focus au déclencheur de l'édition. S'il a disparu (PNJ supprimé,
// fiche fermée, ligne filtrée), repli sur la vue plutôt que sur body.
function restorePnjModalFocus() {
    const origin = _pnjModalReturn;
    _pnjModalReturn = null;
    const target = origin && (origin.el.isConnected ? origin.el : origin.key && document.querySelector(origin.key));
    if (target && !target.closest('[inert]')) target.focus();
    if (!target || document.activeElement !== target) focusPnjOrigin(null);
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
            state.editingPrivateUpdatedAt = snap.updatedAt ?? null;
            state.editingPrivateNotes = notes;
            return;
        }
        document.getElementById('f-notes-privees').value = legacyNote(pnj);
        state.editingPrivateUpdatedAt = null;
        state.editingPrivateNotes = legacyNote(pnj);
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
    const dialog = document.getElementById('pnj-modal');
    // Appelée aussi par précaution (déconnexion, pagehide) : le focus ne bouge
    // que si la modale était réellement ouverte.
    const wasOpen = dialog.open;
    if (wasOpen) dialog.close();
    groupPicker?.setGroups([]);
    state.editingId   = null;
    state.editingContributionContextPromise = null;
    state.editingUpdatedAt = null;
    state.croppedBlob = null;
    state.privateDocExists = false;
    state.privateLoadError = false;
    state.editingPrivateUpdatedAt = null;
    state.editingPrivateNotes = '';
    if (wasOpen) restorePnjModalFocus();
}

document.getElementById('pnj-form').addEventListener('submit', async e => {
    e.preventDefault();
    const preview = document.getElementById('f-image-preview');
    await savePnj({
        nom:         document.getElementById('f-nom').value.trim(),
        statut:      document.getElementById('f-statut').value,
        vivant:      document.getElementById('f-vivant').value,
        lieu:        document.getElementById('f-lieu').value.trim(),
        groupes:     groupPicker?.getGroups() || [],
        description: document.getElementById('f-description').value.trim(),
        imagePath:   preview.dataset.existingPath || '',
        imageUrl:    preview.dataset.existingLegacyUrl || '',
        visibleJoueurs: document.getElementById('f-visible-joueurs').value === 'true',
        notesPrivees: document.getElementById('f-notes-privees').value,
    }, state.croppedBlob);
});

groupPicker = createGroupPicker({
    documentRef: document,
    input: document.getElementById('f-groupe'),
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
    // Cropper mesure son conteneur : le dialogue doit être ouvert avant que
    // l'image se charge, sinon il s'initialise sur une boîte de taille nulle.
    const dialog = document.getElementById('crop-modal');
    if (!dialog.open) dialog.showModal();
    img.src = cropSourceUrl;
}

function closeCropModal() {
    cropGeneration += 1;
    const dialog = document.getElementById('crop-modal');
    const wasOpen = dialog.open;
    if (wasOpen) dialog.close();
    if (cropperInstance) { cropperInstance.destroy(); cropperInstance = null; }
    const img = document.getElementById('crop-img');
    img.onload = null;
    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    cropSourceUrl = null;
    img.src = '';
    // Le cadrage s'ouvre depuis le champ Portrait de l'édition : le focus y revient.
    if (wasOpen && document.getElementById('pnj-modal').open) document.getElementById('f-image').focus();
}

// Annuler le cadrage (bouton ou Échap) abandonne aussi le fichier choisi.
function cancelCropModal() {
    document.getElementById('f-image').value = '';
    closeCropModal();
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

document.getElementById('crop-cancel-btn').addEventListener('click', cancelCropModal);
// Fermeture native (Échap, retour Android) : on reprend la main pour passer
// par le même nettoyage que les boutons (Cropper, URL d'objet, retour du focus).
document.getElementById('crop-modal').addEventListener('cancel', e => { e.preventDefault(); cancelCropModal(); });

document.getElementById('pnj-modal-close').addEventListener('click', closePnjModal);
document.getElementById('pnj-modal').addEventListener('cancel', e => { e.preventDefault(); closePnjModal(); });
// Échap est traité dès keydown, sur le dialogue qui a le focus : un cadrage
// ouvert sans activation utilisateur récente (sélection de fichier lente) est
// groupé par le navigateur avec l'édition, et une seule demande de fermeture
// native les fermerait toutes les deux. Annuler keydown évite cette demande.
['crop-modal', 'pnj-modal'].forEach(id => document.getElementById(id).addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (id === 'crop-modal') cancelCropModal();
    else closePnjModal();
}));
// Un clic sur le voile (::backdrop) est reçu par le <dialog> lui-même.
document.getElementById('pnj-modal').addEventListener('click', e => { if (e.target === document.getElementById('pnj-modal')) closePnjModal(); });
document.getElementById('pnj-delete-btn').addEventListener('click', () => { if (state.editingId) deletePnj(state.editingId); });
document.getElementById('add-pnj-btn').addEventListener('click', () => openPnjModal());

// ── Colors ─────────────────────────────────────────────────────
function buildDimColorMap() {
    if (state.colorBy === 'statut') { state.dimColorMap = null; return; }
    const value = d => state.colorBy === 'groupe' ? primaryGroup(d) : d[state.colorBy];
    const vals = [...new Set(state.nodes.map(value).filter(Boolean))].sort();
    state.dimColorMap = new Map(vals.map((v, i) => [v, DIM_PALETTE[i % DIM_PALETTE.length]]));
}

const getDimColor = d => state.dimColorMap ? (state.dimColorMap.get(state.colorBy === 'groupe' ? primaryGroup(d) : d[state.colorBy]) || '#7a7a8a') : getStatutColor(d.statut);

// Les marques sont décoratives dans la légende : le libellé qui les suit
// suffit, leur aria-label le répéterait.
const legendMark = markup => `<span class="legend-mark" aria-hidden="true">${markup}</span>`;

function updateLegend() {
    const legend = document.getElementById('graph-legend');
    const fates = `
            <div class="legend-item">${legendMark(morrMarkup({ size: 16 }))}Décédé</div>
            <div class="legend-item"><span class="legend-mark"><span class="legend-ring"></span></span>Sort inconnu</div>`;
    if (state.colorBy === 'statut') {
        legend.innerHTML = ['allié', 'ennemi', 'neutre', ''].map(statut =>
            `<div class="legend-item">${legendMark(sealMarkup(statut, { size: 16 }))}${esc(statutLabel(statut))}</div>`).join('') + fates;
    } else {
        const items = state.dimColorMap ? [...state.dimColorMap.entries()].map(([v, c]) =>
            `<div class="legend-item"><span class="legend-mark"><span class="legend-dot" style="background:${c}"></span></span>${esc(v)}</div>`).join('') : '';
        legend.innerHTML = items
            + `<div class="legend-item">${legendMark(sealMarkup('allié', { size: 16 }))}Sceau : statut</div>` + fates;
    }
}

// ── Filters ────────────────────────────────────────────────────
function clearFilterGroups() {
    _filterSignature = null;
    ['filter-statut', 'filter-vivant', 'filter-lieu', 'filter-groupe'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerHTML = '';
            // Un groupe vide laisserait un trou dans la barre : il n'est
            // réaffiché que par buildFilters(), s'il a des valeurs.
            el.hidden = true;
        }
    });
}

function clearFilters() {
    clearFilterGroups();
    setFilterCount('Aucun filtre');
    graphDisplay?.updateGroups({ availableCount: 0, selectedCount: 0 });
}

// #pnj-filter-count est une région live : la réécrire à l'identique la ferait
// réannoncer à chaque émission temps réel.
function setFilterCount(text) {
    const badge = document.getElementById('pnj-filter-count');
    if (badge && badge.textContent !== text) badge.textContent = text;
}

// Libellé affiché d'une pastille : la valeur stockée reste « oui/non/inconnu »,
// seul le libellé est traduit.
const filterPillLabel = (key, v) => key === 'vivant' ? vivantLabel(v) : v;

function buildFilters() {
    groupPicker?.setCatalog(groupCatalog(state.nodes));
    const uniq = arr => [...new Set(arr.filter(Boolean))].sort();
    const definitions = [
        ['filter-statut', 'Statut', 'statut', uniq(state.nodes.map(d => d.statut))],
        ['filter-vivant', 'Vivant', 'vivant', uniq(state.nodes.map(d => d.vivant))],
        ['filter-lieu',   'Lieu',   'lieu',   uniq(state.nodes.map(d => d.lieu))],
        ['filter-groupe', 'Groupe', 'groupe', groupCatalog(state.nodes)],
    ];
    const available = Object.fromEntries(definitions.map(([, , key, vals]) => [key, vals]));
    const groupSpellings = new Map(available.groupe.map(label => [groupKey(label), label]));
    const selectedGroups = [...state.active.groupe].map(label => groupSpellings.get(groupKey(label))).filter(Boolean);
    state.active.groupe.clear();
    selectedGroups.forEach(label => state.active.groupe.add(label));
    // Les ensembles de filtres survivent à un rechargement ; une valeur disparue
    // doit être retirée avant de rendre les boutons, sinon le graphe reste masqué.
    reconcileFilterSets(state.active, available);
    const signature = JSON.stringify(definitions.map(([, label, key, vals]) =>
        [key, label, vals.map(v => [v, filterPillLabel(key, v)])]));
    // Facettes inchangées (souvent une simple émission de métadonnées) : les
    // pastilles restent en place, seul leur état suit state.active.
    if (signature === _filterSignature) {
        definitions.forEach(([id, , key, vals]) => {
            document.getElementById(id).querySelectorAll('.filter-pill').forEach((btn, i) => {
                const on = state.active[key].has(vals[i]);
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-pressed', String(on));
            });
        });
        updateFilterBadge();
        return;
    }
    // Reconstruction : une pastille focalisée serait détruite, le focus
    // tomberait sur body. On retient sa dimension et sa valeur pour la retrouver.
    const focusedPill = document.activeElement?.closest?.('.pnj-filters .filter-pill');
    const focusedDim = focusedPill?.dataset.dim;
    const focusedValue = focusedPill?.dataset.value;
    clearFilterGroups();
    _filterSignature = signature;
    definitions.forEach(([id, label, key, vals]) => {
        const el  = document.getElementById(id);
        el.hidden = !vals.length;
        if (!vals.length) return;
        const lbl = document.createElement('span');
        lbl.className = 'filter-group-label';
        lbl.textContent = label;
        el.appendChild(lbl);
        vals.forEach(v => {
            const btn = document.createElement('button');
            btn.className = 'filter-pill' + (state.active[key].has(v) ? ' active' : '');
            btn.setAttribute('aria-pressed', String(state.active[key].has(v)));
            btn.dataset.dim = key;
            btn.dataset.value = v;
            btn.textContent = filterPillLabel(key, v);
            btn.addEventListener('click', () => {
                state.active[key].has(v) ? state.active[key].delete(v) : state.active[key].add(v);
                btn.classList.toggle('active', state.active[key].has(v));
                btn.setAttribute('aria-pressed', String(state.active[key].has(v)));
                updateFilterBadge();
                updateVisibility();
                if (state.view === 'table') renderTable();
            });
            el.appendChild(btn);
        });
    });
    updateFilterBadge();
    if (focusedDim === undefined) return;
    // Pastille équivalente, sinon premier bouton du même groupe, sinon la recherche.
    const group = document.getElementById(`filter-${focusedDim}`);
    const pills = [...(group?.querySelectorAll('.filter-pill') || [])];
    (pills.find(btn => btn.dataset.value === focusedValue) || pills[0]
        || document.getElementById('pnj-search'))?.focus();
}

function updateFilterBadge() {
    const activeCount = Object.values(state.active).reduce((count, values) => count + values.size, 0);
    setFilterCount(activeCount ? `${activeCount} filtre${activeCount > 1 ? 's' : ''}` : 'Aucun filtre');
    graphDisplay?.updateGroups({ availableCount: groupCatalog(state.nodes).length, selectedCount: state.active.groupe.size });
}

function graphPositionStatus(message, kind = '') {
    const status = document.getElementById('pnj-position-status');
    if (!status) return;
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = !message;
}

function cancelPositionReadError() {
    if (positionReadErrorTimer !== null) globalThis.clearTimeout(positionReadErrorTimer);
    positionReadErrorTimer = null;
}

function resetPositionSubscriptions() {
    cancelPositionReadError();
    positionsGeneration += 1;
    positionSaveSequence += 1;
    resetCurveControls();
    unsubscribePositions?.();
    unsubscribePositions = null;
    positionsSubscriptionKey = null;
    sharedGraphPositions.clear();
    graphNodeMemory.clear();
    draggingNodes.clear();
    graphPositionStatus('');
}

function subscribeGraphPositions() {
    const repository = bureauData?.positions;
    if (!repository) return;
    const ids = state.nodes.map(node => node.id).sort();
    const key = JSON.stringify([state.isAdmin, ids]);
    if (key === positionsSubscriptionKey) return;
    cancelPositionReadError();
    if (document.getElementById('pnj-position-status')?.dataset.kind === 'read-error') graphPositionStatus('');
    unsubscribePositions?.();
    unsubscribePositions = null;
    positionsSubscriptionKey = key;
    const generation = ++positionsGeneration;
    let firstSnapshot = true;
    const onNext = (positions, metadata = {}) => {
        if (generation !== positionsGeneration || repository !== bureauData?.positions) return;
        cancelPositionReadError();
        const allowed = new Set(state.nodes.map(node => node.id));
        sharedGraphPositions.clear();
        positions.forEach(point => { if (allowed.has(point.id)) sharedGraphPositions.set(point.id, { x: point.x, y: point.y }); });
        if (applySharedGraphPositions(state.nodes, sharedGraphPositions, draggingNodes)) state.simulation?.alpha(0.1).restart();
        if (firstSnapshot && sharedGraphPositions.size && state.nodeSel) {
            fitGraphView();
            state.pendingFit = true;
        }
        firstSnapshot = false;
        if (metadata.hasPendingWrites) graphPositionStatus('Positions en cours de synchronisation…', 'pending');
        else if (metadata.fromCache) graphPositionStatus('Positions en cache — synchronisation en attente.', 'pending');
        else if (document.getElementById('pnj-position-status')?.dataset.kind !== 'error') graphPositionStatus('');
    };
    const onError = error => {
        if (generation !== positionsGeneration || repository !== bureauData?.positions) return;
        cancelPositionReadError();
        const report = () => {
            positionReadErrorTimer = null;
            if (generation !== positionsGeneration || repository !== bureauData?.positions) return;
            graphPositionStatus('Positions partagées indisponibles. Vérifiez la connexion puis rechargez.', 'read-error');
        };
        // Masquer un PNJ révoque d'abord sa position côté serveur. L'ancien
        // abonnement peut être refusé avant que la liste publique retire cet ID.
        // Le nouvel abonnement annule ce refus transitoire ; un refus persistant
        // reste signalé. Les erreurs d'écriture conservent leur propre état.
        if (!state.isAdmin && (error?.kind === 'permission' || error?.code === 'permission-denied')) {
            positionReadErrorTimer = globalThis.setTimeout(report, 800);
        } else report();
    };
    try {
        unsubscribePositions = state.isAdmin
            ? repository.subscribeAll(onNext, onError)
            : repository.subscribeForIds(ids, onNext, onError);
    } catch (error) { onError(error); }
}

async function saveGraphPosition(node) {
    if (node._dragGeneration !== positionsGeneration || !state.nodes.some(item => item.id === node.id)) return;
    const repository = bureauData?.positions;
    const generation = positionsGeneration;
    const sequence = ++positionSaveSequence;
    const point = { x: node.fx, y: node.fy };
    sharedGraphPositions.set(node.id, point);
    graphNodeMemory.set(node.id, { ...point, pinned: true });
    graphPositionStatus('Enregistrement de la position…', 'pending');
    try {
        if (!repository) throw new Error('Positions indisponibles');
        await repository.save(node.id, point);
        if (generation === positionsGeneration && sequence === positionSaveSequence) graphPositionStatus('');
    } catch {
        if (generation === positionsGeneration && sequence === positionSaveSequence) {
            graphPositionStatus('Position non enregistrée. Déplacez de nouveau le personnage pour réessayer.', 'error');
        }
    }
}

function curveRelationName(link) {
    const sourceId = link.source?.id ?? link.source;
    const targetId = link.target?.id ?? link.cible ?? link.target;
    const source = state.nodes.find(node => node.id === sourceId)?.nom || 'Personnage';
    const target = state.nodes.find(node => node.id === targetId)?.nom || 'Personnage';
    return `${source} ${link._bidirectional ? '↔' : '→'} ${target} · ${link.label || link.type || 'Relation'}`;
}

function curveIsVisible(link) {
    const source = state.nodes.find(node => node.id === (link.source?.id ?? link.source));
    const target = state.nodes.find(node => node.id === (link.target?.id ?? link.cible ?? link.target));
    return Boolean(source && target && isVisible(source) && isVisible(target));
}

function curveStatus(message, kind = '') {
    const status = document.getElementById('pnj-curve-status');
    status.textContent = message;
    status.dataset.kind = kind;
}

function resetCurveControls() {
    const focused = document.activeElement;
    if (focused?.closest?.('.pnj-curve-handle, .pnj-link-hit, #pnj-curve-controls')) document.getElementById('pnj-graph')?.focus();
    curveGeneration++;
    selectedCurveId = null;
    curvePreviews.clear();
    remoteCurvatures.clear();
    curveStatus('');
    document.getElementById('pnj-curve-controls').hidden = true;
    document.getElementById('pnj-curve-name').textContent = '';
    document.getElementById('pnj-curve-range').value = 0;
    document.getElementById('pnj-curve-value').textContent = 'Automatique';
}

function updateCurveControls() {
    const current = state.links.find(link => link.id === selectedCurveId && curveIsVisible(link));
    const controls = document.getElementById('pnj-curve-controls');
    controls.hidden = !current;
    if (!current) {
        if (document.activeElement?.closest?.('#pnj-curve-controls, .pnj-curve-handle')) document.getElementById('pnj-graph')?.focus();
        selectedCurveId = null;
        document.getElementById('pnj-curve-name').textContent = '';
        document.getElementById('pnj-curve-range').value = 0;
        document.getElementById('pnj-curve-value').textContent = 'Automatique';
        curveStatus('');
    }
    state.curveHandleSel?.style('display', d => d.id === selectedCurveId ? null : 'none')
        .attr('aria-hidden', d => d.id === selectedCurveId ? null : 'true')
        .attr('tabindex', d => d.id === selectedCurveId ? 0 : -1);
    state.linkHitSel?.attr('aria-pressed', d => String(d.id === selectedCurveId));
    state.linkSel?.classed('pnj-link-selected', d => d.id === selectedCurveId);
    if (!current) return;
    document.getElementById('pnj-curve-name').textContent = curveRelationName(current);
    const value = current._curveCurvature ?? curveFromPoint(current, curveHandlePoint(current, NODE_R), NODE_R);
    document.getElementById('pnj-curve-range').value = value;
    document.getElementById('pnj-curve-value').textContent = current._curveCurvature == null ? 'Automatique' : `${value}`;
    document.getElementById('pnj-curve-auto').setAttribute('aria-pressed', String(current._curveCurvature == null));
}

function selectCurve(id, focusHandle = false) {
    if (selectedCurveId !== id) curveStatus('');
    selectedCurveId = id;
    updateCurveControls();
    if (focusHandle) state.curveHandleSel?.filter(d => d.id === id).node()?.focus();
}

function previewCurve(id, value) {
    const current = state.links.find(link => link.id === id);
    if (!current) return;
    for (const memberId of current._curveMemberIds || [id]) {
        curvePreviews.set(memberId, { value });
        const member = state.links.find(link => link.id === memberId);
        if (member) member.curvature = value;
    }
    assignCurveLanes(state.links);
    state.redrawCurves?.();
    updateCurveControls();
}

async function saveCurve(id, value) {
    const repository = bureauData?.relations;
    const generation = curveGeneration;
    const current = state.links.find(link => link.id === id && curveIsVisible(link));
    if (!current) return;
    const memberIds = current._curveMemberIds || [id];
    const sequence = ++curveSequence;
    previewCurve(id, value);
    memberIds.forEach(memberId => curvePreviews.set(memberId, { value, sequence }));
    curveStatus('Enregistrement…', 'pending');
    try {
        if (!repository?.saveCurvature) throw new Error('Tracé indisponible');
        await repository.saveCurvature(id, value, memberIds.find(memberId => memberId !== id) ?? null);
        if (generation !== curveGeneration || curvePreviews.get(id)?.sequence !== sequence) return;
        memberIds.forEach(memberId => {
            if (curvePreviews.get(memberId)?.sequence === sequence) curvePreviews.delete(memberId);
        });
        if (selectedCurveId === id) curveStatus('Courbure enregistrée et partagée.');
    } catch {
        if (generation !== curveGeneration || curvePreviews.get(id)?.sequence !== sequence) return;
        memberIds.forEach(memberId => {
            if (curvePreviews.get(memberId)?.sequence !== sequence) return;
            curvePreviews.delete(memberId);
            const member = state.links.find(link => link.id === memberId);
            if (member) member.curvature = remoteCurvatures.get(memberId) ?? null;
        });
        assignCurveLanes(state.links);
        state.redrawCurves?.();
        updateCurveControls();
        if (selectedCurveId === id) curveStatus('Courbure non enregistrée. Réessayez.', 'error');
    }
}

// ── Graph ──────────────────────────────────────────────────────
function buildGraph() {
    const fitShared = !state.zoomTransform && sharedGraphPositions.size > 0;
    const container = document.getElementById('pnj-graph');
    state.graphW = container.clientWidth  || window.innerWidth * 0.85;
    state.graphH = container.clientHeight || 550;
    state.layoutW = state.graphW;
    state.layoutH = state.graphH;
    state.pendingFit = false;
    state.graphTicked = false;

    buildDimColorMap();

    const svg = d3.select('#pnj-graph').append('svg').attr('width', '100%').attr('height', '100%');
    const g   = svg.append('g');

    const initialScale = GRAPH_INITIAL_SCALE;
    const zoom = d3.zoom().scaleExtent([0.1, 5]).on('zoom', e => {
        state.zoomTransform = e.transform;
        g.attr('transform', e.transform);
    });
    svg.call(zoom);
    state.zoom = zoom;
    state.svgSel = svg;
    svg.call(zoom.transform, state.zoomTransform || d3.zoomIdentity
        .translate(state.graphW / 2 * (1 - initialScale), state.graphH / 2 * (1 - initialScale))
        .scale(initialScale));
    svg.on('click', () => { selectCurve(null); closePanel(); });

    assignCurveLanes(state.links);
    const drawnLinks = graphRelations(state.links);

    // Marqueurs de flèches (un par couleur unique)
    const defs = svg.append('defs');
    [...new Set(drawnLinks.map(l => safeRelationColor(l.color, l.type)))].forEach(color => {
        defs.append('marker')
            .attr('id', `arrow-${color.replace(/[^a-zA-Z0-9]/g, '')}`)
            .attr('viewBox', '0 -4 10 8').attr('refX', 10).attr('refY', 0)
            .attr('markerWidth', 10).attr('markerHeight', 8)
            .attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
            .append('path').attr('d', 'M0,-4 L10,0 L0,4 Z').attr('fill', color);
        defs.append('marker')
            .attr('id', `arrow-start-${color.replace(/[^a-zA-Z0-9]/g, '')}`)
            .attr('viewBox', '0 -4 10 8').attr('refX', 0).attr('refY', 0)
            .attr('markerWidth', 10).attr('markerHeight', 8)
            .attr('orient', 'auto').attr('markerUnits', 'userSpaceOnUse')
            .append('path').attr('d', 'M10,-4 L0,0 L10,4 Z').attr('fill', color);
    });

    // Liens : paths courbés + labels
    const linkG = g.append('g');
    state.linkSel = linkG.selectAll('path').data(drawnLinks).join('path')
        .attr('id', (d, i) => `pnj-lp-${i}`)
        .attr('class', 'pnj-link')
        .attr('stroke', d => safeRelationColor(d.color, d.type))
        .attr('stroke-width', 3.5)
        .attr('stroke-dasharray', d => d.style === 'dashed' ? '8 5' : null)
        .attr('marker-end', d => `url(#arrow-${safeRelationColor(d.color, d.type).replace(/[^a-zA-Z0-9]/g, '')})`)
        .attr('marker-start', d => d._bidirectional ? `url(#arrow-start-${safeRelationColor(d.color, d.type).replace(/[^a-zA-Z0-9]/g, '')})` : null)
        .attr('opacity', 0.8).attr('fill', 'none');

    // Larger invisible strokes make link selection usable by mouse, touch and keyboard.
    state.linkHitSel = linkG.selectAll('path.pnj-link-hit').data(drawnLinks).join('path')
        .attr('class', 'pnj-link-hit').attr('fill', 'none').attr('stroke', 'transparent')
        .attr('stroke-width', 16).attr('tabindex', 0).attr('role', 'button')
        .attr('aria-label', d => `Régler la courbure : ${curveRelationName(d)}`)
        .on('click', (e, d) => { e.stopPropagation(); selectCurve(d.id); })
        .on('keydown', (e, d) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault(); e.stopPropagation(); selectCurve(d.id, true);
        });

    // Chaque lien a son double inversé, jamais dessiné : le libellé s'y
    // accroche quand la cible est à gauche de la source.
    const reversedSel = defs.selectAll('path.pnj-link-reversed').data(drawnLinks).join('path')
        .attr('class', 'pnj-link-reversed')
        .attr('id', (d, i) => `pnj-lpr-${i}`);

    // Libellés : répètent la fiche, masqués aux lecteurs d'écran.
    const labelG = g.append('g').attr('class', 'pnj-link-labels').attr('aria-hidden', 'true');
    const linkTextSel = labelG.selectAll('text.pnj-link-label').data(drawnLinks).join('text')
        .attr('class', 'pnj-link-label')
        .attr('text-anchor', 'middle')
        // Au-dessus du trait (épais de 3,5) plutôt que posé dessus.
        .attr('dy', -8);
    const textPathSel = linkTextSel.append('textPath')
        .attr('href', (d, i) => `#pnj-lp-${i}`)
        .attr('startOffset', '50%')
        .text(d => d._showLabel !== false ? (d.label || d.type || '') : '');
    state.linkLabelSel = linkTextSel;

    // Nœuds : médaillons déplaçables, atteignables au clavier.
    const nodeG = g.append('g').selectAll('g').data(state.nodes).join('g')
        .attr('class', 'pnj-node')
        .attr('tabindex', 0)
        .attr('role', 'button')
        .attr('aria-label', nodeAriaLabel)
        .call(d3.drag()
            .on('start', (e, d) => { d._dragGeneration = positionsGeneration; draggingNodes.add(d.id); if (!e.active) state.simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
            .on('drag',  (e, d) => { d.x = d.fx = e.x; d.y = d.fy = e.y; })
            .on('end',   (e, d) => {
                if (!e.active) state.simulation.alphaTarget(0);
                d.x = d.fx = e.x; d.y = d.fy = e.y;
                draggingNodes.delete(d.id);
                void saveGraphPosition(d);
            }))
        .on('click', (e, d) => { e.stopPropagation(); openPanel(d, { origin: true }); })
        .on('focus', (e, d) => revealGraphNode(d))
        .on('keydown', (e, d) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            openPanel(d, { origin: true });
        });

    // Anneau de focus, hors du médaillon et de l'anneau « sort inconnu » : trait
    // sombre large sous un trait clair, lisible sur tout fond. Masqué au repos (CSS).
    const focusRing = nodeG.append('g').attr('class', 'node-focus-ring').attr('aria-hidden', 'true');
    focusRing.append('circle').attr('class', 'node-focus-ring-dark').attr('r', NODE_R + 9);
    focusRing.append('circle').attr('class', 'node-focus-ring-light').attr('r', NODE_R + 9);

    // Disque de fond et anneau à la couleur de la dimension choisie
    nodeG.append('circle')
        .attr('class', 'node-card')
        .attr('r', PORTRAIT_R + RING_W / 2)
        .attr('fill', 'var(--bg-card)')
        .attr('stroke', getDimColor)
        .attr('stroke-width', RING_W);

    // Sort inconnu : anneau pointillé autour du médaillon
    nodeG.filter(d => vivantKey(d) === 'inconnu').append('circle')
        .attr('class', 'node-fate-ring')
        .attr('r', NODE_R + 4);

    // Clip path circulaire pour le portrait
    nodeG.append('clipPath')
        .attr('id', d => `clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')}`)
        .append('circle')
        .attr('r', PORTRAIT_R);

    // Fond du portrait (placeholder)
    nodeG.append('circle')
        .attr('class', 'node-portrait-bg')
        .attr('r', PORTRAIT_R)
        .attr('fill', 'var(--bg-surface)')
        .style('display', d => medallionHref(d) ? 'none' : '');

    // Initiales (si pas de portrait)
    nodeG.append('text')
        .attr('class', 'node-initial')
        .attr('dy', '0.35em')
        .attr('text-anchor', 'middle')
        .style('display', d => medallionHref(d) ? 'none' : '')
        .text(d => initials(d.nom));

    // Portrait, en grisaille pour un défunt
    nodeG.append('image')
        .attr('class', d => vivantKey(d) === 'non' ? 'node-portrait pnj-deceased' : 'node-portrait')
        .attr('href', medallionHref)
        .attr('x', -PORTRAIT_R).attr('y', -PORTRAIT_R)
        .attr('width', PORTRAIT_R * 2).attr('height', PORTRAIT_R * 2)
        .attr('clip-path', d => `url(#clip-${d.id.replace(/[^a-zA-Z0-9]/g, '_')})`)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .style('display', d => medallionHref(d) ? '' : 'none')
        .on('error', function() { d3.select(this).style('display', 'none'); });

    // Nom et lieu, centrés sous le médaillon
    nodeG.append('text')
        .attr('class', 'node-name')
        .attr('text-anchor', 'middle')
        .attr('y', NODE_R + 16)
        .text(d => d.nom || '');

    nodeG.append('text')
        .attr('class', 'node-sub')
        .attr('text-anchor', 'middle')
        .attr('y', NODE_R + 30)
        .text(d => d.lieu || '');

    // Marques (fragments de balisage de seal.js, aucune donnée) : le sceau
    // porte toujours le statut, quelle que soit la couleur de l'anneau.
    nodeG.append('g')
        .attr('class', 'node-marks')
        .attr('aria-hidden', 'true')
        .html(d => sealMarkup(d.statut, { size: 22, x: MARK_OFFSET, y: MARK_OFFSET })
            + (vivantKey(d) === 'non' ? morrMarkup({ size: 20, x: MARK_OFFSET, y: -MARK_OFFSET }) : ''));

    state.nodeSel = nodeG;
    state.curveHandleSel = g.append('g').selectAll('g').data(drawnLinks).join('g')
        .attr('class', 'pnj-curve-handle').attr('role', 'button')
        .attr('aria-label', d => `Déplacer la courbure : ${curveRelationName(d)}. Utilisez les flèches pour ajuster.`)
        .call(d3.drag()
            .on('start', (e, d) => {
                e.sourceEvent?.stopPropagation();
                d._curveGeneration = curveGeneration;
                state.simulation?.stop();
            })
            .on('drag', (e, d) => {
                if (d._curveGeneration !== curveGeneration) return;
                const current = state.links.find(link => link.id === d.id);
                if (current) previewCurve(d.id, curveFromPoint(current, { x: e.x, y: e.y }, NODE_R));
            })
            .on('end', (e, d) => {
                if (d._curveGeneration !== curveGeneration) return;
                const current = state.links.find(link => link.id === d.id);
                if (current) void saveCurve(d.id, curveFromPoint(current, { x: e.x, y: e.y }, NODE_R));
            }))
        .on('click', e => e.stopPropagation())
        .on('keydown', (e, d) => {
            if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation(); selectCurve(null);
                state.linkHitSel?.filter(link => link.id === d.id).node()?.focus();
                return;
            }
            if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home'].includes(e.key)) return;
            e.preventDefault(); e.stopPropagation();
            const current = state.links.find(link => link.id === d.id);
            if (!current) return;
            const value = e.key === 'Home' ? 0 : Math.max(-6, Math.min(6,
                curveFromPoint(current, curveHandlePoint(current, NODE_R), NODE_R)
                + (['ArrowLeft', 'ArrowDown'].includes(e.key) ? -0.25 : 0.25)));
            previewCurve(d.id, value);
            void saveCurve(d.id, value);
        });
    state.curveHandleSel.append('circle').attr('r', 10);
    state.curveHandleSel.append('title').text('Déplacez cette poignée pour courber la liaison');
    state.redrawCurves = () => {
        const path = d => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y, d._curveScale ?? 1, false, NODE_R);
        state.linkSel.attr('d', path);
        state.linkHitSel.attr('d', path);
        reversedSel.attr('d', d => bezierPath(d.source.x, d.source.y, d.target.x, d.target.y, d._curveScale ?? 1, true, NODE_R));
        textPathSel.attr('href', (d, i) => d.target.x < d.source.x ? `#pnj-lpr-${i}` : `#pnj-lp-${i}`);
        state.curveHandleSel.attr('transform', d => {
            const point = curveHandlePoint(d, NODE_R);
            return `translate(${point.x},${point.y})`;
        });
    };

    state.simulation = d3.forceSimulation(state.nodes)
        .force('link',    d3.forceLink(drawnLinks).id(d => d.id).distance(240))
        .force('charge',  d3.forceManyBody().strength(-700))
        .force('center',  d3.forceCenter(state.layoutW / 2, state.layoutH / 2))
        // Médaillon et nom : environ 140 px de large
        .force('collide', d3.forceCollide(70))
        .on('tick', () => {
            state.graphTicked = true;
            state.redrawCurves();
            state.nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
        })
        .on('end', () => {
            state.nodes.forEach(d => { if (d.fx == null) { d.fx = d.x; d.fy = d.y; } });
            // Seulement si un redimensionnement l'a demandé : la fin d'un
            // glisser ne doit pas recadrer la vue sous la main du joueur.
            if (state.pendingFit) {
                state.pendingFit = false;
                fitGraphView();
            }
        });

    updateVisibility();
    updateLegend();
    updateCurveControls();
    if (fitShared) { fitGraphView(); state.pendingFit = true; }
}

// Cadre la boîte englobante des nœuds. Marges : le médaillon et son anneau de
// focus en haut, le nom qui déborde (~70 px) sur les côtés, les deux lignes de
// texte en dessous.
function fitGraphView() {
    if (!state.svgSel || !state.zoom) return;
    const placed = state.nodes.filter(d => Number.isFinite(d.x) && Number.isFinite(d.y));
    if (!placed.length) return;
    const side = 70, top = NODE_R + 12, bottom = NODE_R + 36, pad = 16;
    const x0 = d3.min(placed, d => d.x) - side, x1 = d3.max(placed, d => d.x) + side;
    const y0 = d3.min(placed, d => d.y) - top,  y1 = d3.max(placed, d => d.y) + bottom;
    const w = state.graphW, h = state.graphH;
    const k = Math.max(GRAPH_MIN_FIT_SCALE, Math.min(GRAPH_INITIAL_SCALE,
        (w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0)));
    state.svgSel.call(state.zoom.transform, d3.zoomIdentity
        .translate(w / 2 - k * (x0 + x1) / 2, h / 2 - k * (y0 + y1) / 2).scale(k));
}

// Un nœud atteint au clavier hors du cadre visible est ramené au centre.
function revealGraphNode(d) {
    // Avant le premier tick, les nœuds sont encore groupés autour de l'origine.
    if (!state.svgSel || !state.zoom || !state.graphTicked) return;
    const t = d3.zoomTransform(state.svgSel.node());
    const x = t.applyX(d.x), y = t.applyY(d.y), r = NODE_R * t.k;
    if (x - r >= 0 && x + r <= state.graphW && y - r >= 0 && y + r <= state.graphH) return;
    state.svgSel.call(state.zoom.translateTo, d.x, d.y);
}

function applyColorBy(dim) {
    state.colorBy = dim;
    buildDimColorMap();
    state.nodeSel?.select('.node-card').attr('stroke', getDimColor);
    if (dim === 'statut') {
        state.simulation?.force('cluster-x', null).force('cluster-y', null);
    } else {
        state.nodes.forEach(d => {
            if (sharedGraphPositions.has(d.id)) return;
            d.fx = null; d.fy = null;
        });
        const vals = state.dimColorMap ? [...state.dimColorMap.keys()] : [];
        const n = vals.length || 1, r = Math.min(state.layoutW, state.layoutH) * 0.28;
        const centers = Object.fromEntries(vals.map((v, i) => [v, {
            x: state.layoutW / 2 + r * Math.cos((2 * Math.PI * i / n) - Math.PI / 2),
            y: state.layoutH / 2 + r * Math.sin((2 * Math.PI * i / n) - Math.PI / 2),
        }]));
        state.simulation
            ?.force('cluster-x', d3.forceX(d => ownValue(centers, d[dim])?.x ?? state.layoutW / 2).strength(0.07))
            .force('cluster-y', d3.forceY(d => ownValue(centers, d[dim])?.y ?? state.layoutH / 2).strength(0.07))
            .alpha(0.4).restart();
    }
    updateLegend();
    document.querySelectorAll('.colorby-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.dim === dim);
        b.setAttribute('aria-pressed', String(b.dataset.dim === dim));
    });
}

// ── Visibility ─────────────────────────────────────────────────
function isVisible(d) {
    const q = stripAccents(state.searchQ.toLowerCase());
    if (q && !stripAccents((d.nom || '').toLowerCase()).includes(q) &&
             !stripAccents((d.description || '').toLowerCase()).includes(q)) return false;
    if (state.active.statut.size && !state.active.statut.has(d.statut)) return false;
    if (state.active.vivant.size && !state.active.vivant.has(d.vivant)) return false;
    if (state.active.lieu.size   && !state.active.lieu.has(d.lieu))     return false;
    if (!matchesGroupFilter(d, state.active.groupe)) return false;
    return true;
}

function updateVisibility() {
    if (!state.nodeSel) return;
    const visIds = new Set(state.nodes.filter(isVisible).map(d => d.id));
    state.nodeSel
        .style('opacity', d => isVisible(d) ? 1 : 0.06)
        .style('pointer-events', d => isVisible(d) ? 'all' : 'none')
        // Un nœud filtré n'est plus cliquable : il ne doit plus être atteignable au clavier non plus.
        .attr('tabindex', d => isVisible(d) ? 0 : -1)
        .attr('aria-hidden', d => isVisible(d) ? null : 'true');
    state.linkSel?.style('opacity', d => {
        // d.source/.target peuvent être soit un id (string) soit l'objet node après simulation
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return visIds.has(s) && visIds.has(t) ? 0.6 : 0.04;
    });
    state.linkLabelSel?.style('opacity', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return visIds.has(s) && visIds.has(t) ? 0.7 : 0;
    });
    state.linkHitSel?.attr('tabindex', d => curveIsVisible(d) ? 0 : -1)
        .attr('aria-hidden', d => curveIsVisible(d) ? null : 'true')
        .style('pointer-events', d => curveIsVisible(d) ? 'stroke' : 'none');
    updateCurveControls();
}

// ── Detail panel ───────────────────────────────────────────────
function readLinkedIndices(pnjId) {
    // Les associations V2 se consultent dans l’espace authentifié.
    if (pnjId) return Promise.resolve([]);
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

// `origin` : ouverture depuis le nœud ou la ligne du PNJ, où le focus reviendra.
// Une navigation par les relations garde l'origine de la première ouverture ;
// une ouverture sans origine (lien profond) rend le focus au nœud du PNJ.
async function openPanel(d, { origin = false, addRelation = false } = {}) {
    const panelGeneration = ++currentPanelGeneration;
    cancelLinkedIndices();
    const panelRole = state.isAdmin;
    if (origin) _panelReturnId = d.id;
    else if (!document.getElementById('pnj-detail').classList.contains('open')) _panelReturnId = d.id;
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

    // Une paire réciproque prouvée par le dépôt tient en une ligne « ↔ » : on
    // garde la relation sortante, updateRelation/deleteRelation traitant sa
    // réciproque avec elle.
    const related = state.links.filter(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        return s === d.id || t === d.id;
    }).map(l => {
        const s = l.source.id ?? l.source, t = l.target.id ?? l.target;
        const isSource = s === d.id;
        const paired = Boolean(exactReciprocal(l));
        if (paired && !isSource) return null;
        return { relId: l.id, node: nodeById.get(isSource ? t : s), type: l.type, label: l.label || l.type || 'Lié', dir: paired ? '↔' : isSource ? '→' : '←', color: safeRelationColor(l.color, l.type), style: l.style };
    }).filter(r => r?.node);

    const vKey = vivantKey(d);
    const deceased = vKey === 'non';
    // Les vivants n'ont plus de badge : seuls un défunt ou un sort inconnu se signalent.
    const vitalBadge = vKey === 'oui' ? '' : `<span class="pnj-badge vivant-${esc(vKey)}"><span class="visually-hidden">État vital : </span>${esc(vivantLabel(d.vivant))}</span>`;

    // Le src est posé après l'insertion : l'URL objet du portrait change à
    // chaque émission et empêcherait de reconnaître une fiche inchangée.
    const portraitHtml = d.imageUrl
        ? `<img class="pnj-dossier-portrait${deceased ? ' pnj-deceased' : ''}" alt="Portrait de ${esc(d.nom)}">`
        : (protectedImagePlaceholder(d, d.nom) || `<img class="pnj-dossier-default${deceased ? ' pnj-deceased' : ''}" src="${DEFAULT_PORTRAIT}" alt="">`);

    const groups = groupLabel(d);
    const metaHtml = (d.lieu || groups) ? `
        <dl class="pnj-detail-meta">
            ${d.lieu   ? `<div><dt>Lieu</dt><dd>${esc(d.lieu)}</dd></div>`     : ''}
            ${groups ? `<div><dt>Groupes</dt><dd>${esc(groups)}</dd></div>` : ''}
        </dl>` : '';

    const descHtml = d.description ? `
        <div class="pnj-detail-section">
            <p class="pnj-desc">${esc(d.description).replace(/\n/g, '<br>')}</p>
        </div>` : '';

    const editActions = panelRole ? `
        <div class="pnj-edit-actions">
            <button class="btn-edit" id="panel-edit-btn">✏ Modifier</button>
        </div>` : '';

    // Un « × » ou un « ✏ » seul ne dit pas quelle relation il vise.
    const relDeleteBtn = (relId, nom) => panelRole
        ? `<button class="rel-delete-btn" data-rel="${esc(relId)}" title="Supprimer" aria-label="Supprimer la relation avec ${esc(nom)}">×</button>` : '';
    const relEditBtn = (relId, nom) => panelRole
        ? `<button class="rel-edit-btn" data-rel="${esc(relId)}" title="Modifier" aria-label="Modifier la relation avec ${esc(nom)}">✏</button>` : '';

    const relHtml = `
        <div class="pnj-detail-section">
            <h3>Relations${related.length ? ` (${related.length})` : ''}</h3>
            <div class="pnj-relation-list">
                ${related.map(r => `
                    <div class="rel-chip-row" id="rel-row-${esc(r.relId)}" style="--chip-color:${esc(r.color || getLinkColor(r.type))}">
                        <button type="button" class="pnj-relation-chip" data-id="${esc(r.node.id)}">
                            <span class="chip-name">${esc(r.node.nom)}</span>
                            <span class="chip-type"><span class="chip-dir" aria-hidden="true">${r.dir}</span><span class="visually-hidden">${REL_DIR_LABELS[r.dir]}</span> ${esc(r.label)}</span>
                        </button>
                        ${relEditBtn(r.relId, r.node.nom)}${relDeleteBtn(r.relId, r.node.nom)}
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

    // Le dossier ne dépend pas du délai de lecture des indices liés.
    const renderDetails = linkedClues => {
        if (!panelIsCurrent()) return;
        const cluesHtml = linkedClues.length ? `
            <div class="pnj-detail-section">
                <h3>Indices liés</h3>
                <div class="pnj-clues-list">
                    ${linkedClues.map(c => `
                        <a href="enquetes.html?id=${esc(c.id)}" class="pnj-clue-badge${!c.decouvert ? ' clue-hidden' : ''}">
                            🔎 ${esc(c.titre)}${!c.decouvert ? ' 👁️ (Non découvert)' : ''}
                        </a>
                    `).join('')}
                </div>
            </div>` : '';

        // Le sceau (balisage de seal.js) remplace le badge de statut.
        const html = `
            <div class="pnj-dossier-banner">
                ${portraitHtml}
                <div class="pnj-dossier-title">
                    <h2 id="pnj-detail-title" tabindex="-1">${esc(d.nom || '?')}</h2>
                    <div class="pnj-badges">${sealMarkup(d.statut, { size: 34 })}${vitalBadge}</div>
                </div>
            </div>
            <div class="pnj-dossier-body">
                ${editActions}${metaHtml}${descHtml}${relHtml}<div class="pnj-detail-section"><h3>Documents et enquêtes</h3><a class="pnj-clue-badge" href="enquetes.html?id=${encodeURIComponent(d.id)}">Consulter les pièces liées et mon carnet</a></div>${cluesHtml}
            </div>`;

        const panel = document.getElementById('pnj-detail');
        const content = document.getElementById('pnj-detail-content');
        const opening = !panel.classList.contains('open') || _panelShownId !== d.id;
        // Réécrire une fiche inchangée ferait perdre le focus et les formulaires
        // ouverts à chaque émission temps réel.
        const rewrite = _panelRewrite?.id === d.id ? _panelRewrite : null;
        if (rewrite || html !== _panelHtml) {
            // body : l'élément focalisé (bouton du formulaire) a pu être retiré par
            // une réécriture précédente.
            const focusWasInside = panel.contains(document.activeElement) || document.activeElement === document.body;
            const restoreKey = opening ? null : focusKey(panel);
            content.innerHTML = html;
            _panelHtml = html;
            _panelRewrite = null;
            panelContributionAction?.dispose?.();
            panelContributionAction = null;
            relationContributionActions.forEach(action => action.dispose());
            relationContributionActions = [];
            if (d.visibleJoueurs === true || state.isAdmin) {
                panelContributionAction = mountContributionButton({ container: content.querySelector('.pnj-dossier-body') || content,
                    getClient: () => import('./contributions/firebase-client.js').then(module => module.contributionClient),
                    signIn: loginWithGoogle, kind: 'pnj', id: d.id, documentRef: document,
                    announce: message => showPnjDeletionStatus(message) });
            }
            relationContributionActions = related.filter(item => (item.node.visibleJoueurs === true || state.isAdmin)
                && (state.nodes.some(node => node.id === d.id && node.visibleJoueurs === true) || state.isAdmin)
                && (state.links.find(link => link.id === item.relId)?.visibleJoueurs === true || state.isAdmin))
                .map(item => {
                    const host = content.querySelector(`#rel-row-${CSS.escape(item.relId)}`);
                    return host ? mountContributionButton({ container: host,
                        getClient: () => import('./contributions/firebase-client.js').then(module => module.contributionClient),
                        signIn: loginWithGoogle, kind: 'relation', id: item.relId, documentRef: document,
                        announce: message => showPnjDeletionStatus(message) }) : null;
                }).filter(Boolean);
            if (rewrite && !opening && focusWasInside) (panel.querySelector(rewrite.focus) || document.getElementById('pnj-detail-title'))?.focus();
            else if (restoreKey) (panel.querySelector(restoreKey) || document.getElementById('pnj-detail-title'))?.focus();
        }
        const portrait = content.querySelector('.pnj-dossier-portrait');
        if (portrait && portrait.getAttribute('src') !== d.imageUrl) portrait.src = d.imageUrl;
        _panelShownId = d.id;

        panel.inert = false;
        panel.classList.add('open');
        // Le bureau se resserre à côté du dossier au lieu d'être recouvert.
        document.body.classList.add('pnj-panel-open');
        if (opening) document.getElementById('pnj-detail-title')?.focus();
        highlightConnected(d.id);
    };
    const cachedClues = panelLinkedClues.id === d.id && panelLinkedClues.role === panelRole
        ? panelLinkedClues.items : [];
    renderDetails(cachedClues);
    try {
        const linkedClues = await readLinkedIndices(d.id);
        if (!panelIsCurrent()) return;
        panelLinkedClues = { id: d.id, role: panelRole, items: linkedClues };
        renderDetails(linkedClues);
    } catch (error) {
        if (panelIsCurrent()) console.error('Erreur lors de la récupération des indices liés :', error);
    }

    // Ouvrir le formulaire après le dernier rendu pour conserver la saisie.
    if (addRelation && panelIsCurrent()) openRelAddForm();
}

// `restoreFocus` : fermeture demandée par l'utilisateur (bouton, Échap). Le
// focus revient aussi au PNJ d'origine s'il était dans le panneau, qui devient inerte.
function closePanel({ restoreFocus = false } = {}) {
    currentPanelGeneration += 1;
    cancelLinkedIndices();
    const panel = document.getElementById('pnj-detail');
    const focusWasInside = panel.contains(document.activeElement);
    panel.classList.remove('open');
    panel.inert = true;
    document.body.classList.remove('pnj-panel-open');
    _panelHtml = '';
    _panelShownId = null;
    _panelRewrite = null;
    panelContributionAction?.dispose?.();
    panelContributionAction = null;
    relationContributionActions.forEach(action => action.dispose());
    relationContributionActions = [];
    state.panelId = null;
    updateVisibility();
    if (restoreFocus || focusWasInside) focusPnjOrigin(_panelReturnId);
    _panelReturnId = null;
}

// Renvoie false si le nœud n'existe plus ou est filtré : un nœud aria-hidden
// ne doit jamais recevoir le focus.
function focusGraphNode(id) {
    const node = state.nodeSel?.filter(d => d.id === id).node();
    if (!node || node.getAttribute('aria-hidden') === 'true' || node.getAttribute('tabindex') === '-1') return false;
    node.focus();
    return true;
}

// Repli si l'origine a disparu (PNJ retiré, filtré, ligne absente) : le focus
// reste dans la vue au lieu de tomber sur body.
function focusPnjOrigin(id) {
    if (state.view === 'table') {
        const container = document.getElementById('pnj-table-container');
        const row = id ? container.querySelector(`.pnj-table-name[data-id="${CSS.escape(id)}"]`) : null;
        (row || container.querySelector('.pnj-table-count') || container.querySelector('table'))?.focus();
    } else if (!id || !focusGraphNode(id)) {
        document.getElementById('pnj-graph')?.focus();
    }
}

function resetPnjView() {
    currentPanelGeneration += 1;
    clearPnjAdminStatuses();
    if (state.simulation) { state.simulation.stop(); state.simulation = null; }
    d3.select('#pnj-graph > svg').remove();
    state.nodeSel = null;
    state.linkSel = null;
    state.linkLabelSel = null;
    state.linkHitSel = null;
    state.curveHandleSel = null;
    state.redrawCurves = null;
    state.dimColorMap = null;
    state.panelId = null;
    state.searchQ = '';
    clearFilters();
    document.getElementById('pnj-search').value = '';
    document.getElementById('pnj-table-container').innerHTML = '';
    document.getElementById('pnj-detail-content').innerHTML = '';
    document.getElementById('pnj-detail').classList.remove('open');
    document.getElementById('pnj-detail').inert = true;
    document.body.classList.remove('pnj-panel-open');
    _panelHtml = '';
    _panelShownId = null;
    _panelReturnId = null;
    _panelRewrite = null;
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
    // Atténuation douce : les autres PNJ restent lisibles pour garder le contexte.
    state.nodeSel?.style('opacity', d => isVisible(d) ? (connected.has(d.id) ? 1 : 0.25) : 0.02);
    state.linkSel?.style('opacity', d => {
        const s = d.source.id ?? d.source, t = d.target.id ?? d.target;
        return (s === id || t === id) ? 0.9 : 0.15;
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
        if (chipRow) {
            chipRow.style.display = 'none'; chipRow.insertAdjacentHTML('afterend', formHtml);
            const form = chipRow.nextElementSibling;
            form.inert = true;
            const openSession = editorSession;
            relationEditContexts.set(form, import('./contributions/firebase-client.js')
                .then(module => loadContentEditContext(module.contributionClient, 'relation', relId))
                .then(context => {
                    if (!context) throw new Error('Contexte versionné indisponible.');
                    form.querySelector('.rel-edit-type').value = context.data.type || '';
                    form.querySelector('.rel-edit-label').value = context.data.label || context.data.type || '';
                    const colorInput = document.getElementById('rel-edit-color');
                    if (colorInput && context.data.color) colorInput.value = safeRelationColor(context.data.color, context.data.type);
                    form.querySelectorAll('.style-btn').forEach(button => button.classList.toggle('active', button.dataset.style === (context.data.style || 'solid')));
                    return context;
                })
                .catch(error => { form.dataset.contextError = error.message; return null; })
                .finally(() => { if (openSession === editorSession && form.isConnected) form.inert = false; }));
        }
        return;
    }

    if (e.target.closest('.rel-edit-save-btn')) {
        const btn = e.target.closest('.rel-edit-save-btn');
        const form = btn.closest('.rel-edit-form-inline');
        void (async () => {
            const context = await relationEditContexts.get(form);
            await updateRelation(
                form.dataset.rel,
                form.querySelector('.rel-edit-type').value.trim(),
                form.querySelector('.rel-edit-label').value.trim(),
                document.getElementById('rel-edit-color')?.value || REL_PALETTE[0],
                form.querySelector('.style-btn.active')?.dataset.style || 'solid',
                context,
            );
        })().catch(error => alert(`Modification de la relation impossible : ${error.message}`));
        return;
    }

    if (e.target.closest('.rel-edit-cancel-btn')) {
        closeRelEditForm(e.target.closest('.rel-edit-form-inline'));
        return;
    }

    if (e.target.closest('#add-rel-btn')) {
        openRelAddForm();
        return;
    }

    if (e.target.closest('#rel-cancel-btn')) {
        closeRelAddForm();
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

// Fermeture par Annuler ou Échap : le focus revient au bouton qui a ouvert le
// formulaire, sinon il tomberait sur body avec l'élément retiré.
function closeRelEditForm(form) {
    const relId = form.dataset.rel;
    document.getElementById(form.dataset.chipRowId)?.style.removeProperty('display');
    form.remove();
    document.querySelector(`#pnj-detail .rel-edit-btn[data-rel="${CSS.escape(relId)}"]`)?.focus();
}

function closeRelAddForm() {
    const form = document.getElementById('rel-add-form');
    if (!form) return;
    form.style.display = 'none';
    const addBtn = document.getElementById('add-rel-btn');
    if (!addBtn) return;
    addBtn.style.display = '';
    addBtn.focus();
}

function openRelAddForm() {
    const form = document.getElementById('rel-add-form');
    const addBtn = document.getElementById('add-rel-btn');
    if (!form || !addBtn || state.panelId == null || !state.isAdmin) return;
    form.style.display = 'block';
    addBtn.style.display = 'none';
    document.getElementById('rel-target')?.focus();
}

// ── Table ──────────────────────────────────────────────────────
function renderTable() {
    const container = document.getElementById('pnj-table-container');
    const sorted = [...state.nodes.filter(isVisible)].sort((a, b) => {
        const value = item => state.sortCol === 'groupes' ? groupLabel(item) : (item[state.sortCol] || '');
        return state.sortDir * value(a).localeCompare(value(b), 'fr', { sensitivity: 'base' });
    });

    // L'en-tête triable est un bouton : atteignable au clavier, son état
    // de tri annoncé par aria-sort sur la cellule.
    const thead = '<th class="col-portrait"></th>' + TABLE_COLS.map(c => {
        const isSorted = c.key === state.sortCol;
        const arrow = isSorted ? (state.sortDir > 0 ? ' ▲' : ' ▼') : '';
        const ariaSort = isSorted ?(state.sortDir > 0 ? 'ascending' : 'descending') : 'none';
        return `<th scope="col" class="sortable" aria-sort="${ariaSort}"><button type="button" class="pnj-sort-btn" data-col="${esc(c.key)}">${esc(c.label)}<span aria-hidden="true">${arrow}</span></button></th>`;
    }).join('') + (state.isAdmin ? '<th scope="col">Actions</th>' : '');

    const tbody = sorted.map(d => {
        // Le texte de la colonne Statut reste : le petit sceau n'y est qu'un rappel visuel.
        const deceased = vivantKey(d) === 'non';
        const portrait = d.imageUrl
            ? `<img src="${esc(d.imageUrl)}" class="table-portrait${deceased ? ' pnj-deceased' : ''}" alt="${esc(d.nom)}">`
            : (protectedImagePlaceholder(d, d.nom) || `<img src="${DEFAULT_MEDALLION}" class="table-portrait${deceased ? ' pnj-deceased' : ''}" alt="">`);
        const portraitCell = `<td class="col-portrait"><span class="table-portrait-wrap">${portrait}<span class="table-portrait-seal" aria-hidden="true">${sealMarkup(d.statut, { size: 16 })}</span></span></td>`;

        const cells = TABLE_COLS.map(c => {
            if (c.key === 'nom') return `<td><button type="button" class="pnj-table-name" data-id="${esc(d.id)}">${esc(d.nom || '—')}</button></td>`;
            if (c.key === 'statut') return `<td><span class="pnj-badge statut-${esc((d.statut || '').toLowerCase())}">${esc(cap(d.statut) || '—')}</span></td>`;
            if (c.key === 'vivant') {
                // Même clé et même libellé que le graphe et la fiche : vide vaut « Vivant ».
                const vk = vivantKey(d);
                return `<td><span class="pnj-badge vivant-${esc(vk)}">${esc(vivantLabel(d.vivant || 'oui'))}</span></td>`;
            }
            if (c.key === 'groupes') return `<td>${esc(groupLabel(d) || '—')}</td>`;
            if (c.key === 'description') {
                const full = d.description || '', short = full.length > 90 ? full.slice(0, 90) + '…' : full;
                return `<td class="pnj-td-desc" title="${esc(full)}">${esc(short || '—')}</td>`;
            }
            return `<td>${esc(d[c.key] || '—')}</td>`;
        }).join('');
        const editCell = state.isAdmin ? `<td class="pnj-table-actions"><div class="pnj-table-action-buttons"><button type="button" class="pnj-table-add-rel" data-id="${esc(d.id)}" aria-label="Ajouter une relation pour ${esc(d.nom || 'ce personnage')}">＋ Relation</button><button type="button" class="btn-edit-sm" data-id="${esc(d.id)}" aria-label="Modifier ${esc(d.nom || 'ce personnage')}">✏</button></div></td>` : '';
        return `<tr>${portraitCell}${cells}${editCell}</tr>`;
    }).join('');

    // Le tableau est réécrit à chaque tri ou filtre : le focus revient sur l'élément équivalent.
    const restoreKey = focusKey(container);
    container.innerHTML = `
        <p class="pnj-table-count" tabindex="-1">${sorted.length} personnage${sorted.length !== 1 ? 's' : ''}</p>
        <div class="pnj-table-scroll">
            <table class="rules-table pnj-table-el">
                <thead><tr>${thead}</tr></thead>
                <tbody>${tbody}</tbody>
            </table>
        </div>`;

    container.querySelectorAll('.pnj-sort-btn').forEach(btn =>
        btn.addEventListener('click', () => {
            state.sortDir = state.sortCol === btn.dataset.col ? state.sortDir * -1 : 1;
            state.sortCol = btn.dataset.col;
            renderTable();
        }));
    container.querySelectorAll('.pnj-table-name').forEach(btn =>
        btn.addEventListener('click', () => {
            const node = state.nodes.find(n => n.id === btn.dataset.id);
            if (node) openPanel(node, { origin: true });
        }));
    container.querySelectorAll('.btn-edit-sm').forEach(btn =>
        btn.addEventListener('click', () => openPnjModal(btn.dataset.id)));
    container.querySelectorAll('.pnj-table-add-rel').forEach(btn =>
        btn.addEventListener('click', () => {
            const node = state.nodes.find(n => n.id === btn.dataset.id);
            if (node) void openPanel(node, { origin: true, addRelation: true });
        }));
    // Ligne disparue (PNJ retiré ou filtré) : repli sur le compteur.
    if (restoreKey) (container.querySelector(restoreKey) || container.querySelector('.pnj-table-count'))?.focus();
}

// ── View toggle ────────────────────────────────────────────────
function setView(view) {
    if (view !== 'graph') { selectCurve(null); void graphDisplay?.exit(); }
    state.view = view;
    document.getElementById('pnj-graph').style.display           = view === 'graph' ? '' : 'none';
    document.getElementById('pnj-table-container').style.display = view === 'table' ? '' : 'none';
    document.getElementById('colorby-group').style.display       = view === 'graph' ? '' : 'none';
    document.querySelectorAll('.view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.view === view);
        b.setAttribute('aria-pressed', String(b.dataset.view === view));
    });
    if (view === 'table') renderTable();
}

// ── Events ─────────────────────────────────────────────────────
document.getElementById('pnj-search').addEventListener('input', e => {
    state.searchQ = e.target.value.trim();
    updateVisibility();
    if (state.view === 'table') renderTable();
});
document.getElementById('pnj-detail-close').addEventListener('click', () => closePanel({ restoreFocus: true }));
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || !state.panelId) return;
    // Les modales (édition, cadrage, confirmation) passent avant la fiche.
    if (e.target.closest?.('dialog, [role="dialog"]')) return;
    if (['pnj-modal', 'crop-modal'].some(id => document.getElementById(id)?.open)) return;
    const panel = document.getElementById('pnj-detail');
    // Dans un formulaire de relation, Échap n'annule que lui, comme son bouton Annuler.
    const editForm = e.target.closest?.('.rel-edit-form-inline');
    if (editForm && panel.contains(editForm)) { e.preventDefault(); closeRelEditForm(editForm); return; }
    if (e.target.closest?.('.rel-add-form') && panel.contains(e.target)) { e.preventDefault(); closeRelAddForm(); return; }
    // Échap dans la recherche appartient au champ, pas à la fiche.
    if (!panel.contains(e.target) && e.target.matches?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    closePanel({ restoreFocus: true });
});

// La barre se replie selon la largeur disponible (panneau ouvert compris) :
// sa hauteur mesurée, et non supposée, fixe celle du graphe.
const pnjToolbar = document.querySelector('.pnj-toolbar');
const pnjSection = pnjToolbar?.closest('.section');
if (pnjToolbar && pnjSection && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
        pnjSection.style.setProperty('--pnj-toolbar-h', `${pnjToolbar.offsetHeight}px`);
    }).observe(pnjToolbar);
}

// Le graphe change de taille quand le dossier s'ouvre ou se ferme (et avec la
// fenêtre). La simulation n'est pas touchée : déplacer forceCenter pendant
// qu'elle tourne décalait le réseau une seconde fois, et chaque image de la
// transition du dossier la relançait. Seule la vue est recadrée, une fois la
// taille stabilisée (anti-rebond), puis de nouveau à la fin de la simulation
// si elle tournait encore.
const pnjGraph = document.getElementById('pnj-graph');
let _graphFitTimer = null;
if (pnjGraph && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
        const width = pnjGraph.clientWidth, height = pnjGraph.clientHeight;
        if (!width || !height) return; // vue Tableau : graphe masqué
        if (width === state.graphW && height === state.graphH) return;
        state.graphW = width;
        state.graphH = height;
        clearTimeout(_graphFitTimer);
        _graphFitTimer = setTimeout(() => {
            if (!state.simulation) return;
            fitGraphView();
            if (state.simulation.alpha() >= state.simulation.alphaMin()) state.pendingFit = true;
        }, GRAPH_FIT_DELAY);
    }).observe(pnjGraph);
}
graphDisplay = createGraphDisplay({ onResize: () => {
    requestAnimationFrame(() => {
        state.graphW = pnjGraph.clientWidth || state.graphW;
        state.graphH = pnjGraph.clientHeight || state.graphH;
        fitGraphView();
    });
} });

document.getElementById('pnj-curve-range').addEventListener('input', e => {
    if (selectedCurveId) previewCurve(selectedCurveId, Number(e.target.value));
});
document.getElementById('pnj-curve-range').addEventListener('change', e => {
    if (selectedCurveId) void saveCurve(selectedCurveId, Number(e.target.value));
});
document.getElementById('pnj-curve-auto').addEventListener('click', () => {
    if (selectedCurveId && state.links.find(link => link.id === selectedCurveId)?._curveCurvature != null) void saveCurve(selectedCurveId, null);
});
document.getElementById('pnj-curve-close').addEventListener('click', () => {
    const id = selectedCurveId;
    selectCurve(null);
    state.linkHitSel?.filter(d => d.id === id).node()?.focus();
});
document.querySelectorAll('.view-btn').forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
document.querySelectorAll('.colorby-btn').forEach(btn => btn.addEventListener('click', () => applyColorBy(btn.dataset.dim)));

loadData({ init: true });


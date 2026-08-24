import { watchAuth, loginWithGoogle, logout } from './auth.js';
import { createBureauData } from './bureau-data.js';
import { esc, stripAccents } from './utils.js';
import { confirmAction } from './ui-confirm.js';
import { visiblePourJoueurs } from './visibility.js';
import { createRenderGate, preserveCheckedValues } from './bureau-view-lifecycle.js';






function clueImagePlaceholder(clue) {
    if (!clue.imagePath) return '';
    return `<div class="clue-image-placeholder" role="status">${clue.imageState === 'access-denied' ? 'Image protégée inaccessible' : 'Image indisponible'}</div>`;
}

function showIndiceReadStatus(metadata, error = null) {
    const target = document.getElementById('indice-read-status') || document.createElement('p');
    target.id = 'indice-read-status';
    target.className = 'pnj-cleanup-status';
    target.textContent = error ? 'Lecture des enquêtes indisponible ; les dernières données restent affichées.'
        : metadata?.fromCache ? (metadata.hasPendingWrites ? 'Données locales, écritures en attente.' : 'Données locales en cours de synchronisation.')
            : metadata?.hasPendingWrites ? 'Écriture en attente de confirmation serveur.' : '';
    if (target.textContent) document.getElementById('clues-container')?.before(target);
    else target.remove();
}

// ── State ──────────────────────────────────────────────────────
const state = {
    isAdmin: false,
    clues: [],
    pnjs: [],
    searchQ: '',
    filter: 'all', // 'all', 'discovered', 'hidden'
    editingId: null,
    editingUpdatedAt: null,
};

let currentLoadId = 0;
let editorSession = 0;
let authSessionKey = '';
let localPreviewUrl = null;
let bureauData = null;
let unsubscribePnjs = null;
let unsubscribeIndices = null;
let bureauGeneration = 0;
const renderedImageHandles = new Map();
window.addEventListener('pagehide', () => {
    bureauGeneration += 1;
    currentLoadId += 1;
    editorSession += 1;
    closeClueModal();
    state.pnjs = [];
    state.clues = [];
    renderClues();
    unsubscribeAuth?.();
    unsubscribeAuth = null;
    unsubscribePnjs?.();
    unsubscribeIndices?.();
    renderedImageHandles.forEach(release => release());
    renderedImageHandles.clear();
    void bureauData?.close();
    bureauData = null;
});
window.addEventListener('pageshow', () => {
    if (!unsubscribeAuth) unsubscribeAuth = watchAuth(handleAuth);
});

// ── Auth Monitoring ────────────────────────────────────────────
function handleAuth(user, isAdmin) {
    const nextBureauGeneration = ++bureauGeneration;
    const roleChanged = state.isAdmin !== isAdmin;
    const nextAuthSessionKey = user?.uid || '';
    const identityChanged = authSessionKey !== nextAuthSessionKey;
    authSessionKey = nextAuthSessionKey;
    state.isAdmin = isAdmin;
    document.getElementById('auth-btn').textContent = state.isAdmin ? '🔓 Déconnexion' : '🔑 Admin';
    document.getElementById('add-clue-btn').style.display = state.isAdmin ? '' : 'none';
    document.getElementById('filter-group').style.display = state.isAdmin ? 'flex' : 'none';
    document.getElementById('admin-sep').style.display = state.isAdmin ? '' : 'none';
    if (roleChanged || identityChanged) {
        unsubscribePnjs?.();
        unsubscribeIndices?.();
        unsubscribePnjs = null;
        unsubscribeIndices = null;
        const previousData = bureauData;
        bureauData = null;
        void previousData?.close().catch(error => console.warn('Fermeture du client bureau différée.', error));
        try { bureauData = createBureauData({ isAdmin }); }
        catch (error) { console.error('Initialisation des dépôts bureau impossible.', error); }
        // Un changement d’identité invalide les lectures et vide la fenêtre immédiatement.
        editorSession += 1;
        currentLoadId += 1;
        renderedImageHandles.forEach(release => release());
        renderedImageHandles.clear();
        bureauData?.images.revokeAll?.();
        closeClueModal();
    }
    if ((roleChanged || identityChanged) && !state.isAdmin) {
        // Déconnexion : retirer les indices MJ avant tout chargement public.
        state.pnjs = [];
        state.clues = [];
        renderClues();
    }
    
    if (roleChanged || identityChanged || !bureauData) {
        if (!bureauData) {
            try { bureauData = createBureauData({ isAdmin }); }
            catch (error) { console.error('Initialisation des dépôts bureau impossible.', error); }
        }
        loadData({ generation: nextBureauGeneration, init: true });
    }
}
let unsubscribeAuth = watchAuth(handleAuth);


// ── Auth Button Click ──────────────────────────────────────────
document.getElementById('auth-btn').addEventListener('click', async () => {
    if (state.isAdmin) {
        await logout();
    } else {
        try { 
            await loginWithGoogle(); 
        } catch (e) { 
            if (e.code !== 'auth/popup-closed-by-user') {
                alert('Connexion impossible : ' + e.message); 
            }
        }
    }
});

// ── Data Fetching ──────────────────────────────────────────────
async function loadData({ generation = bureauGeneration, init = false } = {}) {
    const loadId = ++currentLoadId;
    try {
        if (generation !== bureauGeneration || !bureauData) return;
        clearLocalPreview();
        const container = document.getElementById('clues-container');
        if (container) {
            container.innerHTML = `
                <div id="clues-loading" class="pnj-loading">
                    <div class="pnj-spinner"></div>
                    <span class="loading-text">Chargement du grimoire d'enquêtes...</span>
                </div>`;
        }

        const renderGate = createRenderGate();
        const render = async (pnjs, clues, token) => {
            if (generation !== bureauGeneration || loadId !== currentLoadId || !renderGate.isCurrent(token)) return;
            renderedImageHandles.forEach(release => release());
            renderedImageHandles.clear();
            state.pnjs = pnjs.map(repositoryPnjToPage).filter(pnj => state.isAdmin || visiblePourJoueurs(pnj))
                .sort((a, b) => (a.nom || '').localeCompare(b.nom || ''));
            state.clues = clues.map(repositoryIndiceToPage);
            if (state.editingId && !state.clues.some(clue => clue.id === state.editingId)) {
                closeClueModal();
                const status = document.getElementById('clue-edit-status') || document.createElement('p');
                status.id = 'clue-edit-status';
                status.className = 'pnj-cleanup-status';
                status.textContent = 'Cet indice a été supprimé ou n’est plus accessible.';
                document.getElementById('clues-container')?.before(status);
            }
            await Promise.all(state.clues.map(async clue => {
            if (!clue.imagePath) {
                clue.imageState = clue.imageUrl ? 'legacy' : 'missing';
                clue.imageError = null;
                return;
            }
            try {
                const handle = bureauData.images.loadObjectUrl(clue.imagePath);
                const result = await handle;
                if (generation !== bureauGeneration || !renderGate.isCurrent(token)) { result.release?.(); return; }
                renderedImageHandles.set(clue.id, result.release);
                clue.imageState = 'ready';
                clue.imageError = null;
                clue.imageUrl = result.url;
            } catch (error) {
                clue.imageState = ['storage/unauthorized', 'storage/unauthenticated'].includes(error?.cause?.code) ? 'access-denied' : 'missing';
                clue.imageError = error?.code || null;
                clue.imageUrl = '';
            }
            }));
            if (generation !== bureauGeneration || loadId !== currentLoadId || !renderGate.isCurrent(token)) return;

        // 3. Render en conservant la position de lecture malgré l'émission temps réel.
        const scrollTop = document.getElementById('clues-container')?.scrollTop ?? 0;
        renderClues();
        const cluesContainer = document.getElementById('clues-container');
        if (cluesContainer) cluesContainer.scrollTop = scrollTop;

        // 4. Fill form checkboxes
        populatePnjsCheckboxGrid();

        // 5. Highlight clue if requested in URL
        highlightClueFromUrl();
        };
        unsubscribePnjs?.();
        unsubscribeIndices?.();
        let latestPnjs = [];
        let latestClues = [];
        const update = () => {
            const token = renderGate.next();
            void render(latestPnjs, latestClues, token);
        };
        const pnjSubscribe = state.isAdmin ? bureauData.pnjs.subscribeAll : bureauData.pnjs.subscribeVisible;
        const indiceSubscribe = state.isAdmin ? bureauData.indices.subscribeAll : bureauData.indices.subscribeDiscovered;
        unsubscribePnjs = pnjSubscribe.call(bureauData.pnjs, (pnjs, metadata) => {
            latestPnjs = pnjs; showIndiceReadStatus(metadata); update();
        }, error => { console.error('Lecture PNJs impossible.', error); showIndiceReadStatus(null, error); });
        unsubscribeIndices = indiceSubscribe.call(bureauData.indices, (clues, metadata) => {
            latestClues = clues; showIndiceReadStatus(metadata); update();
        }, error => { console.error('Lecture des indices impossible.', error); showIndiceReadStatus(null, error); });

    } catch (e) {
        if (loadId !== currentLoadId) return;
        console.error("Erreur lors du chargement des données :", e);
        const container = document.getElementById('clues-container');
        if (container) {
            container.innerHTML = `
                <div class="pnj-loading">
                    <span class="loading-text">${e?.code === 'permission-denied'
                        ? 'Accès refusé : certaines données ne sont pas visibles pour ce compte.'
                        : 'Impossible de charger le grimoire d’enquêtes. Réessayez dans un instant.'}</span>
                </div>`;
        }
    }
}

function repositoryPnjToPage(pnj) {
    return {
        ...pnj,
        imagePath: pnj?.imagePath || '',
        imageUrl: pnj?.imagePath ? '' : (pnj?.imageUrl || ''),
    };
}

function repositoryIndiceToPage(indice) {
    const image = indice?.image || {};
    return {
        ...indice,
        imagePath: image.legacy || image.invalid ? '' : (image.path || ''),
        imageUrl: image.legacy && !image.invalid ? image.path : '',
        legacyImageUrl: image.legacy && !image.invalid ? image.path : '',
    };
}

// ── Populate PNJ checkbox grid in form ──────────────────────────
function populatePnjsCheckboxGrid() {
    const grid = document.getElementById('f-pnjs-grid');
    if (!grid) return;
    const selected = [...grid.querySelectorAll('input[name="pnjsLies"]:checked')].map(input => input.value);
    const available = state.pnjs.map(p => p.id);
    const selectedValues = new Set(preserveCheckedValues(selected, available));
    grid.innerHTML = state.pnjs.map(p => `
        <label class="pnjs-checkbox-label" title="${esc(p.nom)}">
            <input type="checkbox" name="pnjsLies" value="${esc(p.id)}">
            <span>${esc(p.nom)}</span>
        </label>
    `).join('');
    grid.querySelectorAll('input[name="pnjsLies"]').forEach(input => { input.checked = selectedValues.has(input.value); });
}

// ── Render Clues ────────────────────────────────────────────────
function renderClues() {
    const container = document.getElementById('clues-container');
    if (!container) return;

    const searchVal = stripAccents(state.searchQ.toLowerCase());
    const filtered = state.clues.filter(c => {
        // Filtre de recherche.
        if (searchVal) {
            const inTitle = stripAccents((c.titre || '').toLowerCase()).includes(searchVal);
            const inDesc = stripAccents((c.description || '').toLowerCase()).includes(searchVal);
            if (!inTitle && !inDesc) return false;
        }

        // Filtre du statut MJ.
        if (state.isAdmin) {
            if (state.filter === 'discovered' && !c.decouvert) return false;
            if (state.filter === 'hidden' && c.decouvert) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = `
            <div id="pnj-empty" class="pnj-loading" style="position:static; opacity:1; grid-column:1/-1; display:flex; flex-direction:column; align-items:center; width:100%; border:none; background:none; padding:var(--space-2xl) 0;">
                <p>Aucun indice trouvé.</p>
                ${state.isAdmin ? '<span class="pnj-empty-hint">Créez un nouvel indice à l\'aide du bouton ＋ Indice.</span>' : ''}
            </div>`;
        return;
    }

    container.innerHTML = filtered.map(c => {
        const isDecouvert = !!c.decouvert;
        const statusBadge = state.isAdmin ? `
            <span class="pnj-badge ${isDecouvert ? 'vivant-oui' : 'vivant-non'} clue-badge-status">
                ${isDecouvert ? 'Découvert' : 'Secret'}
            </span>` : '';

        const editBtn = state.isAdmin ? `
            <button class="clue-edit-btn" data-id="${esc(c.id)}" title="Modifier l'indice">✏️</button>
        ` : '';

        const imageHtml = c.imageUrl ? `
            <div class="clue-image-container">
                <img src="${esc(c.imageUrl)}" class="clue-image" alt="${esc(c.titre)}" loading="lazy">
            </div>` : (c.imagePath ? `<div class="clue-image-container">${clueImagePlaceholder(c)}</div>` : '');

        // Génération des pastilles PNJ.
        const linkedPnjIds = c.pnjsLies || [];
        const linkedPnjs = linkedPnjIds.map(id => state.pnjs.find(p => p.id === id)).filter(Boolean);
        const pnjsSection = linkedPnjs.length > 0 ? `
            <div class="clue-pnjs-section">
                <span class="clue-pnjs-title">Personnages concernés</span>
                <div class="clue-pnjs-list">
                    ${linkedPnjs.map(p => `
                        <a href="pnjs.html?id=${esc(p.id)}" class="clue-pnj-chip">👤 ${esc(p.nom)}</a>
                    `).join('')}
                </div>
            </div>` : '';

        return `
            <div class="clue-card ${!isDecouvert ? 'clue-hidden' : ''}" id="clue-card-${esc(c.id)}">
                <div class="clue-header">
                    <div>
                        <h3 class="clue-title">${esc(c.titre)}</h3>
                        ${statusBadge}
                    </div>
                    ${editBtn}
                </div>
                ${imageHtml}
                <p class="clue-description">${esc(c.description).replace(/\n/g, '<br>')}</p>
                ${pnjsSection}
            </div>`;
    }).join('');

    // Branche les boutons d’édition.
    container.querySelectorAll('.clue-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            openClueModal(btn.dataset.id);
        });
    });
}

// ── Highlight clue from URL param ──────────────────────────────
function highlightClueFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    const clueId = urlParams.get('id') || urlParams.get('clue');
    if (clueId) {
        setTimeout(() => {
            const card = document.getElementById(`clue-card-${clueId}`);
            if (card) {
                card.classList.add('highlighted');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 150);
    }
}

// ── CRUD Modals ────────────────────────────────────────────────
function openClueModal(clueId = null) {
    editorSession += 1;
    clearLocalPreview();
    state.editingId = clueId;
    state.editingUpdatedAt = null;
    document.getElementById('clue-form').reset();
    document.getElementById('f-image-preview').innerHTML = '';
    document.getElementById('f-image-preview').dataset.existingUrl = '';
    document.getElementById('f-image-preview').dataset.existingPath = '';
    document.getElementById('f-image-preview').dataset.existingLegacyUrl = '';
    document.getElementById('clue-modal-title').textContent = clueId ? "Modifier l'indice" : "Nouvel indice";
    document.getElementById('clue-delete-btn').style.display = clueId ? '' : 'none';

    // Réinitialise les cases à cocher.
    const checkboxes = document.querySelectorAll('#f-pnjs-grid input[name="pnjsLies"]');
    checkboxes.forEach(cb => cb.checked = false);

    if (clueId) {
        const c = state.clues.find(cl => cl.id === clueId);
        if (c) {
            state.editingUpdatedAt = c.updatedAt ?? null;
            document.getElementById('f-titre').value = c.titre || '';
            document.getElementById('f-description').value = c.description || '';
            document.getElementById('f-decouvert').value = String(!!c.decouvert);
            if (c.imageUrl) {
                document.getElementById('f-image-preview').innerHTML = `<img src="${esc(c.imageUrl)}" alt="Illustration" style="max-height: 100px; border-radius: 4px;">`;
                document.getElementById('f-image-preview').dataset.existingUrl = c.imageUrl;
            }
            document.getElementById('f-image-preview').dataset.existingPath = c.imagePath || '';
            document.getElementById('f-image-preview').dataset.existingLegacyUrl = c.legacyImageUrl || (!c.imagePath ? (c.imageUrl || '') : '');
            const lies = c.pnjsLies || [];
            checkboxes.forEach(cb => {
                if (lies.includes(cb.value)) {
                    cb.checked = true;
                }
            });
        }
    }
    document.getElementById('clue-modal').style.display = 'flex';
}

function closeClueModal() {
    editorSession += 1;
    clearLocalPreview();
    document.getElementById('clue-modal').style.display = 'none';
    document.getElementById('clue-form').reset();
    document.getElementById('f-image-preview').innerHTML = '';
    document.getElementById('f-image-preview').dataset.existingUrl = '';
    document.getElementById('f-image-preview').dataset.existingPath = '';
    document.getElementById('f-image-preview').dataset.existingLegacyUrl = '';
    document.getElementById('f-image').value = '';
    state.editingId = null;
    state.editingUpdatedAt = null;
}

function clearLocalPreview() {
    if (localPreviewUrl) URL.revokeObjectURL(localPreviewUrl);
    localPreviewUrl = null;
}

// ── Event Handlers ─────────────────────────────────────────────
document.getElementById('f-image').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById('f-image-preview');
    clearLocalPreview();
    localPreviewUrl = URL.createObjectURL(file);
    preview.innerHTML = `<img src="${localPreviewUrl}" alt="Aperçu" style="max-height: 100px; border-radius: 4px;">`;
    preview.dataset.existingUrl = '';
});

document.getElementById('clue-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('clue-save-btn');
    const capturedEditingId = state.editingId;
    const capturedSession = editorSession;
    const capturedRole = state.isAdmin;
    const repository = bureauData?.indices;
    const current = state.clues.find(clue => clue.id === capturedEditingId);
    const stillCurrent = () => capturedSession === editorSession
        && capturedRole === state.isAdmin && capturedRole
        && capturedEditingId === state.editingId
        && document.getElementById('clue-modal')?.style.display !== 'none'
        && repository === bureauData?.indices;
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';
    try {
        if (!repository?.create) throw new Error('Dépôt indices indisponible.');
        const titre = document.getElementById('f-titre').value.trim();
        const description = document.getElementById('f-description').value.trim();
        const decouvert = document.getElementById('f-decouvert').value === 'true';
        const pnjsLies = [...document.querySelectorAll('#f-pnjs-grid input[name="pnjsLies"]:checked')].map(input => input.value);
        const file = document.getElementById('f-image').files?.[0] || null;
        const id = capturedEditingId || 'indice-' + Date.now().toString(36);
        if (!stillCurrent()) throw new Error('Édition annulée : la session ou le rôle a changé.');
        const payload = { titre, description, decouvert, pnjsLies };
        if (capturedEditingId && !file && current?.imagePath) payload.imagePath = current.imagePath;
        const result = capturedEditingId
            ? await repository.update(capturedEditingId, payload, state.editingUpdatedAt, { imageFile: file })
            : await repository.create(payload, { id, imageFile: file });
        if (!stillCurrent()) return;
        void result;
        closeClueModal();
    } catch (error) {
        if (stillCurrent()) alert('Erreur lors de l’enregistrement : ' + (error?.message || 'réessayez.'));
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enregistrer';
    }
});

document.getElementById('clue-delete-btn').addEventListener('click', async () => {
    if (!state.editingId) return;
    const capturedEditingId = state.editingId;
    const capturedSession = editorSession;
    const repository = bureauData?.indices;
    const clue = state.clues.find(item => item.id === capturedEditingId);
    const ok = await confirmAction({
        titre: "Supprimer l'indice",
        message: "L'indice « " + (clue?.titre || 'cet indice') + " » sera définitivement supprimé.",
        libelleAction: 'Supprimer', danger: true,
    });
    if (!ok || capturedSession !== editorSession) return;
    const btn = document.getElementById('clue-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Suppression…';
    try {
        if (!repository?.remove) throw new Error('Dépôt indices indisponible.');
        await repository.remove(capturedEditingId);
        if (capturedSession === editorSession && repository === bureauData?.indices) closeClueModal();
    } catch (error) {
        if (capturedSession === editorSession) alert('Erreur lors de la suppression : ' + (error?.message || 'réessayez.'));
    } finally {
        btn.disabled = false;
        btn.textContent = '🗑 Supprimer';
    }
});

// Champ de recherche.
document.getElementById('clue-search').addEventListener('input', e => {
    state.searchQ = e.target.value;
    renderClues();
});

// Contrôles de filtrage.
document.getElementById('btn-filter-all').addEventListener('click', () => {
    setActiveFilter('all');
});
document.getElementById('btn-filter-discovered').addEventListener('click', () => {
    setActiveFilter('discovered');
});
document.getElementById('btn-filter-hidden').addEventListener('click', () => {
    setActiveFilter('hidden');
});

function setActiveFilter(filter) {
    state.filter = filter;
    document.querySelectorAll('#filter-group .colorby-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (filter === 'all') document.getElementById('btn-filter-all').classList.add('active');
    if (filter === 'discovered') document.getElementById('btn-filter-discovered').classList.add('active');
    if (filter === 'hidden') document.getElementById('btn-filter-hidden').classList.add('active');
    
    renderClues();
}

// Bouton d’ajout d’indice.
document.getElementById('add-clue-btn').addEventListener('click', () => {
    openClueModal();
});

// Contrôles de fermeture de la fenêtre.
document.getElementById('clue-modal-close').addEventListener('click', () => {
    closeClueModal();
});

document.getElementById('clue-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('clue-modal')) {
        closeClueModal();
    }
});
